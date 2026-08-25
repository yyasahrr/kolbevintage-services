import { loadEnv, defineConfig } from "@medusajs/framework/utils";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

/**
 * پیکربندی بک‌اند مدوسای کلبه.
 * ماژولهای سفارشی: account (احراز هویت)، supplier (تأمین)، wholesale (عمده/VIP/RFQ/تیکت)،
 * purchase_order (سفارش خرید)، retail (سفارش خرده) + پرووایدر زرینپال.
 * جزئیات تصمیم: docs/adr/ADR-001-medusa-backend.md
 */
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS ?? "http://localhost:5173",
      adminCors: process.env.ADMIN_CORS ?? "http://localhost:7001",
      authCors: process.env.AUTH_CORS ?? "http://localhost:7001",
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    { resolve: "./src/modules/account" },
    { resolve: "./src/modules/supplier" },
    { resolve: "./src/modules/purchase-order" },
    { resolve: "./src/modules/wholesale" },
    { resolve: "./src/modules/retail" },
  ],
  providers: [
    {
      resolve: "./src/modules/payment-zarinpal",
      id: "zarinpal",
      options: { merchantId: process.env.ZARINPAL_MERCHANT_ID, sandbox: true },
    },
  ],
});
