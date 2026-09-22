import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionCouponService } from "../src/modules/promotions/promotion-coupon.service";
import { PromotionUsageService } from "../src/modules/promotions/promotion-usage.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_b_attribution_test";
const ADMIN = "p57b_admin";
const BINDING = { evaluationVersion: "promo-eval-v1", termsHash: "b".repeat(64) };

let pool: Pool;
let promotions: PromotionService;
let coupons: PromotionCouponService;
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
const audit = { record: async () => "p57b-audit" };

async function seedLivePromo(code: string, couponRequired = false) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000,
    stackingPolicy: "STACKABLE", couponRequired,
  });
  await promotions.publishRevision(revision.id, ADMIN);
  await promotions.submitForReview(promo.id, ADMIN);
  await promotions.activate(promo.id, ADMIN);
  return { promo, revision };
}

describe("Phase 5.7-B order attribution snapshots", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    promotions = new PromotionService(db as any, facts as any, audit as any);
    coupons = new PromotionCouponService(db as any, audit as any);
    usage = new PromotionUsageService(db as any, audit as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("requires the evaluation binding on every redemption write", async () => {
    const { promo, revision } = await seedLivePromo("BAT10");
    const base = {
      promotionId: promo.id, revisionId: revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_b10", idempotencyKey: "idem_b10",
    };
    await expect(usage.recordRedemption("checkout", base as never)).rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
    await expect(usage.recordRedemption("checkout", { ...base, evaluationVersion: "promo-eval-v1", idempotencyKey: "idem_b10b" } as never))
      .rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
    await expect(usage.recordRedemption("checkout", { ...base, ...BINDING, termsHash: "ZZZ", idempotencyKey: "idem_b10c" } as never))
      .rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
    await expect(usage.recordRedemption("checkout", { ...base, ...BINDING, evaluationVersion: "no spaces!", idempotencyKey: "idem_b10d" } as never))
      .rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
  });

  it("reads back the exact attribution snapshot per applied promotion", async () => {
    const { promo, revision } = await seedLivePromo("BAT11", true);
    const coupon = await coupons.createCoupon(promo.id, ADMIN, { code: "BAT-11", usageLimit: 100 });
    await usage.recordRedemption("checkout", {
      promotionId: promo.id, revisionId: revision.id, couponCode: "BAT-11",
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_1",
      baseAmount: "10000", discountAmount: "1000",
      orderReference: "ord_b11", idempotencyKey: "idem_b11", ...BINDING,
    });
    const snapshots = await usage.getOrderAttribution("ord_b11");
    expect(snapshots).toEqual([{
      promotionId: promo.id,
      promotionRevisionId: revision.id,
      couponId: coupon.id,
      baseAmount: "10000",
      discountAmount: "1000",
      finalAmount: "9000",
      evaluationVersion: "promo-eval-v1",
      termsHash: BINDING.termsHash,
    }]);
  });

  it("attributes multi-promotion orders with one snapshot per redemption", async () => {
    const first = await seedLivePromo("BAT12A");
    const second = await seedLivePromo("BAT12B");
    await usage.recordRedemption("checkout", {
      promotionId: first.promo.id, revisionId: first.revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_2",
      baseAmount: "20000", discountAmount: "2000",
      orderReference: "ord_b12", idempotencyKey: "idem_b12a", ...BINDING,
    });
    await usage.recordRedemption("checkout", {
      promotionId: second.promo.id, revisionId: second.revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_2",
      baseAmount: "18000", discountAmount: "1800",
      orderReference: "ord_b12", idempotencyKey: "idem_b12b", ...BINDING,
    });
    const snapshots = await usage.getOrderAttribution("ord_b12");
    expect(snapshots.map((row) => row.promotionId)).toEqual([first.promo.id, second.promo.id]);
    expect(snapshots.map((row) => row.couponId)).toEqual([null, null]);
    expect(snapshots.map((row) => row.finalAmount)).toEqual(["18000", "16200"]);
  });

  it("snapshots survive later rule changes (history never recomputes)", async () => {
    const { promo, revision } = await seedLivePromo("BAT13");
    await usage.recordRedemption("checkout", {
      promotionId: promo.id, revisionId: revision.id,
      actorKind: "RETAIL_CUSTOMER", actorRef: "user_3",
      baseAmount: "5000", discountAmount: "500",
      orderReference: "ord_b13", idempotencyKey: "idem_b13", ...BINDING,
    });
    // Terms change after the order: the snapshot must not follow.
    const next = await promotions.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 5000, stackingPolicy: "STACKABLE",
    });
    await promotions.publishRevision(next.id, ADMIN);
    const snapshots = await usage.getOrderAttribution("ord_b13");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].promotionRevisionId).toBe(revision.id);
    expect(snapshots[0].discountAmount).toBe("500");
    expect(snapshots[0].termsHash).toBe(BINDING.termsHash);
  });

  it("returns empty attribution for unknown orders and rejects malformed references", async () => {
    await expect(usage.getOrderAttribution("ord_nope")).resolves.toEqual([]);
    await expect(usage.getOrderAttribution("bad ref!!")).rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
    await expect(usage.getOrderAttribution("")).rejects.toMatchObject({ code: "PROMOTION_REDEMPTION_INVALID" });
  });

  it("reads pre-0032 rows with null binding instead of inventing attribution", async () => {
    const { promo, revision } = await seedLivePromo("BAT14");
    await pool.query(
      `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
       VALUES ('legacy_b14', $1, $2, 'RETAIL_CUSTOMER', 'user_4', 3000, 300, 'ord_b14', 'idem_b14')`,
      [promo.id, revision.id],
    );
    const snapshots = await usage.getOrderAttribution("ord_b14");
    expect(snapshots).toEqual([{
      promotionId: promo.id,
      promotionRevisionId: revision.id,
      couponId: null,
      baseAmount: "3000",
      discountAmount: "300",
      finalAmount: "2700",
      evaluationVersion: null,
      termsHash: null,
    }]);
  });
});
