import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentVerificationResult,
  PaymentStatusQuery,
  RefundRequest,
  RefundResult,
  CreateIntentInput,
} from "../payment-provider.interface";

export type FakeScenario =
  | "success"
  | "failure"
  | "pending"
  | "wrong_amount"
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

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private readonly logger = new Logger(FakePaymentProvider.name);
  private readonly intents = new Map<string, FakeIntentRecord>();
  private readonly externalToPayment = new Map<string, string>();
  private scenarioOverrides = new Map<string, FakeScenario>();

  setScenario(paymentId: string, scenario: FakeScenario) {
    this.scenarioOverrides.set(paymentId, scenario);
  }

  clear() {
    this.intents.clear();
    this.externalToPayment.clear();
    this.scenarioOverrides.clear();
  }

  private resolveScenario(input: { paymentId?: string; externalReference?: string; providerReference?: string; amount?: bigint; reason?: string }): FakeScenario {
    const ref = ((input.externalReference || input.providerReference || input.reason || "") as string).toLowerCase();
    if (ref.includes("failure")) return "failure";
    if (ref.includes("pending")) return "pending";
    if (ref.includes("wrong_amount")) return "wrong_amount";
    if (ref.includes("timeout")) return "timeout";
    if (ref.includes("duplicate")) return "duplicate_webhook";
    if (ref.includes("refund_unsupported")) return "refund_unsupported";
    if (ref.includes("refund_supported")) return "refund_supported";
    if (input.paymentId && this.scenarioOverrides.has(input.paymentId)) {
      return this.scenarioOverrides.get(input.paymentId)!;
    }
    return "success";
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
    const record = this.intents.get(input.paymentId);

    if (scenario === "timeout") throw new Error("Fake provider timeout");
    if (scenario === "failure") return { verified: false, externalReference: input.externalReference || "", failureReason: "fake_failure" } as any;
    if (scenario === "wrong_amount") return { verified: false, externalReference: input.externalReference || "", failureReason: "amount_mismatch" } as any;
    if (scenario === "pending") return { verified: false, externalReference: input.externalReference || "", failureReason: "pending" } as any;

    return { verified: true, externalReference: input.externalReference || record?.externalReference || "", providerReference: input.providerReference || record?.providerReference, providerState: "success" } as any;
  }

  async queryStatus(input: any): Promise<PaymentStatusQuery> {
    const scenario = this.resolveScenario({ paymentId: input.paymentId, externalReference: input.externalReference, providerReference: input.providerReference });
    const record = this.intents.get(input.paymentId);

    if (scenario === "pending") return { state: "pending", status: "pending", externalReference: input.externalReference || record?.externalReference, providerReference: input.providerReference || record?.providerReference } as any;
    if (scenario === "failure") return { state: "failed", status: "failed", externalReference: input.externalReference || record?.externalReference, providerReference: input.providerReference || record?.providerReference } as any;
    if (scenario === "timeout") throw new Error("Fake provider timeout on queryStatus");
    return { state: "success", status: "success", externalReference: input.externalReference || record?.externalReference, providerReference: input.providerReference || record?.providerReference, amount: record?.amount } as any;
  }

  async refund(input: RefundRequest): Promise<RefundResult> {
    const scenario = this.resolveScenario({ paymentId: input.paymentId, reason: input.reason, amount: input.amount });

    if (scenario === "refund_unsupported") return { success: false, failureReason: "refund_unsupported" } as any;
    if (scenario === "failure") return { success: false, failureReason: "fake_refund_failure" } as any;

    const ref = `FAKE-REF-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    return { success: true, externalReference: ref, providerReference: ref } as any;
  }

  getIntent(paymentId: string): FakeIntentRecord | undefined {
    return this.intents.get(paymentId);
  }
}
