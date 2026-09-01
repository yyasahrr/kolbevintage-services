import type { NextConfig } from "next";

/**
 * پیکربندی Next.js کلبه وینتیج
 *
 * کل پروژه از این لایه سرو می‌شود:
 * - فرانت‌اند فروشگاه: همه مسیرها (روتر هش‌محور SPA)
 * - پورتال ساپلایر: /supplier
 * - بک‌اند: /store/kolbe/* و /admin/kolbe/* به‌صورت route handler
 *   که درخواستها را به موتور Medusa (Node/TypeScript، پورت ۹۰۰۰) فوروارد می‌کند.
 */

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
};

export default nextConfig;
