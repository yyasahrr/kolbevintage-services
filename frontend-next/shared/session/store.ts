/**
 * انبارِ نشستِ مشترک (فاز ۶.۱) — مستقل از فریم‌ورک.
 *
 * چرا «انبار» و نه فقط توابعِ `restore()`؟ چون چند صفحه باید به یک پاسخِ نشست
 * گوش بدهند (هدر، ناوبری، گاردِ مسیر) بدون اینکه هر کدام درخواستِ جداگانه
 * بفرستند یا برداشتِ خودشان از «آیا وارد هستم؟» را داشته باشند.
 *
 * قواعد:
 *  - حالتِ اولیه در SSR/مرورگر یکسان است: **anonymous + idle**. هیچ خواندنی از
 *    localStorage انجام نمی‌شود، پس hydration mismatch هم نداریم.
 *  - تنها راهِ تغییر به «وارد شده» پاسخِ سرور است (`refresh`).
 *  - تبدیل به مدلِ وضعیتِ UI با `sessionAsyncState()` انجام می‌شود تا صفحات
 *    همان واژگانِ ثبت‌شده را رندر کنند.
 */

import { ApiError } from "../http/errors";
import { LOADING, stateFromError, type AsyncState } from "../ui/async-state";
import { anonymousSession, type SessionClient } from "./auth-client";
import type { Session } from "./types";

export type SessionPhase = "idle" | "loading" | "ready";

export type SessionStoreState = {
  session: Session;
  phase: SessionPhase;
  error: ApiError | null;
};

export type SessionStore = {
  getState: () => SessionStoreState;
  subscribe: (listener: () => void) => () => void;
  /** بازیابی از سرور؛ ۴۰۱ ⇒ anonymousِ معتبر. */
  refresh: () => Promise<SessionStoreState>;
  /** خروج از سرور و بازگشت به anonymous (حتی اگر سرور در دسترس نباشد). */
  logout: () => Promise<SessionStoreState>;
  /** پاک‌سازیِ محلی بدون فراخوانیِ سرور (مثلاً پس از ۴۰۱ در میان‌افزار). */
  setAnonymous: () => void;
};

const INITIAL_STATE: SessionStoreState = { session: anonymousSession(), phase: "idle", error: null };

export function createSessionStore(client: SessionClient): SessionStore {
  let state: SessionStoreState = INITIAL_STATE;
  const listeners = new Set<() => void>();

  function setState(next: SessionStoreState): SessionStoreState {
    state = next;
    for (const listener of [...listeners]) listener();
    return state;
  }

  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh(): Promise<SessionStoreState> {
      setState({ ...state, phase: "loading", error: null });
      const result = await client.restoreResult();
      if (!result.ok) return setState({ session: anonymousSession(), phase: "ready", error: result.error });
      return setState({ session: result.data, phase: "ready", error: null });
    },
    async logout(): Promise<SessionStoreState> {
      setState({ ...state, phase: "loading", error: null });
      const result = await client.logoutResult();
      // خروج همیشه به anonymous ختم می‌شود؛ شکستِ شبکه فقط ثبت می‌شود،
      // چون کوکیِHttpOnly در هر صورت باید از سمت سرور باطل شود.
      return setState({ session: anonymousSession(), phase: "ready", error: result.ok ? null : result.error });
    },
    setAnonymous(): void {
      setState({ session: anonymousSession(), phase: "ready", error: null });
    },
  };
}

/**
 * نگاشتِ وضعیتِ انبار به مدلِ استانداردِ UI.
 * `idle` و `loading` هر دو LOADING هستند (هنوز حقیقتی از سرور نرسیده)؛
 * anonymousِ تأییدشده READY_EMPTY است، نه خطا.
 */
export function sessionAsyncState(state: SessionStoreState): AsyncState<Session> {
  if (state.error) return stateFromError(state.error);
  if (state.phase !== "ready") return LOADING;
  return state.session.status === "authenticated"
    ? { status: "READY_WITH_DATA", data: state.session }
    : { status: "READY_EMPTY" };
}
