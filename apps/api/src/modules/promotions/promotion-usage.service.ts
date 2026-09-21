import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import {
  promotion,
  promotionCoupon,
  promotionCouponRedemption,
  promotionRevision,
  promotionUsage,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { PromotionCodes, PromotionDomainError, PromotionNotFoundError } from "./promotions.errors";
import {
  assertChannel,
  assertIdempotencyKey,
  makePromotionId,
  optionalText,
  parseMoneyInput,
  requireText,
} from "./promotions.logic";

export type CommitBase = {
  promotionId: string;
  revisionId: string;
  channel: string;
  customerKey: string;
  baseAmount: unknown;
  discountAmount: unknown;
  orderReference?: string | null;
  evaluationHash: string;
  idempotencyKey: string;
};

export type UsageSnapshotMaps = {
  revisionUses: Map<string, number>;
  customerUses: Map<string, number>;
  couponUses: Map<string, number>;
  couponCustomerUses: Map<string, number>;
};

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

/**
 * Redemption + usage ledger commits.
 *
 * Evaluation is advisory; the commit is authoritative. Every commit runs in
 * one transaction that locks the promotion row (then the coupon row for
 * coded paths) with SELECT … FOR UPDATE, re-checks every limit with
 * COUNT(*), and only then inserts the append-only ledger row. Two
 * concurrent checkouts therefore cannot both pass a `usage_limit = 1`
 * gate: the loser blocks on the row lock and then fails the re-check.
 */
@Injectable()
export class PromotionUsageService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Consistent usage snapshot for one evaluation (advisory, not a lock). */
  async getUsageSnapshot(input: {
    revisionIds: string[];
    promotionIds: string[];
    couponIds: string[];
    customerKey: string;
  }): Promise<UsageSnapshotMaps> {
    const snapshot: UsageSnapshotMaps = {
      revisionUses: new Map(),
      customerUses: new Map(),
      couponUses: new Map(),
      couponCustomerUses: new Map(),
    };
    const customerKey = requireText(input.customerKey, "customerKey", 256);
    for (const revisionId of new Set(input.revisionIds)) {
      snapshot.revisionUses.set(revisionId, await this.countRevisionUses(this.db, revisionId));
    }
    for (const promotionId of new Set(input.promotionIds)) {
      snapshot.customerUses.set(
        `${promotionId}‖${customerKey}`,
        await this.countCustomerUses(this.db, promotionId, customerKey),
      );
    }
    for (const couponId of new Set(input.couponIds)) {
      snapshot.couponUses.set(couponId, await this.countCouponUses(this.db, couponId));
      snapshot.couponCustomerUses.set(
        `${couponId}‖${customerKey}`,
        await this.countCouponCustomerUses(this.db, couponId, customerKey),
      );
    }
    return snapshot;
  }

  async commitCouponRedemption(input: CommitBase & { couponId: string }) {
    const base = this.normalizeCommit(input);
    const couponId = requireText(input.couponId, "couponId", 128);
    return this.db.transaction(async (tx) => {
      const promo = await this.lockPromotion(tx, base.promotionId);
      assertChannelLive(promo, base.channel);
      const revision = await this.lockRevision(tx, base.revisionId, base.promotionId);
      assertCurrentRevision(promo, revision);

      const [coupon] = await tx.select().from(promotionCoupon).where(eq(promotionCoupon.id, couponId)).for("update").limit(1);
      if (!coupon || coupon.promotionId !== base.promotionId) {
        throw new PromotionNotFoundError("promotion_coupon", couponId);
      }
      // Replay first: a retried commit must succeed even if limits are now spent.
      const [replay] = await tx
        .select()
        .from(promotionCouponRedemption)
        .where(and(eq(promotionCouponRedemption.couponId, couponId), eq(promotionCouponRedemption.idempotencyKey, base.idempotencyKey)))
        .limit(1);
      if (replay) return { redemption: replay, replayed: true };

      this.assertCouponUsable(coupon, revision.id, new Date());
      const couponUses = await this.countCouponUses(tx, couponId);
      if (coupon.usageLimit !== null && couponUses >= coupon.usageLimit) {
        throw new PromotionDomainError(PromotionCodes.COUPON_LIMIT_EXCEEDED, "coupon usage limit exhausted");
      }
      const couponCustomerUses = await this.countCouponCustomerUses(tx, couponId, base.customerKey);
      if (coupon.perCustomerLimit !== null && couponCustomerUses >= coupon.perCustomerLimit) {
        throw new PromotionDomainError(PromotionCodes.COUPON_LIMIT_EXCEEDED, "coupon per-customer limit exhausted");
      }
      await this.assertRevisionLimits(tx, revision, base.promotionId, base.customerKey);

      const [redemption] = await tx
        .insert(promotionCouponRedemption)
        .values({
          id: makePromotionId("pred"),
          couponId,
          promotionId: base.promotionId,
          revisionId: base.revisionId,
          channel: base.channel,
          customerKey: base.customerKey,
          orderReference: base.orderReference,
          baseAmount: base.baseAmount,
          discountAmount: base.discountAmount,
          finalAmount: base.baseAmount - base.discountAmount,
          evaluationHash: base.evaluationHash,
          idempotencyKey: base.idempotencyKey,
        })
        .returning();
      await tx
        .update(promotionCoupon)
        .set({ redeemedCount: coupon.redeemedCount + 1, updatedAt: new Date() })
        .where(eq(promotionCoupon.id, couponId));
      await this.audit.record(
        {
          actorId: null,
          actorRole: "system",
          action: "promotion.coupon.redeemed",
          entityType: "promotion_coupon_redemption",
          entityId: redemption.id,
          after: { couponId, promotionId: base.promotionId, revisionId: base.revisionId },
        },
        tx,
      );
      return { redemption, replayed: false };
    });
  }

  async commitUsage(input: CommitBase) {
    const base = this.normalizeCommit(input);
    return this.db.transaction(async (tx) => {
      const promo = await this.lockPromotion(tx, base.promotionId);
      assertChannelLive(promo, base.channel);
      const revision = await this.lockRevision(tx, base.revisionId, base.promotionId);
      assertCurrentRevision(promo, revision);

      const [replay] = await tx
        .select()
        .from(promotionUsage)
        .where(and(eq(promotionUsage.promotionId, base.promotionId), eq(promotionUsage.idempotencyKey, base.idempotencyKey)))
        .limit(1);
      if (replay) return { usage: replay, replayed: true };

      await this.assertRevisionLimits(tx, revision, base.promotionId, base.customerKey);
      const [usage] = await tx
        .insert(promotionUsage)
        .values({
          id: makePromotionId("puse"),
          promotionId: base.promotionId,
          revisionId: base.revisionId,
          channel: base.channel,
          customerKey: base.customerKey,
          orderReference: base.orderReference,
          baseAmount: base.baseAmount,
          discountAmount: base.discountAmount,
          finalAmount: base.baseAmount - base.discountAmount,
          evaluationHash: base.evaluationHash,
          idempotencyKey: base.idempotencyKey,
        })
        .returning();
      await this.audit.record(
        {
          actorId: null,
          actorRole: "system",
          action: "promotion.usage.committed",
          entityType: "promotion_usage",
          entityId: usage.id,
          after: { promotionId: base.promotionId, revisionId: base.revisionId },
        },
        tx,
      );
      return { usage, replayed: false };
    });
  }

  private normalizeCommit(input: CommitBase) {
    const promotionId = requireText(input.promotionId, "promotionId", 128);
    const revisionId = requireText(input.revisionId, "revisionId", 128);
    const channel = assertChannel(input.channel);
    const customerKey = requireText(input.customerKey, "customerKey", 256);
    const baseAmount = parseMoneyInput(input.baseAmount, "baseAmount");
    const discountAmount = parseMoneyInput(input.discountAmount, "discountAmount");
    if (discountAmount > baseAmount) {
      throw new PromotionDomainError(PromotionCodes.MONEY_INVALID, "discount cannot exceed the base amount");
    }
    const evaluationHash = requireText(input.evaluationHash, "evaluationHash", 64);
    if (!/^[0-9a-f]{64}$/.test(evaluationHash)) {
      throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "evaluationHash must be a sha256 hex digest");
    }
    return {
      promotionId,
      revisionId,
      channel,
      customerKey,
      baseAmount,
      discountAmount,
      orderReference: optionalText(input.orderReference, "orderReference", 128),
      evaluationHash,
      idempotencyKey: assertIdempotencyKey(input.idempotencyKey),
    };
  }

  private async lockPromotion(tx: DbOrTx, promotionId: string) {
    const [promo] = await tx.select().from(promotion).where(eq(promotion.id, promotionId)).for("update").limit(1);
    if (!promo) throw new PromotionNotFoundError("promotion", promotionId);
    return promo;
  }

  private async lockRevision(tx: DbOrTx, revisionId: string, promotionId: string) {
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).for("update").limit(1);
    if (!revision || revision.promotionId !== promotionId) {
      throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "revision does not belong to the promotion");
    }
    if (revision.status !== "PUBLISHED") {
      throw new PromotionDomainError(PromotionCodes.NOT_ACTIVE, "only published revisions can be committed");
    }
    return revision;
  }

  private assertCouponUsable(
    coupon: { status: string; startsAt: Date | null; endsAt: Date | null; revisionId: string | null },
    revisionId: string,
    now: Date,
  ): void {
    if (coupon.status !== "ENABLED") throw new PromotionDomainError(PromotionCodes.COUPON_DISABLED, "coupon is disabled");
    const time = now.getTime();
    if ((coupon.startsAt && time < coupon.startsAt.getTime()) || (coupon.endsAt && time >= coupon.endsAt.getTime())) {
      throw new PromotionDomainError(PromotionCodes.COUPON_EXPIRED, "coupon is outside its validity window");
    }
    if (coupon.revisionId !== null && coupon.revisionId !== revisionId) {
      throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "coupon is pinned to a different revision");
    }
  }

  private async assertRevisionLimits(
    tx: DbOrTx,
    revision: { id: string; usageLimitTotal: number | null; usageLimitPerCustomer: number | null },
    promotionId: string,
    customerKey: string,
  ): Promise<void> {
    if (revision.usageLimitTotal !== null) {
      const uses = await this.countRevisionUses(tx, revision.id);
      if (uses >= revision.usageLimitTotal) {
        throw new PromotionDomainError(PromotionCodes.USAGE_LIMIT_EXCEEDED, "promotion usage limit exhausted");
      }
    }
    if (revision.usageLimitPerCustomer !== null) {
      const uses = await this.countCustomerUses(tx, promotionId, customerKey);
      if (uses >= revision.usageLimitPerCustomer) {
        throw new PromotionDomainError(PromotionCodes.USAGE_LIMIT_EXCEEDED, "promotion per-customer limit exhausted");
      }
    }
  }

  private async countRows(tx: DbOrTx, table: never, condition: never): Promise<number> {
    const rows = await (tx as KolbeDatabase).select({ n: count() }).from(table as never).where(condition as never);
    return Number((rows[0] as { n: number }).n ?? 0);
  }

  private async countRevisionUses(tx: DbOrTx, revisionId: string): Promise<number> {
    const a = await this.countRows(tx, promotionCouponRedemption as never, eq(promotionCouponRedemption.revisionId, revisionId) as never);
    const b = await this.countRows(tx, promotionUsage as never, eq(promotionUsage.revisionId, revisionId) as never);
    return a + b;
  }

  private async countCustomerUses(tx: DbOrTx, promotionId: string, customerKey: string): Promise<number> {
    const a = await this.countRows(
      tx,
      promotionCouponRedemption as never,
      and(eq(promotionCouponRedemption.promotionId, promotionId), eq(promotionCouponRedemption.customerKey, customerKey)) as never,
    );
    const b = await this.countRows(
      tx,
      promotionUsage as never,
      and(eq(promotionUsage.promotionId, promotionId), eq(promotionUsage.customerKey, customerKey)) as never,
    );
    return a + b;
  }

  private async countCouponUses(tx: DbOrTx, couponId: string): Promise<number> {
    return this.countRows(tx, promotionCouponRedemption as never, eq(promotionCouponRedemption.couponId, couponId) as never);
  }

  private async countCouponCustomerUses(tx: DbOrTx, couponId: string, customerKey: string): Promise<number> {
    return this.countRows(
      tx,
      promotionCouponRedemption as never,
      and(eq(promotionCouponRedemption.couponId, couponId), eq(promotionCouponRedemption.customerKey, customerKey)) as never,
    );
  }
}

function assertChannelLive(promo: { status: string; channel: string }, channel: string): void {
  if (promo.channel !== channel) {
    throw new PromotionDomainError(PromotionCodes.CHANNEL_MISMATCH, "promotion channel does not match the commit channel");
  }
  if (promo.status !== "ACTIVE") {
    throw new PromotionDomainError(PromotionCodes.NOT_ACTIVE, `promotion is ${promo.status}, not ACTIVE`);
  }
}

function assertCurrentRevision(promo: { currentPublishedRevisionId: string | null }, revision: { id: string }): void {
  if (promo.currentPublishedRevisionId !== revision.id) {
    throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "revision is not the current published revision");
  }
}
