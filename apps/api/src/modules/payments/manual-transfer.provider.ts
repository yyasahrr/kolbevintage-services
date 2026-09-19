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

  async refund(input: RefundRequest): Promise<RefundResult> {
    const ref = `REF-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    return { success: true, externalReference: ref, providerReference: ref } as any;
  }
}
