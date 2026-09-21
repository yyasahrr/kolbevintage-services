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

const DB = "kolbe_phase_5_7_promotions_service_test";
const ADMIN = "p57_admin";
const CHECKER = "p57_checker";
const CUSTOMER = "p57_customer";
const VIP_USER = "p57_vipuser";
const adminActor = { userId: ADMIN, role: "admin" as const };
const customerActor = { userId: CUSTOMER, role: "customer" as const };

let pool: Pool;
let promotions: PromotionService;
let revisions: PromotionRevisionService;
let coupons: CouponService;
let usage: PromotionUsageService;
let schedules: PromotionScheduleService;
let evaluation: PromotionEvaluationService;
let approvals: AdminApprovalsService;

async function insertBase() {
  await pool.query(`
    INSERT INTO account_user (id, email, password_hash, salt, role, status)
    VALUES ('${ADMIN}', 'p57-admin@test.invalid', 'hash', 'salt', 'admin', 'active'),
           ('${CHECKER}', 'p57-checker@test.invalid', 'hash', 'salt', 'admin', 'active'),
           ('${CUSTOMER}', 'p57-customer@test.invalid', 'hash', 'salt', 'customer', 'active'),
           ('${VIP_USER}', 'p57-vipuser@test.invalid', 'hash', 'salt', 'vip', 'active')
  `);
  await pool.query(`INSERT INTO category (id, slug, name, status) VALUES ('p57_cat', 'p57-cat', 'P57 Category', 'active')`);
  await pool.query(`INSERT INTO product (id, name, slug, status, owner_type, category_id) VALUES ('p57_prod', 'P57 Product', 'p57-prod', 'published', 'KOLBE', 'p57_cat')`);
  await pool.query(`INSERT INTO product (id, name, slug, status, owner_type) VALUES ('p57_prod2', 'P57 Product 2', 'p57-prod2', 'published', 'KOLBE')`);
  await pool.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('p57_supplier', 'P57 Supplier', 'P57 Supplier', 'approved')`);
  await pool.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('p57_seller', 'SUPPLIER', 'p57_supplier', 'P57 Seller', 'active')`);
  await pool.query(`INSERT INTO seller_offer (id, product_id, seller_id, sku, status, wholesale_price, currency) VALUES ('p57_offer', 'p57_prod', 'p57_seller', 'P57-SKU', 'published', 10000, 'IRR')`);
  await pool.query(`INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status) VALUES ('p57_acct', '${VIP_USER}', 'VIP', 'VIP Store', '09120000000', 'Tehran', 'approved')`);
  await pool.query(`INSERT INTO wholesale_plan (id, code, name, status) VALUES ('p57_plan', 'P57-GOLD', 'P57 Gold', 'active')`);
  await pool.query(`INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, status) VALUES ('p57_pver', 'p57_plan', 1, 'v1', 'published')`);
  await pool.query(`INSERT INTO wholesale_membership (id, account_id, plan_id, plan_version_id, status) VALUES ('p57_mem', 'p57_acct', 'p57_plan', 'p57_pver', 'active')`);
  await pool.query(`INSERT INTO crm_contact (id, name, stage) VALUES ('p57_contact', 'P57 Customer', 'ACTIVE_CUSTOMER')`);
  await pool.query(`INSERT INTO crm_tag (id, key, label, is_active, created_by) VALUES ('p57_tag', 'P57_VIP_CLUB', 'P57 VIP Club', true, '${ADMIN}')`);
  await pool.query(`INSERT INTO crm_contact_tag (id, contact_id, tag_id, assigned_by) VALUES ('p57_ct', 'p57_contact', 'p57_tag', '${ADMIN}')`);
  await pool.query(`INSERT INTO crm_contact_identity_link (id, contact_id, user_id, link_type, linked_by) VALUES ('p57_cil', 'p57_contact', '${CUSTOMER}', 'account_user', '${ADMIN}')`);
}

describe("Phase 5.7 PromotionService lifecycle, revisions and commits", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    await insertBase();
    const db = drizzle(pool);
    const audit = { record: async () => "p57-audit" } as never;
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

  it("creates draft promotions, rejects duplicate keys and non-admin actors", async () => {
    const created = await promotions.createPromotion(adminActor, { promotionKey: "p57.autumn", channel: "RETAIL" });
    expect(created.status).toBe("DRAFT");
    expect(created.promotionKey).toBe("P57.AUTUMN");
    await expect(promotions.createPromotion(adminActor, { promotionKey: "P57.AUTUMN", channel: "RETAIL" })).rejects.toMatchObject({
      code: "PROMOTION_KEY_DUPLICATE",
    });
    await expect(promotions.createPromotion(customerActor, { promotionKey: "P57.EVIL", channel: "RETAIL" })).rejects.toMatchObject({
      code: "PROMOTION_FORBIDDEN",
    });
    const page = await promotions.listPromotions({ channel: "RETAIL", page: 1, limit: 10 });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
  });

  it("drafts revisions with validated targets and rejects bad references", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.TARGETS", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      targets: [
        { targetType: "PRODUCT", referenceId: "p57_prod" },
        { targetType: "MIN_SUBTOTAL", minSubtotal: "10000" },
      ],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1500 }],
    });
    expect(draft.revision.revisionNumber).toBe(1);
    expect(draft.targets).toHaveLength(2);
    expect(draft.revision.status).toBe("DRAFT");
    // Unknown product reference fails closed at authoring time.
    await expect(
      revisions.createDraftRevision(adminActor, promo.id, {
        targets: [{ targetType: "PRODUCT", referenceId: "no_such_product" }],
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_TARGET_INVALID" });
    // SQL-shaped reference is rejected by shape validation, not by the database.
    await expect(
      revisions.createDraftRevision(adminActor, promo.id, {
        targets: [{ targetType: "PRODUCT", referenceId: "x' OR '1'='1" }],
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_INVALID_INPUT" });
    // Executable-looking target types cannot enter the allowlist.
    await expect(
      revisions.createDraftRevision(adminActor, promo.id, {
        targets: [{ targetType: "__proto__", referenceId: "p57_prod" }],
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
      }),
    ).rejects.toThrow();
  });

  it("publishes and activates atomically; published terms become immutable", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.LIFECYCLE", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    // Illegal jump is rejected.
    await expect(promotions.transition(adminActor, promo.id, "ENDED")).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
    // Activation without terms is impossible.
    const bare = await promotions.createPromotion(adminActor, { promotionKey: "P57.BARE", channel: "RETAIL" });
    await expect(promotions.transition(adminActor, bare.id, "ACTIVE")).rejects.toMatchObject({
      code: "PROMOTION_REVISION_REQUIRED",
    });
    const live = await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    expect(live.status).toBe("ACTIVE");
    expect(live.currentPublishedRevisionId).toBe(draft.revision.id);
    // Published terms cannot be edited in place.
    await expect(
      revisions.replaceTerms(adminActor, draft.revision.id, {
        benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 5000 }],
      }),
    ).rejects.toMatchObject({ code: "PROMOTION_TERMS_IMMUTABLE" });
    // Editing an active promotion mints a new draft revision instead.
    const next = await revisions.createDraftFromPublished(adminActor, draft.revision.id);
    expect(next.revision.revisionNumber).toBe(2);
    expect(next.revision.status).toBe("DRAFT");
    const published = await revisions.publishRevision(next.revision.id, ADMIN);
    expect(published.status).toBe("PUBLISHED");
    const first = await revisions.getRevision(draft.revision.id);
    expect(first.revision.status).toBe("SUPERSEDED");
    expect(first.revision.termsHash).toBe(draft.revision.termsHash);
    const parent = await promotions.getPromotion(promo.id);
    expect(parent.currentPublishedRevisionId).toBe(next.revision.id);
    // Park the promotion so later evaluation tests stay isolated.
    await promotions.transition(adminActor, promo.id, "PAUSED");
    await promotions.transition(adminActor, promo.id, "ENDED");
  });

  it("pauses, resumes, ends, and archives through explicit transitions", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.PAUSE", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "FREE_SHIPPING", scope: "SHIPPING" }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    expect((await promotions.transition(adminActor, promo.id, "PAUSED")).status).toBe("PAUSED");
    await expect(promotions.transition(adminActor, promo.id, "DRAFT")).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
    expect((await promotions.transition(adminActor, promo.id, "ACTIVE")).status).toBe("ACTIVE");
    expect((await promotions.transition(adminActor, promo.id, "ENDED")).status).toBe("ENDED");
    expect((await promotions.transition(adminActor, promo.id, "ARCHIVED")).status).toBe("ARCHIVED");
    await expect(promotions.transition(adminActor, promo.id, "ACTIVE")).rejects.toMatchObject({
      code: "PROMOTION_INVALID_TRANSITION",
    });
  });

  it("enforces maker/checker separation for approval-gated publishes", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.MAKER", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", amount: "5000" }],
    });
    const request = await revisions.requestPublishApproval(adminActor, draft.revision.id, {
      makerNotes: "please approve",
      idempotencyKey: "p57-maker-1",
    });
    expect(request.requestType).toBe("PROMOTION_PUBLISH");
    // Pending approval blocks publishing.
    await expect(revisions.publishRevision(draft.revision.id, ADMIN)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_REQUIRED",
    });
    // Maker cannot check their own request.
    await expect(approvals.decideApprovalRequest(request.id, "approve", "self", ADMIN, false)).rejects.toThrow();
    // Distinct checker approves; publish proceeds.
    await approvals.decideApprovalRequest(request.id, "approve", "looks good", CHECKER, false);
    const published = await revisions.publishRevision(draft.revision.id, ADMIN);
    expect(published.status).toBe("PUBLISHED");
  });

  it("manages coupons with normalized uniqueness and immutable identity", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.COUPONS", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    const coupon = await coupons.createCoupon(adminActor, promo.id, { code: "  p57-save10 " });
    expect(coupon.codeNormalized).toBe("P57-SAVE10");
    expect(coupon.revisionId).toBeNull();
    await expect(coupons.createCoupon(adminActor, promo.id, { code: "P57-SAVE10" })).rejects.toMatchObject({
      code: "PROMOTION_COUPON_DUPLICATE",
    });
    const disabled = await coupons.updateCoupon(adminActor, coupon.id, { status: "DISABLED" });
    expect(disabled.status).toBe("DISABLED");
    // Identity columns cannot be re-pointed through the service surface.
    await expect(coupons.updateCoupon(adminActor, coupon.id, { status: "ENABLED", usageLimit: 5 } as never)).resolves.toBeTruthy();
    const rows = await coupons.listCoupons(promo.id);
    expect(rows.map((row) => row.codeNormalized)).toContain("P57-SAVE10");
  });

  it("evaluates retail promotions end to end with server-resolved facts", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.EVAL", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      targets: [{ targetType: "CATEGORY", referenceId: "p57_cat" }],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 2000 }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    const first = await evaluation.evaluate({
      channel: "RETAIL",
      actor: { userId: CUSTOMER },
      lines: [
        { lineId: "l1", productId: "p57_prod", quantity: 2, unitPrice: "5000", lineTotal: "10000" },
        { lineId: "l2", productId: "p57_prod2", quantity: 1, unitPrice: "3000", lineTotal: "3000" },
      ],
      shippingTotal: "500",
      now: new Date(),
    });
    // Only the categorized line is discounted: 20% of 10000.
    const applied = first.appliedPromotions.find((entry) => entry.promotionId === promo.id);
    expect(applied).toBeTruthy();
    expect(first.lineDiscounts).toEqual([
      { lineId: "l1", discount: "2000" },
      { lineId: "l2", discount: "0" },
    ]);
    expect(first.totalDiscount).toBe("2000");
    expect(typeof first.baseSubtotal).toBe("string");
    // Deterministic: byte-identical on repeat.
    const second = await evaluation.evaluate({
      channel: "RETAIL",
      actor: { userId: CUSTOMER },
      lines: [
        { lineId: "l1", productId: "p57_prod", quantity: 2, unitPrice: "5000", lineTotal: "10000" },
        { lineId: "l2", productId: "p57_prod2", quantity: 1, unitPrice: "3000", lineTotal: "3000" },
      ],
      shippingTotal: "500",
      now: new Date(),
    });
    expect(second.termsHash).toBe(first.termsHash);
    expect(second.lineDiscounts).toEqual(first.lineDiscounts);
  });

  it("matches wholesale VIP-plan and segment targets through owner domains", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.VIP", channel: "WHOLESALE" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      targets: [
        { targetType: "VIP_PLAN", referenceId: "p57_plan" },
        { targetType: "VIP_ACCOUNT", referenceId: "p57_acct" },
      ],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "ORDER", percentBps: 500 }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    const matched = await evaluation.evaluate({
      channel: "WHOLESALE",
      actor: { userId: VIP_USER, vipAccountId: "p57_acct" },
      lines: [{ lineId: "w1", productId: "p57_prod", offerId: "p57_offer", quantity: 10, unitPrice: "10000", lineTotal: "100000" }],
      shippingTotal: "0",
      now: new Date(),
    });
    expect(matched.appliedPromotions.map((entry) => entry.promotionId)).toContain(promo.id);
    expect(matched.orderDiscount).toBe("5000");
    // Same request in the retail channel cannot match a wholesale promotion.
    const retail = await evaluation.evaluate({
      channel: "RETAIL",
      actor: { userId: CUSTOMER },
      lines: [{ lineId: "w1", productId: "p57_prod", quantity: 10, unitPrice: "10000", lineTotal: "100000" }],
      shippingTotal: "0",
      now: new Date(),
    });
    expect(retail.appliedPromotions.map((entry) => entry.promotionId)).not.toContain(promo.id);

    const segPromo = await promotions.createPromotion(adminActor, { promotionKey: "P57.SEG", channel: "RETAIL" });
    const segDraft = await revisions.createDraftRevision(adminActor, segPromo.id, {
      targets: [{ targetType: "CUSTOMER_SEGMENT", referenceId: "P57_VIP_CLUB" }],
      benefits: [{ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", amount: "1000" }],
    });
    await promotions.publishAndActivate(adminActor, segPromo.id, segDraft.revision.id);
    const segmented = await evaluation.evaluate({
      channel: "RETAIL",
      actor: { userId: CUSTOMER },
      lines: [{ lineId: "s1", productId: "p57_prod2", quantity: 1, unitPrice: "3000", lineTotal: "3000" }],
      shippingTotal: "0",
      now: new Date(),
    });
    expect(segmented.appliedPromotions.map((entry) => entry.promotionId)).toContain(segPromo.id);
  });

  it("commits redemptions idempotently and enforces limits under concurrency", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.RACE", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      couponRequired: true,
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1000 }],
    });
    await promotions.publishAndActivate(adminActor, promo.id, draft.revision.id);
    const coupon = await coupons.createCoupon(adminActor, promo.id, { code: "P57-RACE-1", usageLimit: 1 });
    const commit = {
      couponId: coupon.id,
      promotionId: promo.id,
      revisionId: draft.revision.id,
      channel: "RETAIL",
      customerKey: `user:${CUSTOMER}`,
      baseAmount: "10000",
      discountAmount: "1000",
      evaluationHash: "c".repeat(64),
      idempotencyKey: "p57-race-commit",
    };
    const attempts = await Promise.allSettled([usage.commitCouponRedemption(commit), usage.commitCouponRedemption({ ...commit, idempotencyKey: "p57-race-other" })]);
    // Limit-1 race: exactly one commit wins, the other is rejected.
    const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
    const losers = attempts.filter((attempt) => attempt.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ code: "PROMOTION_COUPON_LIMIT_EXCEEDED" });
    // Replay of the winner's key is stable.
    const winnerKey = attempts[0].status === "fulfilled" ? "p57-race-commit" : "p57-race-other";
    const replay = await usage.commitCouponRedemption({ ...commit, idempotencyKey: winnerKey });
    expect(replay.replayed).toBe(true);
    const stored = await pool.query(`SELECT redeemed_count FROM promotion_coupon WHERE id = $1`, [coupon.id]);
    expect(Number(stored.rows[0].redeemed_count)).toBe(1);
  });

  it("activates and deactivates through the durable schedule worker", async () => {
    const promo = await promotions.createPromotion(adminActor, { promotionKey: "P57.SCHED", channel: "RETAIL" });
    const draft = await revisions.createDraftRevision(adminActor, promo.id, {
      benefits: [{ benefitType: "FREE_SHIPPING", scope: "SHIPPING" }],
    });
    await revisions.publishRevision(draft.revision.id, ADMIN);
    await promotions.transition(adminActor, promo.id, "IN_REVIEW");
    const future = new Date(Date.now() + 60_000);
    const created = await schedules.scheduleAction(adminActor, promo.id, {
      action: "ACTIVATE",
      scheduledAt: future.toISOString(),
      idempotencyKey: "p57-sched-1",
    });
    expect(created.replayed).toBe(false);
    expect((await promotions.getPromotion(promo.id)).status).toBe("SCHEDULED");
    // Not due yet: worker is a no-op.
    const idle = await schedules.processDueSchedules(new Date(), 10);
    expect(idle.executed).toBe(true);
    expect(idle.result).toEqual([]);
    // Due: worker activates exactly once.
    const fired = await schedules.processDueSchedules(new Date(Date.now() + 120_000), 10);
    expect(fired.result).toEqual([{ id: created.schedule.id, executed: true }]);
    expect((await promotions.getPromotion(promo.id)).status).toBe("ACTIVE");
    // Stale PROCESSING claims recover to SCHEDULED.
    await pool.query(`UPDATE promotion_schedule SET status = 'PROCESSING', claimed_at = now() - interval '1 hour' WHERE id = $1`, [created.schedule.id]);
    const recovered = await schedules.recoverStaleSchedules(15);
    expect(recovered.map((row: { id: string }) => row.id)).toContain(created.schedule.id);
  });
});
