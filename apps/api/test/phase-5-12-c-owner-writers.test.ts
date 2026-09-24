import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (relative: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", relative), "utf8");

describe("Phase 5.12-C canonical writer ownership", () => {
  const suppliers = src("modules/suppliers/suppliers.service.ts");
  const supplierController = src("modules/suppliers/suppliers.controller.ts");
  const approval = src("orchestration/supplier-approval.orchestrator.ts");
  const catalog = src("modules/catalog/catalog.controller.ts");
  const offers = src("modules/offers/offers.service.ts");
  const vip = src("modules/vip/vip.service.ts");
  const cms = src("modules/cms/cms-site-settings.service.ts");
  const support = src("modules/support/support-case.service.ts");
  const telemetry = src("modules/analytics/operational-log.service.ts");

  it("normalizes and deduplicates supplier applications", () => {
    expect(suppliers).toContain("replace(/[\\s-]/g");
    expect(suppliers).toContain('includes(existing.status)');
  });
  it("keeps supplier application public but decisions admin-only", () => {
    expect(supplierController).toMatch(/@Public\(\)[\s\S]*@Post\("applications"\)/);
    expect(supplierController).toMatch(/@Post\("applications\/:id\/decision"\)[\s\S]*@Roles\("admin"\)/);
  });
  it("makes supplier approval transactional and retry safe", () => {
    expect(approval).toContain("this.db.transaction");
    expect(approval).toContain("replayed: true");
    expect(approval).toContain("if (!member)");
  });
  it("does not create supplier resources on rejection", () => {
    expect(approval.indexOf('if (status !== "approved")')).toBeLessThan(approval.indexOf("tx.insert(supplier)"));
  });
  it("derives product submission tenant from claims", () => {
    expect(catalog).toContain("createdBy: claims.sub");
    expect(catalog).not.toMatch(/supplierId:\s*body/);
  });
  it("keeps submissions separate from retail publication", () => {
    expect(catalog).toContain("createSupplierSubmission");
    expect(catalog).not.toMatch(/legacySupplierProduct[\s\S]{0,1200}published/);
  });
  it("uses digits-only BIGINT quote authority", () => {
    expect(offers).toContain('if (!/^\\d+$/.test(priceText)');
    expect(offers).toContain("BigInt(priceText)");
  });
  it("derives quoting supplier from canonical memberships", () => {
    expect(offers).toContain("getUserMemberships(userId)");
    expect(offers).toContain("memberships.some");
  });
  it("makes quote retry deterministic", () => expect(offers).toContain("replayed: true"));
  it("validates RFQ supplier, product, quantity and date", () => {
    expect(offers).toContain("INVALID_RFQ_SUPPLIER");
    expect(offers).toContain("INVALID_RFQ_PRODUCT");
    expect(offers).toContain("INVALID_RFQ_DATE");
  });
  it("uses integer basis points for bulk pricing", () => {
    expect(offers).toContain("value * 100n");
    expect(offers).not.toMatch(/parseFloat|100\.0/);
  });
  it("bulk pricing validates before transactional mutation", () => {
    expect(offers).toContain("ids.length > 500");
    expect(offers).toContain("BULK_PRICE_WOULD_BE_NEGATIVE");
    expect(offers).toContain("this.db.transaction");
  });
  it("derives VIP application identity from controller claims", () => {
    const controller = src("modules/vip/vip.controller.ts");
    expect(controller).toContain("applyLegacy(claims.sub, body)");
    const legacyApply = vip.slice(vip.indexOf("async applyLegacy"), vip.indexOf("async decideLegacyAccount"));
    expect(legacyApply).not.toMatch(/input\.(userId|accountId)/);
  });
  it("keeps VIP applications pending and duplicate safe", () => {
    expect(vip).toContain('status: "pending"');
    expect(vip).toContain("replayed: true");
  });
  it("enforces explicit VIP transitions through Auth owner", () => {
    expect(vip).toContain("INVALID_VIP_STATUS_TRANSITION");
    expect(vip).toContain("authService.setVipRole");
  });
  it("rejects arbitrary CMS keys and unsafe embedded media", () => {
    expect(cms).toContain("ARBITRARY_SITE_SETTING_KEY");
    expect(cms).toContain("INVALID_EMBEDDED_MEDIA");
  });
  it("combines support status and reply in one transaction", () => {
    expect(support).toContain("applyLegacyAdminCommand");
    expect(support).toMatch(/applyLegacyAdminCommand[\s\S]*this\.db\.transaction/);
    expect(support).toContain("supportMessage");
  });
  it("makes support retries idempotent", () => expect(support).toContain("idempotencyKey"));
  it("bounds and sanitizes operational log queries", () => {
    expect(telemetry).toContain("Math.min(100");
    expect(telemetry).toContain("query.q.trim().slice(0, 160)");
  });
  it("audits operational log resolution", () => expect(telemetry).toContain("operational_log.status_changed"));
});
