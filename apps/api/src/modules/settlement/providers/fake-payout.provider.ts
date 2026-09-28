import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  PayoutProvider,
  PayoutTransferInput,
  PayoutTransferResult,
} from "../payout-provider.interface";
import { SettlementDomainError } from "../settlement.errors";

export type FakePayoutScenario = "success" | "failure" | "processing" | "timeout";

@Injectable()
export class FakePayoutProvider implements PayoutProvider {
  readonly name = "fake" as const;
  private readonly logger = new Logger(FakePayoutProvider.name);
  private scenarioOverrides = new Map<string, FakePayoutScenario>();
  private defaultScenario: FakePayoutScenario = "success";

  setScenario(payoutId: string, scenario: FakePayoutScenario) {
    this.scenarioOverrides.set(payoutId, scenario);
  }

  setDefaultScenario(scenario: FakePayoutScenario) {
    this.defaultScenario = scenario;
  }

  clear() {
    this.scenarioOverrides.clear();
    this.defaultScenario = "success";
  }

  private assertNotProduction(): void {
    if (process.env.NODE_ENV === "production") {
      throw new SettlementDomainError(
        "FAKE_PAYOUT_PROVIDER_FORBIDDEN_IN_PRODUCTION",
        "درگاه تسویه تستی (Fake Payout Provider) در محیط production اکیداً ممنوع است",
        403,
      );
    }
  }

  async transfer(input: PayoutTransferInput): Promise<PayoutTransferResult> {
    this.assertNotProduction();

    const scenario = this.scenarioOverrides.get(input.payoutId) ?? this.defaultScenario;
    const refHash = createHash("sha256").update(input.payoutId).digest("hex").substring(0, 12).toUpperCase();
    const providerReference = `FAKE-PO-${refHash}`;
    const externalEventId = `ev_fake_${createHash("sha256").update(input.payoutId + ":" + input.amount.toString()).digest("hex").substring(0, 16)}`;

    this.logger.log(`Fake payout transfer payoutId=${input.payoutId} amount=${input.amount.toString()} scenario=${scenario}`);

    if (scenario === "timeout") {
      throw new Error("Fake payout provider network timeout");
    }

    if (scenario === "failure") {
      return {
        success: false,
        providerReference,
        externalEventId,
        status: "failed",
        errorMessage: "Fake provider rejected transfer (injected failure)",
        rawPayload: { scenario, payoutId: input.payoutId, amount: input.amount.toString() },
      };
    }

    if (scenario === "processing") {
      return {
        success: false,
        providerReference,
        externalEventId,
        status: "processing",
        rawPayload: { scenario, payoutId: input.payoutId, amount: input.amount.toString() },
      };
    }

    return {
      success: true,
      providerReference,
      externalEventId,
      status: "succeeded",
      rawPayload: {
        scenario: "success",
        payoutId: input.payoutId,
        amount: input.amount.toString(),
        currency: input.currency,
        completedAt: new Date().toISOString(),
      },
    };
  }

  async queryStatus(payoutId: string, providerReference?: string): Promise<PayoutTransferResult> {
    this.assertNotProduction();

    const scenario = this.scenarioOverrides.get(payoutId) ?? this.defaultScenario;
    const ref = providerReference ?? `FAKE-PO-${createHash("sha256").update(payoutId).digest("hex").substring(0, 12).toUpperCase()}`;
    const externalEventId = `ev_query_${createHash("sha256").update(payoutId + ":status").digest("hex").substring(0, 16)}`;

    if (scenario === "failure") {
      return {
        success: false,
        providerReference: ref,
        externalEventId,
        status: "failed",
        errorMessage: "Transfer failed at gateway",
      };
    }

    if (scenario === "processing") {
      return {
        success: false,
        providerReference: ref,
        externalEventId,
        status: "processing",
      };
    }

    return {
      success: true,
      providerReference: ref,
      externalEventId,
      status: "succeeded",
    };
  }
}
