export interface SettlementAccountSummary {
  supplierId: string;
  currency: string;
  pendingEarnings: string;
  availableForSettlement: string;
  amountOnHold: string;
  settlementPending: string;
  settledAmount: string;
  recoveryAmount: string;
}

export interface SettlementPostingInput {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: bigint;
  currency?: string;
}

export interface CreateJournalInput {
  journalType: string;
  sourceEventType: string;
  sourceEventId: string;
  childOrderId?: string | null;
  orderItemId?: string | null;
  supplierId?: string | null;
  currency?: string;
  totalAmount: bigint;
  snapshotData?: Record<string, unknown>;
  postedBy?: string | null;
  reason?: string | null;
  effectiveAt?: Date;
  postings: SettlementPostingInput[];
}

export interface SettlementHistoryItem {
  id: string;
  journalType: string;
  sourceEventType: string;
  sourceEventId: string;
  childOrderId?: string | null;
  orderItemId?: string | null;
  supplierId?: string | null;
  currency: string;
  totalAmount: string;
  userFacingEventType: string;
  reason?: string | null;
  effectiveAt: string;
  createdAt: string;
}

export interface CreateCommissionPolicyInput {
  policyVersion: number;
  name: string;
  basis: "MERCHANDISE_ENTITLED_NET" | "GROSS_ORDERED";
  rateBps: number;
  fixedAmount?: bigint;
  roundingMode?: "HALF_UP" | "DOWN";
  status?: "active" | "retired";
  effectiveAt?: Date;
}

export interface CommissionPolicyView {
  id: string;
  policyVersion: number;
  name: string;
  basis: string;
  rateBps: number;
  fixedAmount: string;
  roundingMode: string;
  status: string;
  effectiveAt: string;
  createdAt: string;
}

export interface CommissionPolicySnapshot {
  policyId: string;
  policyVersion: number;
  basis: string;
  rateBps: number;
  fixedAmount: bigint;
  roundingMode: "HALF_UP" | "DOWN";
}

export interface UpsertShippingEconomicsInput {
  childOrderId: string;
  shippingChargeToBuyer?: bigint;
  shippingEconomicRecipient: "SUPPLIER" | "KOLBE" | "CARRIER_PASS_THROUGH" | "NONE" | "UNDEFINED";
  shippingCostBearer: "SUPPLIER" | "KOLBE" | "BUYER" | "UNDEFINED";
  shippingProvider?: string | null;
  currency?: string;
  status?: "draft" | "finalized";
}

export interface ShippingEconomicsView {
  id: string;
  childOrderId: string;
  shippingChargeToBuyer: string;
  shippingEconomicRecipient: string;
  shippingCostBearer: string;
  shippingProvider: string | null;
  currency: string;
  status: string;
  createdAt: string;
}

export interface ShippingEconomicsSnapshot {
  shippingChargeToBuyer: bigint;
  shippingEconomicRecipient: string;
  shippingCostBearer: string;
  shippingProvider?: string | null;
  currency: string;
}

export interface CreateHoldPolicyInput {
  policyVersion: number;
  name: string;
  holdDurationDays: number;
  status?: "active" | "retired";
  effectiveAt?: Date;
}

export interface SettlementHoldPolicyView {
  id: string;
  policyVersion: number;
  name: string;
  holdDurationDays: number;
  status: string;
  effectiveAt: string;
  createdAt: string;
}

export interface PlaceHoldInput {
  supplierId: string;
  childOrderId?: string | null;
  scope: "SUPPLIER" | "CHILD_ORDER" | "PAYOUT";
  reason: "RETURN_WINDOW" | "REFUND_PENDING" | "DISPUTE" | "CHARGEBACK_RISK" | "PROVIDER_UNCERTAINTY" | "MANUAL_FINANCE_HOLD";
  amount?: bigint | null;
  placedBy: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface ReleaseHoldInput {
  holdId: string;
  releasedBy: string;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface SettlementHoldView {
  id: string;
  supplierId: string;
  childOrderId: string | null;
  scope: string;
  reason: string;
  status: string;
  amount: string | null;
  currency: string;
  placedBy: string;
  releasedBy: string | null;
  notes: string | null;
  idempotencyKey: string;
  createdAt: string;
  releasedAt: string | null;
}

export interface BatchReleaseInput {
  asOfDate?: Date;
  supplierId?: string;
  dryRun?: boolean;
  idempotencyKey: string;
  executedBy: string;
}

export interface SettlementBatchView {
  id: string;
  batchCode: string;
  status: string;
  totalReleasedAmount: string;
  totalItemsCount: number;
  currency: string;
  executedBy: string;
  idempotencyKey: string;
  createdAt: string;
  completedAt: string | null;
}

export interface SettlementBatchItemView {
  id: string;
  batchId: string;
  supplierId: string;
  childOrderId: string | null;
  amount: string;
  status: string;
  journalId: string;
  createdAt: string;
}

export interface ProcessEarningsResult {
  childOrderId: string;
  candidate: boolean;
  cashCovered?: boolean;
  reason?: string;
  entitledAmount?: string;
  commissionAmount?: string;
  shippingAmount?: string;
  postedJournals: string[];
}

export interface ChildPaymentCoveredFact {
  orderId: string;
  childOrderId: string;
  sellerId: string;
  supplierId: string | null;
  proformaId: string;
  proformaVersion: number;
  payableAmount: bigint;
  coveredAmount: bigint;
  allocationIds: string[];
  currency: string;
}

export interface ChildQuantityDeliveredFact {
  shipmentId: string;
  wholesaleOrderItemId: string;
  childOrderId: string;
  sellerId: string;
  supplierId: string | null;
  pricingUnit: string;
  piecesPerUnit: number;
  unitPrice: bigint;
  deliveredPieces: number;
  cumulativeDeliveredPieces: number;
  cumulativeDeliveredUnits: number;
  deliveredAt: Date;
  trigger: string;
  currency: string;
}

export interface ChildQuantityRefundedFact {
  refundId: string;
  orderId: string;
  childOrderId?: string | null;
  sellerId?: string | null;
  supplierId?: string | null;
  amount: bigint;
  deliveryBasis: "UNDELIVERED" | "DELIVERED" | "UNSPECIFIED_AMOUNT_ONLY";
  lines: Array<{
    wholesaleOrderItemId: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
  }>;
  currency: string;
  completedAt: Date;
  externalReference?: string | null;
}

export interface WithdrawalRequestView {
  id: string;
  supplierId: string;
  requestedByUserId: string;
  amount: string;
  currency: string;
  bankDestinationId: string;
  bankDestinationSnapshot: {
    bankName?: string;
    maskedValue?: string;
    holderNameDeclared?: string;
    destinationKind?: string;
  };
  status: string;
  approvedByUserId?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  rejectedByUserId?: string | null;
  rejectedAt?: string | null;
  idempotencyKey: string;
  createdAt: string;
}

export interface PayoutView {
  id: string;
  withdrawalRequestId: string;
  supplierId: string;
  amount: string;
  currency: string;
  provider: string;
  providerReference?: string | null;
  status: string;
  bankDestinationSnapshot: Record<string, unknown>;
  initiatedBy: string;
  externalEvidence?: Record<string, unknown> | null;
  errorMessage?: string | null;
  reconciliationNotes?: string | null;
  createdAt: string;
  processingAt?: string | null;
  succeededAt?: string | null;
  failedAt?: string | null;
}
