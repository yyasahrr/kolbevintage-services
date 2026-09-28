import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { Public } from "../../common/guards/session.guard";
import { GuestOrderAccessGuard, type RequestWithGuestOrder } from "./guest-order-access.guard";
import { GuestOrderAccessService } from "./guest-order-access.service";

/**
 * Phase 5.9-A — guest order self-service. @Public because guests have no
 * session; authentication is the capability secret in
 * `X-Retail-Order-Token`, verified by GuestOrderAccessGuard before the
 * handler runs. The handler re-resolves through the service so the guard
 * stays a pure authentication step.
 */
@Controller("customer/guest")
export class GuestOrderAccessController {
  constructor(@Inject(GuestOrderAccessService) private readonly access: GuestOrderAccessService) {}

  @Get("orders/by-code/:orderCode")
  @Public()
  @UseGuards(GuestOrderAccessGuard)
  async getOrderByCode(@Req() req: RequestWithGuestOrder, @Param("orderCode") orderCode: string) {
    const token = req.headers["x-retail-order-token"];
    const resolved = await this.access.resolveGuestOrder(orderCode, token);
    return { orderId: resolved.orderId, orderCode: resolved.orderCode, order: resolved.order, shipping: resolved.shipping };
  }
}
