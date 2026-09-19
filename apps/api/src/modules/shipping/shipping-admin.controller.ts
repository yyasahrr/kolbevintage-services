import { Body, Controller, Get, Param, Post, Query, Headers, Inject, forwardRef } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingService } from "./shipping.service";
import { WholesaleFinanceOrchestrator } from "../finance/wholesale-finance.orchestrator";

@Controller("admin/shipping")
export class ShippingAdminController {
  constructor(
    @Inject(ShippingService) private readonly shippingService: ShippingService,
    @Inject(forwardRef(() => WholesaleFinanceOrchestrator)) private readonly orchestrator: WholesaleFinanceOrchestrator,
  ) {}

  @Get("shipments")
  @Roles("admin")
  async listShipments(@Query() query: any) {
    // Admin list/inspect failures/manual tracking/reconciliation KOLBE shipping
    // Simplified: list by orderId if provided
    if (query.wholesaleOrderId) {
      const shipments = await this.shippingService.getShipmentsForOrder(query.wholesaleOrderId);
      return { shipments };
    }
    if (query.childOrderId) {
      const shipments = await this.shippingService.getShipmentsForChild(query.childOrderId);
      return { shipments };
    }
    return { shipments: [], message: "Provide wholesaleOrderId or childOrderId" };
  }

  @Get("shipments/:id")
  @Roles("admin")
  async getShipment(@Param("id") id: string) {
    const result = await this.shippingService.getShipmentById(id);
    return result;
  }

  @Post("quotes/:id/select")
  @Roles("admin")
  async selectQuote(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idemHeader: string,
    @Headers("Idempotency-Key") idemHeader2: string,
    @Body() body?: any,
  ) {
    const idempotencyKey = idemHeader || idemHeader2 || body?.idempotencyKey;
    if (!idempotencyKey) throw new Error("Idempotency-Key required");
    const result = await this.orchestrator.selectShippingQuote({
      quoteId: id,
      actorId: claims.sub,
      actorRole: claims.role,
      idempotencyKey,
    });
    return result;
  }

  @Post("shipments/:id/delivered")
  @Roles("admin")
  async markDelivered(@CurrentUser() claims: Claims, @Param("id") id: string) {
    const result = await this.shippingService.markDelivered({ shipmentId: id, actorId: claims.sub, actorRole: claims.role });
    return result;
  }

  @Post("shipments/:id/cancel")
  @Roles("admin")
  async cancelShipment(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body?: { reason?: string }) {
    const result = await this.shippingService.cancelShipment({ shipmentId: id, actorId: claims.sub, actorRole: claims.role, reason: body?.reason });
    return { shipment: result };
  }

  @Post("shipments/:id/tracking")
  @Roles("admin")
  async adminUpdateTracking(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { trackingCode?: string; trackingUrl?: string }) {
    const updated = await this.shippingService.updateTracking({ shipmentId: id, trackingCode: body.trackingCode, trackingUrl: body.trackingUrl, actorId: claims.sub, actorRole: claims.role });
    return { shipment: updated };
  }
}
