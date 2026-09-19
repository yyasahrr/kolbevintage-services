import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { SettlementService } from "./settlement.service";
import { SettlementDomainError } from "./settlement.errors";

@Controller("admin/settlement")
export class AdminSettlementController {
  constructor(
    @Inject(SettlementService) private readonly settlement: SettlementService,
  ) {}

  private requireIdempotencyKey(header?: string): string {
    const key = header?.trim();
    if (!key) {
      throw new SettlementDomainError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header الزامی است",
        400,
      );
    }
    return key;
  }

  @Get("suppliers/:supplierId/summary")
  @Roles("admin")
  async getSupplierSummary(@Param("supplierId") supplierId: string) {
    const summary = await this.settlement.getSupplierSummary(supplierId);
    return toApiJson(summary);
  }

  @Get("suppliers/:supplierId/history")
  @Roles("admin")
  async getSupplierHistory(
    @Param("supplierId") supplierId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const history = await this.settlement.listSupplierHistory(supplierId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toApiJson({ items: history });
  }

  @Post("batches/release")
  @Roles("admin")
  async releaseBatch(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body() body: { supplierId?: string; dryRun?: boolean; asOfDate?: string },
  ) {
    const idempotencyKey = this.requireIdempotencyKey(idemHeader);
    const batch = await this.settlement.evaluateAndReleaseSettlementBatch({
      supplierId: body?.supplierId,
      dryRun: body?.dryRun ?? false,
      asOfDate: body?.asOfDate ? new Date(body.asOfDate) : undefined,
      idempotencyKey,
      executedBy: claims.sub,
    });
    return toApiJson({ batch });
  }

  @Post("holds")
  @Roles("admin")
  async placeHold(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body()
    body: {
      supplierId: string;
      childOrderId?: string;
      scope: "SUPPLIER" | "CHILD_ORDER" | "PAYOUT";
      reason:
        | "RETURN_WINDOW"
        | "REFUND_PENDING"
        | "DISPUTE"
        | "CHARGEBACK_RISK"
        | "PROVIDER_UNCERTAINTY"
        | "MANUAL_FINANCE_HOLD";
      amount?: string;
      notes?: string;
    },
  ) {
    const idempotencyKey = this.requireIdempotencyKey(idemHeader);
    const amount = body.amount ? BigInt(body.amount) : null;
    const hold = await this.settlement.placeHold({
      supplierId: body.supplierId,
      childOrderId: body.childOrderId ?? null,
      scope: body.scope,
      reason: body.reason,
      amount,
      placedBy: claims.sub,
      notes: body.notes,
      idempotencyKey,
    });
    return toApiJson({ hold });
  }

  @Post("holds/:holdId/release")
  @Roles("admin")
  async releaseHold(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Param("holdId") holdId: string,
    @Body() body: { notes?: string },
  ) {
    const hold = await this.settlement.releaseHold({
      holdId,
      releasedBy: claims.sub,
      notes: body?.notes,
      idempotencyKey: idemHeader?.trim(),
    });
    return toApiJson({ hold });
  }

  @Post("commission-policies")
  @Roles("admin")
  async createCommissionPolicy(
    @Body()
    body: {
      policyVersion: number;
      name: string;
      basis: "MERCHANDISE_ENTITLED_NET" | "GROSS_ORDERED";
      rateBps: number;
      fixedAmount?: string;
      roundingMode?: "HALF_UP" | "DOWN";
      status?: "active" | "retired";
    },
  ) {
    const policy = await this.settlement.createCommissionPolicy({
      policyVersion: body.policyVersion,
      name: body.name,
      basis: body.basis,
      rateBps: body.rateBps,
      fixedAmount: body.fixedAmount ? BigInt(body.fixedAmount) : undefined,
      roundingMode: body.roundingMode,
      status: body.status,
    });
    return toApiJson({ policy });
  }

  @Post("hold-policies")
  @Roles("admin")
  async createHoldPolicy(
    @Body()
    body: {
      policyVersion: number;
      name: string;
      holdDurationDays: number;
      status?: "active" | "retired";
    },
  ) {
    const policy = await this.settlement.createHoldPolicy({
      policyVersion: body.policyVersion,
      name: body.name,
      holdDurationDays: body.holdDurationDays,
      status: body.status,
    });
    return toApiJson({ policy });
  }

  @Post("shipping-economics")
  @Roles("admin")
  async upsertShippingEconomics(
    @Body()
    body: {
      childOrderId: string;
      shippingChargeToBuyer?: string;
      shippingEconomicRecipient: "SUPPLIER" | "KOLBE" | "CARRIER_PASS_THROUGH" | "NONE" | "UNDEFINED";
      shippingCostBearer: "SUPPLIER" | "KOLBE" | "BUYER" | "UNDEFINED";
      shippingProvider?: string;
      status?: "draft" | "finalized";
    },
  ) {
    const economics = await this.settlement.upsertShippingEconomics({
      childOrderId: body.childOrderId,
      shippingChargeToBuyer: body.shippingChargeToBuyer ? BigInt(body.shippingChargeToBuyer) : undefined,
      shippingEconomicRecipient: body.shippingEconomicRecipient,
      shippingCostBearer: body.shippingCostBearer,
      shippingProvider: body.shippingProvider,
      status: body.status,
    });
    return toApiJson({ economics });
  }

  @Post("withdrawals/:id/reject")
  @Roles("admin")
  async rejectWithdrawal(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason) {
      throw new SettlementDomainError("REJECTION_REASON_REQUIRED", "دلیل رد درخواست الزامی است", 400);
    }
    const withdrawal = await this.settlement.rejectWithdrawalRequest({
      withdrawalId: id,
      rejectedByUserId: claims.sub,
      reason: body.reason,
    });
    return toApiJson({ withdrawal });
  }

  @Post("payouts/execute")
  @Roles("admin")
  async executePayout(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idemHeader: string | undefined,
    @Body()
    body: {
      withdrawalRequestId: string;
      provider: "fake" | "manual";
      manualEvidence?: any;
    },
  ) {
    const idempotencyKey = this.requireIdempotencyKey(idemHeader);
    const payout = await this.settlement.executePayout({
      withdrawalRequestId: body.withdrawalRequestId,
      provider: body.provider,
      manualEvidence: body.manualEvidence,
      initiatedBy: claims.sub,
      idempotencyKey,
    });
    return toApiJson({ payout });
  }

  @Get("payouts")
  @Roles("admin")
  async listPayouts(
    @Query("supplierId") supplierId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const payouts = await this.settlement.listPayouts({
      supplierId,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toApiJson({ payouts });
  }

  @Get("payouts/:id")
  @Roles("admin")
  async getPayout(@Param("id") id: string) {
    const payout = await this.settlement.getPayoutById(id);
    return toApiJson({ payout });
  }

  @Post("reconciliation/run")
  @Roles("admin")
  async runReconciliation(
    @CurrentUser() claims: Claims,
    @Body() body: { type: "SETTLEMENT_PROJECTION" | "PAYOUT_STATUS"; supplierId?: string },
  ) {
    if (body?.type === "PAYOUT_STATUS") {
      const result = await this.settlement.reconcileProcessingPayouts({
        triggeredBy: claims.sub,
      });
      return toApiJson(result);
    } else {
      const result = await this.settlement.reconcileSettlementProjection(
        body?.supplierId,
        claims.sub,
      );
      return toApiJson(result);
    }
  }
}
