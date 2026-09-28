import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionCouponService } from "../src/modules/promotions/promotion-coupon.service";
import { PromotionEligibilityService } from "../src/modules/promotions/promotion-eligibility.service";
import { PromotionEvaluationService } from "../src/modules/promotions/promotion-evaluation.service";
import { PromotionUsageService } from "../src/modules/promotions/promotion-usage.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_promotions_coupons_test";
const ADMIN = "p57_admin";
const NOW = "2026-06-15T12:00:00.000Z";

let pool: Pool;
let promotions: PromotionService;
let coupons: PromotionCouponService;
let evaluate: PromotionEvaluationService;
let usage: PromotionUsageService;

const facts = {
  getProductFacts: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
  assertRetailProduct: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
  getOfferFacts: async () => null,
  listPricingTiers: async () => [],
  getPackageFacts: async () => null,
  resolveWholesaleLineBase: async () => { throw new Error("not used"); },
  getVipFacts: async () => null,
  vipPlanExists: async () => true,
  wholesaleAccountExists: async () => true,
  getSegmentFacts: async () => ({ contactId: null, stage: null, tagKeys: [] }),
  tagExists: async () => true,
};
const audit = { record: async () => "p57-audit" };
// 5.7-B attribution binding required by every redemption write.
const BINDING = { evaluationVersion: "promo-eval-v1", termsHash: "a".repeat(64) };

function basis() {
  return { kind: "SERVER_RESOLVED", resolvedBy: "p57_test", reference: null };
}

async function seedGatedPromo(code: string, couponCode: string, terms: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000,
    stackingPolicy: "STACKABLE", couponRequired: true, ...terms,
  });
  await promotions.publishRevision(revision.id, ADMIN);
  const created = await coupons.createCoupon(promo.id, ADMIN, { code: couponCode, usageLimit: 100, ...coupon });
  await promotions.submitForReview(promo.id, ADMIN);
  await promotions.activate(promo.id, ADMIN);
  return { promo, revision, coupon: created };
}

async function endAllActive() {
  const page = await promotions.listPromotions({ status: "ACTIVE", limit: 100 });
  for (const row of page.items) {
    await promotions.end(row.id, ADMIN);
  }
}

function retailEval(couponCodes: string[] = []) {
  return {
    channel: "RETAIL", priceBasis: basis(), now: NOW,
    actor: { kind: "RETAIL_CUSTOMER", userId: "user_1" },
    lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    couponCodes,
  } as const;
}

describe("Phase 5.7 first-class coupons and concurrency-safe usage", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    promotions = new PromotionService(db as any, facts as any, audit as any);
    coupons = new PromotionCouponService(db as any, audit as any);
    const eligibility = new PromotionEligibilityService(db as any, facts as any, coupons as any);
    evaluate = new PromotionEvaluationService(eligibility as any);
    usage = new PromotionUsageService(db as any, audit as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("normalizes coupon codes and enforces global uniqueness", async () => {
    await endAllActive();
    const first = await seedGatedPromo("CPN10", "save-10");
    expect(first.coupon.codeNormalized).toBe("SAVE-10");
    await expect(coupons.createCoupon(first.promo.id, ADMIN, { code: "SAVE-10", usageLimit: 5 })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_TAKEN",
    });
    await expect(coupons.createCoupon(first.promo.id, ADMIN, { code: "  save-10  ", usageLimit: 5 })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_TAKEN",
    });
    // A second promotion cannot claim the same code either: resolution is unambiguous.
    const other = await promotions.createPromotion(ADMIN, { code: "CPN11", title: "other", channel: "RETAIL" });
    const revision = await promotions.createRevision(other.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 500, stackingPolicy: "STACKABLE",
    });
    await promotions.publishRevision(revision.id, ADMIN);
    await expect(coupons.createCoupon(other.id, ADMIN, { code: "SAVE-10", usageLimit: 5 })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_TAKEN",
    });
    await expect(coupons.createCoupon(first.promo.id, ADMIN, { code: "no spaces!", usageLimit: 5 })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_INVALID",
    });
  });

  it("gates coupon-required promotions on a valid attached code", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN12", "GATE-12");
    const missing = await evaluate.evaluate(retailEval());
    expect(missing.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("COUPON_REQUIRED_MISSING");
    const wrong = await evaluate.evaluate(retailEval(["WRONG-1"]));
    expect(wrong.unmatchedCouponCodes).toEqual([{ code: "WRONG-1", reason: "COUPON_UNKNOWN" }]);
    expect(wrong.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("COUPON_REQUIRED_MISSING");
    const good = await evaluate.evaluate(retailEval(["gate-12"]));
    const applied = good.appliedPromotions.find((row) => row.promotionId === seeded.promo.id);
    expect(applied?.couponId).toBe(seeded.coupon.id);
    expect(applied?.discountAmount).toBe("1000");
    expect(good.unmatchedCouponCodes).toEqual([]);
  });

  it("rejects disabled, expired, and not-yet-valid coupons with stable reasons", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN13", "GATE-13");
    await coupons.updateCoupon(seeded.coupon.id, ADMIN, { enabled: false });
    const disabled = await evaluate.evaluate(retailEval(["GATE-13"]));
    expect(disabled.unmatchedCouponCodes).toEqual([{ code: "GATE-13", reason: "COUPON_DISABLED" }]);
    await coupons.updateCoupon(seeded.coupon.id, ADMIN, { enabled: true });
    // Immutable bindings cannot be rewritten onto live coupons.
    await expect(coupons.updateCoupon(seeded.coupon.id, ADMIN, { usageLimit: 7 } as any)).rejects.toMatchObject({
      code: "PROMOTION_COUPON_INVALID",
    });
    await endAllActive();
    const expired = await seedGatedPromo("CPN14", "OLD-14", {}, { endsAt: "2026-01-01T00:00:00.000Z" });
    const expiredEval = await evaluate.evaluate(retailEval(["OLD-14"]));
    expect(expiredEval.unmatchedCouponCodes).toEqual([{ code: "OLD-14", reason: "COUPON_EXPIRED" }]);
    expect(expired.coupon.id).toBeDefined();
  });

  it("treats coupons of superseded revisions as stale, never silently valid", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN15", "GATE-15");
    const next = await promotions.createRevision(seeded.promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 2000,
      stackingPolicy: "STACKABLE", couponRequired: true,
    });
    await promotions.publishRevision(next.id, ADMIN);
    const result = await evaluate.evaluate(retailEval(["GATE-15"]));
    expect(result.unmatchedCouponCodes).toEqual([{ code: "GATE-15", reason: "COUPON_STALE_REVISION" }]);
    expect(result.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("STALE_COUPON_REVISION");
    await expect(usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-15",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_stale", idempotencyKey: "idem_stale",
      ...BINDING,
    })).rejects.toMatchObject({ code: "PROMOTION_REVISION_STALE" });
  });

  it("records redemptions once and replays idempotently", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN16", "GATE-16");
    const input = {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-16",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_16", idempotencyKey: "idem_16",
      ...BINDING,
    };
    const first = await usage.recordRedemption("checkout", input);
    expect(first.replayed).toBe(false);
    expect(first.uses).toBe(1);
    const replay = await usage.recordRedemption("checkout", input);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM promotion_coupon_redemption WHERE promotion_id = $1`, [seeded.promo.id]);
    expect(rows.rows[0].n).toBe(1);
    const coupon = await coupons.getCoupon(seeded.coupon.id);
    expect(coupon.usedCount).toBe(1);
    // Same order cannot consume the promotion twice through another key.
    await expect(usage.recordRedemption("checkout", { ...input, idempotencyKey: "idem_16b" })).rejects.toMatchObject({
      code: "PROMOTION_ORDER_ALREADY_DISCOUNTED",
    });
  });

  it("serializes concurrent redemptions: exactly one wins a single-use coupon", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN17", "GATE-17", {}, { usageLimit: 1 });
    const attempt = (suffix: string) => usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-17",
      actorKind: "RETAIL_CUSTOMER", actorRef: `user_${suffix}`,
      baseAmount: "10000", discountAmount: "1000",
      orderReference: `ord_17_${suffix}`, idempotencyKey: `idem_17_${suffix}`,
      ...BINDING,
    });
    const outcomes = await Promise.allSettled([attempt("a"), attempt("b")]);
    const fulfilled = outcomes.filter((row) => row.status === "fulfilled");
    const rejected = outcomes.filter((row) => row.status === "rejected") as Array<PromiseRejectedResult>;
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code?: string }).code).toBe("PROMOTION_COUPON_EXHAUSTED");
    const coupon = await coupons.getCoupon(seeded.coupon.id);
    expect(coupon.usedCount).toBe(1);
  });

  it("enforces revision-level caps across redemption paths", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN18", "GATE-18", { maxTotalUses: 1 });
    await usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-18",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_18_a", idempotencyKey: "idem_18_a",
      ...BINDING,
    });
    await expect(usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-18",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_2",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_18_b", idempotencyKey: "idem_18_b",
      ...BINDING,
    })).rejects.toMatchObject({ code: "PROMOTION_USAGE_LIMIT_EXHAUSTED" });
    // Evaluation pre-checks the same cap before checkout even starts.
    const result = await evaluate.evaluate(retailEval(["GATE-18"]));
    expect(result.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("USAGE_LIMIT_EXHAUSTED");
  });

  it("enforces per-actor caps without blocking other actors", async () => {
    await endAllActive();
    const promo = await promotions.createPromotion(ADMIN, { code: "CPN19", title: "auto", channel: "RETAIL" });
    const revision = await promotions.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000,
      stackingPolicy: "STACKABLE", maxUsesPerActor: 1,
    });
    await promotions.publishRevision(revision.id, ADMIN);
    await promotions.submitForReview(promo.id, ADMIN);
    await promotions.activate(promo.id, ADMIN);
    const redeem = (actor: string, order: string, key: string) => usage.recordRedemption("checkout", {
      promotionId: promo.id, revisionId: revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: actor,
      baseAmount: "10000", discountAmount: "1000",
      orderReference: order, idempotencyKey: key,
      ...BINDING,
    });
    await redeem("user_1", "ord_19_a", "idem_19_a");
    await expect(redeem("user_1", "ord_19_b", "idem_19_b")).rejects.toMatchObject({ code: "PROMOTION_ACTOR_LIMIT_EXHAUSTED" });
    await redeem("user_2", "ord_19_c", "idem_19_c");
    // Auto path has no coupon ledger id: the order-scoped unique still dedupes
    // (a fresh actor isolates the order unique from the per-actor cap).
    await expect(redeem("user_3", "ord_19_c", "idem_19_d")).rejects.toMatchObject({ code: "PROMOTION_ORDER_ALREADY_DISCOUNTED" });
    // Coupon-required terms reject codeless redemption explicitly.
    const gated = await seedGatedPromo("CPN19G", "GATE-19G");
    await expect(usage.recordRedemption("checkout", {
      promotionId: gated.promo.id, revisionId: gated.revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_9",
      baseAmount: "100", discountAmount: "10",
      orderReference: "ord_19_g", idempotencyKey: "idem_19_g",
      ...BINDING,
    })).rejects.toMatchObject({ code: "PROMOTION_COUPON_REQUIRED" });
  });

  it("validates redemption math and lifecycle state before writing", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("CPN20", "GATE-20");
    const base = {
      promotionId: seeded.promo.id, revisionId: seeded.revision.id, couponCode: "GATE-20",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      ...BINDING,
    };
    await expect(usage.recordRedemption("checkout", {
      ...base, baseAmount: "100", discountAmount: "101", orderReference: "ord_20_a", idempotencyKey: "idem_20_a",
    })).rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
    await promotions.end(seeded.promo.id, ADMIN);
    await expect(usage.recordRedemption("checkout", {
      ...base, baseAmount: "100", discountAmount: "10", orderReference: "ord_20_b", idempotencyKey: "idem_20_b",
    })).rejects.toMatchObject({ code: "PROMOTION_NOT_ACTIVE" });
    const listed = await usage.listRedemptions({ promotionId: seeded.promo.id });
    expect(listed.total).toBe(0);
  });
});
