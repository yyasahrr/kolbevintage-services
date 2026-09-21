/**
 * Phase 5.7-A — Promotions adversarial security suite (real PostgreSQL).
 *
 * Twelve attack groups against the promotion write surfaces, the commit
 * ledger, and the evaluation boundary. Every group runs against a real
 * database; failures must be fail-closed domain errors, never raw driver
 * errors, silent coercions, or partial writes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionRevisionService } from "../src/modules/promotions/promotion-revision.service";
import { PromotionEligibilityService } from "../src/modules/promotions/promotion-eligibility.service";
import { PromotionEvaluationService } from "../src/modules/promotions/promotion-evaluation.service";
import { PromotionFactsService } from "../src/modules/promotions/promotion-facts.service";
import { CouponService } from "../src/modules/promotions/coupon.service";
import { PromotionUsageService } from "../src/modules/promotions/promotion-usage.service";
import { PromotionScheduleService } from "../src/modules/promotions/promotion-schedule.service";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { VipService } from "../src/modules/vip/vip.service";
import { WholesalePlanService } from "../src/modules/vip/wholesale-plan.service";
import { WholesaleMembershipService } from "../src/modules/vip/wholesale-membership.service";
import { CrmContactService } from "../src/modules/crm/crm-contact.service";
import { AdminApprovalsService } from "../src/modules/admin/admin-approvals.service";
import { JobLockService } from "../src/modules/recovery/job-lock.service";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_promotions_security_test";
const ADMIN = "p5s_admin";
const CHECKER = "p5s_checker";
const CUSTOMER = "p5s_customer";
const VIP_USER = "p5s_vipuser";
const adminActor = { userId: ADMIN, role: "admin" as const };
const customerActor = { userId: CUSTOMER, role: "customer" as const };
const vipActor = { userId: VIP_USER, role: "vip" as const };
const HASH = "d".repeat(64);

let pool: Pool;
let promotions: PromotionService;
let revisions: PromotionRevisionService;
let coupons: CouponService;
let usage: PromotionUsageService;
let schedules: PromotionScheduleService;
let evaluation: PromotionEvaluationService;
let approvals: AdminApprovalsService;

async function seed() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ('${ADMIN}', 'p5s-admin@test.invalid', 'hash', 'salt', 'admin', 'active'),
           ('${CHECKER}', 'p5s-checker@test.invalid', 'hash', 'salt', 'admin', 'active'),
           ('${CUSTOMER}', 'p5s-customer@test.invalid', 'hash', 'salt', 'customer', 'active'),
           ('${VIP_USER}', 'p5s-vipuser@test.invalid', 'hash', 'salt', 'vip', 'active')
  `);
  await pool.query(`INSERT INTO category (id, slug, name, status) VALUES ('p5s_cat', 'p5s-cat', 'P5S Category', 'active')`);
  await pool.query(`INSERT INTO product (id, name, slug, status, owner_type, category_id) VALUES ('p5s_prod', 'P5S Product', 'p5s-prod', 'published', 'KOLBE', 'p5s_cat')`);
  await pool.query(`INSERT INTO wholesale_plan (id, code, name, status) VALUES ('p5s_plan', 'P5S-GOLD', 'P5S Gold', 'active')`);
}

async function makeLivePromotion(key: string, terms: Parameters<PromotionRevisionService["createDraftRevision"]>[2], channel = "RETAIL") {
  const promo = await promotions.createPromotion(adminActor, { promotionKey: key, channel });
  const draft = await revisions.createDraftRevision(adminActor, promo.id, terms);
  await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
  return { promo, draft };
}

async function tableCounts(): Promise<Record<string, number>> {
  const tables = [
    "promotion",
    "promotion_revision",
    "promotion_target",
    "promotion_benefit",
    "promotion_coupon",
    "promotion_coupon_redemption",
    "promotion_usage",
    "promotion_schedule",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = rows.rows[0].n;
  }
  return counts;
}

describe("Phase 5.7 Promotions adversarial security", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await seed();
    const db = drizzle(pool);
    const audit = { record: async () => "p5s-audit" } as never;
    const catalog = new CatalogService(db as never, {} as never);
    const offers = new OffersService(db as never);
    const vip = new VipService(db as never, audit as never);
    const plans = new WholesalePlanService(db as never, audit as never);
    const memberships = new WholesaleMembershipService(db as never, audit as never);
    const crmContacts = new CrmContactService(db as never, audit as never);
    const eligibility = new PromotionEligibilityService(catalog, offers, vip, plans, crmContacts);
    approvals = new AdminApprovalsService(db as never, audit as never, plans, memberships, {} as never);
    revisions = new PromotionRevisionService(db as never, audit as never, approvals, eligibility);
    promotions = new PromotionService(db as never, audit as never, revisions);
    coupons = new CouponService(db as never, audit as never);
    usage = new PromotionUsageService(db as never, audit as never);
    const handle = { db: db as never, pool, close: async () => { await pool.end(); } };
    const jobLock = new JobLockService(db as never, handle as never);
    schedules = new PromotionScheduleService(db as never, audit as never, jobLock);
    const facts = new PromotionFactsService(catalog, offers, vip, memberships, crmContacts);
    evaluation = new PromotionEvaluationService(db as never, facts, usage);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("S1 denies every write surface to non-admin actors", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.RBAC", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    for (const actor of [customerActor, vipActor]) {
      await expect(promotions.createPromotion(actor, { promotionKey: "P5S.NEVER", channel: "RETAIL" })).rejects.toMatchObject({
        code: "PROMOTION_FORBIDDEN",
      });
      await expect(revisions.createDraftRevision(actor, promo.id, { benefits: [] })).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(revisions.createDraftFromPublished(actor, draft.revision.id)).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(revisions.replaceTerms(actor, draft.revision.id, { benefits: [] })).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(promotions.transition(actor, promo.id, "ARCHIVED")).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(promotions.publishAndActivate(actor, promo.id, draft.revision.id)).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(
        revisions.requestPublishApproval(actor, draft.revision.id, { idempotencyKey: "p5s-rbac-1" }),
      ).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(coupons.createCoupon(actor, promo.id, { code: "P5S-NEVER" })).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(coupons.updateCoupon(actor, "nope", { status: "DISABLED" })).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
      await expect(
        schedules.scheduleAction(actor, promo.id, { action: "ACTIVATE", scheduledAt: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "p5s-rbac-2" }),
      ).rejects.toMatchObject({ code: "PROMOTION_FORBIDDEN" });
    }
    // Nothing the attackers touched persisted.
    expect((await promotions.getPromotion(promo.id)).status).toBe("DRAFT");
    expect((await revisions.getRevision(draft.revision.id)).revision.status).toBe("DRAFT");
  });

  it("S2 rejects SQL-shaped input at the boundary and leaves storage intact", async () => {
    const payloads = ["x' OR '1'='1", "P5S'; DROP TABLE promotion;--", "a\"; SELECT 1--", "p5s`) /*", "../../promotion"];
    for (const payload of payloads) {
      await expect(promotions.createPromotion(adminActor, { promotionKey: payload, channel: "RETAIL" })).rejects.toThrow();
    }
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.SQLI", channel: "RETAIL" });
    for (const payload of payloads) {
      await expect(
        revisions.createDraftRevision(adminActor, promo.id, {
          targets: [{ targetType: "PRODUCT", referenceId: payload }],
          benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
        }),
      ).rejects.toThrow();
      await expect(coupons.createCoupon(adminActor, promo.id, { code: payload })).rejects.toThrow();
    }
    // Storage is untouched: all promotion tables still queryable and payload-free.
    const counts = await tableCounts();
    expect(counts.promotion).toBeGreaterThanOrEqual(1);
    const leaked = await pool.query(`SELECT count(*)::int AS n FROM promotion WHERE promotion_key LIKE '%DROP%' OR promotion_key LIKE '%OR %'`);
    expect(leaked.rows[0].n).toBe(0);
    const leakedCoupons = await pool.query(`SELECT count(*)::int AS n FROM promotion_coupon WHERE code LIKE '%DROP%' OR code LIKE '%OR %'`);
    expect(leakedCoupons.rows[0].n).toBe(0);
  });

  it("S3 holds the executable allowlist shut: no off-list target or benefit types", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.ALLOW", channel: "RETAIL" });
    const evilTypes = ["__proto__", "constructor", "prototype", "EVAL", "SCRIPT", "SQL", "LAMBDA", "FUNCTION", "eval", "droptable"];
    for (const targetType of evilTypes) {
      await expect(
        revisions.createDraftRevision(adminActor, promo.id, {
          targets: [{ targetType, referenceId: "p5s_prod" }],
          benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
        }),
      ).rejects.toThrow();
    }
    for (const benefitType of evilTypes) {
      await expect(
        revisions.createDraftRevision(adminActor, promo.id, {
          benefits: [{ benefitType, scope: "LINE", percentBps: 1000 }],
        }),
      ).rejects.toThrow();
    }
    await expect(promotions.createPromotion(adminActor, { promotionKey: "P5S.CHAN", channel: "ADMIN" })).rejects.toThrow();
    await expect(
      revisions.createDraftRevision(adminActor, promo.id, {
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "GLOBAL", percentBps: 1000 }],
      }),
    ).rejects.toThrow();
    // Prototype keys never land in storage as rows.
    const proto = await pool.query(`SELECT count(*)::int AS n FROM promotion_target WHERE target_type LIKE '%proto%' OR target_type LIKE '%constr%'`);
    expect(proto.rows[0].n).toBe(0);
    expect(Object.prototype.hasOwnProperty.call({}, "p5s")).toBe(false);
  });

  it("S4 clamps money and basis points: overflow, negatives, floats rejected", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.MONEY", channel: "RETAIL" });
    const fixed = (amount: unknown) =>
      revisions.createDraftRevision(adminActor, promo.id, {
        benefits: [{ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", amount }],
      });
    await expect(fixed("1000000000000001")).rejects.toMatchObject({ code: "PROMOTION_MONEY_OUT_OF_RANGE" });
    await expect(fixed("-5")).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(fixed("10.5")).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(fixed(10.5)).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(fixed("1e6")).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(fixed("﷼1000")).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(fixed("")).rejects.toThrow();
    // Boundary is inclusive: exactly MAX is storable.
    const edge = await fixed("1000000000000000");
    expect(edge.revision.revisionNumber).toBeGreaterThanOrEqual(1);
    const percent = (percentBps: unknown) =>
      revisions.createDraftRevision(adminActor, promo.id, {
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps }],
      });
    await expect(percent(0)).rejects.toThrow();
    await expect(percent(10001)).rejects.toMatchObject({ code: "PROMOTION_INVALID_INPUT" });
    await expect(percent(-100)).rejects.toThrow();
    await expect(percent(12.5)).rejects.toThrow();
    await expect(percent("all")).rejects.toThrow();
    // Commit path re-validates money independently of authoring.
    const live = await makeLivePromotion("P5S.MONEYC", {
      benefits: [{ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", amount: "1000" }],
    });
    const base = {
      promotionId: live.promo.id,
      revisionId: live.draft.revision.id,
      channel: "RETAIL",
      customerKey: `user:${CUSTOMER}`,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: HASH,
      idempotencyKey: "p5s-money-commit-1",
    };
    await expect(usage.commitUsage({ ...base, discountAmount: "10001" })).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(usage.commitUsage({ ...base, baseAmount: "-1" })).rejects.toMatchObject({ code: "PROMOTION_MONEY_INVALID" });
    await expect(usage.commitUsage({ ...base, evaluationHash: "not-a-hash" })).rejects.toMatchObject({ code: "PROMOTION_INVALID_INPUT" });
    await expect(usage.commitUsage({ ...base, evaluationHash: "C".repeat(64) })).rejects.toMatchObject({ code: "PROMOTION_INVALID_INPUT" });
  });

  it("S5 coupon identity is immutable and lookalikes collapse to one code", async () => {
    const live = await makeLivePromotion("P5S.COUPONID", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const first = await coupons.createCoupon(adminActor, live.promo.id, { code: "  p5s-lookalike " });
    expect(first.codeNormalized).toBe("P5S-LOOKALIKE");
    for (const lookalike of ["P5S-LOOKALIKE", "p5s-lookalike", "  P5S-LookAlike\t", "P5s-LookAlike"]) {
      await expect(coupons.createCoupon(adminActor, live.promo.id, { code: lookalike })).rejects.toMatchObject({
        code: "PROMOTION_COUPON_DUPLICATE",
      });
    }
    // Unicode confusables and inner whitespace are rejected, never folded into a collision.
    for (const confusable of ["P5S—LOOKALIKE", "P5S LOOKALIKE", "P5S‐LOOKALIKE"]) {
      await expect(coupons.createCoupon(adminActor, live.promo.id, { code: confusable })).rejects.toMatchObject({
        code: "PROMOTION_COUPON_INVALID",
      });
    }
    // Identity columns cannot be re-pointed through the update surface.
    const other = await makeLivePromotion("P5S.COUPONIDB", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    await coupons.updateCoupon(adminActor, first.id, { code: "P5S-HACKED", promotionId: other.promo.id, status: "ENABLED" } as never);
    const stored = await pool.query(`SELECT code, code_normalized, promotion_id FROM promotion_coupon WHERE id = $1`, [first.id]);
    expect(stored.rows[0].code).toBe(first.code);
    expect(stored.rows[0].code_normalized).toBe("P5S-LOOKALIKE");
    expect(stored.rows[0].promotion_id).toBe(live.promo.id);
  });

  it("S6 disabled, expired, and foreign coupons fail closed at commit", async () => {
    const live = await makeLivePromotion("P5S.COUPONUSE", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const commitFor = (couponId: string, key: string, promotionId = live.promo.id, revisionId = live.draft.revision.id) => ({
      couponId,
      promotionId,
      revisionId,
      channel: "RETAIL",
      customerKey: `user:${CUSTOMER}`,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: HASH,
      idempotencyKey: key,
    });
    const disabled = await coupons.createCoupon(adminActor, live.promo.id, { code: "P5S-OFF" });
    await coupons.updateCoupon(adminActor, disabled.id, { status: "DISABLED" });
    await expect(usage.commitCouponRedemption(commitFor(disabled.id, "p5s-coupon-disabled-1"))).rejects.toMatchObject({
      code: "PROMOTION_COUPON_DISABLED",
    });
    const expired = await coupons.createCoupon(adminActor, live.promo.id, {
      code: "P5S-OLD",
      startsAt: "2000-01-01T00:00:00.000Z",
      endsAt: "2001-01-01T00:00:00.000Z",
    });
    await expect(usage.commitCouponRedemption(commitFor(expired.id, "p5s-coupon-expired-1"))).rejects.toMatchObject({
      code: "PROMOTION_COUPON_EXPIRED",
    });
    const future = await coupons.createCoupon(adminActor, live.promo.id, {
      code: "P5S-FUTURE",
      startsAt: "2999-01-01T00:00:00.000Z",
    });
    await expect(usage.commitCouponRedemption(commitFor(future.id, "p5s-coupon-future-1"))).rejects.toMatchObject({
      code: "PROMOTION_COUPON_EXPIRED",
    });
    // A coupon minted for another promotion cannot be spent here.
    const foreign = await makeLivePromotion("P5S.FOREIGN", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const foreignCoupon = await coupons.createCoupon(adminActor, foreign.promo.id, { code: "P5S-FOREIGN" });
    await expect(usage.commitCouponRedemption(commitFor(foreignCoupon.id, "p5s-coupon-foreign-1"))).rejects.toMatchObject({
      code: "PROMOTION_NOT_FOUND",
    });
    await expect(
      usage.commitCouponRedemption(commitFor("no_such_coupon", "p5s-coupon-ghost-1")),
    ).rejects.toMatchObject({ code: "PROMOTION_NOT_FOUND" });
  });

  it("S7 usage and coupon limits are enforced per revision, customer, and coupon", async () => {
    const limited = await makeLivePromotion("P5S.LIMITS", {
      usageLimitTotal: 2,
      usageLimitPerCustomer: 1,
      benefits: [{ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", amount: "500" }],
    });
    const commitFor = (customerKey: string, key: string) => ({
      promotionId: limited.promo.id,
      revisionId: limited.draft.revision.id,
      channel: "RETAIL",
      customerKey,
      baseAmount: "10000",
      discountAmount: "500",
      evaluationHash: HASH,
      idempotencyKey: key,
    });
    const first = await usage.commitUsage(commitFor(`user:${CUSTOMER}`, "p5s-limits-a-1"));
    expect(first.replayed).toBe(false);
    // Same customer again: per-customer limit.
    await expect(usage.commitUsage(commitFor(`user:${CUSTOMER}`, "p5s-limits-a-2"))).rejects.toMatchObject({
      code: "PROMOTION_USAGE_LIMIT_EXCEEDED",
    });
    // A different customer consumes the second and final total unit.
    await usage.commitUsage(commitFor(`user:${VIP_USER}`, "p5s-limits-b-1"));
    await expect(usage.commitUsage(commitFor("user:p5s_third", "p5s-limits-c-1"))).rejects.toMatchObject({
      code: "PROMOTION_USAGE_LIMIT_EXCEEDED",
    });
    // Coupon-level per-customer cap.
    const coded = await makeLivePromotion("P5S.CAPON", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const capped = await coupons.createCoupon(adminActor, coded.promo.id, { code: "P5S-CAP1", perCustomerLimit: 1 });
    const codedCommit = (customerKey: string, key: string) => ({
      couponId: capped.id,
      promotionId: coded.promo.id,
      revisionId: coded.draft.revision.id,
      channel: "RETAIL",
      customerKey,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: HASH,
      idempotencyKey: key,
    });
    await usage.commitCouponRedemption(codedCommit(`user:${CUSTOMER}`, "p5s-capon-a-1"));
    await expect(usage.commitCouponRedemption(codedCommit(`user:${CUSTOMER}`, "p5s-capon-a-2"))).rejects.toMatchObject({
      code: "PROMOTION_COUPON_LIMIT_EXCEEDED",
    });
    await usage.commitCouponRedemption(codedCommit(`user:${VIP_USER}`, "p5s-capon-b-1"));
  });

  it("S8 idempotent replays never double-count, even after limits are spent", async () => {
    const live = await makeLivePromotion("P5S.REPLAY", {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const coupon = await coupons.createCoupon(adminActor, live.promo.id, { code: "P5S-ONCE", usageLimit: 1 });
    const commit = {
      couponId: coupon.id,
      promotionId: live.promo.id,
      revisionId: live.draft.revision.id,
      channel: "RETAIL",
      customerKey: `user:${CUSTOMER}`,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: HASH,
      idempotencyKey: "p5s-replay-winner-1",
    };
    const won = await usage.commitCouponRedemption(commit);
    expect(won.replayed).toBe(false);
    // A fresh key now loses the spent limit...
    await expect(usage.commitCouponRedemption({ ...commit, idempotencyKey: "p5s-replay-loser-1" })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_LIMIT_EXCEEDED",
    });
    // ...but the winner's key replays successfully and returns the same row.
    const replay = await usage.commitCouponRedemption(commit);
    expect(replay.replayed).toBe(true);
    expect(replay.redemption.id).toBe(won.redemption.id);
    const stored = await pool.query(`SELECT redeemed_count FROM promotion_coupon WHERE id = $1`, [coupon.id]);
    expect(Number(stored.rows[0].redeemed_count)).toBe(1);
    const redemptions = await pool.query(`SELECT count(*)::int AS n FROM promotion_coupon_redemption WHERE coupon_id = $1`, [coupon.id]);
    expect(redemptions.rows[0].n).toBe(1);
  });

  it("S9 stale revisions, paused promotions, and channel swaps are rejected", async () => {
    const live = await makeLivePromotion("P5S.STALE", {
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const rev1 = live.draft.revision.id;
    const rev2 = await revisions.createDraftFromPublished(adminActor, rev1);
    const published2 = await revisions.publishRevision(rev2.revision.id, ADMIN);
    expect(published2.status).toBe("PUBLISHED");
    const commitFor = (revisionId: string, channel: string, key: string) => ({
      promotionId: live.promo.id,
      revisionId,
      channel,
      customerKey: `user:${CUSTOMER}`,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: HASH,
      idempotencyKey: key,
    });
    // Superseded revision can no longer back a commit...
    // (supersede path: publish of rev2 flips rev1 to SUPERSEDED)
    await expect(usage.commitUsage(commitFor(rev1, "RETAIL", "p5s-stale-rev1-1"))).rejects.toMatchObject({
      code: "PROMOTION_NOT_ACTIVE",
    });
    // ...and neither can a channel-swapped commit against the current revision.
    await expect(usage.commitUsage(commitFor(published2.id, "WHOLESALE", "p5s-stale-chan-1"))).rejects.toMatchObject({
      code: "PROMOTION_CHANNEL_MISMATCH",
    });
    // Pausing the promotion freezes the commit path until resume.
    await promotions.transition(adminActor, live.promo.id, "PAUSED");
    await expect(usage.commitUsage(commitFor(published2.id, "RETAIL", "p5s-stale-paused-1"))).rejects.toMatchObject({
      code: "PROMOTION_NOT_ACTIVE",
    });
    await promotions.transition(adminActor, live.promo.id, "ACTIVE");
    const resumed = await usage.commitUsage(commitFor(published2.id, "RETAIL", "p5s-stale-resumed-1"));
    expect(resumed.replayed).toBe(false);
  });

  it("S10 evaluation is read-only and bounded against oversized requests", async () => {
    await makeLivePromotion("P5S.PURE", {
      targets: [{ targetType: "CATEGORY", referenceId: "p5s_cat" }],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const request = {
      channel: "RETAIL",
      actor: { userId: CUSTOMER },
      lines: [{ lineId: "s10", productId: "p5s_prod", quantity: 1, unitPrice: "4000", lineTotal: "4000" }],
      shippingTotal: "0",
      now: new Date(),
    };
    const before = await tableCounts();
    await evaluation.evaluate(request);
    await evaluation.evaluate({ ...request, couponCodes: ["P5S-NOPE", "P5S-NOPE-2"] });
    const after = await tableCounts();
    expect(after).toEqual(before);
    const manyLines = Array.from({ length: 201 }, (_, index) => ({
      lineId: `overflow-${index}`,
      productId: "p5s_prod",
      quantity: 1,
      unitPrice: "1",
      lineTotal: "1",
    }));
    await expect(evaluation.evaluate({ ...request, lines: manyLines })).rejects.toMatchObject({
      code: "PROMOTION_EVALUATION_INVALID",
    });
    const manyCodes = Array.from({ length: 11 }, (_, index) => `P5S-CODE-${index}`);
    await expect(evaluation.evaluate({ ...request, couponCodes: manyCodes })).rejects.toMatchObject({
      code: "PROMOTION_EVALUATION_INVALID",
    });
    // Rejected evaluations also write nothing.
    expect(await tableCounts()).toEqual(before);
  });

  it("S11 terminal states stay terminal: archive ends drafting, scheduling, activation", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.TERMINAL", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "FREE_SHIPPING", scope: "SHIPPING" }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    await promotions.transition(adminActor, promo.id, "ENDED");
    await promotions.transition(adminActor, promo.id, "ARCHIVED");
    await expect(promotions.transition(adminActor, promo.id, "ACTIVE")).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
    await expect(promotions.transition(adminActor, promo.id, "DRAFT")).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
    await expect(revisions.createDraftRevision(adminActor, promo.id, { benefits: [] })).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
    await expect(
      schedules.scheduleAction(adminActor, promo.id, {
        action: "ACTIVATE",
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: "p5s-terminal-sched-1",
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_INVALID_TRANSITION" });
    // Scheduling in the past or without terms is rejected, not silently fixed.
    const bare = await promotions.createPromotion(adminActor, { promotionKey: "P5S.SCHEDX", channel: "RETAIL" });
    await expect(
      schedules.scheduleAction(adminActor, bare.id, {
        action: "ACTIVATE",
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        idempotencyKey: "p5s-terminal-past-1",
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_SCHEDULE_INVALID" });
    await expect(
      schedules.scheduleAction(adminActor, bare.id, {
        action: "ACTIVATE",
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: "p5s-terminal-bare-1",
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_REVISION_REQUIRED" });
    await promotions.transition(adminActor, bare.id, "IN_REVIEW");
    await expect(promotions.transition(adminActor, bare.id, "SCHEDULED")).rejects.toMatchObject({
      code: "PROMOTION_REVISION_REQUIRED",
    });
  });

  it("S12 maker/checker cannot be bypassed, replayed, or double-decided", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P5S.CHECKER", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    const first = await revisions.requestPublishApproval(adminActor, draft.revision.id, {
      makerNotes: "first",
      idempotencyKey: "p5s-checker-key-1",
    });
    // Same idempotency key returns the same pending request instead of forking.
    const replayed = await revisions.requestPublishApproval(adminActor, draft.revision.id, {
      makerNotes: "second",
      idempotencyKey: "p5s-checker-key-1",
    });
    expect(replayed.id).toBe(first.id);
    // Pending approval blocks every publish entry point...
    await expect(revisions.publishRevision(draft.revision.id, ADMIN)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_REQUIRED",
    });
    await expect(promotions.publishAndActivate(adminActor, promo.id, draft.revision.id)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_REQUIRED",
    });
    // ...the maker cannot clear their own gate...
    await expect(approvals.decideApprovalRequest(first.id, "approve", "self", ADMIN, false)).rejects.toThrow();
    // ...and a decided request cannot be decided twice.
    await approvals.decideApprovalRequest(first.id, "approve", "checked", CHECKER, false);
    await expect(approvals.decideApprovalRequest(first.id, "reject", "again", CHECKER, false)).rejects.toThrow();
    const published = await revisions.publishRevision(draft.revision.id, ADMIN);
    expect(published.status).toBe("PUBLISHED");
    // An approval is bound to its revision: transplanting the link onto a
    // different revision (confused deputy) fails closed at publish time.
    const other = await promotions.createPromotion(adminActor, { promotionKey: "P5S.CHECKERB", channel: "RETAIL" });
    const otherDraft = await revisions.createDraftRevision(adminActor, other.id, {
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    await pool.query(`UPDATE promotion_revision SET approval_request_id = $1 WHERE id = $2`, [first.id, otherDraft.revision.id]);
    await expect(revisions.publishRevision(otherDraft.revision.id, ADMIN)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_INVALID",
    });
    expect((await revisions.getRevision(otherDraft.revision.id)).revision.status).toBe("DRAFT");
  });
});
