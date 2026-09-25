import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * مجموعهٔ متمرکزِ فاز ۶.۲ (پورتال تأمین‌کننده).
 *
 * دو دسته تست در این مجموعه هست:
 *   - تست‌های واحدِ آداپتور/رندر: بدون دیتابیس، بدون Nest (روی هر ماشینی سبز).
 *   - تست‌های زندهٔ قرارداد: فقط وقتی `KOLBE_API_INTERNAL_URL` تنظیم شده باشد
 *     اجرا می‌شوند؛ در غیر این صورت skip می‌شوند تا CI را شکننده نکنند.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "storefront"),
      "@server": path.resolve(import.meta.dirname, "server"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  /**
   * Next با SWC و runtime خودکارِ JSX کامپایل می‌کند؛ esbuildِ vitest به‌صورت
   * پیش‌فرض runtime کلاسیک (`React.createElement`) می‌سازد. بدون این تنظیم،
   * فایل‌های `.tsx` پورتال در تست با «React is not defined» می‌شکستند.
   */
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/phase-6-2-*.test.ts", "test/phase-6-2-*.test.tsx"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
