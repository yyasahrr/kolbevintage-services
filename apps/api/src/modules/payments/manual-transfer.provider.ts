import { Injectable } from "@nestjs/common";
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentVerificationResult,
  PaymentStatusQuery,
  RefundRequest,
  RefundResult,
  NormalizedProviderWebhook,
  ProviderWebhookRequest,
} from "./payment-provider.interface";
import { randomUUID } from "node:crypto";

/**
 * Manual bank transfer provider — no network call.
 * Verification requires trusted admin evidence, never browser redirect.
 *
 * Phase 4.7.1:
 *  - There is no server-to-server channel: webhooks are unsupported and a
 *    manual "refund" is never executed programmatically — the operator
 *    completes it with the real bank reference (A11). No reference is ever
 *    fabricated here.
 */
@Injectable()
export class ManualTransferProvider implements PaymentProvider {
  readonly name = "manual";
  readonly supportsWebhooks = false;

  async createIntent(input: any): Promise<PaymentIntent> {
    const ref = `PAY-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    return {
      paymentId: input.paymentId || `pay_${randomUUID().replaceAll("-", "")}`,
      reference: ref,
      amount: input.amount,
      currency: input.currency,
      method: input.method || "online",
      provider: this.name,
      providerReference: ref,
    };
  }

  async verify(input: any): Promise<PaymentVerificationResult> {
    if (!input.externalReference || input.externalReference.trim().length === 0) {
      if (!input.providerReference) {
        return { verified: false, externalReference: "", failureReason: "external_reference required" } as any;
      }
    }
    return { verified: true, externalReference: input.externalReference || input.providerReference } as any;
  }

  async queryStatus(input: any): Promise<PaymentStatusQuery> {
    return { state: "pending", status: "pending", externalReference: input.externalReference, providerReference: input.providerReference } as any;
  }

  async refund(_input: RefundRequest): Promise<RefundResult> {
    // A11 — a manual refund is evidence-driven: the operator records the real
    // bank reference via the completion endpoint. Nothing is fabricated.
    return { success: false, failureReason: "refund_unsupported", providerState: "manual_evidence_required" } as any;
  }

  parseWebhook(_input: ProviderWebhookRequest): NormalizedProviderWebhook {
    return {
      authenticated: false,
      externalEventId: "unsupported",
      providerReference: null,
      eventType: "unknown",
      safeMetadata: {},
      rejectionReason: "manual_provider_has_no_webhook_channel",
    };
  }
}
