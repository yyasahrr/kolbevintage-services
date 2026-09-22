import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { RETAIL_PAYMENT_METHODS } from "@kolbe/database";
import { MAX_MONEY, NotFoundError, RETAIL_ORDER_STATUSES, RETAIL_ORDER_TRANSITIONS, RETAIL_SHIPPING_RULES } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";
import { AuditService } from "../../audit/audit.service";
import { CatalogDomainError } from "../../catalog/catalog.logic";
import { ComplianceService } from "../../compliance/compliance.service";
import { InventoryService } from "../../inventory/inventory.service";
import { OffersService } from "../../offers/offers.service";
import { PaymentProviderEventService } from "../../payments/payment-provider-event.service";
import { PaymentProviderRegistry } from "../../payments/payment-provider.registry";
import { FinanceDomainError, PaymentsService } from "../../payments/payments.service";
import { RetailPricingService } from "../../pricing/retail-pricing.service";
import { ShippingProviderRegistry } from "../../shipping/shipping-provider.registry";
import { ShippingDomainError, ShippingService } from "../../shipping/shipping.service";
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

// Checkpoint D hardening: free-text DISPLAY fields (contact name, address
// lines) are persisted and re-rendered by admin UIs, exports, and future
// notification channels, so angle brackets are stripped at the trust
// boundary. Identifiers keep strict `text()` — sanitizing them could
// collapse an attack string onto a real id.
function displayText(value: unknown, maxLength: number): string {
  return text(value, maxLength).replace(/[<>]/g, "");
}

/**
 * Phase 5.9-A — guest order capability. Opaque high-entropy token
 * (`rgc_` + 128 bits); only the SHA-256 hash rests in `retail_order`.
 * The plaintext crosses the wire exactly once (creation response) and is
 * verified constant-time. `orderCode + phone` alone authenticates nothing.
 */
const GUEST_CAPABILITY_PREFIX = "rgc";
function mintRetailGuestCapability(): { token: string; hash: string } {
  const token = `${GUEST_CAPABILITY_PREFIX}_${randomBytes(16).toString("base64url")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}
function retailGuestCapabilityMatches(presented: unknown, storedHash: string | null): boolean {
  if (typeof presented !== "string" || presented.length === 0 || !storedHash) return false;
  const candidate = Buffer.from(createHash("sha256").update(presented).digest("hex"));
  const expected = Buffer.from(storedHash);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Opaque history cursor: base64url(JSON([createdAtISO, id])). Fails closed. */
function encodeRetailHistoryCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
}
function decodeRetailHistoryCursor(cursor: unknown): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      Number.isFinite(Date.parse(parsed[0])) &&
      parsed[1].length > 0
    ) {
      return [new Date(parsed[0]).toISOString(), parsed[1]];
    }
  } catch {
    // fall through to the domain error below
  }
  throw new RetailDomainError("RETAIL_CUSTOMER_CURSOR_INVALID", "history cursor is malformed");
}

function parseContact(input: unknown): ParsedContact {
  const record = (input ?? {}) as Record<string, unknown>;
  const name = displayText(record.name, 160);
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
  const field = (key: string, maxLength: number) => displayText(record[key], maxLength);
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

/** Carrier/operator state -> `shipment_event.event_type` (wholesale mapping, verbatim values). */
function retailTrackingEventType(state: string): string {
  switch (state) {
    case "created":
      return "shipment.created";
    case "in_transit":
      return "shipment.in_transit";
    case "delivered":
      return "shipment.delivered";
    case "failed":
      return "shipment.failed";
    case "cancelled":
      return "shipment.cancelled";
    default:
      return "unknown";
  }
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

function makeShipmentId(): string {
  return `rshp_${randomUUID().replaceAll("-", "")}`;
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
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PaymentProviderRegistry) private readonly providerRegistry: PaymentProviderRegistry,
    @Inject(PaymentProviderEventService) private readonly providerEvents: PaymentProviderEventService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(ShippingProviderRegistry) private readonly shippingProviders: ShippingProviderRegistry,
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
          const created = await this.createInTx(tx, {
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
          if (!created.guestCapability) return created.view;
          return { ...created.view, guestCapability: created.guestCapability };
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
  ): Promise<{ view: RetailOrderView; guestCapability: string | null }> {
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
      // Checkpoint D hardening: the pre-flight above and this reserve are
      // not atomic — a racing checkout can claim the last units between
      // them. Map the reserve shortfall to the same retail code so the loser
      // always fails 409, never 500.
      try {
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
      } catch (error) {
        if (error instanceof CatalogDomainError && (error as any).code === "INSUFFICIENT_AVAILABLE") {
          throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `line ${line.lineId}: insufficient KOLBE stock`);
        }
        throw error;
      }
    }

    const paymentStatus = payMethod === "cod" ? "pending_cod" : "unpaid";
    // Phase 5.9-A: guest orders leave with a capability token. The plaintext
    // is returned once (below); only the hash is persisted.
    const guestCapability = actor.kind === "guest" ? mintRetailGuestCapability() : null;
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
        guestCapabilityHash: guestCapability?.hash ?? null,
        guestCapabilityIssuedAt: guestCapability ? new Date() : null,
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
          guest_capability_issued: guestCapability !== null,
        },
        metadata: { adjusted: priced.adjusted },
      },
      tx,
    );

    return { view: await this.presentOrder(tx, orderId, false), guestCapability: guestCapability?.token ?? null };
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
   * Phase 5.9-A — customer order history page (own orders only; the
   * caller scopes by session user id). Keyset cursor, stable
   * newest-first order, BIGINT money as strings.
   */
  async listCustomerRetailOrders(
    userId: string,
    input: { limit?: unknown; cursor?: unknown },
  ): Promise<{ orders: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? input.limit : 20;
    if (limit < 1 || limit > 100) {
      throw new RetailDomainError("RETAIL_CUSTOMER_LIMIT_INVALID", "history limit must be between 1 and 100");
    }
    const cursor = input.cursor === undefined || input.cursor === null ? null : decodeRetailHistoryCursor(input.cursor);
    const rows = await this.repo.listByCustomerId(userId, limit, cursor);
    const page = (rows as any[]).slice(0, limit);
    const last = page[page.length - 1] as any;
    return {
      orders: page.map((row: any) => ({
        id: row.id,
        orderCode: row.orderCode,
        status: row.orderStatus,
        paymentStatus: row.paymentStatus,
        payMethod: row.payMethod,
        grandTotal: BigInt(row.totalAmount).toString(),
        currency: row.currency,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      nextCursor: (rows as any[]).length > limit && last ? encodeRetailHistoryCursor(new Date(last.createdAt).toISOString(), last.id) : null,
    };
  }

  /**
   * Phase 5.9-A — guest order resolution + detail. The order code locates
   * the order; ONLY the capability secret authenticates. Legacy orders
   * (no hash) resolve to an honest recovery error, never a fabricated
   * secret. Returns the owner-equivalent detail (the guest IS the orderer).
   */
  async getRetailOrderAsGuest(
    orderCode: string,
    presentedToken: unknown,
  ): Promise<{
    orderId: string;
    orderCode: string;
    order: RetailOrderView;
    shipping: { orderId: string; orderCode: string; shipments: Array<Record<string, unknown>> };
  }> {
    const code = typeof orderCode === "string" ? orderCode.trim().slice(0, 64) : "";
    if (!code) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    const order = await this.repo.findByOrderCode(code);
    if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    if ((order as any).guestCapabilityRevokedAt) {
      throw new RetailDomainError("RETAIL_GUEST_CAPABILITY_REVOKED", "this order's guest access was revoked; contact support");
    }
    if (!(order as any).guestCapabilityHash) {
      throw new RetailDomainError(
        "RETAIL_GUEST_CAPABILITY_REQUIRED",
        "this order predates guest capabilities and has no access secret; contact support for manual recovery",
      );
    }
    if (!retailGuestCapabilityMatches(presentedToken, (order as any).guestCapabilityHash)) {
      throw new RetailDomainError("RETAIL_GUEST_CAPABILITY_INVALID", "guest capability token is invalid");
    }
    const view = await this.presentOrder(undefined, (order as any).id, false);
    const shipping = await this.presentRetailShipments(order as any);
    return { orderId: (order as any).id, orderCode: (order as any).orderCode, order: view, shipping };
  }

  /**
   * Phase 5.9-A — revoke a guest capability (staff seam; clears the hash,
   * keeps `revoked_at` for audit). No HTTP surface in this phase.
   */
  async revokeRetailGuestCapability(orderId: string, actor: { actorId: string | null; actorRole: string }): Promise<{ revoked: boolean }> {
    this.assertStaff(actor);
    return this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      if (!(order as any).guestCapabilityHash) return { revoked: false };
      await this.repo.updateGuestCapability(orderId, { hash: null, revokedAt: new Date() }, tx);
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_order.guest_capability_revoked",
          entityType: "retail_order",
          entityId: orderId,
        },
        tx,
      );
      return { revoked: true };
    });
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
    executor?: any,
  ): Promise<RetailOrderView> {
    const to = typeof toStatus === "string" ? toStatus : "";
    if (!(RETAIL_ORDER_STATUSES as readonly string[]).includes(to)) {
      throw new RetailDomainError("RETAIL_TRANSITION_INVALID", "unknown retail order status");
    }
    const run = async (tx: any) => {
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
    };
    if (executor) return run(executor);
    return this.db.transaction(async (tx) => run(tx));
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
        collected: order.paymentStatus === "paid",
        requiresManualSettlement: order.paymentStatus !== "paid" && order.payMethod !== "cod",
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

  // ── Checkpoint B: payment orchestration + inventory lifecycle (service-level;
  // Checkpoint D owns the HTTP surface). All multi-write flows are atomic: a
  // stock shortfall or payability failure rolls the payment row back too.

  /** Payable = a live order that is not already paid. */
  private assertPayable(order: { orderStatus: string; paymentStatus: string }) {
    if (order.orderStatus === "cancelled" || order.orderStatus === "returned") {
      throw new RetailDomainError("RETAIL_ORDER_NOT_PAYABLE", `order in status ${order.orderStatus} cannot take payment`);
    }
    if (order.paymentStatus === "paid") {
      throw new RetailDomainError("RETAIL_ALREADY_PAID", "order is already paid");
    }
  }

  private systemRequester() {
    return { userId: "system", role: "system", principalType: "system" as const };
  }

  /**
   * Payment actions are owner-checked: a customer/vip actor must own the
   * order. Staff/system bypass. Guests carry no identity, so guest orders
   * cannot be driven here — Checkpoint D defines guest payment capability
   * on the HTTP surface instead of guessing at this layer.
   */
  private assertOrderOwner(order: { customerId: string | null }, actor: { actorId: string | null; actorRole: string }) {
    if (actor.actorRole === "customer" || actor.actorRole === "vip") {
      if (!actor.actorId || !order.customerId || actor.actorId !== order.customerId) {
        throw new RetailDomainError("RETAIL_ORDER_FORBIDDEN", "this order belongs to another customer");
      }
      return;
    }
    if (actor.actorRole === "admin" || actor.actorRole === "finance" || actor.actorRole === "system") return;
    throw new RetailDomainError("RETAIL_ORDER_FORBIDDEN", `role ${actor.actorRole} cannot drive retail payment actions`);
  }

  /**
   * Gateway online intent (TxA row + lock-free provider call + TxB persist).
   * Only `gateway` orders take this path; cash-on-delivery and manual flows
   * submit evidence instead.
   */
  async createPaymentIntent(
    orderId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { idempotencyKey: string; providerName?: string; callbackUrl?: string },
  ): Promise<{ payment: any; replayed: boolean }> {
    const created = await this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      this.assertPayable(order);
      this.assertOrderOwner(order, actor);
      if (order.payMethod !== "gateway") {
        throw new RetailDomainError("RETAIL_INTENT_METHOD_UNSUPPORTED", `online intent is not supported for ${order.payMethod}`);
      }
      const existing = await this.payments.listRetailPayments(orderId, tx);
      if (existing.some((row: any) => row.status === "verified")) {
        throw new RetailDomainError("RETAIL_ALREADY_PAID", "order already has a verified payment");
      }
      return this.payments.createRetailPaymentIntentRow(
        {
          retailOrderId: orderId,
          buyerUserId: order.customerId ?? null,
          amount: BigInt(order.totalAmount).toString(),
          currency: order.currency ?? "IRR",
          providerName: input.providerName,
          idempotencyKey: input.idempotencyKey,
          callbackUrl: input.callbackUrl,
          actorRole: actor.actorRole,
          executor: tx,
        },
      );
    });
    if (created.replayed && created.payment?.providerReference) return { payment: created.payment, replayed: true };
    const payment = await this.payments.executeRetailProviderIntent({
      paymentId: created.payment.id,
      buyerUserId: created.payment.submitted_by ?? null,
      idempotencyKey: input.idempotencyKey,
      callbackUrl: input.callbackUrl,
    });
    return { payment, replayed: created.replayed };
  }

  /** Manual evidence: transfer/bank reference, or the collection reference for cash-on-delivery. */
  async submitPaymentEvidence(
    orderId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { rail: string; amount: string; evidenceReference: string; bankReference?: string; idempotencyKey: string },
  ): Promise<{ payment: any; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      this.assertPayable(order);
      this.assertOrderOwner(order, actor);
      // Rail honesty without naming every retail method: cash-on-delivery
      // orders evidence on the cod rail, everything else on manual_transfer.
      const expectedRail = order.payMethod === "cod" ? "cod" : "manual_transfer";
      if (input.rail !== expectedRail) {
        throw new RetailDomainError("RETAIL_EVIDENCE_RAIL_MISMATCH", `rail ${input.rail} does not match pay method ${order.payMethod}`);
      }
      let claimed: bigint;
      try {
        claimed = BigInt(input.amount);
      } catch {
        throw new RetailDomainError("RETAIL_AMOUNT_MISMATCH", "evidence amount must be a decimal string");
      }
      if (claimed !== BigInt(order.totalAmount)) {
        throw new RetailDomainError("RETAIL_AMOUNT_MISMATCH", "evidence amount must equal the order total exactly (no partial payments)");
      }
      const existing = await this.payments.listRetailPayments(orderId, tx);
      if (existing.some((row: any) => row.status === "verified")) {
        throw new RetailDomainError("RETAIL_ALREADY_PAID", "order already has a verified payment");
      }
      return this.payments.submitRetailPaymentEvidenceRow({
        retailOrderId: orderId,
        buyerUserId: order.customerId ?? null,
        amount: claimed.toString(),
        currency: order.currency ?? "IRR",
        rail: input.rail,
        evidenceReference: input.evidenceReference,
        bankReference: input.bankReference,
        idempotencyKey: input.idempotencyKey,
        actorRole: actor.actorRole,
        executor: tx,
      });
    });
  }

  /**
   * Verify a retail payment: row verification + paid marking + sibling
   * hygiene + stock confirmation + paid fact, atomically. A stock shortfall
   * fails the whole verification (payment row included) — fail closed.
   */
  async verifyPayment(
    paymentId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { externalReference: string; idempotencyKey: string; expectedVersion?: number; reason?: string },
  ): Promise<{ view: RetailOrderView; payment: any; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const { payment, replayed } = await this.payments.verifyRetailPaymentRow({
        paymentId,
        adminUserId: actor.actorId,
        externalReference: input.externalReference,
        idempotencyKey: input.idempotencyKey,
        actorRole: actor.actorRole,
        reason: input.reason,
        expectedVersion: input.expectedVersion,
        executor: tx,
      });
      const orderId = (payment as any).retail_order_id ?? (payment as any).retailOrderId;
      if (replayed) {
        return { view: await this.presentOrder(tx, orderId, false), payment, replayed: true };
      }
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      this.assertPayable(order);
      if (BigInt((payment as any).amount) !== BigInt(order.totalAmount)) {
        throw new RetailDomainError("RETAIL_AMOUNT_MISMATCH", "verified amount does not equal the order total");
      }
      await this.repo.markPaid(orderId, tx);
      await this.payments.cancelPendingRetailPayments({ retailOrderId: orderId, exceptPaymentId: paymentId, actorId: actor.actorId, executor: tx });
      await this.confirmRetailStock(orderId, paymentId, tx);
      await this.repo.insertOrderEvent(
        {
          id: makeEventId(),
          aggregateType: "retail_order",
          aggregateId: orderId,
          eventType: "retail_order.paid",
          payload: {
            order_code: order.orderCode,
            payment_id: paymentId,
            amount: BigInt(order.totalAmount).toString(),
            currency: order.currency ?? "IRR",
            method: order.payMethod,
          },
          actorId: actor.actorId,
          actorRole: null,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_order.paid",
          entityType: "retail_order",
          entityId: orderId,
          before: { payment_status: order.paymentStatus },
          after: { payment_status: "paid", payment_id: paymentId },
        },
        tx,
      );
      return { view: await this.presentOrder(tx, orderId, false), payment, replayed: false };
    });
  }

  /** Confirm one order's KOLBE stock, re-reserving lines whose hold lapsed (expiry reaps the hold, never the order). */
  private async confirmRetailStock(orderId: string, paymentId: string, tx: any) {
    const sellerId = await this.offers.ensureSeller(null, "KOLBE");
    const requester = this.systemRequester();
    const items = await this.repo.findItemsByOrderId(orderId, tx);
    const active = await this.inventory.listActiveReservationsByAllocation(orderId, tx);
    for (const item of items) {
      const held = active.find((row: any) => row.variantId === item.variantId);
      let reservationId = held?.id as string | undefined;
      if (!reservationId) {
        const inv = await this.inventory.getVariantInventory(item.variantId, sellerId, requester, tx);
        const available = (inv?.available as number) ?? 0;
        if (available < item.quantity) {
          throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `line ${item.id}: insufficient KOLBE stock to confirm`);
        }
        const created = await this.inventory.reserveRetail({
          variantId: item.variantId,
          sellerId,
          quantity: item.quantity,
          allocationId: orderId,
          requester,
          reason: `retail verify re-reserve -> ${orderId}`,
          idempotencyKey: `${paymentId}:verify:${item.variantId}`,
          expiresInMinutes: RETAIL_RESERVATION_TTL_MINUTES,
          executor: tx,
        });
        reservationId = (created as any)?.id;
        if (!reservationId) throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `line ${item.id}: re-reserve failed`);
      }
      await this.inventory.confirmRetail({
        reservationId,
        requester,
        reason: `retail verify confirm -> ${orderId}`,
        idempotencyKey: `${paymentId}:confirm:${item.variantId}`,
        executor: tx,
      });
    }
  }

  /**
   * Retail provider callback (B10): inbox-first, server-to-server truth.
   *
   * Reuses the wholesale provider-event machinery: the adapter authenticates
   * and normalizes (`parseWebhook`, pure), the inbox dedupes on
   * (provider, external_event_id), and an atomic claim decides the single
   * processor. The event is only a TRIGGER — `queryStatus` over the
   * provider channel is the truth, so a forged or stale event payload can
   * never mark an order paid, and a success event for a failed payment (or
   * vice versa) is a conflict rejection, never a rewrite. Outcomes:
   * `paid` (routed through the atomic `verifyPayment`), `failed` (row
   * failed, order and stock untouched), `pending` (claim released for a
   * later redelivery, nothing mutated), `replayed` (terminal inbox state),
   * `inflight` (another delivery holds the claim). Service-level; the HTTP
   * webhook route is Checkpoint D.
   */
  async handleRetailProviderCallback(
    providerName: string,
    raw: { headers: Record<string, string | string[] | undefined>; body: unknown },
  ): Promise<{
    outcome: "paid" | "failed" | "pending" | "replayed" | "inflight";
    view?: RetailOrderView;
    paymentId?: string | null;
    inboxEventId: string;
    replayed: boolean;
  }> {
    const provider = this.providerRegistry.resolve(providerName);
    if (!provider.supportsWebhooks) {
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", `provider ${provider.name} has no server-to-server callback channel`);
    }
    const normalized = provider.parseWebhook({ headers: raw.headers, body: raw.body });

    const recorded = await this.providerEvents.recordEvent({
      provider: provider.name,
      externalEventId: normalized.externalEventId,
      externalPaymentReference: normalized.providerReference,
      eventType: normalized.eventType,
      safeMetadata: normalized.safeMetadata,
    });
    const inboxEventId = recorded.id as string;
    const claimed = await this.providerEvents.claim(inboxEventId);
    if (!claimed) {
      const current = await this.providerEvents.getEventById(inboxEventId);
      const status = (current as any)?.status as string | undefined;
      if (status === "processed" || status === "ignored" || status === "failed") {
        return { outcome: "replayed", inboxEventId, replayed: true };
      }
      return { outcome: "inflight", inboxEventId, replayed: true };
    }

    if (!normalized.authenticated) {
      await this.providerEvents.markIgnored(inboxEventId, normalized.rejectionReason || "webhook authentication failed");
      throw new RetailDomainError("RETAIL_WEBHOOK_UNAUTHENTICATED", "provider webhook signature is invalid");
    }
    if (!normalized.providerReference) {
      await this.providerEvents.markFailed(inboxEventId, "missing provider reference");
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "webhook carries no provider reference");
    }
    const payment = await this.payments.findRetailPaymentByProviderRef({ provider: provider.name, providerReference: normalized.providerReference });
    if (!payment) {
      await this.providerEvents.markFailed(inboxEventId, "unknown provider reference");
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "no retail payment matches this provider reference");
    }
    const terminal = payment.status === "verified" || payment.status === "failed" || payment.status === "cancelled";
    const eventSaysFailure = normalized.eventType === "payment.failed" || normalized.eventType === "payment.cancelled";
    if (terminal) {
      const agrees = (payment.status === "verified" && !eventSaysFailure) || (payment.status !== "verified" && eventSaysFailure);
      if (!agrees) {
        await this.providerEvents.markFailed(inboxEventId, `terminal conflict: payment ${payment.status}, event ${normalized.eventType}`);
        throw new RetailDomainError(
          "RETAIL_PROVIDER_EVENT_REJECTED",
          `provider event ${normalized.eventType} conflicts with terminal payment ${payment.status}`,
        );
      }
      await this.providerEvents.markProcessed(inboxEventId);
      if (payment.status === "verified") {
        const view = await this.presentOrder(this.db, payment.retailOrderId, false);
        return { outcome: "paid", view, paymentId: payment.id, inboxEventId, replayed: true };
      }
      return { outcome: "failed", paymentId: payment.id, inboxEventId, replayed: true };
    }

    let query: any;
    try {
      query = await provider.queryStatus({ paymentId: payment.id, providerReference: normalized.providerReference });
    } catch (error: any) {
      await this.providerEvents.releaseToReceived(inboxEventId);
      throw new FinanceDomainError("PROVIDER_ERROR", `Provider ${provider.name} status query failed: ${error?.message || "provider error"}`, 502);
    }
    const state = String(query?.state || query?.status || "").toLowerCase();
    if (state === "pending") {
      await this.providerEvents.releaseToReceived(inboxEventId);
      return { outcome: "pending", paymentId: payment.id, inboxEventId, replayed: false };
    }
    if (state === "failed") {
      await this.payments.failRetailPaymentRow({
        paymentId: payment.id,
        reason: `provider ${normalized.eventType}: ${provider.name} reports failure`,
        actorRole: "system",
      });
      await this.providerEvents.markProcessed(inboxEventId);
      return { outcome: "failed", paymentId: payment.id, inboxEventId, replayed: false };
    }
    if (state !== "success") {
      await this.providerEvents.markFailed(inboxEventId, `provider reports ${state || "unknown"} for a claimed reference`);
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", `provider cannot confirm this payment (${state || "unknown"})`);
    }
    if (query.amount === undefined || query.amount === null) {
      await this.providerEvents.markFailed(inboxEventId, "provider confirmed without an amount");
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "provider confirmation carries no amount");
    }
    if (BigInt(query.amount) !== BigInt(payment.amount)) {
      await this.providerEvents.markFailed(inboxEventId, "provider captured amount differs from the payment row");
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "provider amount does not match the payment amount");
    }
    if (String(query.currency) !== String(payment.currency)) {
      await this.providerEvents.markFailed(inboxEventId, "provider currency differs from the payment row");
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "provider currency does not match the payment currency");
    }
    try {
      const { view } = await this.verifyPayment(
        payment.id,
        { actorId: null, actorRole: "system" },
        { externalReference: normalized.providerReference, idempotencyKey: `cb:${inboxEventId}` },
      );
      await this.providerEvents.markProcessed(inboxEventId);
      return { outcome: "paid", view, paymentId: payment.id, inboxEventId, replayed: false };
    } catch (error: any) {
      // A cancelled/insolvent order racing a captured payment is operator
      // work (refund lives in 5.9): record the event failure, then surface
      // the orchestration error instead of swallowing it.
      if (error?.code !== "RETAIL_PROVIDER_EVENT_REJECTED") {
        await this.providerEvents.markFailed(inboxEventId, `orchestration refused: ${error?.code || error?.message || "unknown"}`);
      }
      throw error;
    }
  }

  /**
   * Cancel an unpaid order: status transition + shipment coordination + hold
   * release + cancelled fact, atomically. Paid orders are rejected — money
   * movement needs the future refund flow, and a silent release would strand
   * a paid customer. Shipments still in the warehouse (pending/ready) are
   * cancelled with the order; freight already handed to the carrier
   * (handed_over/in_transit/delivered) refuses the cancel instead — the
   * goods are physically gone and recovery is operator/refund work. Packed
   * orders with no live shipment stay cancellable: the frozen machine
   * permits packed -> cancelled, and nothing has left the building.
   */
  async cancelRetailOrder(
    orderId: string,
    actor: { actorId: string | null; actorRole: string; reason?: string },
  ): Promise<RetailOrderView> {
    return this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      // Checkpoint D hardening: cancel mutates commerce, so it is
      // owner-or-staff like every other retail action (guests carry no
      // identity; guest-order capability is a 5.9 HTTP decision).
      this.assertOrderOwner(order, actor);
      if (order.paymentStatus === "paid") {
        throw new RetailDomainError("RETAIL_CANCEL_PAID_FORBIDDEN", "paid orders cannot be cancelled without a refund");
      }
      const shipments = await this.shipping.listRetailShipments(orderId, tx);
      const inFlight = (shipments as any[]).filter((row) => ["handed_over", "in_transit", "delivered"].includes(row.status));
      if (inFlight.length > 0) {
        throw new RetailDomainError(
          "RETAIL_CANCEL_SHIPMENT_IN_PROGRESS",
          `shipment ${inFlight[0].shipmentCode} is already ${inFlight[0].status}; cancel is refused once freight leaves the warehouse`,
        );
      }
      await this.transitionOrder(orderId, "cancelled", actor, tx);
      const requester = this.systemRequester();
      // COD confirms the shipped slice at shipment time; cancelling a
      // warehouse-held parcel puts those units back on the shelf (prepaid
      // cancels never reach here — paid orders are refused above).
      const kolbeSellerId = await this.offers.ensureSeller(null, "KOLBE");
      for (const row of shipments as any[]) {
        if (row.status === "pending" || row.status === "ready") {
          await this.shipping.transitionRetailShipment({
            shipmentId: row.id,
            from: row.status,
            to: "cancelled",
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            reason: actor.reason ?? "order_cancelled",
            executor: tx,
          });
          const full = await this.shipping.getRetailShipmentById(row.id, tx);
          for (const item of full.items as any[]) {
            if (!item.variantId) {
              throw new RetailDomainError("RETAIL_VARIANT_MISMATCH", `shipped line ${item.retailOrderItemId} has no variant to restock`);
            }
            await this.inventory.upsertVariantInventory({
              variantId: item.variantId,
              sellerId: kolbeSellerId,
              onHandDelta: item.pieceQuantity,
              reason: `retail cancel restock -> ${orderId}`,
              requester,
              idempotencyKey: `${orderId}:cancel:restock:${item.id}`,
              executor: tx,
            });
          }
        }
      }
      const active = await this.inventory.listActiveReservationsByAllocation(orderId, tx);
      for (const reservation of active) {
        await this.inventory.releaseRetail({
          reservationId: reservation.id,
          requester,
          reason: actor.reason ?? `retail cancel release -> ${orderId}`,
          idempotencyKey: `${orderId}:cancel:${reservation.id}`,
          executor: tx,
        });
      }
      await this.repo.insertOrderEvent(
        {
          id: makeEventId(),
          aggregateType: "retail_order",
          aggregateId: orderId,
          eventType: "retail_order.cancelled",
          payload: { order_code: order.orderCode, reason: actor.reason ?? null },
          actorId: actor.actorId,
          actorRole: null,
          idempotencyKey: null,
        },
        tx,
      );
      return this.presentOrder(tx, orderId, false);
    });
  }

  // ── Checkpoint C: fulfillment lifecycle + shipment orchestration
  // (service-level; Checkpoint D owns the operator HTTP surface). Retail is
  // the orchestrator: it owns the retail order rows, the fulfillment gates
  // and the cross-aggregate facts, while ShippingService owns the shipment
  // rows under the retail transition table. Shipping never writes retail
  // tables — the delivery fan-out below goes through `transitionOrder`, so
  // every order move keeps its history row, and that row is the proof.

  /**
   * Fulfillment acts are staff-only: customers pay, operators ship. Guests
   * carry no identity and buyers never drive warehouse acts.
   */
  private assertStaff(actor: { actorId: string | null; actorRole: string }) {
    if (actor.actorRole === "admin" || actor.actorRole === "system") return;
    throw new RetailDomainError("RETAIL_ORDER_FORBIDDEN", `role ${actor.actorRole} cannot drive retail fulfillment actions`);
  }

  /**
   * Server-side retail shipping quote from the shared rules table — the same
   * table checkout priced from, re-resolved at shipment time for the snapshot
   * (the ORDER totals never move: they are immutable history). Pure: no DB.
   */
  resolveRetailQuote(
    methodId: unknown,
    itemsTotal: bigint,
    freeShippingOverride: boolean,
  ): { version: string; method: string; amount: bigint; currency: string; freeApplied: boolean } {
    const method = text(methodId, 32);
    const priced = (RETAIL_SHIPPING_RULES.methods as Record<string, bigint>)[method];
    if (priced === undefined) {
      throw new RetailDomainError("RETAIL_SHIPPING_METHOD_INVALID", "unknown shipping method");
    }
    const freeApplied = freeShippingOverride || itemsTotal >= RETAIL_SHIPPING_RULES.freeThreshold;
    return {
      version: RETAIL_SHIPPING_RULES.version,
      method,
      amount: freeApplied ? 0n : priced,
      currency: "IRR",
      freeApplied,
    };
  }

  /** Payable-or-COD: prepaid needs a verified payment, COD ships on promise (collection happens at delivery). */
  private assertFulfillmentReady(order: { paymentStatus: string; payMethod: string }) {
    if (order.paymentStatus === "paid") return;
    if (order.payMethod === "cod" && order.paymentStatus === "pending_cod") return;
    throw new RetailDomainError(
      "RETAIL_FULFILLMENT_NOT_READY",
      `order cannot ship with payment ${order.paymentStatus} on ${order.payMethod} (only paid or cash-on-delivery)`,
    );
  }

  private assertShippableStatus(order: { orderStatus: string }) {
    // confirmed/packed cover the first parcel; shipped covers late/partial
    // parcels while earlier freight is in transit. A delivered order is
    // terminal (delivery implies every line fully shipped) and cancelled/
    // returned/placed orders are never shippable.
    if (order.orderStatus === "confirmed" || order.orderStatus === "packed" || order.orderStatus === "shipped") return;
    throw new RetailDomainError(
      "RETAIL_SHIPMENT_NOT_READY",
      `order in status ${order.orderStatus} cannot take a shipment (confirm, then pack)`,
    );
  }

  /**
   * Confirm a payable order for fulfillment: placed -> confirmed + durable
   * fact. The fact (not the status alone) is what the relay notifies on.
   */
  async confirmRetailOrder(
    orderId: string,
    actor: { actorId: string | null; actorRole: string },
  ): Promise<RetailOrderView> {
    this.assertStaff(actor);
    return this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      this.assertFulfillmentReady(order);
      await this.transitionOrder(orderId, "confirmed", { actorId: actor.actorId, actorRole: actor.actorRole, reason: "fulfillment_confirmed" }, tx);
      await this.repo.insertOrderEvent(
        {
          id: makeEventId(),
          aggregateType: "retail_order",
          aggregateId: orderId,
          eventType: "retail_order.confirmed",
          payload: { order_code: order.orderCode, pay_method: order.payMethod, payment_status: order.paymentStatus },
          actorId: actor.actorId,
          actorRole: null,
          idempotencyKey: null,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_order.confirmed",
          entityType: "retail_order",
          entityId: orderId,
          before: { status: order.orderStatus },
          after: { status: "confirmed" },
        },
        tx,
      );
      return this.presentOrder(tx, orderId, false);
    });
  }

  /** Pack a confirmed order: confirmed -> packed. No relay fact — packing is warehouse-internal until a shipment exists. */
  async packRetailOrder(
    orderId: string,
    actor: { actorId: string | null; actorRole: string },
  ): Promise<RetailOrderView> {
    this.assertStaff(actor);
    return this.transitionOrder(orderId, "packed", {
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      reason: "warehouse_packed",
    });
  }

  /**
   * Shipment item plan: full-remaining when the caller passes no lines
   * (the common case), else a validated partial. Lines must belong to the
   * order and cumulative shipped quantities can never exceed ordered ones —
   * shortfalls fail the whole command, never ship partially-by-silence.
   */
  private planShipmentItems(
    lines: Array<{ id: string; variantId: string | null; quantity: number }>,
    allocated: Map<string, number>,
    requested: Array<{ retailOrderItemId: unknown; quantity: unknown }> | undefined,
  ): Array<{ retailOrderItemId: string; variantId: string | null; quantity: number }> {
    const byId = new Map(lines.map((line) => [line.id, line]));
    const remainingOf = (lineId: string): number => {
      const line = byId.get(lineId);
      if (!line) throw new RetailDomainError("RETAIL_SHIPMENT_ITEM_MISMATCH", `line ${String(lineId).slice(0, 64)} does not belong to this order`);
      return line.quantity - (allocated.get(lineId) ?? 0);
    };
    if (requested === undefined) {
      const plan = lines
        .map((line) => ({ retailOrderItemId: line.id, variantId: line.variantId, quantity: line.quantity - (allocated.get(line.id) ?? 0) }))
        .filter((entry) => entry.quantity > 0)
        .sort((a, b) => (a.retailOrderItemId < b.retailOrderItemId ? -1 : 1));
      if (plan.length === 0) {
        throw new RetailDomainError("RETAIL_SHIPMENT_QUANTITY_EXCEEDED", "every line is already fully shipped");
      }
      return plan;
    }
    if (!Array.isArray(requested) || requested.length === 0) {
      throw new RetailDomainError("RETAIL_SHIPMENT_ITEM_MISMATCH", "shipment items must be a non-empty array");
    }
    const seen = new Set<string>();
    const plan = requested.map((entry) => {
      const itemId = typeof entry?.retailOrderItemId === "string" ? entry.retailOrderItemId : "";
      const line = byId.get(itemId);
      if (!line) throw new RetailDomainError("RETAIL_SHIPMENT_ITEM_MISMATCH", `line ${itemId.slice(0, 64)} does not belong to this order`);
      if (seen.has(itemId)) throw new RetailDomainError("RETAIL_SHIPMENT_ITEM_MISMATCH", `line ${itemId.slice(0, 64)} is listed twice`);
      seen.add(itemId);
      const quantity = typeof entry?.quantity === "number" ? entry.quantity : Number.NaN;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new RetailDomainError("RETAIL_SHIPMENT_ITEM_MISMATCH", `line ${itemId.slice(0, 64)}: quantity must be a positive integer`);
      }
      const remaining = remainingOf(itemId);
      if (quantity > remaining) {
        throw new RetailDomainError(
          "RETAIL_SHIPMENT_QUANTITY_EXCEEDED",
          `line ${itemId.slice(0, 64)}: ${quantity} exceeds the remaining ${remaining}`,
        );
      }
      return { retailOrderItemId: itemId, variantId: line.variantId, quantity };
    });
    return plan.sort((a, b) => (a.retailOrderItemId < b.retailOrderItemId ? -1 : 1));
  }

  /**
   * COD stock for the shipped lines, secured at shipment time (prepaid stock
   * was already confirmed at verify). Holds are per-variant and fungible:
   * for each shipped variant the existing holds are released and re-cut
   * into a shipped slice (reserved, then confirmed) plus a remainder slice
   * (stays an active hold). Confirming the whole hold on a partial shipment
   * would strand confirmed stock a later cancel cannot release — the split
   * keeps cancel honest. Idempotency keys are stable per shipment key, so a
   * resumed attempt replays instead of double-moving.
   */
  private async secureCodShipmentStock(args: {
    orderId: string;
    key: string;
    lines: Array<{ id: string; variantId: string | null; quantity: number }>;
    plan: Array<{ retailOrderItemId: string; variantId: string | null; quantity: number }>;
    tx: any;
  }) {
    const { orderId, key, lines, plan, tx } = args;
    const allocationId = orderId;
    const sellerId = await this.offers.ensureSeller(null, "KOLBE");
    const requester = this.systemRequester();
    const active = allocationId ? await this.inventory.listActiveReservationsByAllocation(allocationId, tx) : [];
    const lineQty = new Map(lines.map((line) => [line.id, line.quantity]));
    // Aggregate by variant: holds cover variant units, not lines.
    const byVariant = new Map<string, { shipped: number; total: number }>();
    for (const entry of plan) {
      if (!entry.variantId) throw new RetailDomainError("RETAIL_VARIANT_MISMATCH", `line ${entry.retailOrderItemId}: no variant pinned`);
      const slot = byVariant.get(entry.variantId) ?? { shipped: 0, total: 0 };
      slot.shipped += entry.quantity;
      slot.total += lineQty.get(entry.retailOrderItemId) ?? 0;
      byVariant.set(entry.variantId, slot);
    }
    for (const [variantId, slot] of byVariant) {
      const held = (active as any[]).filter((row) => row.variantId === variantId);
      const heldQty = held.reduce((sum: number, row: any) => sum + (row.quantity as number), 0);
      let available = 0;
      try {
        const inv = await this.inventory.getVariantInventory(variantId, sellerId, requester, tx);
        available = (inv?.available as number) ?? 0;
      } catch (error) {
        if (error instanceof NotFoundError) {
          throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `variant ${variantId}: no KOLBE stock record`);
        }
        throw error;
      }
      if (available + heldQty < slot.total) {
        throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `variant ${variantId}: insufficient KOLBE stock to ship`);
      }
      for (const row of held) {
        await this.inventory.releaseRetail({
          reservationId: row.id,
          requester,
          reason: `retail COD shipment re-cut -> ${allocationId}`,
          idempotencyKey: `${key}:cod:release:${variantId}:${row.id}`,
          executor: tx,
        });
      }
      const shippedHold = await this.inventory.reserveRetail({
        variantId,
        sellerId,
        quantity: slot.shipped,
        allocationId: allocationId as string,
        requester,
        reason: `retail COD shipment reserve -> ${allocationId}`,
        idempotencyKey: `${key}:cod:ship:${variantId}`,
        expiresInMinutes: RETAIL_RESERVATION_TTL_MINUTES,
        executor: tx,
      });
      const shippedReservationId = (shippedHold as any)?.id as string | undefined;
      if (!shippedReservationId) throw new RetailDomainError("RETAIL_INSUFFICIENT_STOCK", `variant ${variantId}: ship-slice reserve failed`);
      await this.inventory.confirmRetail({
        reservationId: shippedReservationId,
        requester,
        reason: `retail COD shipment confirm -> ${allocationId}`,
        idempotencyKey: `${key}:cod:confirm:${variantId}`,
        executor: tx,
      });
      const remainder = slot.total - slot.shipped;
      if (remainder > 0) {
        await this.inventory.reserveRetail({
          variantId,
          sellerId,
          quantity: remainder,
          allocationId: allocationId as string,
          requester,
          reason: `retail COD shipment remainder hold -> ${allocationId}`,
          idempotencyKey: `${key}:cod:hold:${variantId}`,
          expiresInMinutes: RETAIL_RESERVATION_TTL_MINUTES,
          executor: tx,
        });
      }
    }
  }

  /**
   * Create a retail shipment (TxA row + lock-free provider call + TxB
   * finalize), idempotent per (rOrder, order, shipping.shipment_create, key).
   * A provider failure leaves a pending row and a retryable command — the
   * same key resumes (the provider dedupes on the shipment id), it never
   * forks a second shipment. Manual is operator-attested (no external call,
   * null tracking); fake is carrier-backed (tracking + re-queryable truth).
   */
  async createRetailShipment(
    orderId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { idempotencyKey: string; providerName?: string; items?: Array<{ retailOrderItemId: unknown; quantity: unknown }> },
  ): Promise<{ shipment: any; items: any[]; replayed: boolean; providerReplayed: boolean }> {
    this.assertStaff(actor);
    const key = parseIdempotencyKey(input.idempotencyKey);
    const provider = this.shippingProviders.resolve(input.providerName);
    const scope = { scopeType: "rOrder", scopeId: orderId, commandType: "shipping.shipment_create", idempotencyKey: key };

    const prepared = await this.db.transaction(async (tx) => {
      const order = await this.repo.findByIdForUpdate(orderId, tx);
      if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      this.assertFulfillmentReady(order);
      this.assertShippableStatus(order);
      if (order.paymentStatus === "paid") {
        // Prepaid stock settles at verify; a live hold here means the payment
        // never confirmed it — shipping on top would double-spend the shelf.
        const active = await this.inventory.listActiveReservationsByAllocation(orderId, tx);
        if ((active as any[]).length > 0) {
          throw new RetailDomainError("RETAIL_SHIPMENT_NOT_READY", "paid stock was never confirmed; verify the payment first");
        }
      }
      // Claim first: the identity hash covers the REQUESTED lines (or the
      // ship-all intent), so a same-key replay short-circuits before quantity
      // planning — which would otherwise see zero remaining and misreport
      // the replay as over-quantity. Same key + different request still
      // conflicts; different keys still bound cumulatively below.
      const hash = canonicalHash({ provider: provider.name, items: input.items ?? null });
      let claim;
      try {
        claim = await this.shipping.claimCommand(tx, { ...scope, requestHash: hash });
      } catch (error) {
        if (error instanceof ShippingDomainError && (error as any).code === "IDEMPOTENCY_KEY_REUSED") {
          throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different shipment");
        }
        throw error;
      }
      if (claim.state === "completed" && claim.resourceId) {
        return { resume: "replay" as const, shipmentId: claim.resourceId };
      }
      if (claim.state === "pending") {
        if (!claim.resourceId) {
          throw new ShippingDomainError("SHIPMENT_COMMAND_IN_PROGRESS", `Shipment command for order ${orderId} is already running`, 409);
        }
        return { resume: "resume" as const, shipmentId: claim.resourceId };
      }
      const lines = await this.repo.findItemsByOrderId(orderId, tx);
      const allocated = await this.shipping.getAllocatedQuantitiesForRetailOrder(orderId, tx);
      const plan = this.planShipmentItems(lines, allocated, input.items);
      const shipmentId = makeShipmentId();
      const sellerId = await this.offers.ensureSeller(null, "KOLBE");
      const quote = this.resolveRetailQuote(order.shippingMethod, BigInt(order.itemsTotal), order.payMethod === "cod");
      if (order.payMethod === "cod" && order.paymentStatus !== "paid") {
        await this.secureCodShipmentStock({ orderId, key, lines, plan, tx });
      }
      await this.shipping.createRetailPendingShipment({
        shipmentId,
        retailOrderId: orderId,
        sellerId,
        provider: provider.name,
        shippingResponsibility: "KOLBE",
        addressSnapshot: ((order.address ?? {}) as Record<string, unknown>),
        quoteSnapshot: {
          rulesVersion: quote.version,
          method: quote.method,
          amount: quote.amount.toString(),
          currency: quote.currency,
          freeApplied: quote.freeApplied,
          itemsTotal: BigInt(order.itemsTotal).toString(),
        },
        items: plan.map((entry) => ({ retailOrderItemId: entry.retailOrderItemId, variantId: entry.variantId, pieceQuantity: entry.quantity })),
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        executor: tx,
      });
      await this.shipping.attachCommandResource(tx, scope, shipmentId);
      return { resume: "created" as const, shipmentId };
    });

    if (prepared.resume === "replay") {
      const current = await this.shipping.getRetailShipmentById(prepared.shipmentId);
      return { shipment: current.shipment, items: current.items, replayed: true, providerReplayed: true };
    }

    // Lock-free provider call. Manual performs no external call (null refs);
    // a provider throw fails the COMMAND, not the shipment: the pending row
    // waits and the same key resumes below.
    const row = await this.shipping.getRetailShipmentById(prepared.shipmentId);
    let providerResult;
    try {
      providerResult = await provider.createShipment({
        shipmentId: row.shipment.id,
        shipmentCode: row.shipment.shipmentCode,
        retailOrderId: orderId,
        sellerId: row.shipment.sellerId,
        shippingResponsibility: "KOLBE",
        addressSnapshot: (row.shipment.addressSnapshot || {}) as Record<string, unknown>,
        quoteSnapshot: (row.shipment.quoteSnapshot || {}) as Record<string, unknown>,
        items: (row.items as any[]).map((item) => ({
          retailOrderItemId: item.retailOrderItemId,
          variantId: item.variantId ?? null,
          pieceQuantity: item.pieceQuantity,
        })),
        idempotencyKey: row.shipment.id,
      });
    } catch (error: any) {
      await this.db.transaction(async (tx: any) => this.shipping.failCommand(tx, scope));
      throw new ShippingDomainError("PROVIDER_ERROR", `Shipping provider ${provider.name} failed: ${error?.message || error}`, 502);
    }

    return this.db.transaction(async (tx) => {
      const locked = await this.shipping.lockShipment(prepared.shipmentId, tx);
      if (!locked.retailOrderId || locked.retailOrderId !== orderId) {
        throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", `Shipment ${prepared.shipmentId} does not belong to retail order ${orderId}`);
      }
      let replayed = prepared.resume === "resume";
      let updated = locked;
      if (locked.status === "pending") {
        updated = await this.shipping.transitionRetailShipment({
          shipmentId: prepared.shipmentId,
          from: "pending",
          to: "ready",
          patch: {
            externalReference: providerResult.externalReference,
            trackingCode: providerResult.trackingCode,
            trackingUrl: providerResult.trackingUrl,
          },
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          reason: providerResult.replayed ? "provider_replayed" : "provider_accepted",
          executor: tx,
        });
        const order = await this.repo.findByIdForUpdate(orderId, tx);
        await this.repo.insertOrderEvent(
          {
            id: makeEventId(),
            aggregateType: "retail_order",
            aggregateId: orderId,
            eventType: "retail_order.shipment_created",
            payload: {
              order_code: order?.orderCode ?? null,
              shipment_id: prepared.shipmentId,
              shipment_code: updated.shipmentCode,
              provider: provider.name,
              tracking_code: updated.trackingCode ?? null,
            },
            actorId: actor.actorId,
            actorRole: null,
            idempotencyKey: key,
          },
          tx,
        );
        await this.audit.record(
          {
            actorId: actor.actorId ?? "system",
            actorRole: actor.actorRole,
            action: "retail_order.shipment_created",
            entityType: "shipment",
            entityId: prepared.shipmentId,
            after: { order_id: orderId, shipment_code: updated.shipmentCode, provider: provider.name, status: "ready" },
          },
          tx,
        );
      }
      await this.shipping.completeCommand(tx, scope, prepared.shipmentId, { shipmentId: prepared.shipmentId, shipmentCode: updated.shipmentCode });
      const current = await this.shipping.getRetailShipmentById(prepared.shipmentId, tx);
      return { shipment: current.shipment, items: current.items, replayed, providerReplayed: Boolean(providerResult.replayed) };
    });
  }

  /**
   * Operator handoff: ready -> handed_over on the shipment, packed ->
   * shipped on the ORDER (via `transitionOrder`, so history is appended),
   * plus the durable handed-over fact. One transaction, idempotent per
   * (rShipment, shipment, shipping.shipment_handoff, key).
   */
  async markRetailShipmentHandoff(
    shipmentId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { idempotencyKey: string },
  ): Promise<{ shipment: any; replayed: boolean }> {
    this.assertStaff(actor);
    const key = parseIdempotencyKey(input.idempotencyKey);
    const scope = { scopeType: "rShipment", scopeId: shipmentId, commandType: "shipping.shipment_handoff", idempotencyKey: key };
    return this.db.transaction(async (tx) => {
      const locked = await this.shipping.lockShipment(shipmentId, tx);
      if (!locked.retailOrderId) {
        throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", `Shipment ${shipmentId} is not a retail shipment`);
      }
      const orderId = locked.retailOrderId as string;
      // Checkpoint D hardening: a parcel may be LABELLED before pack, but
      // custody transfer demands a packed (or already shipped, for later
      // parcels) order. Handing off pre-pack used to succeed silently at the
      // parcel level while the order never advanced — and the consumed
      // handoff then wedged the order (no path from packed to shipped).
      const preCheck = await this.repo.findByIdForUpdate(orderId, tx);
      if (!preCheck) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
      if (preCheck.orderStatus !== "packed" && preCheck.orderStatus !== "shipped") {
        throw new RetailDomainError("RETAIL_SHIPMENT_NOT_READY", `order must be packed before handoff (is ${preCheck.orderStatus})`);
      }
      let claim;
      try {
        claim = await this.shipping.claimCommand(tx, { ...scope, requestHash: canonicalHash({ to: "handed_over" }) });
      } catch (error) {
        if (error instanceof ShippingDomainError && (error as any).code === "IDEMPOTENCY_KEY_REUSED") {
          throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different handoff");
        }
        throw error;
      }
      if (claim.state === "completed") {
        const current = await this.shipping.getRetailShipmentById(shipmentId, tx);
        return { shipment: current.shipment, replayed: true };
      }
      if (claim.state === "pending") {
        throw new ShippingDomainError("SHIPMENT_COMMAND_IN_PROGRESS", `Handoff for shipment ${shipmentId} is already running`, 409);
      }
      const updated = await this.shipping.transitionRetailShipment({
        shipmentId,
        from: locked.status,
        to: "handed_over",
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        reason: "operator_handoff",
        executor: tx,
      });
      // The first handoff ships the order; later parcels' handoffs move only
      // their own parcel (the order is already shipped) but still record
      // their per-parcel fact below.
      const preOrder = await this.repo.findByIdForUpdate(orderId, tx);
      if (preOrder && preOrder.orderStatus === "packed") {
        await this.transitionOrder(orderId, "shipped", { actorId: actor.actorId, actorRole: actor.actorRole, reason: "shipment_handed_over" }, tx);
      }
      const order = await this.repo.findById(orderId, tx);
      await this.repo.insertOrderEvent(
        {
          id: makeEventId(),
          aggregateType: "retail_order",
          aggregateId: orderId,
          eventType: "retail_order.shipment_handed_over",
          payload: { order_code: order?.orderCode ?? null, shipment_id: shipmentId, shipment_code: updated.shipmentCode },
          actorId: actor.actorId,
          actorRole: null,
          idempotencyKey: key,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_order.shipment_handed_over",
          entityType: "shipment",
          entityId: shipmentId,
          before: { status: locked.status },
          after: { status: "handed_over", order_id: orderId },
        },
        tx,
      );
      await this.shipping.completeCommand(tx, scope, shipmentId, { shipmentId, status: "handed_over" });
      return { shipment: updated, replayed: false };
    });
  }

  /**
   * Carrier webhook for a provider-backed retail shipment (fake in tests;
   * manual has no webhook channel). Mirrors the payment callback: the event
   * is only a TRIGGER — `getTracking` over the provider channel is the
   * truth, refs must agree on both sides, and the inbox (provider +
   * external id) plus an atomic claim decide the single processor. Terminal
   * agreement replays; terminal conflict is rejected without touching state.
   * Service-level; the HTTP route is Checkpoint D.
   */
  async handleRetailCarrierWebhook(
    providerName: string,
    raw: { headers: Record<string, string | string[] | undefined>; body: unknown },
  ): Promise<{ duplicate: boolean; eventId: string; status: string; reason?: string; shipmentId: string | null; shipmentStatus?: string }> {
    const provider = this.shippingProviders.resolve(providerName);
    if (!provider.supportsWebhooks || !provider.parseWebhook) {
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", `provider ${provider.name} has no server-to-server tracking channel`);
    }
    const normalized = provider.parseWebhook({ headers: raw.headers, body: raw.body });
    if (!normalized) {
      // Unauthenticated: rejected without persisting anything (interface contract).
      throw new RetailDomainError("RETAIL_WEBHOOK_UNAUTHENTICATED", "carrier webhook signature is invalid");
    }
    // Both refs given must identify the SAME retail shipment — otherwise the
    // event is either misrouted or forged, and binding it to either row
    // would let one order's scan move another order's parcel.
    const byExternal = normalized.externalReference
      ? await this.shipping.findRetailShipmentByProviderRef({ provider: provider.name, externalReference: normalized.externalReference })
      : null;
    const byTracking = normalized.trackingCode
      ? await this.shipping.findRetailShipmentByProviderRef({ provider: provider.name, trackingCode: normalized.trackingCode })
      : null;
    if (byExternal && byTracking && byExternal.id !== byTracking.id) {
      const persisted = await this.shipping.persistShipmentEvent({
        shipmentId: null,
        provider: provider.name,
        externalEventId: normalized.externalEventId,
        eventType: retailTrackingEventType(normalized.reportedState),
        safeMetadata: { ...normalized.safeMetadata, trigger: "webhook" },
      });
      const claimed = await this.shipping.claimShipmentEvent(persisted.id);
      if (claimed.claimed) {
        await this.shipping.finishShipmentEvent({ eventId: persisted.id, status: "failed", failureReason: "references_disagree" });
      }
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "webhook references identify two different shipments");
    }
    const shipment = byExternal ?? byTracking;
    const persisted = await this.shipping.persistShipmentEvent({
      shipmentId: shipment?.id ?? null,
      provider: provider.name,
      externalEventId: normalized.externalEventId,
      eventType: retailTrackingEventType(normalized.reportedState),
      safeMetadata: { ...normalized.safeMetadata, trigger: "webhook", retailOrderId: shipment?.retailOrderId ?? null },
    });
    if (persisted.duplicate && ["processed", "ignored"].includes(persisted.status)) {
      return { duplicate: true, eventId: persisted.id, status: persisted.status, shipmentId: shipment?.id ?? null };
    }
    const claimed = await this.shipping.claimShipmentEvent(persisted.id);
    if (!claimed.claimed) {
      if (["processed", "ignored", "failed"].includes(claimed.status)) {
        return { duplicate: true, eventId: persisted.id, status: claimed.status, reason: "already_final", shipmentId: shipment?.id ?? null };
      }
      return { duplicate: true, eventId: persisted.id, status: claimed.status, reason: "claimed_by_another_worker", shipmentId: shipment?.id ?? null };
    }
    if (!shipment) {
      await this.shipping.finishShipmentEvent({ eventId: persisted.id, status: "failed", failureReason: "unmapped_reference" });
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "no retail shipment matches these carrier references");
    }
    if (shipment.provider !== provider.name) {
      await this.shipping.finishShipmentEvent({ eventId: persisted.id, status: "failed", failureReason: "provider_mismatch" });
      throw new RetailDomainError(
        "RETAIL_PROVIDER_EVENT_REJECTED",
        `webhook from ${provider.name} cannot move a ${shipment.provider} shipment (operator attestation only)`,
      );
    }
    // Provider is the source of truth — queried with NO lock held.
    let tracking: any;
    try {
      tracking = await provider.getTracking({
        shipmentId: shipment.id,
        externalReference: shipment.externalReference,
        trackingCode: shipment.trackingCode,
      });
    } catch (error: any) {
      // Failed inbox rows stay re-claimable: the next redelivery retries.
      await this.shipping.finishShipmentEvent({ eventId: persisted.id, status: "failed", failureReason: "tracking_query_failed" });
      throw new ShippingDomainError("PROVIDER_ERROR", `Shipping provider ${provider.name} tracking query failed: ${error?.message || error}`, 502);
    }
    if (tracking.externalReference && shipment.externalReference && tracking.externalReference !== shipment.externalReference) {
      await this.shipping.finishShipmentEvent({ eventId: persisted.id, status: "failed", failureReason: "provider_reference_mismatch" });
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", "carrier now reports a different external reference for this shipment");
    }
    const applied = await this.db.transaction(async (tx) =>
      this.applyRetailCarrierState(tx, {
        shipmentId: shipment.id,
        state: String(tracking?.state || "unknown"),
        provider: provider.name,
        eventId: persisted.id,
        actorId: null,
        actorRole: "system",
      }),
    );
    return { duplicate: persisted.duplicate, eventId: persisted.id, ...applied, shipmentId: shipment.id };
  }

  /**
   * Operator-attested scan for a manual (operator-managed) shipment. Manual
   * has no carrier API — `getTracking` is never authoritative — so the staff
   * actor IS the authentication and the attested state is applied directly
   * (never re-queried). Provider-backed shipments refuse attestation.
   */
  async recordRetailManualTracking(
    shipmentId: string,
    actor: { actorId: string | null; actorRole: string },
    input: { state: string; idempotencyKey?: string; note?: string },
  ): Promise<{ duplicate: boolean; eventId: string; status: string; reason?: string; shipmentId: string; shipmentStatus?: string }> {
    this.assertStaff(actor);
    const state = String(input.state || "").toLowerCase();
    if (!["in_transit", "delivered", "failed", "cancelled"].includes(state)) {
      throw new RetailDomainError("RETAIL_PROVIDER_EVENT_REJECTED", `manual tracking cannot attest state ${state || "(empty)"}`);
    }
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
    const current = await this.shipping.getRetailShipmentById(shipmentId);
    if (current.shipment.provider !== "manual") {
      throw new RetailDomainError(
        "RETAIL_PROVIDER_EVENT_REJECTED",
        `manual attestation cannot move a ${current.shipment.provider}-backed shipment (carrier truth only)`,
      );
    }
    const externalEventId =
      typeof input.idempotencyKey === "string" && input.idempotencyKey.trim()
        ? input.idempotencyKey.trim().slice(0, 128)
        : `manual:${shipmentId}:${state}`;
    const persisted = await this.shipping.persistShipmentEvent({
      shipmentId,
      provider: "manual",
      externalEventId,
      eventType: retailTrackingEventType(state as any),
      safeMetadata: { trigger: "operator", retailOrderId: current.shipment.retailOrderId, reportedState: state },
    });
    if (persisted.duplicate && ["processed", "ignored"].includes(persisted.status)) {
      return { duplicate: true, eventId: persisted.id, status: persisted.status, shipmentId };
    }
    const claimed = await this.shipping.claimShipmentEvent(persisted.id);
    if (!claimed.claimed) {
      if (["processed", "ignored", "failed"].includes(claimed.status)) {
        return { duplicate: true, eventId: persisted.id, status: claimed.status, reason: "already_final", shipmentId };
      }
      return { duplicate: true, eventId: persisted.id, status: claimed.status, reason: "claimed_by_another_worker", shipmentId };
    }
    if (note) {
      await this.audit.record({
        actorId: actor.actorId ?? "system",
        actorRole: actor.actorRole,
        action: "retail_shipment.manual_tracking",
        entityType: "shipment",
        entityId: shipmentId,
        after: { attested_state: state, note },
      });
    }
    const applied = await this.db.transaction(async (tx) =>
      this.applyRetailCarrierState(tx, {
        shipmentId,
        state,
        provider: "manual",
        eventId: persisted.id,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
      }),
    );
    return { duplicate: persisted.duplicate, eventId: persisted.id, ...applied, shipmentId };
  }

  /**
   * Apply one authoritative carrier/operator state to a retail shipment.
   * Forward-only, no skipped handoff: a scan for freight whose handoff was
   * never recorded is kept as a fact and ignored, never auto-advanced; a
   * claim against a terminal shipment agrees (replay) or is rejected
   * (backward) — it never resurrects. Delivery fans out to the ORDER through
   * `transitionOrder` only when every line is fully delivered; a partial
   * delivery moves the parcel, not the order.
   */
  private async applyRetailCarrierState(
    tx: any,
    input: { shipmentId: string; state: string; provider: string; eventId: string; actorId: string | null; actorRole: string },
  ): Promise<{ status: string; reason?: string; shipmentStatus?: string }> {
    const finish = (status: "processed" | "ignored" | "failed", reason?: string, shipmentStatus?: string) =>
      this.shipping
        .finishShipmentEvent({ eventId: input.eventId, status, failureReason: reason ?? null, shipmentId: input.shipmentId, executor: tx })
        .then(() => ({ status, reason, shipmentStatus }));
    const locked = await this.shipping.lockShipment(input.shipmentId, tx);
    if (!locked.retailOrderId) {
      throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", `Shipment ${input.shipmentId} is not a retail shipment`);
    }
    const orderId = locked.retailOrderId as string;
    const { state } = input;
    const source = input.provider === "manual" ? "operator" : "carrier";
    if (state === "unknown" || state === "created") {
      return finish("ignored", `${source}_state_${state}`, locked.status);
    }
    if (["delivered", "cancelled", "failed"].includes(locked.status)) {
      const agrees =
        (locked.status === "delivered" && state === "delivered") ||
        (locked.status === "cancelled" && state === "cancelled") ||
        (locked.status === "failed" && state === "failed");
      if (!agrees) {
        return finish("ignored", `backward_transition_rejected:${locked.status}+${state}`, locked.status);
      }
      return finish("processed", `already_${locked.status}`, locked.status);
    }
    if (["pending", "ready"].includes(locked.status)) {
      if (state === "cancelled") {
        const updated = await this.shipping.transitionRetailShipment({
          shipmentId: input.shipmentId,
          from: locked.status,
          to: "cancelled",
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: `${source}_cancelled`,
          executor: tx,
        });
        return finish("processed", `${source}_cancelled`, updated.status);
      }
      // Freight cannot be in transit before the handoff was recorded. Keep
      // the fact, move nothing — the operator records the handoff, then the
      // next scan applies.
      return finish("ignored", "handoff_not_recorded", locked.status);
    }
    // handed_over / in_transit.
    if (state === "in_transit") {
      if (locked.status === "handed_over") {
        const updated = await this.shipping.transitionRetailShipment({
          shipmentId: input.shipmentId,
          from: "handed_over",
          to: "in_transit",
          actorId: input.actorId,
          actorRole: input.actorRole,
          reason: `${source}_in_transit`,
          executor: tx,
        });
        return finish("processed", undefined, updated.status);
      }
      return finish("processed", "already_in_transit", locked.status);
    }
    if (state === "delivered") {
      const updated = await this.shipping.transitionRetailShipment({
        shipmentId: input.shipmentId,
        from: locked.status,
        to: "delivered",
        actorId: input.actorId,
        actorRole: input.actorRole,
        reason: `${source}_delivered`,
        executor: tx,
      });
      const deliveredQty = await this.shipping.getAllocatedQuantitiesForRetailOrder(orderId, tx, ["delivered"]);
      const lines = await this.repo.findItemsByOrderId(orderId, tx);
      const fullyDelivered = (lines as any[]).every((line) => (deliveredQty.get(line.id) ?? 0) >= line.quantity);
      if (!fullyDelivered) {
        await this.audit.record(
          {
            actorId: input.actorId ?? "system",
            actorRole: input.actorRole,
            action: "retail_shipment.partially_delivered",
            entityType: "shipment",
            entityId: input.shipmentId,
            after: { order_id: orderId, shipment_code: updated.shipmentCode, fully_delivered: false },
          },
          tx,
        );
        return finish("processed", "partial_delivery_order_stays_shipped", updated.status);
      }
      await this.transitionOrder(orderId, "delivered", { actorId: input.actorId, actorRole: input.actorRole, reason: "shipment_delivered" }, tx);
      const order = await this.repo.findById(orderId, tx);
      await this.repo.insertOrderEvent(
        {
          id: makeEventId(),
          aggregateType: "retail_order",
          aggregateId: orderId,
          eventType: "retail_order.shipment_delivered",
          payload: { order_code: order?.orderCode ?? null, shipment_id: input.shipmentId, shipment_code: updated.shipmentCode, fully_delivered: true },
          actorId: input.actorId,
          actorRole: null,
          idempotencyKey: null,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: input.actorId ?? "system",
          actorRole: input.actorRole,
          action: "retail_order.shipment_delivered",
          entityType: "shipment",
          entityId: input.shipmentId,
          before: { status: locked.status },
          after: { status: "delivered", order_id: orderId },
        },
        tx,
      );
      return finish("processed", undefined, updated.status);
    }
    if (state === "failed" || state === "cancelled") {
      // Post-handoff failure: explicit, recoverable operational exception —
      // never a silent success, never a resurrection of the parcel. The
      // order stays shipped; recovery (re-ship, refund) is operator work.
      const updated = await this.shipping.transitionRetailShipment({
        shipmentId: input.shipmentId,
        from: locked.status,
        to: "failed",
        patch: { failureReason: `${source}_${state}` },
        actorId: input.actorId,
        actorRole: input.actorRole,
        reason: `${source}_${state}`,
        executor: tx,
      });
      return finish("processed", `${source}_${state}`, updated.status);
    }
    return finish("ignored", `${source}_state_${state}`, locked.status);
  }

  /**
   * Customer shipment read (C15): the order's parcels with line detail and
   * customer-safe tracking. Internal carrier references stay on operator
   * paths — the customer sees tracking codes, never external references.
   */
  async getRetailShipment(
    viewer: { userId: string; role: string },
    orderId: string,
  ): Promise<{ orderId: string; orderCode: string; shipments: Array<Record<string, unknown>> }> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    if (viewer.role !== "admin" && (order.customerId ?? null) !== viewer.userId) {
      throw new RetailDomainError("RETAIL_ORDER_FORBIDDEN", "this order belongs to another customer");
    }
    return this.presentRetailShipments(order);
  }

  /**
   * Phase 5.9-A — shared shipment presenter. Ownership is enforced by the
   * caller (session viewer check above, capability check in
   * getRetailOrderAsGuest); this method only maps rows.
   */
  private async presentRetailShipments(
    order: any,
  ): Promise<{ orderId: string; orderCode: string; shipments: Array<Record<string, unknown>> }> {
    const rows = await this.shipping.listRetailShipments(order.id);
    const lines = await this.repo.findItemsByOrderId(order.id);
    const lineOf = new Map((lines as any[]).map((line) => [line.id, line]));
    const iso = (value: unknown): string | null => (value ? new Date(value as any).toISOString() : null);
    const shipments: Array<Record<string, unknown>> = [];
    for (const row of rows as any[]) {
      const full = await this.shipping.getRetailShipmentById(row.id);
      const quote = (full.shipment.quoteSnapshot || {}) as Record<string, unknown>;
      shipments.push({
        id: full.shipment.id,
        code: full.shipment.shipmentCode,
        provider: full.shipment.provider,
        method: quote.method ?? null,
        status: full.shipment.status,
        trackingCode: full.shipment.trackingCode ?? null,
        trackingUrl: full.shipment.trackingUrl ?? null,
        failureReason: full.shipment.failureReason ?? null,
        quote: { version: quote.rulesVersion ?? null, amount: quote.amount ?? null, currency: quote.currency ?? "IRR", freeApplied: quote.freeApplied ?? null },
        items: (full.items as any[]).map((item) => ({
          retailOrderItemId: item.retailOrderItemId,
          sku: (lineOf.get(item.retailOrderItemId) as any)?.sku ?? null,
          productName: (lineOf.get(item.retailOrderItemId) as any)?.productName ?? null,
          quantity: item.pieceQuantity,
        })),
        handedOverAt: iso(full.shipment.handedOverAt),
        deliveredAt: iso(full.shipment.deliveredAt),
        cancelledAt: iso(full.shipment.cancelledAt),
        createdAt: iso(full.shipment.createdAt),
      });
    }
    return { orderId: order.id, orderCode: order.orderCode, shipments };
  }
}
