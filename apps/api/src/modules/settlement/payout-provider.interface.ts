export interface PayoutTransferInput {
  payoutId: string;
  withdrawalRequestId: string;
  supplierId: string;
  amount: bigint;
  currency: string;
  bankDestinationSnapshot: Record<string, unknown>;
  idempotencyKey: string;
  manualEvidence?: {
    referenceNumber: string;
    bankTrackingCode: string;
    transferredAt: string;
    statementId?: string;
    transferSlipUrl?: string;
  } | null;
}

export interface PayoutTransferResult {
  success: boolean;
  providerReference: string;
  externalEventId: string;
  status: "succeeded" | "failed" | "processing";
  errorMessage?: string;
  rawPayload?: Record<string, unknown>;
}

export interface PayoutProvider {
  readonly name: "fake" | "manual";
  transfer(input: PayoutTransferInput): Promise<PayoutTransferResult>;
  queryStatus?(payoutId: string, providerReference?: string): Promise<PayoutTransferResult>;
}
