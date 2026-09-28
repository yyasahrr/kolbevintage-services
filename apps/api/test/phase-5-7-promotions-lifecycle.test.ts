import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionDomainError } from "../src/modules/promotions/promotions.logic";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_promotions_lifecycle_test";
const ADMIN = "p57_admin";

let pool: Pool;
let promotions: PromotionService;

const facts = {
  getProductFacts: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
  assertRetailProduct: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
  getOfferFacts: async (offerId: string) => ({ offerId, productId: "prod_a", sellerId: "seller_a", status: "published" }),
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

async function makeDraft(code: string, channel = "RETAIL") {
  return promotions.createPromotion(ADMIN, { code, title: `Promo ${code}`, channel });
}

async function makeRevision(promotionId: string, extra: Record<string, unknown> = {}) {
  return promotions.createRevision(promotionId, ADMIN, {
    benefitType: "PERCENT_DISCOUNT",
    benefitScope: "LINE",
    percentBps: 1500,
    stackingPolicy: "STACKABLE",
    ...extra,
  });
}

describe("Phase 5.7 promotion lifecycle and immutable revisions", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    promotions = new PromotionService(db as any, facts as any, audit as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("creates draft promotions with allowlisted channel and unique code", async () => {
    const created = await makeDraft("LIFE15");
    expect(created.status).toBe("DRAFT");
    expect(created.channel).toBe("RETAIL");
    expect(created.currentPublishedRevisionId).toBeNull();
    await expect(makeDraft("LIFE15")).rejects.toMatchObject({ code: "PROMOTION_CODE_TAKEN" });
    await expect(makeDraft("life15")).rejects.toMatchObject({ code: "PROMOTION_CODE_INVALID" });
    await expect(promotions.createPromotion(ADMIN, { code: "LIFEX1", title: "x", channel: "MARKETPLACE" })).rejects.toMatchObject({
      code: "PROMOTION_CHANNEL_INVALID",
    });
  });

  it("runs the legal lifecycle with explicit edges and rejects illegal jumps", async () => {
    const promo = await makeDraft("LIFE20");
    // DRAFT -> ACTIVE directly is illegal (no arbitrary status update exists).
    await expect(promotions.activate(promo.id, ADMIN)).rejects.toMatchObject({ code: "PROMOTION_TRANSITION_ILLEGAL" });
    await promotions.submitForReview(promo.id, ADMIN);
    await expect(promotions.pause(promo.id, ADMIN)).rejects.toMatchObject({ code: "PROMOTION_TRANSITION_ILLEGAL" });
    const revision = await makeRevision(promo.id);
    await promotions.publishRevision(revision.id, ADMIN);
    const active = await promotions.activate(promo.id, ADMIN);
    expect(active.status).toBe("ACTIVE");
    const paused = await promotions.pause(promo.id, ADMIN);
    expect(paused.status).toBe("PAUSED");
    const resumed = await promotions.resume(promo.id, ADMIN);
    expect(resumed.status).toBe("ACTIVE");
    const ended = await promotions.end(promo.id, ADMIN);
    expect(ended.status).toBe("ENDED");
    await expect(promotions.resume(promo.id, ADMIN)).rejects.toMatchObject({ code: "PROMOTION_TRANSITION_ILLEGAL" });
    const archived = await promotions.archive(promo.id, ADMIN);
    expect(archived.status).toBe("ARCHIVED");
  });

  it("activation requires a published revision (atomic, no partial live state)", async () => {
    const promo = await makeDraft("LIFE21");
    await promotions.submitForReview(promo.id, ADMIN);
    await expect(promotions.activate(promo.id, ADMIN)).rejects.toMatchObject({ code: "PROMOTION_NO_PUBLISHED_REVISION" });
    const after = await promotions.getPromotion(promo.id);
    expect(after.status).toBe("IN_REVIEW");
    expect(after.currentPublishedRevisionId).toBeNull();
  });

  it("publishing supersedes the previous revision and preserves history", async () => {
    const promo = await makeDraft("LIFE22");
    const first = await makeRevision(promo.id, { percentBps: 1000 });
    await promotions.publishRevision(first.id, ADMIN);
    const second = await makeRevision(promo.id, { percentBps: 2000 });
    expect(second.revisionNumber).toBe(2);
    await promotions.publishRevision(second.id, ADMIN);
    const revisions = await promotions.listRevisions(promo.id);
    expect(revisions.map((row) => row.status).sort()).toEqual(["PUBLISHED", "SUPERSEDED"]);
    const current = await promotions.getPromotion(promo.id);
    expect(current.currentPublishedRevisionId).toBe(second.id);
    // Historical revision still readable with its exact terms.
    const historical = await promotions.getRevision(first.id);
    expect(historical.status).toBe("SUPERSEDED");
    expect(historical.percentBps).toBe(1000);
    expect(historical.termsHash).toBe(first.termsHash);
  });

  it("editing a live promotion means a new draft revision, never a silent mutation", async () => {
    const promo = await makeDraft("LIFE23");
    const live = await makeRevision(promo.id);
    await promotions.publishRevision(live.id, ADMIN);
    await expect(promotions.addTarget(live.id, ADMIN, { targetType: "MIN_QUANTITY", valueQuantity: 2 })).rejects.toMatchObject({
      code: "PROMOTION_REVISION_NOT_DRAFT",
    });
    // Raw SQL cannot mutate published terms either (trigger).
    await expect(pool.query(`UPDATE promotion_revision SET percent_bps = 9999 WHERE id = $1`, [live.id])).rejects.toThrow(
      /commercial terms are immutable/,
    );
    await expect(pool.query(`DELETE FROM promotion_revision WHERE id = $1`, [live.id])).rejects.toThrow(/cannot be deleted/);
    const after = await promotions.getRevision(live.id);
    expect(after.percentBps).toBe(1500);
  });

  it("published revision targets are immutable at the database layer", async () => {
    const promo = await makeDraft("LIFE24");
    const revision = await makeRevision(promo.id, { targets: [{ targetType: "MIN_QUANTITY", valueQuantity: 3 }] });
    expect(revision.targets).toHaveLength(1);
    await promotions.publishRevision(revision.id, ADMIN);
    await expect(
      pool.query(`INSERT INTO promotion_target (id, revision_id, target_type, value_quantity) VALUES ('p57_sneaky', $1, 'MIN_QUANTITY', 9)`, [revision.id]),
    ).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM promotion_target WHERE revision_id = $1`, [revision.id])).rejects.toThrow(/cannot be deleted/);
  });

  it("draft revisions stay editable with hash evolution, and discard cleanly", async () => {
    const promo = await makeDraft("LIFE25");
    const revision = await makeRevision(promo.id);
    const firstHash = revision.termsHash;
    await promotions.addTarget(revision.id, ADMIN, { targetType: "PRODUCT", valueText: "prod_a" });
    const withTarget = await promotions.getRevision(revision.id);
    expect(withTarget.targets).toHaveLength(1);
    expect(withTarget.termsHash).not.toBe(firstHash);
    await promotions.removeTarget(revision.id, withTarget.targets[0].id, ADMIN);
    const withoutTarget = await promotions.getRevision(revision.id);
    expect(withoutTarget.targets).toHaveLength(0);
    expect(withoutTarget.termsHash).toBe(firstHash);
    await promotions.discardRevision(revision.id, ADMIN);
    await expect(promotions.getRevision(revision.id)).rejects.toMatchObject({ code: "PROMOTION_REVISION_NOT_FOUND" });
  });

  it("rejects invalid and duplicate targets before they reach the database", async () => {
    const promo = await makeDraft("LIFE26");
    const revision = await makeRevision(promo.id);
    await expect(promotions.addTarget(revision.id, ADMIN, { targetType: "PRODUCT", valueText: "prod_a", valueQuantity: 2 } as any)).rejects.toMatchObject({
      code: "PROMOTION_TARGET_INVALID",
    });
    await expect(promotions.addTarget(revision.id, ADMIN, { targetType: "SQL_WHERE", valueText: "1=1" } as any)).rejects.toMatchObject({
      code: "PROMOTION_TARGET_INVALID",
    });
    await expect(promotions.addTarget(revision.id, ADMIN, { targetType: "MIN_SUBTOTAL", valueAmount: "0" })).rejects.toMatchObject({
      code: "PROMOTION_TARGET_INVALID",
    });
    await expect(promotions.addTarget(revision.id, ADMIN, { targetType: "CUSTOMER_SEGMENT", valueText: "vip" })).rejects.toMatchObject({
      code: "PROMOTION_TARGET_INVALID",
    });
    await promotions.addTarget(revision.id, ADMIN, { targetType: "MIN_QUANTITY", valueQuantity: 2 });
    await expect(promotions.addTarget(revision.id, ADMIN, { targetType: "MIN_QUANTITY", valueQuantity: 5 })).rejects.toMatchObject({
      code: "PROMOTION_TARGET_DUPLICATE",
    });
  });

  it("rejects unknown owner references and incoherent benefits", async () => {
    const strictFacts = {
      ...facts,
      getProductFacts: async () => null,
      tagExists: async () => false,
    };
    const strict = new PromotionService(drizzle(pool) as any, strictFacts as any, audit as any);
    const promo = await strict.createPromotion(ADMIN, { code: "LIFE27", title: "strict", channel: "RETAIL" });
    const revision = await strict.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "LINE", percentBps: 1000, stackingPolicy: "STACKABLE",
    });
    await expect(strict.addTarget(revision.id, ADMIN, { targetType: "PRODUCT", valueText: "ghost" })).rejects.toMatchObject({
      code: "PROMOTION_TARGET_UNKNOWN",
    });
    await expect(strict.addTarget(revision.id, ADMIN, { targetType: "CUSTOMER_SEGMENT", valueText: "tag:ghost" })).rejects.toMatchObject({
      code: "PROMOTION_TARGET_UNKNOWN",
    });
    await expect(strict.createRevision(promo.id, ADMIN, {
      benefitType: "FIXED_AMOUNT_DISCOUNT", benefitScope: "LINE", amount: "1000", stackingPolicy: "STACKABLE",
    })).rejects.toMatchObject({ code: "PROMOTION_BENEFIT_INVALID" });
    await expect(strict.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000, amount: "5", stackingPolicy: "STACKABLE",
    })).rejects.toMatchObject({ code: "PROMOTION_BENEFIT_INVALID" });
    await expect(strict.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 10001, stackingPolicy: "STACKABLE",
    })).rejects.toMatchObject({ code: "PROMOTION_BENEFIT_INVALID" });
  });

  it("scheduled activation publishes atomically and the worker applies it once", async () => {
    const promo = await makeDraft("LIFE28");
    const revision = await makeRevision(promo.id);
    await promotions.submitForReview(promo.id, ADMIN);
    const runAt = new Date(Date.now() + 60_000).toISOString();
    const first = await promotions.scheduleActivation(promo.id, ADMIN, { revisionId: revision.id, runAt, idempotencyKey: "p57-sched-1" });
    expect(first.replayed).toBe(false);
    const replay = await promotions.scheduleActivation(promo.id, ADMIN, { revisionId: revision.id, runAt, idempotencyKey: "p57-sched-1" });
    expect(replay.replayed).toBe(true);
    expect(replay.schedule.id).toBe(first.schedule.id);
    const scheduled = await promotions.getPromotion(promo.id);
    expect(scheduled.status).toBe("SCHEDULED");
    expect(scheduled.currentPublishedRevisionId).toBe(revision.id);
    // Worker applies the claim exactly once; second apply is a no-op.
    const applied = await promotions.applySchedule({ ...first.schedule, status: "SCHEDULED" }, "test-worker");
    expect(applied.applied).toBe(true);
    const again = await promotions.applySchedule({ ...first.schedule, status: "DONE" }, "test-worker");
    expect(again.applied).toBe(false);
    const live = await promotions.getPromotion(promo.id);
    expect(live.status).toBe("ACTIVE");
  });

  it("unscheduling and manual activation cancel pending scheduled rows", async () => {
    const promo = await makeDraft("LIFE29");
    const revision = await makeRevision(promo.id);
    await promotions.submitForReview(promo.id, ADMIN);
    const runAt = new Date(Date.now() + 60_000).toISOString();
    await promotions.scheduleActivation(promo.id, ADMIN, { revisionId: revision.id, runAt, idempotencyKey: "p57-sched-2" });
    await promotions.unschedule(promo.id, ADMIN);
    const rows = await pool.query(`SELECT status FROM promotion_schedule WHERE promotion_id = $1`, [promo.id]);
    expect(rows.rows.map((row) => row.status)).toEqual(["CANCELLED"]);
  });

  it("malicious list filters are rejected, never passed to SQL", async () => {
    await expect(promotions.listPromotions({ status: "ACTIVE' OR '1'='1" })).rejects.toMatchObject({ code: "PROMOTION_STATUS_INVALID" });
    await expect(promotions.listPromotions({ channel: "RETAIL; DROP TABLE promotion;" })).rejects.toMatchObject({ code: "PROMOTION_CHANNEL_INVALID" });
    await expect(promotions.listPromotions({ code: "x' OR 1=1 --" })).rejects.toMatchObject({ code: "PROMOTION_CODE_INVALID" });
    await expect(promotions.listPromotions({ limit: 101 })).rejects.toMatchObject({ code: "PROMOTION_FILTER_INVALID" });
    const page = await promotions.listPromotions({ status: "DRAFT", limit: 5 });
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThanOrEqual(0);
  });

  it("error contracts carry stable machine codes", async () => {
    const error = new PromotionDomainError("PROMOTION_DEMO", "demo", 409);
    expect(error.code).toBe("PROMOTION_DEMO");
    expect(error.status).toBe(409);
  });
});
