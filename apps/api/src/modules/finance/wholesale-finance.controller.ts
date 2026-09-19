import { Body, Controller, Get, Headers, Param, Post, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { WholesaleFinanceOrchestrator } from "./wholesale-finance.orchestrator";
import { PaymentsService } from "../payments/payments.service";
import { OrdersService } from "../orders/orders.service";

@Controller("wholesale/orders")
export class WholesaleFinanceController {
  constructor(
    @Inject(WholesaleFinanceOrchestrator) private readonly orchestrator: WholesaleFinanceOrchestrator,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
  ) {}

  @Post(":id/confirm")
  @Roles("vip", "customer")
  async confirmOrder(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Headers("x-expected-version") expectedVersionHeader?: string,
    @Body() body?: any,
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2 || body?.idempotencyKey;
    if (!idempotencyKey) {
      throw new Error("Idempotency-Key required");
    }
    const expectedVersion = expectedVersionHeader ? parseInt(expectedVersionHeader, 10) : body?.expectedVersion;
    const result = await this.orchestrator.confirmOrder({
      orderId: id,
      buyerUserId: claims.sub,
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
      idempotencyKey,
      actorRole: claims.role,
    });
    return {
      order: {
        id: result.order.id,
        status: result.order.status,
        version: result.order.version,
      },
      proformas: result.proformas?.map((p: any) => ({
        id: p.id,
        proformaNumber: p.proformaNumber || p.proforma_number,
        childOrderId: p.childOrderId || p.child_order_id,
        sellerId: p.sellerId || p.seller_id,
        totalAmount: (p.totalAmount || p.total_amount || 0).toString(),
        status: p.status,
      })),
      replayed: result.replayed || false,
    };
  }

  @Get(":id/proformas")
  @Roles("vip", "customer")
  async getProformas(@CurrentUser() claims: Claims, @Param("id") id: string) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    const proformas = await this.paymentsService.getProformasForBuyer(id);
    return { proformas };
  }

  @Get(":id/financial-summary")
  @Roles("vip", "customer", "admin")
  async getFinancialSummary(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role !== "admin") {
      await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    }
    const summary = await this.paymentsService.getOrderFinancialSummary(id);
    return summary;
  }

  @Get(":id/payments")
  @Roles("vip", "customer")
  async getPayments(@CurrentUser() claims: Claims, @Param("id") id: string) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    const payments = await this.paymentsService.getPaymentsForBuyer(id);
    return { payments };
  }

  @Get(":id/refunds")
  @Roles("vip", "customer")
  async getRefunds(@CurrentUser() claims: Claims, @Param("id") id: string) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    const refunds = await this.paymentsService.getRefundsForBuyer(id);
    return { refunds };
  }

  @Post(":id/payments/transfer")
  @Roles("vip", "customer")
  async submitTransfer(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { amount: string; bankReference?: string; evidenceReference?: string },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    if (!body?.amount) throw new Error("amount required");
    const result = await this.orchestrator.submitTransfer({
      orderId: id,
      buyerUserId: claims.sub,
      amount: body.amount,
      bankReference: body.bankReference,
      evidenceReference: body.evidenceReference,
      idempotencyKey,
      actorRole: claims.role,
    });
    return {
      payment: {
        id: result.payment.id,
        paymentReference: result.payment.paymentReference || result.payment.payment_reference,
        amount: (result.payment.amount || 0).toString(),
        currency: result.payment.currency,
        status: result.payment.status,
        referencePresent: !!result.payment.externalReference || !!result.payment.external_reference,
      },
      replayed: result.replayed,
    };
  }

  @Post(":id/payments/online")
  @Roles("vip", "customer")
  async createOnlinePayment(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body?: any,
  ) {
    const finalIdem = idempotencyKeyHeader || idempotencyKeyHeader2 || body?.idempotencyKey;
    if (!finalIdem) throw new Error("Idempotency-Key required");
    const result = await this.orchestrator.createOnlinePaymentIntent({
      orderId: id,
      buyerUserId: claims.sub,
      idempotencyKey: finalIdem,
      providerName: body?.provider,
      callbackUrl: body?.callbackUrl,
      actorRole: claims.role,
    });
    const payment = (result as any).payment;
    const provResult = (result as any).providerResult;
    return {
      payment: {
        id: payment.id,
        paymentReference: payment.paymentReference || payment.payment_reference,
        provider: payment.provider,
        providerReference: payment.providerReference || payment.provider_reference,
        redirectUrl: payment.redirectUrl || payment.redirect_url,
        amount: (payment.amount || 0).toString(),
        currency: payment.currency,
        status: payment.status,
      },
      providerResult: provResult ? { hasRedirect: !!(provResult.redirectUrl || provResult.paymentUrl) } : null,
      replayed: (result as any).replayed || false,
    };
  }
}
