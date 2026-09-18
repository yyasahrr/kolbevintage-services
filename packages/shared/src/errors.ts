/**
 * قرارداد خطای دامنه — مشترک بین همهٔ ماژول‌ها.
 *
 * قواعد حاکم:
 *  - «All critical transitions must be validated server-side» → خطای دامنه، نه استثنای عمومی.
 *  - هیچ جزئیات داخلی (stack، پیام دیتابیس) نباید به کلاینت برود.
 *
 * `code` بخشی از قرارداد عمومی است (کلاینت روی آن تصمیم می‌گیرد) و باید پایدار بماند؛
 * `message` فقط برای نمایش انسانی است و می‌تواند تغییر کند.
 */

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}

export const ErrorCodes = {
  // ورودی و اعتبارسنجی
  INVALID_INPUT: "INVALID_INPUT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  // هویت و دسترسی
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  SESSION_SECRET_MISSING: "SESSION_SECRET_MISSING",
  // منابع
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  // گذار حالت
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  TRACKING_CODE_REQUIRED: "TRACKING_CODE_REQUIRED",
  // پول
  PAYMENT_METHOD_NOT_ALLOWED: "PAYMENT_METHOD_NOT_ALLOWED",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  BALANCE_DIRECT_EDIT_FORBIDDEN: "BALANCE_DIRECT_EDIT_FORBIDDEN",
  // عدم‌تکرار
  INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  // فایل
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  // پیش‌فرض
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ValidationError extends DomainError {
  constructor(
    public readonly fields: ReadonlyArray<{ field: string; code: string }>,
    message?: string,
  ) {
    super(422, ErrorCodes.VALIDATION_FAILED, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(404, ErrorCodes.NOT_FOUND, `${entity}${id ? ` ${id}` : ""} یافت نشد`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(code: string = ErrorCodes.FORBIDDEN, message?: string) {
    super(403, code, message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message?: string) {
    super(401, ErrorCodes.UNAUTHORIZED, message);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message?: string) {
    super(409, code, message);
    this.name = "ConflictError";
  }
}

/** آیا مقدار داده‌شده یک خطای دامنه با کد و وضعیت معتبر است؟ */
export function isDomainError(error: unknown): error is DomainError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as DomainError).status === "number" &&
    typeof (error as DomainError).code === "string"
  );
}

/** خروجی قابل‌ارسال به کلاینت — هرگز stack یا پیام داخلی را افشا نمی‌کند. */
export function toPublicError(error: unknown): { status: number; body: { error: string; message: string } } {
  if (isDomainError(error)) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  return {
    status: 500,
    body: { error: ErrorCodes.INTERNAL_ERROR, message: "خطای داخلی سرور" },
  };
}
