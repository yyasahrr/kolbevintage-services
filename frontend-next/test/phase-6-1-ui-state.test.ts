/**
 * تست‌های مدل وضعیتِ UI (فاز ۶.۱-C).
 *
 * محور: «EMPTY برابر ERROR نیست». این تست‌ها ثابت می‌کنند هیچ مسیری وجود ندارد که
 * شکستِ شبکه/سرور را به یک وضعیتِ خالیِ جعلی تبدیل کند — رفتاری که در کلاینت‌های
 * قدیمی با `catch { return [] }` دیده می‌شد.
 */

import { describe, expect, it } from "vitest";
import { ApiError, API_ERROR_KINDS, classifyHttpFailure } from "../shared/http";
import {
  ERROR_KIND_TO_UI_STATE,
  dataOrNull,
  defaultIsEmpty,
  foldAsyncState,
  isErrorState,
  isReady,
  mapAsyncState,
  readyWithData,
  stateFromError,
  stateFromResult,
  type AsyncState,
} from "../shared/ui/async-state";
import { UI_STATES } from "../truth-registry";

function errorOf(kind: ApiError["kind"]): ApiError {
  return new ApiError({ kind, message: `خطای ${kind}` });
}

describe("Phase 6.1-C UI state model", () => {
  it("maps every registered UI state into the shared model", () => {
    expect(UI_STATES).toHaveLength(12);
    for (const state of UI_STATES) {
      const generated: AsyncState<number> =
        state === "LOADING"
          ? { status: "LOADING" }
          : state === "READY_WITH_DATA"
            ? readyWithData(1)
            : state === "READY_EMPTY"
              ? { status: "READY_EMPTY" }
              : { status: state, error: errorOf("SERVER_ERROR" as ApiError["kind"]) };
      expect(generated.status).toBe(state);
    }
  });

  it("covers every API error kind with a registered UI state", () => {
    for (const kind of API_ERROR_KINDS) {
      expect(UI_STATES, kind).toContain(ERROR_KIND_TO_UI_STATE[kind]);
    }
  });

  it("keeps HTTP classification aligned with the state vocabulary", () => {
    expect(classifyHttpFailure(401)).toBe("UNAUTHORIZED");
    expect(classifyHttpFailure(403)).toBe("FORBIDDEN");
    expect(classifyHttpFailure(404)).toBe("NOT_FOUND");
    expect(classifyHttpFailure(409)).toBe("CONFLICT");
    expect(classifyHttpFailure(422)).toBe("VALIDATION_ERROR");
    expect(classifyHttpFailure(429)).toBe("RATE_LIMITED");
    expect(classifyHttpFailure(500)).toBe("SERVER_ERROR");
  });

  it("never turns a network failure into an empty dataset", () => {
    const failing = { ok: false as const, error: errorOf("NETWORK_ERROR") };
    // حتی اگر تشخیصِ «خالی بودن» برای همه‌چیز true برگرداند:
    const state = stateFromResult<string[]>(failing, () => true);
    expect(state.status).toBe("NETWORK_ERROR");
    expect(isErrorState(state)).toBe(true);
    expect(isReady(state)).toBe(false);
    expect(dataOrNull(state)).toBeNull();
    expect(state).not.toHaveProperty("data");
  });

  it("distinguishes a truthful empty page from a failed page", () => {
    const empty = stateFromResult<string[]>({ ok: true, data: [], meta: { status: 200, url: "", method: "GET", requestId: null, headers: new Headers() } });
    const full = stateFromResult<string[]>({ ok: true, data: ["a"], meta: { status: 200, url: "", method: "GET", requestId: null, headers: new Headers() } });
    expect(empty.status).toBe("READY_EMPTY");
    expect(full.status).toBe("READY_WITH_DATA");
    if (full.status === "READY_WITH_DATA") expect(dataOrNull(full)).toEqual(["a"]);
  });

  it("maps each error kind to its own state for precise rendering", () => {
    const expected: Record<string, string> = {
      VALIDATION_ERROR: "VALIDATION_ERROR",
      UNAUTHORIZED: "UNAUTHORIZED",
      FORBIDDEN: "FORBIDDEN",
      NOT_FOUND: "NOT_FOUND",
      CONFLICT: "CONFLICT",
      RATE_LIMITED: "RATE_LIMITED",
      SERVER_ERROR: "SERVER_ERROR",
      NETWORK_ERROR: "NETWORK_ERROR",
      PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
      MALFORMED_RESPONSE: "SERVER_ERROR",
      UNKNOWN: "SERVER_ERROR",
    };
    for (const [kind, state] of Object.entries(expected)) {
      expect(stateFromError(errorOf(kind as ApiError["kind"])).status, kind).toBe(state);
    }
  });

  it("treats cancellation as a non-terminal state so stale errors cannot stick", () => {
    expect(stateFromError(errorOf("ABORTED")).status).toBe("LOADING");
  });

  it("wraps unknown exceptions as server errors instead of swallowing them", () => {
    const state = stateFromError(new Error("boom"));
    expect(state.status).toBe("SERVER_ERROR");
    if (isErrorState(state)) expect(state.error.message).toBe("boom");
  });

  it("uses a conservative default emptiness check", () => {
    expect(defaultIsEmpty([])).toBe(true);
    expect(defaultIsEmpty(null)).toBe(true);
    expect(defaultIsEmpty(["a"])).toBe(false);
    // یک شیءِ داده هرگز با پیش‌فرض «خالی» فرض نمی‌شود:
    expect(defaultIsEmpty({ items: [] })).toBe(false);
  });

  it("maps ready data and folds every branch", () => {
    const state = mapAsyncState(readyWithData([1, 2, 3]), (items) => items.length);
    expect(state).toEqual({ status: "READY_WITH_DATA", data: 3 });
    expect(foldAsyncState(state, { loading: () => "l", empty: () => "e", data: (value) => `d:${value}`, error: () => "x" })).toBe("d:3");
    expect(foldAsyncState<string[], string>({ status: "READY_EMPTY" }, { loading: () => "l", empty: () => "e", data: () => "d", error: () => "x" })).toBe("e");
    expect(foldAsyncState<string[], string>({ status: "LOADING" }, { loading: () => "l", empty: () => "e", data: () => "d", error: () => "x" })).toBe("l");
    expect(
      foldAsyncState<string[], string>(stateFromError(errorOf("NOT_FOUND")), { loading: () => "l", empty: () => "e", data: () => "d", error: (status) => status }),
    ).toBe("NOT_FOUND");
  });
});
