import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  PayoutProvider,
  PayoutTransferInput,
  PayoutTransferResult,
} from "../payout-provider.interface";
import { SettlementDomainError } from "../settlement.errors";

const DUMMY_VALUES = new Set(["test", "testing", "123", "1234", "placeholder", "dummy", "n/a", "none"]);

@Injectable()
export class ManualPayoutProvider implements PayoutProvider {
  readonly name = "manual" as const;
  private readonly logger = new Logger(ManualPayoutProvider.name);

  async transfer(input: PayoutTransferInput): Promise<PayoutTransferResult> {
    const evidence = input.manualEvidence;
    if (!evidence) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_REQUIRED",
        "تسویه دستی مستلزم ثبت شواهد واریز بانکی خارجی است",
        400,
      );
    }

    const { referenceNumber, bankTrackingCode, transferredAt, statementId, transferSlipUrl } = evidence;

    if (!referenceNumber || typeof referenceNumber !== "string" || referenceNumber.trim().length < 4) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "شماره مرجع واریز بانکی (referenceNumber) باید حداقل ۴ نویسه معتبر باشد",
        400,
      );
    }

    if (DUMMY_VALUES.has(referenceNumber.trim().toLowerCase())) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "شماره مرجع صوری یا ساختگی غیرقابل قبول است",
        400,
      );
    }

    if (!bankTrackingCode || typeof bankTrackingCode !== "string" || bankTrackingCode.trim().length < 4) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "کد رهگیری بانکی (bankTrackingCode) باید حداقل ۴ نویسه معتبر باشد",
        400,
      );
    }

    if (DUMMY_VALUES.has(bankTrackingCode.trim().toLowerCase())) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "کد رهگیری بانکی صوری یا ساختگی غیرقابل قبول است",
        400,
      );
    }

    if (!transferredAt) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "تاریخ و زمان واریز بانکی (transferredAt) الزامی است",
        400,
      );
    }

    const transferDate = new Date(transferredAt);
    if (isNaN(transferDate.getTime())) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "تاریخ و زمان واریز بانکی نامعتبر است",
        400,
      );
    }

    const now = new Date();
    // Allow small clock skew (up to 5 minutes)
    if (transferDate.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "تاریخ واریز نمی‌تواند در آینده باشد",
        400,
      );
    }

    if (!statementId && !transferSlipUrl) {
      throw new SettlementDomainError(
        "MANUAL_PAYOUT_EVIDENCE_INVALID",
        "حداقل یکی از موارد شناسه صورتحساب (statementId) یا آدرس فیش واریز (transferSlipUrl) باید ثبت شود",
        400,
      );
    }

    const providerReference = bankTrackingCode.trim();
    const externalEventId = `ev_man_${createHash("sha256").update(providerReference + ":" + referenceNumber + ":" + transferredAt).digest("hex").substring(0, 24)}`;

    this.logger.log(`Manual payout verified payoutId=${input.payoutId} tracking=${providerReference} amount=${input.amount.toString()}`);

    return {
      success: true,
      providerReference,
      externalEventId,
      status: "succeeded",
      rawPayload: {
        provider: "manual",
        referenceNumber,
        bankTrackingCode,
        transferredAt: transferDate.toISOString(),
        statementId: statementId ?? null,
        transferSlipUrl: transferSlipUrl ?? null,
      },
    };
  }

  async queryStatus(payoutId: string, providerReference?: string): Promise<PayoutTransferResult> {
    if (!providerReference) {
      return {
        success: false,
        providerReference: "",
        externalEventId: `ev_man_unknown_${payoutId}`,
        status: "processing",
      };
    }

    return {
      success: true,
      providerReference,
      externalEventId: `ev_man_q_${providerReference}`,
      status: "succeeded",
    };
  }
}
