import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootHarness, confirmToAwaitingPayment, createOrder, one, q, seedTwoSuppliers, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — privacy: data-subject requests, legal holds, retention policies
 * (dry-run only), data minimization of buyer-facing DTOs.
 */
const TEST_DB = "kolbe_phase_4_7_5_privacy_test";

let h: Harness;
let ctx: SupplierContext;
let privacy: any;
let compliance: any;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const admin = () => ({ userId: ctx.userAdmin, role: "admin" as const });

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  const { PrivacyService } = await import("../src/modules/compliance/privacy.service");
  const { ComplianceService } = await import("../src/modules/compliance/compliance.service");
  privacy = h.app.get(PrivacyService);
  compliance = h.app.get(ComplianceService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — data subject requests", () => {
  let deletionId: string;

  it("a user submits requests for their own account only; duplicates of an open request are refused; admin cannot submit on behalf", async () => {
    const access = await api().post("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ requestType: "access", subjectNote: "لطفاً داده‌های من" }).expect(201);
    expect(access.body).toMatchObject({ requestType: "access", status: "submitted" });
    expect(access.body).not.toHaveProperty("decisionReason");
    const dup = await api().post("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ requestType: "access" }).expect(409);
    expect(dup.body.error).toBe("DATA_SUBJECT_REQUEST_INVALID_STATE");
    await api().post("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ requestType: "sell" }).expect(400);
    await expect(privacy.submitRequest(admin(), { requestType: "deletion" })).rejects.toMatchObject({ code: "COMPLIANCE_ACCESS_DENIED" });
    const deletion = await api().post("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ requestType: "deletion" }).expect(201);
    deletionId = deletion.body.id;
    const mine = await api().get("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(mine.body.requests).toHaveLength(2);
    // another user sees nothing of it
    const other = await api().get("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(200);
    expect(other.body.requests).toEqual([]);
  });

  it("admin workflow is a state machine with audited decisions; a decision needs a reason; the subject never sees the internal reason", async () => {
    await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userBuyer, "vip")).send({ action: "approve", decisionReason: "x" }).expect(403);
    const early = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "approve", decisionReason: "x" }).expect(409);
    expect(early.body.error).toBe("DATA_SUBJECT_REQUEST_INVALID_STATE");
    await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "start_review" }).expect(201);
    const noReason = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "approve" }).expect(400);
    expect(noReason.body.error).toBe("VALIDATION_ERROR");
    const approved = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "approve", decisionReason: "identity confirmed via support call" }).expect(201);
    expect(approved.body.request).toMatchObject({ status: "approved", decidedBy: ctx.userAdmin });
    const audits = await q(h.pool, `SELECT action FROM audit_log WHERE entity_type='data_subject_request' AND entity_id=$1 ORDER BY created_at`, [deletionId]);
    expect(audits.map((a: any) => a.action)).toEqual(["data_subject_request.submitted", "data_subject_request.start_review", "data_subject_request.approve"]);
    const mine = await api().get("/api/v1/legal/me/data-requests").set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    const view = mine.body.requests.find((r: any) => r.id === deletionId);
    expect(view.status).toBe("approved");
    expect(view).not.toHaveProperty("decisionReason");
    expect(view).not.toHaveProperty("decidedBy");
  });

  it("an active legal hold blocks completing a deletion; after release the completion records what was retained (finance/legal evidence never destroyed)", async () => {
    // give the buyer real legal/financial evidence first
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    const evidenceBefore = await one(h.pool, `SELECT count(*)::int AS c FROM transaction_compliance_snapshot WHERE user_id=$1`, [ctx.userBuyer]);
    expect(evidenceBefore.c).toBe(1);

    const hold = await api().post("/api/v1/admin/compliance/legal-holds").set("Cookie", cookie(ctx.userAdmin, "admin")).send({ scopeType: "user", scopeId: ctx.userBuyer, reason: "dispute pending" }).expect(201);
    const blocked = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "complete" }).expect(409);
    expect(blocked.body.error).toBe("LEGAL_HOLD_ACTIVE");
    await expect(q(h.pool, `DELETE FROM legal_hold WHERE id=$1`, [hold.body.hold.id])).rejects.toThrow(/cannot be deleted/);
    await expect(q(h.pool, `UPDATE legal_hold SET reason='edited' WHERE id=$1`, [hold.body.hold.id])).rejects.toThrow(/only the transition active -> released/);
    await api().post(`/api/v1/admin/compliance/legal-holds/${hold.body.hold.id}/release`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ releaseNotes: "dispute closed" }).expect(201);
    const releasedTwice = await api().post(`/api/v1/admin/compliance/legal-holds/${hold.body.hold.id}/release`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(409);
    expect(releasedTwice.body.error).toBe("HOLD_ALREADY_RELEASED");

    const completed = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "complete", retainedCategories: [{ category: "wholesale_order", basis: "commercial record" }] }).expect(201);
    expect(completed.body.request.status).toBe("completed");
    const categories = completed.body.request.retainedCategories.map((c: any) => c.category);
    expect(categories).toEqual(expect.arrayContaining(["legal_policy_acceptance", "transaction_compliance_snapshot", "audit_log", "wholesale_order"]));
    // nothing was destroyed by the workflow itself
    const evidenceAfter = await one(h.pool, `SELECT count(*)::int AS c FROM transaction_compliance_snapshot WHERE user_id=$1`, [ctx.userBuyer]);
    expect(evidenceAfter.c).toBe(1);
    expect((await one(h.pool, `SELECT count(*)::int AS c FROM wholesale_order WHERE id=$1`, [order.id])).c).toBe(1);
    const done = await api().post(`/api/v1/admin/compliance/data-requests/${deletionId}/transition`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ action: "start_processing" }).expect(409);
    expect(done.body.error).toBe("DATA_SUBJECT_REQUEST_INVALID_STATE");
  });

  it("access export is scoped to the caller and contains no hashes of third parties or raw request metadata", async () => {
    const exported = await api().get("/api/v1/legal/me/data-export").set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(exported.body.userId).toBe(ctx.userBuyer);
    expect(exported.body.transactionSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(exported.body.dataSubjectRequests.length).toBe(2);
    expect(JSON.stringify(exported.body)).not.toContain("requestMetadataHash");
    expect(JSON.stringify(exported.body)).not.toContain(ctx.userAOwner);
  });
});

describe("Phase 4.7.5 — retention policies are configurable and dry-run only", () => {
  it("destructive policies cannot be activated without VERIFIED basis and a duration; dry-run never deletes and reports what it cannot evaluate", async () => {
    const draft = await api().post("/api/v1/admin/compliance/retention-policies").set("Cookie", cookie(ctx.userAdmin, "admin")).send({ dataCategory: "consent_event", scope: "platform", action: "delete", retentionBasis: "engineering proposal — awaiting counsel" }).expect(201);
    expect(draft.body.policy).toMatchObject({ status: "draft", verificationStatus: "NEEDS_LEGAL_VERIFICATION", retentionDays: null });
    const blocked = await api().post(`/api/v1/admin/compliance/retention-policies/${draft.body.policy.id}/activate`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(409);
    expect(blocked.body.error).toBe("RETENTION_POLICY_NOT_VERIFIED");
    await expect(q(h.pool, `UPDATE data_retention_policy SET status='active' WHERE id=$1`, [draft.body.policy.id])).rejects.toThrow(/data_retention_policy_destructive_requires_verification/);

    const dry = await api().post(`/api/v1/admin/compliance/retention-policies/${draft.body.policy.id}/dry-run`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(dry.body).toMatchObject({ evaluable: false, evaluableReason: "RETENTION_DAYS_NOT_SET", destructiveExecutionAvailable: false, candidates: null });

    // a non-destructive review policy can be activated; a foreign category is reported as not evaluable
    const review = await privacy.createRetentionPolicy(admin(), { dataCategory: "retail_order", scope: "retail", action: "review", retentionDays: 3650, retentionBasis: "S-15 (unverified) — review only" });
    await privacy.activateRetentionPolicy(admin(), review.id);
    const foreign = await privacy.dryRunRetentionPolicy(admin(), review.id);
    expect(foreign).toMatchObject({ evaluable: false, evaluableReason: "OWNER_SERVICE_NOT_AVAILABLE", destructiveExecutionAvailable: false });

    // an own category with a window counts candidates without touching rows
    const own = await privacy.createRetentionPolicy(admin(), { dataCategory: "consent_event", scope: "supplier", action: "review", retentionDays: 1, retentionBasis: "test" });
    await compliance.recordConsent({ userId: ctx.userBuyer, role: "vip" }, { purpose: "MARKETING_EMAIL", eventType: "granted" });
    const before = await one(h.pool, `SELECT count(*)::int AS c FROM consent_event`);
    const counted = await privacy.dryRunRetentionPolicy(admin(), own.id);
    expect(counted).toMatchObject({ evaluable: true, candidates: 0, destructiveExecutionAvailable: false });
    expect(counted.blockedBy).toEqual([]); // consent_event is not a never-deleted category and no hold is active any more
    const evidence = await privacy.createRetentionPolicy(admin(), { dataCategory: "legal_policy_acceptance", scope: "wholesale", action: "review", retentionDays: 1, retentionBasis: "test" });
    expect((await privacy.dryRunRetentionPolicy(admin(), evidence.id)).blockedBy).toContain("LEGAL_EVIDENCE_CATEGORY");
    const after = await one(h.pool, `SELECT count(*)::int AS c FROM consent_event`);
    expect(after.c).toBe(before.c);
    const audit = await one(h.pool, `SELECT count(*)::int AS c FROM audit_log WHERE action='retention_policy.dry_run'`);
    expect(audit.c).toBeGreaterThanOrEqual(3);
  });

  it("only one active policy per (category, scope); activation retires the previous one", async () => {
    const a = await privacy.createRetentionPolicy(admin(), { dataCategory: "data_subject_request", action: "retain", retentionBasis: "test a" });
    const b = await privacy.createRetentionPolicy(admin(), { dataCategory: "data_subject_request", action: "retain", retentionBasis: "test b" });
    await privacy.activateRetentionPolicy(admin(), a.id);
    await privacy.activateRetentionPolicy(admin(), b.id);
    const rows = await q(h.pool, `SELECT id, status FROM data_retention_policy WHERE data_category='data_subject_request' ORDER BY created_at`);
    expect(rows.map((r: any) => r.status)).toEqual(["retired", "active"]);
    await expect(privacy.activateRetentionPolicy(admin(), a.id)).rejects.toMatchObject({ code: "RETENTION_POLICY_INVALID_TRANSITION" });
  });
});
