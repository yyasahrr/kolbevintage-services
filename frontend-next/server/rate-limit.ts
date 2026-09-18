/**
 * محدودکنندهٔ نرخ و سهمیه — درون‌حافظه (Fixed Window).
 *
 * ── چرا این فایل وجود دارد ───────────────────────────────────────────────────
 * ممیزی PROMPT 1 نشان داد دو endpoint بدون هیچ سهمیه‌ای قابل سوءاستفاده هستند:
 *   • D20 — `try-on/*` بدون احراز هویت به ارائه‌دهندهٔ پولی وصل می‌شد (هزینهٔ مستقیم).
 *   • D21 — `logs/client` یک درج نامحدود در دیتابیس بود (پر شدن دیسک، مسموم‌سازی لاگ).
 * این ماژول سهمیهٔ مستقل از فریم‌ورک را فراهم می‌کند تا هر دو بسته شوند.
 *
 * ── دامنهٔ اعتبار (مهم) ─────────────────────────────────────────────────────
 * این شمارنده‌ها **فقط در حافظهٔ همین پروسه** هستند:
 *   • با ری‌استارت پروسه صفر می‌شوند؛
 *   • در استقرار چندنمونه‌ای (چند کانتینر) بین نمونه‌ها مشترک نیستند.
 * این برای فاز ۱.۵ کافی است (یک نمونهٔ Next.js امروز همهٔ ترافیک را می‌برد) و
 * در فاز ۶ با شمارندهٔ Redis/BullMQ جایگزین می‌شود. تا آن زمان، حد Nginx
 * (`infra/nginx/kolbe.conf`) لایهٔ دوم دفاع است.
 *
 * ── چرا کلید بر اساس کاربر است، نه IP ───────────────────────────────────────
 * `clientIp()` در لایهٔ API به هدر `x-forwarded-for` اعتماد می‌کند و آن هدر را
 * کلاینت می‌تواند جعل کند؛ پس محدودیت IP-محور با چرخاندن XFF دور زده می‌شود.
 * به همین دلیل سهمیهٔ عملیاتی روی شناسهٔ کاربرِ **امضاشده در نشست** بسته می‌شود.
 * (لیست سفید پروکسی معتمد برای XFF کار فاز ۶ است.)
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** سقف تعداد سطل‌ها؛ نگهبان حافظه در برابر کلیدهای بی‌شمار. */
const MAX_BUCKETS = 20_000;

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** ثانیه تا آزاد شدن سهمیه — برای هدر `Retry-After`. */
  retryAfterSeconds: number;
};

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * یک درخواست را از سهمیهٔ کلید مصرف می‌کند.
 *
 * @param key   کلید پایدار (مثلاً `try-on:task:usr_123`)
 * @param limit حداکثر تعداد مجاز در پنجره
 * @param windowMs طول پنجره به میلی‌ثانیه
 */
export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): RateLimitDecision {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now();

  if (buckets.size >= MAX_BUCKETS) pruneExpired(now);
  // اگر هنوز پر است، قدیمی‌ترین سطل‌ها حذف می‌شوند تا حافظه رشد نکند.
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = [...buckets.entries()].sort(([, a], [, b]) => a.resetAt - b.resetAt).slice(0, MAX_BUCKETS / 2);
    for (const [staleKey] of oldest) buckets.delete(staleKey);
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** پاک‌سازی کامل — فقط برای تست‌ها. */
export function resetRateLimits() {
  buckets.clear();
}

/** تعداد سطل‌های فعال — برای تست نشت حافظه. */
export function rateLimitBucketCount() {
  return buckets.size;
}
