import { Body, Controller, Get, Headers, Param, Post, Query, Inject } from "@nestjs/common";
import { OrdersService, OrderDomainError } from "./orders.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CreateWholesaleOrderRequestDto } from "./dto/create-order.dto";

@Controller("wholesale/orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Get()
  @Roles("vip", "customer")
  async listOrders(
    @CurrentUser() claims: Claims,
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
    const result = await this.ordersService.listWholesaleOrdersForBuyer({
      buyerUserId: claims.sub,
      limit,
      cursor,
    });
    const orders = result.orders.map((o: any) => ({
      id: o.id,
      orderCode: o.order_code || o.orderCode,
      accountId: o.account_id || o.accountId,
      buyerUserId: o.buyer_user_id || o.buyerUserId,
      status: o.status,
      currency: o.currency,
      grandTotal: (o.grand_total || o.grandTotal)?.toString(),
      totalUnits: o.total_units || o.totalUnits,
      createdAt: o.created_at || o.createdAt,
    }));
    const nextCursorEncoded = result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") : null;
    return { orders, nextCursor: nextCursorEncoded, hasMore: result.hasMore };
  }

  @Post()
  @Roles("vip", "customer")
  async createOrder(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idempotencyKeyHeader: string,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string,
    @Body() body: CreateWholesaleOrderRequestDto,
  ) {
    const idempotencyKey = idempotencyKeyHeader || idempotencyKeyHeader2;
    if (!idempotencyKey) {
      throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required");
    }

    const result = await this.ordersService.createWholesaleOrder({
      requests: body.requests,
      paymentMode: body.paymentMode,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      idempotencyKey,
      buyerUserId: claims.sub,
      actorRole: claims.role,
    });

    return {
      order: {
        id: result.order.id,
        orderCode: result.order.orderCode,
        accountId: result.order.accountId,
        buyerUserId: result.order.buyerUserId,
        status: result.order.status,
        currency: result.order.currency,
        itemsTotal: result.order.itemsTotal.toString(),
        shippingTotal: result.order.shippingTotal.toString(),
        grandTotal: result.order.grandTotal.toString(),
        totalUnits: result.order.totalUnits,
        paymentMode: result.order.paymentMode,
        version: result.order.version,
        idempotencyKey: result.order.idempotencyKey,
        creationRequestHash: result.order.creationRequestHash,
        createdAt: result.order.createdAt,
      },
      items: result.items.map((it: any) => ({
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
        pricingUnit: it.pricingUnit,
      })),
      children: result.children.map((c: any) => ({
        id: c.id,
        orderCode: c.orderCode,
        sellerId: c.sellerId,
        supplierId: c.supplierId,
        status: c.status,
        itemsTotal: c.itemsTotal.toString(),
        grandTotal: c.grandTotal.toString(),
        shippingResponsibility: c.shippingResponsibility,
      })),
      links: result.links.map((l: any) => ({
        id: l.id,
        orderId: l.orderId,
        requestId: l.requestId,
        requestVersion: l.requestVersion,
        acceptedTermsHash: l.acceptedTermsHash,
      })),
      replayed: result.replayed || false,
    };
  }

  @Get(":id")
  @Roles("vip", "customer", "admin")
  async getOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role === "admin") {
      const data = await this.ordersService.adminGetOrderDetail(id);
      return {
        order: {
          id: data.order.id,
          orderCode: (data.order as any).orderCode || (data.order as any).order_code,
          accountId: (data.order as any).accountId || (data.order as any).account_id,
          buyerUserId: (data.order as any).buyerUserId || (data.order as any).buyer_user_id,
          status: data.order.status,
          currency: data.order.currency,
          itemsTotal: (data.order as any).itemsTotal?.toString() || (data.order as any).items_total?.toString(),
          shippingTotal: (data.order as any).shippingTotal?.toString() || (data.order as any).shipping_total?.toString(),
          grandTotal: (data.order as any).grandTotal?.toString() || (data.order as any).grand_total?.toString(),
          totalUnits: (data.order as any).totalUnits || (data.order as any).total_units,
          paymentMode: (data.order as any).paymentMode || (data.order as any).payment_mode,
          version: data.order.version,
          createdAt: (data.order as any).createdAt || (data.order as any).created_at,
        },
        items: data.items.map((it: any) => ({
          id: it.id,
          orderId: it.orderId || it.order_id,
          productId: it.productId || it.product_id,
          variantId: it.variantId || it.variant_id,
          packageId: it.packageId || it.package_id,
          sourceRequestId: it.sourceRequestId || it.source_request_id,
          sellerId: it.sellerId || it.seller_id,
          supplierId: it.supplierId || it.supplier_id,
          quantity: it.quantity,
          packageQuantity: it.packageQuantity || it.package_quantity,
          pieceQuantity: it.pieceQuantity || it.piece_quantity,
          unitPrice: (it.unitPrice || it.unit_price)?.toString(),
          lineTotal: (it.lineTotal || it.line_total)?.toString(),
          currency: it.currency,
          productNameSnapshot: it.productNameSnapshot || it.product_name_snapshot,
          skuSnapshot: it.skuSnapshot || it.sku_snapshot,
          sellerSnapshot: it.sellerSnapshot || it.seller_snapshot,
        })),
        children: data.children.map((c: any) => ({
          id: c.id,
          orderCode: c.orderCode || c.order_code,
          sellerId: c.sellerId || c.seller_id,
          supplierId: c.supplierId || c.supplier_id,
          status: c.status,
          itemsTotal: (c.itemsTotal || c.items_total)?.toString(),
          grandTotal: (c.grandTotal || c.grand_total)?.toString(),
          shippingResponsibility: c.shippingResponsibility || c.shipping_responsibility,
        })),
        links: data.links.map((l: any) => ({
          id: l.id,
          orderId: l.orderId || l.order_id,
          requestId: l.requestId || l.request_id,
          requestVersion: l.requestVersion || l.request_version,
          acceptedTermsHash: l.acceptedTermsHash || l.accepted_terms_hash,
        })),
      };
    }

    const detail = await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    return {
      order: detail.order,
      items: detail.items,
      children: detail.children,
      links: detail.links,
      exceptions: detail.exceptions,
    };
  }

  @Get(":id/timeline")
  @Roles("vip", "customer", "admin")
  async getTimeline(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role === "admin") {
      return this.ordersService.adminGetTimeline(id);
    }
    return this.ordersService.getOrderTimelineForBuyer({ orderId: id, buyerUserId: claims.sub });
  }

  @Get(":id/children")
  @Roles("vip", "customer", "admin")
  async getChildren(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role === "admin") {
      const data = await this.ordersService.adminGetOrderDetail(id);
      return { children: data.children };
    }
    return this.ordersService.listChildrenForOrder({ orderId: id, buyerUserId: claims.sub });
  }

  @Get(":id/exceptions")
  @Roles("vip", "customer", "admin")
  async getExceptions(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role === "admin") {
      const timeline = await this.ordersService.adminGetTimeline(id);
      const exceptions = timeline.timeline.filter((e: any) => e.type === "fulfillment_exception");
      return { exceptions };
    }
    return this.ordersService.listExceptionsForOrder({ orderId: id, buyerUserId: claims.sub });
  }

  @Post(":id/cancel")
  @Roles("vip", "customer", "admin")
  async cancelOrder(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { reason: string; expectedVersion?: number },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new OrderDomainError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (!body?.reason) throw new OrderDomainError("CANCELLATION_REASON_REQUIRED", "Reason required");
    const result = await this.ordersService.cancelParentOrder({
      orderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "buyer",
      reason: body.reason,
      idempotencyKey,
      expectedVersion: body.expectedVersion,
    });
    return { order: result.order, replayed: (result as any).replayed || false };
  }
}
