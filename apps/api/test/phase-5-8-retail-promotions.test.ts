import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionCouponService } from "../src/modules/promotions/promotion-coupon.service";
import { PromotionEligibilityService } from "../src/modules/promotions/promotion-eligibility.service";
import { PromotionEvaluationService } from "../src/modules/promotions/promotion-evaluation.service";
import { PromotionUsageService } from "../src/modules/promotions/promotion-usage.service";
import { RETAIL_PRICING_RESOLVER } from "../src/modules/promotions/promotions.contract";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../packages/database/test/helpers";

/**
 * Phase 5.8-A — Retail × Phase 5.7 promotion seam.
 *
 * The retail checkout evaluates with `priceBasis.resolvedBy =
 * "retail-pricing-service"` (OWNER_RESOLVED) and records redemptions inside
 * the checkout transaction via the shared-executor contract. Real
 * PostgreSQL; owner facts stubbed exactly like the 5.7 suites.
 *
 * A24 coverage: 9, 10, 11, 12, 15, 17 (+ the authority flip + executor
 * atomicity that A7 depends on).
 */

const DB = "kolbe_phase_5_8_retail_promotions_test";
const ADMIN = "p58_admin";
const NOW = "2026-06-15T12:00:00.000Z";
const BINDING = { evaluationVersion: "promo-eval-v1", termsHash: "b".repeat(64) };

let pool: Pool;
let db: ReturnType<typeof drizzle>;
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
const audit = { record: async () => "p58-audit" };

function serverBasis() {
  return { kind: "SERVER_RESOLVED", resolvedBy: RETAIL_PRICING_RESOLVER, reference: "rpv1.test" };
}

function retailEval(couponCodes: string[] = [], lines: Array<Record<string, unknown>> | null = null) {
  return {
    channel: "RETAIL",
    priceBasis: serverBasis(),
    now: NOW,
    actor: { kind: "RETAIL_CUSTOMER", userId: "user_1" },
    lines: lines ?? [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    couponCodes,
  } as const;
}

async function seedLivePromo(code: string, terms: Record<string, unknown> = {}) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT",
    benefitScope: "ORDER",
    percentBps: 1000,
    stackingPolicy: "STACKABLE",
    ...terms,
  });
  await promotions.publishRevision(revision.id, ADMIN);
  await promotions.submitForReview(promo.id, ADMIN);
  await promotions.activate(promo.id, ADMIN);
  return { promo, revision };
}

async function seedGatedPromo(code: string, couponCode: string, terms: Record<string, unknown> = {}, coupon: Record<string, unknown> = {}) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT",
    benefitScope: "ORDER",
    percentBps: 1000,
    stackingPolicy: "STACKABLE",
    couponRequired: true,
    ...terms,
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

describe("Phase 5.8-A retail promotion seam", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    db = drizzle(pool);
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

  it("prices percent discounts in basis points and stamps OWNER_RESOLVED for the retail pricing resolver", async () => {
    await endAllActive();
    await seedLivePromo("P58A", { percentBps: 1500, benefitScope: "LINE" });
    const result = await evaluate.evaluate(
      retailEval([], [{ lineId: "l1", productId: "prod_a", quantity: 2, unitPrice: "50000" }]),
    );
    expect(result.priceAuthority).toBe("OWNER_RESOLVED");
    expect(result.baseSubtotal).toBe("100000");
    expect(result.totalDiscount).toBe("15000");
    expect(result.grandTotal).toBe("85000");
    expect(result.appliedPromotions[0].promotionCode).toBe("P58A");
    expect(result.appliedPromotions[0].discountAmount).toBe("15000");
  });

  it("keeps CALLER_ATTESTED for any other retail resolver (the flip is keyed, not blanket)", async () => {
    await endAllActive();
    await seedLivePromo("P58B");
    const result = await evaluate.evaluate({
      ...retailEval(),
      priceBasis: { kind: "SERVER_RESOLVED", resolvedBy: "legacy-next", reference: null },
    });
    expect(result.priceAuthority).toBe("CALLER_ATTESTED_RETAIL_TRANSITION");
  });

  it("computes fixed-amount discounts exactly and clamps at the base", async () => {
    await endAllActive();
    await seedLivePromo("P58C", { benefitType: "FIXED_AMOUNT_DISCOUNT", percentBps: null, amount: "3000" });
    const result = await evaluate.evaluate(retailEval());
    expect(result.appliedPromotions[0].discountAmount).toBe("3000");
    expect(result.totalDiscount).toBe("3000");
    expect(result.grandTotal).toBe("7000");
    await endAllActive();
    await seedLivePromo("P58D", { benefitType: "FIXED_AMOUNT_DISCOUNT", percentBps: null, amount: "99999999" });
    const clamped = await evaluate.evaluate(retailEval());
    expect(clamped.totalDiscount).toBe("10000");
    expect(clamped.grandTotal).toBe("0");
  });

  it("rejects expired coupons without discounting", async () => {
    await endAllActive();
    await seedGatedPromo("P58E", "OLD-58", {}, { endsAt: "2026-01-01T00:00:00.000Z" });
    const result = await evaluate.evaluate(retailEval(["OLD-58"]));
    expect(result.unmatchedCouponCodes).toEqual([{ code: "OLD-58", reason: "COUPON_EXPIRED" }]);
    expect(result.appliedPromotions).toHaveLength(0);
    expect(result.totalDiscount).toBe("0");
    expect(result.grandTotal).toBe("10000");
  });

  it("enforces coupon and per-actor caps at redemption", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("P58F", "CAP-58", {}, { usageLimit: 1, perActorLimit: 1 });
    const redeem = (actorRef: string, orderReference: string, idempotencyKey: string) =>
      usage.recordRedemption("checkout", {
        promotionId: seeded.promo.id,
        revisionId: seeded.revision.id,
        couponCode: "CAP-58",
        actorKind: "RETAIL_CUSTOMER",
        actorRef,
        baseAmount: "10000",
        discountAmount: "1000",
        orderReference,
        idempotencyKey,
        ...BINDING,
      });
    await redeem("user_1", "ord_cap_a", "idem_cap_a");
    await expect(redeem("user_2", "ord_cap_b", "idem_cap_b")).rejects.toMatchObject({
      code: "PROMOTION_COUPON_EXHAUSTED",
    });
    const coupon = await coupons.getCoupon(seeded.coupon.id);
    expect(coupon.usedCount).toBe(1);
  });

  it("holds the cap under concurrent redemptions: exactly one winner", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("P58G", "RACE-58", {}, { usageLimit: 1 });
    const attempt = (actorRef: string, suffix: string) =>
      usage.recordRedemption("checkout", {
        promotionId: seeded.promo.id,
        revisionId: seeded.revision.id,
        couponCode: "RACE-58",
        actorKind: "RETAIL_CUSTOMER",
        actorRef,
        baseAmount: "10000",
        discountAmount: "1000",
        orderReference: `ord_race_${suffix}`,
        idempotencyKey: `idem_race_${suffix}`,
        ...BINDING,
      });
    const outcomes = await Promise.allSettled([attempt("race_1", "a"), attempt("race_2", "b"), attempt("race_3", "c")]);
    expect(outcomes.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((row) => row.status === "rejected") as Array<PromiseRejectedResult>;
    expect(rejected).toHaveLength(2);
    for (const row of rejected) {
      expect((row.reason as { code?: string }).code).toBe("PROMOTION_COUPON_EXHAUSTED");
    }
    const coupon = await coupons.getCoupon(seeded.coupon.id);
    expect(coupon.usedCount).toBe(1);
  });

  it("joins the caller's transaction: rollback consumes nothing, commit persists", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("P58H", "TX-58", {}, { usageLimit: 5 });
    const input = {
      promotionId: seeded.promo.id,
      revisionId: seeded.revision.id,
      couponCode: "TX-58",
      actorKind: "RETAIL_CUSTOMER",
      actorRef: "user_tx",
      baseAmount: "10000",
      discountAmount: "1000",
      orderReference: "ord_tx_a",
      idempotencyKey: "idem_tx_a",
      ...BINDING,
    } as const;
    await expect(
      (db as any).transaction(async (tx: unknown) => {
        await usage.recordRedemption("checkout", { ...input }, tx as any);
        throw new Error("outer checkout failure");
      }),
    ).rejects.toThrow("outer checkout failure");
    expect(await usage.getOrderAttribution("ord_tx_a")).toEqual([]);
    expect((await coupons.getCoupon(seeded.coupon.id)).usedCount).toBe(0);
    await (db as any).transaction(async (tx: unknown) => {
      await usage.recordRedemption("checkout", { ...input }, tx as any);
    });
    const snapshots = await usage.getOrderAttribution("ord_tx_a");
    expect(snapshots).toHaveLength(1);
    expect((await coupons.getCoupon(seeded.coupon.id)).usedCount).toBe(1);
  });

  it("preserves the full attribution snapshot per order (terms hash + evaluation version)", async () => {
    await endAllActive();
    const seeded = await seedGatedPromo("P58I", "ATT-58");
    await usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id,
      revisionId: seeded.revision.id,
      couponCode: "ATT-58",
      actorKind: "RETAIL_CUSTOMER",
      actorRef: "user_1",
      baseAmount: "10000",
      discountAmount: "1000",
      orderReference: "ord_att_a",
      idempotencyKey: "idem_att_a",
      ...BINDING,
    });
    expect(await usage.getOrderAttribution("ord_att_a")).toEqual([
      {
        promotionId: seeded.promo.id,
        promotionRevisionId: seeded.revision.id,
        couponId: seeded.coupon.id,
        baseAmount: "10000",
        discountAmount: "1000",
        finalAmount: "9000",
        evaluationVersion: "promo-eval-v1",
        termsHash: BINDING.termsHash,
      },
    ]);
  });

  it("keeps historical attribution immutable after the promotion terms change", async () => {
    await endAllActive();
    const seeded = await seedLivePromo("P58J", { percentBps: 1000 });
    await usage.recordRedemption("checkout", {
      promotionId: seeded.promo.id,
      revisionId: seeded.revision.id,
      actorKind: "RETAIL_CUSTOMER",
      actorRef: "user_1",
      baseAmount: "10000",
      discountAmount: "1000",
      orderReference: "ord_hist_a",
      idempotencyKey: "idem_hist_a",
      ...BINDING,
    });
    const before = await usage.getOrderAttribution("ord_hist_a");
    // New terms ship as a new revision; history still points at the old one.
    const next = await promotions.createRevision(seeded.promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT",
      benefitScope: "ORDER",
      percentBps: 5000,
      stackingPolicy: "STACKABLE",
    });
    await promotions.publishRevision(next.id, ADMIN);
    const after = await usage.getOrderAttribution("ord_hist_a");
    expect(after).toEqual(before);
    expect(after[0].promotionRevisionId).toBe(seeded.revision.id);
    expect(after[0].discountAmount).toBe("1000");
  });
});
