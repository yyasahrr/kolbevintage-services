/**
 * Phase 5.7 — admin promotions HTTP surface.
 *
 * Every route requires the admin role plus its catalog permission, enforced
 * by the existing AdminPermissionGuard (no new RBAC framework). There is no
 * public evaluation/checkout endpoint — the only evaluation route is the
 * admin-only read-only preview below.
 *
 * Checkpoint B: publish and pause run through maker/checker approvals
 * (PROMOTION_PUBLISH / PROMOTION_PAUSE). Makers request with `promotion:edit`;
 * checkers decide through the shared approvals API and execute here with the
 * approval-decide permission. No direct publish/pause route exists.
 */

import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { toApiJson } from "../../common/api-json";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { PromotionApprovalService } from "./promotion-approval.service";
import { PromotionCouponService } from "./promotion-coupon.service";
import { PromotionEvaluationService } from "./promotion-evaluation.service";
import { PromotionService } from "./promotion.service";
import { PromotionUsageService } from "./promotion-usage.service";

@Controller("promotions/admin")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminPromotionsController {
  constructor(
    @Inject(PromotionService) private readonly promotions: PromotionService,
    @Inject(PromotionApprovalService) private readonly approvals: PromotionApprovalService,
    @Inject(PromotionCouponService) private readonly coupons: PromotionCouponService,
    @Inject(PromotionEvaluationService) private readonly evaluation: PromotionEvaluationService,
    @Inject(PromotionUsageService) private readonly usage: PromotionUsageService,
  ) {}

  @Post()
  @RequireAdminPermission("promotion:create")
  async createPromotion(@Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.createPromotion(user.sub, body as unknown as { code: unknown; title: unknown; description?: unknown; channel: unknown }));
  }

  @Get()
  @RequireAdminPermission("promotion:view")
  async listPromotions(@Query() query: Record<string, unknown>) {
    return toApiJson(await this.promotions.listPromotions(query));
  }

  @Get(":id")
  @RequireAdminPermission("promotion:view")
  async getPromotion(@Param("id") id: string) {
    return toApiJson(await this.promotions.getPromotion(id));
  }

  @Post(":id/submit")
  @RequireAdminPermission("promotion:edit")
  async submit(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.submitForReview(id, user.sub));
  }

  @Post(":id/reject")
  @RequireAdminPermission("promotion:edit")
  async reject(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.rejectToDraft(id, user.sub));
  }

  @Post(":id/unschedule")
  @RequireAdminPermission("promotion:edit")
  async unschedule(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.unschedule(id, user.sub));
  }

  @Post(":id/schedule-activation")
  @RequireAdminPermission("promotion:publish")
  async scheduleActivation(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.scheduleActivation(id, user.sub, body as { revisionId?: unknown; runAt: unknown; idempotencyKey: unknown }));
  }

  @Post(":id/schedule-end")
  @RequireAdminPermission("promotion:publish")
  async scheduleEnd(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.scheduleEnd(id, user.sub, body as { runAt: unknown; idempotencyKey: unknown }));
  }

  @Post(":id/activate")
  @RequireAdminPermission("promotion:publish")
  async activate(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.activate(id, user.sub, body ?? {}));
  }

  @Post(":id/pause-request")
  @RequireAdminPermission("promotion:edit")
  async requestPause(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.approvals.requestPause(user.sub, { ...(body ?? {}), promotionId: id } as never));
  }

  @Post(":id/resume")
  @RequireAdminPermission("promotion:pause")
  async resume(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.resume(id, user.sub));
  }

  @Post(":id/end")
  @RequireAdminPermission("promotion:pause")
  async end(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.end(id, user.sub));
  }

  @Post(":id/archive")
  @RequireAdminPermission("promotion:edit")
  async archive(@Param("id") id: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.archive(id, user.sub));
  }

  @Post(":id/revisions")
  @RequireAdminPermission("promotion:edit")
  async createRevision(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.createRevision(id, user.sub, body as never));
  }

  @Get(":id/revisions")
  @RequireAdminPermission("promotion:view")
  async listRevisions(@Param("id") id: string) {
    return toApiJson(await this.promotions.listRevisions(id));
  }

  @Get("revisions/:revisionId")
  @RequireAdminPermission("promotion:view")
  async getRevision(@Param("revisionId") revisionId: string) {
    return toApiJson(await this.promotions.getRevision(revisionId));
  }

  @Post("revisions/:revisionId/targets")
  @RequireAdminPermission("promotion:edit")
  async addTarget(@Param("revisionId") revisionId: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.addTarget(revisionId, user.sub, body as never));
  }

  @Delete("revisions/:revisionId/targets/:targetId")
  @RequireAdminPermission("promotion:edit")
  async removeTarget(@Param("revisionId") revisionId: string, @Param("targetId") targetId: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.removeTarget(revisionId, targetId, user.sub));
  }

  @Post("revisions/:revisionId/publish-request")
  @RequireAdminPermission("promotion:edit")
  async requestPublish(@Param("revisionId") revisionId: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.approvals.requestPublish(user.sub, { ...(body ?? {}), revisionId } as never));
  }

  @Post("approval-requests/:requestId/execute-publish")
  @RequireAdminPermission("wholesale:approval:decide")
  async executePublish(@Param("requestId") requestId: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.approvals.executeApprovedPublish(requestId, user.sub));
  }

  @Post("approval-requests/:requestId/execute-pause")
  @RequireAdminPermission("wholesale:approval:decide")
  async executePause(@Param("requestId") requestId: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.approvals.executeApprovedPause(requestId, user.sub));
  }

  @Delete("revisions/:revisionId")
  @RequireAdminPermission("promotion:edit")
  async discardRevision(@Param("revisionId") revisionId: string, @CurrentUser() user: Claims) {
    return toApiJson(await this.promotions.discardRevision(revisionId, user.sub));
  }

  @Post(":id/coupons")
  @RequireAdminPermission("promotion:coupon:manage")
  async createCoupon(@Param("id") id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.coupons.createCoupon(id, user.sub, body as never));
  }

  @Get(":id/coupons")
  @RequireAdminPermission("promotion:view")
  async listCoupons(@Param("id") id: string) {
    return toApiJson(await this.coupons.listCoupons(id));
  }

  @Patch("coupons/:couponId")
  @RequireAdminPermission("promotion:coupon:manage")
  async updateCoupon(@Param("couponId") couponId: string, @Body() body: Record<string, unknown>, @CurrentUser() user: Claims) {
    return toApiJson(await this.coupons.updateCoupon(couponId, user.sub, body as never));
  }

  @Get("coupons/:couponId/redemptions")
  @RequireAdminPermission("promotion:view")
  async listRedemptions(@Param("couponId") couponId: string, @Query() query: Record<string, unknown>) {
    return toApiJson(await this.usage.listRedemptions({ ...query, couponId }));
  }

  @Post("evaluate-preview")
  @RequireAdminPermission("promotion:view")
  async evaluatePreview(@Body() body: Record<string, unknown>) {
    return toApiJson(await this.evaluation.evaluate(body as never));
  }

  @Get("display/:code")
  @RequireAdminPermission("promotion:view")
  async displayPreview(@Param("code") code: string) {
    return toApiJson(await this.promotions.getPromotionDisplayState(code));
  }

  @Get(":id/attribution/:orderReference")
  @RequireAdminPermission("promotion:view")
  async orderAttribution(@Param("id") id: string, @Param("orderReference") orderReference: string) {
    const snapshots = await this.usage.getOrderAttribution(orderReference);
    return toApiJson(snapshots.filter((snapshot) => snapshot.promotionId === id));
  }
}
