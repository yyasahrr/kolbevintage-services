import { Controller, Get, Param, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingService } from "./shipping.service";
import { OrdersService } from "../orders/orders.service";

@Controller("wholesale/orders")
export class ShippingBuyerController {
  constructor(
    @Inject(ShippingService) private readonly shippingService: ShippingService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
  ) {}

  @Get(":id/shipments")
  @Roles("vip", "customer")
  async getShipmentsForOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    const shipments = await this.shippingService.getShipmentsForOrder(id);
    // Buyer GET shipments safe tracking Claims.sub — no sensitive data
    return {
      shipments: shipments.map((s: any) => ({
        id: s.id,
        shipmentCode: s.shipment_code || s.shipmentCode,
        childOrderId: s.child_order_id || s.childOrderId,
        sellerId: s.seller_id || s.sellerId,
        status: s.status,
        trackingCode: s.tracking_code ? "***present***" : null,
        trackingUrl: s.tracking_url || s.trackingUrl ? "***present***" : null,
        provider: s.provider,
        createdAt: s.created_at || s.createdAt,
      })),
    };
  }

  @Get(":id/shipments/:shipmentId")
  @Roles("vip", "customer")
  async getShipmentDetail(@CurrentUser() claims: Claims, @Param("id") id: string, @Param("shipmentId") shipmentId: string) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: id, buyerUserId: claims.sub });
    const { shipment, items } = await this.shippingService.getShipmentById(shipmentId);
    if ((shipment.wholesaleOrderId || shipment.wholesale_order_id) !== id) {
      throw new Error("Shipment does not belong to order");
    }
    return {
      shipment: {
        id: shipment.id,
        shipmentCode: shipment.shipmentCode || shipment.shipment_code,
        status: shipment.status,
        provider: shipment.provider,
        trackingCodePresent: !!(shipment.trackingCode || shipment.tracking_code),
        trackingUrlPresent: !!(shipment.trackingUrl || shipment.tracking_url),
        createdAt: shipment.createdAt || shipment.created_at,
      },
      items: items.map((it: any) => ({
        wholesaleOrderItemId: it.wholesale_order_item_id || it.wholesaleOrderItemId,
        pieceQuantity: it.piece_quantity || it.pieceQuantity,
      })),
    };
  }
}
