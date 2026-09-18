import { Body, Controller, Get, Headers, Param, Post, Inject } from "@nestjs/common";
import { OrdersService, OrderDomainError } from "./orders.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CreateWholesaleOrderRequestDto } from "./dto/create-order.dto";

@Controller("wholesale/orders")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

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
    const data = await this.ordersService.getOrderWithItems(id);
    if (!data) {
      throw new OrderDomainError("ORDER_NOT_FOUND", "Order not found");
    }
    // Ownership check: buyer can only read own order
    if (claims.role !== "admin" && data.order.buyerUserId !== claims.sub) {
      throw new OrderDomainError("ORDER_OWNERSHIP_VIOLATION", "You do not own this order");
    }

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
}
