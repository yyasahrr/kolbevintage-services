import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Phase 5.12-B legacy read authority cutover", () => {
  it.each([
    ["auth/me", "compat@example.test", "/api/v1/auth/me"],
    ["supplier/session", "supplier", "/api/v1/compat/supplier/session"],
    ["supplier/products", "products", "/api/v1/compat/supplier/products"],
    ["supplier/orders", "orders", "/api/v1/compat/supplier/orders"],
    ["supplier/rfqs", "rfqs", "/api/v1/compat/supplier/rfqs"],
    ["supplier/tickets", "tickets", "/api/v1/compat/supplier/tickets"],
    ["wholesale/account", "account", "/api/v1/compat/wholesale/account"],
    ["wholesale/products", "products", "/api/v1/compat/wholesale/products"],
    ["wholesale/orders", "orders", "/api/v1/compat/wholesale/orders"],
    ["admin/accounts", "accounts", "/api/v1/compat/admin/accounts"],
    ["admin/supplier-applications", "applications", "/api/v1/compat/admin/supplier-applications"],
    ["admin/audit-logs", "logs", "/api/v1/compat/admin/audit-logs"],
    ["admin/suppliers", "suppliers", "/api/v1/compat/admin/suppliers"],
    ["admin/catalog", "products", "/api/v1/compat/admin/catalog"],
    ["admin/purchase-orders", "orders", "/api/v1/compat/admin/purchase-orders"],
    ["admin/orders", "orders", "/api/v1/compat/admin/orders"],
    ["admin/rfqs", "rfqs", "/api/v1/compat/admin/rfqs"],
    ["admin/tickets", "tickets", "/api/v1/compat/admin/tickets"],
  ])("proxies GET %s to canonical Nest", async (legacyPath, key, target) => {
    const payload = legacyPath === "auth/me"
      ? { id: "usr_1", email: key, role: "customer" }
      : { [key]: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    const result = await call(legacyPath, { token: "opaque" });
    expect(result.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(target);
  });

  it("fails honestly when canonical reads are unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await call("admin/accounts", { token: "opaque" });
    expect(result).toMatchObject({ status: 503, body: { error: "CANONICAL_API_UNAVAILABLE" } });
  });

  it("keeps every migrated read ahead of database initialization and SQL-free", () => {
    const source = readFileSync(path.join(ROOT, "frontend-next", "server", "kolbe-api.ts"), "utf8");
    const start = source.indexOf("async function cutOverLegacyBusinessRead");
    const end = source.indexOf("async function cutOverLegacyBusinessWrite", start);
    const dispatcher = source.slice(start, end);
    expect(dispatcher).not.toMatch(/\bSELECT\b|\bFROM\s+[a-z_]+/i);
    expect(dispatcher).not.toMatch(/\b(rows|transaction|database)\s*\(/);
    const handler = source.slice(source.indexOf("async function handleRequest"));
    expect(handler.indexOf("cutOverLegacyBusinessRead")).toBeLessThan(handler.indexOf("await database()"));
  });

  it("closes read debt without hiding writer debt", () => {
    const inventory = JSON.parse(readFileSync(
      path.join(ROOT, "docs", "architecture", "phase-5-12-route-inventory.json"), "utf8",
    ));
    expect(inventory.routes.filter((route: any) => route.status === "LEGACY_READ")).toHaveLength(0);
    expect(inventory.routes.filter((route: any) => route.status === "LEGACY_WRITE")).toHaveLength(11);
    expect(inventory.routes).toHaveLength(47);
  });
});
