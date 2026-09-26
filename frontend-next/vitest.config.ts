import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * هارنس تست بک‌اند کلبه.
 *
 * چرا Vitest و نه Jest؟ چون کد سرور با ESM و aliasهای tsconfig نوشته شده و
 * Vitest همان مسیرهای `@/*` و `@server/*` را بدون transform اضافه می‌فهمد.
 *
 * چرا تست مستقیم `handleKolbeRequest`؟ چون کل بک‌اند فعلی یک تابع خالص
 * (Request → Response) است؛ این کار بدون بالا آوردن سرور، مرزهای امنیتی و
 * قرارداد API را واقعی آزمایش می‌کند و سریع است.
 * پس از استقرار NestJS (فاز ۲)، همین تست‌ها به آزمون هم‌ارزی (Parity) تبدیل می‌شوند.
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
   * فایل‌های `.tsx` با «React is not defined» می‌شکنند.
   */
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    /**
     * `.test.tsx` هم باید شامل شود.
     *
     * پیش‌تر فقط `test/**\/*.test.ts` بود، یعنی **هیچ** آزمونِ کامپوننتی با
     * `vitest run` معمولی اجرا نمی‌شد — سکوتِ کامل، بدونِ هیچ هشداری. تست‌های
     * `.tsx` فقط از راهِ پیکربندیِ فازِ خودشان (`test:phase-6-2` و مانند آن)
     * اجرا می‌شدند. پیکربندی‌های فاز، فایلِ جدا هستند و این را merge نمی‌کنند،
     * پس افزودنِ `.tsx` در اینجا باعثِ اجرای دوبارهٔ چیزی در آن‌ها نمی‌شود.
     */
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // تست‌ها روی یک دیتابیس مشترک اجرا می‌شوند؛ اجرای موازی فایل‌ها
    // باعث race روی موجودی/seed می‌شود.
    fileParallelism: false,
    pool: "forks",
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
