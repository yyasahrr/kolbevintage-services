import { describe, expect, it } from "vitest";
import { presentAuthError } from "../shared/auth/errors";
import { createApiClient } from "../shared/http/client";
import { ApiError } from "../shared/http/errors";
import type { FetchLike } from "../shared/http/types";
import { createSessionClient } from "../shared/session/auth-client";
import { resolveVipCapabilities, resolveVipGate } from "../shared/vip/membership";

type Route = { method: string; path: string; status: number; body: unknown; headers?: Record<string, string> };
const ME = { id: "usr_server", email: "buyer@kolbe.test", role: "customer", name: "خریدار", phone: "09120000000", totpEnabled: false, supplier: null, vip: { status: "active", accountId: "vip_1", memberName: "خریدار", storeName: "فروشگاه", planName: "حرفه‌ای", expiresAt: null, entitlements: { catalog: true, rfq: false, orders: true } } };

function boundary(routes: Route[], seen: Array<{ method: string; path: string }> = []) {
  const fetch: FetchLike = async (input, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(String(input)).pathname;
    seen.push({ method, path });
    const route = routes.find((candidate) => candidate.method === method && candidate.path === path);
    if (!route) return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(route.body), { status: route.status, headers: { "content-type": "application/json", ...route.headers } });
  };
  return createSessionClient(createApiClient({ baseUrl: "http://api.test/api/v1", fetch }));
}

describe("Checkpoint 03 canonical session", () => {
  it("performs login then reads identity from canonical /auth/me", async () => {
    const seen: Array<{ method: string; path: string }> = [];
    const client = boundary([{ method: "POST", path: "/api/v1/auth/login", status: 200, body: { user: { id: "usr_login", role: "admin" } } }, { method: "GET", path: "/api/v1/auth/me", status: 200, body: ME }], seen);
    const session = await client.login({ email: "buyer@kolbe.test", password: "secret" });
    expect(seen).toEqual([{ method: "POST", path: "/api/v1/auth/login" }, { method: "GET", path: "/api/v1/auth/me" }]);
    expect(session.status).toBe("authenticated");
    if (session.status === "authenticated") expect(session.user.id).toBe("usr_server");
  });

  it("never falls back to the login response when /me fails", async () => {
    const client = boundary([{ method: "POST", path: "/api/v1/auth/login", status: 200, body: { user: { id: "forged", role: "admin" } } }, { method: "GET", path: "/api/v1/auth/me", status: 500, body: { error: "SERVER_ERROR" } }]);
    const result = await client.loginResult({ email: "x@y.test", password: "secret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SERVER_ERROR");
  });

  it("maps only 401 restore to anonymous", async () => {
    const result = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 401, body: { error: "UNAUTHORIZED" } }]).restoreResult();
    expect(result.ok && result.data.status).toBe("anonymous");
  });

  it("keeps 403 restore as forbidden", async () => {
    const result = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 403, body: { error: "FORBIDDEN" } }]).restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("FORBIDDEN");
  });

  it("keeps server and malformed restore failures distinct", async () => {
    const server = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 500, body: { error: "SERVER_ERROR" } }]).restoreResult();
    const malformed = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 200, body: { role: "admin" } }]).restoreResult();
    expect(!server.ok && server.error.kind).toBe("SERVER_ERROR");
    expect(!malformed.ok && malformed.error.kind).toBe("MALFORMED_RESPONSE");
  });

  it("keeps a network failure out of anonymous state", async () => {
    const fetch: FetchLike = async () => { throw new TypeError("offline"); };
    const result = await createSessionClient(createApiClient({ baseUrl: "http://api.test/api/v1", fetch })).restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("NETWORK_ERROR");
  });

  it("uses the canonical logout endpoint", async () => {
    const seen: Array<{ method: string; path: string }> = [];
    const result = await boundary([{ method: "POST", path: "/api/v1/auth/logout", status: 200, body: { ok: true } }], seen).logoutResult();
    expect(result.ok).toBe(true);
    expect(seen).toEqual([{ method: "POST", path: "/api/v1/auth/logout" }]);
  });

  it("derives role, supplier tenant and VIP entitlements only from /me", async () => {
    const body = { ...ME, role: "supplier", supplier: { supplierId: "sup_server", displayName: "کارگاه", legalName: "کارگاه کلبه" } };
    const result = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 200, body }]).restoreResult();
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "authenticated") return;
    expect(result.data.user.role).toBe("supplier");
    expect(result.data.supplier?.supplierId).toBe("sup_server");
    expect(result.data.vip?.entitlements).toEqual({ catalog: true, rfq: false, orders: true });
  });
});

describe("Checkpoint 03 portal gates and truthful errors", () => {
  it("covers anonymous, no-membership, pending, active and entitlement denial", async () => {
    const activeResult = await boundary([{ method: "GET", path: "/api/v1/auth/me", status: 200, body: ME }]).restoreResult();
    if (!activeResult.ok) throw activeResult.error;
    expect(resolveVipGate(undefined).state).toBe("anonymous");
    const noVip = { ...activeResult.data, vip: null };
    expect(resolveVipGate(noVip).state).toBe("ineligible");
    expect(resolveVipGate({ ...activeResult.data, vip: { ...ME.vip, status: "pending" as const } }).state).toBe("pending");
    expect(resolveVipGate(activeResult.data).state).toBe("active");
    expect(resolveVipCapabilities(activeResult.data).rfq).toBe(false);
  });

  it.each([
    [new ApiError({ kind: "UNAUTHORIZED", status: 401, message: "raw" }), "UNAUTHORIZED", "ایمیل یا رمز عبور درست نیست."],
    [new ApiError({ kind: "FORBIDDEN", status: 403, message: "raw" }), "FORBIDDEN", "این حساب به این فضای کاری دسترسی ندارد."],
    [new ApiError({ kind: "RATE_LIMITED", status: 429, retryAfterSeconds: 45, message: "raw" }), "RATE_LIMITED", "۴۵"],
    [new ApiError({ kind: "NETWORK_ERROR", message: "raw" }), "NETWORK_ERROR", "اتصال"],
    [new ApiError({ kind: "SERVER_ERROR", status: 500, message: "raw" }), "SERVER_ERROR", "سرور"],
    [new ApiError({ kind: "MALFORMED_RESPONSE", message: "raw" }), "MALFORMED_RESPONSE", "قرارداد"],
  ])("maps %s without exposing raw server detail", (error, kind, copy) => {
    const presented = presentAuthError(error);
    expect(presented.kind).toBe(kind);
    expect(presented.message).toContain(copy);
    expect(presented.message).not.toContain("raw");
  });

  it("exposes the real server TOTP challenge without inventing MFA", () => {
    const presented = presentAuthError(new ApiError({ kind: "UNAUTHORIZED", status: 401, code: "TOTP_REQUIRED", message: "raw" }));
    expect(presented.kind).toBe("TOTP_REQUIRED");
    expect(presented.message).toContain("کد یک‌بارمصرف");
  });
});
