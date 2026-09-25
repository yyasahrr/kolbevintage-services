/**
 * اتصالِ React برای انبارِ نشست (فاز ۶.۱).
 *
 * فقط یک لایهٔ نازک روی `useSyncExternalStore` است — تمام منطق در `store.ts`
 * زندگی می‌کند و در Node تست می‌شود. این فایل هیچ تصمیمی نمی‌گیرد تا نیازی به
 * شبیه‌سازِ DOM در تست‌ها نباشد.
 */

import { useSyncExternalStore } from "react";
import { createSessionStore, sessionAsyncState, type SessionStore, type SessionStoreState } from "./store";
import type { SessionClient } from "./auth-client";
import type { AsyncState } from "../ui/async-state";
import type { Session } from "./types";

export function useSessionStore(store: SessionStore): SessionStoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useSession(store: SessionStore): AsyncState<Session> {
  const state = useSessionStore(store);
  return sessionAsyncState(state);
}

export function createSessionStoreForReact(client: SessionClient): SessionStore {
  return createSessionStore(client);
}
