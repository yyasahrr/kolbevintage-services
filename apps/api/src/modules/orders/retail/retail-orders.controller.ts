import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser, Public, Roles } from "../../../common/guards/session.guard";
import type { Claims } from "../../../common/session";
import { RetailOrdersService } from "./retail-orders.service";
import { RetailCheckoutGuard, type RequestWithRetailActor } from "./retail-checkout.guard";

/**
 * Phase 5.8 — canonical Retail orders API.
 *
 * POST is dual-auth (session customer/vip, or internal-token guest via the
 * compat proxy) through RetailCheckoutGuard on a @Public route: the global
 * guard still enforces CSRF/Origin for cookie callers before delegating.
 * GET is session-only, customer-scoped (admins may read any order).
 */
@Controller("retail/orders")
export class RetailOrdersController {
  constructor(@Inject(RetailOrdersService) private readonly retailOrders: RetailOrdersService) {}

  @Post()
  @Public()
  @UseGuards(RetailCheckoutGuard)
  @HttpCode(201)
  async createOrder(
    @Req() req: RequestWithRetailActor,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Headers("Idempotency-Key") idempotencyKeyHeader2: string | undefined,
    @Body() body: Record<string, any>,
  ) {
    const actor = req.retailActor;
    if (!actor) throw new Error("retail actor missing");
    const view = await this.retailOrders.createRetailOrder(actor, {
      customer: body?.customer,
      lines: body?.lines,
      address: body?.address,
      shippingMethodId: body?.shippingMethodId,
      payMethod: body?.payMethod,
      couponCodes: body?.couponCodes,
      acceptedPolicyDocumentIds: body?.acceptedPolicyDocumentIds,
      idempotencyKey: idempotencyKeyHeader || idempotencyKeyHeader2 || body?.idempotencyKey,
      requestMetadata: {
        ip: (req as Request).ip ?? null,
        userAgent: typeof req.headers["user-agent"] === "string" ? (req.headers["user-agent"] as string) : null,
        requestId: typeof req.headers["x-request-id"] === "string" ? (req.headers["x-request-id"] as string) : null,
      },
    });
    // Created vs replayed: 201 only when the key created an order (legacy parity).
    res.status(view.replayed ? 200 : 201);
    return view;
  }

  @Get(":id")
  @Roles("customer", "vip", "admin")
  async getOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.retailOrders.getRetailOrder({ userId: claims.sub, role: claims.role }, id);
  }
}
