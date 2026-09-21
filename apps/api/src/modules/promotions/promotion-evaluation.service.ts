import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import {
  promotion,
  promotionBenefit,
  promotionCoupon,
  promotionRevision,
  promotionTarget,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import type {
  EvaluationRequest,
  EvaluationResultJson,
  PromotionFactSource,
} from "./promotions.contract";
import { PromotionCodes, PromotionDomainError } from "./promotions.errors";
import {
  assertChannel,
  evaluatePromotionTerms,
  normalizeCouponCode,
  parseMoneyInput,
  type EvaluationCandidate,
} from "./promotions.logic";
import { PromotionFactsService } from "./promotion-facts.service";
import { PromotionUsageService } from "./promotion-usage.service";

const MAX_CANDIDATES = 500;

/**
 * Deterministic commercial evaluation orchestration.
 *
 * Read-only by construction: plain SELECTs, no transaction, no writes. The
 * service resolves every identity through the PromotionFactSource (owner
 * domains in production, scripted fakes in tests), loads the ACTIVE
 * candidates with their published terms, snapshots usage, and runs the pure
 * evaluation core. Money leaves as decimal strings.
 */
@Injectable()
export class PromotionEvaluationService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PromotionFactsService) private readonly facts: PromotionFactSource,
    @Inject(PromotionUsageService) private readonly usage: PromotionUsageService,
  ) {}

  async evaluate(request: EvaluationRequest): Promise<EvaluationResultJson> {
    const channel = assertChannel(request?.channel);
    const actorFacts = await this.facts.resolveActorFacts({
      userId: request?.actor?.userId,
      vipAccountId: request?.actor?.vipAccountId ?? null,
    });
    const lines = await this.facts.resolveLineFacts(request?.lines ?? []);
    const shippingTotal = parseMoneyInput(request?.shippingTotal, "shippingTotal");
    const now = request?.now instanceof Date && !Number.isNaN(request.now.getTime()) ? request.now : new Date();

    // Presented codes are untrusted browser input: normalize strictly and
    // drop unparseable shapes (they simply match nothing).
    const couponCodes: string[] = [];
    for (const raw of request?.couponCodes ?? []) {
      try {
        const normalized = normalizeCouponCode(raw);
        if (!couponCodes.includes(normalized)) couponCodes.push(normalized);
      } catch {
        // ignore — a mistyped code must not fail the whole evaluation.
      }
    }
    if (couponCodes.length > 10) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "too many coupon codes");
    }

    const candidates = await this.loadCandidates(channel);
    const snapshot = await this.usage.getUsageSnapshot({
      revisionIds: candidates.map((candidate) => candidate.revisionId),
      promotionIds: candidates.map((candidate) => candidate.promotionId),
      couponIds: candidates.flatMap((candidate) => candidate.coupons.map((coupon) => coupon.id)),
      customerKey: actorFacts.customerKey,
    });

    const result = evaluatePromotionTerms({
      channel,
      customerKey: actorFacts.customerKey,
      vipPlanId: actorFacts.vipPlanId,
      vipAccountId: actorFacts.vipAccountId,
      vipActive: actorFacts.vipActive,
      segments: actorFacts.segments,
      lines: lines.map((line) => ({
        lineId: line.lineId,
        productId: line.productId,
        categoryId: line.categoryId,
        offerId: line.offerId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      })),
      shippingTotal,
      couponCodes,
      now,
      candidates,
      usage: snapshot,
    });

    return {
      evaluationVersion: result.evaluationVersion,
      baseSubtotal: result.baseSubtotal.toString(),
      baseShipping: result.baseShipping.toString(),
      lineDiscounts: result.lineDiscounts.map((entry) => ({ lineId: entry.lineId, discount: entry.discount.toString() })),
      orderDiscount: result.orderDiscount.toString(),
      shippingDiscount: result.shippingDiscount.toString(),
      totalDiscount: result.totalDiscount.toString(),
      finalSubtotal: result.finalSubtotal.toString(),
      finalShipping: result.finalShipping.toString(),
      finalTotal: result.finalTotal.toString(),
      appliedPromotions: result.appliedPromotions.map((entry) => ({
        promotionId: entry.promotionId,
        promotionKey: entry.promotionKey,
        promotionRevisionId: entry.revisionId,
        couponId: entry.couponId,
        baseAmount: entry.baseAmount.toString(),
        discountAmount: entry.discountAmount.toString(),
        finalAmount: entry.finalAmount.toString(),
        evaluationHash: entry.evaluationHash,
        evaluationVersion: result.evaluationVersion,
      })),
      rejectedPromotions: result.rejectedPromotions,
      termsHash: result.termsHash,
    };
  }

  private async loadCandidates(channel: string): Promise<EvaluationCandidate[]> {
    const promos = await this.db
      .select()
      .from(promotion)
      .where(and(eq(promotion.channel, channel), eq(promotion.status, "ACTIVE")))
      .limit(MAX_CANDIDATES);
    const candidates: EvaluationCandidate[] = [];
    for (const promo of promos) {
      if (!promo.currentPublishedRevisionId) continue;
      const [revision] = await this.db
        .select()
        .from(promotionRevision)
        .where(eq(promotionRevision.id, promo.currentPublishedRevisionId))
        .limit(1);
      if (!revision || revision.status !== "PUBLISHED" || revision.promotionId !== promo.id) continue;
      const targets = await this.db.select().from(promotionTarget).where(eq(promotionTarget.revisionId, revision.id));
      const benefits = await this.db.select().from(promotionBenefit).where(eq(promotionBenefit.revisionId, revision.id));
      if (benefits.length === 0) continue;
      const coupons = await this.db.select().from(promotionCoupon).where(eq(promotionCoupon.promotionId, promo.id));
      candidates.push({
        promotionId: promo.id,
        promotionKey: promo.promotionKey,
        channel: promo.channel,
        status: promo.status,
        revisionId: revision.id,
        revisionStatus: revision.status,
        stackingPolicy: revision.stackingPolicy,
        priority: revision.priority,
        couponRequired: revision.couponRequired,
        startsAt: revision.startsAt,
        endsAt: revision.endsAt,
        usageLimitTotal: revision.usageLimitTotal,
        usageLimitPerCustomer: revision.usageLimitPerCustomer,
        termsHash: revision.termsHash,
        targets: targets.map((target) => ({
          type: target.targetType,
          referenceId: target.referenceId,
          minSubtotal: target.minSubtotal,
          minQuantity: target.minQuantity,
          startsAt: target.startsAt,
          endsAt: target.endsAt,
        })),
        benefits: benefits.map((benefit) => ({
          id: benefit.id,
          benefitType: benefit.benefitType,
          scope: benefit.scope,
          percentBps: benefit.percentBps,
          amount: benefit.amount,
        })),
        coupons: coupons.map((coupon) => ({
          id: coupon.id,
          codeNormalized: coupon.codeNormalized,
          status: coupon.status,
          startsAt: coupon.startsAt,
          endsAt: coupon.endsAt,
          usageLimit: coupon.usageLimit,
          perCustomerLimit: coupon.perCustomerLimit,
          revisionId: coupon.revisionId,
        })),
      });
    }
    return candidates;
  }
}
