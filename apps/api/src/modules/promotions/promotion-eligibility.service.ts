/**
 * Phase 5.7 — eligibility resolution (read-only).
 *
 * Turns an evaluation request into a fully-resolved, owner-verified engine
 * request: actor identity is revalidated (VIP ownership, CRM segments),
 * every line is revalidated (retail isolation, offer liveness, wholesale
 * base-price re-derivation with fail-closed mismatch), active candidates are
 * loaded with their published terms, and presented coupon codes are attached
 * to exact revisions. This service writes nothing.
 */

import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  promotion,
  promotionRevision,
  promotionTarget,
  promotionUsage,
  type KolbeDatabase,
} from "@kolbe/database";
import { MAX_MONEY } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import {
  PROMOTION_FACTS_PROVIDER,
  type EvaluatePromotionsInput,
  type PromotionFactsProvider,
} from "./promotions.contract";
import { PromotionCouponService } from "./promotion-coupon.service";
import {
  normalizeCouponCode,
  parseActorRef,
  parseChannel,
  parseMoneyInput,
  parseOptionalDate,
  parsePositiveInt,
  parsePriceBasis,
  parseReferenceId,
  PromotionDomainError,
  type EngineActor,
  type EngineCandidate,
  type EngineLine,
  type EngineRequest,
} from "./promotions.logic";

export type ResolvedEvaluationRequest = {
  engine: EngineRequest;
  priceAuthority: "OWNER_RESOLVED" | "CALLER_ATTESTED_RETAIL_TRANSITION";
  priceBasis: { resolvedBy: string; reference: string | null };
  unmatchedCouponCodes: Array<{ code: string; reason: string }>;
};

const ACTOR_KINDS = ["RETAIL_CUSTOMER", "WHOLESALE_ACCOUNT"] as const;
const LINE_ID_PATTERN = /^[A-Za-z0-9_:.=-]{1,128}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

@Injectable()
export class PromotionEligibilityService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PROMOTION_FACTS_PROVIDER) private readonly facts: PromotionFactsProvider,
    @Inject(PromotionCouponService) private readonly coupons: PromotionCouponService,
  ) {}

  async resolveEvaluationRequest(input: EvaluatePromotionsInput): Promise<ResolvedEvaluationRequest> {
    if (!input || typeof input !== "object") {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "evaluation input is required");
    }
    const channel = parseChannel(input.channel);
    const priceBasis = parsePriceBasis(input.priceBasis);
    const now = parseOptionalDate(input.now, "now") ?? new Date();
    const actorInput = input.actor;
    if (!actorInput || typeof actorInput !== "object") {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "actor is required");
    }
    if (!ACTOR_KINDS.includes(actorInput.kind as (typeof ACTOR_KINDS)[number])) {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "actor.kind must be RETAIL_CUSTOMER or WHOLESALE_ACCOUNT");
    }
    const userId = parseActorRef(actorInput.userId, "actor.userId");
    let accountId: string | null = null;
    if (actorInput.kind === "WHOLESALE_ACCOUNT") {
      if (actorInput.accountId === undefined || actorInput.accountId === null || actorInput.accountId === "") {
        throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "actor.accountId is required for wholesale");
      }
      accountId = parseActorRef(actorInput.accountId, "actor.accountId");
    } else if (actorInput.accountId !== undefined && actorInput.accountId !== null && actorInput.accountId !== "") {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "retail actors must not carry an accountId");
    }

    const rawLines = input.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "at least one line is required");
    }
    if (rawLines.length > 200) {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "too many lines (max 200)");
    }
    const shippingBase = input.shippingBase === undefined || input.shippingBase === null
      ? null
      : parseMoneyInput(input.shippingBase, "shippingBase");

    const rawCodes = input.couponCodes ?? [];
    if (!Array.isArray(rawCodes)) throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "couponCodes must be an array");
    if (rawCodes.length > 20) throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "too many coupon codes (max 20)");
    const couponCodes = [...new Set(rawCodes.map((code) => normalizeCouponCode(code)))].sort();

    const lines = await this.resolveLines(channel, rawLines);
    const actor = await this.resolveActor(channel, actorInput.kind, userId, accountId);
    const candidates = await this.loadCandidates(channel, actor, couponCodes, now);

    const priceAuthority = channel === "WHOLESALE" ? "OWNER_RESOLVED" : "CALLER_ATTESTED_RETAIL_TRANSITION";
    return {
      engine: { channel, actor: actor.engine, lines, shippingBase, candidates: candidates.engine, now },
      priceAuthority,
      priceBasis: { resolvedBy: priceBasis.resolvedBy, reference: priceBasis.reference },
      unmatchedCouponCodes: candidates.unmatched,
    };
  }

  private async resolveLines(channel: "RETAIL" | "WHOLESALE", rawLines: unknown[]): Promise<EngineLine[]> {
    const seen = new Set<string>();
    const lines: EngineLine[] = [];
    for (const raw of rawLines) {
      if (!raw || typeof raw !== "object") {
        throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "line must be an object");
      }
      const record = raw as Record<string, unknown>;
      const lineId = typeof record.lineId === "string" ? record.lineId : "";
      if (!LINE_ID_PATTERN.test(lineId) || FORBIDDEN_KEYS.has(lineId)) {
        throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "lineId has an invalid format");
      }
      if (seen.has(lineId)) throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `duplicate lineId ${lineId}`);
      seen.add(lineId);
      const productId = parseReferenceId(record.productId, "line.productId");
      const variantId = record.variantId === undefined || record.variantId === null || record.variantId === ""
        ? null
        : parseReferenceId(record.variantId, "line.variantId");
      const packageId = record.packageId === undefined || record.packageId === null || record.packageId === ""
        ? null
        : parseReferenceId(record.packageId, "line.packageId");
      const offerId = record.offerId === undefined || record.offerId === null || record.offerId === ""
        ? null
        : parseReferenceId(record.offerId, "line.offerId");
      const quantity = parsePositiveInt(record.quantity, `line ${lineId} quantity`, 1_000_000_000, "PROMOTION_EVALUATION_INVALID");
      const unitPrice = parseMoneyInput(record.unitPrice, `line ${lineId} unitPrice`);
      const lineBase = unitPrice * BigInt(quantity);
      if (lineBase > MAX_MONEY) {
        throw new PromotionDomainError("PROMOTION_MONEY_OVERFLOW", `line ${lineId} base exceeds the maximum money value`);
      }

      if (channel === "RETAIL") {
        if (variantId || packageId) {
          throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `retail line ${lineId} must not carry variant/package selectors`);
        }
        const product = await this.facts.assertRetailProduct(productId);
        if (offerId) {
          const offer = await this.facts.getOfferFacts(offerId);
          if (!offer) throw new PromotionDomainError("PROMOTION_OFFER_UNKNOWN", `Offer ${offerId} is unknown or ineligible`, 422);
          if (offer.productId !== productId) {
            throw new PromotionDomainError("PROMOTION_LINE_OFFER_MISMATCH", `line ${lineId} offer does not belong to the product`, 422);
          }
        }
        lines.push({ lineId, productId, categoryId: product.categoryId, offerId, quantity, unitPrice, lineBase });
      } else {
        if (!offerId) {
          throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `wholesale line ${lineId} requires an offerId`);
        }
        if ((variantId && packageId) || (!variantId && !packageId)) {
          throw new PromotionDomainError(
            "PROMOTION_EVALUATION_INVALID",
            `wholesale line ${lineId} requires exactly one of variantId or packageId`,
          );
        }
        const offer = await this.facts.getOfferFacts(offerId);
        if (!offer) throw new PromotionDomainError("PROMOTION_OFFER_UNKNOWN", `Offer ${offerId} is unknown or ineligible`, 422);
        if (offer.productId !== productId) {
          throw new PromotionDomainError("PROMOTION_LINE_OFFER_MISMATCH", `line ${lineId} offer does not belong to the product`, 422);
        }
        const product = await this.facts.getProductFacts(productId);
        if (!product) throw new PromotionDomainError("PROMOTION_PRODUCT_UNKNOWN", `Product ${productId} is unknown`, 422);
        const resolved = await this.facts.resolveWholesaleLineBase({ offerId, variantId, packageId, quantity });
        // Server base price remains authoritative: any deviation fails closed.
        if (resolved.unitPrice !== unitPrice) {
          throw new PromotionDomainError(
            "PROMOTION_PRICE_MISMATCH",
            `line ${lineId} unit price does not match the authoritative base price`,
            422,
          );
        }
        lines.push({ lineId, productId, categoryId: product.categoryId, offerId, quantity, unitPrice, lineBase });
      }
    }
    return lines;
  }

  private async resolveActor(
    channel: "RETAIL" | "WHOLESALE",
    kind: "RETAIL_CUSTOMER" | "WHOLESALE_ACCOUNT",
    userId: string,
    accountId: string | null,
  ): Promise<{ engine: EngineActor }> {
    // Channel/kind coherence: retail evaluations carry retail actors, wholesale wholesale actors.
    if (channel === "RETAIL" && kind !== "RETAIL_CUSTOMER") {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "retail evaluation requires a retail actor");
    }
    if (channel === "WHOLESALE" && kind !== "WHOLESALE_ACCOUNT") {
      throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", "wholesale evaluation requires a wholesale actor");
    }
    if (kind === "WHOLESALE_ACCOUNT" && accountId) {
      // Throws on cross-account mismatch (anti-spoof); null when no active membership.
      const vip = await this.facts.getVipFacts(accountId, userId);
      const segments = await this.facts.getSegmentFacts({ userId, linkType: "wholesale_account" });
      return {
        engine: {
          kind, userId, accountId,
          vipPlanId: vip?.planId ?? null,
          hasActiveVip: !!vip,
          segments: toSegmentList(segments),
        },
      };
    }
    const segments = await this.facts.getSegmentFacts({ userId, linkType: "account_user" });
    return {
      engine: { kind, userId, accountId: null, vipPlanId: null, hasActiveVip: false, segments: toSegmentList(segments) },
    };
  }

  private async loadCandidates(
    channel: "RETAIL" | "WHOLESALE",
    actor: { engine: EngineActor },
    couponCodes: string[],
    now: Date,
  ): Promise<{ engine: EngineCandidate[]; unmatched: Array<{ code: string; reason: string }> }> {
    const rows = await this.db
      .select({ promo: promotion, revision: promotionRevision })
      .from(promotion)
      .innerJoin(promotionRevision, eq(promotionRevision.id, promotion.currentPublishedRevisionId))
      .where(and(eq(promotion.status, "ACTIVE"), eq(promotion.channel, channel), eq(promotionRevision.status, "PUBLISHED")));
    const ordered = [...rows].sort((a, b) =>
      a.revision.priority !== b.revision.priority
        ? a.revision.priority - b.revision.priority
        : a.promo.id < b.promo.id ? -1 : a.promo.id > b.promo.id ? 1 : 0,
    );
    const revisionIds = ordered.map((row) => row.revision.id);
    const targetRows = revisionIds.length > 0
      ? await this.db.select().from(promotionTarget).where(inArray(promotionTarget.revisionId, revisionIds))
      : [];
    const targetsByRevision = new Map<string, typeof targetRows>();
    for (const target of targetRows) {
      const list = targetsByRevision.get(target.revisionId) ?? [];
      list.push(target);
      targetsByRevision.set(target.revisionId, list);
    }

    const actorType = actor.engine.kind;
    const actorRef = actor.engine.kind === "WHOLESALE_ACCOUNT" ? (actor.engine.accountId as string) : actor.engine.userId;
    const usageRows = revisionIds.length > 0
      ? await this.db
        .select()
        .from(promotionUsage)
        .where(and(
          inArray(promotionUsage.revisionId, revisionIds),
          eq(promotionUsage.actorType, actorType),
          eq(promotionUsage.actorRef, actorRef),
        ))
      : [];
    const usageByKey = new Map<string, number>();
    for (const row of usageRows) usageByKey.set(`${row.revisionId}|${row.couponId ?? ""}`, row.uses);
    const autoSums = revisionIds.length > 0
      ? await this.db
        .select({ revisionId: promotionUsage.revisionId, total: sql<number>`coalesce(sum(${promotionUsage.uses}), 0)::int` })
        .from(promotionUsage)
        .where(and(inArray(promotionUsage.revisionId, revisionIds), isNull(promotionUsage.couponId)))
        .groupBy(promotionUsage.revisionId)
      : [];
    const autoSumByRevision = new Map(autoSums.map((row) => [row.revisionId, row.total ?? 0]));

    const candidates: EngineCandidate[] = ordered.map((row) => ({
      promotionId: row.promo.id,
      code: row.promo.code,
      channel: row.promo.channel,
      status: row.promo.status,
      revisionId: row.revision.id,
      revisionNumber: row.revision.revisionNumber,
      benefitType: row.revision.benefitType,
      benefitScope: row.revision.benefitScope,
      percentBps: row.revision.percentBps,
      amount: row.revision.amount,
      stackingPolicy: row.revision.stackingPolicy,
      priority: row.revision.priority,
      maxTotalUses: row.revision.maxTotalUses,
      maxUsesPerActor: row.revision.maxUsesPerActor,
      couponRequired: row.revision.couponRequired,
      startsAt: row.revision.startsAt,
      endsAt: row.revision.endsAt,
      termsHash: row.revision.termsHash,
      targets: (targetsByRevision.get(row.revision.id) ?? []).map((target) => ({
        type: target.targetType,
        valueText: target.valueText,
        valueAmount: target.valueAmount,
        valueQuantity: target.valueQuantity,
      })),
      coupon: null,
      couponStale: false,
      usageTotal: autoSumByRevision.get(row.revision.id) ?? 0,
      usageActor: usageByKey.get(`${row.revision.id}|`) ?? 0,
    }));
    const byPromotion = new Map(candidates.map((candidate) => [candidate.promotionId, candidate]));

    const unmatched: Array<{ code: string; reason: string }> = [];
    for (const code of couponCodes) {
      const coupon = await this.coupons.resolveCouponByCode(code);
      if (!coupon) {
        unmatched.push({ code, reason: "COUPON_UNKNOWN" });
        continue;
      }
      const candidate = byPromotion.get(coupon.promotionId);
      if (!candidate) {
        unmatched.push({ code, reason: "COUPON_PROMOTION_INACTIVE" });
        continue;
      }
      if (!coupon.enabled) {
        unmatched.push({ code, reason: "COUPON_DISABLED" });
        continue;
      }
      if (coupon.startsAt && coupon.startsAt.getTime() > now.getTime()) {
        unmatched.push({ code, reason: "COUPON_NOT_YET_VALID" });
        continue;
      }
      if (coupon.endsAt && coupon.endsAt.getTime() <= now.getTime()) {
        unmatched.push({ code, reason: "COUPON_EXPIRED" });
        continue;
      }
      if (coupon.revisionId !== candidate.revisionId) {
        candidate.couponStale = true;
        unmatched.push({ code, reason: "COUPON_STALE_REVISION" });
        continue;
      }
      if (candidate.coupon) {
        unmatched.push({ code, reason: "COUPON_REDUNDANT" });
        continue;
      }
      candidate.coupon = { couponId: coupon.id, code };
      // Coupon redemptions count through the coupon counter, not the auto sums.
      candidate.usageTotal = coupon.usedCount;
      candidate.usageActor = usageByKey.get(`${candidate.revisionId}|${coupon.id}`) ?? 0;
    }
    return { engine: candidates, unmatched };
  }
}

function toSegmentList(segments: { stage: string | null; tagKeys: string[] }): string[] {
  const list = segments.tagKeys.map((key) => `tag:${key}`);
  if (segments.stage) list.push(`stage:${segments.stage}`);
  return list.sort();
}
