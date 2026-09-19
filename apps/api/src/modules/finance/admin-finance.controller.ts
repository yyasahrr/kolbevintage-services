import { Body, Controller, Get, Headers, Param, Post, Query, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { PaymentsService } from "../payments/payments.service";
import { WholesaleFinanceOrchestrator } from "./wholesale-finance.orchestrator";

@Controller("admin")
export class AdminFinanceController {
  constructor(
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(WholesaleFinanceOrchestrator) private readonly orchestrator: WholesaleFinanceOrchestrator,
  ) {}

  @Get("payments")
  @Roles("admin", "finance")
  async listPayments(@Query("orderId") orderId?: string) {
    if (!orderId) return { payments: [] };
    const payments = await this.paymentsService.getPaymentsForAdmin(orderId);
    return { payments };
  }

  @Get("payments/:id")
  @Roles("admin", "finance")
  async getPayment(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const repo = (this.paymentsService as any).repository;
    const p = await repo.findPaymentById(id);
    if (!p) throw new Error("Payment not found");
    return {
      payment: {
        id: p.id,
        paymentReference: p.paymentReference,
        wholesaleOrderId: p.wholesaleOrderId,
        method: p.method,
        status: p.status,
        amount: (p.amount || 0).toString(),
        currency: p.currency,
        externalReference: p.externalReference,
        submittedBy: p.submittedBy,
        submittedAt: p.submittedAt,
        verifiedBy: p.verifiedBy,
        verifiedAt: p.verifiedAt,
        version: p.version,
      },
    };
  }

  @Post("payments/:id/verify")
  @Roles("admin", "finance")
  async verifyPayment(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { externalReference: string; reason?: string; expectedVersion?: number },
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2?: string,
    @Headers("x-expected-version") expectedVersionHeader?: string,
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const expectedVersion = expectedVersionHeader ? parseInt(expectedVersionHeader, 10) : body?.expectedVersion;
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) {
      throw new Error("Only admin/finance may verify");
    }
    const result: any = await this.orchestrator.verifyPayment({
      paymentId: id,
      adminUserId: claims.sub,
      expectedVersion,
      externalReference: body.externalReference,
      idempotencyKey,
      actorRole,
      reason: body.reason,
    });
    return {
      payment: {
        id: result.payment.id,
        status: result.payment.status,
        amount: (result.payment.amount || 0).toString(),
        version: result.payment.version,
      },
      allocations: result.allocations?.map((a: any) => ({
        id: a.id,
        proformaId: a.proformaId,
        amount: (a.amount || 0).toString(),
      })),
      release: result.release,
      coverage: result.coverage
        ? {
            payable: result.coverage.payable.toString(),
            allocated: result.coverage.allocated.toString(),
            isFullyCovered: result.coverage.isFullyCovered,
          }
        : undefined,
      replayed: result.replayed,
    };
  }

  @Post("payments/:id/reject")
  @Roles("admin", "finance")
  async rejectPayment(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { reason: string; expectedVersion?: number },
    @Headers("idempotency-key") idempotencyKeyHeader?: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2?: string,
    @Headers("x-expected-version") expectedVersionHeader?: string,
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const expectedVersion = expectedVersionHeader ? parseInt(expectedVersionHeader, 10) : body?.expectedVersion;
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may reject");
    const result = await this.orchestrator.rejectPayment({
      paymentId: id,
      adminUserId: claims.sub,
      reason: body.reason,
      idempotencyKey,
      expectedVersion,
      actorRole,
    });
    return {
      payment: {
        id: result.payment.id,
        status: result.payment.status,
        version: result.payment.version,
      },
      replayed: result.replayed,
    };
  }

  @Get("refunds")
  @Roles("admin", "finance")
  async listRefunds(@Query("orderId") orderId?: string) {
    if (!orderId) return { refunds: [] };
    const refunds = await this.paymentsService.getRefundsForAdmin(orderId);
    return { refunds };
  }

  @Post("refunds")
  @Roles("admin", "finance")
  async createRefund(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body()
    body: {
      orderId: string;
      childOrderId?: string;
      exceptionId?: string;
      paymentId?: string;
      amount: string;
      currency?: string;
      reasonCode?: string;
      reason?: string;
    },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may create refunds");
    const result = await this.orchestrator.createRefund({
      orderId: body.orderId,
      childOrderId: body.childOrderId,
      exceptionId: body.exceptionId,
      paymentId: body.paymentId,
      amount: body.amount,
      currency: body.currency,
      reasonCode: body.reasonCode,
      reason: body.reason,
      actorUserId: claims.sub,
      actorRole,
      idempotencyKey,
    });
    return {
      refund: {
        id: result.refund.id,
        refundReference: result.refund.refundReference,
        amount: (result.refund.amount || 0).toString(),
        status: result.refund.status,
      },
      replayed: result.replayed,
    };
  }

  @Post("refunds/:id/approve")
  @Roles("admin", "finance")
  async approveRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { reason?: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may approve");
    const result = await this.orchestrator.approveRefund({
      refundId: id,
      adminUserId: claims.sub,
      idempotencyKey,
      reason: body.reason,
      actorRole,
    });
    return {
      refund: {
        id: result.refund.id,
        status: result.refund.status,
        version: result.refund.version,
      },
      replayed: result.replayed,
    };
  }

  @Post("refunds/:id/complete")
  @Roles("admin", "finance")
  async completeRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { externalReference: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may complete");
    const result = await this.orchestrator.completeRefund({
      refundId: id,
      adminUserId: claims.sub,
      externalReference: body.externalReference,
      idempotencyKey,
      actorRole,
    });
    return {
      refund: {
        id: result.refund.id,
        status: result.refund.status,
        version: result.refund.version,
      },
      ledgerId: result.ledgerId,
      replayed: result.replayed,
    };
  }

  @Post("refunds/:id/fail")
  @Roles("admin", "finance")
  async failRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { reason: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may fail");
    const failResult = await this.paymentsService.failRefund({
      refundId: id,
      adminUserId: claims.sub,
      reason: body.reason,
      idempotencyKey,
      actorRole,
    });
    return {
      refund: {
        id: failResult.refund.id,
        status: failResult.refund.status,
      },
      replayed: failResult.replayed,
    };
  }

  @Post("orders/:id/credit-approve")
  @Roles("admin", "finance")
  async creditApprove(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { evidenceReference: string; amount?: string; currency?: string; reason: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may credit approve");
    const result: any = await this.orchestrator.creditApprove({
      orderId: id,
      adminUserId: claims.sub,
      evidenceReference: body.evidenceReference,
      amount: body.amount,
      currency: body.currency,
      reason: body.reason,
      idempotencyKey,
      actorRole,
    });
    return { order: { id: result.order?.id || id, status: result.order?.status || "processing" }, releaseId: result.releaseId, replayed: result.replayed };
  }

  @Post("orders/:id/cod-approve")
  @Roles("admin", "finance")
  async codApprove(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { evidenceReference: string; reason: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const actorRole = claims.role;
    if (!["admin", "finance"].includes(actorRole)) throw new Error("Only admin/finance may COD approve");
    const result: any = await this.orchestrator.codApprove({
      orderId: id,
      adminUserId: claims.sub,
      evidenceReference: body.evidenceReference,
      reason: body.reason,
      idempotencyKey,
      actorRole,
    });
    return { order: { id: result.order?.id || id, status: result.order?.status || "processing" }, releaseId: result.releaseId, replayed: result.replayed };
  }
}
