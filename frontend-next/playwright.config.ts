import { defineConfig, devices } from "@playwright/test";

/**
 * لایهٔ مرورگریِ فاز ۶.۲ — سفرهای بحرانیِ پورتال تأمین‌کننده + رگرسیونِ بصری.
 *
 * این تست‌ها به یک نمونهٔ در حال اجرا از پلتفرم نیاز دارند:
 *   NEXT_PUBLIC_E2E_BASE_URL  (پیش‌فرض http://127.0.0.1:3000)
 *   KOLBE_E2E_SUPPLIER_EMAIL / KOLBE_E2E_SUPPLIER_PASSWORD
 *
 * اگر مرورگر یا اعتبارنامه موجود نباشد، تست‌ها **skip** می‌شوند (نه fail) تا CI
 * شکننده نشود؛ اما در محیطِ دارای مرورگر، همان سفرهای خواسته‌شده را اجرا می‌کنند.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    locale: "fa-IR",
    // پورتال فارسی و RTL است؛ جهتِ سند بخشی از قراردادِ بصری است.
    timezoneId: "Asia/Tehran",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  projects: [
    {
      name: "desktop-light",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
    },
    {
      name: "mobile-light",
      use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 }, colorScheme: "light" },
    },
    {
      name: "mobile-dark",
      use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 }, colorScheme: "dark" },
    },
  ],
});
