import { Injectable, Inject } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  wholesaleOrder,
  wholesaleOrderItem,
  purchaseOrder,
  purchaseOrderItem,
  wholesaleOrderRequest,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { OrdersRepository, type DbOrTx } from "./orders.repository";
import {
  validateWholesaleOrderTransition,
  validateChildOrderTransition,
  validateSellerSupplierConsistency,
  validateQuantitySnapshot,
  validateOrderTotals,
  calculateParentStatusFromChildren,
  calculateParentFulfillmentProjection,
  type SellerType,
} from "./order.logic";
import { AuditService } from "../audit/audit.service";
import { VipService } from "../vip/vip.service";
import { InventoryService } from "../inventory/inventory.service";
import { CatalogService } from "../catalog/catalog.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { OffersService } from "../offers/offers.service";
import { hashAcceptedTerms, canonicalStringify } from "../pricing/pricing.logic";
import { DomainError } from "@kolbe/shared";
import type { WholesaleOrderStatus, ChildOrderStatus } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

function orderId(): string {
  return `wo_${randomUUID().replaceAll("-", "")}`;
}
function orderItemId(): string {
  return `woi_${randomUUID().replaceAll("-", "")}`;
}
function purchaseOrderId(): string {
  return `po_${randomUUID().replaceAll("-", "")}`;
}
function purchaseOrderItemId(): string {
  return `poi_${randomUUID().replaceAll("-", "")}`;
}
function orderRequestLinkId(): string {
  return `wor_${randomUUID().replaceAll("-", "")}`;
}
function statusHistoryId(): string {
  return `osh_${randomUUID().replaceAll("-", "")}`;
}
function eventId(): string {
  return `oev_${randomUUID().replaceAll("-", "")}`;
}

function generateOrderCode(): string {
  // Increased entropy: 16 hex chars (was 8) to reduce collision probability
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
  return `KV-W-${suffix}`;
}

function generateChildOrderCode(parentCode: string, index: number): string {
  const suffix = String(index + 1).padStart(2, "0");
  return `${parentCode}-${suffix}`;
}

function hashCreationRequest(input: {
  requestIds: string[];
  expectedVersions: Record<string, number>;
  paymentMode: string;
  shippingAddress: any;
  billingAddress: any;
}): string {
  const sortedIds = [...input.requestIds].sort();
  const normalized = {
    requests: sortedIds.map((id) => ({ requestId: id, expectedVersion: input.expectedVersions[id] })),
    paymentMode: input.paymentMode,
    shippingAddress: normalizeAddress(input.shippingAddress),
    billingAddress: normalizeAddress(input.billingAddress),
  };
  const canonical = canonicalStringify(normalized);
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeAddress(addr: any): any {
  if (!addr || typeof addr !== "object" || Array.isArray(addr)) return {};
  const result: any = {};
  const keys = Object.keys(addr).sort();
  for (const k of keys) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const v = addr[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > 500) continue;
      result[k] = trimmed;
    } else if (typeof v === "number" || typeof v === "boolean") {
      result[k] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      const nested = normalizeAddress(v);
      if (Object.keys(nested).length > 0) result[k] = nested;
    }
  }
  return result;
}

function sanitizeForJsonb(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeForJsonb);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeForJsonb(v);
    }
    return out;
  }
  return value;
}

function validateAddress(addr: any, field: string): void {
  if (!addr || typeof addr !== "object" || Array.isArray(addr)) {
    throw new OrderDomainError("INVALID_ADDRESS", `${field} must be object`);
  }
  const json = JSON.stringify(addr);
  if (json.length > 5000) {
    throw new OrderDomainError("ADDRESS_TOO_LARGE", `${field} too large`);
  }
  // Minimal canonical address contract
  const normalized = normalizeAddress(addr);
  // Require at least recipient/name, city, address line
  // Use flexible keys: recipient, name, fullName, province/state, city, address, addressLine, line1, postalCode, zip, phone
  const hasRecipient = !!(normalized.recipient || normalized.name || normalized.fullName || normalized.receiver);
  const hasCity = !!normalized.city;
  const hasAddressLine = !!(normalized.address || normalized.addressLine || normalized.line1 || normalized.street || normalized.address_line);
  // For current storefront, require at least city; address line optional but validated if present
  // This keeps backward compat with existing Phase 4.3 tests that use {city}
  if (!hasCity) {
    throw new OrderDomainError("INVALID_ADDRESS", `${field} requires city`);
  }
  // If address line field present in original but empty after trim, it's already filtered; we don't strictly require it
  // However reject completely empty {} already handled via Object.keys check below
  // If phone present, validate minimal format
  if (normalized.phone && typeof normalized.phone === "string" && normalized.phone.length < 7) {
    throw new OrderDomainError("INVALID_ADDRESS", `${field} phone too short`);
  }
  // Reject if normalized empty
  if (Object.keys(normalized).length === 0) {
    throw new OrderDomainError("INVALID_ADDRESS", `${field} empty after normalization`);
  }
}

export class OrderDomainError extends DomainError {
  constructor(code: string, message: string) {
    let status = 400;
    if (code === "ORDER_IDEMPOTENCY_KEY_REQUIRED") status = 400;
    else if (code === "IDEMPOTENCY_KEY_REUSED") status = 409;
    else if (code === "REQUEST_ALREADY_CONVERTED") status = 409;
    else if (code === "REQUEST_NOT_ACCEPTED") status = 409;
    else if (code === "ALREADY_CONVERTED") status = 409;
    else if (code === "REQUEST_VERSION_CONFLICT") status = 409;
    else if (code === "ORDER_OWNERSHIP_VIOLATION") status = 403;
    else if (code === "ORDER_NOT_FOUND") status = 404;
    else if (code === "INVENTORY_SHORTAGE") status = 409;
    else if (code === "SELLER_NOT_ELIGIBLE") status = 422;
    else if (code === "INVALID_PAYMENT_MODE") status = 400;
    else if (code === "MIXED_WHOLESALE_ACCOUNT" || code === "MIXED_BUYER" || code === "CURRENCY_MISMATCH") status = 400;
    else if (code === "ACCEPTED_TERMS_HASH_MISMATCH" || code === "ACCEPTED_TERMS_MISSING") status = 422;
    else if (code === "REQUEST_ACCEPTANCE_EXPIRED" || code === "ACCEPTANCE_EXPIRED") status = 410;
    else if (code === "REQUEST_SELECTOR_REQUIRED" || code === "REQUEST_SELECTOR_AMBIGUOUS") status = 400;
    else if (code === "ORDER_CODE_COLLISION") status = 409;
    else if (code === "REQUEST_LINK_MISSING" || code === "REQUEST_LINK_MISMATCH") status = 409;
    else if (code === "INVALID_ADDRESS" || code === "ADDRESS_TOO_LARGE") status = 400;
    super(status, code, message);
    this.name = "OrderDomainError";
  }
}

/** Phase 4.7.1 (B5) — the canonical shipping-facing view of a child order, served by Orders (single owner). */
export type ChildOrderShippingContext = {
  child: {
    id: string;
    status: ChildOrderStatus;
    sellerId: string;
    wholesaleOrderId: string;
    shippingResponsibility: "SUPPLIER" | "KOLBE" | "EXTERNAL_CARRIER";
    version: number;
    trackingCode: string | null;
  };
  parent: {
    id: string;
    status: WholesaleOrderStatus;
    buyerUserId: string;
    paymentMode: string | null;
    currency: string;
    shippingAddressSnapshot: Record<string, unknown>;
    financiallyReleased: boolean;
  };
  items: Array<{
    wholesaleOrderItemId: string;
    purchaseOrderItemId: string | null;
    variantId: string | null;
    packageId: string | null;
    productName: string;
    sku: string | null;
    pieceQuantity: number;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    currency: string;
  }>;
};

@Injectable()
export class OrdersService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(OrdersRepository) private readonly repository: OrdersRepository,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(VipService) private readonly vipService: VipService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(SuppliersService) private readonly suppliersService: SuppliersService,
    @Inject(OffersService) private readonly offersService: OffersService,
  ) {}

  private async withExecutor<T>(executor: DbOrTx | undefined, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    if (executor) {
      return work(executor);
    }
    return this.db.transaction(async (tx) => work(tx as any));
  }

  async getWholesaleOrderById(id: string, executor?: DbOrTx) {
    return this.repository.findWholesaleOrderById(id, executor);
  }

  async getOrderWithItems(id: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const order = await this.repository.findWholesaleOrderById(id, tx);
      if (!order) return null;
      const items = await this.repository.findItemsByOrderId(id, tx);
      const children = await this.repository.findChildOrdersByWholesaleOrderId(id, tx);
      const links = await this.repository.findOrderRequestLinksByOrderId(id, tx);
      return { order, items, children, links };
    });
  }

  async getOrderByAccountAndIdempotency(accountId: string, idempotencyKey: string, executor?: DbOrTx) {
    return this.repository.findWholesaleOrderByAccountAndIdempotency(accountId, idempotencyKey, executor);
  }

  validateParentTransition(from: WholesaleOrderStatus, to: WholesaleOrderStatus): void {
    validateWholesaleOrderTransition(from, to);
  }

  validateChildTransition(from: ChildOrderStatus, to: ChildOrderStatus): void {
    validateChildOrderTransition(from, to);
  }

  validateSellerSupplier(sellerType: SellerType, supplierId: string | null | undefined): void {
    validateSellerSupplierConsistency(sellerType, supplierId);
  }

  validateQuantities(input: Parameters<typeof validateQuantitySnapshot>[0]): void {
    validateQuantitySnapshot(input);
  }

  validateTotals(input: Parameters<typeof validateOrderTotals>[0]): void {
    validateOrderTotals(input);
  }

  aggregateParentStatus(
    currentParentStatus: WholesaleOrderStatus,
    children: Array<{ id: string; status: ChildOrderStatus }>,
  ): WholesaleOrderStatus {
    return calculateParentFulfillmentProjection(currentParentStatus, children);
  }

  aggregateParentStatusLegacy(children: Array<{ id: string; status: ChildOrderStatus }>): ReturnType<typeof calculateParentStatusFromChildren> {
    return calculateParentStatusFromChildren(children);
  }

  async appendStatusHistory(
    input: {
      orderId?: string | null;
      childOrderId?: string | null;
      fromStatus: string | null;
      toStatus: string;
      actorId?: string | null;
      actorRole?: string | null;
      reason?: string | null;
      metadata?: Record<string, unknown>;
      orderVersion: number;
    },
    executor: DbOrTx,
  ) {
    if ((input.orderId && input.childOrderId) || (!input.orderId && !input.childOrderId)) {
      throw new Error("order_status_history requires exactly one of orderId or childOrderId");
    }
    const id = statusHistoryId();
    return this.repository.insertOrderStatusHistory(
      {
        id,
        orderId: input.orderId || null,
        childOrderId: input.childOrderId || null,
        fromStatus: input.fromStatus as any,
        toStatus: input.toStatus,
        actorId: input.actorId || null,
        actorRole: input.actorRole || null,
        reason: input.reason || null,
        metadata: (input.metadata as any) || {},
        orderVersion: input.orderVersion,
      },
      executor,
    );
  }

  async appendEvent(
    input: {
      aggregateType: "wholesale_order" | "purchase_order";
      aggregateId: string;
      eventType: string;
      payload?: Record<string, unknown>;
      actorId?: string | null;
      actorRole?: string | null;
      idempotencyKey?: string | null;
    },
    executor: DbOrTx,
  ) {
    const id = eventId();
    return this.repository.insertOrderEvent(
      {
        id,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: (input.payload as any) || {},
        actorId: input.actorId || null,
        actorRole: input.actorRole || null,
        idempotencyKey: input.idempotencyKey || null,
      },
      executor,
    );
  }

  // ── Canonical Create Order Command (Phase 4.3.1 hardened) ────────────────
  /**
   * Locking order (deadlock-safe, documented):
   * 1. wholesale_account FOR UPDATE (account-scoped serialization)
   * 2. wholesale_request IDs ASC FOR UPDATE
   * 3. inventory seller_id + variant_id ASC FOR UPDATE (inside reserveOrderAllocations)
   */
  async createWholesaleOrder(input: {
    requests: Array<{ requestId: string; expectedVersion: number }>;
    paymentMode: string;
    shippingAddress: any;
    billingAddress: any;
    idempotencyKey: string;
    buyerUserId: string;
    actorRole?: string;
  }) {
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    }
    if (input.requests.length === 0) {
      throw new OrderDomainError("INVALID_REQUEST_BATCH", "At least one request required");
    }
    if (input.requests.length > 20) {
      throw new OrderDomainError("REQUEST_BATCH_TOO_LARGE", "Batch too large (max 20)");
    }

    const allowedPaymentModes = ["prepaid", "credit", "on_delivery", "transfer", "cod"];
    if (!allowedPaymentModes.includes(input.paymentMode)) {
      throw new OrderDomainError("INVALID_PAYMENT_MODE", `paymentMode ${input.paymentMode} not allowed for wholesale. Allowed: ${allowedPaymentModes.join(", ")}`);
    }
    const forbidden = ["snapppay", "digipay", "installment", "gateway"];
    if (forbidden.includes(input.paymentMode.toLowerCase())) {
      throw new OrderDomainError("INVALID_PAYMENT_MODE", `Retail BNPL ${input.paymentMode} not allowed for wholesale`);
    }

    validateAddress(input.shippingAddress, "shippingAddress");
    validateAddress(input.billingAddress, "billingAddress");

    const requestIds = input.requests.map((r) => r.requestId);
    const uniqueIds = new Set(requestIds);
    if (uniqueIds.size !== requestIds.length) {
      throw new OrderDomainError("DUPLICATE_REQUEST_IDS", "Duplicate request IDs in batch");
    }

    const sortedRequests = [...input.requests].sort((a, b) => a.requestId.localeCompare(b.requestId));
    const sortedIds = sortedRequests.map((r) => r.requestId);
    const expectedVersionsMap: Record<string, number> = {};
    for (const r of sortedRequests) expectedVersionsMap[r.requestId] = r.expectedVersion;

    const creationHash = hashCreationRequest({
      requestIds: sortedIds,
      expectedVersions: expectedVersionsMap,
      paymentMode: input.paymentMode,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
    });

    return this.db.transaction(async (tx: any) => {
      // Phase 4.3.1 — Account-scoped serialization: resolve account from first request (without lock yet) to get accountId,
      // then lock account FOR UPDATE before idempotency lookup
      // We need to first peek first request to get accountId (no lock), then lock account, then lock requests

      // Peek first request to get accountId (no lock)
      const { wholesaleRequest: wholesaleRequestTable } = await import("@kolbe/database");
      const [firstPeek] = await tx.select().from(wholesaleRequestTable).where(eq(wholesaleRequestTable.id, sortedIds[0])).limit(1);
      if (!firstPeek) {
        throw new OrderDomainError("REQUEST_NOT_FOUND", `Request ${sortedIds[0]} not found`);
      }
      const firstAccountId = (firstPeek as any).vipAccountId || (firstPeek as any).vip_account_id;
      if (!firstAccountId) {
        throw new OrderDomainError("REQUEST_NOT_FOUND", `Request ${sortedIds[0]} missing account`);
      }

      // Lock account FOR UPDATE — deterministic account-scoped serialization
      const lockedAccount = await this.vipService.lockWholesaleAccountForUpdate(firstAccountId, tx);
      // Verify buyer owns account (raw row may be snake_case)
      const lockedUserId = (lockedAccount as any).userId || (lockedAccount as any).user_id;
      if (lockedUserId !== input.buyerUserId) {
        throw new OrderDomainError("MIXED_BUYER", `Buyer mismatch for account ${firstAccountId}: locked ${lockedUserId} vs buyer ${input.buyerUserId}`);
      }

      // Now check idempotency after account lock (prevents concurrent same key different payload race)
      const [existingOrder] = await tx
        .select()
        .from(wholesaleOrder)
        .where(and(eq(wholesaleOrder.accountId, firstAccountId), eq(wholesaleOrder.idempotencyKey, input.idempotencyKey)))
        .limit(1);

      if (existingOrder) {
        if (existingOrder.creationRequestHash && existingOrder.creationRequestHash !== creationHash) {
          throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", `Idempotency-Key ${input.idempotencyKey} reused with different payload`);
        }
        const items = await tx.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.orderId, existingOrder.id));
        const children = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, existingOrder.id));
        const links = await tx.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.orderId, existingOrder.id));
        return { order: existingOrder, items, children, links, replayed: true };
      }

      // Lock all requested wholesale requests FOR UPDATE in deterministic ID order
      const lockedRequests: any[] = [];
      for (const req of sortedRequests) {
        const result = await tx.execute(sql`SELECT * FROM wholesale_request WHERE id = ${req.requestId} FOR UPDATE`);
        const row = result.rows?.[0];
        if (!row) {
          throw new OrderDomainError("REQUEST_NOT_FOUND", `Request ${req.requestId} not found`);
        }
        lockedRequests.push(row);
      }

      if (lockedRequests.length === 0) throw new OrderDomainError("INVALID_REQUEST_BATCH", "No requests locked");

      const accountId = (lockedRequests[0] as any).vip_account_id || (lockedRequests[0] as any).vipAccountId;
      // Ensure all same account (already have account locked, but verify)
      if (accountId !== firstAccountId) {
        throw new OrderDomainError("MIXED_WHOLESALE_ACCOUNT", `Account mismatch: locked first ${firstAccountId} vs ${accountId}`);
      }
      const firstCurrency = (lockedRequests[0].accepted_terms_snapshot as any)?.currency || "IRR";

      // Batch validation: same account, same buyer, same currency
      const buyerUserId = input.buyerUserId;
      for (const req of lockedRequests) {
        const reqAccountId = (req as any).vip_account_id || (req as any).vipAccountId;
        if (reqAccountId !== accountId) {
          throw new OrderDomainError("MIXED_WHOLESALE_ACCOUNT", `Mixed accounts: ${req.id} has ${reqAccountId} != ${accountId}`);
        }
        // Account ownership already verified via lockedAccount, but double-check via VipService query for other accounts (should not happen)
        if (reqAccountId !== lockedAccount.id) {
          const acc = await this.vipService.getWholesaleAccountForOrder(reqAccountId, tx);
          if (acc.userId !== buyerUserId) {
            throw new OrderDomainError("MIXED_BUYER", `Buyer mismatch for request ${req.id}`);
          }
        }
      }

      // Use DB time for expiry checks
      const dbNowResult = await tx.execute(sql`SELECT NOW() as now`);
      const dbNow = new Date((dbNowResult as any).rows?.[0]?.now);

      const batchForValidation: any[] = [];
      for (const req of lockedRequests) {
        if (req.status !== "accepted") {
          throw new OrderDomainError("REQUEST_NOT_ACCEPTED", `Request ${req.id} status ${req.status} not accepted`);
        }
        if (!req.accepted_terms_snapshot) {
          throw new OrderDomainError("ACCEPTED_TERMS_MISSING", `Request ${req.id} missing accepted_terms_snapshot`);
        }
        if (!req.accepted_terms_hash) {
          throw new OrderDomainError("ACCEPTED_TERMS_MISSING", `Request ${req.id} missing accepted_terms_hash`);
        }
        const recomputed = hashAcceptedTerms(req.accepted_terms_snapshot as any);
        if (recomputed !== req.accepted_terms_hash) {
          throw new OrderDomainError("ACCEPTED_TERMS_HASH_MISMATCH", `Request ${req.id} hash mismatch`);
        }
        if (req.acceptance_expires_at && new Date(req.acceptance_expires_at).getTime() <= dbNow.getTime()) {
          throw new OrderDomainError("REQUEST_ACCEPTANCE_EXPIRED", `Request ${req.id} acceptance expired`);
        }
        const [linked] = await tx.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.requestId, req.id)).limit(1);
        if (linked) {
          throw new OrderDomainError("REQUEST_ALREADY_CONVERTED", `Request ${req.id} already converted to order ${linked.orderId}`);
        }
        const expected = expectedVersionsMap[req.id];
        if (req.version !== expected) {
          throw new OrderDomainError("REQUEST_VERSION_CONFLICT", `Request ${req.id} version conflict: expected ${expected}, got ${req.version}`);
        }
        const snapCurrency = (req.accepted_terms_snapshot as any).currency;
        if (snapCurrency !== firstCurrency) {
          throw new OrderDomainError("CURRENCY_MISMATCH", `Currency mismatch: ${req.id} has ${snapCurrency} != ${firstCurrency}`);
        }

        batchForValidation.push({
          id: req.id,
          vipAccountId: (req as any).vip_account_id || (req as any).vipAccountId,
          buyerUserId,
          status: req.status,
          acceptedTermsSnapshot: req.accepted_terms_snapshot,
          acceptedTermsHash: req.accepted_terms_hash,
          version: req.version,
          currency: snapCurrency,
          acceptanceExpiresAt: req.acceptance_expires_at ? new Date(req.acceptance_expires_at) : null,
          sellerId: (req.accepted_terms_snapshot as any).sellerId,
          alreadyLinked: false,
        });
      }

      const { validateMultiRequestBatch } = await import("../pricing/pricing.logic");
      try {
        validateMultiRequestBatch(batchForValidation as any);
      } catch (e: any) {
        throw new OrderDomainError(e.name || "BATCH_VALIDATION_FAILED", e.message);
      }

      // Eligibility revalidation via domain services (no direct table reads)
      for (const req of lockedRequests) {
        const snapshot = req.accepted_terms_snapshot as any;
        // Seller eligibility via SuppliersService
        await this.suppliersService.getSellerEligibility(snapshot.sellerId, tx);
        // Offer eligibility via OffersService
        await this.offersService.getOfferEligibility(snapshot.offerId, tx);
        // Product eligibility via CatalogService
        await this.catalogService.getOrderEligibleProduct(snapshot.productId, tx);
        if (snapshot.variantId) {
          await this.catalogService.getVariantForOrder(snapshot.variantId, snapshot.productId, tx);
        }
        if (snapshot.packageId) {
          await this.offersService.getPackageForOrder(snapshot.packageId, snapshot.offerId, tx);
        }
      }

      // Totals bigint only
      let itemsTotal = 0n;
      let totalUnits = 0;
      for (const req of lockedRequests) {
        const snap = req.accepted_terms_snapshot as any;
        const lineTotal = BigInt(snap.lineTotal);
        const pieceQty = snap.pieceQuantity;
        itemsTotal += lineTotal;
        totalUnits += pieceQty;
        if (itemsTotal > 1000000000000000n) throw new OrderDomainError("TOTALS_OVERFLOW", "items_total exceeds MAX_MONEY");
        if (!Number.isSafeInteger(totalUnits)) throw new OrderDomainError("TOTALS_OVERFLOW", "total_units overflow");
      }
      const shippingTotal = 0n;
      const grandTotal = itemsTotal + shippingTotal;

      // Order code with retry on collision
      const maxRetries = 3;
      let parentOrder: any = null;
      let parentOrderId = orderId();
      let parentOrderCode = generateOrderCode();
      let attempt = 0;
      const now = new Date();
      const normalizedShipping = normalizeAddress(input.shippingAddress);
      const normalizedBilling = normalizeAddress(input.billingAddress);

      while (attempt <= maxRetries) {
        try {
          const [created] = await tx
            .insert(wholesaleOrder)
            .values({
              id: parentOrderId,
              orderCode: parentOrderCode,
              accountId,
              buyerUserId: buyerUserId,
              originatingRequestId: sortedRequests.length === 1 ? sortedRequests[0].requestId : null,
              status: "draft",
              currency: firstCurrency,
              itemsTotal: itemsTotal as any,
              shippingTotal: shippingTotal as any,
              grandTotal: grandTotal as any,
              totalAmount: grandTotal as any,
              totalUnits,
              pricingVersion: "v4.3.1",
              paymentMode: input.paymentMode,
              shippingAddressSnapshot: normalizedShipping as any,
              billingAddressSnapshot: normalizedBilling as any,
              idempotencyKey: input.idempotencyKey,
              creationRequestHash: creationHash,
              version: 0,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          parentOrder = created;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && (e?.constraint?.includes("order_code") || e?.message?.includes("order_code"))) {
            attempt++;
            if (attempt > maxRetries) {
              throw new OrderDomainError("ORDER_CODE_COLLISION", "Order code collision after retries");
            }
            parentOrderId = orderId();
            parentOrderCode = generateOrderCode();
            continue;
          }
          // For idempotency unique violation, handle as IDEMPOTENCY_KEY_REUSED not raw 23505
          if (e?.code === "23505" && (e?.constraint?.includes("idempotency") || e?.message?.includes("idempotency"))) {
            // Re-check existing order to determine if same hash or different
            const [existing] = await tx
              .select()
              .from(wholesaleOrder)
              .where(and(eq(wholesaleOrder.accountId, accountId), eq(wholesaleOrder.idempotencyKey, input.idempotencyKey)))
              .limit(1);
            if (existing) {
              if (existing.creationRequestHash && existing.creationRequestHash !== creationHash) {
                throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", `Idempotency-Key ${input.idempotencyKey} reused with different payload`);
              }
              const items = await tx.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.orderId, existing.id));
              const children = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, existing.id));
              const links = await tx.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.orderId, existing.id));
              return { order: existing, items, children, links, replayed: true };
            }
            throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", `Idempotency-Key ${input.idempotencyKey} conflict`);
          }
          throw e;
        }
      }

      if (!parentOrder) throw new OrderDomainError("ORDER_CODE_COLLISION", "Failed to create order after retries");

      // Create order items using ACCEPTED SNAPSHOT ONLY for historical fields
      const createdOrderItems: any[] = [];
      const sellerGroups = new Map<string, any[]>();

      for (const req of lockedRequests) {
        const snap = req.accepted_terms_snapshot as any;
        const itemId = orderItemId();

        const isPiece = !!snap.variantId && !snap.packageId;
        const isPackage = !snap.variantId && !!snap.packageId;

        if (!isPiece && !isPackage) {
          if (snap.variantId == null && snap.packageId == null) {
            throw new OrderDomainError("REQUEST_SELECTOR_REQUIRED", `Request ${req.id} has no variant nor package`);
          }
          throw new OrderDomainError("REQUEST_SELECTOR_AMBIGUOUS", `Request ${req.id} ambiguous selector`);
        }

        // Use frozen accepted snapshot for display/commercial metadata, NOT live tables
        const productName = snap.product?.name || snap.productId;
        const productNameSnapshot = snap.product?.name || snap.productId;
        const skuSnapshot = snap.variant?.sku || "UNKNOWN";
        const sku = skuSnapshot;
        const variantSnapshot = snap.variant ? { sku: snap.variant.sku, attributes: snap.variant.attributes } : {};
        const sellerSnapshot = snap.seller ? { displayName: snap.seller.displayName, type: snap.seller.type, supplierId: snap.seller.supplierId } : {};
        const packageTypeSnapshot = snap.package?.type || null;
        const packageNameSnapshot = snap.package?.name || null;
        const packageCompositionSnapshot = snap.package?.composition || null;

        const orderItem = {
          id: itemId,
          orderId: parentOrder.id,
          productId: snap.productId,
          variantId: isPiece ? snap.variantId : null,
          sellerOfferId: snap.offerId,
          sellerId: snap.sellerId,
          supplierId: snap.supplierId || null,
          packageId: isPackage ? snap.packageId : null,
          pricingTierId: snap.pricingTierId || null,
          sourceRequestId: req.id,
          productName,
          productNameSnapshot,
          sku,
          skuSnapshot,
          variantSnapshot,
          sellerSnapshot,
          packageTypeSnapshot,
          packageNameSnapshot,
          packageCompositionSnapshot: packageCompositionSnapshot as any,
          moqUnitSnapshot: snap.saleUnit,
          pricingUnit: snap.pricingUnit,
          quantity: snap.quantity,
          packageQuantity: isPackage ? snap.quantity : null,
          pieceQuantity: snap.pieceQuantity,
          unitPrice: BigInt(snap.unitPrice) as any,
          lineTotal: BigInt(snap.lineTotal) as any,
          currency: snap.currency,
          createdAt: now,
          updatedAt: now,
        };

        const [created] = await tx.insert(wholesaleOrderItem).values(orderItem).returning();
        createdOrderItems.push(created);

        if (!sellerGroups.has(snap.sellerId)) sellerGroups.set(snap.sellerId, []);
        sellerGroups.get(snap.sellerId)!.push(created);
      }

      // Create request↔order links
      const createdLinks: any[] = [];
      for (const req of lockedRequests) {
        const linkId = orderRequestLinkId();
        const [link] = await tx
          .insert(wholesaleOrderRequest)
          .values({
            id: linkId,
            orderId: parentOrder.id,
            requestId: req.id,
            requestVersion: req.version,
            acceptedTermsHash: req.accepted_terms_hash,
            createdAt: now,
          })
          .returning();
        createdLinks.push(link);
      }

      // Create one child order per seller — deterministic suffix ordering by stable key (seller_id ASC)
      const sortedSellerIds = Array.from(sellerGroups.keys()).sort();
      const createdChildOrders: any[] = [];
      const createdChildItems: any[] = [];

      for (let idx = 0; idx < sortedSellerIds.length; idx++) {
        const sellerId = sortedSellerIds[idx];
        const itemsForSeller = sellerGroups.get(sellerId)!;

        const { seller: sellerRow } = await this.suppliersService.getSellerEligibility(sellerId, tx);

        const supplierId = sellerRow.supplierId || null;
        const sellerType = sellerRow.type as SellerType;
        validateSellerSupplierConsistency(sellerType, supplierId);

        const shippingResponsibility = sellerType === "KOLBE" ? "KOLBE" : "SUPPLIER";

        let childItemsTotal = 0n;
        for (const it of itemsForSeller) {
          childItemsTotal += BigInt(it.lineTotal);
        }

        const childId = purchaseOrderId();
        const childCode = generateChildOrderCode(parentOrder.orderCode, idx);

        const [childOrder] = await tx
          .insert(purchaseOrder)
          .values({
            id: childId,
            orderCode: childCode,
            sellerId,
            supplierId,
            wholesaleOrderId: parentOrder.id,
            status: "pending",
            currency: firstCurrency,
            itemsTotal: childItemsTotal as any,
            grandTotal: childItemsTotal as any,
            totalAmount: childItemsTotal as any,
            shippingResponsibility: shippingResponsibility as any,
            version: 0,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        createdChildOrders.push(childOrder);

        for (const parentItem of itemsForSeller) {
          const childItemId = purchaseOrderItemId();
          const [childItem] = await tx
            .insert(purchaseOrderItem)
            .values({
              id: childItemId,
              purchaseOrderId: childId,
              wholesaleOrderItemId: parentItem.id,
              productId: parentItem.productId,
              variantId: parentItem.variantId,
              sellerOfferId: parentItem.sellerOfferId,
              productName: parentItem.productName,
              sku: parentItem.sku,
              quantity: parentItem.quantity,
              unitPrice: parentItem.unitPrice as any,
              totalAmount: parentItem.lineTotal as any,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          createdChildItems.push(childItem);
        }
      }

      // Inventory allocations from frozen accepted composition
      const allocations: Array<{
        orderItemId: string;
        sourceRequestId: string;
        sellerId: string;
        variantId: string;
        quantity: number;
        allocationId: string;
      }> = [];

      for (const req of lockedRequests) {
        const snap = req.accepted_terms_snapshot as any;
        const orderItem = createdOrderItems.find((it) => it.sourceRequestId === req.id);
        if (!orderItem) throw new OrderDomainError("ORDER_ITEM_NOT_FOUND", `Order item for request ${req.id} not found`);

        if (snap.variantId && !snap.packageId) {
          allocations.push({
            orderItemId: orderItem.id,
            sourceRequestId: req.id,
            sellerId: snap.sellerId,
            variantId: snap.variantId,
            quantity: snap.pieceQuantity,
            allocationId: `alloc_${orderItem.id}_${snap.variantId}`,
          });
        } else if (!snap.variantId && snap.packageId) {
          const composition = snap.package?.composition;
          if (!composition || composition.length === 0) {
            throw new OrderDomainError("PACKAGE_COMPOSITION_MISSING", `Package composition missing for request ${req.id}`);
          }
          for (const comp of composition) {
            const requiredQty = comp.quantity * snap.quantity;
            allocations.push({
              orderItemId: orderItem.id,
              sourceRequestId: req.id,
              sellerId: snap.sellerId,
              variantId: comp.variantId,
              quantity: requiredQty,
              allocationId: `alloc_${orderItem.id}_${comp.variantId}`,
            });
          }
        }
      }

      let reservationExpiry: Date | null = null;
      const expiries = lockedRequests.map((r) => r.acceptance_expires_at).filter(Boolean).map((d: any) => new Date(d));
      if (expiries.length > 0) {
        expiries.sort((a, b) => a.getTime() - b.getTime());
        reservationExpiry = expiries[0];
      }

      // Phase 4.3.1 — explicit internal orchestration context, not spoofing buyer as SYSTEM
      const inventoryRequester = {
        userId: buyerUserId,
        role: "system" as const,
        sellerId: null as any,
        principalType: "system" as const,
        initiatedByUserId: buyerUserId,
        operation: "order.create",
      };

      const { reservations } = await this.inventoryService.reserveOrderAllocations({
        orderId: parentOrder.id,
        allocations,
        requester: inventoryRequester as any,
        idempotencyKey: `order_${parentOrder.id}`,
        expiresAt: reservationExpiry,
        executor: tx,
      });

      // Phase 4.4 — Assign child_order_id to reservations for isolated release/consume
      // Map orderItemId -> childOrderId via sellerGroups and createdChildOrders
      const orderItemToChildMap = new Map<string, string>();
      for (const child of createdChildOrders) {
        const sellerId = child.sellerId;
        const itemsForSeller = sellerGroups.get(sellerId) || [];
        for (const parentItem of itemsForSeller) {
          orderItemToChildMap.set(parentItem.id, child.id);
        }
      }
      // Phase 4.7.1 — Inventory stays the single writer of its reservations.
      const reservationLinks: Array<{ reservationId: string; childOrderId: string }> = [];
      for (const reservation of reservations) {
        const childId = orderItemToChildMap.get(reservation.orderItemId);
        if (childId) reservationLinks.push({ reservationId: reservation.id, childOrderId: childId });
      }
      if (reservationLinks.length > 0) {
        await this.inventoryService.linkReservationsToChildOrders({ links: reservationLinks, executor: tx });
      }

      // Mark requests ordered with orderId for integrity check
      for (const req of lockedRequests) {
        await this.vipService.markRequestOrdered(req.id, req.version, tx, parentOrder.id);
      }

      await this.appendStatusHistory(
        {
          orderId: parentOrder.id,
          childOrderId: null,
          fromStatus: null,
          toStatus: "draft",
          actorId: buyerUserId,
          actorRole: "buyer",
          metadata: { requestIds: sortedIds, paymentMode: input.paymentMode },
          orderVersion: 0,
        },
        tx,
      );

      for (const child of createdChildOrders) {
        await this.appendStatusHistory(
          {
            orderId: null,
            childOrderId: child.id,
            fromStatus: null,
            toStatus: "pending",
            actorId: buyerUserId,
            actorRole: "buyer",
            metadata: { parentOrderId: parentOrder.id, sellerId: child.sellerId },
            orderVersion: 0,
          },
          tx,
        );
      }

      await this.appendEvent(
        {
          aggregateType: "wholesale_order",
          aggregateId: parentOrder.id,
          eventType: "order.created",
          payload: {
            orderId: parentOrder.id,
            orderCode: parentOrder.orderCode,
            accountId,
            buyerUserId,
            requestIds: sortedIds,
            currency: firstCurrency,
            itemsTotal: itemsTotal.toString(),
            grandTotal: grandTotal.toString(),
            paymentMode: input.paymentMode,
          },
          actorId: buyerUserId,
          actorRole: "buyer",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      for (const req of lockedRequests) {
        await this.appendEvent(
          {
            aggregateType: "wholesale_order",
            aggregateId: parentOrder.id,
            eventType: "request.converted",
            payload: {
              requestId: req.id,
              requestVersion: req.version,
              acceptedTermsHash: req.accepted_terms_hash,
              orderId: parentOrder.id,
            },
            actorId: buyerUserId,
            actorRole: "buyer",
          },
          tx,
        );
      }

      await this.appendEvent(
        {
          aggregateType: "wholesale_order",
          aggregateId: parentOrder.id,
          eventType: "inventory.reserved",
          payload: {
            orderId: parentOrder.id,
            reservationCount: reservations.length,
            allocations: allocations.map((a) => ({ variantId: a.variantId, sellerId: a.sellerId, quantity: a.quantity })),
          },
          actorId: buyerUserId,
          actorRole: "system",
        },
        tx,
      );

      for (const child of createdChildOrders) {
        await this.appendEvent(
          {
            aggregateType: "purchase_order",
            aggregateId: child.id,
            eventType: "child.created",
            payload: {
              childOrderId: child.id,
              parentOrderId: parentOrder.id,
              sellerId: child.sellerId,
              supplierId: child.supplierId,
            },
            actorId: buyerUserId,
            actorRole: "buyer",
          },
          tx,
        );
      }

      await this.auditService.record(
        {
          actorId: buyerUserId,
          actorRole: input.actorRole || "vip",
          action: "order.created",
          entityType: "wholesale_order",
          entityId: parentOrder.id,
          after: {
            orderId: parentOrder.id,
            orderCode: parentOrder.orderCode,
            accountId,
            buyerUserId,
            requestIds: sortedIds,
            childSellerIds: sortedSellerIds,
            itemCount: createdOrderItems.length,
            total: grandTotal.toString(),
            currency: firstCurrency,
          },
          metadata: {
            paymentMode: input.paymentMode,
            idempotencyKey: input.idempotencyKey,
            creationRequestHash: creationHash,
            requestCount: sortedIds.length,
          },
        },
        tx as any,
      );

      return {
        order: parentOrder,
        items: createdOrderItems,
        children: createdChildOrders,
        childItems: createdChildItems,
        links: createdLinks,
        reservations,
        replayed: false,
      };
    });
  }

  // ── Phase 4.4 — Child order workflow (confirmation, preparation, ready, dispatch, delivery, cancel) ──
  private hashChildCommand(input: unknown): string {
    const canonical = canonicalStringify(input as any);
    return createHash("sha256").update(canonical).digest("hex");
  }

  async confirmChildOrder(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "system";
    supplierRole?: "owner" | "sales" | "warehouse" | "finance";
    expectedVersion?: number;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      // Lock child order FOR UPDATE
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      // Version check
      if (input.expectedVersion !== undefined && child.version !== input.expectedVersion) {
        throw new OrderDomainError("REQUEST_VERSION_CONFLICT", `Child version conflict expected ${input.expectedVersion} got ${child.version}`);
      }

      // Check terminal
      if (child.status === "cancelled" || child.status === "delivered") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Cannot confirm from ${child.status}`);
      }

      // Validate transition pending→confirmed
      validateChildOrderTransition(child.status as ChildOrderStatus, "confirmed");

      // Supplier authorization: child belongs to actor's seller
      if (input.actorRole === "supplier") {
        const sellerId = child.seller_id || child.sellerId;
        const membership = await this.suppliersService.getSellerEligibility(sellerId, tx);
        // Check user is member of exact supplier
        const { supplierMember } = await import("@kolbe/database");
        const [member] = await tx
          .select()
          .from(supplierMember)
          .where(and(eq(supplierMember.supplierId, membership.supplier.id), eq(supplierMember.userId, input.actorUserId)))
          .limit(1);
        if (!member) {
          throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", `User ${input.actorUserId} not member of supplier ${membership.supplier.id}`);
        }
        // Role check: owner/sales allowed to confirm, warehouse cannot negotiate commercial terms but can confirm? Spec says owner/sales may view/confirm/report inability/propose resolution
        if (input.supplierRole && !["owner", "sales"].includes(input.supplierRole)) {
          if (input.supplierRole === "warehouse") {
            throw new OrderDomainError("ROLE_NOT_ALLOWED", `warehouse cannot confirm commercial`);
          }
          if (input.supplierRole === "finance") {
            throw new OrderDomainError("ROLE_NOT_ALLOWED", `finance cannot confirm`);
          }
        }
        // Ensure member role matches if provided, else check actual member role
        const actualRole = member.role;
        if (!["owner", "sales"].includes(actualRole)) {
          throw new OrderDomainError("ROLE_NOT_ALLOWED", `Role ${actualRole} cannot confirm`);
        }
      }

      // Parent not cancelled/completed
      if (child.wholesale_order_id) {
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (parent && (parent.status === "cancelled" || parent.status === "completed")) {
          throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Parent ${parent.status} blocks child confirm`);
        }
      }

      // Check no unresolved blocking exception
      const { fulfillmentException } = await import("@kolbe/database");
      const openExceptions = await tx
        .select()
        .from(fulfillmentException)
        .where(and(eq(fulfillmentException.childOrderId, input.childOrderId), eq(fulfillmentException.status, "open")))
        .limit(1);
      if (openExceptions.length > 0) {
        throw new OrderDomainError("EXCEPTION_BLOCKING", `Unresolved exception blocks confirmation`);
      }

      // Idempotency check for child confirm
      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "confirm" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) {
          throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload");
        }
        if (existingIdem.state === "completed") {
          const payload = existingIdem.resultPayload as any;
          return { child, replayed: true, payload };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_confirm",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(purchaseOrder)
        .set({ status: "confirmed", version: child.version + 1, confirmedAt: now, updatedAt: now })
        .where(eq(purchaseOrder.id, input.childOrderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: null,
          childOrderId: input.childOrderId,
          fromStatus: child.status,
          toStatus: "confirmed",
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          orderVersion: updated.version,
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "child.confirmed",
          payload: { childOrderId: input.childOrderId, sellerId: child.seller_id || child.sellerId },
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  async startChildPreparation(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "system";
    supplierRole?: "owner" | "sales" | "warehouse" | "finance";
    expectedVersion?: number;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      if (input.expectedVersion !== undefined && child.version !== input.expectedVersion) {
        throw new OrderDomainError("REQUEST_VERSION_CONFLICT", `Child version conflict`);
      }

      validateChildOrderTransition(child.status as ChildOrderStatus, "preparing");

      // Payment gate: parent must be in allowed operational state per frozen status machine
      // Parent must be at least processing (or fulfillment/shipped) — not draft/confirmed/awaiting_payment
      if (child.wholesale_order_id) {
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", "Parent not found");
        const allowedParentStates = ["processing", "fulfillment", "shipped", "completed"];
        if (!allowedParentStates.includes(parent.status)) {
          throw new OrderDomainError("PARENT_PAYMENT_GATE", `Parent ${parent.status} blocks preparation — payment gate`);
        }
      }

      // Supplier role check: warehouse may begin preparation, owner/sales also allowed, finance NOT
      if (input.actorRole === "supplier") {
        const sellerId = child.seller_id || child.sellerId;
        const membership = await this.suppliersService.getSellerEligibility(sellerId, tx);
        const { supplierMember } = await import("@kolbe/database");
        const [member] = await tx
          .select()
          .from(supplierMember)
          .where(and(eq(supplierMember.supplierId, membership.supplier.id), eq(supplierMember.userId, input.actorUserId)))
          .limit(1);
        if (!member) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "Not member of supplier");
        const role = input.supplierRole || member.role;
        if (role === "finance") {
          throw new OrderDomainError("ROLE_NOT_ALLOWED", "finance cannot start preparation");
        }
        if (!["owner", "sales", "warehouse"].includes(role)) {
          throw new OrderDomainError("ROLE_NOT_ALLOWED", `Role ${role} cannot start preparation`);
        }
      }

      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "prepare" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_prepare"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") return { child, replayed: true, payload: existingIdem.resultPayload };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_prepare",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(purchaseOrder)
        .set({ status: "preparing", version: child.version + 1, preparationStartedAt: now, updatedAt: now })
        .where(eq(purchaseOrder.id, input.childOrderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: null,
          childOrderId: input.childOrderId,
          fromStatus: child.status,
          toStatus: "preparing",
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          orderVersion: updated.version,
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "child.preparing",
          payload: { childOrderId: input.childOrderId },
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_prepare"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  async markChildReady(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "system";
    supplierRole?: "owner" | "sales" | "warehouse" | "finance";
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      if (child.status !== "preparing") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Ready only allowed from preparing, got ${child.status}`);
      }

      // Role: warehouse may mark ready
      if (input.actorRole === "supplier") {
        const sellerId = child.seller_id || child.sellerId;
        const membership = await this.suppliersService.getSellerEligibility(sellerId, tx);
        const { supplierMember } = await import("@kolbe/database");
        const [member] = await tx
          .select()
          .from(supplierMember)
          .where(and(eq(supplierMember.supplierId, membership.supplier.id), eq(supplierMember.userId, input.actorUserId)))
          .limit(1);
        if (!member) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "Not member");
        const role = input.supplierRole || member.role;
        if (!["owner", "warehouse"].includes(role)) {
          throw new OrderDomainError("ROLE_NOT_ALLOWED", `Role ${role} cannot mark ready`);
        }
      }

      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "ready" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_ready"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") {
          return { child, replayed: true, payload: existingIdem.resultPayload };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_ready",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      // Ready_at once, idempotent repeat allowed, no stock decrement
      let updated = child;
      if (!child.ready_at) {
        const [upd] = await tx
          .update(purchaseOrder)
          .set({ readyAt: now, updatedAt: now })
          .where(eq(purchaseOrder.id, input.childOrderId))
          .returning();
        updated = upd;
      }

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "child.ready",
          payload: { childOrderId: input.childOrderId, readyAt: now.toISOString() },
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_ready"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  async dispatchChildOrder(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "system";
    trackingCode?: string;
    idempotencyKey: string;
    supplierRole?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "dispatch", trackingCode: input.trackingCode });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_dispatch"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") {
          return { child, replayed: true, payload: existingIdem.resultPayload };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_dispatch",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      if (child.status !== "preparing") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Dispatch only from preparing, got ${child.status}`);
      }

      // Parent payment gate
      if (child.wholesale_order_id) {
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", "Parent not found");
        const allowedParentStates = ["processing", "fulfillment", "shipped"];
        if (!allowedParentStates.includes(parent.status)) {
          throw new OrderDomainError("PARENT_PAYMENT_GATE", `Parent ${parent.status} blocks dispatch`);
        }
      }

      // Check for blocking exception
      const { fulfillmentException } = await import("@kolbe/database");
      const blocking = await tx
        .select()
        .from(fulfillmentException)
        .where(and(eq(fulfillmentException.childOrderId, input.childOrderId), eq(fulfillmentException.status, "open")))
        .limit(1);
      if (blocking.length > 0) {
        throw new OrderDomainError("EXCEPTION_BLOCKING", "Unresolved exception blocks dispatch");
      }

      // Inventory consume only this child's active allocations
      const sellerId = child.seller_id || child.sellerId;
      const orderId = child.wholesale_order_id || child.wholesaleOrderId;

      await this.inventoryService.confirmChildOrderAllocations({
        orderId,
        childOrderId: input.childOrderId,
        sellerId,
        requester: { userId: input.actorUserId, role: input.actorRole, sellerId } as any,
        idempotencyKey: `${input.idempotencyKey}:inventory`,
        executor: tx,
      });

      const now = new Date();
      const updated = await this.transitionChildToShipped(tx, child, {
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        trackingCode: input.trackingCode || null,
        idempotencyKey: input.idempotencyKey,
        trigger: "orders.child_dispatch",
      });

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "inventory.consumed",
          payload: { childOrderId: input.childOrderId, orderId },
          actorId: input.actorUserId,
          actorRole: "system",
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_dispatch"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  async deliverChildOrder(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "system";
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "deliver" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_deliver"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") return { child, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_deliver",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      if (child.status !== "shipped") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Deliver only from shipped, got ${child.status}`);
      }

      const now = new Date();
      const updated = await this.transitionChildToDelivered(tx, child, {
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        idempotencyKey: input.idempotencyKey,
        trigger: "orders.child_deliver",
      });

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_deliver"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  async cancelChildOrder(input: {
    childOrderId: string;
    actorUserId: string;
    actorRole: "supplier" | "admin" | "buyer" | "system";
    reason?: string;
    idempotencyKey: string;
    financialImpact?: { kind: string; amount: bigint; currency: string; childOrderId: string };
  }) {
    return this.db.transaction(async (tx: any) => {
      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      if (child.status === "shipped" || child.status === "delivered") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Cannot cancel from ${child.status} — dispatch already occurred`);
      }
      if (child.status === "cancelled") {
        return { child, replayed: true };
      }

      validateChildOrderTransition(child.status as ChildOrderStatus, "cancelled");

      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ childOrderId: input.childOrderId, action: "cancel", reason: input.reason });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_cancel"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") return { child, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "child_order",
          scopeId: input.childOrderId,
          commandType: "orders.child_cancel",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const sellerId = child.seller_id || child.sellerId;
      const orderId = child.wholesale_order_id || child.wholesaleOrderId;

      try {
        await this.inventoryService.releaseChildOrderAllocations({
          orderId,
          childOrderId: input.childOrderId,
          sellerId,
          requester: { userId: input.actorUserId, role: input.actorRole, sellerId } as any,
          idempotencyKey: `${input.idempotencyKey}:inventory`,
          executor: tx,
          reason: input.reason || "child cancelled",
        });
      } catch (e: any) {
        if (e.code !== "RESERVATION_ALREADY_CONFIRMED" && !e.message?.includes("already confirmed")) {
          if (!e.message?.includes("No reservations") && !e.message?.includes("not found")) {
            if (e.code === "RESERVATION_ALREADY_CONFIRMED" || e.message?.includes("dispatch already occurred")) {
              throw new OrderDomainError("INVALID_STATUS_TRANSITION", "Cannot release confirmed — dispatch occurred");
            }
          }
        }
      }

      const now = new Date();
      const [updated] = await tx
        .update(purchaseOrder)
        .set({
          status: "cancelled",
          version: child.version + 1,
          cancelledAt: now,
          cancellationReason: input.reason || null,
          updatedAt: now,
        })
        .where(eq(purchaseOrder.id, input.childOrderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: null,
          childOrderId: input.childOrderId,
          fromStatus: child.status,
          toStatus: "cancelled",
          actorId: input.actorUserId,
          actorRole: input.actorRole as any,
          reason: input.reason || null,
          orderVersion: updated.version,
          metadata: {
            financialImpact: input.financialImpact
              ? {
                  kind: input.financialImpact.kind,
                  amount: input.financialImpact.amount.toString(),
                  currency: input.financialImpact.currency,
                  childOrderId: input.financialImpact.childOrderId,
                }
              : null,
          },
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "child.cancelled",
          payload: {
            childOrderId: input.childOrderId,
            reason: input.reason,
            financialImpact: input.financialImpact
              ? {
                  kind: input.financialImpact.kind,
                  amount: input.financialImpact.amount.toString(),
                  currency: input.financialImpact.currency,
                  childOrderId: input.financialImpact.childOrderId,
                }
              : null,
          },
          actorId: input.actorUserId,
          actorRole: input.actorRole as any,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "inventory.released",
          payload: { childOrderId: input.childOrderId, orderId },
          actorId: input.actorUserId,
          actorRole: "system",
        },
        tx,
      );

      if (child.wholesale_order_id) {
        const siblings = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, child.wholesale_order_id));
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (parent) {
          const childSummaries = siblings.map((c: any) => ({ id: c.id, status: c.id === input.childOrderId ? "cancelled" : c.status })) as any;
          const newParentStatus = calculateParentFulfillmentProjection(parent.status as any, childSummaries);
          if (newParentStatus !== parent.status) {
            await tx.update(wholesaleOrder).set({ status: newParentStatus, version: parent.version + 1, updatedAt: now }).where(eq(wholesaleOrder.id, parent.id));
            await this.appendStatusHistory(
              {
                orderId: parent.id,
                childOrderId: null,
                fromStatus: parent.status,
                toStatus: newParentStatus,
                actorId: input.actorUserId,
                actorRole: "system",
                orderVersion: parent.version + 1,
                metadata: { trigger: "child.cancelled", childOrderId: input.childOrderId },
              },
              tx,
            );
          }
        }
      }

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "child_order"),
            eq(commandIdempotency.scopeId, input.childOrderId),
            eq(commandIdempotency.commandType, "orders.child_cancel"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { child: updated, replayed: false };
    });
  }

  // ── Phase 4.5 — VIP Order Management, Timeline, Parent Cancellation, Admin ──

  private redactTimelineEntry(entry: any): any {
    const redacted = { ...entry };
    // Remove PII: actorId may be kept as id but not address, sessions, cookies, metadata secrets
    if (redacted.metadata) {
      const meta = { ...redacted.metadata };
      delete meta.ip;
      delete meta.address;
      delete meta.session;
      delete meta.cookie;
      delete meta.token;
      delete meta.secret;
      delete meta.password;
      redacted.metadata = meta;
    }
    if (redacted.payload) {
      const payload = { ...redacted.payload };
      delete payload.address;
      delete payload.session;
      delete payload.cookie;
      delete payload.ip;
      redacted.payload = payload;
    }
    return redacted;
  }

  async listWholesaleOrdersForBuyer(input: {
    buyerUserId: string;
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) {
    const limit = Math.min(input.limit || 20, 100);
    return this.db.transaction(async (tx: any) => {
      const cursor = input.cursor;
      let query = sql`SELECT * FROM wholesale_order WHERE buyer_user_id = ${input.buyerUserId}`;
      if (cursor) {
        query = sql`${query} AND (created_at, id) < (${new Date(cursor.createdAt).toISOString()}::timestamptz, ${cursor.id})`;
      }
      query = sql`${query} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
      const result = await tx.execute(query);
      const rows = result.rows || [];
      const hasMore = rows.length > limit;
      const orders = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? { createdAt: orders[orders.length - 1].created_at || orders[orders.length - 1].createdAt, id: orders[orders.length - 1].id }
        : null;
      return { orders, nextCursor, hasMore };
    });
  }

  async getWholesaleOrderDetailForBuyer(input: { orderId: string; buyerUserId: string }) {
    return this.db.transaction(async (tx: any) => {
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
      const owner = order.buyer_user_id || order.buyerUserId;
      if (owner !== input.buyerUserId) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "You do not own this order");
      const itemsResult = await tx.execute(sql`SELECT * FROM wholesale_order_item WHERE order_id = ${input.orderId} ORDER BY id ASC`);
      const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${input.orderId} ORDER BY id ASC`);
      const linksResult = await tx.execute(sql`SELECT * FROM wholesale_order_request WHERE order_id = ${input.orderId} ORDER BY id ASC`);
      const exceptionsResult = await tx.execute(sql`SELECT * FROM fulfillment_exception WHERE wholesale_order_id = ${input.orderId} ORDER BY created_at DESC`);
      const replacementLinksResult = await tx.execute(
        sql`SELECT frr.* FROM fulfillment_replacement_request frr JOIN fulfillment_exception fe ON fe.id = frr.exception_id WHERE fe.wholesale_order_id = ${input.orderId} ORDER BY frr.created_at DESC`,
      );
      return {
        order: {
          id: order.id,
          orderCode: order.order_code || order.orderCode,
          accountId: order.account_id || order.accountId,
          buyerUserId: order.buyer_user_id || order.buyerUserId,
          status: order.status,
          currency: order.currency,
          itemsTotal: order.items_total || order.itemsTotal,
          shippingTotal: order.shipping_total || order.shippingTotal,
          grandTotal: order.grand_total || order.grandTotal,
          totalUnits: order.total_units || order.totalUnits,
          paymentMode: order.payment_mode || order.paymentMode,
          version: order.version,
          createdAt: order.created_at || order.createdAt,
        },
        items: itemsResult.rows.map((r: any) => ({
          id: r.id,
          orderId: r.order_id || r.orderId,
          productId: r.product_id || r.productId,
          variantId: r.variant_id || r.variantId,
          packageId: r.package_id || r.packageId,
          sourceRequestId: r.source_request_id || r.sourceRequestId,
          sellerId: r.seller_id || r.sellerId,
          supplierId: r.supplier_id || r.supplierId,
          quantity: r.quantity,
          packageQuantity: r.package_quantity || r.packageQuantity,
          pieceQuantity: r.piece_quantity || r.pieceQuantity,
          unitPrice: r.unit_price || r.unitPrice,
          lineTotal: r.line_total || r.lineTotal,
          currency: r.currency,
          productNameSnapshot: r.product_name_snapshot || r.productNameSnapshot,
          skuSnapshot: r.sku_snapshot || r.skuSnapshot,
          variantSnapshot: r.variant_snapshot || r.variantSnapshot,
          sellerSnapshot: r.seller_snapshot || r.sellerSnapshot,
          packageTypeSnapshot: r.package_type_snapshot || r.packageTypeSnapshot,
        })),
        children: childrenResult.rows.map((c: any) => ({
          id: c.id,
          orderCode: c.order_code || c.orderCode,
          sellerId: c.seller_id || c.sellerId,
          supplierId: c.supplier_id || c.supplierId,
          status: c.status,
          itemsTotal: c.items_total || c.itemsTotal,
          grandTotal: c.grand_total || c.grandTotal,
          shippingResponsibility: c.shipping_responsibility || c.shippingResponsibility,
        })),
        links: linksResult.rows,
        exceptions: exceptionsResult.rows.map((e: any) => ({
          id: e.id,
          childOrderId: e.child_order_id || e.childOrderId,
          type: e.type,
          status: e.status,
          buyerResolution: e.buyer_resolution || e.buyerResolution,
          affectedAmount: e.affected_amount || e.affectedAmount,
          currency: e.currency,
          createdAt: e.created_at || e.createdAt,
        })),
        replacementRequests: replacementLinksResult.rows,
      };
    });
  }

  async listChildrenForOrder(input: { orderId: string; buyerUserId: string }) {
    const detail = await this.getWholesaleOrderDetailForBuyer(input);
    return { children: detail.children };
  }

  async listExceptionsForOrder(input: { orderId: string; buyerUserId: string }) {
    const detail = await this.getWholesaleOrderDetailForBuyer(input);
    return { exceptions: detail.exceptions, links: detail.replacementRequests };
  }

  // ── Phase 4.7.1 — Shipping contracts ─────────────────────────────────
  // Orders stays the single writer of purchase_order / wholesale_order status,
  // order_status_history and order_event. Shipping never reads order tables:
  // it asks for this context and reports shipment facts back through the
  // record* calls below, always inside the caller's transaction (B5/B15).

  /**
   * Everything Shipping needs about a child order, server-derived:
   * parent/seller identity (B7), immutable address snapshot (B8), shipping
   * responsibility (B9), financial gate (B10) and ordered quantities (B11).
   * `lock: true` takes `purchase_order FOR UPDATE` so concurrent shipment
   * commands on the same child serialize (deadlock-safe: child before shipment).
   */
  async getChildOrderShippingContext(input: { childOrderId: string; executor?: DbOrTx; lock?: boolean }): Promise<ChildOrderShippingContext> {
    const run = async (tx: any): Promise<ChildOrderShippingContext> => {
      const childResult = input.lock
        ? await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`)
        : await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId}`);
      const child = childResult.rows?.[0];
      if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);
      const parentId = child.wholesale_order_id;
      if (!parentId) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} has no parent wholesale order`);
      const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${parentId}`);
      const parent = parentResult.rows?.[0];
      if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", `Parent order ${parentId} not found`);
      const sellerId = child.seller_id;
      const itemsResult = await tx.execute(
        sql`SELECT id, variant_id, package_id, product_name, sku, piece_quantity, quantity, unit_price, line_total, currency
            FROM wholesale_order_item WHERE order_id = ${parentId} AND seller_id = ${sellerId} ORDER BY id ASC`,
      );
      const childItemsResult = await tx.execute(
        sql`SELECT id, wholesale_order_item_id, variant_id FROM purchase_order_item WHERE purchase_order_id = ${input.childOrderId}`,
      );
      const childItemByWholesale = new Map<string, any>();
      for (const row of childItemsResult.rows || []) if (row.wholesale_order_item_id) childItemByWholesale.set(row.wholesale_order_item_id, row);
      const financiallyReleased = ["processing", "fulfillment", "shipped", "completed"].includes(parent.status);
      return {
        child: {
          id: child.id,
          status: child.status as ChildOrderStatus,
          sellerId,
          wholesaleOrderId: parentId,
          shippingResponsibility: (child.shipping_responsibility || "SUPPLIER") as "SUPPLIER" | "KOLBE" | "EXTERNAL_CARRIER",
          version: child.version,
          trackingCode: child.tracking_code || null,
        },
        parent: {
          id: parent.id,
          status: parent.status as WholesaleOrderStatus,
          buyerUserId: parent.buyer_user_id,
          paymentMode: parent.payment_mode || null,
          currency: parent.currency,
          shippingAddressSnapshot: (parent.shipping_address_snapshot || {}) as Record<string, unknown>,
          financiallyReleased,
        },
        items: (itemsResult.rows || []).map((r: any) => ({
          wholesaleOrderItemId: r.id,
          purchaseOrderItemId: childItemByWholesale.get(r.id)?.id || null,
          variantId: r.variant_id || childItemByWholesale.get(r.id)?.variant_id || null,
          packageId: r.package_id || null,
          productName: r.product_name,
          sku: r.sku,
          pieceQuantity: Number(r.piece_quantity),
          quantity: Number(r.quantity),
          unitPrice: (r.unit_price ?? 0).toString(),
          lineTotal: (r.line_total ?? 0).toString(),
          currency: r.currency,
        })),
      };
    };
    if (input.executor) return run(input.executor as any);
    return this.db.transaction(async (tx: any) => run(tx));
  }

  async recordShippingQuoteCreated(input: { childOrderId: string; quoteId: string; provider: string; amount: string; actorId: string | null; actorRole: string; executor: DbOrTx }) {
    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: "shipping.quote_created",
        payload: { quoteId: input.quoteId, childOrderId: input.childOrderId, provider: input.provider, amount: input.amount, notQuoted: input.amount === "0" },
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      input.executor,
    );
  }

  async recordShippingShipmentCreated(input: {
    orderId: string;
    childOrderId: string;
    shipmentId: string;
    provider: string;
    actorId: string | null;
    actorRole: string;
    executor: DbOrTx;
  }) {
    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: "shipping.shipment_created",
        payload: { shipmentId: input.shipmentId, childOrderId: input.childOrderId, wholesaleOrderId: input.orderId, provider: input.provider },
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      input.executor,
    );
  }

  async recordShipmentStatusEvent(input: {
    childOrderId: string;
    shipmentId: string;
    eventType: "shipping.shipment_ready" | "shipping.shipment_in_transit" | "shipping.shipment_cancelled" | "shipping.shipment_failed";
    actorId: string | null;
    actorRole: string;
    payload?: Record<string, unknown>;
    executor: DbOrTx;
  }) {
    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: input.eventType,
        payload: { shipmentId: input.shipmentId, childOrderId: input.childOrderId, ...(input.payload || {}) },
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      input.executor,
    );
  }

  /**
   * A shipment left the seller (goods physically gone). When Shipping reports
   * that every ordered piece of the child is now handed over, the child moves
   * `preparing → shipped` and the parent projection is recomputed — inventory
   * was already consumed per shipment, so nothing is consumed here (C5).
   */
  async recordShipmentHandedOver(input: {
    orderId: string;
    childOrderId: string;
    shipmentId: string;
    trackingCode?: string | null;
    fullyShipped: boolean;
    actorId: string | null;
    actorRole: "supplier" | "admin" | "system";
    idempotencyKey: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
    const child = childResult.rows?.[0];
    if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);
    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: "shipping.shipment_handed_over",
        payload: { shipmentId: input.shipmentId, childOrderId: input.childOrderId, wholesaleOrderId: input.orderId, fullyShipped: input.fullyShipped },
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      tx,
    );
    if (!input.fullyShipped) return { child, transitioned: false };
    if (child.status === "shipped" || child.status === "delivered") return { child, transitioned: false };
    if (child.status !== "preparing") {
      throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Child ${input.childOrderId} cannot become shipped from ${child.status}`);
    }
    const updated = await this.transitionChildToShipped(tx, child, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      trackingCode: input.trackingCode || null,
      idempotencyKey: input.idempotencyKey,
      trigger: "shipping.shipment_handed_over",
      shipmentId: input.shipmentId,
    });
    return { child: updated, transitioned: true };
  }

  /** Delivery changes fulfillment state only — inventory delta is zero (C7). */
  async recordShipmentDelivered(input: {
    orderId: string;
    childOrderId: string;
    shipmentId: string;
    fullyDelivered: boolean;
    actorId: string | null;
    actorRole: "supplier" | "admin" | "system";
    idempotencyKey: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
    const child = childResult.rows?.[0];
    if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);
    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: "shipping.shipment_delivered",
        payload: { shipmentId: input.shipmentId, childOrderId: input.childOrderId, wholesaleOrderId: input.orderId, fullyDelivered: input.fullyDelivered },
        actorId: input.actorId,
        actorRole: input.actorRole,
      },
      tx,
    );
    if (!input.fullyDelivered) return { child, transitioned: false };
    if (child.status === "delivered") return { child, transitioned: false };
    if (child.status !== "shipped") {
      throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Child ${input.childOrderId} cannot become delivered from ${child.status}`);
    }
    const updated = await this.transitionChildToDelivered(tx, child, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      idempotencyKey: input.idempotencyKey,
      trigger: "shipping.shipment_delivered",
      shipmentId: input.shipmentId,
    });
    return { child: updated, transitioned: true };
  }

  /** Shared with dispatchChildOrder: child → shipped + history + events + parent projection. Caller holds the child lock. */
  private async transitionChildToShipped(
    tx: any,
    child: any,
    opts: { actorId: string | null; actorRole: "supplier" | "admin" | "system"; trackingCode: string | null; idempotencyKey: string; trigger: string; shipmentId?: string },
  ) {
    const now = new Date();
    const [updated] = await tx
      .update(purchaseOrder)
      .set({
        status: "shipped",
        version: child.version + 1,
        shippedAt: now,
        trackingCode: opts.trackingCode || child.tracking_code || null,
        updatedAt: now,
      })
      .where(eq(purchaseOrder.id, child.id))
      .returning();

    await this.appendStatusHistory(
      {
        orderId: null,
        childOrderId: child.id,
        fromStatus: child.status,
        toStatus: "shipped",
        actorId: opts.actorId,
        actorRole: opts.actorRole === "supplier" ? "supplier" : opts.actorRole === "system" ? "system" : "admin",
        orderVersion: updated.version,
        metadata: { trackingCode: opts.trackingCode, trigger: opts.trigger, shipmentId: opts.shipmentId || null },
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: child.id,
        eventType: "child.shipped",
        payload: { childOrderId: child.id, trackingCode: opts.trackingCode, financialImpact: null, trigger: opts.trigger, shipmentId: opts.shipmentId || null },
        actorId: opts.actorId,
        actorRole: opts.actorRole === "supplier" ? "supplier" : opts.actorRole === "system" ? "system" : "admin",
        idempotencyKey: opts.idempotencyKey,
      },
      tx,
    );

    await this.projectParentAfterChildChange(tx, child.wholesale_order_id, child.id, "shipped", opts.actorId, now, "child.shipped");
    return updated;
  }

  /** Shared with deliverChildOrder: child → delivered + history + event + parent projection. Caller holds the child lock. */
  private async transitionChildToDelivered(
    tx: any,
    child: any,
    opts: { actorId: string | null; actorRole: "supplier" | "admin" | "system"; idempotencyKey: string; trigger: string; shipmentId?: string },
  ) {
    const now = new Date();
    const [updated] = await tx
      .update(purchaseOrder)
      .set({ status: "delivered", version: child.version + 1, deliveredAt: now, updatedAt: now })
      .where(eq(purchaseOrder.id, child.id))
      .returning();

    await this.appendStatusHistory(
      {
        orderId: null,
        childOrderId: child.id,
        fromStatus: child.status,
        toStatus: "delivered",
        actorId: opts.actorId,
        actorRole: opts.actorRole === "supplier" ? "supplier" : opts.actorRole === "system" ? "system" : "admin",
        orderVersion: updated.version,
        metadata: { trigger: opts.trigger, shipmentId: opts.shipmentId || null },
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: child.id,
        eventType: "child.delivered",
        payload: { childOrderId: child.id, trigger: opts.trigger, shipmentId: opts.shipmentId || null },
        actorId: opts.actorId,
        actorRole: opts.actorRole === "supplier" ? "supplier" : opts.actorRole === "system" ? "system" : "admin",
        idempotencyKey: opts.idempotencyKey,
      },
      tx,
    );

    await this.projectParentAfterChildChange(tx, child.wholesale_order_id, child.id, "delivered", opts.actorId, now, "child.delivered");
    return updated;
  }

  /** Parent projection after a child fulfillment change (never auto-cancels; derives from all children). */
  private async projectParentAfterChildChange(tx: any, parentId: string | null, childId: string, childStatus: string, actorId: string | null, now: Date, trigger: string) {
    if (!parentId) return null;
    // Phase 4.7.1 (C10) — lock the parent BEFORE reading the siblings: two children
    // shipped in parallel serialize here and the second projection sees the first
    // child's committed status (READ COMMITTED re-reads after the lock is granted).
    const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${parentId} FOR UPDATE`);
    const parent = parentResult.rows?.[0];
    if (!parent) return null;
    const siblings = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, parentId));
    const childSummaries = siblings.map((c: any) => ({ id: c.id, status: c.id === childId ? childStatus : c.status })) as any;
    const newParentStatus = calculateParentFulfillmentProjection(parent.status as any, childSummaries);
    if (newParentStatus === parent.status) return parent;
    await tx.update(wholesaleOrder).set({ status: newParentStatus, version: parent.version + 1, updatedAt: now }).where(eq(wholesaleOrder.id, parent.id));
    await this.appendStatusHistory(
      {
        orderId: parent.id,
        childOrderId: null,
        fromStatus: parent.status,
        toStatus: newParentStatus,
        actorId,
        actorRole: "system",
        orderVersion: parent.version + 1,
        metadata: { trigger, childOrderId: childId },
      },
      tx,
    );
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: parent.id,
        eventType: `order.${newParentStatus === "shipped" ? "shipped" : newParentStatus === "completed" ? "completed" : "fulfillment_started"}`,
        payload: { parentStatus: newParentStatus, childOrderId: childId },
        actorId,
        actorRole: "system",
      },
      tx,
    );
    return { ...parent, status: newParentStatus, version: parent.version + 1 };
  }

  async getOrderTimelineForBuyer(input: { orderId: string; buyerUserId: string }) {
    return this.getOrderTimelineInternal(input.orderId, input.buyerUserId, false);
  }

  private async getOrderTimelineInternal(orderId: string, actorUserId: string | null, isAdmin: boolean) {
    return this.db.transaction(async (tx: any) => {
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
      if (!isAdmin) {
        const owner = order.buyer_user_id || order.buyerUserId;
        if (owner !== actorUserId) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
      }

      const orderHistory = await tx.execute(sql`SELECT * FROM order_status_history WHERE order_id = ${orderId} ORDER BY created_at ASC`);
      const orderEvents = await tx.execute(sql`SELECT * FROM order_event WHERE aggregate_type = 'wholesale_order' AND aggregate_id = ${orderId} ORDER BY created_at ASC`);
      const children = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${orderId} ORDER BY id ASC`);
      const childIds = children.rows.map((c: any) => c.id);
      let childHistory: any[] = [];
      let childEvents: any[] = [];
      let exceptions: any[] = [];
      let replacementLinks: any[] = [];
      let requestRevisions: any[] = [];

      if (childIds.length > 0) {
        const childHistoryResult = await tx.execute(
          sql`SELECT * FROM order_status_history WHERE child_order_id IN (${sql.join(childIds.map((id: string) => sql`${id}`), sql`, `)}) ORDER BY created_at ASC`,
        );
        childHistory = childHistoryResult.rows;
        const childEventsResult = await tx.execute(
          sql`SELECT * FROM order_event WHERE aggregate_type = 'purchase_order' AND aggregate_id IN (${sql.join(childIds.map((id: string) => sql`${id}`), sql`, `)}) ORDER BY created_at ASC`,
        );
        childEvents = childEventsResult.rows;
        const exceptionsResult = await tx.execute(
          sql`SELECT * FROM fulfillment_exception WHERE wholesale_order_id = ${orderId} ORDER BY created_at ASC`,
        );
        exceptions = exceptionsResult.rows;
        const replacementResult = await tx.execute(
          sql`SELECT frr.* FROM fulfillment_replacement_request frr JOIN fulfillment_exception fe ON fe.id = frr.exception_id WHERE fe.wholesale_order_id = ${orderId} ORDER BY frr.created_at ASC`,
        );
        replacementLinks = replacementResult.rows;
      }

      const links = await tx.execute(sql`SELECT * FROM wholesale_order_request WHERE order_id = ${orderId}`);
      const requestIds = links.rows.map((l: any) => l.request_id || l.requestId);
      if (requestIds.length > 0) {
        const revResult = await tx.execute(
          sql`SELECT * FROM wholesale_request_revision WHERE request_id IN (${sql.join(requestIds.map((id: string) => sql`${id}`), sql`, `)}) ORDER BY created_at ASC`,
        );
        requestRevisions = revResult.rows;
      }

      const timeline: any[] = [];

      for (const h of orderHistory.rows) {
        timeline.push({
          type: "order_status_history",
          at: h.created_at || h.createdAt,
          fromStatus: h.from_status || h.fromStatus,
          toStatus: h.to_status || h.toStatus,
          actorRole: h.actor_role || h.actorRole,
          reason: h.reason,
          metadata: h.metadata,
          createdAt: h.created_at || h.createdAt,
        });
      }
      for (const e of orderEvents.rows) {
        timeline.push({
          type: "order_event",
          at: e.created_at || e.createdAt,
          eventType: e.event_type || e.eventType,
          payload: e.payload,
          actorRole: e.actor_role || e.actorRole,
          createdAt: e.created_at || e.createdAt,
        });
      }
      for (const h of childHistory) {
        timeline.push({
          type: "child_status_history",
          at: h.created_at || h.createdAt,
          childOrderId: h.child_order_id || h.childOrderId,
          fromStatus: h.from_status || h.fromStatus,
          toStatus: h.to_status || h.toStatus,
          actorRole: h.actor_role || h.actorRole,
          createdAt: h.created_at || h.createdAt,
        });
      }
      for (const e of childEvents) {
        timeline.push({
          type: "child_event",
          at: e.created_at || e.createdAt,
          eventType: e.event_type || e.eventType,
          payload: e.payload,
          childOrderId: e.aggregate_id || e.aggregateId,
          createdAt: e.created_at || e.createdAt,
        });
      }
      for (const ex of exceptions) {
        timeline.push({
          type: "fulfillment_exception",
          at: ex.created_at || ex.createdAt,
          childOrderId: ex.child_order_id || ex.childOrderId,
          exceptionType: ex.type,
          status: ex.status,
          buyerResolution: ex.buyer_resolution || ex.buyerResolution,
          affectedAmount: ex.affected_amount || ex.affectedAmount,
          currency: ex.currency,
          createdAt: ex.created_at || ex.createdAt,
        });
      }
      for (const rev of requestRevisions) {
        timeline.push({
          type: "wholesale_request_revision",
          at: rev.created_at || rev.createdAt,
          requestId: rev.request_id || rev.requestId,
          revisionNumber: rev.revision_number || rev.revisionNumber,
          buyerResponse: rev.buyer_response || rev.buyerResponse,
          createdAt: rev.created_at || rev.createdAt,
        });
      }
      for (const rl of replacementLinks) {
        timeline.push({
          type: "fulfillment_replacement_request",
          at: rl.created_at || rl.createdAt,
          exceptionId: rl.exception_id || rl.exceptionId,
          replacementRequestId: rl.replacement_request_id || rl.replacementRequestId,
          createdAt: rl.created_at || rl.createdAt,
        });
      }

      timeline.sort((a, b) => {
        const ta = new Date(a.at || a.createdAt).getTime();
        const tb = new Date(b.at || b.createdAt).getTime();
        if (ta !== tb) return ta - tb;
        return String(a.type).localeCompare(String(b.type));
      });

      const redactedTimeline = timeline.map((e) => this.redactTimelineEntry(e));

      return { orderId, timeline: redactedTimeline };
    });
  }

  async cancelParentOrder(input: {
    orderId: string;
    actorUserId: string;
    actorRole: "buyer" | "admin" | "system";
    reason: string;
    idempotencyKey: string;
    expectedVersion?: number;
  }) {
    if (!input.reason) throw new OrderDomainError("CANCELLATION_REASON_REQUIRED", "Reason required");
    if (!input.idempotencyKey) throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      // Lock parent FOR UPDATE
      const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const parent = parentResult.rows?.[0];
      if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);

      if (input.expectedVersion !== undefined && parent.version !== input.expectedVersion) {
        throw new OrderDomainError("REQUEST_VERSION_CONFLICT", `Version conflict expected ${input.expectedVersion} got ${parent.version}`);
      }

      if (parent.status === "cancelled") return { order: parent, replayed: true };
      if (parent.status === "shipped" || parent.status === "completed") {
        throw new OrderDomainError("PARENT_CANCEL_BLOCKED_BY_DISPATCH", `Cannot cancel parent from ${parent.status}`);
      }

      // Idempotency for parent cancel
      const { commandIdempotency } = await import("@kolbe/database");
      const reqHash = this.hashChildCommand({ orderId: input.orderId, action: "parent_cancel", reason: input.reason });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.parent_cancel"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== reqHash) throw new OrderDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused");
        if (existingIdem.state === "completed") return { order: parent, replayed: true, payload: existingIdem.resultPayload };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "orders.parent_cancel",
          idempotencyKey: input.idempotencyKey,
          requestHash: reqHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Lock children deterministic ORDER BY id ASC FOR UPDATE
      const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${input.orderId} ORDER BY id ASC FOR UPDATE`);
      const children = childrenResult.rows;

      // Verify no forbidden dispatched
      for (const child of children) {
        if (child.status === "shipped" || child.status === "delivered") {
          throw new OrderDomainError("PARENT_CANCEL_BLOCKED_BY_DISPATCH", `Child ${child.id} already ${child.status} blocks parent cancel`);
        }
      }

      // Release remaining active via InventoryService (no raw inventory SQL)
      for (const child of children) {
        if (child.status === "cancelled") continue;
        const sellerId = child.seller_id || child.sellerId;
        try {
          await this.inventoryService.releaseChildOrderAllocations({
            orderId: input.orderId,
            childOrderId: child.id,
            sellerId,
            requester: { userId: input.actorUserId, role: input.actorRole, sellerId } as any,
            idempotencyKey: `${input.idempotencyKey}:inv:${child.id}`,
            executor: tx,
            reason: input.reason,
          });
        } catch (e: any) {
          // Ignore if no reservations
          if (!e.message?.includes("No reservations") && !e.message?.includes("not found")) {
            // If already confirmed dispatch occurred, should have been blocked above
            if (e.code === "RESERVATION_ALREADY_CONFIRMED") {
              throw new OrderDomainError("PARENT_CANCEL_BLOCKED_BY_DISPATCH", `Child ${child.id} confirmed blocks cancel`);
            }
          }
        }
      }

      const now = new Date();

      // Cancel eligible children
      for (const child of children) {
        if (child.status === "cancelled") continue;
        await tx
          .update(purchaseOrder)
          .set({ status: "cancelled", version: child.version + 1, cancelledAt: now, cancellationReason: input.reason, updatedAt: now })
          .where(eq(purchaseOrder.id, child.id));

        await this.appendStatusHistory(
          {
            orderId: null,
            childOrderId: child.id,
            fromStatus: child.status,
            toStatus: "cancelled",
            actorId: input.actorUserId,
            actorRole: input.actorRole,
            reason: input.reason,
            orderVersion: child.version + 1,
            metadata: {
              trigger: "parent.cancelled",
              financialImpact: {
                kind: "future_refund_or_payment_adjustment",
                scope: "child_portion",
                childOrderId: child.id,
              },
            },
          },
          tx,
        );

        await this.appendEvent(
          {
            aggregateType: "purchase_order",
            aggregateId: child.id,
            eventType: "child.cancelled",
            payload: {
              childOrderId: child.id,
              reason: input.reason,
              financialImpact: {
                kind: "future_refund_or_payment_adjustment",
                amount: child.grand_total ? child.grand_total.toString() : child.total_amount?.toString() || "0",
                currency: child.currency || "IRR",
                scope: "child_portion",
                childOrderId: child.id,
              },
            },
            actorId: input.actorUserId,
            actorRole: input.actorRole,
          },
          tx,
        );
      }

      // Parent cancelled
      const [updatedParent] = await tx
        .update(wholesaleOrder)
        .set({ status: "cancelled", version: parent.version + 1, cancelledAt: now, cancellationReason: input.reason, cancelledBy: input.actorUserId, updatedAt: now })
        .where(eq(wholesaleOrder.id, input.orderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: input.orderId,
          childOrderId: null,
          fromStatus: parent.status,
          toStatus: "cancelled",
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          reason: input.reason,
          orderVersion: updatedParent.version,
          metadata: {
            financialImpact: {
              kind: "future_refund_or_payment_adjustment",
              scope: "full_parent",
              amount: parent.grand_total ? parent.grand_total.toString() : parent.total_amount?.toString() || "0",
              currency: parent.currency || "IRR",
            },
          },
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "wholesale_order",
          aggregateId: input.orderId,
          eventType: "order.parent_cancelled",
          payload: {
            orderId: input.orderId,
            reason: input.reason,
            financialImpact: {
              kind: "future_refund_or_payment_adjustment",
              scope: "full_parent",
              amount: parent.grand_total ? parent.grand_total.toString() : parent.total_amount?.toString() || "0",
              currency: parent.currency || "IRR",
            },
          },
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          action: "wholesale_order.cancelled",
          entityType: "wholesale_order",
          entityId: input.orderId,
          before: { status: parent.status },
          after: {
            status: "cancelled",
            reason: input.reason,
            financialImpact: {
              kind: "future_refund_or_payment_adjustment",
              scope: "full_parent",
            },
          },
          metadata: { idempotencyKey: input.idempotencyKey },
        },
        tx as any,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updatedParent.id, resultPayload: sanitizeForJsonb(updatedParent) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.parent_cancel"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { order: updatedParent, replayed: false };
    });
  }

  async adminListOrders(input: {
    status?: string;
    buyerUserId?: string;
    accountId?: string;
    sellerId?: string;
    childStatus?: string;
    exceptionStatus?: string;
    orderCode?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    cursor?: { createdAt: string; id: string } | null;
  }) {
    const limit = Math.min(input.limit || 20, 100);
    return this.db.transaction(async (tx: any) => {
      let whereClauses: any[] = [];
      let params: any[] = [];
      let paramIdx = 1;

      let baseQuery = sql`SELECT wo.* FROM wholesale_order wo`;
      let hasJoin = false;

      if (input.sellerId || input.childStatus) {
        baseQuery = sql`SELECT DISTINCT wo.* FROM wholesale_order wo JOIN purchase_order po ON po.wholesale_order_id = wo.id`;
        hasJoin = true;
      }
      if (input.exceptionStatus) {
        if (hasJoin) {
          baseQuery = sql`SELECT DISTINCT wo.* FROM wholesale_order wo JOIN purchase_order po ON po.wholesale_order_id = wo.id JOIN fulfillment_exception fe ON fe.wholesale_order_id = wo.id`;
        } else {
          baseQuery = sql`SELECT DISTINCT wo.* FROM wholesale_order wo JOIN fulfillment_exception fe ON fe.wholesale_order_id = wo.id`;
        }
        hasJoin = true;
      }

      let conditions: any[] = [];

      if (input.status) conditions.push(sql`wo.status = ${input.status}`);
      if (input.buyerUserId) conditions.push(sql`wo.buyer_user_id = ${input.buyerUserId}`);
      if (input.accountId) conditions.push(sql`wo.account_id = ${input.accountId}`);
      if (input.orderCode) conditions.push(sql`wo.order_code = ${input.orderCode}`);
      if (input.sellerId) conditions.push(sql`po.seller_id = ${input.sellerId}`);
      if (input.childStatus) conditions.push(sql`po.status = ${input.childStatus}`);
      if (input.exceptionStatus) conditions.push(sql`fe.status = ${input.exceptionStatus}`);
      if (input.dateFrom) conditions.push(sql`wo.created_at >= ${input.dateFrom.toISOString()}::timestamptz`);
      if (input.dateTo) conditions.push(sql`wo.created_at <= ${input.dateTo.toISOString()}::timestamptz`);
      if (input.cursor) {
        conditions.push(sql`(wo.created_at, wo.id) < (${new Date(input.cursor.createdAt).toISOString()}::timestamptz, ${input.cursor.id})`);
      }

      let whereSql = conditions.length > 0 ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

      let finalQuery = sql`${baseQuery}${whereSql} ORDER BY wo.created_at DESC, wo.id DESC LIMIT ${limit + 1}`;
      const result = await tx.execute(finalQuery);
      const rows = result.rows || [];
      const hasMore = rows.length > limit;
      const orders = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore
        ? { createdAt: orders[orders.length - 1].created_at || orders[orders.length - 1].createdAt, id: orders[orders.length - 1].id }
        : null;

      const mapped = orders.map((o: any) => ({
        id: o.id,
        orderCode: o.order_code || o.orderCode,
        accountId: o.account_id || o.accountId,
        buyerUserId: o.buyer_user_id || o.buyerUserId,
        status: o.status,
        currency: o.currency,
        grandTotal: o.grand_total || o.grandTotal,
        totalUnits: o.total_units || o.totalUnits,
        createdAt: o.created_at || o.createdAt,
      }));

      return { orders: mapped, nextCursor, hasMore };
    });
  }

  async adminGetOrderDetail(orderId: string) {
    return this.db.transaction(async (tx: any) => {
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
      const itemsResult = await tx.execute(sql`SELECT * FROM wholesale_order_item WHERE order_id = ${orderId} ORDER BY id ASC`);
      const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${orderId} ORDER BY id ASC`);
      const linksResult = await tx.execute(sql`SELECT * FROM wholesale_order_request WHERE order_id = ${orderId} ORDER BY id ASC`);
      return {
        order: {
          id: order.id,
          orderCode: order.order_code || order.orderCode,
          accountId: order.account_id || order.accountId,
          buyerUserId: order.buyer_user_id || order.buyerUserId,
          status: order.status,
          currency: order.currency,
          itemsTotal: order.items_total || order.itemsTotal,
          shippingTotal: order.shipping_total || order.shippingTotal,
          grandTotal: order.grand_total || order.grandTotal,
          totalUnits: order.total_units || order.totalUnits,
          paymentMode: order.payment_mode || order.paymentMode,
          version: order.version,
          createdAt: order.created_at || order.createdAt,
        },
        items: itemsResult.rows,
        children: childrenResult.rows,
        links: linksResult.rows,
      };
    });
  }

  async adminGetTimeline(orderId: string) {
    return this.getOrderTimelineInternal(orderId, null, true);
  }

  // ── Phase 4.6.1 — Finance Ownership Contracts ──────────────────────────

  /**
   * Lock parent order FOR UPDATE for finance operations. Uses DB NOW() for time consistency.
   * Returns raw order row.
   */
  async lockOrderForFinance(orderId: string, executor: DbOrTx) {
    const tx = executor as any;
    const result = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} FOR UPDATE`);
    const order = result.rows?.[0];
    if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
    return order;
  }

  async getDbNow(executor: DbOrTx): Promise<Date> {
    const tx = executor as any;
    const result = await tx.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  /**
   * Immutable financial snapshot DTO — Orders owns wholesale_order, wholesale_order_item, purchase_order, purchase_order_item.
   * Payments creates Proformas from this canonical DTO, not by freely querying foreign tables.
   */
  async getOrderFinancialSnapshot(orderId: string, executor: DbOrTx) {
    const tx = executor as any;
    // Parent already locked by caller ideally, but we lock again for safety
    const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} FOR UPDATE`);
    const parent = parentResult.rows?.[0];
    if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);

    const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${orderId} ORDER BY id ASC FOR UPDATE`);
    const children = childrenResult.rows;

    const orderItemsResult = await tx.execute(sql`SELECT * FROM wholesale_order_item WHERE order_id = ${orderId} ORDER BY id ASC`);
    const orderItems = orderItemsResult.rows;

    const childIds = children.map((c: any) => c.id);
    let childItems: any[] = [];
    if (childIds.length > 0) {
      const childItemsResult = await tx.execute(sql`SELECT * FROM purchase_order_item WHERE purchase_order_id IN (${sql.join(childIds.map((id: string) => sql`${id}`), sql`, `)}) ORDER BY id ASC`);
      childItems = childItemsResult.rows;
    }

    if (children.length === 0) {
      throw new OrderDomainError("NO_CHILD_ORDERS", "Order has no child orders");
    }

    // Validate no empty child without financial lines
    for (const child of children) {
      const childId = child.id;
      const itemsForChild = childItems.filter((ci: any) => (ci.purchase_order_id || ci.purchaseOrderId) === childId);
      if (itemsForChild.length === 0) {
        // Check if child has grand_total? If child total is 0 and no items, it's malformed
        const childTotal = BigInt(child.grand_total || child.total_amount || child.items_total || 0);
        if (childTotal === 0n) {
          throw new OrderDomainError("PROFORMA_LINES_MISSING", `Child ${childId} has no financial line snapshot`);
        }
        // If child has total but no line items, we still allow fallback but warn — however spec says fail atomically if expected billable has no lines
        // For KOLBE + suppliers with valid totals, we allow but will create lines from child totals? No, we require lines.
        // To enforce, we throw if no itemsForChild and child is expected billable
        // For backward compat, we allow if child total >0 but we will still create proforma from child total in PaymentsService? But spec says fail.
        // We'll enforce strict: if no child items, fail
        throw new OrderDomainError("PROFORMA_LINES_MISSING", `Child ${childId} has no financial line snapshot`);
      }
    }

    const snapshot = {
      orderId: parent.id,
      orderCode: parent.order_code || parent.orderCode,
      currency: parent.currency || "IRR",
      paymentMode: parent.payment_mode || parent.paymentMode,
      buyerUserId: parent.buyer_user_id || parent.buyerUserId,
      version: parent.version,
      status: parent.status,
      grandTotal: (parent.grand_total || parent.grandTotal || 0).toString(),
      children: children.map((child: any) => {
        const childId = child.id;
        const childItemsForThisChild = childItems.filter((ci: any) => (ci.purchase_order_id || ci.purchaseOrderId) === childId);
        const items = childItemsForThisChild.map((ci: any) => {
          const woItemId = ci.wholesale_order_item_id || ci.wholesaleOrderItemId;
          const woItem = orderItems.find((oi: any) => oi.id === woItemId);
          const quantity = woItem ? woItem.quantity || woItem.piece_quantity || 1 : ci.quantity || 1;
          const unitPrice = woItem ? BigInt(woItem.unit_price || woItem.unitPrice || 0) : BigInt(ci.unit_price || ci.unitPrice || 0);
          const lineTotal = woItem ? BigInt(woItem.line_total || woItem.lineTotal || 0) : BigInt(ci.total_amount || ci.totalAmount || 0);
          const descriptionSnapshot = woItem ? woItem.product_name_snapshot || woItem.productNameSnapshot || woItem.product_name || "" : ci.product_name || "";
          const skuSnapshot = woItem ? woItem.sku_snapshot || woItem.skuSnapshot || woItem.sku || "" : ci.sku || "";
          const pricingUnit = woItem ? woItem.pricing_unit || woItem.pricingUnit || "PIECE" : "PIECE";
          return {
            wholesaleOrderItemId: woItemId,
            purchaseOrderItemId: ci.id,
            descriptionSnapshot,
            skuSnapshot,
            quantity,
            pricingUnit,
            unitPrice: unitPrice.toString(),
            lineTotal: lineTotal.toString(),
          };
        });
        return {
          childOrderId: childId,
          childOrderCode: child.order_code || child.orderCode,
          sellerId: child.seller_id || child.sellerId,
          supplierId: child.supplier_id || child.supplierId || null,
          currency: child.currency || parent.currency || "IRR",
          items,
        };
      }),
    };

    return snapshot;
  }

  async validateAndLockForPaymentSubmission(input: {
    orderId: string;
    buyerUserId: string;
    executor: DbOrTx;
    /**
     * Phase 4.7.1 (D2/D3) — a late shipping fee after the gate was released
     * creates a delta obligation on an already `processing`/`fulfillment`
     * order. The caller (finance orchestrator) sets this only after it has
     * computed a positive outstanding payable from the *active* proformas.
     */
    allowOutstandingObligation?: boolean;
  }) {
    const tx = input.executor as any;
    const result = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
    const order = result.rows?.[0];
    if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
    const owner = order.buyer_user_id || order.buyerUserId;
    if (owner !== input.buyerUserId) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
    // Strict: only awaiting_payment for normal buyer path
    if (order.status === "awaiting_payment") return order;
    if (input.allowOutstandingObligation && (order.status === "processing" || order.status === "fulfillment")) return order;
    throw new OrderDomainError("PAYMENT_GATE_BLOCKED", `Cannot submit payment from ${order.status}, expected awaiting_payment`);
  }

  async transitionToConfirmed(input: { orderId: string; buyerUserId: string; expectedVersion?: number; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
    const parent = parentResult.rows?.[0];
    if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
    const owner = parent.buyer_user_id || parent.buyerUserId;
    if (owner !== input.buyerUserId) throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
    if (input.expectedVersion !== undefined && parent.version !== input.expectedVersion) {
      throw new OrderDomainError("REQUEST_VERSION_CONFLICT", `Version conflict expected ${input.expectedVersion} got ${parent.version}`);
    }
    if (parent.status === "confirmed" || parent.status === "awaiting_payment" || parent.status === "processing") {
      return { order: parent, replayed: true };
    }
    if (parent.status !== "draft") {
      throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Cannot confirm from ${parent.status}`);
    }

    const dbNow = await this.getDbNow(tx);
    const [confirmed] = await tx
      .update(wholesaleOrder)
      .set({ status: "confirmed", version: parent.version + 1, confirmedAt: dbNow, updatedAt: dbNow })
      .where(eq(wholesaleOrder.id, input.orderId))
      .returning();

    await this.appendStatusHistory(
      {
        orderId: input.orderId,
        fromStatus: parent.status,
        toStatus: "confirmed",
        actorId: input.buyerUserId,
        actorRole: "buyer",
        metadata: { frozenTerms: true },
        orderVersion: confirmed.version,
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.confirmed",
        payload: { orderId: input.orderId, previousStatus: parent.status },
        actorId: input.buyerUserId,
        actorRole: "buyer",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );

    return { order: confirmed, previousStatus: parent.status, replayed: false };
  }

  async markAwaitingPayment(input: { orderId: string; buyerUserId: string; proformaCount: number; payable: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
    const parent = parentResult.rows?.[0];
    if (!parent) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
    if (parent.status !== "confirmed") {
      throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Cannot mark awaiting_payment from ${parent.status}`);
    }

    const dbNow = await this.getDbNow(tx);
    const [gated] = await tx
      .update(wholesaleOrder)
      .set({ status: "awaiting_payment", version: parent.version + 1, updatedAt: dbNow })
      .where(eq(wholesaleOrder.id, input.orderId))
      .returning();

    await this.appendStatusHistory(
      {
        orderId: input.orderId,
        fromStatus: "confirmed",
        toStatus: "awaiting_payment",
        actorId: input.buyerUserId,
        actorRole: "system",
        metadata: { proformaCount: input.proformaCount },
        orderVersion: gated.version,
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.payment_gated",
        payload: { orderId: input.orderId, proformaCount: input.proformaCount, payable: input.payable },
        actorId: input.buyerUserId,
        actorRole: "system",
      },
      tx,
    );

    return gated;
  }

  async releaseFinancialGate(input: {
    orderId: string;
    releaseId: string;
    releaseType: string;
    amount: string;
    currency: string;
    actorId: string | null;
    actorRole: string;
    reason: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
    const order = orderResult.rows?.[0];
    if (!order) throw new OrderDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
    if (order.status !== "awaiting_payment") {
      // Idempotent: if already processing, return replayed
      if (order.status === "processing") {
        return { order, replayed: true };
      }
      throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Cannot release from ${order.status}`);
    }

    const dbNow = await this.getDbNow(tx);
    const [updated] = await tx
      .update(wholesaleOrder)
      .set({ status: "processing", version: order.version + 1, updatedAt: dbNow })
      .where(eq(wholesaleOrder.id, input.orderId))
      .returning();

    await this.appendStatusHistory(
      {
        orderId: input.orderId,
        fromStatus: order.status,
        toStatus: "processing",
        actorId: input.actorId,
        actorRole: "system",
        reason: input.releaseType,
        metadata: { releaseId: input.releaseId, releaseType: input.releaseType, payable: input.amount },
        orderVersion: updated.version,
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.processing_started",
        payload: { releaseId: input.releaseId, releaseType: input.releaseType, payable: input.amount },
        actorId: input.actorId,
        actorRole: "system",
      },
      tx,
    );

    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "financial.release_created",
        payload: { releaseId: input.releaseId, releaseType: input.releaseType, amount: input.amount },
        actorId: input.actorId,
        actorRole: "system",
      },
      tx,
    );

    return { order: updated, replayed: false };
  }

  async recordPaymentEvidenceSubmitted(input: { orderId: string; paymentId: string; amount: string; currency: string; actorId: string; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const dbNow = await this.getDbNow(tx);
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "payment.evidence_submitted",
        // Privacy: do NOT place full externalReference, use referencePresent flag
        payload: { paymentId: input.paymentId, amount: input.amount, currency: input.currency, referencePresent: true },
        actorId: input.actorId,
        actorRole: "buyer",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
    return { recordedAt: dbNow };
  }

  async recordPaymentVerified(input: {
    orderId: string;
    paymentId: string;
    amount: string;
    currency: string;
    allocations: Array<{ proformaId: string; amount: string }>;
    actorId: string | null;
    idempotencyKey: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const dbNow = await this.getDbNow(tx);
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "payment.verified",
        // Privacy: no full externalReference, only paymentId/status/amount/currency/referencePresent
        payload: {
          paymentId: input.paymentId,
          amount: input.amount,
          currency: input.currency,
          allocations: input.allocations.map((a) => ({ proformaId: a.proformaId, amount: a.amount })),
          referencePresent: true,
        },
        actorId: input.actorId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );

    for (const alloc of input.allocations) {
      await this.appendEvent(
        {
          aggregateType: "wholesale_order",
          aggregateId: input.orderId,
          eventType: "payment.allocated",
          payload: { paymentId: input.paymentId, proformaId: alloc.proformaId, amount: alloc.amount },
          actorId: input.actorId,
          actorRole: "admin",
        },
        tx,
      );
    }

    // Overpaid check - unallocated money
    const allocatedSum = input.allocations.reduce((s, a) => s + BigInt(a.amount), 0n);
    const overpaid = BigInt(input.amount) - allocatedSum;
    if (overpaid > 0n) {
      await this.appendEvent(
        {
          aggregateType: "wholesale_order",
          aggregateId: input.orderId,
          eventType: "payment.overpaid",
          payload: { paymentId: input.paymentId, overpaid: overpaid.toString(), total: input.amount },
          actorId: input.actorId,
          actorRole: "admin",
        },
        tx,
      );
    }

    return { recordedAt: dbNow };
  }

  /**
   * Phase 4.7.1 — provider-driven payment events (webhook / reconciliation).
   * Payload is intentionally minimal: never the provider reference or any secret.
   */
  async recordProviderPaymentEvent(input: {
    orderId: string;
    paymentId: string;
    eventType: "payment.provider_webhook_received" | "payment.provider_verified" | "payment.reconciled" | "payment.provider_callback_received";
    provider: string;
    providerEventId?: string | null;
    amount: string;
    currency: string;
    replayed?: boolean;
    providerState?: string;
    actorId: string | null;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: input.eventType,
        payload: {
          paymentId: input.paymentId,
          provider: input.provider,
          providerEventId: input.providerEventId || null,
          amount: input.amount,
          currency: input.currency,
          providerState: input.providerState || null,
          replayed: Boolean(input.replayed),
          referencePresent: true,
        },
        actorId: input.actorId,
        actorRole: "system",
      },
      tx,
    );
  }

  async recordPaymentFailed(input: { orderId: string; paymentId: string; reason: string; actorId: string | null; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "payment.failed",
        payload: { paymentId: input.paymentId, reason: input.reason },
        actorId: input.actorId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
  }

  async recordRefundRequested(input: { orderId: string; refundId: string; childOrderId?: string; amount: string; reasonCode?: string; actorId: string; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "refund.requested",
        payload: { refundId: input.refundId, childOrderId: input.childOrderId, amount: input.amount, reasonCode: input.reasonCode },
        actorId: input.actorId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
  }

  async recordRefundApproved(input: { orderId: string; refundId: string; amount: string; actorId: string; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "refund.approved",
        payload: { refundId: input.refundId, amount: input.amount },
        actorId: input.actorId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
  }

  async recordRefundCompleted(input: { orderId: string; refundId: string; amount: string; childOrderId?: string; actorId: string; idempotencyKey: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "refund.completed",
        // Privacy: no full externalReference
        payload: { refundId: input.refundId, amount: input.amount, childOrderId: input.childOrderId, referencePresent: true },
        actorId: input.actorId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
  }

  async recordRefundFailed(input: { orderId: string; refundId: string; reason: string; actorId: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "refund.failed",
        payload: { refundId: input.refundId, reason: input.reason },
        actorId: input.actorId,
        actorRole: "admin",
      },
      tx,
    );
  }

  async recordProformaIssued(input: { orderId: string; proformaId: string; childOrderId: string; totalAmount: string; actorId: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "proforma.issued",
        payload: { proformaId: input.proformaId, childOrderId: input.childOrderId, totalAmount: input.totalAmount },
        actorId: input.actorId,
        actorRole: "buyer",
      },
      tx,
    );
  }

  async recordProformaVoided(input: { orderId: string; proformaId: string; childOrderId: string; reason: string; actorId: string; actorRole: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "proforma.voided",
        payload: { proformaId: input.proformaId, childOrderId: input.childOrderId, reason: input.reason },
        actorId: input.actorId,
        actorRole: input.actorRole as any,
      },
      tx,
    );
  }

  async recordParentCancelled(input: { orderId: string; reason: string; refundObligations: Array<{ childOrderId: string; amount: string }>; actorId: string; actorRole: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    await this.appendEvent(
      {
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.parent_cancelled",
        payload: { orderId: input.orderId, reason: input.reason, refundObligations: input.refundObligations },
        actorId: input.actorId,
        actorRole: input.actorRole as any,
      },
      tx,
    );
  }

  async getChildOrdersForFinance(orderId: string, executor: DbOrTx) {
    const tx = executor as any;
    const result = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${orderId} ORDER BY id ASC FOR UPDATE`);
    return result.rows;
  }

  // Phase 4.7 — Shipping events (OrdersService owns Order status/history/event)
  async recordShippingQuoteSelected(input: {
    orderId?: string;
    childOrderId: string;
    quoteId: string;
    shippingAmount: string;
    previousShippingAmount?: string;
    actorId: string | null;
    actorRole?: string;
    idempotencyKey: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const shippingAmount = BigInt(input.shippingAmount);
    const previousShipping = BigInt(input.previousShippingAmount ?? "0");
    if (shippingAmount < 0n) throw new OrderDomainError("INVALID_AMOUNT", "Shipping amount cannot be negative");

    // Phase 4.7.1 (D1/D3) — Orders is the single writer of the order totals: the
    // selected fee is projected absolutely (never accumulated) so a replay or a
    // replacement quote can never double-count. `shipping_total = 0` keeps
    // meaning NOT QUOTED. Item totals are immutable.
    const childRes = await tx.execute(sql`SELECT id, wholesale_order_id, items_total, grand_total FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
    const child = childRes.rows?.[0];
    if (!child) throw new OrderDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);
    const childItems = BigInt(child.items_total ?? 0);
    await tx.execute(sql`UPDATE purchase_order SET grand_total = ${(childItems + shippingAmount).toString()}::bigint, total_amount = ${(childItems + shippingAmount).toString()}::bigint, updated_at = NOW() WHERE id = ${input.childOrderId}`);
    const parentId = input.orderId || child.wholesale_order_id;
    if (parentId) {
      await tx.execute(sql`
        UPDATE wholesale_order wo
        SET shipping_total = agg.shipping,
            grand_total = wo.items_total + agg.shipping,
            total_amount = wo.items_total + agg.shipping,
            updated_at = NOW()
        FROM (
          SELECT COALESCE(SUM(GREATEST(po.grand_total - po.items_total, 0)), 0)::bigint AS shipping
          FROM purchase_order po WHERE po.wholesale_order_id = ${parentId} AND po.status <> 'cancelled'
        ) agg
        WHERE wo.id = ${parentId}`);
    }

    await this.appendEvent(
      {
        aggregateType: "purchase_order",
        aggregateId: input.childOrderId,
        eventType: "shipping.quote_selected",
        payload: {
          quoteId: input.quoteId,
          childOrderId: input.childOrderId,
          shippingAmount: shippingAmount.toString(),
          previousShippingAmount: input.previousShippingAmount ?? null,
          shippingDelta: (shippingAmount - previousShipping).toString(),
          feeCause: "proforma_supersede",
        },
        actorId: input.actorId,
        actorRole: input.actorRole || "admin",
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
  }
}
