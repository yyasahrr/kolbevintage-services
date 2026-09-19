import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@kolbe/database";
import { MODULES } from "../src/modules/registry";
import { ROOT, bootHarness, seedTwoSuppliers, type Harness, type SupplierContext } from "./helpers/phase-4-7-1.harness";

/**
 * Phase 4.7.5 — security & architecture boundaries: ownership, dependency
 * direction, no IDOR, no client-set verification, no public document URLs,
 * no wallet/payout structures, forward-only migration hygiene.
 */
const TEST_DB = "kolbe_phase_4_7_5_security_test";

let h: Harness;
let ctx: SupplierContext;
const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

const COMPLIANCE_TABLES = [
  "legal_policy_document",
  "legal_policy_acceptance",
  "consent_event",
  "business_legal_profile",
  "business_compliance_credential",
  "supplier_compliance_profile",
  "supplier_compliance_review",
  "supplier_compliance_document",
  "supplier_contract_acceptance",
  "supplier_compliance_hold",
  "supplier_bank_verification",
  "product_compliance_record",
  "product_compliance_document",
  "data_retention_policy",
  "data_subject_request",
  "legal_hold",
  "transaction_compliance_snapshot",
];
const INVOICING_TABLES = ["commercial_invoice", "commercial_invoice_line", "fiscal_document", "fiscal_submission_event", "tax_configuration"];

function readDir(dir: string): Array<{ file: string; content: string }> {
  const out: Array<{ file: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readDir(full));
    else if (entry.name.endsWith(".ts")) out.push({ file: full, content: fs.readFileSync(full, "utf8") });
  }
  return out;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 4.7.5 — ownership & dependency direction (static)", () => {
  it("compliance and invoicing own exactly their tables; nobody else lists them; dependencies point the right way", () => {
    const compliance = MODULES.find((m) => m.name === "compliance")!;
    const invoicing = MODULES.find((m) => m.name === "invoicing")!;
    expect([...compliance.tables].sort()).toEqual([...COMPLIANCE_TABLES].sort());
    expect([...invoicing.tables].sort()).toEqual([...INVOICING_TABLES].sort());
    for (const module of MODULES) {
      if (module.name === "compliance" || module.name === "invoicing") continue;
      expect(module.tables.filter((t) => COMPLIANCE_TABLES.includes(t) || INVOICING_TABLES.includes(t)), module.name).toEqual([]);
    }
    for (const forbidden of ["orders", "payments", "shipping", "inventory", "catalog", "offers", "finance", "fulfillment", "invoicing"]) {
      expect(compliance.dependsOn, `compliance must not depend on ${forbidden}`).not.toContain(forbidden);
    }
    expect(invoicing.dependsOn).toEqual(expect.arrayContaining(["orders", "payments", "compliance", "audit"]));
    // consumers of the gates depend on compliance (never the reverse)
    expect(MODULES.find((m) => m.name === "finance")!.dependsOn).toContain("compliance");
    expect(MODULES.find((m) => m.name === "catalog")!.dependsOn).toContain("compliance");
    expect(MODULES.find((m) => m.name === "offers")!.dependsOn).toContain("compliance");
  });

  it("compliance source never imports orders/payments/shipping/inventory/catalog/offers and uses no forwardRef; invoicing touches owner services only", () => {
    const complianceSources = readDir(path.join(ROOT, "apps/api/src/modules/compliance"));
    for (const { file, content } of complianceSources) {
      expect(content, file).not.toMatch(/modules\/(orders|payments|shipping|inventory|catalog|offers|finance|fulfillment|invoicing)\//);
      expect(content, file).not.toMatch(/forwardRef/);
    }
    const invoicingSources = readDir(path.join(ROOT, "apps/api/src/modules/invoicing"));
    for (const { file, content } of invoicingSources) {
      expect(content, file).not.toMatch(/forwardRef/);
      for (const match of content.matchAll(/from "\.\.\/([a-z-]+)\/([^"]+)"/g)) {
        const [, targetModule, targetFile] = match;
        expect(["audit", "orders", "payments", "vip", "suppliers", "compliance"], `${file} → ${targetModule}`).toContain(targetModule);
        expect(targetFile, `${file} → ${targetModule}/${targetFile}`).toMatch(/\.(service|module|contract)$|^index$/);
      }
      // no speculative real integration in the tax provider port
      expect(content, file).not.toMatch(/\bfetch\(|axios|https?:\/\/(api|sandbox|tp)\./);
    }
  });

  it("no wallet / settlement / payout / withdrawal / balance structures exist anywhere in the schema", () => {
    const names = Object.keys(schema.tables);
    expect(names.filter((n) => /wallet|payout|settlement|withdrawal|balance/i.test(n))).toEqual([]);
    const sql = fs.readFileSync(path.join(ROOT, "packages/database/migrations/0022_phase_4_7_5_iran_compliance_foundation.sql"), "utf8");
    const statementsOnly = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(statementsOnly).not.toMatch(/wallet|payout|settlement_|withdrawal/i);
  });

  it("migration hygiene — 0022 forward-only, chained to 0021, 0020/0021 unchanged in the journal", () => {
    const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/_journal.json"), "utf8"));
    const entries = journal.entries as Array<{ idx: number; tag: string }>;
    expect(entries.at(-1)).toMatchObject({ idx: 22, tag: "0022_phase_4_7_5_iran_compliance_foundation" });
    expect(entries.find((e) => e.idx === 21)?.tag).toBe("0021_phase_4_7_1_provider_shipping_hardening");
    expect(entries.find((e) => e.idx === 20)?.tag).toMatch(/^0020_/);
    const sql = fs.readFileSync(path.join(ROOT, "packages/database/migrations/0022_phase_4_7_5_iran_compliance_foundation.sql"), "utf8");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TABLE "(payment|refund|shipment|wholesale_order|purchase_order)"/i);
    expect(sql).toMatch(/kolbe_compliance_append_only/);
    expect(sql).toMatch(/kolbe_legal_policy_document_guard/);
    expect(sql).toMatch(/kolbe_hold_release_only_guard/);
    expect(sql).toMatch(/kolbe_commercial_invoice_guard/);
    expect((sql.match(/ON DELETE restrict/gi) ?? []).length).toBeGreaterThanOrEqual(50);
    expect(sql).not.toMatch(/ON DELETE cascade/i);
    const snap22 = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/0022_snapshot.json"), "utf8"));
    const snap21 = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/database/migrations/meta/0021_snapshot.json"), "utf8"));
    expect(snap22.prevId).toBe(snap21.id);
    expect(Object.keys(snap22.tables)).toHaveLength(85);
  });

  it("compliance documentation exists and separates legal fact from business policy; no compliance claim is made", () => {
    const register = fs.readFileSync(path.join(ROOT, "docs/compliance/iran-legal-source-register.md"), "utf8");
    expect(register).toMatch(/NOT LEGAL ADVICE/);
    expect(register).toMatch(/NEEDS_EXTERNAL_VERIFICATION/);
    expect(register).toMatch(/S-01/);
    expect(register).toMatch(/BUSINESS_POLICY/);
    const checklist = fs.readFileSync(path.join(ROOT, "docs/compliance/legal-launch-checklist.md"), "utf8");
    for (const level of ["TECHNICALLY IMPLEMENTED", "CONFIGURED", "OFFICIAL SOURCE VERIFIED", "LEGAL COUNSEL APPROVED", "TAX ACCOUNTANT APPROVED", "EXTERNAL PROVIDER APPROVED", "PRODUCTION VERIFIED"]) {
      expect(checklist).toContain(level);
    }
    const classification = fs.readFileSync(path.join(ROOT, "docs/security/data-classification.md"), "utf8");
    expect(classification).toMatch(/normalized_hash|masked/);
    expect(classification).toMatch(/object_key/);
  });
});

describe("Phase 4.7.5 — runtime authorization boundaries (no IDOR, no client-set verification)", () => {
  it("unauthenticated callers reach only public disclosure endpoints", async () => {
    await api().get("/api/v1/legal/policies?scope=RETAIL").expect(200);
    await api().get("/api/v1/legal/business-profile").expect(200);
    await api().get("/api/v1/legal/me/requirements?scope=RETAIL").expect(401);
    await api().get("/api/v1/legal/me/consent").expect(401);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/profile`).expect(401);
    await api().get("/api/v1/admin/compliance/policies").expect(401);
    await api().get("/api/v1/admin/invoicing/tax-config").expect(401);
  });

  it("role and membership checks: buyer/other-supplier get 403 on admin and cross-supplier resources", async () => {
    const buyer = cookie(ctx.userBuyer, "vip");
    const otherSupplier = cookie(ctx.userBOwner, "supplier");
    await api().get("/api/v1/admin/compliance/suppliers").set("Cookie", buyer).expect(403);
    await api().get("/api/v1/admin/compliance/data-requests").set("Cookie", otherSupplier).expect(403);
    await api().post("/api/v1/admin/compliance/legal-holds").set("Cookie", buyer).send({ scopeType: "user", scopeId: ctx.userAOwner, reason: "x" }).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/profile`).set("Cookie", buyer).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/documents`).set("Cookie", otherSupplier).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/bank`).set("Cookie", otherSupplier).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/holds`).set("Cookie", otherSupplier).expect(403);
    await api().post(`/api/v1/supplier/compliance/${ctx.supA}/agreement/accept`).set("Cookie", otherSupplier).send({ policyDocumentId: "x" }).expect(403);
    await api().get(`/api/v1/supplier/compliance/${ctx.supA}/settlement-eligibility`).set("Cookie", otherSupplier).expect(403);
    await api().post("/api/v1/admin/invoicing/tax-config").set("Cookie", otherSupplier).send({ configKey: "VAT_RATE_PERCENT", configValue: { percent: 0 } }).expect(403);
  });

  it("a supplier cannot set its own verification/approval state through any writable field", async () => {
    const owner = cookie(ctx.userAOwner, "supplier");
    const res = await api()
      .put(`/api/v1/supplier/compliance/${ctx.supA}/profile`)
      .set("Cookie", owner)
      .send({ legalName: "Sup A", entityType: "company", representativeName: "R", status: "approved", representativeAuthorityStatus: "verified", approvedAt: new Date().toISOString(), riskFlags: [] })
      .expect(200);
    expect(res.body.profile.status).toBe("draft");
    expect(res.body.profile.representativeAuthorityStatus).toBe("unverified");
    expect(res.body.profile.approvedAt).toBeNull();
    const eligibility = await api().get(`/api/v1/supplier/compliance/${ctx.supA}/settlement-eligibility`).set("Cookie", owner).expect(200);
    expect(eligibility.body.eligible).toBe(false);
  });

  it("acceptance subject always comes from the session; consent and data requests cannot target other users", async () => {
    const buyer = cookie(ctx.userBuyer, "vip");
    const { ComplianceService } = await import("../src/modules/compliance/compliance.service");
    const compliance: any = h.app.get(ComplianceService);
    const draft = await compliance.createPolicyDraft({ userId: ctx.userAdmin, role: "admin" }, { policyType: "PRIVACY_POLICY", scope: "RETAIL", title: "P", contentText: "p" });
    const doc = await compliance.publishPolicy({ userId: ctx.userAdmin, role: "admin" }, draft.id);
    const acc = await api().post("/api/v1/legal/me/acceptances").set("Cookie", buyer).send({ policyDocumentId: doc.id, userId: ctx.userAOwner, subjectHash: "forged" }).expect(201);
    expect(acc.body.acceptance.userId).toBe(ctx.userBuyer);
    expect(acc.body.acceptance.subjectHash).toBe(compliance.subjectHash({ userId: ctx.userBuyer }));
    // a foreign userId in the body is ignored: the event is recorded for the SESSION user only
    const consent = await api().post("/api/v1/legal/me/consent").set("Cookie", buyer).send({ purpose: "MARKETING_EMAIL", eventType: "granted", userId: ctx.userAOwner }).expect(201);
    expect(consent.body.userId).toBe(ctx.userBuyer);
    const state = await compliance.getConsentState(ctx.userAOwner);
    expect(state.history).toHaveLength(0);
    await expect(compliance.recordConsent({ userId: ctx.userBuyer, role: "vip" }, { userId: ctx.userAOwner, purpose: "MARKETING_EMAIL", eventType: "granted" })).rejects.toMatchObject({ code: "COMPLIANCE_ACCESS_DENIED" });
  });

  it("checkout-binding requires the internal service token when one is configured; production without token is refused", async () => {
    const prevToken = process.env.KOLBE_INTERNAL_API_TOKEN;
    const prevEnv = process.env.NODE_ENV;
    const facts = { orderRef: `RT-SEC-${Date.now()}`, currency: "IRR", lines: [], shipping: null, totals: { items: "0", shipping: "0", grand: "0" }, paymentMethod: "gateway" };
    try {
      process.env.KOLBE_INTERNAL_API_TOKEN = "secret-token";
      const denied = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09120000001" }, acceptedPolicyDocumentIds: [], facts }).expect(403);
      expect(denied.body.error).toBe("COMPLIANCE_ACCESS_DENIED");
      await api().post("/api/v1/legal/retail/checkout-binding").set("x-kolbe-internal-token", "wrong").send({ subject: { phone: "09120000001" }, acceptedPolicyDocumentIds: [], facts }).expect(403);
      delete process.env.KOLBE_INTERNAL_API_TOKEN;
      process.env.NODE_ENV = "production";
      const unconfigured = await api().post("/api/v1/legal/retail/checkout-binding").send({ subject: { phone: "09120000001" }, acceptedPolicyDocumentIds: [], facts }).expect(503);
      expect(unconfigured.body.error).toBe("INTERNAL_TOKEN_NOT_CONFIGURED");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevToken === undefined) delete process.env.KOLBE_INTERNAL_API_TOKEN;
      else process.env.KOLBE_INTERNAL_API_TOKEN = prevToken;
    }
  });

  it("signed document URLs are the only download path; object keys never leak; forged tokens are refused", async () => {
    await api().get("/api/v1/legal/documents/access/not-a-token").expect(403);
    const forged = Buffer.from(JSON.stringify({ kind: "supplier_document", documentId: "scd_x", actorId: "x", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
    await api().get(`/api/v1/legal/documents/access/${forged}.bad`).expect(403);
    // the supplier admin overview (admin-only) also never exposes the private object key
    const overview = await api().get(`/api/v1/admin/compliance/suppliers/${ctx.supA}`).set("Cookie", cookie(ctx.userAdmin, "admin")).expect(200);
    expect(JSON.stringify(overview.body)).not.toContain("objectKey");
  });
});
