/**
 * مدل وضعیت مشترکِ UI (فاز ۶.۱ — خروجیِ مستقیمِ واژگان ثبت‌شده در فاز ۶.۰).
 *
 * واژگان از `truth-registry.ts` (`UI_STATES`) وارد می‌شود تا هیچ صفحه‌ای نتواند
 * وضعیتِ تازه‌ای اختراع کند.
 *
 * مهم‌ترین قاعدهٔ این فایل:
 *
 *      EMPTY ≠ ERROR
 *
 * «هیچ داده‌ای وجود ندارد» فقط وقتی گفته می‌شود که سرور با موفقیت پاسخ داده و
 * مجموعه واقعاً خالی است. شکستِ شبکه، ۵۰۰، ۴۰۱ و لغو شدنِ درخواست هرگز
 * `READY_EMPTY` تولید نمی‌کنند — این همان رفتاری است که در کلاینت‌های قدیمی با
 * `catch { return [] }` باعث نمایشِ «لیست خالی» به‌جای خطا می‌شد.
 */

import type { UiState } from "../../truth-registry";
import { ApiError, isApiError } from "../http/errors";
import type { ApiResult } from "../http/types";

export type TerminalLoadingState = Extract<UiState, "LOADING">;
export type ReadyState = Extract<UiState, "READY_WITH_DATA" | "READY_EMPTY">;
export type ErrorUiState = Exclude<UiState, "LOADING" | "READY_WITH_DATA" | "READY_EMPTY">;

export type AsyncState<T> =
  | { status: "LOADING" }
  | { status: "READY_WITH_DATA"; data: T }
  | { status: "READY_EMPTY" }
  | { status: ErrorUiState; error: ApiError };

export const LOADING: AsyncState<never> = { status: "LOADING" };
export const READY_EMPTY: AsyncState<never> = { status: "READY_EMPTY" };

export function readyWithData<T>(data: T): AsyncState<T> {
  return { status: "READY_WITH_DATA", data };
}

/**
 * نگاشت `kind` خطا به وضعیت UI.
 * دو مقدارِ `LOADING` و `SERVER_ERROR` برای kindهای صرفاً حمل‌ونقلی استفاده شده‌اند
 * (به ترتیب ABORTED و MALFORMED_RESPONSE/UNKNOWN) تا مصرف‌کننده مجبور به اختراعِ
 * وضعیتِ تازه نشود.
 */
export const ERROR_KIND_TO_UI_STATE: Record<ApiError["kind"], ErrorUiState | "LOADING"> = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  // نقض قرارداد پاسخ و خطای ناشناخته از دید کاربر خطای سرورند.
  MALFORMED_RESPONSE: "SERVER_ERROR",
  UNKNOWN: "SERVER_ERROR",
  // لغو یعنی «هنوز تصمیمی نداریم»؛ وضعیتِ کهنه روی صفحه نمی‌ماند.
  ABORTED: "LOADING",
};

export function stateFromError(error: unknown): AsyncState<never> {
  if (isApiError(error)) {
    const status = ERROR_KIND_TO_UI_STATE[error.kind];
    return status === "LOADING" ? LOADING : { status, error };
  }
  return {
    status: "SERVER_ERROR",
    error: new ApiError({
      kind: "UNKNOWN",
      message: error instanceof Error ? error.message : "خطای ناشناخته رخ داد.",
      transport: "protocol",
      cause: error,
    }),
  };
}

/** آیا این مقدار «خالی» است؟ پیش‌فرضِ محافظه‌کار: فقط تهی و آرایهٔ صفرطول. */
export function defaultIsEmpty(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * تبدیل نتیجهٔ کلاینت به وضعیت UI.
 *
 * برخلاف کلاینت‌های قدیمی، `isEmpty` فقط روی **دادهٔ موفق** اجرا می‌شود؛
 * مسیرِ خطا هیچ‌گاه به آن نمی‌رسد.
 */
export function stateFromResult<T>(
  result: ApiResult<T>,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): AsyncState<T> {
  if (!result.ok) return stateFromError(result.error);
  return isEmpty(result.data) ? READY_EMPTY : { status: "READY_WITH_DATA", data: result.data };
}

export function isErrorState<T>(state: AsyncState<T>): state is Extract<AsyncState<T>, { status: ErrorUiState }> {
  return state.status !== "LOADING" && state.status !== "READY_WITH_DATA" && state.status !== "READY_EMPTY";
}

export function isLoading<T>(state: AsyncState<T>): boolean {
  return state.status === "LOADING";
}

export function isReady<T>(state: AsyncState<T>): state is Extract<AsyncState<T>, { status: ReadyState }> {
  return state.status === "READY_WITH_DATA" || state.status === "READY_EMPTY";
}

/** دادهٔ آماده یا `null` — برای رندرِ شرطی، بدون آنکه خطا را «دادهٔ خالی» جلوه دهد. */
export function dataOrNull<T>(state: AsyncState<T>): T | null {
  return state.status === "READY_WITH_DATA" ? state.data : null;
}

export function mapAsyncState<T, R>(state: AsyncState<T>, map: (data: T) => R): AsyncState<R> {
  return state.status === "READY_WITH_DATA" ? readyWithData(map(state.data)) : (state as AsyncState<R>);
}

export type AsyncStateHandlers<T, R> = {
  loading: () => R;
  empty: () => R;
  data: (data: T) => R;
  error: (state: ErrorUiState, error: ApiError) => R;
};

export function foldAsyncState<T, R>(state: AsyncState<T>, handlers: AsyncStateHandlers<T, R>): R {
  switch (state.status) {
    case "LOADING":
      return handlers.loading();
    case "READY_EMPTY":
      return handlers.empty();
    case "READY_WITH_DATA":
      return handlers.data(state.data);
    default:
      return handlers.error(state.status, state.error);
  }
}
