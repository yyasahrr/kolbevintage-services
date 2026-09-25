"use client";
/**
 * Phase 6.3-B3 — storefront binding for the shared (Phase 6.1) session boundary.
 *
 * This is the single authoritative source of customer identity, VIP membership
 * and VIP entitlements for storefront pages. It restores from `GET /auth/me`
 * (server authority) — never from localStorage — and fails closed: a network or
 * malformed response surfaces as an error, it is NOT silently treated as
 * anonymous/ineligible. Built directly on `shared/http` + `shared/session`;
 * no second auth abstraction is introduced.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient } from "../../shared/http/client";
import { createSessionClient, type SessionClient } from "../../shared/session/auth-client";
import { createSessionStore, type SessionStore, type SessionStoreState } from "../../shared/session/store";
import type { LoginInput, Session } from "../../shared/session/types";
import { resolveVipCapabilities, resolveVipGate, type VipGate } from "../../shared/vip/membership";
import type { VipEntitlements } from "../../shared/session/types";

// Canonical API prefix; Next rewrites `/api/v1/*` to the Nest API. The HttpOnly
// session cookie rides along via `credentials: "include"`.
const apiClient = createApiClient({ baseUrl: "/api/v1", credentials: "include" });
const sessionClient: SessionClient = createSessionClient(apiClient);
const store: SessionStore = createSessionStore(sessionClient);

export type StorefrontSessionValue = {
  /** Raw store state: `session`, `phase` (idle|loading|ready), `error`. */
  state: SessionStoreState;
  /** Server-derived session (anonymous until restored). */
  session: Session;
  /** True while the initial `/auth/me` restore has not resolved. */
  resolving: boolean;
  /** A real restore/transport error (NOT the same as anonymous). */
  error: SessionStoreState["error"];
  login: (input: LoginInput) => Promise<SessionStoreState>;
  logout: () => Promise<SessionStoreState>;
  refresh: () => Promise<SessionStoreState>;
};

const SessionContext = createContext<StorefrontSessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionStoreState>(store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setState(store.getState()));
    // Restore the session from the server on mount (refresh => GET /auth/me).
    void store.refresh();
    return unsubscribe;
  }, []);

  const value = useMemo<StorefrontSessionValue>(
    () => ({
      state,
      session: state.session,
      resolving: state.phase !== "ready",
      error: state.error,
      // Login is not identity authority: the client sets the HttpOnly cookie and
      // re-reads /auth/me; we then sync the store from the server.
      login: async (input) => {
        await sessionClient.login(input);
        return store.refresh();
      },
      logout: () => store.logout(),
      refresh: () => store.refresh(),
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useStorefrontSession(): StorefrontSessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useStorefrontSession must be used within <SessionProvider>");
  return ctx;
}

/** VIP membership gate derived from the server session (UX only; backend re-checks). */
export function useVipGate(): { gate: VipGate; resolving: boolean; error: StorefrontSessionValue["error"] } {
  const { session, resolving, error } = useStorefrontSession();
  return { gate: resolveVipGate(session), resolving, error };
}

/** VIP capability entitlements derived from the server session (never from status alone). */
export function useVipCapabilities(): VipEntitlements {
  const { session } = useStorefrontSession();
  return resolveVipCapabilities(session);
}
