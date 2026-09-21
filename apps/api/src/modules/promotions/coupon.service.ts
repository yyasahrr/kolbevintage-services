import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { promotion, promotionCoupon, promotionRevision } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import type { PromotionActor } from "./promotions.contract";
import { PromotionConflictError, PromotionDomainError, PromotionNotFoundError } from "./promotions.errors";
import {
  assertCouponStatus,
  makePromotionId,
  normalizeCouponCode,
  parseDateInput,
  requireSafeInteger,
  requireText,
} from "./promotions.logic";
import { isUniqueViolation } from "./promotion.service";

export type CreateCouponInput = {
  code: string;
  /** Pin to one revision, or omit to follow the current published revision. */
  revisionId?: string | null;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimit?: unknown;
  perCustomerLimit?: unknown;
};

export type UpdateCouponInput = {
  status?: string;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimit?: unknown;
  perCustomerLimit?: unknown;
};

/**
 * First-class coupon / voucher codes.
 *
 * Codes are normalized (trim + uppercase) and globally unique. A coupon
 * belongs to a promotion and either pins one revision or follows the
 * promotion's current published revision. Code identity (code, promotion,
 * revision link) is immutable; operational columns (status, window, limits)
 * stay mutable. Redemption accounting lives in PromotionUsageService.
 */
@Injectable()
export class CouponService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private assertAdmin(actor: PromotionActor): void {
    if (actor?.role !== "admin") {
      throw new PromotionDomainError("PROMOTION_FORBIDDEN", "promotion writes require an admin actor", 403);
    }
    requireText(actor?.userId, "actor.userId", 128);
  }

  async createCoupon(actor: PromotionActor, promotionId: string, input: CreateCouponInput) {
    this.assertAdmin(actor);
    const pid = requireText(promotionId, "promotionId", 128);
    const code = normalizeCouponCode(input?.code);
    const revisionId = input?.revisionId === null || input?.revisionId === undefined || input?.revisionId === ""
      ? null
      : requireText(input.revisionId, "revisionId", 128);
    const startsAt = parseDateInput(input?.startsAt, "startsAt");
    const endsAt = parseDateInput(input?.endsAt, "endsAt");
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "coupon requires startsAt < endsAt");
    }
    const usageLimit = input?.usageLimit === undefined || input?.usageLimit === null || input?.usageLimit === ""
      ? null
      : requireSafeInteger(input.usageLimit, "usageLimit", 1, 1_000_000_000);
    const perCustomerLimit = input?.perCustomerLimit === undefined || input?.perCustomerLimit === null || input?.perCustomerLimit === ""
      ? null
      : requireSafeInteger(input.perCustomerLimit, "perCustomerLimit", 1, 1_000_000_000);

    const [parent] = await this.db.select().from(promotion).where(eq(promotion.id, pid)).limit(1);
    if (!parent) throw new PromotionNotFoundError("promotion", pid);
    if (revisionId) {
      const [revision] = await this.db.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).limit(1);
      if (!revision || revision.promotionId !== pid) {
        throw new PromotionDomainError("PROMOTION_REVISION_MISMATCH", "pinned revision does not belong to the promotion");
      }
    }

    const id = makePromotionId("pcoupon");
    try {
      const [row] = await this.db
        .insert(promotionCoupon)
        .values({
          id,
          promotionId: pid,
          revisionId,
          code: requireText(input.code, "code", 64),
          codeNormalized: code,
          status: "ENABLED",
          startsAt,
          endsAt,
          usageLimit,
          perCustomerLimit,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record({
        actorId: actor.userId,
        actorRole: "admin",
        action: "promotion.coupon.created",
        entityType: "promotion_coupon",
        entityId: id,
        after: { promotionId: pid, codeNormalized: code, revisionId },
      });
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PromotionConflictError("PROMOTION_COUPON_DUPLICATE", `coupon code ${code} already exists`);
      }
      throw error;
    }
  }

  async updateCoupon(actor: PromotionActor, id: string, input: UpdateCouponInput) {
    this.assertAdmin(actor);
    const key = requireText(id, "id", 128);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = assertCouponStatus(input.status);
    if (input.startsAt !== undefined) patch.startsAt = parseDateInput(input.startsAt, "startsAt");
    if (input.endsAt !== undefined) patch.endsAt = parseDateInput(input.endsAt, "endsAt");
    if (input.usageLimit !== undefined) {
      patch.usageLimit = input.usageLimit === null ? null : requireSafeInteger(input.usageLimit, "usageLimit", 1, 1_000_000_000);
    }
    if (input.perCustomerLimit !== undefined) {
      patch.perCustomerLimit = input.perCustomerLimit === null ? null : requireSafeInteger(input.perCustomerLimit, "perCustomerLimit", 1, 1_000_000_000);
    }
    const [before] = await this.db.select().from(promotionCoupon).where(eq(promotionCoupon.id, key)).limit(1);
    if (!before) throw new PromotionNotFoundError("promotion_coupon", key);
    const startsAt = (patch.startsAt as Date | null | undefined) ?? before.startsAt;
    const endsAt = (patch.endsAt as Date | null | undefined) ?? before.endsAt;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "coupon requires startsAt < endsAt");
    }
    const [updated] = await this.db.update(promotionCoupon).set(patch as never).where(eq(promotionCoupon.id, key)).returning();
    await this.audit.record({
      actorId: actor.userId,
      actorRole: "admin",
      action: "promotion.coupon.updated",
      entityType: "promotion_coupon",
      entityId: key,
      before: { status: before.status },
      after: patch,
    });
    return updated;
  }

  async getCoupon(id: string) {
    const key = requireText(id, "id", 128);
    const [row] = await this.db.select().from(promotionCoupon).where(eq(promotionCoupon.id, key)).limit(1);
    if (!row) throw new PromotionNotFoundError("promotion_coupon", key);
    return row;
  }

  /** Resolve a raw browser-presented code to its coupon row (or null). */
  async resolveByCode(raw: unknown) {
    let normalized: string;
    try {
      normalized = normalizeCouponCode(raw);
    } catch {
      return null;
    }
    const [row] = await this.db.select().from(promotionCoupon).where(eq(promotionCoupon.codeNormalized, normalized)).limit(1);
    return row ?? null;
  }

  async listCoupons(promotionId: string) {
    const pid = requireText(promotionId, "promotionId", 128);
    return this.db.select().from(promotionCoupon).where(eq(promotionCoupon.promotionId, pid)).orderBy(asc(promotionCoupon.createdAt));
  }
}
