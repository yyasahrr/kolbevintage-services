import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * پیکربندی Next.js کلبه وینتیج
 *
 * کل پروژه از این لایه سرو می‌شود:
 * - فرانت‌اند فروشگاه: همه مسیرها (روتر هش‌محور SPA)
 * - پورتال ساپلایر: /supplier
 * - API: /store/kolbe/* و /admin/kolbe/* به‌صورت route handler داخلی
 * - داده‌ها: اتصال مستقیم سرور Next.js به PostgreSQL
 */

const createNextConfig = (phase: string): NextConfig => ({
  reactStrictMode: true,

  // build و dev هم‌زمان فایل‌های یکدیگر را بازنویسی نکنند.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",

  // کد فروشگاه از نسخه Vite آمده و تایپچک سخت‌گیرانه ندارد؛
  // مثل قبل (vite build) بدون تایپچک بیلد می‌شود.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },

  // پیشنمایش مرورگر از دامنه e2b سرو می‌شود
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],

  async headers() {
    return [
      {
        // کش نشود تا تغییرات سایت‌ساز/تم فوری دیده شوند
        source: "/:path*",
        headers: [{ key: "x-kolbe-layer", value: "next" }],
      },
    ];
  },

  /**
   * فاز ۶.۲ — هم‌ارزسازی سرور توسعه با توپولوژی Nginx تولید.
   *
   * در تولید `infra/nginx/kolbe.conf` مسیر `/api/v1/` را به سرویس Nest
   * (`kolbe_api`) پروکسی می‌کند؛ بنابراین کلاینتِ مرورگر می‌تواند از
   * `CANONICAL_API_BASE = "/api/v1"` (همان-origin، کوکی HttpOnly، بدون CORS)
   * استفاده کند.
   *
   * اما `next dev` به‌تنهایی فقط `/store/kolbe/*` و `/admin/kolbe/*` را سرو
   * می‌کند و هیچ هندلری برای `/api/v1` ندارد. بدون این rewrite، پورتال
   * تأمین‌کننده در پشتهٔ توسعه هیچ‌گاه به APIهای canonical نمی‌رسد.
   *
   * نکات ایمنی/دامنهٔ اثر:
   *  - به‌صورت پیش‌فرض فقط در `PHASE_DEVELOPMENT_SERVER` فعال است؛ استقرارِ
   *    تولید هیچ rewrite ای نمی‌گیرد و رفتارشان دقیقاً مثل قبل است.
   *  - برای دروازهٔ مرورگری فاز ۶.۲ لازم است روی `next start` (بیلدِ تولیدی،
   *    بدون آرتیفکت‌های dev مثل `next-js-portal`) هم همین توپولوژی بازتولید
   *    شود؛ به همین دلیل با فلگِ **صریح و خاموشِ** `KOLBE_E2E_PROXY_API=1`
   *    قابلِ فعال‌سازی است. بدونِ آن فلگ، رفتارِ تولید دست‌نخورده است.
   *  - در هر دو حالت فقط وقتی فعال است که `KOLBE_API_INTERNAL_URL` تنظیم شده
   *    باشد؛ یعنی هیچ آدرس میزبان/پورتی در کد hardcode نشده است.
   *  - دامنهٔ آن صرفاً `/api/v1/*` است، پس هندلرِ `/api/health` و دو پروکسیِ
   *    سازگاری دست‌نخورده می‌مانند.
   */
  async rewrites() {
    const development = phase === PHASE_DEVELOPMENT_SERVER;
    const explicitlyEnabled = (process.env.KOLBE_E2E_PROXY_API ?? "").trim() === "1";
    if (!development && !explicitlyEnabled) return [];
    const configured = (process.env.KOLBE_API_INTERNAL_URL ?? "").trim();
    if (!configured) return [];
    const upstream = configured.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    return [{ source: "/api/v1/:path*", destination: `${upstream}/api/v1/:path*` }];
  },
});

export default createNextConfig;
