/**
 * کلاینت HTTP مشترک (فاز ۶.۱ — جایگزینِ تک‌منظوره برای خانوادهٔ `api()`های تکراری).
 *
 * پیش از این چهار پیاده‌سازیِ موازی وجود داشت:
 *   - `storefront/lib/api.ts`
 *   - `supplier-src/api.ts`
 *   - `storefront/lib/wholesaleApi.ts` / `wholesaleVipApi.ts` (روی همان کلایント فروشگاه)
 * که هر کدام خطا، base URL و رفتارِ شکستِ خودشان را داشتند. این فایل یک لایهٔ
 * حمل‌ونقلِ خنثی است:
 *
 *  - هیچ منطق تجاری (قیمت، موجودی، سفارش) درون آن نیست؛
 *  - هیچ خطایی را به دادهٔ خالی تبدیل نمی‌کند؛
 *  - هیچ مقداری را از localStorage نمی‌خواند (نشست فقط کوکیِ HttpOnly)؛
 *  - هم در مرورگر و هم در SSR قابل استفاده است؛
 *  - `fetch` قابل تزریق است، پس تست‌ها بدون شبکه اجرا می‌شوند.
 */

import {
  ApiError,
  classifyHttpFailure,
  fallbackMessage,
  isAbortError,
  parseRetryAfter,
  parseValidationIssues,
} from "./errors";
import { buildRequestUrl, resolveDefaultBaseUrl } from "./url";
import { failureMeta } from "./types";
import type {
  ApiClient,
  ApiClientOptions,
  ApiRequestInit,
  ApiResponseMeta,
  ApiResult,
  FetchLike,
  HttpMethod,
  ResolvedApiClientOptions,
  ResponseShape,
} from "./types";

type ErrorBody = {
  code: string | null;
  message: string | null;
  requestId: string | null;
  errorId: string | null;
  raw: string;
};

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function parseErrorBody(raw: string): ErrorBody {
  if (!raw.trim()) return { code: null, message: null, requestId: null, errorId: null, raw };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return {
        code: readString(record, "error") ?? readString(record, "code"),
        message: readString(record, "message"),
        requestId: readString(record, "requestId"),
        errorId: readString(record, "errorId"),
        raw,
      };
    }
  } catch {
    // بدنه JSON معتبر نیست — متن خام برای تشخیص نگه داشته می‌شود.
  }
  return { code: null, message: null, requestId: null, errorId: null, raw };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  const combiner = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof combiner !== "function") {
    throw new ApiError({
      kind: "UNKNOWN",
      message: "AbortSignal.any() در این محیط پشتیبانی نمی‌شود؛ تایم‌اوت اعمال نشد.",
      transport: "protocol",
    });
  }
  return combiner.call(AbortSignal, [signal, timeoutSignal]);
}

/**
 * نشست با کوکیِ HttpOnly منتقل می‌شود، پس `credentials` پیش‌فرض همیشه
 * `include` است. در محیطِ بدون مرورگر این گزینه بی‌اثر است (کوکی‌ای برای فرستادن
 * نیست) و فراخوان‌های SSR باید در صورت نیاز هدرِ کوکی را صراحتاً منتقل کنند؛
 * رفتارِ وابسته به محیط اینجا عمداً حذف شده تا نتایج در همه‌جا یکسان باشد.
 */
const DEFAULT_CREDENTIALS: RequestCredentials = "include";

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const configuredBaseUrl = options.baseUrl;
  const resolved: ResolvedApiClientOptions = {
    baseUrl:
      typeof configuredBaseUrl === "function"
        ? configuredBaseUrl
        : () => configuredBaseUrl ?? resolveDefaultBaseUrl(),
    defaultHeaders: { accept: "application/json", ...(options.defaultHeaders ?? {}) },
    credentials: options.credentials ?? DEFAULT_CREDENTIALS,
    fetch: options.fetch ?? ((input: string, init: RequestInit) => globalThis.fetch(input, init)),
    requestIdHeader: options.requestIdHeader ?? "x-request-id",
    timeoutMs: options.timeoutMs ?? null,
  };

  async function requestResult<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
    const method: HttpMethod = init.method ?? "GET";
    const baseUrl = resolved.baseUrl();
    const url = buildRequestUrl(baseUrl, path, init.query);

    const headers = new Headers(resolved.defaultHeaders);
    for (const [key, value] of Object.entries(init.headers ?? {})) headers.set(key, value);
    /**
     * بدنهٔ `FormData` را همان‌طور که هست می‌فرستیم.
     *
     * دو نکته: (۱) `JSON.stringify` روی FormData بی‌معنی است؛ (۲) برای multipart
     * **نباید** `content-type` را خودمان ست کنیم، چون مرورگر باید `boundary` را
     * تولید کند و هر مقدارِ دستی، درخواست را خراب می‌کند.
     */
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body !== undefined && !isFormData && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (init.requestId) headers.set(resolved.requestIdHeader, init.requestId);

    let signal = init.signal;
    const timeoutMs = init.timeoutMs ?? resolved.timeoutMs;
    try {
      if (timeoutMs !== null && timeoutMs !== undefined) signal = combineSignals(signal, timeoutMs);
    } catch (error) {
      return {
        ok: false,
        meta: failureMeta(url, method, 0, init.requestId ?? null),
        error: error instanceof ApiError ? error : new ApiError({ kind: "UNKNOWN", message: String(error) }),
      };
    }

    let response: Response;
    try {
      response = await resolved.fetch(url, {
        method,
        headers,
        credentials: init.credentials ?? resolved.credentials,
        body: init.body === undefined ? undefined : isFormData ? (init.body as FormData) : JSON.stringify(init.body),
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (isAbortError(cause) || (signal?.aborted ?? false)) {
        return {
          ok: false,
          meta: failureMeta(url, method, 0, init.requestId ?? null),
          error: new ApiError({
            kind: "ABORTED",
            message: fallbackMessage("ABORTED"),
            transport: "cancelled",
            requestId: init.requestId ?? null,
            cause,
          }),
        };
      }
      return {
        ok: false,
        meta: failureMeta(url, method, 0, init.requestId ?? null),
        error: new ApiError({
          kind: "NETWORK_ERROR",
          message: fallbackMessage("NETWORK_ERROR"),
          transport: "network",
          requestId: init.requestId ?? null,
          cause,
        }),
      };
    }

    const meta: ApiResponseMeta = {
      status: response.status,
      url,
      method,
      requestId: response.headers.get("x-request-id"),
      headers: response.headers,
    };

    const raw = await response.text().catch(() => "");

    if (!response.ok) {
      const body = parseErrorBody(raw);
      const kind = classifyHttpFailure(response.status, body.code);
      const message = body.message ?? fallbackMessage(kind);
      return {
        ok: false,
        meta,
        error: new ApiError({
          kind,
          status: response.status,
          code: body.code,
          message,
          requestId: body.requestId ?? meta.requestId,
          errorId: body.errorId,
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
          issues: kind === "VALIDATION_ERROR" ? parseValidationIssues(message) : [],
          transport: "http",
          body: body.raw,
        }),
      };
    }

    const shape: ResponseShape = init.response ?? "json";
    if (shape === "void") return { ok: true, data: undefined as T, meta };
    if (shape === "text") return { ok: true, data: raw as T, meta };
    if (!raw.trim()) return { ok: true, data: undefined as T, meta };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      // پاسخ ۲xx با بدنهٔ غیرِ JSON = نقض قراردادِ سرور؛ هرگز به «دادهٔ خالی» تبدیل نمی‌شود.
      return {
        ok: false,
        meta,
        error: new ApiError({
          kind: "MALFORMED_RESPONSE",
          status: response.status,
          code: "MALFORMED_RESPONSE",
          message: fallbackMessage("MALFORMED_RESPONSE"),
          requestId: meta.requestId,
          transport: "protocol",
          body: raw,
          cause,
        }),
      };
    }
    return { ok: true, data: parsed as T, meta };
  }

  async function requestWithMeta<T>(path: string, init: ApiRequestInit = {}): Promise<{ data: T; meta: ApiResponseMeta }> {
    const result = await requestResult<T>(path, init);
    if (!result.ok) throw result.error;
    return { data: result.data, meta: result.meta };
  }

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const result = await requestResult<T>(path, init);
    if (!result.ok) throw result.error;
    return result.data;
  }

  return { request, requestResult, requestWithMeta, options: resolved };
}

export type { FetchLike };
