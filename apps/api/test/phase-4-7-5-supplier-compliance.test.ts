import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootHarness, makeId, one, q, seedTwoSuppliers, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — B: supplier KYB profile, private documents, contract acceptance,
 * holds, bank-destination metadata and the read-only settlement eligibility contract.
 */
const TEST_DB = "kolbe_phase_4_7_5_supplier_compliance_test";

let h: Harness;
let ctx: SupplierContext;
let compliance: any;
let supplierCompliance: any;
let signer: any;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());
const admin = () => ({ userId: ctx.userAdmin, role: "admin" as const });
const asUser = (userId: string, role: "supplier" | "admin" | "vip") => ({ userId, role });

/** Builds a syntactically valid Iranian IBAN (IR + 2 check digits + 22-digit BBAN) — a TEST value, not a real account. */
function testIban(bban22: string): string {
  const numeric = `${bban22}1827` + "00"; // I=18, R=27
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  const check = String(98 - rem).padStart(2, "0");
  return `IR${check}${bban22}`;
}

const PDF = Buffer.from("%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString("base64");

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  const { ComplianceService } = await import("../src/modules/compliance/compliance.service");
  const { SupplierComplianceService } = await import("../src/modules/compliance/supplier-compliance.service");
  const { DocumentAccessSigner } = await import("../src/modules/compliance/document-storage");
  compliance = h.app.get(ComplianceService);
  supplierCompliance = h.app.get(SupplierComplianceService);
  signer = h.app.get(DocumentAccessSigner);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — settlement eligibility starts closed (read-only contract, no money)", () => {
  it("a fresh supplier is NOT eligible and every reason is explicit", async () => {
    const e = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toEqual(expect.arrayContaining(["SUPPLIER_COMPLIANCE_PROFILE_MISSING", "SUPPLIER_CONTRACT_NOT_ACCEPTED", "SUPPLIER_BANK_NOT_VERIFIED"]));
    expect(e.policy.bankVerificationRequired).toBe(true);
    expect(e).not.toHaveProperty("balance");
    expect(e).not.toHaveProperty("payout");
  });

  it("no wallet / settlement / payout / withdrawal table exists (Phase 4.8 not started)", async () => {
    const rows = await q(h.pool, `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%wallet%' OR table_name ILIKE '%payout%' OR table_name ILIKE '%settlement%' OR table_name ILIKE '%withdrawal%')`);
    expect(rows).toEqual([]);
  });
});

describe("Phase 4.7.5 — KYB profile lifecycle with membership-based authorization", () => {
  it("sales member cannot edit; owner creates; incomplete submit is refused; submitted profile is locked for the supplier", async () => {
    await api().put(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userASales, "supplier")).send({ legalName: "x" }).expect(403);
    await expect(supplierCompliance.upsertProfile(asUser(ctx.userBOwner, "supplier"), ctx.supA, { legalName: "intruder" })).rejects.toMatchObject({ code: "SUPPLIER_MEMBERSHIP_REQUIRED" });

    const created = await api().put(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ legalName: "Sup A LLC", entityType: "company" }).expect(200);
    expect(created.body.profile.status).toBe("draft");
    expect(created.body.profile).not.toHaveProperty("riskFlags");

    const incomplete = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/profile/submit`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(409);
    expect(incomplete.body.error).toBe("SUPPLIER_COMPLIANCE_PROFILE_INCOMPLETE");

    await api().put(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userAFinance, "supplier")).send({ representativeName: "Ali", representativeAuthorityDeclared: true }).expect(200);
    const submitted = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/profile/submit`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(201);
    expect(submitted.body.profile.status).toBe("submitted");
    expect(submitted.body.profile.representativeAuthorityStatus).toBe("declared");
    const locked = await api().put(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ legalName: "changed" }).expect(409);
    expect(locked.body.error).toBe("SUPPLIER_COMPLIANCE_PROFILE_LOCKED");
    // other supplier's owner cannot read it
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
  });

  it("admin review: under_review → approved (with representative verification); reviews are immutable; invalid transitions are refused", async () => {
    await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/review`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ decision: "approved" }).expect(403);
    const rejectedWithoutNotes = await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ decision: "rejected" }).expect(400);
    expect(rejectedWithoutNotes.body.error).toBe("VALIDATION_ERROR");
    const ur = await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ decision: "under_review" }).expect(201);
    expect(ur.body.profile.status).toBe("under_review");
    const approved = await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ decision: "approved", representativeAuthorityVerified: true, riskFlags: ["high_value_goods"] }).expect(201);
    expect(approved.body.profile.status).toBe("approved");
    expect(approved.body.profile.representativeAuthorityStatus).toBe("verified");
    const again = await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ decision: "approved" }).expect(409);
    expect(again.body.error).toBe("SUPPLIER_COMPLIANCE_INVALID_TRANSITION");
    const reviews = await q(h.pool, `SELECT * FROM supplier_compliance_review WHERE supplier_id=$1 ORDER BY created_at`, [ctx.supA]);
    expect(reviews.map((r: any) => r.decision)).toEqual(["under_review", "approved"]);
    await expect(q(h.pool, `UPDATE supplier_compliance_review SET decision='rejected' WHERE id=$1`, [reviews[0].id])).rejects.toThrow(/append-only/);
    await expect(q(h.pool, `DELETE FROM supplier_compliance_review WHERE id=$1`, [reviews[0].id])).rejects.toThrow(/append-only/);
    // supplier view never exposes reviewer notes / risk flags
    const view = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", cookie(ctx.userASales, "supplier")).expect(200);
    expect(view.body.profile).not.toHaveProperty("riskFlags");
    const audit = await one(h.pool, `SELECT count(*)::int AS c FROM audit_log WHERE action='supplier_compliance.approved'`);
    expect(audit.c).toBe(1);
  });
});

describe("Phase 4.7.5 — private documents", () => {
  let documentId: string;

  it("accepts an allow-listed PDF, stores metadata + checksum only, never returns the object key", async () => {
    const res = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", cookie(ctx.userAFinance, "supplier")).send({ documentType: "business_license", mimeType: "application/pdf", contentBase64: PDF, originalFilename: "../../etc/passwd license.pdf" }).expect(201);
    documentId = res.body.document.id;
    expect(res.body.document.checksumSha256).toHaveLength(64);
    expect(res.body.document.originalFilename).not.toContain("..");
    expect(res.body.document.scanStatus).toBe("unavailable");
    expect(res.body.document.reviewStatus).toBe("pending");
    expect(res.body.document).not.toHaveProperty("objectKey");
    const list = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", cookie(ctx.userAWarehouse, "supplier")).expect(200);
    expect(list.body.documents[0]).not.toHaveProperty("objectKey");
    expect(JSON.stringify(list.body)).not.toMatch(/supplier\/[0-9a-f]{16}\//);
  });

  it("rejects disallowed MIME types, mismatched content and oversized uploads", async () => {
    const bad = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ documentType: "other", mimeType: "text/html", contentBase64: Buffer.from("<script>").toString("base64") }).expect(415);
    expect(bad.body.error).toBe("DOCUMENT_TYPE_NOT_ALLOWED");
    const mismatch = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ documentType: "other", mimeType: "application/pdf", contentBase64: PNG }).expect(400);
    expect(mismatch.body.error).toBe("DOCUMENT_CONTENT_MISMATCH");
    const prev = process.env.KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES;
    process.env.KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES = "16";
    try {
      const big = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ documentType: "other", mimeType: "application/pdf", contentBase64: PDF }).expect(413);
      expect(big.body.error).toBe("DOCUMENT_TOO_LARGE");
    } finally {
      if (prev === undefined) delete process.env.KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES;
      else process.env.KOLBE_COMPLIANCE_MAX_DOCUMENT_BYTES = prev;
    }
  });

  it("signed access: owner/admin only, short-lived, tamper-proof; download is checksum-verified and audited", async () => {
    await api().post(`/api/v1/supplier/compliance/documents/${documentId}/access`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    await api().post(`/api/v1/supplier/compliance/documents/${documentId}/access`).set("Cookie", cookie(ctx.userASales, "supplier")).expect(403);
    const issued = await api().post(`/api/v1/supplier/compliance/documents/${documentId}/access`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(201);
    expect(issued.body.url).toMatch(/^\/api\/v1\/legal\/documents\/access\//);
    const ttl = new Date(issued.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);

    const download = await api().get(issued.body.url).expect(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["cache-control"]).toContain("no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");

    const tampered = await api().get(`${issued.body.url}x`).expect(403);
    expect(tampered.body.error).toBe("DOCUMENT_URL_INVALID");
    const token = issued.body.url.split("/").pop();
    expect(() => signer.verify(token, Date.now() + 16 * 60 * 1000)).toThrow(/منقضی/);

    const adminAccess = await api().post(`/api/v1/admin/compliance/suppliers/documents/${documentId}/access`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(201);
    expect(adminAccess.body.url).toBeTruthy();
    const audits = await q(h.pool, `SELECT action FROM audit_log WHERE entity_id=$1 ORDER BY created_at`, [documentId]);
    expect(audits.map((a: any) => a.action)).toEqual(expect.arrayContaining(["supplier_compliance.document_uploaded", "supplier_compliance.document_access_issued", "supplier_compliance.document_downloaded"]));
  });

  it("admin review of a document is one-shot and requires a reason to reject", async () => {
    await api().post(`/api/v1/admin/compliance/suppliers/documents/${documentId}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reviewStatus: "rejected" }).expect(400);
    const ok = await api().post(`/api/v1/admin/compliance/suppliers/documents/${documentId}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reviewStatus: "approved", scanStatus: "clean" }).expect(201);
    expect(ok.body.document).toMatchObject({ reviewStatus: "approved", scanStatus: "clean" });
    const twice = await api().post(`/api/v1/admin/compliance/suppliers/documents/${documentId}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reviewStatus: "approved" }).expect(409);
    expect(twice.body.error).toBe("DOCUMENT_REVIEW_INVALID_TRANSITION");
  });
});

describe("Phase 4.7.5 — supplier agreement acceptance is bound to an authorized member", () => {
  let agreementV1: any;

  it("only the owner role may bind the supplier; acceptance is unique, immutable and replay-safe", async () => {
    const draft = await compliance.createPolicyDraft(admin(), { policyType: "SUPPLIER_AGREEMENT", scope: "SUPPLIER", title: "Supplier Agreement", contentText: "agreement v1" });
    agreementV1 = await compliance.publishPolicy(admin(), draft.id);
    const before = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(before.reasons).toContain("SUPPLIER_CONTRACT_NOT_ACCEPTED");

    const sales = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userASales, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(403);
    expect(sales.body.error).toBe("SUPPLIER_ROLE_NOT_AUTHORIZED");
    const finance = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userAFinance, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(403);
    expect(finance.body.error).toBe("SUPPLIER_ROLE_NOT_AUTHORIZED");
    await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userBOwner, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(403);
    await expect(supplierCompliance.acceptSupplierAgreement(admin(), ctx.supA, { policyDocumentId: agreementV1.id })).rejects.toMatchObject({ code: "SUPPLIER_ROLE_NOT_AUTHORIZED" });

    const ok = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(201);
    expect(ok.body.replayed).toBe(false);
    expect(ok.body.acceptance.memberRole).toBe("owner");
    expect(ok.body.acceptance.acceptedByUserId).toBe(ctx.userAOwner);
    const replay = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(await one(h.pool, `SELECT count(*)::int AS c FROM supplier_contract_acceptance WHERE supplier_id=$1`, [ctx.supA])).toMatchObject({ c: 1 });
    await expect(q(h.pool, `UPDATE supplier_contract_acceptance SET member_role='sales' WHERE id=$1`, [ok.body.acceptance.id])).rejects.toThrow(/append-only/);
    await expect(q(h.pool, `DELETE FROM supplier_contract_acceptance WHERE id=$1`, [ok.body.acceptance.id])).rejects.toThrow(/append-only/);
    const snap = await one(h.pool, `SELECT scope, supplier_id FROM transaction_compliance_snapshot WHERE supplier_id=$1 AND scope='SUPPLIER'`, [ctx.supA]);
    expect(snap.supplier_id).toBe(ctx.supA);

    const status = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/agreement`).set("Cookie", cookie(ctx.userAWarehouse, "supplier")).expect(200);
    expect(status.body.satisfied).toBe(true);
    const after = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(after.reasons).not.toContain("SUPPLIER_CONTRACT_NOT_ACCEPTED");
  });

  it("a new agreement version makes the contract OUTDATED until re-accepted", async () => {
    const draft = await compliance.createPolicyDraft(admin(), { policyType: "SUPPLIER_AGREEMENT", scope: "SUPPLIER", title: "Supplier Agreement v2", contentText: "agreement v2" });
    const v2 = await compliance.publishPolicy(admin(), draft.id);
    const outdated = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(outdated.reasons).toContain("SUPPLIER_CONTRACT_OUTDATED");
    const old = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ policyDocumentId: agreementV1.id }).expect(409);
    expect(old.body.error).toBe("LEGAL_POLICY_VERSION_NOT_ACTIVE");
    await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ policyDocumentId: v2.id }).expect(201);
    const current = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(current.reasons).not.toContain("SUPPLIER_CONTRACT_OUTDATED");
  });
});

describe("Phase 4.7.5 — holds and bank destination metadata", () => {
  it("an active hold blocks eligibility; release is the only transition and history is immutable", async () => {
    const hold = await api().post(`/api/v1/admin/compliance/suppliers/${ctx.supA}/holds`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ reasonCode: "manual_review", notes: "internal reviewer note" }).expect(201);
    expect((await supplierCompliance.getSupplierSettlementEligibility(ctx.supA)).reasons).toContain("SUPPLIER_COMPLIANCE_HOLD_ACTIVE");
    const supplierView = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/holds`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(200);
    expect(supplierView.body.holds[0]).toMatchObject({ reasonCode: "manual_review", status: "active" });
    expect(supplierView.body.holds[0]).not.toHaveProperty("notes");
    await expect(q(h.pool, `UPDATE supplier_compliance_hold SET reason_code='other' WHERE id=$1`, [hold.body.hold.id])).rejects.toThrow(/only the transition active -> released/);
    await expect(q(h.pool, `DELETE FROM supplier_compliance_hold WHERE id=$1`, [hold.body.hold.id])).rejects.toThrow(/cannot be deleted/);
    await api().post(`/api/v1/admin/compliance/suppliers/holds/${hold.body.hold.id}/release`).set("Cookie", cookie(ctx.userAOwner, "supplier")).expect(403);
    const released = await api().post(`/api/v1/admin/compliance/suppliers/holds/${hold.body.hold.id}/release`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ releaseNotes: "cleared" }).expect(201);
    expect(released.body.hold.status).toBe("released");
    const twice = await api().post(`/api/v1/admin/compliance/suppliers/holds/${hold.body.hold.id}/release`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(409);
    expect(twice.body.error).toBe("HOLD_ALREADY_RELEASED");
    await expect(q(h.pool, `UPDATE supplier_compliance_hold SET status='active', released_at=NULL, released_by=NULL WHERE id=$1`, [hold.body.hold.id])).rejects.toThrow(/already released/);
    expect((await supplierCompliance.getSupplierSettlementEligibility(ctx.supA)).reasons).not.toContain("SUPPLIER_COMPLIANCE_HOLD_ACTIVE");
  });

  it("bank destination: format-validated, stored as mask + keyed hash only, verified by admin only, superseded safely", async () => {
    const invalid = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ destinationKind: "iban", value: "IR000000000000000000000001" }).expect(400);
    expect(invalid.body.error).toBe("BANK_DESTINATION_INVALID");
    await api().post(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", cookie(ctx.userASales, "supplier")).send({ destinationKind: "iban", value: testIban("0620170000001234567890") }).expect(403);

    const iban = testIban("0620170000001234567890");
    const submitted = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", cookie(ctx.userAFinance, "supplier")).send({ destinationKind: "iban", value: `${iban.slice(0, 4)} ${iban.slice(4)}`, holderName: "Sup A LLC" }).expect(201);
    expect(submitted.body.verification.status).toBe("pending");
    expect(submitted.body.verification.maskedValue).toMatch(/^IR\d{2}\*+7890$/);
    expect(submitted.body.verification).not.toHaveProperty("normalizedHash");
    const row = await one(h.pool, `SELECT * FROM supplier_bank_verification WHERE id=$1`, [submitted.body.verification.id]);
    expect(JSON.stringify(row)).not.toContain(iban);
    expect(row.normalized_hash).toHaveLength(64);
    expect(row.normalized_hash).not.toBe(iban);
    expect((await supplierCompliance.getSupplierSettlementEligibility(ctx.supA)).reasons).toContain("SUPPLIER_BANK_NOT_VERIFIED");

    // same destination again → replay, no new row
    const replay = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ destinationKind: "iban", value: iban }).expect(201);
    expect(replay.body.replayed).toBe(true);

    await api().post(`/api/v1/admin/compliance/suppliers/bank/${submitted.body.verification.id}/review`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ status: "verified", verificationSource: "self" }).expect(403);
    const verified = await api().post(`/api/v1/admin/compliance/suppliers/bank/${submitted.body.verification.id}/review`).set("Cookie", cookie(ctx.userAdmin, "admin")).send({ status: "verified", holderMatchStatus: "matched", verificationSource: "manual_admin" }).expect(201);
    expect(verified.body.verification).toMatchObject({ status: "verified", holderMatchStatus: "matched" });
    const eligible = await supplierCompliance.getSupplierSettlementEligibility(ctx.supA);
    expect(eligible.reasons).not.toContain("SUPPLIER_BANK_NOT_VERIFIED");

    // a different destination supersedes the current one (single current row per supplier)
    const second = await api().post(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", cookie(ctx.userAOwner, "supplier")).send({ destinationKind: "card", value: "6037991234567893" }).expect(201);
    expect(second.body.verification.status).toBe("pending");
    const current = await q(h.pool, `SELECT id, is_current FROM supplier_bank_verification WHERE supplier_id=$1 AND is_current=true`, [ctx.supA]);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(second.body.verification.id);
  });

  it("all gates satisfied ⇒ eligible=true with empty reasons (still no payout capability)", async () => {
    // re-verify the (now current) card destination
    const [cur] = await q(h.pool, `SELECT id FROM supplier_bank_verification WHERE supplier_id=$1 AND is_current=true`, [ctx.supA]);
    await supplierCompliance.reviewBankDestination(admin(), cur.id, { status: "verified", verificationSource: "manual_admin" });
    const e = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/settlement-eligibility`).set("Cookie", cookie(ctx.userAFinance, "supplier")).expect(200);
    expect(e.body).toMatchObject({ eligible: true, reasons: [] });
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/settlement-eligibility`).set("Cookie", cookie(ctx.userASales, "supplier")).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/settlement-eligibility`).set("Cookie", cookie(ctx.userBOwner, "supplier")).expect(403);
    // supplier B has done nothing → still closed
    const b = await supplierCompliance.getSupplierSettlementEligibility(ctx.supB);
    expect(b.eligible).toBe(false);
  });
});
