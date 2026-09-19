import { Injectable, Inject, Logger } from "@nestjs/common";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { PaymentsService } from "../payments/payments.service";
import { PaymentProviderRegistry } from "../payments/payment-provider.registry";
import { PaymentProviderEventService } from "../payments/payment-provider-event.service";
import type { PaymentProvider, ProviderWebhookRequest } from "../payments/payment-provider.interface";
import { OrdersService } from "../orders/orders.service";
import { WholesaleFinanceOrchestrator } from "./wholesale-finance.orchestrator";

export class PaymentProviderOrchestratorError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "PROVIDER_NOT_ALLOWED" || code === "WEBHOOK_SIGNATURE_INVALID") status = 403;
    else if (code === "PAYMENT_PROVIDER_UNKNOWN" || code === "PAYMENT_NOT_FOUND") status = 404;
    else if (
      code === "PAYMENT_PROVIDER_REFERENCE_MISMATCH" ||
      code === "PAYMENT_PROVIDER_AMOUNT_MISMATCH" ||
      code === "PAYMENT_PROVIDER_CURRENCY_MISMATCH" ||
      code === "PAYMENT_PROVIDER_STATE_NOT_FINAL" ||
      code === "PAYMENT_PROVIDER_MISMATCH"
    )
      status = 409;
    super(status, code, message);
    this.name = "PaymentProviderOrchestratorError";
  }
}

export type ProviderEventOutcome =
  | { eventId: string; status: "processed"; paymentId: string; action: "verified" | "rejected" | "already_final" }
  | { eventId: string; status: "ignored"; reason: string }
  | { eventId: string; status: "failed"; reason: string }
  | { eventId: string; status: "processing" | "duplicate"; reason: string };

/**
 * System-driven writes carry no human identity: every actor column that matters
 * (payment.verified_by, order_financial_release.actor_id, order_status_history /
 * order_event.actor_id) is an FK to account_user, so the only correct value is
 * NULL together with actorRole "system". Provenance lives in event/idempotency rows.
 */
const SYSTEM_ACTOR: null = null;

/**
 * Phase 4.7.1 — canonical provider path. Owns NO tables.
 *
 * Webhook:
 *   adapter.parseWebhook (auth + deterministic identity)         [A2, A6]
 *   → persist payment_provider_event (UNIQUE provider+event id)   [A2]
 *   → atomic claim received|failed → processing                   [A3]
 *   → provider.queryStatus  (no DB lock held)                     [B1-style]
 *   → resolve Payment by (provider, provider_reference)           [A5]
 *   → validate provider / reference / amount / currency / final   [A6]
 *   → ONE transaction: WholesaleFinanceOrchestrator.verifyPayment
 *     (PaymentsService.verify → allocations → ledger IN → events →
 *      coverage → release → OrdersService gate) + mark processed    [A1]
 *   any throw ⇒ transaction rolled back ⇒ event `failed`, never processed [A4]
 *
 * Callback (browser redirect) never verifies                        [A7]
 * Reconciliation re-drives the same path with deterministic keys    [A8, A9]
 */
@Injectable()
export class PaymentProviderOrchestrator {
  private readonly logger = new Logger(PaymentProviderOrchestrator.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PaymentProviderEventService) private readonly eventService: PaymentProviderEventService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(WholesaleFinanceOrchestrator) private readonly financeOrchestrator: WholesaleFinanceOrchestrator,
  ) {}

  /** A7 — the redirect leg carries no authority. It is never a verification signal. */
  describeCallback(provider: string, query: Record<string, unknown>) {
    const adapter = this.registry.resolve(provider);
    const referencePresent = Boolean(query?.authority || query?.Authority || query?.ref || query?.Ref || query?.providerReference);
    return {
      provider: adapter.name,
      verified: false,
      verificationPending: true,
      referencePresent,
      message: "Callback acknowledged. Verification happens only through the authenticated provider webhook or reconciliation.",
    };
  }

  /** Ingest an inbound webhook and drive the canonical path. */
  async ingestWebhook(input: { provider: string; request: ProviderWebhookRequest }): Promise<{ received: true; duplicate: boolean; outcome: ProviderEventOutcome }> {
    const adapter = this.registry.resolve(input.provider); // A10: fake in production / disabled → DomainError
    if (!adapter.supportsWebhooks) {
      throw new PaymentProviderOrchestratorError("PROVIDER_NOT_ALLOWED", `Provider ${adapter.name} has no webhook channel`);
    }
    const normalized = adapter.parseWebhook(input.request);
    if (!normalized.authenticated) {
      // An unauthenticated payload must not be allowed to occupy an event identity
      // (it could otherwise shadow the genuine delivery). Reject without persisting.
      throw new PaymentProviderOrchestratorError("WEBHOOK_SIGNATURE_INVALID", normalized.rejectionReason || "webhook not authenticated");
    }

    const inbox = await this.eventService.recordEvent({
      provider: adapter.name,
      externalEventId: normalized.externalEventId,
      externalPaymentReference: normalized.providerReference,
      eventType: normalized.eventType,
      safeMetadata: normalized.safeMetadata,
    });

    const outcome = await this.processEvent(inbox.id);
    return { received: true, duplicate: inbox.isDuplicate, outcome };
  }

  /**
   * Claim + process one inbox event. Safe to call concurrently and repeatedly:
   * only the claimant proceeds; everyone else observes the current status.
   */
  async processEvent(eventId: string): Promise<ProviderEventOutcome> {
    const claimed = await this.eventService.claim(eventId);
    if (!claimed) {
      const current = await this.eventService.getEventById(eventId);
      const status = current?.status || "unknown";
      if (status === "processed") return { eventId, status: "duplicate", reason: "already_processed" };
      if (status === "processing") return { eventId, status: "processing", reason: "claimed_by_another_worker" };
      if (status === "ignored") return { eventId, status: "duplicate", reason: `already_ignored:${current?.failure_reason || ""}` };
      return { eventId, status: "failed", reason: `unclaimable_status:${status}` };
    }

    try {
      return await this.processClaimedEvent(claimed);
    } catch (e: any) {
      const reason = e instanceof DomainError ? `${e.code}: ${e.message}` : e?.message || "unknown_error";
      await this.eventService.markFailed(eventId, reason);
      this.logger.warn(`Provider event ${eventId} failed: ${reason}`);
      return { eventId, status: "failed", reason };
    }
  }

  private async processClaimedEvent(event: any): Promise<ProviderEventOutcome> {
    const eventId = String(event.id);
    const providerName = String(event.provider);
    const eventType = String(event.event_type || "unknown");
    const adapter = this.registry.resolve(providerName);

    if (!eventType.startsWith("payment.")) {
      await this.eventService.markIgnored(eventId, `unsupported_event_type:${eventType}`);
      return { eventId, status: "ignored", reason: `unsupported_event_type:${eventType}` };
    }
    const providerReference = event.external_payment_reference ? String(event.external_payment_reference) : null;
    if (!providerReference) {
      await this.eventService.markIgnored(eventId, "missing_provider_reference");
      return { eventId, status: "ignored", reason: "missing_provider_reference" };
    }

    // A5 — provider-scoped resolution.
    const paymentRow = await this.paymentsService.findPaymentByProviderReference(adapter.name, providerReference);
    if (!paymentRow) {
      // Retryable: the intent's TxB may not have persisted the reference yet; reconciliation re-drives it.
      throw new PaymentProviderOrchestratorError("PAYMENT_NOT_FOUND", `No ${adapter.name} payment with the given provider reference`);
    }

    return this.settleWithProvider({
      adapter,
      paymentRow,
      providerReference,
      idempotencyKey: `webhook:${adapter.name}:${event.external_event_id}`,
      trigger: "webhook",
      eventId,
      eventAmount: event.safe_metadata?.amount ? String(event.safe_metadata.amount) : null,
      eventCurrency: event.safe_metadata?.currency ? String(event.safe_metadata.currency) : null,
    });
  }

  /**
   * Query the provider (no lock) and, on a final state, run the canonical chain
   * in ONE transaction together with the event's terminal status.
   */
  private async settleWithProvider(input: {
    adapter: PaymentProvider;
    paymentRow: any;
    providerReference: string;
    idempotencyKey: string;
    trigger: "webhook" | "reconciliation";
    eventId?: string;
    eventAmount?: string | null;
    eventCurrency?: string | null;
  }): Promise<ProviderEventOutcome> {
    const { adapter, paymentRow, providerReference, eventId } = input;
    const paymentId = String(paymentRow.id);
    const finish = async (result: ProviderEventOutcome, tx?: any) => {
      if (eventId) {
        if (result.status === "processed") await this.eventService.markProcessed(eventId, adapter.name, tx);
        else if (result.status === "ignored") await this.eventService.markIgnored(eventId, result.reason, tx);
      }
      return result;
    };

    // A6 — the payment must belong to this provider and carry this reference.
    if (String(paymentRow.provider).toLowerCase() !== adapter.name) {
      throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_MISMATCH", `Payment ${paymentId} belongs to provider ${paymentRow.provider}, not ${adapter.name}`);
    }
    if (String(paymentRow.provider_reference || "") !== providerReference) {
      throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_REFERENCE_MISMATCH", `Provider reference does not match payment ${paymentId}`);
    }
    const expectedAmount = BigInt(paymentRow.amount);
    const expectedCurrency = String(paymentRow.currency || "IRR");
    if (input.eventAmount !== null && input.eventAmount !== undefined && BigInt(input.eventAmount) !== expectedAmount) {
      throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_AMOUNT_MISMATCH", `Webhook amount ${input.eventAmount} != payment ${expectedAmount.toString()}`);
    }
    if (input.eventCurrency && input.eventCurrency !== expectedCurrency) {
      throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_CURRENCY_MISMATCH", `Webhook currency ${input.eventCurrency} != payment ${expectedCurrency}`);
    }

    // Already final in our ledger: the event carries no new information.
    if (paymentRow.status === "verified" || paymentRow.status === "failed" || paymentRow.status === "cancelled") {
      return finish({ eventId: eventId || "", status: "processed", paymentId, action: "already_final" });
    }

    // Provider is the source of truth — queried with no DB lock held.
    const status = await adapter.queryStatus({ paymentId, providerReference, externalReference: paymentRow.external_reference || undefined });
    const state = String((status as any).state || (status as any).status || "unknown").toLowerCase();
    const reportedReference = (status as any).providerReference ? String((status as any).providerReference) : null;
    if (reportedReference && reportedReference !== providerReference) {
      throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_REFERENCE_MISMATCH", `Provider reported reference for a different payment`);
    }

    if (state === "success") {
      const reportedAmount = (status as any).amount;
      if (reportedAmount === undefined || reportedAmount === null) {
        throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_AMOUNT_MISMATCH", `Provider did not report a captured amount for payment ${paymentId}`);
      }
      if (BigInt(reportedAmount) !== expectedAmount) {
        throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_AMOUNT_MISMATCH", `Provider amount ${BigInt(reportedAmount).toString()} != payment ${expectedAmount.toString()}`);
      }
      const reportedCurrency = (status as any).currency ? String((status as any).currency) : null;
      if (reportedCurrency && reportedCurrency !== expectedCurrency) {
        throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_CURRENCY_MISMATCH", `Provider currency ${reportedCurrency} != payment ${expectedCurrency}`);
      }

      // ONE transaction: verify chain + order event + event processed. Any throw → nothing persisted.
      return this.db.transaction(async (tx: any) => {
        const result = await this.financeOrchestrator.verifyPayment({
          paymentId,
          adminUserId: SYSTEM_ACTOR,
          externalReference: providerReference,
          idempotencyKey: input.idempotencyKey,
          actorRole: "system",
          reason: `${input.trigger}:${adapter.name}`,
          executor: tx,
        });
        const orderId = String(paymentRow.wholesale_order_id);
        await this.ordersService.recordProviderPaymentEvent({
          orderId,
          paymentId,
          eventType: input.trigger === "webhook" ? "payment.provider_verified" : "payment.reconciled",
          provider: adapter.name,
          providerEventId: eventId || null,
          amount: expectedAmount.toString(),
          currency: expectedCurrency,
          replayed: Boolean((result as any).replayed),
          actorId: SYSTEM_ACTOR,
          executor: tx,
        });
        return finish({ eventId: eventId || "", status: "processed", paymentId, action: (result as any).replayed ? "already_final" : "verified" }, tx);
      });
    }

    if (state === "failed" || state === "cancelled") {
      return this.db.transaction(async (tx: any) => {
        const result = await this.financeOrchestrator.rejectPayment({
          paymentId,
          adminUserId: SYSTEM_ACTOR,
          reason: `${input.trigger}:${adapter.name}:provider_${state}`,
          idempotencyKey: `${input.idempotencyKey}:reject`,
          actorRole: "system",
          executor: tx,
        });
        const orderId = String(paymentRow.wholesale_order_id);
        await this.ordersService.recordProviderPaymentEvent({
          orderId,
          paymentId,
          eventType: input.trigger === "webhook" ? "payment.provider_webhook_received" : "payment.reconciled",
          provider: adapter.name,
          providerEventId: eventId || null,
          amount: expectedAmount.toString(),
          currency: expectedCurrency,
          replayed: Boolean((result as any).replayed),
          providerState: state,
          actorId: SYSTEM_ACTOR,
          executor: tx,
        });
        return finish({ eventId: eventId || "", status: "processed", paymentId, action: (result as any).replayed ? "already_final" : "rejected" }, tx);
      });
    }

    // pending / unknown — not final: nothing may be verified.
    if (input.trigger === "webhook") {
      return finish({ eventId: eventId || "", status: "ignored", reason: `provider_state_not_final:${state}` });
    }
    throw new PaymentProviderOrchestratorError("PAYMENT_PROVIDER_STATE_NOT_FINAL", `Provider state ${state} is not final for payment ${paymentId}`);
  }

  /**
   * A8/A9/B18 — reconciliation. Deterministic idempotency (`reconcile:<paymentId>:<reference>`),
   * same canonical chain, safe to run concurrently with webhooks (payment row lock inside
   * PaymentsService.verify serializes them; the loser observes `replayed`).
   */
  async reconcile(input: { limit?: number; staleProcessingMinutes?: number } = {}) {
    const limit = Math.max(1, Math.min(200, input.limit ?? 20));
    const summary = { eventsRetried: 0, eventsProcessed: 0, eventsFailed: 0, eventsIgnored: 0, paymentsChecked: 0, paymentsVerified: 0, paymentsRejected: 0, paymentsPending: 0, paymentsFailed: 0, staleReclaimed: 0 };

    // 1. A crashed worker leaves `processing` behind; after a grace period it becomes retryable.
    summary.staleReclaimed = await this.eventService.reclaimStaleProcessing(input.staleProcessingMinutes ?? 15);

    // 2. Re-drive inbox events (received/failed).
    const events = await this.eventService.findUnresolvedEvents(limit);
    for (const ev of events) {
      summary.eventsRetried += 1;
      const outcome = await this.processEvent(String(ev.id));
      if (outcome.status === "processed") summary.eventsProcessed += 1;
      else if (outcome.status === "ignored") summary.eventsIgnored += 1;
      else if (outcome.status === "failed") summary.eventsFailed += 1;
    }

    // 3. Payments that never received a (usable) webhook.
    const payments = await this.paymentsService.listUnresolvedProviderPayments(limit);
    for (const row of payments) {
      summary.paymentsChecked += 1;
      try {
        const adapter = this.registry.resolve(String(row.provider));
        const outcome = await this.settleWithProvider({
          adapter,
          paymentRow: row,
          providerReference: String(row.provider_reference),
          idempotencyKey: `reconcile:${row.id}:${row.provider_reference}`,
          trigger: "reconciliation",
        });
        if (outcome.status === "processed") {
          if (outcome.action === "verified") summary.paymentsVerified += 1;
          else if (outcome.action === "rejected") summary.paymentsRejected += 1;
        }
      } catch (e: any) {
        if (e instanceof DomainError && e.code === "PAYMENT_PROVIDER_STATE_NOT_FINAL") summary.paymentsPending += 1;
        else {
          summary.paymentsFailed += 1;
          this.logger.warn(`Reconciliation of payment ${row.id} failed: ${e?.message || e}`);
        }
      }
    }
    return summary;
  }
}
