import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentVerificationResult,
  PaymentStatusQuery,
  RefundRequest,
  RefundResult,
  CreateIntentInput,
  NormalizedProviderWebhook,
  ProviderWebhookRequest,
} from "../payment-provider.interface";

export type FakeScenario =
  | "success"
  | "failure"
  | "pending"
  | "wrong_amount"
  | "wrong_currency"
  | "timeout"
  | "duplicate_webhook"
  | "refund_supported"
  | "refund_unsupported";

type FakeIntentRecord = {
  paymentId: string;
  amount: bigint;
  currency: string;
  scenario: FakeScenario;
  externalReference: string;
  providerReference: string;
  createdAt: Date;
  attempts: number;
};

/** Header carrying the shared secret a fake "gateway" signs its webhooks with. */
export const FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER = "x-fake-signature";
const FAKE_WEBHOOK_SECRET_ENV = "FAKE_PAYMENT_WEBHOOK_SECRET";
const FAKE_WEBHOOK_SECRET_DEFAULT = "fake-payment-webhook-secret";

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) sorted[k] = (val as Record<string, unknown>)[k];
      return sorted;
    }
    return val;
  });
}

/**
 * Deterministic test double for an online gateway.
 *
 * Phase 4.7.1 hardening:
 *  - `parseWebhook` authenticates with a shared secret and derives a
 *    deterministic `externalEventId` (provider event id, else sha256 of the
 *    canonical payload) — never `Date.now()`.
 *  - `queryStatus` is the source of truth for the amount the gateway captured;
 *    the `wrong_amount` / `wrong_currency` scenarios make the canonical path
 *    reject the event (A6) instead of verifying blindly.
 *  - Refund references are only returned for a *successful* provider refund
 *    (A11); the manual provider never fabricates one.
 *
 * This provider is forbidden in production at the registry boundary (A10).
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly supportsWebhooks = true;
  private readonly logger = new Logger(FakePaymentProvider.name);
  private readonly intents = new Map<string, FakeIntentRecord>();
  private readonly externalToPayment = new Map<string, string>();
  private scenarioOverrides = new Map<string, FakeScenario>();
  private failNextQueryStatus = 0;

  setScenario(paymentId: string, scenario: FakeScenario) {
    this.scenarioOverrides.set(paymentId, scenario);
  }

  /** Test hook — make the next N `queryStatus` calls throw (provider outage). */
  failNextStatusQueries(count: number) {
    this.failNextQueryStatus = count;
  }

  clear() {
    this.intents.clear();
    this.externalToPayment.clear();
    this.scenarioOverrides.clear();
    this.failNextQueryStatus = 0;
  }

  static webhookSecret(): string {
    return process.env[FAKE_WEBHOOK_SECRET_ENV] || FAKE_WEBHOOK_SECRET_DEFAULT;
  }

  private resolveScenario(input: { paymentId?: string; externalReference?: string; providerReference?: string; amount?: bigint; reason?: string }): FakeScenario {
    const ref = ((input.externalReference || input.providerReference || input.reason || "") as string).toLowerCase();
    if (ref.includes("failure")) return "failure";
    if (ref.includes("pending")) return "pending";
    if (ref.includes("wrong_amount")) return "wrong_amount";
    if (ref.includes("wrong_currency")) return "wrong_currency";
    if (ref.includes("timeout")) return "timeout";
    if (ref.includes("duplicate")) return "duplicate_webhook";
    if (ref.includes("refund_unsupported")) return "refund_unsupported";
    if (ref.includes("refund_supported")) return "refund_supported";
    if (input.paymentId && this.scenarioOverrides.has(input.paymentId)) {
      return this.scenarioOverrides.get(input.paymentId)!;
    }
    if (input.providerReference && this.externalToPayment.has(input.providerReference)) {
      const pid = this.externalToPayment.get(input.providerReference)!;
      if (this.scenarioOverrides.has(pid)) return this.scenarioOverrides.get(pid)!;
    }
    return "success";
  }

  private recordFor(input: { paymentId?: string; providerReference?: string; externalReference?: string }): FakeIntentRecord | undefined {
    if (input.paymentId && this.intents.has(input.paymentId)) return this.intents.get(input.paymentId);
    const ref = input.providerReference || input.externalReference;
    if (ref && this.externalToPayment.has(ref)) return this.intents.get(this.externalToPayment.get(ref)!);
    return undefined;
  }

  async createIntent(input: CreateIntentInput | any): Promise<PaymentIntent> {
    const amount = (input as any).amount as bigint;
    const currency = (input as any).currency as string;
    const method = (input as any).method || "online";
    const paymentId = (input as any).paymentId || `pay_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const externalRef = `FAKE-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const scenario = this.resolveScenario({ paymentId, externalReference: externalRef, amount });

    const record: FakeIntentRecord = {
      paymentId,
      amount,
      currency,
      scenario,
      externalReference: externalRef,
      providerReference: externalRef,
      createdAt: new Date(),
      attempts: 0,
    };
    this.intents.set(paymentId, record);
    this.externalToPayment.set(externalRef, paymentId);

    this.logger.log(`Fake intent created paymentId=${paymentId} amount=${amount.toString()} scenario=${scenario}`);

    return {
      paymentId,
      reference: externalRef,
      amount,
      currency,
      method,
      provider: this.name,
      externalReference: externalRef,
      providerReference: externalRef,
      redirectUrl: `https://fake-payment.example/pay/${externalRef}`,
      providerState: "created",
    } as any;
  }

  async verify(input: any): Promise<PaymentVerificationResult> {
    const scenario = this.resolveScenario({ paymentId: input.paymentId, externalReference: input.externalReference, providerReference: input.providerReference, amount: input.amount });
    const record = this.recordFor(input);

    if (scenario === "timeout") throw new Error("Fake provider timeout");
    if (scenario === "failure") return { verified: false, externalReference: input.externalReference || "", failureReason: "fake_failure" } as any;
    if (scenario === "wrong_amount" || scenario === "wrong_currency") return { verified: false, externalReference: input.externalReference || "", failureReason: "amount_mismatch" } as any;
    if (scenario === "pending") return { verified: false, externalReference: input.externalReference || "", failureReason: "pending" } as any;

    return { verified: true, externalReference: input.externalReference || record?.externalReference || "", providerReference: input.providerReference || record?.providerReference, providerState: "success", amount: record?.amount } as any;
  }

  async queryStatus(input: any): Promise<PaymentStatusQuery> {
    if (this.failNextQueryStatus > 0) {
      this.failNextQueryStatus -= 1;
      throw new Error("Fake provider unavailable (injected outage)");
    }
    const scenario = this.resolveScenario({ paymentId: input.paymentId, externalReference: input.externalReference, providerReference: input.providerReference });
    const record = this.recordFor(input);
    const providerReference = record?.providerReference || input.providerReference;
    const externalReference = record?.externalReference || input.externalReference;

    if (scenario === "pending") return { state: "pending", status: "pending", externalReference, providerReference } as any;
    if (scenario === "failure") return { state: "failed", status: "failed", externalReference, providerReference } as any;
    if (scenario === "timeout") throw new Error("Fake provider timeout on queryStatus");
    if (!record) {
      // Unknown to the gateway: never claim success for a reference we did not issue.
      return { state: "unknown", status: "unknown", externalReference, providerReference } as any;
    }
    if (scenario === "wrong_amount") {
      return { state: "success", status: "success", externalReference, providerReference, amount: record.amount - 1n, currency: record.currency, amountMismatch: true } as any;
    }
    if (scenario === "wrong_currency") {
      return { state: "success", status: "success", externalReference, providerReference, amount: record.amount, currency: record.currency === "IRR" ? "USD" : "IRR" } as any;
    }
    return { state: "success", status: "success", externalReference, providerReference, amount: record.amount, currency: record.currency } as any;
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const scenario = this.resolveScenario({ paymentId: input.paymentId, reason: input.reason, amount: input.amount });

    if (scenario === "refund_unsupported") return { success: false, failureReason: "refund_unsupported" } as any;
    if (scenario === "failure") return { success: false, failureReason: "fake_refund_failure" } as any;
    if (scenario === "timeout") throw new Error("Fake provider timeout on refund");

    // Deterministic per refund: a retried provider call yields the same reference.
    const ref = `FAKE-REF-${createHash("sha256").update(`${input.refundId}:${input.amount.toString()}`).digest("hex").slice(0, 12).toUpperCase()}`;
    return { success: true, externalReference: ref, providerReference: ref, providerState: "refunded" } as any;
  }

  parseWebhook(input: ProviderWebhookRequest): NormalizedProviderWebhook {
    const body: any = input.body && typeof input.body === "object" ? input.body : {};
    const headerValue = input.headers[FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER];
    const presented = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const expected = FakePaymentProvider.webhookSecret();
    const authenticated =
      typeof presented === "string" &&
      presented.length === expected.length &&
      timingSafeEqual(Buffer.from(presented), Buffer.from(expected));

    const providerReference: string | null =
      typeof body.providerReference === "string" ? body.providerReference : typeof body.authority === "string" ? body.authority : typeof body.ref === "string" ? body.ref : null;
    const rawStatus = String(body.status || body.state || body.type || "").toLowerCase();
    let eventType: NormalizedProviderWebhook["eventType"] = "unknown";
    if (["success", "paid", "payment.success", "ok"].includes(rawStatus)) eventType = "payment.success";
    else if (["failed", "failure", "payment.failed"].includes(rawStatus)) eventType = "payment.failed";
    else if (["pending", "payment.pending"].includes(rawStatus)) eventType = "payment.pending";
    else if (["cancelled", "canceled", "payment.cancelled"].includes(rawStatus)) eventType = "payment.cancelled";
    else if (["created", "payment.created"].includes(rawStatus)) eventType = "payment.created";
    else if (["refund.success", "refunded"].includes(rawStatus)) eventType = "refund.success";
    else if (["refund.failed"].includes(rawStatus)) eventType = "refund.failed";

    let amount: bigint | null = null;
    if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
      try {
        amount = BigInt(String(body.amount));
      } catch {
        amount = null;
      }
    }
    const currency = typeof body.currency === "string" ? body.currency : null;

    // Deterministic identity: the gateway's own event id, else a fingerprint of the semantic payload.
    const providerEventId = typeof body.eventId === "string" && body.eventId.trim() ? body.eventId.trim() : null;
    const fingerprint = createHash("sha256")
      .update(canonicalJson({ provider: this.name, providerReference, eventType, amount: amount?.toString() ?? null, currency }))
      .digest("hex")
      .slice(0, 40);
    const externalEventId = providerEventId ?? `fp_${fingerprint}`;

    return {
      authenticated,
      externalEventId,
      providerReference,
      eventType,
      amount,
      currency,
      safeMetadata: {
        eventType,
        providerReference,
        amount: amount?.toString() ?? undefined,
        currency: currency ?? undefined,
        identity: providerEventId ? "provider_event_id" : "payload_fingerprint",
      },
      rejectionReason: authenticated ? undefined : "webhook_signature_invalid",
    };
  }

  getIntent(paymentId: string): FakeIntentRecord | undefined {
    return this.intents.get(paymentId);
  }
}
