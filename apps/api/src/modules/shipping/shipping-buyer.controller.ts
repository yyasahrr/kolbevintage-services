import { Controller, Get, Param, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingOrchestrator } from "./shipping.orchestrator";
import { toApiJson } from "../../common/api-json";

/** B19 — buyer tracking: real tracking code/url, no secrets, no raw provider payloads, no address echo. */
@Controller("wholesale/orders")
export class ShippingBuyerController {
  constructor(@Inject(ShippingOrchestrator) private readonly orchestrator: ShippingOrchestrator) {}

  @Get(":id/shipments")
  @Roles("vip", "customer")
  async getShipmentsForOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.orchestrator.getBuyerShipments({ orderId: id, buyerUserId: claims.sub }));
  }

  @Get(":id/shipments/:shipmentId")
  @Roles("vip", "customer")
  async getShipmentDetail(@CurrentUser() claims: Claims, @Param("id") id: string, @Param("shipmentId") shipmentId: string) {
    return toApiJson(await this.orchestrator.getBuyerShipment({ orderId: id, shipmentId, buyerUserId: claims.sub }));
  }
}
