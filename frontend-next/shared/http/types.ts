/**
 * تایپ‌های مشترک لایهٔ حمل‌ونقل (فاز ۶.۱).
 *
 * این فایل فقط قرارداد است — هیچ رفتار اجرایی ندارد — تا کلاینت، نشست، صفحه‌بندی
 * و وضعیت UI همگی روی یک واژگان واحد توافق کنند.
 */

import type { ApiError } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryPrimitive = string | number | boolean;

export type QueryValue = QueryPrimitive | null | undefined | ReadonlyArray<QueryPrimitive>;

export type QueryInput = Record<string, QueryValue> | URLSearchParams;

/** شکل موردانتظارِ بدنهٔ پاسخ. */
export type ResponseShape = "json" | "text" | "void";

export type ApiRequestInit<Body = unknown> = {
  method?: HttpMethod;
  query?: QueryInput;
  body?: Body;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** پیش‌فرض `same-origin` برای مرورگر و `omit` در SSR مطلق نیست؛ مقدار پیش‌فرض کلاینت `include` است. */
  credentials?: RequestCredentials;
  response?: ResponseShape;
  /** تایم‌اوت بر حسب میلی‌ثانیه؛ با AbortSignal ترکیب می‌شود. */
  timeoutMs?: number;
  /** شناسهٔ رهگیری درخواست (هدر `x-request-id`). */
  requestId?: string;
};

export type ApiResponseMeta = {
  /** ۰ یعنی «پاسخی از سرور نرسید» (شکستِ شبکه یا لغو). */
  status: number;
  url: string;
  method: HttpMethod;
  requestId: string | null;
  headers: Headers;
};

/** متادیتای ساختگی برای شکست‌هایی که پاسخی دریافت نشده است. */
export function failureMeta(url: string, method: HttpMethod, status = 0, requestId: string | null = null): ApiResponseMeta {
  return { status, url, method, requestId, headers: new Headers() };
}

export type ApiSuccess<T> = { ok: true; data: T; meta: ApiResponseMeta };

/** شکست همیشه متادیتا دارد تا UI بتواند وضعیت/شناسهٔ رهگیری را نشان دهد، اما هرگز `data` ندارد. */
export type ApiFailure = { ok: false; error: ApiError; meta: ApiResponseMeta };

/**
 * نتیجهٔ صریح هر فراخوانی.
 *
 * چرا `ApiResult` و نه صرفاً پرتاب خطا؟ چون بعضی صفحات می‌خواهند بدون try/catch
 * وضعیت را رندر کنند. اما مهم‌تر: مسیر «خطا» هیچ `data`ای ندارد، پس هیچ فراخوانی
 * نمی‌تواند شکست شبکه را به مجموعه دادهٔ خالی تبدیل کند.
 */
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** حداقل قرارداد `fetch` — قابل‌تعویض برای تست بدون شبکه. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  /** پایهٔ نشانی؛ اگر تابع باشد در هر فراخوانی ارزیابی می‌شود (SSR-safe). */
  baseUrl?: string | (() => string);
  defaultHeaders?: Record<string, string>;
  credentials?: RequestCredentials;
  fetch?: FetchLike;
  /** نام هدر شناسهٔ رهگیری (پیش‌فرض `x-request-id`). */
  requestIdHeader?: string;
  timeoutMs?: number;
};

export type ResolvedApiClientOptions = {
  baseUrl: () => string;
  defaultHeaders: Record<string, string>;
  credentials: RequestCredentials;
  fetch: FetchLike;
  requestIdHeader: string;
  timeoutMs: number | null;
};

export type ApiClient = {
  /** فراخوانی پرتاب‌کننده: در شکست، `ApiError` پرتاب می‌شود. */
  request: <T>(path: string, init?: ApiRequestInit) => Promise<T>;
  /** فراخوانی بدون پرتاب: خروجی همیشه `ApiResult` است. */
  requestResult: <T>(path: string, init?: ApiRequestInit) => Promise<ApiResult<T>>;
  /** فراخوانی با متادیتای پاسخ (برای صفحه‌بندی/کش). */
  requestWithMeta: <T>(path: string, init?: ApiRequestInit) => Promise<{ data: T; meta: ApiResponseMeta }>;
  options: ResolvedApiClientOptions;
};

export const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
