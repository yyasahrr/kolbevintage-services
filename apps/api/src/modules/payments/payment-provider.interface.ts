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

/**
 * Phase 4.7.1 (A2/A6) — a raw webhook normalized by the provider adapter.
 *
 * - `externalEventId` MUST be deterministic for the same provider event
 *   (provider event id, or a sha256 fingerprint of the canonical payload) —
 *   never a timestamp, so a redelivered webhook is recognized as a duplicate.
 * - `authenticated=false` means the adapter could not verify the sender
 *   (bad signature / shared secret); the event is persisted as `ignored`.
 * - Only allow-listed, non-sensitive fields may appear in `safeMetadata`.
 */
export type NormalizedProviderWebhook = {
  authenticated: boolean;
  externalEventId: string;
  providerReference: string | null;
  eventType: "payment.created" | "payment.pending" | "payment.success" | "payment.failed" | "payment.cancelled" | "refund.created" | "refund.success" | "refund.failed" | "unknown";
  amount?: bigint | null;
  currency?: string | null;
  safeMetadata: Record<string, unknown>;
  rejectionReason?: string;
};

export type ProviderWebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  /** Phase 4.7.1 — false for providers that have no server-to-server channel (manual transfer). */
  readonly supportsWebhooks: boolean;
  createIntent(input: CreateIntentInput | { orderId: string; amount: bigint; currency: string; method: string; idempotencyKey?: string }): Promise<PaymentIntent>;
  verify(input: { paymentId: string; externalReference?: string; providerReference?: string; amount?: bigint; currency?: string }): Promise<PaymentVerificationResult>;
  queryStatus(input: { paymentId: string; externalReference?: string; providerReference?: string }): Promise<PaymentStatusQuery>;
  refund(input: RefundRequest): Promise<RefundResult>;
  /** Phase 4.7.1 — authenticate + normalize an inbound webhook (pure, no DB, no network). */
  parseWebhook(input: ProviderWebhookRequest): NormalizedProviderWebhook;
}
