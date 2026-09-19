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
  providerReference?: string;
  redirectUrl?: string;
  providerState?: string;
};

export type PaymentVerificationResult = {
  verified: boolean;
  externalReference: string;
  failureReason?: string;
  providerState?: string;
  amount?: bigint;
};

export type PaymentStatusQuery = {
  state: string;
  status?: string;
  providerReference?: string;
  externalReference?: string;
  amount?: bigint;
  providerState?: string;
  amountMismatch?: boolean;
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
  providerReference?: string;
  failureReason?: string;
  providerState?: string;
};

export type CreateIntentInput = {
  orderId: string;
  paymentId?: string;
  buyerUserId?: string;
  amount: bigint;
  currency: string;
  method?: string;
  provider?: string;
  idempotencyKey?: string;
  callbackUrl?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createIntent(input: CreateIntentInput | { orderId: string; amount: bigint; currency: string; method: string; idempotencyKey?: string }): Promise<PaymentIntent>;
  verify(input: { paymentId: string; externalReference?: string; providerReference?: string; amount?: bigint; currency?: string }): Promise<PaymentVerificationResult>;
  queryStatus(input: { paymentId: string; externalReference?: string; providerReference?: string }): Promise<PaymentStatusQuery>;
  refund(input: RefundRequest): Promise<RefundResult>;
}
