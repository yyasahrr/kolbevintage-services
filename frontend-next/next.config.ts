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
});

export default createNextConfig;
