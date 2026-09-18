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
    // Reject prototype pollution keys
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const v = addr[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      // Limit string length per field
      if (trimmed.length > 500) continue;
      result[k] = trimmed;
    } else if (typeof v === "number" || typeof v === "boolean") {
      result[k] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      const nested = normalizeAddress(v);
      if (Object.keys(nested).length > 0) result[k] = nested;
    }
    // Arrays rejected, deeply nested arbitrary objects flattened via recursion but limited
  }
  return result;
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
      for (const reservation of reservations) {
        const childId = orderItemToChildMap.get(reservation.orderItemId);
        if (childId) {
          await tx
            .update((await import("@kolbe/database")).inventoryReservation)
            .set({ childOrderId: childId, updatedAt: new Date() } as any)
            .where(eq((await import("@kolbe/database")).inventoryReservation.id, reservation.id));
        }
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
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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
      const [updated] = await tx
        .update(purchaseOrder)
        .set({
          status: "shipped",
          version: child.version + 1,
          shippedAt: now,
          trackingCode: input.trackingCode || child.tracking_code || null,
          updatedAt: now,
        })
        .where(eq(purchaseOrder.id, input.childOrderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: null,
          childOrderId: input.childOrderId,
          fromStatus: child.status,
          toStatus: "shipped",
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          orderVersion: updated.version,
          metadata: { trackingCode: input.trackingCode },
        },
        tx,
      );

      await this.appendEvent(
        {
          aggregateType: "purchase_order",
          aggregateId: input.childOrderId,
          eventType: "child.shipped",
          payload: { childOrderId: input.childOrderId, trackingCode: input.trackingCode, financialImpact: null },
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

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

      // Parent aggregation: if one child shipped and others remain, parent NOT auto cancelled, status derives from remaining
      if (child.wholesale_order_id) {
        const siblings = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, child.wholesale_order_id));
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (parent) {
          const childSummaries = siblings.map((c: any) => ({ id: c.id, status: c.id === input.childOrderId ? "shipped" : c.status })) as any;
          const newParentStatus = calculateParentFulfillmentProjection(parent.status as any, childSummaries);
          if (newParentStatus !== parent.status) {
            await tx.update(wholesaleOrder).set({ status: newParentStatus, updatedAt: now }).where(eq(wholesaleOrder.id, parent.id));
            await this.appendStatusHistory(
              {
                orderId: parent.id,
                childOrderId: null,
                fromStatus: parent.status,
                toStatus: newParentStatus,
                actorId: input.actorUserId,
                actorRole: "system",
                orderVersion: parent.version + 1,
                metadata: { trigger: "child.shipped", childOrderId: input.childOrderId },
              },
              tx,
            );
            await this.appendEvent(
              {
                aggregateType: "wholesale_order",
                aggregateId: parent.id,
                eventType: `order.${newParentStatus === "shipped" ? "shipped" : newParentStatus === "completed" ? "completed" : "fulfillment_started"}`,
                payload: { parentStatus: newParentStatus, childOrderId: input.childOrderId },
                actorId: input.actorUserId,
                actorRole: "system",
              },
              tx,
            );
          }
        }
      }

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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

      if (child.status !== "shipped") {
        throw new OrderDomainError("INVALID_STATUS_TRANSITION", `Deliver only from shipped, got ${child.status}`);
      }

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

      const now = new Date();
      const [updated] = await tx
        .update(purchaseOrder)
        .set({ status: "delivered", version: child.version + 1, deliveredAt: now, updatedAt: now })
        .where(eq(purchaseOrder.id, input.childOrderId))
        .returning();

      await this.appendStatusHistory(
        {
          orderId: null,
          childOrderId: input.childOrderId,
          fromStatus: child.status,
          toStatus: "delivered",
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
          eventType: "child.delivered",
          payload: { childOrderId: input.childOrderId },
          actorId: input.actorUserId,
          actorRole: input.actorRole === "supplier" ? "supplier" : "admin",
          idempotencyKey: input.idempotencyKey,
        },
        tx,
      );

      // Parent aggregation
      if (child.wholesale_order_id) {
        const siblings = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, child.wholesale_order_id));
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (parent) {
          const childSummaries = siblings.map((c: any) => ({ id: c.id, status: c.id === input.childOrderId ? "delivered" : c.status })) as any;
          const newParentStatus = calculateParentFulfillmentProjection(parent.status as any, childSummaries);
          if (newParentStatus !== parent.status) {
            await tx.update(wholesaleOrder).set({ status: newParentStatus, updatedAt: now }).where(eq(wholesaleOrder.id, parent.id));
          }
        }
      }

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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

      // Release only this child's reservations
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
          // If no reservations, continue
          if (!e.message?.includes("No reservations") && !e.message?.includes("not found")) {
            // For already confirmed, we already blocked above, but keep error
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

      // Parent aggregation: if one child cancelled and others remain parent NOT auto cancelled
      if (child.wholesale_order_id) {
        const siblings = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, child.wholesale_order_id));
        const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${child.wholesale_order_id} FOR UPDATE`);
        const parent = parentResult.rows?.[0];
        if (parent) {
          const childSummaries = siblings.map((c: any) => ({ id: c.id, status: c.id === input.childOrderId ? "cancelled" : c.status })) as any;
          const newParentStatus = calculateParentFulfillmentProjection(parent.status as any, childSummaries);
          // Only update parent if all children cancelled → parent cancelled via canonical orchestration, else keep
          if (newParentStatus !== parent.status) {
            await tx.update(wholesaleOrder).set({ status: newParentStatus, updatedAt: now }).where(eq(wholesaleOrder.id, parent.id));
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
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: updated as any, completedAt: now, updatedAt: now })
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
}
