import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./helpers";
import { rows } from "../server/database";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const fetchMock = vi.fn();

function upstream(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KOLBE_INTERNAL_API_TOKEN = "phase-5-12-test-internal-token-long-enough";
});

afterEach(() => vi.unstubAllGlobals());

describe("Phase 5.12-A compatibility write cutover", () => {
  it("keeps the route inventory complete and explicitly classified", () => {
    const inventory = JSON.parse(readFileSync(
      path.join(ROOT, "docs", "architecture", "phase-5-12-route-inventory.json"),
      "utf8",
    ));
    const allowed = new Set([
      "NEXT_PROXY_TO_NEST", "LEGACY_READ", "LEGACY_WRITE", "DEPRECATED",
      "REMOVE_LATER", "STATIC/MOCK",
    ]);
    expect(inventory.routes).toHaveLength(47);
    expect(inventory.routes.every((route: { status?: string }) => route.status && allowed.has(route.status))).toBe(true);
  });

  it("forwards auth identity input to Nest and preserves response/cookie compatibility", async () => {
    fetchMock.mockResolvedValueOnce(upstream(
      { user: { id: "usr_1", email: "a@example.test", role: "customer" } },
      201,
      { "set-cookie": "kolbe_session=signed; HttpOnly; SameSite=Lax; Path=/", "x-kolbe-session-token": "signed" },
    ));
    const result = await call("auth/register", { method: "POST", body: { email: "a@example.test", password: "Password1405!", name: "A" } });
    expect(result.status).toBe(201);
    expect(result.body.token).toBe("signed");
    expect(result.headers.get("set-cookie")).toContain("HttpOnly");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/register$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "a@example.test", name: "A" });
    expect(new Headers(init.headers).get("x-kolbe-internal-token")).toBe(process.env.KOLBE_INTERNAL_API_TOKEN);
  });

  it("forwards idempotency and never recalculates monetary input", async () => {
    fetchMock.mockResolvedValueOnce(upstream({ id: "case_1", replayed: true }, 200));
    const body = { subject: "price evidence", message: "unchanged", estimatedAmount: "999999", idempotencyKey: "support-cutover-key" };
    await call("supplier/tickets", { method: "POST", body, headers: { "idempotency-key": "support-cutover-key" } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("idempotency-key")).toBe("support-cutover-key");
    expect(JSON.parse(String(init.body))).toEqual({
      subject: body.subject,
      category: "SUPPLIER",
      priority: "NORMAL",
      initialMessage: body.message,
    });
  });

  it.each([401, 403, 409, 422])("preserves canonical %s failures", async (status) => {
    fetchMock.mockResolvedValueOnce(upstream({ error: `E_${status}`, message: "safe" }, status));
    const result = await call("auth/login", { method: "POST", body: { email: "x@example.test", password: "bad" } });
    expect(result).toMatchObject({ status, body: { error: `E_${status}`, message: "safe" } });
  });

  it("fails honestly when Nest is unavailable and does not write locally", async () => {
    const before = Number((await rows<{ count: string }>("SELECT count(*) AS count FROM account_user"))[0].count);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const result = await call("auth/register", { method: "POST", body: { email: "offline@example.test", password: "Password1405!" } });
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("CANONICAL_API_UNAVAILABLE");
    const after = Number((await rows<{ count: string }>("SELECT count(*) AS count FROM account_user"))[0].count);
    expect(after).toBe(before);
  });

  it("keeps the migrated dispatcher before database initialization and free of SQL", () => {
    const source = readFileSync(path.join(ROOT, "frontend-next", "server", "kolbe-api.ts"), "utf8");
    const start = source.indexOf("async function cutOverLegacyBusinessWrite");
    const end = source.indexOf("function mapLegacySupplierStatusToNest", start);
    const dispatcher = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(dispatcher).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM)\b/i);
    expect(dispatcher).not.toMatch(/\b(rows|transaction|database)\s*\(/);
    const handler = source.slice(source.indexOf("async function handleRequest"));
    expect(handler.indexOf("cutOverLegacyBusinessWrite")).toBeLessThan(handler.indexOf("await database()"));
  });
});
