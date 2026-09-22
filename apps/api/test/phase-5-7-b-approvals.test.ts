import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AdminApprovalsService } from "../src/modules/admin/admin-approvals.service";
import { ADMIN_PERMISSION_KEY } from "../src/modules/admin/admin-rbac.guard";
import { PromotionApprovalService } from "../src/modules/promotions/promotion-approval.service";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { AdminPromotionsController } from "../src/modules/promotions/admin-promotions.controller";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "../../../packages/database/test/helpers";

const DB = "kolbe_phase_5_7_b_approvals_test";
const MAKER = "p57b_maker";
const CHECKER = "p57b_checker";
const CHECKER_2 = "p57b_checker_2";

let pool: Pool;
let promotions: PromotionService;
let approvals: PromotionApprovalService;
let adminApprovals: AdminApprovalsService;

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

async function seedPromo(code: string) {
  const promo = await promotions.createPromotion(MAKER, { code, title: code, channel: "RETAIL" });
  const revision = await promotions.createRevision(promo.id, MAKER, {
    benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000, stackingPolicy: "STACKABLE",
  });
  return { promo, revision };
}

async function seedLivePromo(code: string) {
  const { promo, revision } = await seedPromo(code);
  await promotions.publishRevision(revision.id, CHECKER);
  await promotions.submitForReview(promo.id, CHECKER);
  await promotions.activate(promo.id, CHECKER);
  return { promo, revision };
}

describe("Phase 5.7-B maker/checker execution for publish/pause", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    pool = new Pool({ connectionString: urlFor(DB) });
    const db = drizzle(pool);
    await pool.query(
      `INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES
       ('${MAKER}', 'maker@test.invalid', 'h', 's', 'admin', 'active'),
       ('${CHECKER}', 'checker@test.invalid', 'h', 's', 'admin', 'active'),
       ('${CHECKER_2}', 'checker2@test.invalid', 'h', 's', 'admin', 'active')`,
    );
    promotions = new PromotionService(db as any, facts as any, audit as any);
    // Domain-execution paths never touch the VIP/settings delegates.
    adminApprovals = new AdminApprovalsService(db as any, audit as any, {} as any, {} as any, {} as any);
    approvals = new PromotionApprovalService(promotions as any, adminApprovals as any);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("publishes through the full maker -> checker -> execute flow", async () => {
    const { promo, revision } = await seedPromo("B10");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, makerNotes: "looks good", idempotencyKey: "b10-key" });
    expect(request.status).toBe("pending");
    expect(request.requestType).toBe("PROMOTION_PUBLISH");
    expect(request.targetType).toBe("promotion_revision");
    expect(request.targetId).toBe(revision.id);
    expect((request.payload as Record<string, unknown>).termsHash).toBe(revision.termsHash);

    const decided = await adminApprovals.decideApprovalRequest(request.id, "approve", "checked", CHECKER, false);
    expect(decided.status).toBe("approved");

    const { approval, revision: published } = await approvals.executeApprovedPublish(request.id, CHECKER);
    expect(published.status).toBe("PUBLISHED");
    expect(approval.status).toBe("executed");
    expect((approval.executionResult as Record<string, unknown>).revisionId).toBe(revision.id);
    expect((approval.executionResult as Record<string, unknown>).deferredTo).toBeUndefined();
    const current = await promotions.getPromotion(promo.id);
    expect(current.currentPublishedRevisionId).toBe(revision.id);
  });

  it("enforces the two-person rule: makers cannot decide their own requests", async () => {
    const { revision } = await seedPromo("B11");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b11-key" });
    await expect(adminApprovals.decideApprovalRequest(request.id, "approve", undefined, MAKER, false)).rejects.toThrow(/Two-person rule/);
    const pending = await adminApprovals.getApprovalRequest(request.id);
    expect(pending?.status).toBe("pending");
  });

  it("fails closed when draft terms change after the request", async () => {
    const { revision } = await seedPromo("B12");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b12-key" });
    // The draft is edited after the maker's request: the approval is stale.
    await promotions.addTarget(revision.id, MAKER, { targetType: "MIN_QUANTITY", valueQuantity: 2 });
    await adminApprovals.decideApprovalRequest(request.id, "approve", undefined, CHECKER, false);
    await expect(approvals.executeApprovedPublish(request.id, CHECKER)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_TERMS_CHANGED",
    });
    const still = await promotions.getRevision(revision.id);
    expect(still.status).toBe("DRAFT");
  });

  it("completes generic auto-execute decisions through the deferred marker", async () => {
    const { revision } = await seedPromo("B13");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b13-key" });
    // Checker uses the generic endpoint default (autoExecute=true): the decision
    // finalizes but performs no domain effect, leaving the deferred marker.
    const decided = await adminApprovals.decideApprovalRequest(request.id, "approve", undefined, CHECKER, true);
    expect(decided.status).toBe("executed");
    expect((decided.executionResult as Record<string, unknown>).deferredTo).toBe("promotions.approval");
    const before = await promotions.getRevision(revision.id);
    expect(before.status).toBe("DRAFT");

    const { approval, revision: published } = await approvals.executeApprovedPublish(request.id, CHECKER);
    expect(published.status).toBe("PUBLISHED");
    expect(approval.status).toBe("executed");
    expect((approval.executionResult as Record<string, unknown>).revisionId).toBe(revision.id);
    expect((approval.executionResult as Record<string, unknown>).deferredTo).toBeUndefined();
  });

  it("binds execution to the deciding checker", async () => {
    const { revision } = await seedPromo("B14");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b14-key" });
    await adminApprovals.decideApprovalRequest(request.id, "approve", undefined, CHECKER, false);
    await expect(approvals.executeApprovedPublish(request.id, CHECKER_2)).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_FORBIDDEN",
    });
    // The rightful checker can still execute.
    const { revision: published } = await approvals.executeApprovedPublish(request.id, CHECKER);
    expect(published.status).toBe("PUBLISHED");
  });

  it("pauses through the same maker/checker flow", async () => {
    const { promo } = await seedLivePromo("B15");
    const request = await approvals.requestPause(MAKER, { promotionId: promo.id, idempotencyKey: "b15-key" });
    expect(request.requestType).toBe("PROMOTION_PAUSE");
    await adminApprovals.decideApprovalRequest(request.id, "approve", undefined, CHECKER, false);
    const { approval, promotion } = await approvals.executeApprovedPause(request.id, CHECKER);
    expect(promotion.status).toBe("PAUSED");
    expect(approval.status).toBe("executed");
  });

  it("validates request preconditions and rejects duplicate open requests", async () => {
    const { promo, revision } = await seedPromo("B16");
    await expect(approvals.requestPause(MAKER, { promotionId: promo.id, idempotencyKey: "b16-a" })).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_STATE",
    });
    await promotions.publishRevision(revision.id, CHECKER);
    await expect(approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b16-b" })).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_STATE",
    });
    await expect(approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "not a key!!" })).rejects.toMatchObject({
      code: "PROMOTION_INPUT_INVALID",
    });

    const { revision: draft } = await seedPromo("B17");
    await approvals.requestPublish(MAKER, { revisionId: draft.id, idempotencyKey: "b17-a" });
    await expect(approvals.requestPublish(MAKER, { revisionId: draft.id, idempotencyKey: "b17-b" })).rejects.toMatchObject({
      code: "PROMOTION_APPROVAL_DUPLICATE",
    });
  });

  it("rejects out-of-state and double execution", async () => {
    const { revision } = await seedPromo("B18");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b18-key" });
    // Undecided requests cannot execute.
    await expect(approvals.executeApprovedPublish(request.id, CHECKER)).rejects.toMatchObject({ code: "PROMOTION_APPROVAL_STATE" });
    // Wrong-type execution is rejected.
    await adminApprovals.decideApprovalRequest(request.id, "approve", undefined, CHECKER, false);
    await expect(approvals.executeApprovedPause(request.id, CHECKER)).rejects.toMatchObject({ code: "PROMOTION_APPROVAL_TYPE" });
    await approvals.executeApprovedPublish(request.id, CHECKER);
    // Completed executions cannot run twice.
    await expect(approvals.executeApprovedPublish(request.id, CHECKER)).rejects.toMatchObject({ code: "PROMOTION_APPROVAL_STATE" });
  });

  it("routes publish/pause exclusively through approvals at the HTTP surface", async () => {
    const prototype = AdminPromotionsController.prototype as unknown as Record<string, unknown>;
    expect(prototype.publishRevision).toBeUndefined();
    expect(prototype.pause).toBeUndefined();
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_PERMISSION_KEY, AdminPromotionsController.prototype.requestPublish)).toBe("promotion:edit");
    expect(reflector.get(ADMIN_PERMISSION_KEY, AdminPromotionsController.prototype.requestPause)).toBe("promotion:edit");
    expect(reflector.get(ADMIN_PERMISSION_KEY, AdminPromotionsController.prototype.executePublish)).toBe("wholesale:approval:decide");
    expect(reflector.get(ADMIN_PERMISSION_KEY, AdminPromotionsController.prototype.executePause)).toBe("wholesale:approval:decide");
  });

  it("markApprovalExecuted only completes decided rows", async () => {
    const { revision } = await seedPromo("B19");
    const request = await approvals.requestPublish(MAKER, { revisionId: revision.id, idempotencyKey: "b19-key" });
    await expect(adminApprovals.markApprovalExecuted(request.id, { ok: true }, CHECKER)).rejects.toThrow(/Must be 'approved'/);
    await adminApprovals.decideApprovalRequest(request.id, "reject", "no", CHECKER, false);
    await expect(adminApprovals.markApprovalExecuted(request.id, { ok: true }, CHECKER)).rejects.toThrow(/Must be 'approved'/);
  });
});
