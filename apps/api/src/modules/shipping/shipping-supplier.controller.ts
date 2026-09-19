import { Body, Controller, Get, Param, Post, Headers, Inject } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingOrchestrator, type ShippingActor } from "./shipping.orchestrator";

/**
 * Phase 4.7.1 — supplier shipping surface.
 *
 * No "first membership wins": every call is authorized against the child
 * order's seller by the orchestrator (B6). The Idempotency-Key header is mandatory for
 * every mutation and is validated server-side (B12) — the controller never
 * fabricates one.
 */
@Controller("supplier/shipments")
export class ShippingSupplierController {
  constructor(@Inject(ShippingOrchestrator) private readonly orchestrator: ShippingOrchestrator) {}

  private actor(claims: Claims): ShippingActor {
    return { userId: claims.sub, role: claims.role as ShippingActor["role"] };
  }

  @Get("child/:childOrderId")
  @Roles("supplier")
  async getShipmentsForChild(@CurrentUser() claims: Claims, @Param("childOrderId") childOrderId: string) {
    return this.orchestrator.listShipmentsForChildForActor({ actor: this.actor(claims), childOrderId });
  }

  @Get(":id")
  @Roles("supplier")
  async getShipment(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.orchestrator.getShipmentForActor({ actor: this.actor(claims), shipmentId: id });
  }

  @Post("quote")
  @Roles("supplier")
  async createQuote(
    @CurrentUser() claims: Claims,
    @Body() body: { childOrderId: string; serviceLevel?: string; provider?: string },
    @Headers("idempotency-key") idemHeader?: string,
  ) {
    const result = await this.orchestrator.createQuote({
      actor: this.actor(claims),
      childOrderId: body?.childOrderId,
      serviceLevel: body?.serviceLevel,
      providerName: body?.provider,
      idempotencyKey: idemHeader,
    });
    return { quote: result.quote, replayed: result.replayed, notQuoted: (result as any).notQuoted ?? undefined };
  }

  @Post()
  @Roles("supplier")
  async createShipment(
    @CurrentUser() claims: Claims,
    @Body()
    body: {
      childOrderId: string;
      wholesaleOrderId?: string;
      shippingResponsibility?: string;
      provider?: string;
      addressSnapshot?: unknown;
      quoteId?: string;
      items: Array<{ wholesaleOrderItemId: string; pieceQuantity: number }>;
    },
    @Headers("idempotency-key") idemHeader?: string,
  ) {
    const result = await this.orchestrator.createShipment({
      actor: this.actor(claims),
      childOrderId: body?.childOrderId,
      items: body?.items,
      providerName: body?.provider,
      quoteId: body?.quoteId,
      idempotencyKey: idemHeader,
      claimedWholesaleOrderId: body?.wholesaleOrderId,
      claimedShippingResponsibility: body?.shippingResponsibility,
      claimedAddressSnapshot: body?.addressSnapshot,
    });
    return { shipment: result.shipment, items: result.items, replayed: result.replayed };
  }

  @Post(":id/handoff")
  @Roles("supplier")
  async handoff(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { trackingCode?: string; trackingUrl?: string },
    @Headers("idempotency-key") idemHeader?: string,
  ) {
    return this.orchestrator.handoff({ actor: this.actor(claims), shipmentId: id, trackingCode: body?.trackingCode, trackingUrl: body?.trackingUrl, idempotencyKey: idemHeader });
  }

  @Post(":id/cancel")
  @Roles("supplier")
  async cancel(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason?: string }, @Headers("idempotency-key") idemHeader?: string) {
    return this.orchestrator.cancelShipment({ actor: this.actor(claims), shipmentId: id, reason: body?.reason, idempotencyKey: idemHeader });
  }

  @Post(":id/tracking")
  @Roles("supplier")
  async updateTracking(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { trackingCode?: string; trackingUrl?: string },
    @Headers("idempotency-key") idemHeader?: string,
  ) {
    return this.orchestrator.updateTracking({ actor: this.actor(claims), shipmentId: id, trackingCode: body?.trackingCode, trackingUrl: body?.trackingUrl, idempotencyKey: idemHeader });
  }
}
