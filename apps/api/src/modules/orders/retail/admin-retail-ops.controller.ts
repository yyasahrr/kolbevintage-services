import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Roles } from "../../../common/guards/session.guard";
import type { Claims } from "../../../common/session";
import { toApiJson } from "../../../common/api-json";
import { RetailOrdersService } from "./retail-orders.service";
import { RetailReturnsService } from "./retail-returns.service";
import { PaymentsService } from "../../payments/payments.service";

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
  constructor(
    @Inject(RetailOrdersService) private readonly retailOrders: RetailOrdersService,
    @Inject(RetailReturnsService) private readonly retailReturns: RetailReturnsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  private actor(claims: Claims) {
    return { actorId: claims.sub, actorRole: claims.role };
  }

  private key(header: string | undefined, body: unknown): string | undefined {
    if (header) return header;
    return typeof body === "string" ? body : undefined;
  }

  /** Wholesale-console pagination mirror: bad cursors degrade to page one. */
  private pageParams(limitRaw?: string, cursorRaw?: string) {
    let limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    if (!Number.isSafeInteger(limit)) limit = 20;
    let cursor: { createdAt: string; id: string } | null = null;
    if (cursorRaw) {
      const tries = [() => Buffer.from(cursorRaw, "base64url").toString("utf-8"), () => cursorRaw];
      for (const decode of tries) {
        try {
          const parsed = JSON.parse(decode()) as { createdAt?: unknown; id?: unknown };
          // 5.11-D hardening: createdAt must be strict ISO-8601 (our encoder
          // emits toISOString, nothing else). V8 Date.parse is lenient with
          // digit-bearing garbage ("not-a-date' OR '1'='1" parses as
          // 2001-01-01), so a bare isNaN check would still admit hostile
          // cursors; anything non-ISO degrades to the first page instead of
          // reaching PG as ('...'::timestamptz) and 500ing.
          if (
            parsed &&
            typeof parsed.createdAt === "string" &&
            typeof parsed.id === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/.test(parsed.createdAt)
          ) {
            cursor = { createdAt: parsed.createdAt, id: parsed.id };
            break;
          }
        } catch {
          // fall through to the next decoding (or the first page)
        }
      }
    }
    return { limit, cursor };
  }

  private encodeCursor(cursor: { createdAt: string; id: string } | null): string | null {
    return cursor ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null;
  }

  private parseDate(raw?: string): string | undefined {
    if (!raw) return undefined;
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
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

  // ── Phase 5.11-B — after-sales ops ─────────────────────────────────────

  @Post("orders/:id/refunds")
  async fileRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { amount: string; lines?: Array<{ retailOrderItemId: string; quantity: number }>; reason?: string; idempotencyKey?: string },
  ) {
    const result = await this.retailOrders.requestRetailRefund(id, this.actor(claims), {
      amount: body?.amount,
      lines: body?.lines,
      reason: body?.reason,
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("refunds/:id/approve")
  async approveRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { idempotencyKey?: string; reason?: string },
  ) {
    const result = await this.retailOrders.approveRetailRefund(id, this.actor(claims), {
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
      reason: body?.reason,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("refunds/:id/complete")
  async completeRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { externalReference: string; idempotencyKey?: string },
  ) {
    const result = await this.retailOrders.completeRetailRefund(id, this.actor(claims), {
      externalReference: body?.externalReference,
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("refunds/:id/fail")
  async failRefund(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") header: string | undefined,
    @Body() body: { reason: string; idempotencyKey?: string },
  ) {
    const result = await this.retailOrders.failRetailRefund(id, this.actor(claims), {
      reason: body?.reason,
      idempotencyKey: this.key(header, body?.idempotencyKey) as string,
    });
    res.status(result.replayed ? 200 : 201);
    return toApiJson(result);
  }

  @Post("returns/:id/approve")
  @HttpCode(200)
  async approveReturn(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason?: string }) {
    return toApiJson(await this.retailReturns.transitionRetailReturn(id, "APPROVED", { ...this.actor(claims), reason: body?.reason }));
  }

  @Post("returns/:id/receive")
  @HttpCode(200)
  async receiveReturn(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason?: string }) {
    return toApiJson(await this.retailReturns.transitionRetailReturn(id, "RECEIVED", { ...this.actor(claims), reason: body?.reason }));
  }

  @Post("returns/:id/inspect")
  @HttpCode(200)
  async inspectReturn(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { inspectionDecision: string; reason?: string }) {
    return toApiJson(
      await this.retailReturns.transitionRetailReturn(id, "INSPECTED", {
        ...this.actor(claims),
        reason: body?.reason,
        inspectionDecision: body?.inspectionDecision,
      }),
    );
  }

  @Post("returns/:id/restock")
  @HttpCode(200)
  async restockReturn(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason?: string }) {
    return toApiJson(await this.retailReturns.transitionRetailReturn(id, "RESTOCKED", { ...this.actor(claims), reason: body?.reason }));
  }

  @Post("returns/:id/reject")
  @HttpCode(200)
  async rejectReturn(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { reason: string }) {
    return toApiJson(await this.retailReturns.transitionRetailReturn(id, "REJECTED", { ...this.actor(claims), reason: body?.reason }));
  }

  @Post("orders/:id/guest-capability/revoke")
  @HttpCode(200)
  async revokeGuestCapability(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailOrders.revokeRetailGuestCapability(id, this.actor(claims)));
  }

  // ── Phase 5.11-C — staff reads ─────────────────────────────────────────

  @Get("orders")
  async listOrders(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("paymentStatus") paymentStatus?: string,
    @Query("orderCode") orderCode?: string,
    @Query("customerId") customerId?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursorRaw?: string,
  ) {
    const { limit, cursor } = this.pageParams(limitRaw, cursorRaw);
    const result = await this.retailOrders.listRetailOrdersForStaff(this.actor(claims), {
      orderStatus: status,
      paymentStatus,
      orderCode,
      customerId,
      dateFrom: this.parseDate(dateFrom),
      dateTo: this.parseDate(dateTo),
      limit,
      cursor,
    });
    return toApiJson({ orders: result.orders, nextCursor: this.encodeCursor(result.nextCursor), hasMore: result.hasMore });
  }

  @Get("orders/:id")
  async getOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailOrders.getRetailOrder({ userId: claims.sub, role: claims.role }, id));
  }

  @Get("orders/:id/timeline")
  async getTimeline(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailOrders.getRetailOrderTimeline(id, this.actor(claims)));
  }

  @Get("returns")
  async listReturns(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursorRaw?: string,
  ) {
    const { limit, cursor } = this.pageParams(limitRaw, cursorRaw);
    const result = await this.retailReturns.listRetailReturnsForStaff(this.actor(claims), { status, limit, cursor });
    return toApiJson({ returns: result.returns, nextCursor: this.encodeCursor(result.nextCursor), hasMore: result.hasMore });
  }

  @Get("returns/:id")
  async getReturn(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.retailReturns.getRetailReturn({ userId: claims.sub, role: claims.role }, id));
  }

  @Get("refunds")
  async listRefunds(
    @CurrentUser() claims: Claims,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursorRaw?: string,
  ) {
    const { limit, cursor } = this.pageParams(limitRaw, cursorRaw);
    const result = await this.payments.listRetailRefundsForStaff({ status, limit, cursor });
    return toApiJson({ refunds: result.refunds, nextCursor: this.encodeCursor(result.nextCursor), hasMore: result.hasMore });
  }
}
