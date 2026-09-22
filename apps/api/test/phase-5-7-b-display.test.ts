import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { CmsPromotionReferenceService } from "../src/modules/cms/cms-promotion-reference.service";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_b_display_test";
const ADMIN = "p57b_admin";

let pool: Pool;
let promotions: PromotionService;
let references: CmsPromotionReferenceService;

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

async function seedPromo(code: string, terms: Record<string, unknown> = {}) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: `Display ${code}`, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1500, stackingPolicy: "STACKABLE",
    startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z", ...terms,
  });
  await promotions.publishRevision(revision.id, ADMIN);
  await promotions.submitForReview(promo.id, ADMIN);
  await promotions.activate(promo.id, ADMIN);
  return { promo, revision };
}

describe("Phase 5.7-B campaign display state and CMS reference resolution", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    promotions = new PromotionService(db as any, facts as any, audit as any);
    references = new CmsPromotionReferenceService(promotions as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("exposes display-active campaigns with their window and benefit shape", async () => {
    await seedPromo("DSP10");
    const state = await promotions.getPromotionDisplayState("DSP10", "2026-06-15T12:00:00.000Z");
    expect(state).toEqual({
      code: "DSP10",
      title: "Display DSP10",
      channel: "RETAIL",
      status: "ACTIVE",
      displayActive: true,
      window: { startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z" },
      benefit: {
        type: "PERCENT_DISCOUNT",
        scope: "ORDER",
        percentBps: 1500,
        amount: null,
        couponRequired: false,
        inWindow: true,
      },
    });
  });

  it("gates display on lifecycle status and the revision window", async () => {
    await seedPromo("DSP11", { startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-31T00:00:00.000Z" });
    const before = await promotions.getPromotionDisplayState("DSP11", "2026-06-15T12:00:00.000Z");
    expect(before?.benefit?.inWindow).toBe(false);
    expect(before?.displayActive).toBe(false);
    const during = await promotions.getPromotionDisplayState("DSP11", "2026-08-15T12:00:00.000Z");
    expect(during?.displayActive).toBe(true);

    const { promo } = await seedPromo("DSP12");
    await promotions.end(promo.id, ADMIN);
    const ended = await promotions.getPromotionDisplayState("DSP12", "2026-06-15T12:00:00.000Z");
    expect(ended?.status).toBe("ENDED");
    expect(ended?.benefit?.inWindow).toBe(true);
    expect(ended?.displayActive).toBe(false);
  });

  it("returns inactive state without benefit for unpublished campaigns", async () => {
    const promo = await promotions.createPromotion(ADMIN, { code: "DSP13", title: "Draft", channel: "RETAIL" });
    await promotions.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000, stackingPolicy: "STACKABLE",
    });
    const state = await promotions.getPromotionDisplayState("DSP13");
    expect(state?.displayActive).toBe(false);
    expect(state?.benefit).toBeNull();
    expect(state?.window).toEqual({ startsAt: null, endsAt: null });
  });

  it("renders fixed and shipping benefits as decimal-safe display facts", async () => {
    await seedPromo("DSP14", { benefitType: "FIXED_AMOUNT_DISCOUNT", percentBps: null, amount: "25000" });
    const fixed = await promotions.getPromotionDisplayState("DSP14", "2026-06-15T12:00:00.000Z");
    expect(fixed?.benefit).toMatchObject({ type: "FIXED_AMOUNT_DISCOUNT", percentBps: null, amount: "25000" });
    await seedPromo("DSP15", { benefitType: "FREE_SHIPPING", benefitScope: "SHIPPING", percentBps: null });
    const ship = await promotions.getPromotionDisplayState("DSP15", "2026-06-15T12:00:00.000Z");
    expect(ship?.benefit).toMatchObject({ type: "FREE_SHIPPING", scope: "SHIPPING", amount: null });
  });

  it("leaks no eligibility or actor surface: the key set is fixed", async () => {
    await seedPromo("DSP16");
    const state = await promotions.getPromotionDisplayState("DSP16", "2026-06-15T12:00:00.000Z");
    expect(Object.keys(state ?? {}).sort()).toEqual(
      ["benefit", "channel", "code", "displayActive", "status", "title", "window"].sort(),
    );
    expect(Object.keys(state?.benefit ?? {}).sort()).toEqual(
      ["amount", "couponRequired", "inWindow", "percentBps", "scope", "type"].sort(),
    );
    const serialized = JSON.stringify(state);
    expect(serialized).not.toMatch(/actor|eligib|usage|target|segment|vip/i);
  });

  it("resolves unknown codes to null and rejects malformed codes loudly", async () => {
    await expect(promotions.getPromotionDisplayState("DSP_NOPE")).resolves.toBeNull();
    await expect(promotions.getPromotionDisplayState("nope")).rejects.toMatchObject({ code: "PROMOTION_CODE_INVALID" });
    await expect(promotions.getPromotionDisplayState("DSP10; DROP")).rejects.toMatchObject({ code: "PROMOTION_CODE_INVALID" });
  });

  it("resolves CMS references totally: found, missing, and malformed", async () => {
    await seedPromo("DSP17");
    const found = await references.resolveReference("DSP17");
    expect(found.found).toBe(true);
    expect(found.display?.displayActive).toBe(true);
    const missing = await references.resolveReference("DSP_MISSING");
    expect(missing).toEqual({ code: "DSP_MISSING", found: false, display: null });
    // Render paths never throw: malformed content resolves to not-found.
    const malformed = await references.resolveReference("bad code!!");
    expect(malformed).toEqual({ code: "bad code!!", found: false, display: null });
    const nonString = await references.resolveReference(42);
    expect(nonString.found).toBe(false);
  });

  it("resolves reference batches with dedupe and a hard cap", async () => {
    await seedPromo("DSP18");
    const batch = await references.resolveReferences(["DSP18", "DSP_MISSING", "DSP18", "bad code!!"]);
    expect(batch.map((row) => row.code)).toEqual(["DSP18", "DSP_MISSING", "bad code!!"]);
    expect(batch.map((row) => row.found)).toEqual([true, false, false]);
    await expect(references.resolveReferences("DSP18")).resolves.toEqual([]);
    const many = await references.resolveReferences(Array.from({ length: 25 }, (_, index) => `DSP_MISSING_${index}`));
    expect(many).toHaveLength(20);
  });
});
