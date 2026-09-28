/**
 * Phase 5.7 — first-class coupon/voucher records.
 *
 * A coupon binds an exact published revision: codes are normalized
 * (trim + uppercase) and globally unique, windows and limits are explicit,
 * and only operational fields (enabled, window) may change after creation.
 * Code, promotion, revision, and limits are immutable — a new code means a
 * new row, so history never reinterprets.
 */

import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import {
  promotion,
  promotionCoupon,
  promotionRevision,
  type KolbeDatabase,
} from "@kolbe/database";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  assertWindowValid,
  makePromotionId,
  normalizeCouponCode,
  parseOptionalDate,
  parsePositiveInt,
  parseUsageLimit,
  PromotionDomainError,
} from "./promotions.logic";
import { mapPromotionPgError } from "./promotion.service";

export type CreateCouponInput = {
  revisionId?: unknown;
  code: unknown;
  enabled?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimit: unknown;
  perActorLimit?: unknown;
};

export type UpdateCouponInput = {
  enabled?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

@Injectable()
export class PromotionCouponService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createCoupon(promotionId: string, actorId: string, input: CreateCouponInput) {
    const code = normalizeCouponCode(input.code);
    const enabled = input.enabled === undefined || input.enabled === null ? true : input.enabled;
    if (typeof enabled !== "boolean") {
      throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "enabled must be boolean");
    }
    const startsAt = parseOptionalDate(input.startsAt, "starts_at");
    const endsAt = parseOptionalDate(input.endsAt, "ends_at");
    assertWindowValid(startsAt, endsAt);
    const usageLimit = parsePositiveInt(input.usageLimit, "usage_limit", 1_000_000_000, "PROMOTION_LIMIT_INVALID");
    const perActorLimit = parseUsageLimit(input.perActorLimit, "per_actor_limit");
    if (perActorLimit !== null && perActorLimit > usageLimit) {
      throw new PromotionDomainError("PROMOTION_LIMIT_INVALID", "per_actor_limit cannot exceed usage_limit");
    }
    const revisionRef = input.revisionId === undefined || input.revisionId === null || input.revisionId === ""
      ? null
      : String(input.revisionId);
    try {
      return await this.db.transaction(async (tx) => {
        const [promo] = await tx.select().from(promotion).where(eq(promotion.id, promotionId)).for("update").limit(1);
        if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${promotionId} not found`, 404);
        if (!promo.currentPublishedRevisionId) {
          throw new PromotionDomainError("PROMOTION_NO_PUBLISHED_REVISION", "Coupons bind a published revision; nothing is published", 409);
        }
        if (revisionRef && revisionRef !== promo.currentPublishedRevisionId) {
          throw new PromotionDomainError("PROMOTION_COUPON_REVISION_STALE", "Coupons bind the current published revision only", 409);
        }
        const [revision] = await tx
          .select()
          .from(promotionRevision)
          .where(eq(promotionRevision.id, promo.currentPublishedRevisionId))
          .limit(1);
        if (!revision || revision.status !== "PUBLISHED") {
          throw new PromotionDomainError("PROMOTION_NO_PUBLISHED_REVISION", "Current revision is not published", 409);
        }
        const [coupon] = await tx
          .insert(promotionCoupon)
          .values({
            id: makePromotionId("promocoupon"), promotionId, revisionId: revision.id,
            code, codeNormalized: code, enabled, startsAt, endsAt,
            usageLimit, usedCount: 0, perActorLimit, createdBy: actorId,
          })
          .returning();
        await this.audit.record({
          actorId, actorRole: "admin", action: "promotion.coupon_created",
          entityType: "promotion_coupon", entityId: coupon.id,
          after: { promotionId, revisionId: revision.id, code, usageLimit },
        }, tx);
        return coupon;
      });
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      mapPromotionPgError(error);
    }
  }

  async updateCoupon(couponId: string, actorId: string, input: UpdateCouponInput) {
    // Fail closed on unknown keys: code, promotion, revision, and limits are
    // immutable, so a misspelled field must error, never be silently dropped.
    for (const key of Object.keys(input ?? {})) {
      if (key !== "enabled" && key !== "startsAt" && key !== "endsAt") {
        throw new PromotionDomainError("PROMOTION_COUPON_INVALID", `coupon field '${key}' is immutable`);
      }
    }
    const enabled = input.enabled === undefined || input.enabled === null ? undefined : input.enabled;
    if (enabled !== undefined && typeof enabled !== "boolean") {
      throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "enabled must be boolean");
    }
    const startsAt = input.startsAt === undefined ? undefined : parseOptionalDate(input.startsAt, "starts_at");
    const endsAt = input.endsAt === undefined ? undefined : parseOptionalDate(input.endsAt, "ends_at");
    return this.db.transaction(async (tx) => {
      const [coupon] = await tx.select().from(promotionCoupon).where(eq(promotionCoupon.id, couponId)).for("update").limit(1);
      if (!coupon) throw new PromotionDomainError("PROMOTION_COUPON_NOT_FOUND", `Coupon ${couponId} not found`, 404);
      const nextStarts = startsAt === undefined ? coupon.startsAt : startsAt;
      const nextEnds = endsAt === undefined ? coupon.endsAt : endsAt;
      assertWindowValid(nextStarts, nextEnds);
      const patch: Partial<typeof coupon> = { updatedAt: new Date() };
      if (enabled !== undefined) patch.enabled = enabled;
      if (startsAt !== undefined) patch.startsAt = startsAt;
      if (endsAt !== undefined) patch.endsAt = endsAt;
      const [updated] = await tx.update(promotionCoupon).set(patch).where(eq(promotionCoupon.id, couponId)).returning();
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.coupon_updated",
        entityType: "promotion_coupon", entityId: couponId,
        before: { enabled: coupon.enabled }, after: { enabled: updated.enabled },
      }, tx);
      return updated;
    });
  }

  async listCoupons(promotionId: string) {
    const [promo] = await this.db.select({ id: promotion.id }).from(promotion).where(eq(promotion.id, promotionId)).limit(1);
    if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${promotionId} not found`, 404);
    return this.db
      .select()
      .from(promotionCoupon)
      .where(eq(promotionCoupon.promotionId, promotionId))
      .orderBy(desc(promotionCoupon.createdAt));
  }

  async getCoupon(couponId: string) {
    const [coupon] = await this.db.select().from(promotionCoupon).where(eq(promotionCoupon.id, couponId)).limit(1);
    if (!coupon) throw new PromotionDomainError("PROMOTION_COUPON_NOT_FOUND", `Coupon ${couponId} not found`, 404);
    return coupon;
  }

  /**
   * Evaluation-time resolution: normalized code → coupon row, or null when
   * unknown. Enabled/window/promotion checks happen in the eligibility layer
   * so rejections carry precise reasons.
   */
  async resolveCouponByCode(codeNormalized: string) {
    const [coupon] = await this.db
      .select()
      .from(promotionCoupon)
      .where(eq(promotionCoupon.codeNormalized, codeNormalized))
      .limit(1);
    return coupon ?? null;
  }
}
