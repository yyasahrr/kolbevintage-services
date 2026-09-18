import { defineConfig } from "drizzle-kit";

/**
 * پیکربندی drizzle-kit.
 *
 * `generate` فقط SQL می‌سازد و به دیتابیس وصل نمی‌شود؛ برای همین `DATABASE_URL`
 * اختیاری است. `migrate` (اسکریپت جدا) به دیتابیس وصل می‌شود.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe",
  },
});
