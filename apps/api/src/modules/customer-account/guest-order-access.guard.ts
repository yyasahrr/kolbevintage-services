import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { RetailDomainError } from "../orders/retail/retail-orders.contract";
import { GuestOrderAccessService } from "./guest-order-access.service";

export type RequestWithGuestOrder = Request & {
  guestOrder?: { orderId: string; orderCode: string };
};

/**
 * Phase 5.9-A — guest authentication for order self-service. The order
 * code comes from the route; the capability secret comes ONLY from the
 * `X-Retail-Order-Token` header (never from the URL, which leaks into
 * logs/history). Verification is delegated to GuestOrderAccessService.
 */
@Injectable()
export class GuestOrderAccessGuard implements CanActivate {
  constructor(@Inject(GuestOrderAccessService) private readonly access: GuestOrderAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithGuestOrder>();
    const orderCode = typeof request.params?.orderCode === "string" ? request.params.orderCode : "";
    const token = request.headers["x-retail-order-token"];
    if (typeof token !== "string" || token.length === 0) {
      throw new RetailDomainError("RETAIL_GUEST_CAPABILITY_MISSING", "guest capability token is required");
    }
    const resolved = await this.access.resolveGuestOrder(orderCode, token);
    request.guestOrder = { orderId: resolved.orderId, orderCode: resolved.orderCode };
    return true;
  }
}
