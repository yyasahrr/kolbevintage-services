/**
 * Phase 4.7 — Future Iranian Payment Provider Extension Point
 * Documentation only — no real credentials, no real API calls.
 *
 * To add a real provider (e.g., NextPay, Vandar, ZarinPal, etc.):
 *
 * 1. Create a new provider class implementing PaymentProvider:
 *
 * ```ts
 * @Injectable()
 * export class NextPayProvider implements PaymentProvider {
 *   readonly name = "nextpay";
 *
 *   async createIntent(input: { orderId: string; amount: bigint; currency: string; method: string; idempotencyKey?: string }): Promise<PaymentIntent> {
 *     // 1. Validate env credentials: NEXTPAY_API_KEY, NEXTPAY_CALLBACK_URL
 *     // 2. Call NextPay API outside DB transaction
 *     // 3. Return canonical PaymentIntent with generic providerReference and redirectUrl
 *     // 4. No provider-specific columns — use generic fields: providerReference, redirectUrl, providerState
 *   }
 *
 *   async verify(...): Promise<PaymentVerificationResult> { ... }
 *   async queryStatus(...): Promise<PaymentStatusQuery> { ... }
 *   async refund(...): Promise<RefundResult> { ... }
 * }
 * ```
 *
 * 2. Register in PaymentProviderRegistry:
 * - Add to providers map
 * - Add env guard for credentials: check NEXTPAY_API_KEY exists when mode=sandbox|live
 * - Ensure fake guard still blocks fake in production
 *
 * 3. Add env vars to infra/env:
 * - WHOLESALE_PAYMENT_PROVIDER=nextpay
 * - PAYMENT_PROVIDER_MODE=sandbox|live
 * - NEXTPAY_API_KEY, NEXTPAY_CALLBACK_URL, etc.
 *
 * 4. No changes to PaymentsService core domain needed — it already owns Payment status, allocation, ledger, refund.
 *
 * 5. Tests: use FakePaymentProvider for CI, real provider only in sandbox/live with credentials supplied.
 *
 * IMPORTANT:
 * - Do NOT store PAN, CVV, secrets, session, cookies
 * - Callback != verification — callback may inform UI but server-side verify remains mandatory
 * - Webhook endpoint delegates to provider adapter for parsing, then PaymentsService for canonical effects
 * - All provider calls outside DB FOR UPDATE locks
 * - Idempotency via payment_provider_event (provider, external_event_id) unique
 *
 * No live or sandbox Iranian payment provider was connected because credentials were not supplied.
 * No real payment was performed.
 * No real refund was performed.
 */

export const FUTURE_PROVIDER_DOCS = `
Future provider placeholder — documentation only.
`;
