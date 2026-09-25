/**
 * قرارداد خطای مشترک لایهٔ فرانت‌اند (فاز ۶.۱).
 *
 * چرا یک فایل مستقل؟ چون پیش از این هر کلاینت (storefront/lib/api.ts،
 * supplier-src/api.ts، wholesaleApi و…) خطا را به شکل خودش تفسیر می‌کرد:
 * کدهای رشته‌ایِ پراکنده (`NETWORK`, `HTTP_5xx`, `BAD_API_KEY`) و در چند مسیر،
 * تبدیل خطا به آرایهٔ خالی (`catch { return [] }`). نتیجه این بود که «نبودِ داده»
 * و «شکستِ واکشی» در UI یکسان دیده می‌شدند.
 *
 * قواعد این فایل:
 *  1. هیچ خطایی بلعیده نمی‌شود؛ هر شکست یک `ApiError` با `kind` ساخت‌یافته است.
 *  2. `kind` فقط از واژگان ثبت‌شدهٔ `UI_STATES` در `truth-registry.ts` استفاده
 *     می‌کند (به‌علاوهٔ دو وضعیتِ صرفاً حمل‌ونقلی: MALFORMED_RESPONSE و ABORTED).
 *  3. `ABORTED` هرگز یک وضعیتِ پایانی نیست — درخواستِ لغوشده نباید خطای کهنه‌ای
 *     را روی صفحه بنشاند.
 *
 * این ماژول هیچ وابستگی به مرورگر، React یا دامین تجاری ندارد و در Node تست می‌شود.
 */

/** واژگان خطای قابل‌نگاشت به مدل وضعیت UI در truth-registry.ts. */
export const API_ERROR_KINDS = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "PROVIDER_UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "ABORTED",
  "UNKNOWN",
] as const;

export type ApiErrorKind = (typeof API_ERROR_KINDS)[number];

/** منشأ خطا: پاسخ HTTP، شبکه، نقض قرارداد پاسخ، یا لغو توسط مصرف‌کننده. */
export type ApiErrorTransport = "http" | "network" | "protocol" | "cancelled";

export type ValidationIssue = {
  /** نام فیلد طبق اعلام سرور؛ اگر سرور فیلد مشخص نکرده باشد `null`. */
  field: string | null;
  message: string;
};

export type ApiErrorInit = {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  code?: string | null;
  requestId?: string | null;
  errorId?: string | null;
  retryAfterSeconds?: number | null;
  issues?: readonly ValidationIssue[];
  transport?: ApiErrorTransport;
  body?: unknown;
  cause?: unknown;
};

const PERSIAN_FALLBACK: Record<ApiErrorKind, string> = {
  VALIDATION_ERROR: "داده‌های ارسالی معتبر نیست.",
  UNAUTHORIZED: "نشست شما معتبر نیست؛ دوباره وارد شوید.",
  FORBIDDEN: "دسترسی به این بخش مجاز نیست.",
  NOT_FOUND: "منبع درخواستی یافت نشد.",
  CONFLICT: "این تغییر با وضعیت فعلی داده‌ها تداخل دارد.",
  RATE_LIMITED: "تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.",
  SERVER_ERROR: "خطای داخلی سرور؛ دوباره تلاش کنید.",
  NETWORK_ERROR: "اتصال به سرور برقرار نشد.",
  PROVIDER_UNAVAILABLE: "سرویس واسط در دسترس نیست.",
  MALFORMED_RESPONSE: "پاسخ سرور با قرارداد API هم‌خوان نیست.",
  ABORTED: "درخواست لغو شد.",
  UNKNOWN: "خطای ناشناخته رخ داد.",
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly errorId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly issues: readonly ValidationIssue[];
  readonly transport: ApiErrorTransport;
  /** بدنهٔ خام پاسخ برای تشخیص/گزارش — هرگز منبع حقیقت تجاری نیست. */
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message || PERSIAN_FALLBACK[init.kind]);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.requestId = init.requestId ?? null;
    this.errorId = init.errorId ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.issues = init.issues ?? [];
    this.transport = init.transport ?? "http";
    this.body = init.body ?? null;
    if (init.cause !== undefined) {
      (this as { cause?: unknown }).cause = init.cause;
    }
  }

  /** خروجی امن برای لاگ/تله‌متری (بدون نشت کل بدنه). */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      status: this.status,
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      errorId: this.errorId,
      retryAfterSeconds: this.retryAfterSeconds,
      issues: this.issues.map((issue) => ({ ...issue })),
      transport: this.transport,
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isApiErrorKind(value: unknown, kind: ApiErrorKind): value is ApiError {
  return value instanceof ApiError && value.kind === kind;
}

/**
 * آیا این خطا یک «لغو» است؟ لغو با خطا فرق دارد: مصرف‌کننده خودش درخواست را
 * کنار گذاشته (تعویض فیلتر، خروج از صفحه، تایم‌اوت عمدی).
 */
export function isAbortError(value: unknown): boolean {
  if (value instanceof ApiError) return value.kind === "ABORTED";
  if (typeof DOMException !== "undefined" && value instanceof DOMException) return value.name === "AbortError";
  return value instanceof Error && value.name === "AbortError";
}

const PROVIDER_UNAVAILABLE_PATTERN =
  /PROVIDER|UNAVAILABLE|UPSTREAM|GATEWAY|CANONICAL_API|NOT_CONFIGURED|TIMEOUT|CIRCUIT/i;

/**
 * `503` لزوماً به معنای «سرویس واسط در دسترس نیست» نیست؛ فقط وقتی کد خطا نشانهٔ
 * وابستگی خارجی/بالادستی دارد به PROVIDER_UNAVAILABLE نگاشت می‌شود وگرنه خطای
 * سرور است. این تفکیک برای UI مهم است: «دوباره تلاش کنید» در برابر
 * «سرویس پیامک/پرداخت پیکربندی نشده است».
 */
export function isProviderUnavailableCode(code: string | null): boolean {
  return code !== null && PROVIDER_UNAVAILABLE_PATTERN.test(code);
}

/** نگاشت وضعیت HTTP به `kind` استاندارد. */
export function classifyHttpFailure(status: number, code: string | null = null): ApiErrorKind {
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  // 502/504 یعنی دروازه/بالادست پاسخ نداده؛ 503 فقط با کدِ وابستگی خارجی.
  if (status === 502 || status === 504) return "PROVIDER_UNAVAILABLE";
  if (status === 503) return isProviderUnavailableCode(code) ? "PROVIDER_UNAVAILABLE" : "SERVER_ERROR";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

/**
 * سرور خطاهای اعتبارسنجی را به صورت رشتهٔ `field: constraint | field: constraint`
 * برمی‌گرداند. این تابع آن را به فهرست ساخت‌یافته تبدیل می‌کند تا UI بتواند
 * پیام را کنار فیلد درست نشان دهد؛ اگر قالب قابل‌تشخیص نبود، پیام کامل حفظ می‌شود.
 */
export function parseValidationIssues(message: string): ValidationIssue[] {
  const trimmed = message.trim();
  if (!trimmed) return [];
  const parts = trimmed.split("|").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return [];
  // سرور هر فیلد را به شکل `property: constraint` می‌فرستد و چند فیلد را با
  // ` | ` به هم می‌چسباند. پس حتی یک فیلدِ تنها هم باید تفکیک شود؛ در غیر این
  // صورت خطای اعتبارسنجیِ تک‌فیلدی (مثلاً مبلغ برداشت) نامِ فیلدش را از دست
  // می‌داد و UI نمی‌توانست خطا را کنارِ همان ورودی نشان دهد.
  return parts.map((part) => {
    const separator = part.indexOf(":");
    if (separator <= 0) return { field: null, message: part };
    const field = part.slice(0, separator).trim();
    const detail = part.slice(separator + 1).trim();
    return { field: field.length > 0 ? field : null, message: detail.length > 0 ? detail : part };
  });
}

/** تفسیر هدر `Retry-After` (ثانیه یا تاریخ HTTP)؛ در صورت نامعتبر بودن `null`. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  const delta = Math.ceil((date - Date.now()) / 1000);
  return delta > 0 ? delta : 0;
}

export function fallbackMessage(kind: ApiErrorKind): string {
  return PERSIAN_FALLBACK[kind];
}
