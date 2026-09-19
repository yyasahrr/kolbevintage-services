/**
 * Phase 4.7.6 — Settlement-readiness contract (READ-ONLY).
 *
 * This module answers one question for admin/finance operators: "for this child order, are the
 * immutable economic facts sufficient and unambiguous for a future settlement engine?".
 *
 * It owns NO tables, moves NO money, stores NOTHING, and exposes NO balance. Every amount below is a
 * reconstruction of immutable rows (proforma lines, verified allocations, shipment items, refund
 * lines) owned by other modules and is labelled `NOT A SETTLEMENT BALANCE`. Phase 4.8 (supplier
 * wallet / settlement / payout) has NOT started; nothing here pre-empts its decisions.
 */

export const SETTLEMENT_READINESS_DISCLAIMER = "NOT A SETTLEMENT BALANCE" as const;
export const SETTLEMENT_READINESS_SCHEMA_VERSION = 1 as const;

export type BlockerClass = "economic" | "configuration" | "compliance" | "payout";

/** Stable blocker codes — grouped by the lifecycle stage they block. */
export const SETTLEMENT_READINESS_BLOCKERS = {
  economic: [
    "KOLBE_FIRST_PARTY",
    "CHILD_CANCELLED",
    "COMMERCIAL_TERMS_NOT_SNAPSHOTTED",
    "CURRENCY_MISMATCH",
    "PAYMENT_NOT_COLLECTED",
    "CHILD_NOT_DELIVERED",
    "DELIVERY_EVIDENCE_MISSING",
    "REFUND_NOT_ATTRIBUTABLE",
  ],
  configuration: ["COMMISSION_POLICY_UNDEFINED", "HOLD_POLICY_UNDEFINED", "SHIPPING_ECONOMIC_OWNER_UNDEFINED", "TAX_TREATMENT_UNVERIFIED"],
  compliance: ["SUPPLIER_COMPLIANCE_BLOCKED", "BANK_DESTINATION_NOT_VERIFIED"],
  payout: ["PARTIAL_FULFILLMENT", "REFUND_PENDING", "DISPUTE_OR_CHARGEBACK_HOLD"],
} as const;

export type BlockerCode = (typeof SETTLEMENT_READINESS_BLOCKERS)[BlockerClass][number];

/** Blockers that mean the canonical data itself cannot be attributed exactly (not merely "not yet"). */
export const SOURCE_DATA_BLOCKERS: readonly BlockerCode[] = ["COMMERCIAL_TERMS_NOT_SNAPSHOTTED", "CURRENCY_MISMATCH", "DELIVERY_EVIDENCE_MISSING", "REFUND_NOT_ATTRIBUTABLE"];

/** Field names that MUST NEVER appear in a readiness payload (they would be read as authoritative money). */
export const FORBIDDEN_READINESS_FIELDS = ["supplierBalance", "walletBalance", "withdrawableBalance", "availableBalance", "pendingBalance", "payoutAmount"] as const;

export type ReadinessBlocker = { code: BlockerCode; class: BlockerClass; detail: string };

export type ReadinessItem = {
  wholesaleOrderItemId: string;
  purchaseOrderItemId: string | null;
  pricingUnit: string;
  /** Ordered quantity in the pricing unit (the immutable proforma line quantity). */
  orderedUnits: number;
  orderedPieces: number;
  piecesPerUnit: number;
  unitPrice: string;
  lineTotal: string;
  /** Quantity-evidenced delivery: Σ shipment_item.piece_quantity of `delivered` shipments. */
  deliveredPieces: number;
  /** floor(deliveredPieces / piecesPerUnit) — FROZEN technical rule; never rounds up. */
  deliveredUnits: number;
  /** Refund lines that cite a fulfillment exception of this child (never-delivered quantity). */
  refundedUnitsUndelivered: number;
  /** Refund lines without an exception link (treated as returned / adjusted after delivery — conservative). */
  refundedUnitsDelivered: number;
  /** max(0, min(deliveredUnits, orderedUnits − refundedUndelivered) − refundedDelivered). */
  entitledUnitsPreview: number;
  deliveredValue: string;
  refundedValue: string;
  entitledValuePreview: string;
};

export type ChildSettlementReadiness = {
  disclaimer: typeof SETTLEMENT_READINESS_DISCLAIMER;
  schemaVersion: typeof SETTLEMENT_READINESS_SCHEMA_VERSION;
  computedAt: string;
  orderId: string;
  orderCode: string;
  childOrderId: string;
  childOrderCode: string;
  childStatus: string;
  parentStatus: string;
  paymentMode: string;
  currency: string;
  participant: {
    sellerId: string;
    sellerType: "KOLBE" | "SUPPLIER";
    supplierId: string | null;
    /** false for Kolbe first-party children: no supplier payable exists, commission is 0. */
    settlementCandidate: boolean;
    identifiedBy: "purchase_order.supplier_id (server-side, never client input)";
  };
  commercialTerms: {
    snapshotted: boolean;
    proformaId: string | null;
    proformaVersion: number | null;
    proformaHistory: Array<{ proformaId: string; version: number; status: string; itemsTotal: string; shippingTotal: string; totalAmount: string }>;
    items: ReadinessItem[];
  };
  fulfillment: {
    orderedPieces: number;
    deliveredPieces: number;
    deliveredShipments: number;
    statusDelivered: boolean;
    /** QUANTITY_EVIDENCED: shipment items exist for the full order; STATUS_ONLY: status says delivered without shipment quantities. */
    deliveryEvidence: "NONE" | "PARTIAL_QUANTITY_EVIDENCED" | "QUANTITY_EVIDENCED" | "STATUS_ONLY";
    deliveryHistory: Array<{ actorRole: string | null; trigger: string | null; shipmentId: string | null; at: string | null }>;
  };
  economicBasis: {
    label: typeof SETTLEMENT_READINESS_DISCLAIMER;
    merchandiseOrdered: string;
    merchandiseDelivered: string;
    merchandiseRefundedCompleted: string;
    merchandiseRefundedPending: string;
    /** Child-scoped refunds without lines (attributable to the child, not to a quantity). */
    merchandiseRefundedWithoutLines: string;
    /** Σ entitledValuePreview − refunds without lines, floored at 0. Preview only. */
    merchandiseEntitledPreview: string;
    shippingChargedToBuyer: string;
    shippingEconomicOwner: "NOT_CHARGED" | "UNDEFINED";
    shippingPhysicalResponsibility: string;
    taxExcluded: string;
    taxTreatment: "NOT_ASSESSED" | "VAT_RATE_ACTIVE_TREATMENT_UNVERIFIED";
    taxBasisReference: string | null;
  };
  cashCoverage: {
    basis: "VERIFIED_ACTIVE_ALLOCATIONS_TO_CHILD_PROFORMA_LINEAGE";
    childPayable: string;
    allocatedVerified: string;
    covered: boolean;
    allocations: Array<{ paymentId: string; proformaId: string; amount: string; method: string; provider: string | null; verifiedAt: string | null }>;
    /** Order-level money not attributed to any child — NEVER supplier money. */
    unallocatedOrderMoney: string;
    orderVerifiedPaid: string;
    orderScopedRefundsLive: string;
    releases: Array<{ releaseType: string; amount: string; actorRole: string | null; createdAt: string | null }>;
    /** A credit / cod / manual release exists but the child is not cash-covered: release ≠ cash. */
    financialReleaseWithoutCash: boolean;
  };
  refunds: Array<{ refundId: string; status: string; amount: string; exceptionLinked: boolean; lines: Array<{ wholesaleOrderItemId: string; quantity: number; lineTotal: string }> }>;
  commission: {
    applicable: boolean;
    policyRef: null;
    basis: null;
    rateBps: null;
    amount: null;
    /** FROZEN: before a commission policy is configured and snapshotted, the default is 0. */
    defaultBeforeConfiguration: "0";
  };
  compliance: {
    evaluated: boolean;
    eligible: boolean | null;
    reasons: string[];
    checkedAt: string | null;
  };
  capabilities: {
    chargebackFactsAvailable: false;
    disputeFactsAvailable: false;
    commissionPolicyAvailable: false;
    holdPolicyAvailable: false;
  };
  blockers: ReadinessBlocker[];
  notices: string[];
  /** The canonical data is exact and attributable (no source-data blocker) — not a go-live signal. */
  sourceDataSufficient: boolean;
  /** No economic / configuration / compliance blocker. Payout-class blockers gate payout, not entitlement recording. */
  readyForSettlementEngine: boolean;
};

export type OrderSettlementReadiness = {
  disclaimer: typeof SETTLEMENT_READINESS_DISCLAIMER;
  schemaVersion: typeof SETTLEMENT_READINESS_SCHEMA_VERSION;
  computedAt: string;
  orderId: string;
  order: {
    verifiedPaid: string;
    allocatedVerified: string;
    /** NEVER supplier money; refundable only through an order-scoped refund. */
    unallocatedPaid: string;
    orderScopedRefundsLive: string;
    ledgerIn: string;
    ledgerOut: string;
    ledgerMeaning: "SUM(IN) − SUM(OUT) = net verified cash of the ORDER after completed refunds; never a seller balance";
  };
  children: ChildSettlementReadiness[];
};
