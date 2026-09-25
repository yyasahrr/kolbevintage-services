import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * مجموعهٔ متمرکزِ فاز ۶.۱: بدون دیتابیس، بدون Nest، بدون مرورگر.
 *
 * این تست‌ها باید روی هر ماشینی (از جمله ویندوز بدون PostgreSQL محلی) سبز باشند،
 * چون مرز مشترکِ فرانت‌اند نباید به زیرساختِ محلی وابسته باشد.
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
    include: ["test/phase-6-1-*.test.ts"],
  },
});
