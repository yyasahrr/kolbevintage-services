import { Body, Controller, Get, Headers, Param, Post, Query, Inject } from "@nestjs/common";
import { OrdersService, OrderDomainError } from "./orders.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";

@Controller("admin/wholesale/orders")
@Roles("admin")
export class AdminWholesaleOrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("buyerUserId") buyerUserId?: string,
    @Query("accountId") accountId?: string,
    @Query("sellerId") sellerId?: string,
    @Query("childStatus") childStatus?: string,
    @Query("exceptionStatus") exceptionStatus?: string,
    @Query("orderCode") orderCode?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursorRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    let cursor: { createdAt: string; id: string } | null = null;
    if (cursorRaw) {
      try {
        cursor = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf-8"));
      } catch {
        try {
          cursor = JSON.parse(cursorRaw);
        } catch {
          cursor = null;
        }
      }
    }
    const result = await this.ordersService.adminListOrders({
      status,
      buyerUserId,
      accountId,
      sellerId,
      childStatus,
      exceptionStatus,
      orderCode,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit,
      cursor,
    });
    const orders = result.orders.map((o: any) => ({
      id: o.id,
      orderCode: o.orderCode,
      accountId: o.accountId,
      buyerUserId: o.buyerUserId,
      status: o.status,
      currency: o.currency,
      grandTotal: o.grandTotal?.toString(),
      totalUnits: o.totalUnits,
      createdAt: o.createdAt,
    }));
    const nextCursorEncoded = result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") : null;
    return { orders, nextCursor: nextCursorEncoded, hasMore: result.hasMore };
  }

  @Get(":id")
  async getDetail(@Param("id") id: string) {
    const data = await this.ordersService.adminGetOrderDetail(id);
    return {
      order: {
        id: data.order.id,
        orderCode: data.order.orderCode,
        accountId: data.order.accountId,
        buyerUserId: data.order.buyerUserId,
        status: data.order.status,
        currency: data.order.currency,
        itemsTotal: data.order.itemsTotal.toString(),
        shippingTotal: data.order.shippingTotal.toString(),
        grandTotal: data.order.grandTotal.toString(),
        totalUnits: data.order.totalUnits,
        paymentMode: data.order.paymentMode,
        version: data.order.version,
        createdAt: data.order.createdAt,
      },
      items: data.items.map((it: any) => ({
        id: it.id,
        orderId: it.orderId,
        productId: it.productId,
        variantId: it.variantId,
        packageId: it.packageId,
        sourceRequestId: it.sourceRequestId,
        sellerId: it.sellerId,
        supplierId: it.supplierId,
        quantity: it.quantity,
        packageQuantity: it.packageQuantity,
        pieceQuantity: it.pieceQuantity,
        unitPrice: it.unitPrice.toString(),
        lineTotal: it.lineTotal.toString(),
        currency: it.currency,
        productNameSnapshot: it.productNameSnapshot,
        skuSnapshot: it.skuSnapshot,
      })),
      children: data.children.map((c: any) => ({
        id: c.id,
        orderCode: c.orderCode,
        sellerId: c.sellerId,
        supplierId: c.supplierId,
        status: c.status,
        itemsTotal: c.itemsTotal.toString(),
        grandTotal: c.grandTotal.toString(),
        shippingResponsibility: c.shippingResponsibility,
      })),
      links: data.links.map((l: any) => ({
        id: l.id,
        orderId: l.orderId,
        requestId: l.requestId,
        requestVersion: l.requestVersion,
        acceptedTermsHash: l.acceptedTermsHash,
      })),
    };
  }

  @Get(":id/timeline")
  async getTimeline(@Param("id") id: string) {
    return this.ordersService.adminGetTimeline(id);
  }

  @Post(":id/cancel")
  async cancel(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: { reason: string; expectedVersion?: number },
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (!body?.reason) throw new OrderDomainError("CANCELLATION_REASON_REQUIRED", "Reason required");
    const result = await this.ordersService.cancelParentOrder({
      orderId: id,
      actorUserId: claims.sub,
      actorRole: "admin",
      reason: body.reason,
      idempotencyKey,
      expectedVersion: body.expectedVersion,
    });
    return { order: result.order, replayed: (result as any).replayed || false };
  }
}
