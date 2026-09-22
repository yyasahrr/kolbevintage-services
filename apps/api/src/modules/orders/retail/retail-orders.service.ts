import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { RETAIL_PAYMENT_METHODS } from "@kolbe/database";
import { MAX_MONEY, NotFoundError, RETAIL_ORDER_STATUSES, RETAIL_ORDER_TRANSITIONS } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";
import { AuditService } from "../../audit/audit.service";
import { ComplianceService } from "../../compliance/compliance.service";
import { InventoryService } from "../../inventory/inventory.service";
import { OffersService } from "../../offers/offers.service";
import { RetailPricingService } from "../../pricing/retail-pricing.service";
import { RETAIL_PRICING_RESOLVER } from "../../promotions/promotions.contract";
import { PromotionCouponService } from "../../promotions/promotion-coupon.service";
import { PromotionEvaluationService } from "../../promotions/promotion-evaluation.service";
import { PromotionUsageService } from "../../promotions/promotion-usage.service";
import {
  RetailDomainError,
  type CreateRetailOrderInput,
  type RetailActor,
  type RetailLineInput,
  type RetailOrderView,
} from "./retail-orders.contract";
import { RetailOrdersRepository } from "./retail-orders.repository";

/**
 * Phase 5.8 — canonical Retail order writer (Nest).
 *
 * One transaction owns the whole commercial act: idempotent order insert,
 * immutable item snapshots, promotion redemptions (shared executor),
 * KOLBE inventory reservations, legal evidence binding, status history,
 * and audit. Any failure rolls everything back: no partial order, no
 * consumed coupon, no orphaned reservation, no order without legal
 * evidence when the gate enforces.
 */

export const RETAIL_RESERVATION_TTL_MINUTES = 7 * 24 * 60; // manual follow-up takes days (D19a); revisited in B.
export const RETAIL_MAX_COUPON_CODES = 20;
export const RETAIL_MAX_POLICY_IDS = 20;

type ParsedContact = { name: string; phone: string; email: string | null };
type ParsedAddress = Record<string, string>;

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseContact(input: unknown): ParsedContact {
  const record = (input ?? {}) as Record<string, unknown>;
  const name = text(record.name, 160);
  const phone = text(record.phone, 32);
  const email = text(record.email, 254) || null;
  if (!name) throw new RetailDomainError("RETAIL_CUSTOMER_NAME_REQUIRED", "customer name is required");
  // Iranian mobile: 09xxxxxxxxx | +989xxxxxxxxx | 9xxxxxxxxx (legacy rule, verbatim).
  const normalizedPhone = phone.replace(/[\s-]/g, "");
  if (!/^(?:\+98|0098|98|0)?9\d{9}$/.test(normalizedPhone)) {
    throw new RetailDomainError("RETAIL_CUSTOMER_PHONE_INVALID", "customer phone is not a valid Iranian mobile");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new RetailDomainError("RETAIL_CUSTOMER_EMAIL_INVALID", "customer email is invalid");
  }
  return { name, phone: normalizedPhone, email };
}

function parseAddress(input: unknown): ParsedAddress {
  const record = (input ?? {}) as Record<string, unknown>;
  const field = (key: string, maxLength: number) => text(record[key], maxLength);
  const province = field("province", 64);
  const city = field("city", 64);
  const address = field("address", 512);
  if (!province || !city || !address) {
    throw new RetailDomainError("RETAIL_ADDRESS_INCOMPLETE", "province, city and address are required");
  }
  const out: ParsedAddress = {
    province,
    city,
    address,
    plaque: field("plaque", 16),
    unit: field("unit", 16),
    postal: field("postal", 16).replace(/\D/g, "").slice(0, 10),
    note: field("note", 512),
  };
  const recipient = field("recipient", 160);
  if (recipient !== "") out.recipient = recipient;
  return out;
}

function parsePayMethod(input: unknown): string {
  const method = text(input, 32);
  if (!(RETAIL_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new RetailDomainError("RETAIL_PAYMENT_METHOD_INVALID", "unknown retail payment method");
  }
  return method;
}

function parseIdempotencyKey(input: unknown): string {
  const key = typeof input === "string" ? input.trim() : "";
  if (!key) throw new RetailDomainError("RETAIL_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
  if (key.length > 128 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new RetailDomainError("RETAIL_IDEMPOTENCY_KEY_INVALID", "Idempotency-Key is malformed");
  }
  return key;
}

function parseStringList(input: unknown, max: number, code: string, field: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new RetailDomainError(code, `${field} must be an array`);
  if (input.length > max) throw new RetailDomainError(code, `${field} has too many entries (max ${max})`);
  return input.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "" || entry.length > 128) {
      throw new RetailDomainError(code, `${field} entries must be non-empty strings`);
    }
    return entry.trim();
  });
}

function canonicalHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function makeOrderId(): string {
  return `rord_${randomUUID().replaceAll("-", "")}`;
}

function makeItemId(): string {
  return `roi_${randomUUID().replaceAll("-", "")}`;
}

function makeEventId(): string {
  return `revt_${randomUUID().replaceAll("-", "")}`;
}

function makeOrderCode(): string {
  return `RT-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export function retailLegalGateMode(): "off" | "enforce" {
  return (process.env.KOLBE_RETAIL_LEGAL_GATE || "off").trim().toLowerCase() === "enforce" ? "enforce" : "off";
}

function pgErrorInfo(error: unknown): { code: string; constraint: string } {
  const inner = (error as { cause?: unknown })?.cause ?? error;
  const code = String((inner as { code?: unknown })?.code ?? (error as { code?: unknown })?.code ?? "");
  const constraint = String(
    (inner as { constraint?: unknown })?.constraint ?? (error as { constraint?: unknown })?.constraint ?? "",
  );
  return { code, constraint };
}

@Injectable()
export class RetailOrdersService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(RetailOrdersRepository) private readonly repo: RetailOrdersRepository,
    @Inject(RetailPricingService) private readonly pricing: RetailPricingService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(PromotionEvaluationService) private readonly promotions: PromotionEvaluationService,
    @Inject(PromotionUsageService) private readonly usage: PromotionUsageService,
    @Inject(PromotionCouponService) private readonly coupons: PromotionCouponService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createRetailOrder(actor: RetailActor, input: CreateRetailOrderInput): Promise<RetailOrderView> {
    const key = parseIdempotencyKey(input.idempotencyKey);
    const contact = parseContact(input.customer);
    const address = parseAddress(input.address);
    if (!Array.isArray(input.lines)) {
      throw new RetailDomainError("RETAIL_LINES_REQUIRED", "lines must be an array");
    }
    const lines = input.lines as RetailLineInput[];
    const payMethod = parsePayMethod(input.payMethod);
    const couponCodes = parseStringList(input.couponCodes, RETAIL_MAX_COUPON_CODES, "RETAIL_COUPON_CODE_INVALID", "couponCodes");
    const acceptedPolicyDocumentIds = parseStringList(
      input.acceptedPolicyDocumentIds,
      RETAIL_MAX_POLICY_IDS,
      "RETAIL_POLICY_ID_INVALID",
      "acceptedPolicyDocumentIds",
    );
    // Presented (browser-claimed) money is display hint only: it never
    // participates in the identity hash, so a hint change cannot fork an order.
    const hash = canonicalHash({
      customer: contact,
      lines: lines.map((line) => ({
        productId: text(line?.productId, 160),
        variantId: text(line?.variantId, 160),
        size: text(line?.size, 64),
        colour: text(line?.colour, 64),
        quantity: typeof line?.quantity === "number" ? line.quantity : String(line?.quantity ?? ""),
      })),
      address,
      shippingMethodId: text(input.shippingMethodId, 32),
      payMethod,
      couponCodes: [...couponCodes].map((code) => code.toUpperCase()).sort(),
      acceptedPolicyDocumentIds: [...acceptedPolicyDocumentIds].sort(),
    });

    // Random order-code collision: regenerate once inside a fresh transaction.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          // Serialize concurrent retries on this key: the loser blocks here,
          // then sees the committed row and takes the replay path below.
          await this.repo.advisoryLock(key, tx);
          const existing = await this.repo.findByIdempotencyKey(key, tx);
          if (existing) return this.presentReplay(tx, existing, actor, contact, hash);
          return await this.createInTx(tx, {
            actor,
            key,
            hash,
            contact,
            address,
            lines,
            shippingMethodId: input.shippingMethodId,
            payMethod,
            couponCodes,
            acceptedPolicyDocumentIds,
            requestMetadata: input.requestMetadata ?? null,
          });
        });
      } catch (error) {
        const { code, constraint } = pgErrorInfo(error);
        if (code === "23505" && constraint.includes("order_code") && attempt === 0) continue;
        if (code === "23505" && constraint.includes("idempotency")) {
          // Lost a race the advisory lock should have serialized (or a
          // same-key insert committed between our check and insert on an
          // older path): resolve honestly outside the rolled-back txn.
          return await this.resolveRace(key, actor, contact, hash);
        }
        if (code === "23505" && constraint.includes("order_code")) {
          throw new RetailDomainError("RETAIL_ORDER_CODE_COLLISION", "order code collision; retry with a new key");
        }
        throw error;
      }
    }
    throw new RetailDomainError("RETAIL_ORDER_CODE_COLLISION", "order code collision; retry with a new key");
  }

  private async resolveRace(
    key: string,
    actor: RetailActor,
    contact: { phone: string },
    hash: string,
  ): Promise<RetailOrderView> {
    const existing = await this.repo.findByIdempotencyKey(key);
    if (!existing) {
      throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "concurrent creation conflict; retry the read");
    }
    return this.presentReplay(undefined, existing, actor, contact, hash);
  }

  private async presentReplay(
    tx: any,
    existing: Record<string, any>,
    actor: RetailActor,
    contact: { phone: string },
    hash: string,
  ): Promise<RetailOrderView> {
    if (existing.creationRequestHash !== hash) {
      throw new RetailDomainError(
        "RETAIL_IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used with a different payload",
      );
    }
    const sameOwner = (existing.customerId ?? null) === (actor.userId ?? null);
    const sameGuestContact =
      existing.customerId === null && actor.userId === null && String(existing.phone) === contact.phone;
    if (!sameOwner || (actor.userId === null && !sameGuestContact)) {
      throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "Idempotency-Key belongs to another customer");
    }
    return this.presentOrder(tx, existing.id, true);
  }

  private async createInTx(
    tx: any,
    args: {
      actor: RetailActor;
      key: string;
      hash: string;
      contact: { name: string; phone: string; email: string | null };
      address: Record<string, string>;
      lines: RetailLineInput[];
      shippingMethodId: unknown;
      payMethod: string;
      couponCodes: string[];
      acceptedPolicyDocumentIds: string[];
      requestMetadata: { ip?: string | null; userAgent?: string | null; requestId?: string | null } | null;
    },
  ): Promise<RetailOrderView> {
    const { actor, key, hash, contact, address, lines, payMethod, couponCodes } = args;
    const orderId = makeOrderId();
    const orderCode = makeOrderCode();
    // Guest actor ref is order-scoped: per-order coupon caps for guests are
    // effectively unenforced in A (rate/cap policy is Checkpoint B/C work).
    const actorRef = actor.userId ?? `guest:${orderCode}`;

    const priced = await this.pricing.resolveCheckoutPricing({
      lines,
      shippingMethodId: args.shippingMethodId,
      freeShippingOverride: payMethod === "cod",
      executor: tx,
    });

    const evaluation = await this.promotions.evaluate({
      channel: "RETAIL",
      actor: { kind: "RETAIL_CUSTOMER", userId: actorRef },
      // Retail evaluation lines carry product-level selectors only: the 5.7
      // engine rejects variant/package selectors on retail lines. The
      // variant is already pinned in the pricing snapshot above.
      lines: priced.lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toString(),
      })),
      shippingBase: priced.shippingTotal.toString(),
      priceBasis: { kind: "SERVER_RESOLVED", resolvedBy: RETAIL_PRICING_RESOLVER, reference: priced.version },
      couponCodes,
    });
    // Fail-closed coherence: the engine must price exactly the base the
    // pricing authority resolved, and its totals must satisfy the ledger
    // equation the database will enforce.
    if (BigInt(evaluation.baseSubtotal) !== priced.itemsTotal) {
      throw new RetailDomainError("RETAIL_PROMOTION_BASE_MISMATCH", "promotion engine base differs from priced base");
    }
    const discountTotal = BigInt(evaluation.totalDiscount);
    const shippingTotal = evaluation.finalShipping !== null ? BigInt(evaluation.finalShipping) : priced.shippingTotal;
    const grandTotal = BigInt(evaluation.grandTotal);
    if (grandTotal !== priced.itemsTotal - discountTotal + shippingTotal) {
      throw new RetailDomainError("RETAIL_TOTALS_MISMATCH", "promotion engine totals do not balance");
    }
    if (grandTotal > MAX_MONEY) {
      throw new RetailDomainError("RETAIL_MONETARY_OVERFLOW", "order total exceeds the monetary ceiling");
    }
    const lineDiscountOf = (lineId: string): bigint => BigInt(evaluation.lineDiscounts[lineId] ?? "0");

    // Legal gate (in-process, same transaction): enforce-mode failure —
    // rejection, outage, malformed output — rolls the order back.
    let legalSnapshotId: string | null = null;
    const legalMode = retailLegalGateMode();
    if (legalMode === "enforce") {
      const bound = await this.compliance.bindRetailCheckout(
        {
          subject: actor.userId
            ? { userId: actor.userId }
            : { userId: null, phone: contact.phone, email: contact.email },
          acceptedPolicyDocumentIds: args.acceptedPolicyDocumentIds,
          facts: {
            orderRef: orderCode,
            currency: "IRR",
            lines: priced.lines.map((line) => ({
              ref: line.sku || line.productId,
              name: line.productName,
              quantity: line.quantity,
              unitPrice: line.unitPrice.toString(),
              lineTotal: (line.baseLineTotal - lineDiscountOf(line.lineId)).toString(),
            })),
            shipping: { method: priced.shippingMethod, label: priced.shippingMethod, price: shippingTotal.toString() },
            totals: {
              items: priced.itemsTotal.toString(),
              shipping: shippingTotal.toString(),
              grand: grandTotal.toString(),
            },
            paymentMethod: payMethod,
          },
          requestMetadata: args.requestMetadata,
        },
        tx,
      );
      legalSnapshotId = bound.snapshotId;
    }

    // KOLBE inventory only, reserved under a system principal: customers can
    // never mutate inventory directly (assertInventoryMutationAllowed).
    // userId is FK-safe (`inventory_reservation.created_by` references
    // account_user; "system" maps to NULL) — the guest order-scope ref is
    // only used for promotion actor attribution, never here.
    const sellerId = await this.offers.ensureSeller(null, "KOLBE");
    const requester = {
      userId: actor.userId ?? "system",
      role: "system",
      principalType: "system" as const,
      initiatedByUserId: actor.userId,
      operation: "retail.checkout",
    };
    for (const line of priced.lines) {
      let available = 0;
      try {
        const inv = await this.inventory.getVariantInventory(line.variantId, sellerId, requester, tx);
        available = inv.available as number;
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `line ${line.lineId}: no KOLBE stock record`);
        }
        throw error;
      }
      if (available < line.quantity) {
        throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `line ${line.lineId}: insufficient KOLBE stock`);
      }
      await this.inventory.reserveRetail({
        variantId: line.variantId,
        sellerId,
        quantity: line.quantity,
        allocationId: orderId,
        requester,
        reason: `retail checkout reserve -> ${orderCode}`,
        idempotencyKey: `${key}:inv:${line.lineId}`,
        expiresInMinutes: RETAIL_RESERVATION_TTL_MINUTES,
        executor: tx,
      });
    }

    const paymentStatus = payMethod === "cod" ? "pending_cod" : "unpaid";
    await this.repo.insertOrder(
      {
        id: orderId,
        orderCode,
        customerId: actor.userId,
        customerName: contact.name,
        phone: contact.phone,
        email: contact.email,
        lines: priced.lines.map((line) => ({
          id: line.productId,
          sku: line.sku,
          name: line.productName,
          colour: line.colour,
          size: line.size,
          img: line.imageUrl,
          price: Number(line.unitPrice),
          qty: line.quantity,
          lineTotal: Number(line.baseLineTotal - lineDiscountOf(line.lineId)),
        })),
        address,
        shippingMethod: priced.shippingMethod,
        shippingPrice: shippingTotal,
        payMethod,
        totalAmount: grandTotal,
        paymentStatus,
        fulfillmentStatus: "processing",
        itemsTotal: priced.itemsTotal,
        currency: "IRR",
        priceBookVersion: priced.version,
        paymentMethod: payMethod,
        amountSource: "server",
        orderStatus: "placed",
        idempotencyKey: key,
        promotionDiscountTotal: discountTotal,
        legalSnapshotId,
        creationRequestHash: hash,
        version: 0,
      },
      tx,
    );

    await this.repo.insertItems(
      priced.lines.map((line) => {
        const discount = lineDiscountOf(line.lineId);
        return {
          id: makeItemId(),
          orderId,
          productId: line.productId,
          variantId: line.variantId,
          sku: line.sku,
          productName: line.productName,
          colour: line.colour,
          size: line.size,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          baseLineTotal: line.baseLineTotal,
          promotionDiscount: discount,
          lineTotal: line.baseLineTotal - discount,
          imageUrl: line.imageUrl,
        };
      }),
      tx,
    );

    // Live redemption (closes the deferred 5.7 item): same transaction, so a
    // coupon failure voids the order and an order failure consumes nothing.
    for (const applied of evaluation.appliedPromotions) {
      const couponCode = applied.couponId ? (await this.coupons.getCoupon(applied.couponId)).code : null;
      await this.usage.recordRedemption(
        actorRef,
        {
          promotionId: applied.promotionId,
          revisionId: applied.revisionId,
          couponCode: couponCode ?? undefined,
          actorKind: "RETAIL_CUSTOMER",
          actorRef,
          baseAmount: applied.baseAmount,
          discountAmount: applied.discountAmount,
          orderReference: orderCode,
          idempotencyKey: `${key}:redeem:${applied.promotionId}`,
          evaluationVersion: evaluation.evaluationVersion,
          termsHash: evaluation.termsHash,
        },
        tx,
      );
    }

    await this.repo.insertEvent(
      {
        id: makeEventId(),
        orderId,
        fromStatus: null,
        toStatus: "placed",
        actorId: actor.userId,
        actorRole: actor.kind,
        reason: "checkout",
        metadata: {
          couponCodes,
          promotionIds: evaluation.appliedPromotions.map((row) => row.promotionId),
          pricingVersion: priced.version,
          evaluationVersion: evaluation.evaluationVersion,
          termsHash: evaluation.termsHash,
        },
        orderVersion: 0,
        idempotencyKey: key,
      },
      tx,
    );

    // Cross-aggregate creation fact. ORDER_ACTOR_ROLES is wholesale-shaped,
    // so the precise retail role stays in retail_order_event + payload.
    await this.repo.insertOrderEvent(
      {
        id: makeEventId(),
        aggregateType: "retail_order",
        aggregateId: orderId,
        eventType: "retail_order.created",
        payload: {
          order_code: orderCode,
          actor: { id: actor.userId, role: actor.kind },
          items_total: priced.itemsTotal.toString(),
          promotion_discount_total: discountTotal.toString(),
          shipping_total: shippingTotal.toString(),
          grand_total: grandTotal.toString(),
          pricing_version: priced.version,
        },
        actorId: actor.userId,
        actorRole: null,
        idempotencyKey: key,
      },
      tx,
    );

    await this.audit.record(
      {
        actorId: actor.userId ?? "guest",
        actorRole: actor.kind,
        action: "retail_order.created",
        entityType: "retail_order",
        entityId: orderId,
        after: {
          order_code: orderCode,
          items_total: priced.itemsTotal.toString(),
          promotion_discount_total: discountTotal.toString(),
          shipping_total: shippingTotal.toString(),
          grand_total: grandTotal.toString(),
          price_book_version: priced.version,
          lines: priced.lines.length,
          legal_gate: legalMode,
          legal_snapshot_id: legalSnapshotId,
        },
        metadata: { adjusted: priced.adjusted },
      },
      tx,
    );

    return this.presentOrder(tx, orderId, false);
  }

  async getRetailOrder(
    viewer: { userId: string; role: string },
    orderId: string,
  ): Promise<RetailOrderView> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    if (viewer.role !== "admin" && (order.customerId ?? null) !== viewer.userId) {
      throw new RetailDomainError("RETAIL_ORDER_FORBIDDEN", "this order belongs to another customer");
    }
    return this.presentOrder(undefined, order.id, false);
  }

  /**
   * Canonical status transition (service-level in A; the admin HTTP surface
   * is Checkpoint D). Forward-only per RETAIL_ORDER_TRANSITIONS, versioned,
   * and history-appended. Order state never implies payment/shipment state.
   */
  async transitionOrder(
    orderId: string,
    toStatus: unknown,
    actor: { actorId: string | null; actorRole: string; reason?: string },
  ): Promise<RetailOrderView> {
    const to = typeof toStatus === "string" ? toStatus : "";
    if (!(RETAIL_ORDER_STATUSES as readonly string[]).includes(to)) {
      throw new RetailDomainError("RETAIL_TRANSITION_INVALID", "unknown retail order status");
    }
    return this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      const allowed = (RETAIL_ORDER_TRANSITIONS as Record<string, readonly string[]>)[order.orderStatus] ?? [];
      if (!allowed.includes(to)) {
        throw new RetailDomainError(
          "RETAIL_TRANSITION_INVALID",
          `transition ${order.orderStatus} -> ${to} is not allowed`,
        );
      }
      const updated = await this.repo.updateStatus(orderId, to, tx);
      await this.repo.insertEvent(
        {
          id: makeEventId(),
          orderId,
          fromStatus: order.orderStatus,
          toStatus: to,
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          reason: actor.reason ?? null,
          metadata: {},
          orderVersion: (updated?.version ?? order.version) as number,
          idempotencyKey: null,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_order.status_changed",
          entityType: "retail_order",
          entityId: orderId,
          before: { status: order.orderStatus },
          after: { status: to },
        },
        tx,
      );
      return this.presentOrder(tx, orderId, false);
    });
  }

  private async presentOrder(tx: any, orderId: string, replayed: boolean): Promise<RetailOrderView> {
    const order = await this.repo.findById(orderId, tx);
    if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    const items = await this.repo.findItemsByOrderId(orderId, tx);
    const events = await this.repo.findEventsByOrderId(orderId, tx);
    const created = events.find((event: any) => event.orderVersion === 0);
    const money = (value: bigint | string | number): string => BigInt(value).toString();
    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.orderStatus,
      replayed,
      currency: order.currency,
      customer: { name: order.customerName, phone: order.phone, email: order.email ?? null },
      address: (order.address ?? {}) as Record<string, string>,
      totals: {
        itemsTotal: money(order.itemsTotal),
        promotionDiscountTotal: money(order.promotionDiscountTotal),
        shippingTotal: money(order.shippingPrice),
        grandTotal: money(order.totalAmount),
      },
      lines: items.map((item: any) => ({
        productId: item.productId,
        variantId: item.variantId ?? null,
        sku: item.sku,
        productName: item.productName,
        colour: item.colour ?? null,
        size: item.size ?? null,
        imageUrl: item.imageUrl ?? null,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        baseLineTotal: money(item.baseLineTotal),
        promotionDiscount: money(item.promotionDiscount),
        lineTotal: money(item.lineTotal),
      })),
      payment: {
        method: order.payMethod,
        status: order.paymentStatus,
        collected: false,
        requiresManualSettlement: order.payMethod !== "cod",
      },
      legal: {
        mode: order.legalSnapshotId ? "enforce" : "off",
        snapshotId: order.legalSnapshotId ?? null,
      },
      priceVersion: order.priceBookVersion ?? null,
      promotionTermsHash: (created?.metadata as any)?.termsHash ?? null,
      history: events.map((event: any) => ({
        fromStatus: event.fromStatus ?? null,
        toStatus: event.toStatus,
        actorRole: event.actorRole ?? null,
        reason: event.reason ?? null,
        orderVersion: event.orderVersion,
        createdAt: new Date(event.createdAt).toISOString(),
      })),
      createdAt: new Date(order.createdAt).toISOString(),
    };
  }
}
