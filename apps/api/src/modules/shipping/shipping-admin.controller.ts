import { Body, Controller, Get, Param, Post, Query, Headers, Inject, HttpCode } from "@nestjs/common";
import { CurrentUser, Roles, Public } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { ShippingOrchestrator, type ShippingActor } from "./shipping.orchestrator";
import { toApiJson } from "../../common/api-json";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";

/** Admin + carrier-facing shipping surface (B12 idempotency, B16 webhook inbox, B18 reconciliation). */
@Controller("admin/shipping")
export class ShippingAdminController {
  constructor(@Inject(ShippingOrchestrator) private readonly orchestrator: ShippingOrchestrator) {}

  private actor(claims: Claims): ShippingActor {
    return { userId: claims.sub, role: claims.role as ShippingActor["role"] };
  }

  @Get("shipments")
  @Roles("admin", "finance")
  async listShipments(@CurrentUser() claims: Claims, @Query() query: { wholesaleOrderId?: string; childOrderId?: string }) {
    return toApiJson(await this.orchestrator.listShipmentsForOrderForAdmin({ actor: this.actor(claims), wholesaleOrderId: query?.wholesaleOrderId, childOrderId: query?.childOrderId }));
  }

  @Get("shipments/:id")
  @Roles("admin", "finance")
  async getShipment(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.orchestrator.getShipmentForActor({ actor: this.actor(claims), shipmentId: id }));
  }

  @Post("quotes/:id/select")
  @Roles("admin", "finance")
  async selectQuote(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") idemHeader?: string) {
    return toApiJson(await this.orchestrator.selectQuote({ actor: this.actor(claims), quoteId: id, idempotencyKey: idemHeader }));
  }

  @Post("shipments/:id/delivered")
  @Roles("admin")
  async markDelivered(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") idemHeader?: string) {
    return toApiJson(await this.orchestrator.markDelivered({ actor: this.actor(claims), shipmentId: id, idempotencyKey: idemHeader, trigger: "admin" }));
  }

  @Post("shipments/:id/cancel")
  @Roles("admin")
  async cancelShipment(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body?: { reason?: string }, @Headers("idempotency-key") idemHeader?: string) {
    return toApiJson(await this.orchestrator.cancelShipment({ actor: this.actor(claims), shipmentId: id, reason: body?.reason, idempotencyKey: idemHeader }));
  }

  @Post("shipments/:id/tracking")
  @Roles("admin")
  async adminUpdateTracking(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Body() body: { trackingCode?: string; trackingUrl?: string },
    @Headers("idempotency-key") idemHeader?: string,
  ) {
    return toApiJson(await this.orchestrator.updateTracking({ actor: this.actor(claims), shipmentId: id, trackingCode: body?.trackingCode, trackingUrl: body?.trackingUrl, idempotencyKey: idemHeader }));
  }

  /** B18 — operator-triggered reconciliation (scheduler-compatible). */
  @Post("reconcile")
  @Roles("admin")
  @HttpCode(200)
  async reconcile(@Body() body: { provider?: string; limit?: number; staleProcessingMinutes?: number; pendingOlderThanSeconds?: number } = {}) {
    return toApiJson(await this.orchestrator.reconcile(body || {}));
  }
}

/**
 * B16 — carrier webhook. `@Public()` because the caller is the carrier, not a
 * session; authenticity is established by the adapter's `parseWebhook`
 * (shared secret / signature). An unauthenticated payload is rejected and NOT
 * persisted. Nothing is echoed back.
 */
@Controller("shipping/providers")
export class ShippingProviderWebhookController {
  constructor(@Inject(ShippingOrchestrator) private readonly orchestrator: ShippingOrchestrator) {}

  @Public()
  @Post(":provider/webhook")
  @RateLimit({ limit: 120, windowSeconds: 60, scope: "ip", keyPrefix: "webhook:shipping" })
  @HttpCode(200)
  async webhook(@Param("provider") provider: string, @Body() body: unknown, @Headers() headers: Record<string, string | string[] | undefined>) {
    const result = await this.orchestrator.ingestWebhook({ provider, request: { headers: headers || {}, body } });
    return toApiJson({ received: true, duplicate: result.duplicate, eventId: result.outcome.eventId, status: result.outcome.status });
  }
}
