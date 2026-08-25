import { defineConfig } from "@medusajs/framework/utils";

/**
 * پیکربندی بک‌اند مدوسای کلبه.
 * ماژولهای سفارشی: supplier (تأمینکنندهها) و purchase-order (سفارش خرید از ساپلایر).
 * جزئیات تصمیم: docs/adr/ADR-001-medusa-backend.md
 */
export default defineConfig({
  projectConfig: {
    redisUrl: process.env.REDIS_URL,
    database: {
      url: process.env.DATABASE_URL,
    },
    http: {
      adminCors: {
        origin: process.env.ADMIN_CORS?.split(",") ?? ["http://localhost:5173", "http://localhost:7001"],
        credentials: true,
      },
      authCors: {
        origin: process.env.AUTH_CORS?.split(",") ?? ["http://localhost:5173", "http://localhost:7001"],
        credentials: true,
      },
      storeCors: {
        origin: process.env.STORE_CORS?.split(",") ?? ["http://localhost:5173", "http://localhost:5174"],
        credentials: true,
      },
    },
  },
  modules: [
    {
      resolve: "./src/modules/supplier",
    },
    {
      resolve: "./src/modules/purchase-order",
    },
  ],
});
