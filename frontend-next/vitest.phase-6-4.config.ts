import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * مجموعهٔ متمرکزِ فاز ۶.۴ (پیکربندِ «رنگ → سری → تعدادِ سری» در محصولِ عمده).
 *
 * دو دسته تست دارد:
 *   - تست‌های واحدِ انتخاب‌گرها (`shared/wholesale/series.ts`): بدون دیتابیس،
 *     بدون Nest؛ حقیقتِ تجاری فقط از payloadِ سرور می‌آید.
 *   - تست‌های رندرِ jsdom برای جریانِ خریدار و قراردادِ payloadِ درخواست.
 *
 * هیچ تستِ زندهٔ قرارداد در این مجموعه نیست: این مجموعه باید روی هر ماشینی سبز
 * باشد، چون مرزِ «چه چیزی از مرورگر نباید ساخته شود» را نگه می‌دارد.
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
   * پیش‌فرض runtime کلاسیک می‌سازد. بدون این تنظیم فایل‌های `.tsx` با
   * «React is not defined» می‌شکستند.
   */
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/phase-6-4-*.test.ts", "test/phase-6-4-*.test.tsx"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
