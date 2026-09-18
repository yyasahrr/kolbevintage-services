/**
 * قرارداد خطای مشترک لایهٔ سرور.
 *
 * کد خطا (`code`) بخشی از قرارداد عمومی API است: کلاینت‌ها روی آن تصمیم می‌گیرند
 * (نمونه: `lib/wholesaleVipApi.ts` روی `NETWORK` و `HTTP_5xx` رفتار متفاوتی دارد).
 * پس کدها پایدار هستند و پیام فارسی فقط برای نمایش است.
 *
 * قانون حاکم: هیچ خطای داخلی (stack، جزئیات SQL) نباید به کلاینت درز کند؛
 * `handleKolbeRequest` فقط `code` را برمی‌گرداند و خطاهای ۵xx را در لاگ ثبت می‌کند.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

/** کد خطاهای دامنه‌ای که چند ماژول به آن‌ها ارجاع می‌دهند. */
export const ErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  SESSION_SECRET_MISSING: "SESSION_SECRET_MISSING",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  PRICE_CHANGED: "PRICE_CHANGED",
} as const;

export function isHttpError(error: unknown): error is HttpError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
