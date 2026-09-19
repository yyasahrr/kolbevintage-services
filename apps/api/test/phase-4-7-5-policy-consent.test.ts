import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootHarness, confirmToAwaitingPayment, createOrder, makeId, one, q, seedTwoSuppliers, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — A: versioned legal policies, immutable acceptance evidence,
 * consent ≠ contract, scope isolation, retail/wholesale binding points.
 */
const TEST_DB = "kolbe_phase_4_7_5_policy_consent_test";

let h: Harness;
let ctx: SupplierContext;
let compliance: any;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const admin = () => ({ userId: ctx.userAdmin, role: "admin" as const });

async function publish(input: Record<string, unknown>) {
  const draft = await compliance.createPolicyDraft(admin(), input);
  return compliance.publishPolicy(admin(), draft.id);
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  const { ComplianceService } = await import("../src/modules/compliance/compliance.service");
  compliance = h.app.get(ComplianceService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — policy versioning & immutability", () => {
  it("publishes v1, then v2 retires v1 atomically; only one published per (type, scope, locale); old versions stay queryable", async () => {
    const v1 = await publish({ policyType: "COOKIE_NOTICE", scope: "PUBLIC", title: "Cookie v1", contentText: "cookie text v1" });
    expect(v1.status).toBe("published");
    expect(v1.version).toBe(1);
    expect(v1.contentHash).toHaveLength(64);
    expect(v1.acceptanceRequired).toBe(false); // informational types never require acceptance

    const v2 = await publish({ policyType: "COOKIE_NOTICE", scope: "PUBLIC", title: "Cookie v2", contentText: "cookie text v2" });
    expect(v2.version).toBe(2);
    const v1After = await one(h.pool, `SELECT status, retired_at FROM legal_policy_document WHERE id=$1`, [v1.id]);
    expect(v1After.status).toBe("retired");
    expect(v1After.retired_at).not.toBeNull();

    const published = await api().get("/api/v1/legal/policies?scope=PUBLIC").expect(200);
    expect(published.body.policies.filter((p: any) => p.policyType === "COOKIE_NOTICE")).toHaveLength(1);
    expect(published.body.policies[0]).not.toHaveProperty("createdBy");

    const history = await api().get("/api/v1/legal/policies/history?policyType=COOKIE_NOTICE&scope=PUBLIC").expect(200);
    expect(history.body.versions.map((v: any) => v.version)).toEqual([2, 1]);
    const old = await api().get(`/api/v1/legal/policies/${v1.id}`).expect(200);
    expect(old.body.contentText).toBe("cookie text v1");
  });

  it("published text is immutable at service level AND at DB level; drafts are never public", async () => {
    const draft = await compliance.createPolicyDraft(admin(), { policyType: "MARKETING_NOTICE", scope: "PUBLIC", title: "Mkt", contentText: "draft text" });
    await api().get(`/api/v1/legal/policies/${draft.id}`).expect(404);
    await compliance.updatePolicyDraft(admin(), draft.id, { contentText: "draft text 2" });
    const published = await compliance.publishPolicy(admin(), draft.id);
    await expect(compliance.updatePolicyDraft(admin(), published.id, { contentText: "tamper" })).rejects.toMatchObject({ code: "LEGAL_POLICY_IMMUTABLE" });
    await expect(q(h.pool, `UPDATE legal_policy_document SET content_text='tamper' WHERE id=$1`, [published.id])).rejects.toThrow(/immutable/);
    await expect(q(h.pool, `UPDATE legal_policy_document SET acceptance_required = NOT acceptance_required WHERE id=$1`, [published.id])).rejects.toThrow(/immutable/);
    await expect(q(h.pool, `DELETE FROM legal_policy_document WHERE id=$1`, [published.id])).rejects.toThrow(/cannot be deleted/);
    // retire is the only allowed transition; re-publishing a retired row is refused
    await compliance.retirePolicy(admin(), published.id);
    await expect(q(h.pool, `UPDATE legal_policy_document SET status='published' WHERE id=$1`, [published.id])).rejects.toThrow(/re-published/);
    await expect(compliance.publishPolicy(admin(), published.id)).rejects.toMatchObject({ code: "LEGAL_POLICY_INVALID_TRANSITION" });
  });

  it("rejects policy types outside their scope and non-admin authors", async () => {
    await expect(compliance.createPolicyDraft(admin(), { policyType: "SUPPLIER_AGREEMENT", scope: "RETAIL", title: "x", contentText: "y" })).rejects.toMatchObject({ code: "POLICY_SCOPE_MISMATCH" });
    await expect(compliance.createPolicyDraft({ userId: ctx.userBuyer, role: "vip" }, { policyType: "TERMS_OF_SERVICE", scope: "RETAIL", title: "x", contentText: "y" })).rejects.toMatchObject({ code: "ROLE_NOT_ALLOWED" });
    await api().post("/api/v1/admin/compliance/policies").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ policyType: "TERMS_OF_SERVICE", scope: "RETAIL", title: "x", contentText: "y" }).expect(403);
  });
});

describe("Phase 4.7.5 — wholesale gate, acceptance evidence, scope isolation", () => {
  let wholesaleV1: any;

  it("confirm is blocked with LEGAL_POLICY_ACCEPTANCE_REQUIRED once WHOLESALE_TERMS is published; a RETAIL acceptance never substitutes", async () => {
    // Retail terms accepted by the buyer must not unlock the wholesale gate.
    const retailTerms = await publish({ policyType: "TERMS_OF_SERVICE", scope: "RETAIL", title: "Retail ToS", contentText: "retail tos v1" });
    await compliance.acceptPolicyAsUser({ userId: ctx.userBuyer, role: "vip" }, { policyDocumentId: retailTerms.id });

    wholesaleV1 = await publish({ policyType: "WHOLESALE_TERMS", scope: "WHOLESALE_VIP", title: "Wholesale v1", contentText: "wholesale terms v1" });
    const { order } = await createOrder(h, ctx, { qtyA: 2 });
    await expect(confirmToAwaitingPayment(h, order.id, ctx.userBuyer)).rejects.toMatchObject({ code: "LEGAL_POLICY_ACCEPTANCE_REQUIRED" });
    const status = await one(h.pool, `SELECT status FROM wholesale_order WHERE id=$1`, [order.id]);
    expect(status.status).toBe("draft");
    expect(await one(h.pool, `SELECT count(*)::int AS c FROM transaction_compliance_snapshot WHERE wholesale_order_id=$1`, [order.id])).toMatchObject({ c: 0 });

    // HTTP surface exposes the exact missing bundle
    const req = await api().get("/api/v1/legal/me/requirements?scope=WHOLESALE_VIP").set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(req.body.satisfied).toBe(false);
    expect(req.body.missing[0]).toMatchObject({ policyType: "WHOLESALE_TERMS", documentId: wholesaleV1.id, reason: "NEVER_ACCEPTED" });
  });

  it("after the buyer accepts the CURRENT version the confirm succeeds and an immutable snapshot with the policy bundle + commercial hash is recorded", async () => {
    const accepted = await api().post("/api/v1/legal/me/acceptances").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ policyDocumentId: wholesaleV1.id, context: "wholesale_confirm" }).expect(201);
    expect(accepted.body.acceptance.evidenceHash).toHaveLength(64);
    expect(accepted.body.acceptance.subjectHash).toHaveLength(64);
    expect(accepted.body.acceptance).not.toHaveProperty("ip");

    const { order } = await createOrder(h, ctx, { qtyA: 2 });
    const result = await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    expect(result.order.status).toBe("awaiting_payment");
    const snap = await one(h.pool, `SELECT * FROM transaction_compliance_snapshot WHERE wholesale_order_id=$1`, [order.id]);
    expect(snap.scope).toBe("WHOLESALE");
    expect(snap.policy_bundle_hash).toHaveLength(64);
    expect(snap.commercial_snapshot_hash).toHaveLength(64);
    expect(snap.policy_bundle.map((p: any) => p.policyType)).toContain("WHOLESALE_TERMS");
    expect(snap.policy_bundle.map((p: any) => p.policyType)).not.toContain("TERMS_OF_SERVICE");
    await expect(q(h.pool, `UPDATE transaction_compliance_snapshot SET policy_bundle='[]' WHERE id=$1`, [snap.id])).rejects.toThrow(/append-only/);
    await expect(q(h.pool, `DELETE FROM transaction_compliance_snapshot WHERE id=$1`, [snap.id])).rejects.toThrow(/append-only/);

    // acceptance evidence itself is append-only
    await expect(q(h.pool, `UPDATE legal_policy_acceptance SET accepted_at=now() WHERE id=$1`, [accepted.body.acceptance.id])).rejects.toThrow(/append-only/);
    await expect(q(h.pool, `DELETE FROM legal_policy_acceptance WHERE id=$1`, [accepted.body.acceptance.id])).rejects.toThrow(/append-only/);

    // admin evidence lookup
    const lookup = await api().get(`/api/v1/admin/compliance/snapshots/wholesale/${order.id}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(lookup.body.snapshot.id).toBe(snap.id);
  });

  it("a new WHOLESALE_TERMS version forces LEGAL_POLICY_REACCEPTANCE_REQUIRED; an old-version id cannot be accepted anymore", async () => {
    const v2 = await publish({ policyType: "WHOLESALE_TERMS", scope: "WHOLESALE_VIP", title: "Wholesale v2", contentText: "wholesale terms v2" });
    const { order } = await createOrder(h, ctx, { qtyA: 1 });
    await expect(confirmToAwaitingPayment(h, order.id, ctx.userBuyer)).rejects.toMatchObject({ code: "LEGAL_POLICY_REACCEPTANCE_REQUIRED" });
    await expect(compliance.acceptPolicyAsUser({ userId: ctx.userBuyer, role: "vip" }, { policyDocumentId: wholesaleV1.id })).rejects.toMatchObject({ code: "LEGAL_POLICY_VERSION_NOT_ACTIVE" });
    await api().post("/api/v1/legal/me/acceptances").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ policyDocumentId: "lpd_forged" }).expect(404);
    await compliance.acceptPolicyAsUser({ userId: ctx.userBuyer, role: "vip" }, { policyDocumentId: v2.id });
    const ok = await confirmToAwaitingPayment(h, order.id, ctx.userBuyer);
    expect(ok.order.status).toBe("awaiting_payment");
    // history keeps both acceptances (v1 and v2) — nothing rewritten
    const mine = await api().get("/api/v1/legal/me/acceptances").set("Cookie", cookie(ctx.userBuyer, "vip")).expect(200);
    expect(mine.body.acceptances.filter((a: any) => a.policyType === "WHOLESALE_TERMS").map((a: any) => a.version).sort()).toEqual([1, 2]);
  });

  it("a supplier agreement cannot be accepted through the personal portal route", async () => {
    const agreement = await publish({ policyType: "SUPPLIER_AGREEMENT", scope: "SUPPLIER", title: "SA", contentText: "supplier agreement v1" });
    await expect(compliance.acceptPolicyAsUser({ userId: ctx.userAOwner, role: "supplier" }, { policyDocumentId: agreement.id })).rejects.toMatchObject({ code: "POLICY_SCOPE_MISMATCH" });
  });
});

describe("Phase 4.7.5 — consent is not contract acceptance", () => {
  it("accepting Terms creates no consent; grant/withdraw are append-only events; state derives from the latest event", async () => {
    const before = await compliance.getConsentState(ctx.userBuyer);
    expect(Object.values(before.purposes).every((p: any) => p.granted === false)).toBe(true);
    expect(before.history).toHaveLength(0);

    const granted = await api().post("/api/v1/legal/me/consent").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ purpose: "MARKETING_SMS", eventType: "granted", source: "account_settings" }).expect(201);
    expect(granted.body.eventType).toBe("granted");
    expect((await compliance.getConsentState(ctx.userBuyer)).purposes.MARKETING_SMS.granted).toBe(true);
    await api().post("/api/v1/legal/me/consent").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ purpose: "MARKETING_SMS", eventType: "withdrawn" }).expect(201);
    const after = await compliance.getConsentState(ctx.userBuyer);
    expect(after.purposes.MARKETING_SMS.granted).toBe(false);
    expect(after.purposes.MARKETING_EMAIL.granted).toBe(false);
    expect(after.history).toHaveLength(2);
    await expect(q(h.pool, `UPDATE consent_event SET event_type='granted' WHERE id=$1`, [granted.body.id])).rejects.toThrow(/append-only/);
    await expect(q(h.pool, `DELETE FROM consent_event WHERE id=$1`, [granted.body.id])).rejects.toThrow(/append-only/);
  });

  it("rejects unknown purposes and cross-user consent writes", async () => {
    await api().post("/api/v1/legal/me/consent").set("Cookie", cookie(ctx.userBuyer, "vip")).send({ purpose: "SELL_DATA", eventType: "granted" }).expect(400);
    await expect(compliance.recordConsent({ userId: ctx.userBuyer, role: "vip" }, { userId: ctx.userAOwner, purpose: "MARKETING_EMAIL", eventType: "granted" })).rejects.toMatchObject({ code: "COMPLIANCE_ACCESS_DENIED" });
  });
});

describe("Phase 4.7.5 — retail binding point (guest checkout) & disclosure", () => {
  const facts = (orderRef: string) => ({
    orderRef,
    currency: "IRR",
    lines: [{ ref: "SKU-1", name: "Vintage jacket", quantity: 1, unitPrice: "3500000", lineTotal: "3500000" }],
    shipping: { method: "pishtaz", label: "پست پیشتاز", price: "89000" },
    totals: { items: "3500000", shipping: "89000", grand: "3589000" },
    paymentMethod: "gateway",
  });

  it("fails closed when a required RETAIL policy id is not presented; accepts when the exact current ids are; records guest acceptances + immutable snapshot", async () => {
    const privacy = await publish({ policyType: "PRIVACY_POLICY", scope: "RETAIL", title: "Privacy", contentText: "privacy v1" });
    const required = await api().get("/api/v1/legal/requirements?scope=RETAIL").expect(200);
    const requiredIds = required.body.required.map((r: any) => r.documentId);
    expect(requiredIds).toContain(privacy.id);
    expect(requiredIds.length).toBeGreaterThanOrEqual(2); // TERMS_OF_SERVICE + PRIVACY_POLICY

    const ref1 = `RT-TEST-${makeId("a")}`;
    const rejected = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09121234567" }, acceptedPolicyDocumentIds: [privacy.id], facts: facts(ref1) }).expect(409);
    expect(rejected.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");
    expect(await one(h.pool, `SELECT count(*)::int AS c FROM transaction_compliance_snapshot WHERE retail_order_ref=$1`, [ref1])).toMatchObject({ c: 0 });

    const forged = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09121234567" }, acceptedPolicyDocumentIds: ["lpd_forged", ...requiredIds.slice(1)], facts: facts(ref1) }).expect(409);
    expect(forged.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");

    const ok = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "۰۹۱۲۱۲۳۴۵۶۷" }, acceptedPolicyDocumentIds: requiredIds, facts: facts(ref1) }).expect(201);
    expect(ok.body.snapshotId).toMatch(/^tcs_/);
    expect(ok.body.acceptanceIds).toHaveLength(requiredIds.length);
    expect(ok.body.disclosureGaps).toContain("TAX_NOT_ASSESSED");
    const snap = await one(h.pool, `SELECT * FROM transaction_compliance_snapshot WHERE retail_order_ref=$1`, [ref1]);
    expect(snap.scope).toBe("RETAIL");
    expect(snap.user_id).toBeNull();
    expect(snap.disclosure.offer.totals.grand).toBe("3589000");
    expect(snap.disclosure.offer.taxes.status).toBe("NOT_ASSESSED");
    expect(snap.disclosure_hash).toHaveLength(64);
    // guest acceptance: hashed subject, Persian digits normalized to the same hash as Latin digits, no raw phone stored
    const acc = await q(h.pool, `SELECT subject_type, subject_hash, user_id, order_ref FROM legal_policy_acceptance WHERE order_ref=$1`, [ref1]);
    expect(acc).toHaveLength(requiredIds.length);
    expect(acc[0].subject_type).toBe("guest");
    expect(acc[0].user_id).toBeNull();
    expect(acc[0].subject_hash).toBe(compliance.subjectHash({ contact: "0912 123 4567" }));
    const raw = await one(h.pool, `SELECT count(*)::int AS c FROM legal_policy_acceptance WHERE subject_hash LIKE '%0912%'`);
    expect(raw.c).toBe(0);

    // the same order reference can never get a second snapshot
    const dup = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09121234567" }, acceptedPolicyDocumentIds: requiredIds, facts: facts(ref1) }).expect(409);
    expect(dup.body.error).toBe("TRANSACTION_SNAPSHOT_EXISTS");
  });

  it("presenting an older RETAIL version yields LEGAL_POLICY_REACCEPTANCE_REQUIRED", async () => {
    const current = (await api().get("/api/v1/legal/requirements?scope=RETAIL").expect(200)).body.required;
    const oldTos = current.find((r: any) => r.policyType === "TERMS_OF_SERVICE");
    await publish({ policyType: "TERMS_OF_SERVICE", scope: "RETAIL", title: "Retail ToS v2", contentText: "retail tos v2" });
    const ids = current.map((r: any) => r.documentId); // still contains the OLD ToS id
    const res = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09120000000" }, acceptedPolicyDocumentIds: ids, facts: facts(`RT-TEST-${makeId("b")}`) }).expect(409);
    expect(res.body.error).toBe("LEGAL_POLICY_REACCEPTANCE_REQUIRED");
    expect(res.body.message).toContain(oldTos.policyType);
  });

  it("return-policy evaluation is versioned and never guesses a window", async () => {
    const unset = await api().get("/api/v1/legal/return-policy/evaluate?scope=RETAIL&deliveredAt=2026-01-01T00:00:00Z").expect(200);
    expect(unset.body.eligible).toBeNull();
    expect(["RETURN_POLICY_NOT_CONFIGURED", "RETURN_WINDOW_NOT_CONFIGURED"]).toContain(unset.body.reason);

    // A configured version (the number is a TEST value, not a legal claim — see source register S-01/S-10).
    const rp = await publish({ policyType: "RETAIL_RETURN_POLICY", scope: "RETAIL", title: "Returns", contentText: "returns v1", ruleParameters: { returnWindowDays: 7, windowStartsAt: "delivery", sourceReference: "S-01 art. 37 — NEEDS_LEGAL_VERIFICATION" } });
    const inside = await compliance.evaluateReturnEligibility({ scope: "RETAIL", policyDocumentId: rp.id, deliveredAt: new Date(Date.now() - 2 * 86_400_000) });
    expect(inside.eligible).toBe(true);
    expect(inside.policy.version).toBe(1);
    const expired = await compliance.evaluateReturnEligibility({ scope: "RETAIL", policyDocumentId: rp.id, deliveredAt: new Date(Date.now() - 30 * 86_400_000) });
    expect(expired).toMatchObject({ eligible: false, reason: "RETURN_WINDOW_EXPIRED" });
    const undelivered = await compliance.evaluateReturnEligibility({ scope: "RETAIL", policyDocumentId: rp.id, deliveredAt: null });
    expect(undelivered).toMatchObject({ eligible: null, reason: "NOT_DELIVERED_YET" });
    // a RETAIL return policy version can never be applied to a WHOLESALE transaction
    await expect(compliance.evaluateReturnEligibility({ scope: "WHOLESALE", policyDocumentId: rp.id, deliveredAt: new Date() })).rejects.toMatchObject({ code: "POLICY_SCOPE_MISMATCH" });
  });

  it("public business profile is sanitized and shows credentials only when admin-verified", async () => {
    await api().put("/api/v1/admin/compliance/business-profile").set("Cookie", cookie(ctx.userAdmin, "admin")).send({ legalName: null, tradeName: "Kolbe Vintage", internalNotes: "internal only", supportEmail: "support@example.test" }).expect(200);
    const cred = await api().post("/api/v1/admin/compliance/credentials").set("Cookie", cookie(ctx.userAdmin, "admin")).send({ credentialType: "ENAMAD", issuer: "مرکز توسعه تجارت الکترونیکی", publicReference: "PLACEHOLDER-NOT-REAL" }).expect(201);
    expect(cred.body.credential.status).toBe("unverified");

    const pub = await api().get("/api/v1/legal/business-profile").expect(200);
    expect(pub.body.tradeName).toBe("Kolbe Vintage");
    expect(pub.body.legalName).toBeNull();
    expect(pub.body).not.toHaveProperty("internalNotes");
    expect(pub.body.verifiedCredentials).toEqual([]);
    expect(pub.body.disclosureComplete).toBe(false);
    expect(pub.body.disclosureGaps).toContain("LEGAL_NAME_MISSING");

    // a non-admin cannot flip verification; admin verification requires a source
    await api().post(`/api/v1/admin/compliance/credentials/${cred.body.credential.id}/status`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ status: "verified", verificationSource: "x" }).expect(403);
    await api().post(`/api/v1/admin/compliance/credentials/${cred.body.credential.id}/status`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "verified" }).expect(400);
    await api().post(`/api/v1/admin/compliance/credentials/${cred.body.credential.id}/status`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "verified", verificationSource: "manual check on enamad.ir (test)" }).expect(201);
    const pub2 = await api().get("/api/v1/legal/business-profile").expect(200);
    expect(pub2.body.verifiedCredentials).toHaveLength(1);
    expect(pub2.body.verifiedCredentials[0]).not.toHaveProperty("notes");
    const audit = await one(h.pool, `SELECT count(*)::int AS c FROM audit_log WHERE action='business_credential.verified' AND entity_id=$1`, [cred.body.credential.id]);
    expect(audit.c).toBe(1);
  });
});
