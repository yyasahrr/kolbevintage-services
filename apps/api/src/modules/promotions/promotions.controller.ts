import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import type { PromotionActor } from "./promotions.contract";
import { PromotionService } from "./promotion.service";
import { PromotionRevisionService } from "./promotion-revision.service";
import { PromotionEvaluationService } from "./promotion-evaluation.service";
import { CouponService } from "./coupon.service";
import { PromotionScheduleService } from "./promotion-schedule.service";

/** Deep JSON mapping: bigint money → decimal strings (JSON cannot carry bigint). */
function jsonSafe<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map(jsonSafe) as unknown as T;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = jsonSafe(entry);
    return out as unknown as T;
  }
  return value;
}

/**
 * Promotions admin API (Checkpoint A: authoring + verification only).
 *
 * Lifecycle moves are explicit endpoints — there is no arbitrary
 * status-update route. Every write requires its catalogued admin
 * permission through the existing AdminPermissionGuard.
 */
@Controller("promotions/admin")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class PromotionsAdminController {
  constructor(
    @Inject(PromotionService) private readonly promotions: PromotionService,
    @Inject(PromotionRevisionService) private readonly revisions: PromotionRevisionService,
    @Inject(PromotionEvaluationService) private readonly evaluation: PromotionEvaluationService,
    @Inject(CouponService) private readonly coupons: CouponService,
    @Inject(PromotionScheduleService) private readonly schedules: PromotionScheduleService,
  ) {}

  private actor(user: Claims): PromotionActor {
    return { userId: user.sub, role: "admin" };
  }

  @Get()
  @RequireAdminPermission("promotion:view")
  async list(@Query() query: { channel?: string; status?: string; page?: number; limit?: number }) {
    return jsonSafe(await this.promotions.listPromotions(query));
  }

  @Post()
  @RequireAdminPermission("promotion:create")
  async create(@Body() body: { promotionKey: string; channel: string }, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.createPromotion(this.actor(user), body));
  }

  @Get(":id")
  @RequireAdminPermission("promotion:view")
  async get(@Param("id") id: string) {
    return jsonSafe(await this.promotions.getPromotion(id));
  }

  @Post(":id/submit")
  @RequireAdminPermission("promotion:edit")
  async submit(@Param("id") id: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "IN_REVIEW"));
  }

  @Post(":id/activate")
  @RequireAdminPermission("promotion:publish")
  async activate(@Param("id") id: string, @Body() body: { revisionId?: string }, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "ACTIVE", { revisionId: body?.revisionId }));
  }

  @Post(":id/pause")
  @RequireAdminPermission("promotion:pause")
  async pause(@Param("id") id: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "PAUSED"));
  }

  @Post(":id/resume")
  @RequireAdminPermission("promotion:pause")
  async resume(@Param("id") id: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "ACTIVE"));
  }

  @Post(":id/end")
  @RequireAdminPermission("promotion:edit")
  async end(@Param("id") id: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "ENDED"));
  }

  @Post(":id/archive")
  @RequireAdminPermission("promotion:edit")
  async archive(@Param("id") id: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.promotions.transition(this.actor(user), id, "ARCHIVED"));
  }

  @Get(":id/revisions")
  @RequireAdminPermission("promotion:view")
  async listRevisions(@Param("id") id: string) {
    return jsonSafe(await this.revisions.listRevisions(id));
  }

  @Post(":id/revisions")
  @RequireAdminPermission("promotion:edit")
  async createRevision(@Param("id") id: string, @Body() body: Record<string, never>, @CurrentUser() user: Claims) {
    return jsonSafe(await this.revisions.createDraftRevision(this.actor(user), id, body));
  }

  @Get("revisions/:revisionId")
  @RequireAdminPermission("promotion:view")
  async getRevision(@Param("revisionId") revisionId: string) {
    return jsonSafe(await this.revisions.getRevision(revisionId));
  }

  @Post("revisions/:revisionId/terms")
  @RequireAdminPermission("promotion:edit")
  async replaceTerms(
    @Param("revisionId") revisionId: string,
    @Body() body: { targets?: []; benefits?: [] },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.revisions.replaceTerms(this.actor(user), revisionId, body));
  }

  @Post("revisions/:revisionId/review")
  @RequireAdminPermission("promotion:edit")
  async reviewRevision(
    @Param("revisionId") revisionId: string,
    @Body() body: { status: string },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.revisions.transitionRevision(this.actor(user), revisionId, body?.status));
  }

  @Post("revisions/:revisionId/approval")
  @RequireAdminPermission("promotion:edit")
  async requestApproval(
    @Param("revisionId") revisionId: string,
    @Body() body: { makerNotes?: string; idempotencyKey: string },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.revisions.requestPublishApproval(this.actor(user), revisionId, body));
  }

  @Post("revisions/:revisionId/publish")
  @RequireAdminPermission("promotion:publish")
  async publishRevision(@Param("revisionId") revisionId: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.revisions.publishRevision(revisionId, user.sub));
  }

  @Post("revisions/:revisionId/clone")
  @RequireAdminPermission("promotion:edit")
  async cloneRevision(@Param("revisionId") revisionId: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.revisions.createDraftFromPublished(this.actor(user), revisionId));
  }

  @Get(":id/coupons")
  @RequireAdminPermission("promotion:view")
  async listCoupons(@Param("id") id: string) {
    return jsonSafe(await this.coupons.listCoupons(id));
  }

  @Post(":id/coupons")
  @RequireAdminPermission("promotion:coupon:manage")
  async createCoupon(
    @Param("id") id: string,
    @Body() body: { code: string; revisionId?: string | null; startsAt?: string; endsAt?: string; usageLimit?: number; perCustomerLimit?: number },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.coupons.createCoupon(this.actor(user), id, body));
  }

  @Post("coupons/:couponId")
  @RequireAdminPermission("promotion:coupon:manage")
  async updateCoupon(
    @Param("couponId") couponId: string,
    @Body() body: { status?: string; startsAt?: string; endsAt?: string; usageLimit?: number | null; perCustomerLimit?: number | null },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.coupons.updateCoupon(this.actor(user), couponId, body));
  }

  @Post(":id/schedules")
  @RequireAdminPermission("promotion:publish")
  async schedule(
    @Param("id") id: string,
    @Body() body: { action: string; revisionId?: string | null; scheduledAt: string; idempotencyKey: string },
    @CurrentUser() user: Claims,
  ) {
    return jsonSafe(await this.schedules.scheduleAction(this.actor(user), id, body));
  }

  @Post("schedules/:scheduleId/cancel")
  @RequireAdminPermission("promotion:publish")
  async cancelSchedule(@Param("scheduleId") scheduleId: string, @CurrentUser() user: Claims) {
    return jsonSafe(await this.schedules.cancelSchedule(this.actor(user), scheduleId));
  }

  @Post("evaluate")
  @RequireAdminPermission("promotion:view")
  async evaluate(@Body() body: never) {
    return this.evaluation.evaluate(body);
  }
}
