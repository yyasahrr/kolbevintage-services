import { Controller, Get, Post, Body, Param, HttpCode, Inject } from "@nestjs/common";
import { VipService } from "./vip.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";

@Controller("vip")
export class VipController {
  constructor(@Inject(VipService) private readonly vip: VipService) {}

  @Get("plans")
  async plans() {
    return this.vip.listPlans();
  }

  @Post("subscribe")
  @Roles("customer", "vip")
  async subscribe(@CurrentUser() claims: Claims, @Body() body: { planId: string }) {
    return this.vip.subscribe(claims.sub, body.planId);
  }

  @Post("compat/applications")
  @Roles("customer", "vip")
  async legacyApply(@CurrentUser() claims: Claims, @Body() body: any) { return this.vip.applyLegacy(claims.sub, body); }

  @Post("compat/accounts/:id/status")
  @HttpCode(200)
  @Roles("admin")
  async legacyDecision(@Param("id") id: string, @CurrentUser() claims: Claims, @Body() body: any) { return this.vip.decideLegacyAccount(id, body, claims.sub); }

  @Post("requests")
  @Roles("vip")
  async createRequest(
    @CurrentUser() claims: Claims,
    @Body() body: { productId: string; offerId: string; packageId?: string; quantity: number },
  ) {
    return this.vip.createWholesaleRequest({ ...body, userId: claims.sub });
  }

  @Post("subscriptions/:id/activate")
  @Roles("admin")
  async activate(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return this.vip.activateSubscription(id, claims.sub);
  }
}
