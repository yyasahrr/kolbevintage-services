/**
 * عدم‌تکرار (Idempotency).
 *
 * قاعدهٔ حاکم: «All external callbacks/webhooks must be idempotent».
 *
 * دامنهٔ کاربرد:
 *  ۱) درخواست‌های مالی/سفارش از کلاینت (دوبار کلیک، تلاش دوباره پس از timeout).
 *  ۲) callback ارائه‌دهندهٔ پرداخت (ارسال چندبارهٔ همان رویداد).
 *
 * برای (۱) کلید را کلاینت می‌سازد؛ برای (۲) کلید از شناسهٔ رویداد ارائه‌دهنده
 * ساخته می‌شود تا حتی اگر بدنهٔ webhook تغییر جزئی کند، همان کلید بماند.
 */

import { createHash } from "node:crypto";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const IDEMPOTENCY_HEADER = "idempotency-key";

export class IdempotencyError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "IdempotencyError";
  }
}

/** اعتبارسنجی کلید ارسالی کلاینت. */
export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") throw new IdempotencyError("INVALID_IDEMPOTENCY_KEY");
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new IdempotencyError("INVALID_IDEMPOTENCY_KEY");
  return key;
}

export function isValidIdempotencyKey(value: unknown): boolean {
  try {
    assertIdempotencyKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * کلید مشتق‌شده برای callback ارائه‌دهنده.
 *
 * چرا hash و نه شناسهٔ خام؟ چون کلید در جدول `provider_webhook_events` و در لاگ
 * ذخیره می‌شود؛ اگر ارائه‌دهنده شناسهٔ حساسی بفرستد، آن شناسه نباید تکثیر شود.
 * در عین حال یکتایی حفظ می‌شود (namespace + شناسه).
 */
export function providerEventKey(namespace: string, providerEventId: string): string {
  if (!namespace.trim() || !providerEventId.trim()) {
    throw new IdempotencyError("PROVIDER_EVENT_ID_REQUIRED");
  }
  return `${namespace}:${createHash("sha256").update(providerEventId.trim()).digest("hex").slice(0, 40)}`;
}

/**
 * نتیجهٔ پردازش یک کلید.
 *
 * `replayed: true` یعنی این درخواست تکراری بود و پاسخ اصلی بازگردانده شد؛
 * کد وضعیت HTTP آن `200` است (نه `201`) تا کلاینت بتواند تفاوت را تشخیص دهد.
 */
export type IdempotentResult<T> = { value: T; replayed: boolean };

/**
 * اجرای یک عملیات با ضمانت عدم‌تکرار.
 *
 * الگوی پیاده‌سازی (بدون Redis، همان‌طور که در گام ۰.۵ اعمال شد): یک قید یکتا روی
 * ستون کلید در همان جدولی که رکورد کسب‌وکار را نگه می‌دارد. مزیت: کلید و رکورد در
 * یک تراکنش ثبت می‌شوند و هرگز «کلید بدون سفارش» باقی نمی‌ماند.
 * در فاز ۲ همین تابع با Redis و قفل توزیع‌شده جایگزین می‌شود.
 */
export async function withIdempotency<T>(
  key: string | null,
  lookup: (key: string) => Promise<T | null>,
  execute: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  if (key) {
    const existing = await lookup(key);
    if (existing !== null) return { value: existing, replayed: true };
  }
  return { value: await execute(), replayed: false };
}
