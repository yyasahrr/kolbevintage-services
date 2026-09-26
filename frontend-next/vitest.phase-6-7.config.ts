import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * مجموعهٔ متمرکزِ فاز ۶.۷ (چرخهٔ عمرِ محصولِ تأمین‌کننده).
 *
 * نکتهٔ مهم: `vitest.config.ts` ریشه فقط `test/**\/*.test.ts` را شامل می‌شود، پس
 * فایل‌های `.test.tsx` با `vitest run` معمولی **اجرا نمی‌شوند**. برای همین هر
 * فازِ دارایِ تستِ کامپوننت، پیکربندیِ خودش را دارد (همان الگوی فاز ۶.۲).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "storefront"),
      "@server": path.resolve(import.meta.dirname, "server"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  // بدونِ runtime خودکارِ JSX، فایل‌های `.tsx` با «React is not defined» می‌شکنند.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/phase-6-7-*.test.ts", "test/phase-6-7-*.test.tsx"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
