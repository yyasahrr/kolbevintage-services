/**
 * تنظیمات پیش از اجرای هر فایل تست.
 *
 * این فایل **قبل از بارگذاری ماژول‌های تست** اجرا می‌شود، پس `DATABASE_URL` را
 * به دیتابیس تست تغییر می‌دهد و `server/database.ts` (که رشتهٔ اتصال را به‌صورت
 * تنبل/lazy می‌خواند) هرگز به دیتابیس توسعه وصل نمی‌شود.
 *
 * `KOLBE_SEED_DEMO_DATA` اینجا روشن می‌شود چون از اصلاح D18 به بعد، کاشت دادهٔ
 * نمایشی (حساب‌های admin/vip/supplier و محصولات نمونه) **پیش‌فرض خاموش** است و
 * فقط با درخواست صریح انجام می‌شود. تست‌های موجود به آن حساب‌ها وابسته‌اند
 * (`test/helpers.ts` با `admin@kolbe.ir` وارد می‌شود)، پس این فلگ بخشی از
 * قرارداد هارنس تست است. تستِ خودِ نگهبان در `test/demo-seed-guard.test.ts`
 * ثابت می‌کند در تولید حتی با این فلگ هم چیزی کاشته نمی‌شود.
 */
const TEST_DATABASE_URL =
  process.env.KOLBE_TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV === "production" ? "production" : "test";
process.env.KOLBE_SESSION_SECRET = "test-session-secret-that-is-long-enough";
process.env.KOLBE_SEED_DEMO_DATA = "true";
