/**
 * تست‌های مرزِ نشست/احراز هویت (فاز ۶.۱-B).
 *
 * محورِ این تست‌ها یک قاعده است: **هویت فقط از سرور می‌آید.** نقش، شناسهٔ
 * تأمین‌کننده، وضعیتِ VIP و مجوزها هرگز از بدنهٔ لاگین، localStorage یا مسیر
 * استنتاج نمی‌شوند.
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError, createApiClient } from "../shared/http";
import { hasPermission } from "../shared/permissions/capabilities";
import {
  anonymousSession,
  capabilitiesFor,
  createSessionClient,
  createSessionStore,
  parseAuthMeResponse,
  sessionAsyncState,
  type SessionClient,
} from "../shared/session";
import { useSession } from "../shared/session/react";
import {
  SESSION_PRESENTATION_CACHE_KEY,
  clearPresentationCache,
  isPresentationCacheConsistent,
  readPresentationCache,
  writePresentationCache,
  type KeyValueStorage,
} from "../shared/session/presentation-cache";
import { CANONICAL_AUTH_PATHS } from "../shared/session/types";

type Route = { method: string; path: string };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

type Step = { match: (route: Route) => boolean; respond: () => Response };

function stub(script: Step[], calls: Route[] = []) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const route: Route = { method: init.method ?? "GET", path: new URL(input).pathname };
    calls.push(route);
    for (const step of script) {
      if (step.match(route)) return step.respond();
    }
    throw new TypeError(`درخواستِ پیش‌بینی‌نشده: ${route.method} ${route.path}`);
  };
}

function sessionClient(script: Step[], calls: Route[] = []) {
  return createSessionClient(createApiClient({ baseUrl: "http://api.test/api/v1", fetch: stub(script, calls) }));
}

function storeFor(script: Step[]): ReturnType<typeof createSessionStore> {
  return createSessionStore(sessionClient(script));
}

const ME_PAYLOAD = {
  id: "usr_1",
  email: "vip@boutique.ir",
  role: "vip",
  name: "نگار",
  phone: "09120000000",
  totpEnabled: false,
  supplier: null,
};

const SUPPLIER_ME = {
  id: "usr_2",
  role: "supplier",
  email: "nilgoon@kolbe.ir",
  name: null,
  phone: null,
  totpEnabled: false,
  supplier: { supplierId: "sup_7", displayName: "نیلگون", legalName: "نیلگون پوش", status: "approved" },
};

describe("Phase 6.1-B shared session boundary", () => {
  it("restores identity from the server and builds an authenticated session", async () => {
    const client = sessionClient([
      { match: (r) => r.method === "GET" && r.path === "/api/v1/auth/me", respond: () => jsonResponse(ME_PAYLOAD) },
    ]);
    const session = await client.restore();
    expect(session.status).toBe("authenticated");
    if (session.status !== "authenticated") return;
    expect(session.user.id).toBe("usr_1");
    expect(session.user.role).toBe("vip");
    expect(session.source).toBe("server");
    expect(session.capabilities.roles).toEqual(["vip"]);
  });

  it("uses the canonical auth paths registered in the truth registry", () => {
    expect(CANONICAL_AUTH_PATHS).toEqual({ login: "/auth/login", logout: "/auth/logout", me: "/auth/me" });
  });

  it("logs in and then re-reads identity from the server instead of trusting the login body", async () => {
    const calls: Route[] = [];
    const client = sessionClient(
      [
        {
          match: (r) => r.method === "POST" && r.path === "/api/v1/auth/login",
          respond: () => jsonResponse({ user: { id: "usr_1", email: "vip@boutique.ir", role: "vip", name: "نگار", phone: null } }),
        },
        { match: (r) => r.method === "GET" && r.path === "/api/v1/auth/me", respond: () => jsonResponse(ME_PAYLOAD) },
      ],
      calls,
    );
    const session = await client.login({ email: "vip@boutique.ir", password: "secret" });
    expect(session.status).toBe("authenticated");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/v1/auth/login",
      "GET /api/v1/auth/me",
    ]);
  });

  it("does not invent an identity when the profile read fails after a successful login", async () => {
    const client = sessionClient([
      { match: (r) => r.method === "POST" && r.path === "/api/v1/auth/login", respond: () => jsonResponse({ user: { id: "usr_1", role: "vip" } }) },
      { match: (r) => r.method === "GET" && r.path === "/api/v1/auth/me", respond: () => jsonResponse({ error: "INTERNAL_ERROR", message: "boom" }, 500) },
    ]);
    const result = await client.loginResult({ email: "v@b.ir", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("SERVER_ERROR");
  });

  it("treats 401 as a valid anonymous answer and 500 as a real failure", async () => {
    const one = await sessionClient([
      { match: () => true, respond: () => jsonResponse({ error: "UNAUTHORIZED", message: "no session" }, 401) },
    ]).restore();
    expect(one.status).toBe("anonymous");

    const two = await sessionClient([
      { match: () => true, respond: () => jsonResponse({ error: "INTERNAL_ERROR" }, 500) },
    ]).restoreResult();
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.kind).toBe("SERVER_ERROR");
  });

  it("reports a malformed session payload instead of guessing a role", async () => {
    const result = await sessionClient([
      { match: () => true, respond: () => jsonResponse({ email: "x@y.z" }) },
    ]).restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MALFORMED_RESPONSE");
      expect(result.error.code).toBe("SESSION_CONTRACT_VIOLATION");
    }
  });

  it("marks an unknown server role as unknown rather than granting access", () => {
    const parsed = parseAuthMeResponse({ id: "usr_9", role: "wizard" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.user.role).toBe("unknown");
    expect(hasPermission(capabilitiesFor(parsed.value.user, null), "admin:anything")).toBe(false);
  });

  it("takes the supplier tenant from the server, never from the client", async () => {
    const session = await sessionClient([
      { match: () => true, respond: () => jsonResponse(SUPPLIER_ME) },
    ]).restore();
    if (session.status !== "authenticated") throw new Error("نشست معتبر نشد");
    expect(session.supplier?.supplierId).toBe("sup_7");
    expect(session.capabilities.supplierId).toBe("sup_7");
  });

  it("merges server-provided permissions without granting anything implicitly", async () => {
    const client = createSessionClient(
      createApiClient({
        baseUrl: "http://api.test/api/v1",
        fetch: stub([{ match: () => true, respond: () => jsonResponse({ ...ME_PAYLOAD, role: "admin" }) }]),
      }),
      {
        permissionsLoader: async () => ({
          ok: true as const,
          data: ["crm:view"] as readonly string[],
          meta: { status: 200, url: "/api/v1/admin/rbac/me", method: "GET" as const, requestId: null, headers: new Headers() },
        }),
      },
    );
    const session = await client.restore();
    if (session.status !== "authenticated") throw new Error("نشست معتبر نشد");
    expect(hasPermission(session.capabilities, "crm:view")).toBe(true);
    // نقشِ admin به‌تنهایی هیچ مجوزی نمی‌آفریند:
    expect(hasPermission(capabilitiesFor({ ...session.user, role: "admin" }, null), "crm:view")).toBe(false);
  });

  it("propagates a permission-loader failure instead of falling back to an open session", async () => {
    const client = createSessionClient(
      createApiClient({
        baseUrl: "http://api.test/api/v1",
        fetch: stub([{ match: () => true, respond: () => jsonResponse({ ...ME_PAYLOAD, role: "admin" }) }]),
      }),
      {
        permissionsLoader: async () => ({
          ok: false as const,
          error: new ApiError({ kind: "FORBIDDEN", message: "no capability contract", status: 403 }),
        }),
      },
    );
    const result = await client.restoreResult();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("FORBIDDEN");
  });

  it("stores only presentation fields in the cache and never trusts them as identity", () => {
    const memory = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
    const user = { id: "usr_1", email: "a@b.ir", role: "customer" as const, name: "نگار", phone: null, totpEnabled: false };
    const session = {
      status: "authenticated" as const,
      user,
      supplier: null,
      capabilities: capabilitiesFor(user, null),
      fetchedAt: "2026-01-01T00:00:00.000Z",
      source: "server" as const,
    };
    expect(writePresentationCache(storage, session)).toBe(true);
    const cached = readPresentationCache(storage);
    expect(cached?.displayName).toBe("نگار");
    expect(Object.keys(cached ?? {})).not.toContain("supplierId");
    expect(isPresentationCacheConsistent(cached, session)).toBe(true);
    expect(isPresentationCacheConsistent(cached, anonymousSession())).toBe(false);

    // یک کشِ دستکاری‌شده هرگز نشست نمی‌سازد:
    memory.set(SESSION_PRESENTATION_CACHE_KEY, JSON.stringify({ version: 1, roleLabel: "admin", displayName: " hacker" }));
    const forged = readPresentationCache(storage);
    expect(forged?.roleLabel).toBe("admin");
    const store = storeFor([{ match: () => true, respond: () => jsonResponse({ error: "UNAUTHORIZED" }, 401) }]);
    expect(store.getState().session.status).toBe("anonymous");

    clearPresentationCache(storage);
    expect(readPresentationCache(storage)).toBeNull();
  });

  it("keeps the store anonymous and SSR-identical until the server answers", () => {
    const store = storeFor([{ match: () => true, respond: () => jsonResponse(ME_PAYLOAD) }]);
    expect(store.getState()).toEqual({ session: anonymousSession(), phase: "idle", error: null });
    expect(sessionAsyncState(store.getState()).status).toBe("LOADING");
  });

  it("publishes store changes to subscribers and returns to anonymous on logout", async () => {
    const store = storeFor([
      { match: (r) => r.path === "/api/v1/auth/me", respond: () => jsonResponse(ME_PAYLOAD) },
      { match: (r) => r.path === "/api/v1/auth/logout", respond: () => jsonResponse({ ok: true }) },
    ]);
    const seen: string[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getState().phase));

    await store.refresh();
    expect(store.getState().session.status).toBe("authenticated");
    expect(seen).toEqual(["loading", "ready"]);

    await store.logout();
    expect(store.getState().session.status).toBe("anonymous");
    unsubscribe();
  });

  it("surfaces a network failure as an error state, not as an empty session", async () => {
    const store = storeFor([
      { match: () => true, respond: () => jsonResponse({ error: "INTERNAL_ERROR" }, 500) },
    ]);
    await store.refresh();
    const state = sessionAsyncState(store.getState());
    expect(state.status).toBe("SERVER_ERROR");
    expect(state).not.toHaveProperty("data");
  });

  it("renders the anonymous server snapshot through the React binding", () => {
    const store = storeFor([{ match: () => true, respond: () => jsonResponse(ME_PAYLOAD) }]);
    function Probe() {
      return createElement("span", null, useSession(store).status);
    }
    expect(renderToString(createElement(Probe))).toContain("LOADING");
  });

  it("exposes a stable client contract for later portal migration", () => {
    const client: SessionClient = sessionClient([]);
    for (const method of ["login", "loginResult", "logout", "logoutResult", "restore", "restoreResult", "withPermissions"] as const) {
      expect(typeof client[method]).toBe("function");
    }
  });
});
