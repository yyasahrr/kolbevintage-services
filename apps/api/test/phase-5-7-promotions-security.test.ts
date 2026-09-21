import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionSchedulerService } from "../src/modules/promotions/promotion-scheduler.service";
import { PromotionOwnerFactsProvider } from "../src/modules/promotions/promotion-facts.provider";
import { ADMIN_PERMISSION_KEY, AdminPermissionGuard } from "../src/modules/admin/admin-rbac.guard";
import { AdminPromotionsController } from "../src/modules/promotions/admin-promotions.controller";
import { ADMIN_PERMISSION_ACTIONS } from "@kolbe/database";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_promotions_security_test";
const ADMIN = "p57_admin";

let pool: Pool;
let promotions: PromotionService;
let scheduler: PromotionSchedulerService;

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
const jobLock = { withSessionLock: async (_key: string, fn: () => Promise<unknown>) => ({ executed: true as const, result: await fn() }) };

function futureIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function seedScheduledPromo(code: string) {
  const promo = await promotions.createPromotion(ADMIN, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, ADMIN, {
    benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000, stackingPolicy: "STACKABLE",
  });
  await promotions.submitForReview(promo.id, ADMIN);
  return { promo, revision };
}

describe("Phase 5.7 scheduler durability, identity, and RBAC", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    promotions = new PromotionService(db as any, facts as any, audit as any);
    scheduler = new PromotionSchedulerService(db as any, audit as any, jobLock as any, promotions as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("applies a due activation exactly once under concurrent workers", async () => {
    const { promo, revision } = await seedScheduledPromo("SEC10");
    const created = await promotions.scheduleActivation(promo.id, ADMIN, {
      revisionId: revision.id, runAt: futureIso(60), idempotencyKey: "sec_sched_10",
    });
    // Force due without waiting for the run_at.
    await pool.query(`UPDATE promotion_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`, [created.schedule.id]);
    const [first, second] = await Promise.all([scheduler.processDueSchedules(), scheduler.processDueSchedules()]);
    const appliedCount = [...first, ...second].filter((row) => row.applied).length;
    expect(appliedCount).toBe(1);
    const live = await promotions.getPromotion(promo.id);
    expect(live.status).toBe("ACTIVE");
    const rows = await pool.query(`SELECT status, attempts FROM promotion_schedule WHERE id = $1`, [created.schedule.id]);
    expect(rows.rows[0].status).toBe("DONE");
    expect(rows.rows[0].attempts).toBe(1);
  });

  it("never activates stale terms: revision drift fails the schedule, then parks it", async () => {
    const { promo, revision } = await seedScheduledPromo("SEC11");
    const created = await promotions.scheduleActivation(promo.id, ADMIN, {
      revisionId: revision.id, runAt: futureIso(60), idempotencyKey: "sec_sched_11",
    });
    // Terms change after scheduling: the scheduled revision is no longer current.
    const next = await promotions.createRevision(promo.id, ADMIN, {
      benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 2000, stackingPolicy: "STACKABLE",
    });
    await promotions.publishRevision(next.id, ADMIN);
    await pool.query(`UPDATE promotion_schedule SET run_at = now() - interval '1 minute' WHERE id = $1`, [created.schedule.id]);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await scheduler.processDueSchedules();
    }
    const rows = await pool.query(`SELECT status, attempts, last_error FROM promotion_schedule WHERE id = $1`, [created.schedule.id]);
    expect(rows.rows[0].status).toBe("FAILED");
    expect(rows.rows[0].attempts).toBe(5);
    expect(String(rows.rows[0].last_error)).toMatch(/no longer|stale|changed/i);
    const promoRow = await promotions.getPromotion(promo.id);
    expect(promoRow.status).not.toBe("ACTIVE");
    expect(promoRow.currentPublishedRevisionId).toBe(next.id);
  });

  it("recovers crashed scheduler claims and finishes the work", async () => {
    const { promo, revision } = await seedScheduledPromo("SEC12");
    const created = await promotions.scheduleActivation(promo.id, ADMIN, {
      revisionId: revision.id, runAt: futureIso(60), idempotencyKey: "sec_sched_12",
    });
    // Simulate a worker that claimed the row and died 20 minutes ago.
    await pool.query(
      `UPDATE promotion_schedule SET status = 'CLAIMED', claimed_by = 'dead-worker', claimed_at = now() - interval '20 minutes', run_at = now() - interval '1 minute' WHERE id = $1`,
      [created.schedule.id],
    );
    const recovered = await scheduler.recoverStaleClaims(15);
    expect(recovered.map((row) => row.id)).toContain(created.schedule.id);
    const results = await scheduler.processDueSchedules();
    expect(results.find((row) => row.id === created.schedule.id)?.applied).toBe(true);
    const live = await promotions.getPromotion(promo.id);
    expect(live.status).toBe("ACTIVE");
  });

  it("replays concurrent same-key schedule creation instead of duplicating", async () => {
    const { promo, revision } = await seedScheduledPromo("SEC13");
    const input = { revisionId: revision.id, runAt: futureIso(60), idempotencyKey: "sec_sched_13" };
    const [first, second] = await Promise.all([
      promotions.scheduleActivation(promo.id, ADMIN, input),
      promotions.scheduleActivation(promo.id, ADMIN, input),
    ]);
    expect(first.schedule.id).toBe(second.schedule.id);
    expect([first.replayed, second.replayed].filter(Boolean)).toHaveLength(1);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM promotion_schedule WHERE promotion_id = $1`, [promo.id]);
    expect(rows.rows[0].n).toBe(1);
  });

  it("rejects cross-account VIP facts instead of letting callers spoof membership", async () => {
    const vip = { getWholesaleAccountForOrder: async () => ({ id: "acc_9", userId: "intruder", status: "ACTIVE" }) };
    const provider = new PromotionOwnerFactsProvider({} as any, {} as any, {} as any, vip as any, {} as any, {} as any, {} as any, {} as any);
    await expect(provider.getVipFacts("acc_9", "victim")).rejects.toMatchObject({ code: "PROMOTION_VIP_IDENTITY_MISMATCH" });
    // Unknown accounts resolve to null (no membership), never to someone else's facts.
    const missing = { getWholesaleAccountForOrder: async () => { const error = new Error("missing") as Error & { code?: string }; error.code = "NOT_FOUND"; throw error; } };
    const providerMissing = new PromotionOwnerFactsProvider({} as any, {} as any, {} as any, missing as any, {} as any, {} as any, {} as any, {} as any);
    await expect(providerMissing.getVipFacts("ghost", "ghost-user")).resolves.toBeNull();
  });

  it("registers promotion actions and enforces them through the existing guard", async () => {
    for (const action of ["promotion:view", "promotion:create", "promotion:edit", "promotion:publish", "promotion:pause", "promotion:coupon:manage"]) {
      expect(ADMIN_PERMISSION_ACTIONS).toContain(action);
    }
    const reflector = new Reflector();
    const seen: Array<{ actor: string; permission: string }> = [];
    const rbac = {
      assertPermission: async (actor: string, permission: string) => {
        seen.push({ actor, permission });
        if (actor !== ADMIN) {
          const error = new Error("forbidden") as Error & { status?: number };
          error.status = 403;
          throw error;
        }
      },
    };
    const guard = new AdminPermissionGuard(reflector, rbac as any);
    const contextFor = (actor: string | null) => ({
      getHandler: () => AdminPromotionsController.prototype.createPromotion,
      getClass: () => AdminPromotionsController,
      switchToHttp: () => ({ getRequest: () => ({ claims: actor ? { sub: actor } : undefined }) }),
    }) as any;
    // The route carries explicit permission metadata.
    expect(reflector.get(ADMIN_PERMISSION_KEY, AdminPromotionsController.prototype.createPromotion)).toBe("promotion:create");
    await expect(guard.canActivate(contextFor(ADMIN))).resolves.toBe(true);
    expect(seen).toEqual([{ actor: ADMIN, permission: "promotion:create" }]);
    await expect(guard.canActivate(contextFor("mallory"))).rejects.toMatchObject({ status: 403 });
    await expect(guard.canActivate(contextFor(null))).resolves.toBe(false);
  });
});
