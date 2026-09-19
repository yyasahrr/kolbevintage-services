/**
 * Phase 4.6 — PaymentProvider abstraction
 * No network call while DB locks held.
 * Manual transfer first implementation.
 */

export type PaymentIntent = {
  paymentId: string;
  reference: string;
  amount: bigint;
  currency: string;
  method: string;
  provider: string;
  externalReference?: string;
};

export type PaymentVerificationResult = {
  verified: boolean;
  externalReference: string;
  failureReason?: string;
};

export type PaymentStatusQuery = {
  status: string;
  externalReference?: string;
  amount?: bigint;
};

export type RefundRequest = {
  refundId: string;
  paymentId?: string;
  amount: bigint;
  currency: string;
  reason?: string;
};

export type RefundResult = {
  success: boolean;
  externalReference?: string;
  failureReason?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createIntent(input: { orderId: string; amount: bigint; currency: string; method: string; idempotencyKey?: string }): Promise<PaymentIntent>;
  verify(input: { paymentId: string; externalReference?: string; amount: bigint; currency: string }): Promise<PaymentVerificationResult>;
  queryStatus(input: { paymentId: string; externalReference?: string }): Promise<PaymentStatusQuery>;
  refund(input: RefundRequest): Promise<RefundResult>;
}
