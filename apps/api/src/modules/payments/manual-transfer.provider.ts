import { Injectable } from "@nestjs/common";
import type { PaymentProvider, PaymentIntent, PaymentVerificationResult, PaymentStatusQuery, RefundRequest, RefundResult } from "./payment-provider.interface";
import { randomUUID } from "node:crypto";

/**
 * Manual bank transfer provider — no network call.
 * Verification requires trusted admin evidence, never browser redirect.
 */
@Injectable()
export class ManualTransferProvider implements PaymentProvider {
  readonly name = "manual";

  async createIntent(input: { orderId: string; amount: bigint; currency: string; method: string; idempotencyKey?: string }): Promise<PaymentIntent> {
    // No network, just generate reference
    const ref = `PAY-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    return {
      paymentId: `pay_${randomUUID().replaceAll("-", "")}`,
      reference: ref,
      amount: input.amount,
      currency: input.currency,
      method: input.method,
      provider: this.name,
    };
  }

  async verify(input: { paymentId: string; externalReference?: string; amount: bigint; currency: string }): Promise<PaymentVerificationResult> {
    // In manual flow, verification is done by trusted admin via evidence, not by provider network.
    // This method is placeholder for future external providers.
    // For manual, we require externalReference non-blank and amount match — validated in service, not here.
    if (!input.externalReference || input.externalReference.trim().length === 0) {
      return { verified: false, externalReference: "", failureReason: "external_reference required" };
    }
    return { verified: true, externalReference: input.externalReference };
  }

  async queryStatus(input: { paymentId: string; externalReference?: string }): Promise<PaymentStatusQuery> {
    // Manual has no external status — returns pending
    return { status: "pending", externalReference: input.externalReference };
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    // Manual refund requires trusted external evidence
    const ref = `REF-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    return { success: true, externalReference: ref };
  }
}
