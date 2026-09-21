/**
 * Phase 5.7 — concurrency-safe redemption recording.
 *
 * Evaluation never mutates; this is the single explicit writer. Each call
 * runs in one transaction: replay check → promotion/revision locks (the
 * revision row lock serializes redemptions per revision, so global caps hold
 * under concurrency) → guarded coupon increment → guarded per-actor usage
 * upsert → ledger insert. Concurrent checkouts racing the last use serialize;
 * exactly one wins.
 */

import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  promotion,
  promotionCoupon,
  promotionCouponRedemption,
  promotionRevision,
  promotionUsage,
  type KolbeDatabase,
} from "@kolbe/database";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  makePromotionId,
  normalizeCouponCode,
  parseActorRef,
  parseIdempotencyKey,
  parseMoneyInput,
  parseOptionalText,
  parsePositiveInt,
  PromotionDomainError,
} from "./promotions.logic";
import { mapPromotionPgError } from "./promotion.service";

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

export type RecordRedemptionInput = {
  promotionId: unknown;
  revisionId: unknown;
  couponCode?: unknown;
  actorKind: unknown;
  /** Usage key: retail userId or wholesale accountId (server-resolved). */
  actorRef: unknown;
  baseAmount: unknown;
  discountAmount: unknown;
  orderReference?: unknown;
  idempotencyKey: unknown;
};

const ACTOR_TYPES = ["RETAIL_CUSTOMER", "WHOLESALE_ACCOUNT"] as const;

@Injectable()
export class PromotionUsageService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async recordRedemption(callerId: string, input: RecordRedemptionInput) {
    const promotionId = parseOptionalText(input.promotionId, "promotion_id", 160);
    const revisionId = parseOptionalText(input.revisionId, "revision_id", 160);
    if (!promotionId || !revisionId) {
      throw new PromotionDomainError("PROMOTION_REDEMPTION_INVALID", "promotion_id and revision_id are required");
    }
    const couponCode = input.couponCode === undefined || input.couponCode === null || input.couponCode === ""
      ? null
      : normalizeCouponCode(input.couponCode);
    if (!ACTOR_TYPES.includes(input.actorKind as (typeof ACTOR_TYPES)[number])) {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "actorKind must be RETAIL_CUSTOMER or WHOLESALE_ACCOUNT");
    }
    const actorType = input.actorKind as (typeof ACTOR_TYPES)[number];
    const actorRef = parseActorRef(input.actorRef, "actor_ref");
    const baseAmount = parseMoneyInput(input.baseAmount, "base_amount");
    const discountAmount = parseMoneyInput(input.discountAmount, "discount_amount");
    if (discountAmount > baseAmount) {
      throw new PromotionDomainError("PROMOTION_REDEMPTION_INVALID", "discount_amount cannot exceed base_amount");
    }
    const orderReference = parseOptionalText(input.orderReference, "order_reference", 160);
    if (orderReference) parseOrderReference(orderReference);
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const now = new Date();

    try {
      return await this.db.transaction(async (tx) => {
        const executor = tx as DbOrTx;
        const [replay] = await executor
          .select()
          .from(promotionCouponRedemption)
          .where(eq(promotionCouponRedemption.idempotencyKey, idempotencyKey))
          .limit(1);
        if (replay) return this.presentRedemption(executor, replay, true);

        const [promo] = await executor.select().from(promotion).where(eq(promotion.id, promotionId)).for("update").limit(1);
        if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${promotionId} not found`, 404);
        if (promo.status !== "ACTIVE") {
          throw new PromotionDomainError("PROMOTION_NOT_ACTIVE", `Promotion is ${promo.status}`, 409);
        }
        const [revision] = await executor.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).for("update").limit(1);
        if (!revision || revision.promotionId !== promotionId) {
          throw new PromotionDomainError("PROMOTION_REVISION_NOT_FOUND", "Revision does not belong to this promotion", 404);
        }
        // Exact-terms binding: a publish racing checkout fails closed (caller re-evaluates).
        if (revision.status !== "PUBLISHED" || promo.currentPublishedRevisionId !== revision.id) {
          throw new PromotionDomainError("PROMOTION_REVISION_STALE", "Revision is no longer the published terms", 409);
        }

        let couponId: string | null = null;
        if (couponCode) {
          const [coupon] = await executor
            .select()
            .from(promotionCoupon)
            .where(eq(promotionCoupon.codeNormalized, couponCode))
            .for("update")
            .limit(1);
          if (!coupon || coupon.promotionId !== promotionId) {
            throw new PromotionDomainError("PROMOTION_COUPON_NOT_FOUND", "Coupon does not belong to this promotion", 404);
          }
          if (coupon.revisionId !== revision.id) {
            throw new PromotionDomainError("PROMOTION_COUPON_REVISION_STALE", "Coupon binds superseded terms", 409);
          }
          if (!coupon.enabled) throw new PromotionDomainError("PROMOTION_COUPON_DISABLED", "Coupon is disabled", 409);
          if (coupon.startsAt && coupon.startsAt.getTime() > now.getTime()) {
            throw new PromotionDomainError("PROMOTION_COUPON_NOT_YET_VALID", "Coupon is not yet valid", 409);
          }
          if (coupon.endsAt && coupon.endsAt.getTime() <= now.getTime()) {
            throw new PromotionDomainError("PROMOTION_COUPON_EXPIRED", "Coupon is expired", 409);
          }
          const incremented = await executor
            .update(promotionCoupon)
            .set({ usedCount: sql`${promotionCoupon.usedCount} + 1`, updatedAt: now })
            .where(and(eq(promotionCoupon.id, coupon.id), sql`${promotionCoupon.usedCount} < ${promotionCoupon.usageLimit}`))
            .returning({ usedCount: promotionCoupon.usedCount });
          if (incremented.length === 0) {
            throw new PromotionDomainError("PROMOTION_COUPON_EXHAUSTED", "Coupon usage limit reached", 409);
          }
          // Revision-level cap across ALL coupons of these terms (a single
          // coupon counter cannot enforce it when several codes share one
          // revision). Safe under concurrency: the revision row is locked.
          if (revision.maxTotalUses !== null) {
            const [couponPathSum] = await executor
              .select({ total: sql<number>`coalesce(sum(${promotionUsage.uses}), 0)::int` })
              .from(promotionUsage)
              .where(eq(promotionUsage.revisionId, revision.id));
            if ((couponPathSum?.total ?? 0) + 1 > revision.maxTotalUses) {
              throw new PromotionDomainError("PROMOTION_USAGE_LIMIT_EXHAUSTED", "Promotion usage limit reached", 409);
            }
          }
          couponId = coupon.id;
          const couponCap = coupon.perActorLimit;
          await this.incrementActorUsage(executor, {
            promotionId, revisionId: revision.id, couponId, actorType, actorRef,
            cap: capOf(revision.maxUsesPerActor, couponCap),
          });
        } else {
          if (revision.couponRequired) {
            throw new PromotionDomainError("PROMOTION_COUPON_REQUIRED", "This promotion requires a coupon code", 409);
          }
          if (revision.maxTotalUses !== null) {
            const [sum] = await executor
              .select({ total: sql<number>`coalesce(sum(${promotionUsage.uses}), 0)::int` })
              .from(promotionUsage)
              .where(and(eq(promotionUsage.revisionId, revision.id), sql`${promotionUsage.couponId} IS NULL`));
            if ((sum?.total ?? 0) + 1 > revision.maxTotalUses) {
              throw new PromotionDomainError("PROMOTION_USAGE_LIMIT_EXHAUSTED", "Promotion usage limit reached", 409);
            }
          }
          await this.incrementActorUsage(executor, {
            promotionId, revisionId: revision.id, couponId: null, actorType, actorRef, cap: revision.maxUsesPerActor,
          });
        }

        const [redemption] = await executor
          .insert(promotionCouponRedemption)
          .values({
            id: makePromotionId("promoredeem"), couponId, promotionId, revisionId: revision.id,
            actorType, actorRef, baseAmount, discountAmount, orderReference, idempotencyKey,
          })
          .returning();
        await this.audit.record({
          actorId: callerId, actorRole: "system", action: "promotion.redeemed",
          entityType: "promotion_coupon_redemption", entityId: redemption.id,
          after: { promotionId, revisionId: revision.id, couponId, actorType, discountAmount: discountAmount.toString() },
        }, executor);
        return this.presentRedemption(executor, redemption, false);
      });
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      // A failed statement aborts the whole transaction (25P02 on any further
      // query inside it), so conflict resolution happens here, outside, on a
      // usable connection. Drizzle wraps driver errors: SQLSTATE is on `cause`.
      const inner = (error as { cause?: unknown })?.cause ?? error;
      const pgCode = (inner as { code?: string })?.code ?? (error as { code?: string })?.code;
      const pgConstraint = (inner as { constraint?: string })?.constraint
        ?? (error as { constraint?: string })?.constraint
        ?? "";
      if (pgCode === "23505" && pgConstraint.includes("idempotency")) {
        // Concurrent replay with the same key: return the winner.
        const [existing] = await this.db
          .select()
          .from(promotionCouponRedemption)
          .where(eq(promotionCouponRedemption.idempotencyKey, idempotencyKey))
          .limit(1);
        if (existing) return this.presentRedemption(this.db, existing, true);
      }
      mapPromotionPgError(error);
    }
  }

  private async incrementActorUsage(
    tx: DbOrTx,
    key: { promotionId: string; revisionId: string; couponId: string | null; actorType: string; actorRef: string; cap: number | null },
  ): Promise<number> {
    const conditions = [
      eq(promotionUsage.revisionId, key.revisionId),
      eq(promotionUsage.actorType, key.actorType),
      eq(promotionUsage.actorRef, key.actorRef),
      key.couponId === null ? sql`${promotionUsage.couponId} IS NULL` : eq(promotionUsage.couponId, key.couponId),
    ];
    const [existing] = await tx.select().from(promotionUsage).where(and(...conditions)).limit(1);
    if (existing) {
      if (key.cap !== null && existing.uses >= key.cap) {
        throw new PromotionDomainError("PROMOTION_ACTOR_LIMIT_EXHAUSTED", "Per-actor usage limit reached", 409);
      }
      const [updated] = await tx
        .update(promotionUsage)
        .set({ uses: existing.uses + 1, updatedAt: new Date() })
        .where(eq(promotionUsage.id, existing.id))
        .returning({ uses: promotionUsage.uses });
      return updated.uses;
    }
    const [created] = await tx
      .insert(promotionUsage)
      .values({
        id: makePromotionId("promouse"), promotionId: key.promotionId, revisionId: key.revisionId,
        couponId: key.couponId, actorType: key.actorType, actorRef: key.actorRef, uses: 1,
      })
      .returning({ uses: promotionUsage.uses });
    return created.uses;
  }

  private async presentRedemption(tx: DbOrTx, redemption: typeof promotionCouponRedemption.$inferSelect, replayed: boolean) {
    const [usage] = await tx
      .select({ uses: promotionUsage.uses })
      .from(promotionUsage)
      .where(and(
        eq(promotionUsage.revisionId, redemption.revisionId),
        eq(promotionUsage.actorType, redemption.actorType),
        eq(promotionUsage.actorRef, redemption.actorRef),
        redemption.couponId === null
          ? sql`${promotionUsage.couponId} IS NULL`
          : eq(promotionUsage.couponId, redemption.couponId),
      ))
      .limit(1);
    return {
      id: redemption.id,
      promotionId: redemption.promotionId,
      revisionId: redemption.revisionId,
      couponId: redemption.couponId,
      actorType: redemption.actorType,
      actorRef: redemption.actorRef,
      baseAmount: redemption.baseAmount.toString(),
      discountAmount: redemption.discountAmount.toString(),
      orderReference: redemption.orderReference,
      uses: usage?.uses ?? 0,
      replayed,
    };
  }

  async listRedemptions(filter: { couponId?: unknown; promotionId?: unknown; page?: unknown; limit?: unknown } = {}) {
    const couponId = filter.couponId === undefined || filter.couponId === null || filter.couponId === ""
      ? null
      : parseOptionalText(filter.couponId, "coupon_id", 160);
    const promotionId = filter.promotionId === undefined || filter.promotionId === null || filter.promotionId === ""
      ? null
      : parseOptionalText(filter.promotionId, "promotion_id", 160);
    if (!couponId && !promotionId) {
      throw new PromotionDomainError("PROMOTION_FILTER_INVALID", "coupon_id or promotion_id is required");
    }
    const page = filter.page === undefined ? 1 : parsePositiveInt(filter.page, "page", 100_000, "PROMOTION_FILTER_INVALID");
    const limit = filter.limit === undefined ? 20 : parsePositiveInt(filter.limit, "limit", 100, "PROMOTION_FILTER_INVALID");
    const conditions = [];
    if (couponId) conditions.push(eq(promotionCouponRedemption.couponId, couponId));
    if (promotionId) conditions.push(eq(promotionCouponRedemption.promotionId, promotionId));
    const where = and(...conditions);
    const items = await this.db
      .select()
      .from(promotionCouponRedemption)
      .where(where)
      .orderBy(desc(promotionCouponRedemption.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(promotionCouponRedemption).where(where);
    return {
      items: items.map((row) => ({ ...row, baseAmount: row.baseAmount.toString(), discountAmount: row.discountAmount.toString() })),
      page, limit, total: count,
    };
  }
}

function capOf(...caps: Array<number | null>): number | null {
  const finite = caps.filter((cap): cap is number => cap !== null);
  if (finite.length === 0) return null;
  return Math.min(...finite);
}

function parseOrderReference(value: string): void {
  if (!/^[A-Za-z0-9_:.=-]{1,160}$/.test(value)) {
    throw new PromotionDomainError("PROMOTION_REDEMPTION_INVALID", "order_reference has an invalid format");
  }
}
