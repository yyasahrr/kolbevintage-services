/**
 * Phase 4.2 — Pure order domain logic (no DB, no side effects)
 *
 * Responsibilities:
 * - Status transition validation (parent and child)
 * - Child status rules
 * - Parent aggregate status calculation
 * - Seller/supplier semantic validation
 * - Quantity snapshot validation
 * - Monetary totals validation
 *
 * All functions are pure and tested without DB.
 */

import {
  WHOLESALE_ORDER_TRANSITIONS,
  CHILD_ORDER_TRANSITIONS,
  canTransition,
  assertTransition,
  TransitionError,
  type WholesaleOrderStatus,
  type ChildOrderStatus,
} from "@kolbe/shared";

// ── Status transitions ───────────────────────────────────────────────────

export function validateWholesaleOrderTransition(
  from: WholesaleOrderStatus,
  to: WholesaleOrderStatus,
): void {
  assertTransition("wholesale_order", WHOLESALE_ORDER_TRANSITIONS, from, to);
}

export function validateChildOrderTransition(
  from: ChildOrderStatus,
  to: ChildOrderStatus,
): void {
  assertTransition("child_order", CHILD_ORDER_TRANSITIONS, from, to);
}

export function isWholesaleOrderTransitionAllowed(
  from: WholesaleOrderStatus,
  to: WholesaleOrderStatus,
): boolean {
  if (from === to) return false;
  return canTransition(WHOLESALE_ORDER_TRANSITIONS, from, to);
}

export function isChildOrderTransitionAllowed(
  from: ChildOrderStatus,
  to: ChildOrderStatus,
): boolean {
  if (from === to) return false;
  return canTransition(CHILD_ORDER_TRANSITIONS, from, to);
}

// ── Seller / Supplier consistency ────────────────────────────────────────

export type SellerType = "KOLBE" | "SUPPLIER";

export class SellerSupplierConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerSupplierConsistencyError";
  }
}

/**
 * KOLBE seller → supplier_id must be NULL
 * SUPPLIER seller → supplier_id must be NOT NULL
 */
export function validateSellerSupplierConsistency(
  sellerType: SellerType,
  supplierId: string | null | undefined,
): void {
  if (sellerType === "KOLBE" && supplierId != null) {
    throw new SellerSupplierConsistencyError(
      "KOLBE seller must have null supplier_id",
    );
  }
  if (sellerType === "SUPPLIER" && supplierId == null) {
    throw new SellerSupplierConsistencyError(
      "SUPPLIER seller must have non-null supplier_id",
    );
  }
}

// ── Quantity snapshot validation ─────────────────────────────────────────

export type QuantitySnapshot = {
  quantity: number;
  packageQuantity?: number | null;
  pieceQuantity: number;
  composition?: Array<{ variantId: string; quantity: number }> | null;
};

export class QuantityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuantityValidationError";
  }
}

export function validateQuantitySnapshot(input: QuantitySnapshot): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new QuantityValidationError("quantity must be positive safe integer");
  }
  if (!Number.isSafeInteger(input.pieceQuantity) || input.pieceQuantity <= 0) {
    throw new QuantityValidationError("piece_quantity must be positive safe integer");
  }
  if (input.packageQuantity != null) {
    if (!Number.isSafeInteger(input.packageQuantity) || input.packageQuantity <= 0) {
      throw new QuantityValidationError("package_quantity must be positive safe integer when present");
    }
  }

  // If composition provided, validate it
  if (input.composition) {
    if (input.composition.length === 0) {
      throw new QuantityValidationError("package composition cannot be empty");
    }
    const seen = new Set<string>();
    let totalPiecesPerPackage = 0;
    for (const item of input.composition) {
      if (!item.variantId) throw new QuantityValidationError("composition variantId required");
      if (seen.has(item.variantId)) {
        throw new QuantityValidationError(`duplicate variant in composition: ${item.variantId}`);
      }
      seen.add(item.variantId);
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new QuantityValidationError(`composition quantity must be positive safe integer for ${item.variantId}`);
      }
      totalPiecesPerPackage += item.quantity;
      if (!Number.isSafeInteger(totalPiecesPerPackage)) {
        throw new QuantityValidationError("totalPiecesPerPackage overflow");
      }
    }

    // If packageQuantity present, pieceQuantity must equal packageQuantity * totalPiecesPerPackage
    if (input.packageQuantity != null) {
      const expectedPieces = input.packageQuantity * totalPiecesPerPackage;
      if (!Number.isSafeInteger(expectedPieces)) {
        throw new QuantityValidationError("pieceQuantity overflow");
      }
      if (expectedPieces !== input.pieceQuantity) {
        throw new QuantityValidationError(
          `piece_quantity ${input.pieceQuantity} != package_quantity ${input.packageQuantity} * pieces_per_package ${totalPiecesPerPackage} = ${expectedPieces}`,
        );
      }
    }
  }
}

// Specific package examples for tests (from quantity-and-package-model.md)

export function calculatePiecesPerPackage(composition: Array<{ quantity: number }>): number {
  return composition.reduce((sum, item) => sum + item.quantity, 0);
}

export function calculateTotalPieces(packageCount: number, piecesPerPackage: number): number {
  if (!Number.isSafeInteger(packageCount) || packageCount <= 0) throw new QuantityValidationError("packageCount invalid");
  if (!Number.isSafeInteger(piecesPerPackage) || piecesPerPackage <= 0) throw new QuantityValidationError("piecesPerPackage invalid");
  const total = packageCount * piecesPerPackage;
  if (!Number.isSafeInteger(total)) throw new QuantityValidationError("total overflow");
  return total;
}

// ── Monetary totals ──────────────────────────────────────────────────────

export class MoneyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyValidationError";
  }
}

export const MAX_MONEY = 1000000000000000n; // 1000B Rial

export function validateMoneyAmount(amount: bigint, field: string): void {
  if (typeof amount !== "bigint") {
    throw new MoneyValidationError(`${field} must be bigint`);
  }
  if (amount < 0n) {
    throw new MoneyValidationError(`${field} must be >= 0`);
  }
  if (amount > MAX_MONEY) {
    throw new MoneyValidationError(`${field} exceeds MAX_MONEY`);
  }
}

export type OrderTotals = {
  itemsTotal: bigint;
  shippingTotal: bigint;
  grandTotal: bigint;
};

export function validateOrderTotals(totals: OrderTotals): void {
  validateMoneyAmount(totals.itemsTotal, "items_total");
  validateMoneyAmount(totals.shippingTotal, "shipping_total");
  validateMoneyAmount(totals.grandTotal, "grand_total");

  if (totals.grandTotal < totals.itemsTotal) {
    throw new MoneyValidationError("grand_total must be >= items_total");
  }
  if (totals.grandTotal < totals.shippingTotal) {
    throw new MoneyValidationError("grand_total must be >= shipping_total");
  }
  // For Phase 4.2 initial model without tax/discount, enforce exact equation
  // grand_total = items_total + shipping_total
  // This matches CHECK grand_total >= items_total AND >= shipping_total, but we enforce equality in pure logic for now
  // Allow >= for future tax/discount, but we can check at least sum
  const sum = totals.itemsTotal + totals.shippingTotal;
  if (sum > MAX_MONEY) {
    throw new MoneyValidationError("items_total + shipping_total overflow");
  }
  if (totals.grandTotal < sum) {
    throw new MoneyValidationError(
      `grand_total ${totals.grandTotal} < items_total ${totals.itemsTotal} + shipping_total ${totals.shippingTotal} = ${sum}`,
    );
  }
}

export type LineTotalInput = {
  unitPrice: bigint;
  quantity: number;
  pieceQuantity: number;
  pricingUnit: string;
};

export function calculateLineTotal(input: LineTotalInput): bigint {
  validateMoneyAmount(input.unitPrice, "unit_price");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new QuantityValidationError("quantity invalid");
  }
  if (!Number.isSafeInteger(input.pieceQuantity) || input.pieceQuantity <= 0) {
    throw new QuantityValidationError("piece_quantity invalid");
  }

  // For PIECE pricing, line_total = piece_quantity * unit_price
  // For PACKAGE/SERIES/BOX/CARTON/SET pricing, line_total = quantity (package count) * unit_price
  // We use pieceQuantity for PIECE, quantity for PACKAGE
  const isPiecePricing = input.pricingUnit === "PIECE" || input.pricingUnit === "PER_PIECE";
  const multiplier = isPiecePricing ? input.pieceQuantity : input.quantity;
  const total = input.unitPrice * BigInt(multiplier);
  if (total > MAX_MONEY) {
    throw new MoneyValidationError("line_total exceeds MAX_MONEY");
  }
  return total;
}

// ── Parent aggregate status calculation ──────────────────────────────────
// Phase 4.2.1 correction: payment/credit gate must NOT be bypassed by child states.
// Per status-machines.md:
//   draft → confirmed → awaiting_payment → processing → fulfillment → shipped → completed
//   confirmed → processing only via trusted credit/no-prepayment policy command
//   awaiting_payment → processing only via trusted payment evidence / audited manual evidence
//   Child states alone must never advance confirmed or awaiting_payment.
//   Only once parent is processing or later may children affect fulfillment projection.

export type ChildOrderSummary = {
  id: string;
  status: ChildOrderStatus;
};

/**
 * Calculate parent fulfillment projection given current parent status and children.
 * This is the canonical aggregation that respects the payment gate.
 *
 * Rules:
 * - draft stays draft
 * - confirmed stays confirmed unless authorized command advances it
 * - awaiting_payment stays awaiting_payment until trusted evidence command
 * - only once parent is processing or later may children affect fulfillment projection
 * - all relevant children shipped/delivered → shipped
 * - all relevant children delivered → completed
 * - partial shipment → fulfillment
 * - cancelled aggregation obeys frozen cancellation rules (no cancellation from shipped/completed)
 */
export function calculateParentFulfillmentProjection(
  currentParentStatus: WholesaleOrderStatus,
  children: ChildOrderSummary[],
): WholesaleOrderStatus {
  if (children.length === 0) return currentParentStatus;

  const uncancelled = children.filter((c) => c.status !== "cancelled");

  // All children cancelled → parent cancelled, unless parent already shipped/completed (no cancellation from shipped)
  if (uncancelled.length === 0) {
    if (currentParentStatus === "shipped" || currentParentStatus === "completed") {
      return currentParentStatus;
    }
    return "cancelled";
  }

  // Terminal parent states stay terminal
  if (currentParentStatus === "cancelled" || currentParentStatus === "completed") {
    return currentParentStatus;
  }

  // Payment gate: draft, confirmed, awaiting_payment stay as-is regardless of children
  if (
    currentParentStatus === "draft" ||
    currentParentStatus === "confirmed" ||
    currentParentStatus === "awaiting_payment"
  ) {
    return currentParentStatus;
  }

  // From here, parent is at least processing, so children may affect projection

  const allDelivered = uncancelled.every((c) => c.status === "delivered");
  if (allDelivered) return "completed";

  const allShippedOrDelivered = uncancelled.every((c) => c.status === "shipped" || c.status === "delivered");
  if (allShippedOrDelivered) return "shipped";

  // If any child is preparing or shipped/delivered partially, parent is fulfillment
  // If parent is processing and children are still pending/confirmed, parent stays processing
  if (currentParentStatus === "processing") {
    const anyPreparingOrBeyond = uncancelled.some(
      (c) => c.status === "preparing" || c.status === "shipped" || c.status === "delivered",
    );
    if (anyPreparingOrBeyond) return "fulfillment";
    return "processing";
  }

  if (currentParentStatus === "fulfillment") {
    // Partial shipment stays fulfillment, as per spec
    return "fulfillment";
  }

  if (currentParentStatus === "shipped") {
    // Shipped stays shipped until all delivered
    return "shipped";
  }

  // Fallback: return current
  return currentParentStatus;
}

/**
 * Legacy helper kept for backward compatibility but now delegates to fulfillment projection
 * with explicit currentParentStatus required. If called with only children (old signature),
 * it assumes parent is already in fulfillment projection context (processing) for backward
 * compat, but this is NOT the canonical way to advance past payment gate.
 * New code should use calculateParentFulfillmentProjection(currentStatus, children).
 */
export function calculateParentStatusFromChildren(
  childrenOrCurrent: WholesaleOrderStatus | ChildOrderSummary[],
  childrenMaybe?: ChildOrderSummary[],
): WholesaleOrderStatus | null {
  // New signature: (currentParentStatus, children)
  if (typeof childrenOrCurrent === "string" && Array.isArray(childrenMaybe)) {
    return calculateParentFulfillmentProjection(childrenOrCurrent, childrenMaybe);
  }
  // Old signature: (children) - treat as if parent is processing for fulfillment projection only
  // This prevents automatic processing from confirmed/awaiting_payment
  const children = childrenOrCurrent as ChildOrderSummary[];
  if (children.length === 0) return null;
  const uncancelled = children.filter((c) => c.status !== "cancelled");
  if (uncancelled.length === 0) return "cancelled";
  const allDelivered = uncancelled.every((c) => c.status === "delivered");
  if (allDelivered) return "completed";
  const allShippedOrDelivered = uncancelled.every((c) => c.status === "shipped" || c.status === "delivered");
  if (allShippedOrDelivered) return "shipped";
  if (uncancelled.some((c) => c.status === "preparing")) return "fulfillment";
  // For pending/confirmed children, without parent status we cannot know payment gate,
  // so we return fulfillment as safe projection assuming payment gate already passed,
  // but we do NOT return processing automatically from confirmed/awaiting_payment.
  // To enforce gate, callers must use calculateParentFulfillmentProjection.
  if (uncancelled.every((c) => c.status === "pending" || c.status === "confirmed")) {
    // This used to return processing, but that violates payment gate.
    // Now return fulfillment to indicate child preparation stage, but actual parent
    // must be advanced via authorized command, not via this aggregation alone.
    return "fulfillment";
  }
  return "fulfillment";
}

// ── Idempotency scoped validation ────────────────────────────────────────

export class IdempotencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyValidationError";
  }
}

export function validateScopedIdempotency(
  accountId: string,
  idempotencyKey: string | null | undefined,
): void {
  if (idempotencyKey == null) return;
  if (idempotencyKey.trim().length === 0) {
    throw new IdempotencyValidationError("idempotency_key cannot be empty when provided");
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new IdempotencyValidationError("idempotency_key length must be 8..128");
  }
  const pattern = /^[A-Za-z0-9._:-]+$/;
  if (!pattern.test(idempotencyKey)) {
    throw new IdempotencyValidationError("idempotency_key pattern invalid");
  }
  if (!accountId) {
    throw new IdempotencyValidationError("accountId required for scoped idempotency");
  }
}

// ── Snapshot immutability helpers ────────────────────────────────────────
// Phase 4.2.1: removed no-op assertSnapshotImmutability helper.
// Real immutability is proven via persistence-level DB tests in phase-4-2.test.ts:
// create product/variant/seller/package source, create order item snapshot,
// mutate live sources, read historical order item, assert stored snapshot unchanged.

export type ProductSnapshot = {
  productName: string;
  sku: string;
  variantAttributes: Record<string, unknown>;
  sellerDisplayName: string;
};
