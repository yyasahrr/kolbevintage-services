/**
 * سهمیهٔ «پرو مجازی لباس» (Try-On).
 *
 * ── چرا این فایل وجود دارد ───────────────────────────────────────────────────
 * یافتهٔ D20 ممیزی PROMPT 1: مسیر `try-on/*` **پیش از زنجیرهٔ احراز هویت و پیش از
 * اتصال به دیتابیس** پردازش می‌شد؛ یعنی هر کاربر ناشناس می‌توانست با کلید پولی
 * Perfect Corp کلبه تصویر آپلود کند و هزینه/quota تولید کند.
 *
 * اصلاح در دو لایه است:
 *   ۱) احراز هویت — در `kolbe-api.ts` پیش از رسیدن به `handlePerfectCorpRequest`
 *      (نشست مشتری/VIP الزامی است).
 *   ۲) سهمیهٔ مصرف — همین فایل: سقف ساعتی (ضد سوءاستفادهٔ سریع) و سقف روزانه
 *      (سقف هزینه). هیچ‌کدام قبلاً وجود نداشت.
 *
 * سهمیه فقط روی عملیات **هزینه‌زا** مصرف می‌شود: بارگذاری فایل و ساخت task.
 * خواندن وضعیت task و دانلود نتیجه سهمیه مصرف نمی‌کنند (اما همچنان نشست لازم دارند).
 */

import { consumeRateLimit, type RateLimitDecision } from "./rate-limit";

/** حداکثر ساخت task در هر ساعت برای یک کاربر. */
export const TRY_ON_TASK_LIMIT_PER_HOUR = 6;
/** حداکثر ساخت task در ۲۴ ساعت برای یک کاربر (سقف هزینه). */
export const TRY_ON_TASK_LIMIT_PER_DAY = 20;
/** حداکثر بارگذاری فایل در هر ساعت برای یک کاربر. */
export const TRY_ON_UPLOAD_LIMIT_PER_HOUR = 20;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * دو پنجره را پشت سر هم بررسی می‌کند: سقف ساعتی و سقف روزانه.
 * اگر یکی رد کند، دیگری هم مصرف نمی‌شود (اول، پنجرهٔ ساعتی).
 */
function consumeBoth(scope: string, userId: string, hourlyLimit: number, dailyLimit: number, now?: number): RateLimitDecision {
  const hourly = consumeRateLimit(`${scope}:hour:${userId}`, { limit: hourlyLimit, windowMs: HOUR_MS, now });
  if (!hourly.allowed) return hourly;

  const daily = consumeRateLimit(`${scope}:day:${userId}`, { limit: dailyLimit, windowMs: DAY_MS, now });
  if (!daily.allowed) return daily;

  // سخت‌گیرانه‌ترین باقی‌مانده گزارش می‌شود تا UI سقف واقعی را نشان دهد.
  return hourly.remaining <= daily.remaining ? hourly : daily;
}

/** مصرف سهمیهٔ ساخت task پرو مجازی. */
export function consumeTryOnTaskQuota(userId: string, now?: number): RateLimitDecision {
  return consumeBoth("try-on:task", userId, TRY_ON_TASK_LIMIT_PER_HOUR, TRY_ON_TASK_LIMIT_PER_DAY, now);
}

/** مصرف سهمیهٔ بارگذاری فایل پرو مجازی. */
export function consumeTryOnUploadQuota(userId: string, now?: number): RateLimitDecision {
  return consumeBoth("try-on:upload", userId, TRY_ON_UPLOAD_LIMIT_PER_HOUR, TRY_ON_UPLOAD_LIMIT_PER_HOUR, now);
}
