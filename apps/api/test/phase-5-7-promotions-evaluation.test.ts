import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionCouponService } from "../src/modules/promotions/promotion-coupon.service";
import { PromotionEligibilityService } from "../src/modules/promotions/promotion-eligibility.service";
import { PromotionEvaluationService } from "../src/modules/promotions/promotion-evaluation.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_promotions_evaluation_test";
const ADMIN = "p57_admin";
const NOW = "2026-06-15T12:00:00.000Z";

let pool: Pool;
let promotions: PromotionService;
let coupons: PromotionCouponService;
let evaluate: PromotionEvaluationService;

const state = {
  products: new Map<string, { categoryId: string }>([["prod_a", { categoryId: "cat_a" }], ["prod_b", { categoryId: "cat_b" }]]),
  offers: new Map<string, { productId: string }>([["offer_a", { productId: "prod_a" }]]),
  wholesaleUnitPrice: new Map<string, bigint>([["offer_a|var_a|", 25000n]]),
  vip: null as null | { planId: string; accountId: string },
  segments: { contactId: "ctc_1", stage: "LOYAL", tagKeys: ["summer"] } as { contactId: string | null; stage: string | null; tagKeys: string[] },
};

const facts = {
  getProductFacts: async (productId: string) => {
    const row = state.products.get(productId);
    return row ? { productId, categoryId: row.categoryId, status: "published", ownerType: "KOLBE" } : null;
  },
  assertRetailProduct: async (productId: string) => {
    const row = state.products.get(productId);
    if (!row) throw new Error(`unknown product ${productId}`);
    return { productId, categoryId: row.categoryId, status: "published", ownerType: "KOLBE" };
  },
  getOfferFacts: async (offerId: string) => {
    const row = state.offers.get(offerId);
    return row ? { offerId, productId: row.productId, sellerId: "seller_a", status: "published" } : null;
  },
  listPricingTiers: async () => [],
  getPackageFacts: async () => null,
  resolveWholesaleLineBase: async (input: { offerId: string; variantId: string | null; packageId: string | null }) => {
    const price = state.wholesaleUnitPrice.get(`${input.offerId}|${input.variantId ?? ""}|${input.packageId ?? ""}`);
    if (price === undefined) throw new Error("unresolvable wholesale base");
    return { unitPrice: price, currency: "IRR", pricingTierId: null };
  },
  getVipFacts: async () => state.vip,
  vipPlanExists: async () => true,
  wholesaleAccountExists: async () => true,
  getSegmentFacts: async () => state.segments,
  tagExists: async () => true,
};
const audit = { record: async () => "p57-audit" };

function basis() {
  return { kind: "SERVER_RESOLVED", resolvedBy: "p57_test", reference: null };
}

function retailActor() {
  return { kind: "RETAIL_CUSTOMER", userId: "user_1" };
}

function wholesaleActor() {
  return { kind: "WHOLESALE_ACCOUNT", userId: "user_9", accountId: "acc_9" };
}

async function seedPromo(code: string, channel: "RETAIL" | "WHOLESALE", terms: Record<string, unknown>, targets: Array<Record<string, unknown>> = []) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT",
    benefitScope: "LINE",
    percentBps: 1000,
    stackingPolicy: "STACKABLE",
    ...terms,
    targets,
  });
  await promotions.publishRevision(revision.id, ADMIN);
  await promotions.submitForReview(promo.id, ADMIN);
  await promotions.activate(promo.id, ADMIN);
  return { promo, revision };
}

/** Per-test isolation: earlier seeds must not leak into later evaluations. */
async function endAllActive() {
  const page = await promotions.listPromotions({ status: "ACTIVE", limit: 100 });
  for (const row of page.items) {
    await promotions.end(row.id, ADMIN);
  }
}

describe("Phase 5.7 deterministic commercial evaluation", () => {
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
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("computes percent discounts in basis points with pure integer math", async () => {
    await endAllActive();
    await seedPromo("EVAL10", "RETAIL", { percentBps: 1500 });
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 2, unitPrice: "50000" }],
    });
    expect(result.baseSubtotal).toBe("100000");
    expect(result.appliedPromotions).toHaveLength(1);
    expect(result.appliedPromotions[0].promotionCode).toBe("EVAL10");
    expect(result.appliedPromotions[0].discountAmount).toBe("15000");
    expect(result.appliedPromotions[0].baseAmount).toBe("100000");
    expect(result.totalDiscount).toBe("15000");
    expect(result.grandTotal).toBe("85000");
    expect(result.appliedPromotions[0].allocatedLines).toEqual({ l1: "15000" });
  });

  it("never discounts below zero: fixed amounts clamp at the remaining base", async () => {
    await endAllActive();
    await seedPromo("EVAL11", "RETAIL", {
      benefitType: "FIXED_AMOUNT_DISCOUNT", benefitScope: "ORDER", percentBps: null, amount: "1000000",
    });
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100000" }],
    });
    expect(result.appliedPromotions).toHaveLength(1);
    expect(result.appliedPromotions[0].discountAmount).toBe("100000");
    expect(result.totalDiscount).toBe("100000");
    expect(result.lineDiscounts).toEqual({ l1: "0" });
    expect(result.grandTotal).toBe("0");
  });

  it("stacks percents on the remaining base in priority order, deterministically", async () => {
    await endAllActive();
    await seedPromo("EVAL12A", "RETAIL", { benefitScope: "ORDER", percentBps: 1000, priority: 1 });
    await seedPromo("EVAL12B", "RETAIL", { benefitScope: "ORDER", percentBps: 2000, priority: 2 });
    const input = {
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    } as const;
    const first = await evaluate.evaluate(JSON.parse(JSON.stringify(input)));
    const second = await evaluate.evaluate(JSON.parse(JSON.stringify(input)));
    expect(first).toEqual(second);
    const a = first.appliedPromotions.find((row) => row.promotionCode === "EVAL12A");
    const b = first.appliedPromotions.find((row) => row.promotionCode === "EVAL12B");
    // 10% of 10000 = 1000; then 20% of the remaining 9000 = 1800.
    expect(a?.discountAmount).toBe("1000");
    expect(b?.discountAmount).toBe("1800");
    // Totals must equal the sum of parts exactly once (no double counting).
    expect(first.totalDiscount).toBe("2800");
    expect(first.orderDiscount).toBe("2800");
    expect(first.lineDiscounts).toEqual({ l1: "0" });
    expect(first.grandTotal).toBe("7200");
  });

  it("allocates order discounts across lines with lineId-ordered remainders", async () => {
    await endAllActive();
    await seedPromo("EVAL13", "RETAIL", {
      benefitType: "FIXED_AMOUNT_DISCOUNT", benefitScope: "ORDER", percentBps: null, amount: "7",
    });
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [
        { lineId: "a", productId: "prod_a", quantity: 1, unitPrice: "5" },
        { lineId: "b", productId: "prod_a", quantity: 1, unitPrice: "5" },
        { lineId: "c", productId: "prod_a", quantity: 1, unitPrice: "5" },
      ],
    });
    expect(result.appliedPromotions).toHaveLength(1);
    // floor(7*5/15)=2 each, remainder 1 goes to the first lineId.
    expect(result.appliedPromotions[0].allocatedLines).toEqual({ a: "3", b: "2", c: "2" });
  });

  it("exclusive promotions win alone; everything else conflicts deterministically", async () => {
    await endAllActive();
    const x = await seedPromo("EVAL14X", "RETAIL", { benefitScope: "ORDER", percentBps: 500, stackingPolicy: "EXCLUSIVE", priority: 5 });
    const y = await seedPromo("EVAL14Y", "RETAIL", { benefitScope: "ORDER", percentBps: 9000, stackingPolicy: "EXCLUSIVE", priority: 1 });
    await seedPromo("EVAL14S", "RETAIL", { benefitScope: "ORDER", percentBps: 100, priority: 0 });
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    });
    // Priority decides, never "biggest discount": EVAL14Y (priority 1) wins.
    expect(result.appliedPromotions.map((row) => row.promotionCode)).toEqual(["EVAL14Y"]);
    const byId = new Map(result.rejectedPromotions.map((row) => [row.promotionId, row.reason]));
    expect(byId.get(x.promo.id)).toBe("EXCLUSIVE_CONFLICT");
    expect([...byId.values()].filter((reason) => reason === "EXCLUSIVE_CONFLICT")).toHaveLength(2);
    expect(y.promo.id).not.toBe(x.promo.id);
  });

  it("enforces eligibility gates with stable reasons", async () => {
    await endAllActive();
    const seeded = await seedPromo("EVAL15", "RETAIL", { benefitScope: "ORDER", percentBps: 1000 }, [
      { targetType: "MIN_SUBTOTAL", valueAmount: "50000" },
      { targetType: "MIN_QUANTITY", valueQuantity: 10 },
    ]);
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    });
    expect(result.appliedPromotions).toHaveLength(0);
    expect(result.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("MIN_SUBTOTAL_NOT_MET");
  });

  it("fails closed when an owner reference disappears after publish", async () => {
    await endAllActive();
    state.products.set("prod_ghost", { categoryId: "cat_a" });
    const seeded = await seedPromo("EVAL16", "RETAIL", { percentBps: 1000 }, [{ targetType: "PRODUCT", valueText: "prod_ghost" }]);
    state.products.delete("prod_ghost");
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    });
    expect(result.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("NO_MATCHING_LINES");
    expect(result.appliedPromotions).toHaveLength(0);
  });

  it("keeps channels isolated: retail promos never leak into wholesale baskets", async () => {
    await endAllActive();
    const seeded = await seedPromo("EVAL17", "RETAIL", { percentBps: 1000 });
    const result = await evaluate.evaluate({
      channel: "WHOLESALE", priceBasis: basis(), now: NOW, actor: wholesaleActor(),
      lines: [{ lineId: "w1", productId: "prod_a", offerId: "offer_a", variantId: "var_a", quantity: 2, unitPrice: "25000" }],
    });
    expect(result.appliedPromotions.find((row) => row.promotionId === seeded.promo.id)).toBeUndefined();
    expect(result.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)).toBeUndefined();
  });

  it("requires a server-resolved price basis and rejects caller attestation", async () => {
    await endAllActive();
    await expect(evaluate.evaluate({
      channel: "RETAIL", now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100" }],
    } as any)).rejects.toMatchObject({ code: "PROMOTION_PRICE_BASIS_REJECTED" });
    await expect(evaluate.evaluate({
      channel: "RETAIL", priceBasis: { kind: "CALLER_ATTESTED", resolvedBy: "browser", reference: null }, now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100" }],
    } as any)).rejects.toMatchObject({ code: "PROMOTION_PRICE_BASIS_REJECTED" });
  });

  it("re-resolves wholesale base prices and fails closed on any mismatch", async () => {
    await endAllActive();
    await seedPromo("EVAL18", "WHOLESALE", { benefitScope: "ORDER", percentBps: 1000 });
    const good = await evaluate.evaluate({
      channel: "WHOLESALE", priceBasis: basis(), now: NOW, actor: wholesaleActor(),
      lines: [{ lineId: "w1", productId: "prod_a", offerId: "offer_a", variantId: "var_a", quantity: 2, unitPrice: "25000" }],
    });
    expect(good.priceAuthority).toBe("OWNER_RESOLVED");
    expect(good.appliedPromotions).toHaveLength(1);
    expect(good.appliedPromotions[0].discountAmount).toBe("5000");
    await expect(evaluate.evaluate({
      channel: "WHOLESALE", priceBasis: basis(), now: NOW, actor: wholesaleActor(),
      lines: [{ lineId: "w1", productId: "prod_a", offerId: "offer_a", variantId: "var_a", quantity: 2, unitPrice: "1" }],
    })).rejects.toMatchObject({ code: "PROMOTION_PRICE_MISMATCH" });
  });

  it("flags retail evaluations as caller-attested transition, never silently authoritative", async () => {
    await endAllActive();
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    });
    expect(result.priceAuthority).toBe("CALLER_ATTESTED_RETAIL_TRANSITION");
  });

  it("rejects malformed money, overflow, and hostile line shapes", async () => {
    await endAllActive();
    const line = (over: Record<string, unknown>) => ({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(), lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100", ...over }],
    });
    await expect(evaluate.evaluate(line({ unitPrice: "abc" }) as any)).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(evaluate.evaluate(line({ unitPrice: "-5" }) as any)).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(evaluate.evaluate(line({ unitPrice: "99999999999999999999999" }) as any)).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(evaluate.evaluate(line({ quantity: 0 }) as any)).rejects.toMatchObject({ code: "PROMOTION_EVALUATION_INVALID" });
    await expect(evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [
        { lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100" },
        { lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100" },
      ],
    })).rejects.toMatchObject({ code: "PROMOTION_EVALUATION_INVALID" });
    await expect(evaluate.evaluate(line({ lineId: "__proto__" }) as any)).rejects.toMatchObject({ code: "PROMOTION_EVALUATION_INVALID" });
    await expect(evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: { kind: "RETAIL_CUSTOMER", userId: "u1", accountId: "acc_x" },
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "100" }],
    })).rejects.toMatchObject({ code: "PROMOTION_ACTOR_INVALID" });
  });

  it("honours VIP plan targets through owner services", async () => {
    await endAllActive();
    state.vip = { planId: "plan_gold", accountId: "acc_9" };
    const seeded = await seedPromo("EVAL19", "WHOLESALE", { benefitScope: "ORDER", percentBps: 1000 }, [{ targetType: "VIP_PLAN", valueText: "plan_gold" }]);
    const match = await evaluate.evaluate({
      channel: "WHOLESALE", priceBasis: basis(), now: NOW, actor: wholesaleActor(),
      lines: [{ lineId: "w1", productId: "prod_a", offerId: "offer_a", variantId: "var_a", quantity: 1, unitPrice: "25000" }],
    });
    expect(match.appliedPromotions.find((row) => row.promotionId === seeded.promo.id)).toBeDefined();
    state.vip = { planId: "plan_silver", accountId: "acc_9" };
    const miss = await evaluate.evaluate({
      channel: "WHOLESALE", priceBasis: basis(), now: NOW, actor: wholesaleActor(),
      lines: [{ lineId: "w1", productId: "prod_a", offerId: "offer_a", variantId: "var_a", quantity: 1, unitPrice: "25000" }],
    });
    expect(miss.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("VIP_PLAN_MISMATCH");
    state.vip = null;
  });

  it("applies free shipping against an explicit shipping base only", async () => {
    await endAllActive();
    const seeded = await seedPromo("EVAL20", "RETAIL", { benefitType: "FREE_SHIPPING", benefitScope: "SHIPPING", percentBps: null });
    const without = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
    });
    expect(without.rejectedPromotions.find((row) => row.promotionId === seeded.promo.id)?.reason).toBe("SHIPPING_CONTEXT_MISSING");
    const withShip = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
      shippingBase: "50000",
    });
    const ship = withShip.appliedPromotions.find((row) => row.promotionId === seeded.promo.id);
    expect(ship?.discountAmount).toBe("50000");
    expect(withShip.shippingDiscount).toBe("50000");
  });

  it("evaluation is side-effect free across promotion tables", async () => {
    await endAllActive();
    await seedPromo("EVAL21", "RETAIL", { percentBps: 1000 });
    const count = async (table: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
    const usageBefore = await count("promotion_usage");
    const redemptionBefore = await count("promotion_coupon_redemption");
    const couponBefore = await pool.query(`SELECT coalesce(sum(used_count), 0)::int AS n FROM promotion_coupon`);
    const revisionBefore = await pool.query(`SELECT id, updated_at FROM promotion_revision ORDER BY id`);
    await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
      couponCodes: ["NOPE"],
    });
    expect(await count("promotion_usage")).toBe(usageBefore);
    expect(await count("promotion_coupon_redemption")).toBe(redemptionBefore);
    const couponAfter = await pool.query(`SELECT coalesce(sum(used_count), 0)::int AS n FROM promotion_coupon`);
    expect(couponAfter.rows[0].n).toBe(couponBefore.rows[0].n);
    const revisionAfter = await pool.query(`SELECT id, updated_at FROM promotion_revision ORDER BY id`);
    expect(revisionAfter.rows).toEqual(revisionBefore.rows);
  });

  it("reports unmatched coupons with stable reasons", async () => {
    await endAllActive();
    const result = await evaluate.evaluate({
      channel: "RETAIL", priceBasis: basis(), now: NOW, actor: retailActor(),
      lines: [{ lineId: "l1", productId: "prod_a", quantity: 1, unitPrice: "10000" }],
      couponCodes: ["GHOST-1"],
    });
    expect(result.unmatchedCouponCodes).toEqual([{ code: "GHOST-1", reason: "COUPON_UNKNOWN" }]);
  });
});
