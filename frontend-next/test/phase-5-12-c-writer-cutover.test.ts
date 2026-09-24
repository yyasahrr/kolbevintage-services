import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("Phase 5.12-C writer and operational convergence", () => {
  it.each([
    ["POST", "supplier/apply", "/api/v1/suppliers/applications"],
    ["POST", "supplier/products", "/api/v1/catalog/compat/supplier-submissions"],
    ["POST", "supplier/rfqs/rfq_1/quote", "/api/v1/offers/compat/rfqs/rfq_1/quote"],
    ["POST", "wholesale/apply", "/api/v1/vip/compat/applications"],
    ["PUT", "admin/site-settings", "/api/v1/cms/compat/site-settings"],
    ["POST", "admin/accounts/wacc_1/status", "/api/v1/vip/compat/accounts/wacc_1/status"],
    ["PATCH", "admin/supplier-applications/sapp_1", "/api/v1/suppliers/applications/sapp_1/decision"],
    ["POST", "admin/catalog/prod_1/status", "/api/v1/catalog/compat/products/prod_1/status"],
    ["POST", "admin/catalog/bulk-price", "/api/v1/offers/compat/bulk-price"],
    ["POST", "admin/rfqs", "/api/v1/offers/compat/rfqs"],
    ["POST", "admin/tickets/case_1", "/api/v1/admin/support/compat/tickets/case_1"],
    ["PATCH", "admin/logs/log_1", "/api/v1/analytics/operational-logs/log_1"],
  ])("proxies %s %s to its canonical owner", async (method, legacyPath, target) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await call(legacyPath, { method, token: "opaque", body: {} });
    expect(result.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(target);
  });

  it("proxies operational log reads with bounded query transport", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ logs: [] }), { status: 200 }));
    const result = await call("admin/logs", { token: "opaque" });
    expect(result.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/analytics/operational-logs");
  });

  it("fails honestly without falling back to SQL", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await call("supplier/apply", { method: "POST", body: { companyName: "x" } });
    expect(result).toMatchObject({ status: 503, body: { error: "CANONICAL_API_UNAVAILABLE" } });
  });

  it("keeps all migrated writes ahead of database initialization and SQL-free", () => {
    const source = readFileSync(path.join(ROOT, "frontend-next", "server", "kolbe-api.ts"), "utf8");
    const start = source.indexOf("async function cutOverLegacyBusinessWrite");
    const end = source.indexOf("function mapLegacySupplierStatusToNest", start);
    const dispatcher = source.slice(start, end);
    expect(dispatcher).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(dispatcher).not.toMatch(/\b(rows|transaction|database)\s*\(/);
    const handler = source.slice(source.indexOf("async function handleRequest"));
    expect(handler.indexOf("cutOverLegacyBusinessWrite")).toBeLessThan(handler.indexOf("await database()"));
    expect(source).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:account_user|supplier(?:_application|_member|_product_submission)?|seller_offer|rfq|quote|wholesale_account|product|retail_order|wholesale_order|purchase_order|support_case|support_ticket|site_setting|audit_log)\b/i);
  });

  it("records a truthful zero-debt inventory", () => {
    const inventory = JSON.parse(readFileSync(path.join(ROOT, "docs", "architecture", "phase-5-12-route-inventory.json"), "utf8"));
    expect(inventory.routes).toHaveLength(47);
    expect(inventory.summary).toMatchObject({ LEGACY_READ: 0, LEGACY_WRITE: 0, MISSING_CANONICAL_SEAM: 0, REMOVE_LATER: 0 });
  });
});
