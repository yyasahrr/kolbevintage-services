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
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
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
