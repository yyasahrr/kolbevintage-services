import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Roles } from "../../../common/guards/session.guard";
import type { Claims } from "../../../common/session";
import { toApiJson } from "../../../common/api-json";
import { RetailOrdersService } from "./retail-orders.service";

/**
 * Phase 5.11-A — retail fulfillment ops over staff HTTP.
 *
 * Thin forwarding shell: every route passes the authenticated actor
 * (`{ actorId: claims.sub, actorRole: claims.role }`) untouched to a
 * proven 5.8/5.9 service seam. RBAC, idempotency, and error codes all
 * live at the seam; the route only maps replay→status and serializes.
 * Finance acts stay seam-only (the account role CHECK has no finance
 * value, and the guard re-checks token role against the live row).
 */
@Controller("admin/retail")
@Roles("admin")
export class AdminRetailOpsController {
  constructor(@Inject(RetailOrdersService) private readonly retailOrders: RetailOrdersService) {}

  private actor(claims: Claims) {
    return { actorId: claims.sub, actorRole: claims.role };
  }

  private key(header: string | undefined, body: unknown): string | undefined {
    if (header) return header;
    return typeof body === "string" ? body : undefined;
  }

  @Post("orders/:id/confirm")
  @HttpCode(200)
  async confirm(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailOrders.confirmRetailOrder(id, this.actor(claims)));
  }

  @Post("orders/:id/pack")
  @HttpCode(200)
  async pack(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailOrders.packRetailOrder(id, this.actor(claims)));
  }

  @Post("orders/:id/cancel")
  @HttpCode(200)
  async cancel(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason?: string }) {
    return toApiJson(await this.retailOrders.cancelRetailOrder(id, { ...this.actor(claims), reason: body?.reason }));
  }

  @Post("orders/:id/shipments")
  async createShipment(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { idempotencyKey?: string; providerName?: string; items?: Array<{ retailOrderItemId: unknown; quantity: unknown }> },
  ) {
    const result = await this.retailOrders.createRetailShipment(id, this.actor(claims), {
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
      providerName: body?.providerName,
      items: body?.items,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("shipments/:id/handoff")
  async handoff(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { idempotencyKey?: string },
  ) {
    const result = await this.retailOrders.markRetailShipmentHandoff(id, this.actor(claims), {
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("shipments/:id/manual-tracking")
  @HttpCode(200)
  async manualTracking(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { state: string; idempotencyKey?: string; note?: string },
  ) {
    return toApiJson(
      await this.retailOrders.recordRetailManualTracking(id, this.actor(claims), {
        state: body?.state,
        idempotencyKey: this.key(header, body?.idempotencyKey),
        note: body?.note,
      }),
    );
  }

  @Post("payments/:id/verify")
  async verify(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { externalReference: string; idempotencyKey?: string; expectedVersion?: number; reason?: string },
  ) {
    const result = await this.retailOrders.verifyPayment(id, this.actor(claims), {
      externalReference: body?.externalReference,
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
      expectedVersion: body?.expectedVersion,
      reason: body?.reason,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }
}
