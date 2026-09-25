/**
 * پروژهٔ setup — یک ورودِ واقعی، بازاستفاده در همهٔ تست‌ها.
 *
 * `POST /api/v1/auth/login` با `@RateLimit({ limit: 5, windowSeconds: 60, scope: "ip" })`
 * محافظت می‌شود. اگر هر تست جداگانه وارد شود، از ورودِ ششم به بعد ۴۲۹ می‌گیرد.
 * پس اینجا **یک‌بار** با UI واقعی وارد می‌شویم و `storageState` (کوکیِ HttpOnly
 * نشست) را ذخیره می‌کنیم؛ بقیهٔ پروژه‌ها با `dependencies` از آن استفاده می‌کنند.
 *
 * محدودسازیِ نرخ عمداً دست‌نخورده باقی می‌ماند — تضعیفِ آن به‌خاطرِ راحتیِ تست
 * یک بدهیِ امنیتی است.
 *
 * عنوان‌ها با یک شناسهٔ ASCII پایدار شروع می‌شوند تا `playwright.config.ts`
 * بتواند هر setup را به پروژهٔ خودش نسبت دهد؛ این کار با grep روی متنِ فارسی
 * شکننده می‌شد.
 */

import { test as setup, expect } from "@playwright/test";
import { HAS_CREDENTIALS, MAKER_STATE, MAKER_SUPPLIER_EMAIL, NORMAL_STATE, NORMAL_SUPPLIER_EMAIL, SUPPLIER_PASSWORD, loginThroughUi } from "./helpers";

setup.describe("احراز هویتِ تستِ تأمین‌کننده", () => {
  setup.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است (KOLBE_E2E_SUPPLIER_EMAIL/PASSWORD)");

  setup("setup:normal-supplier — ورودِ تأمین‌کنندهٔ عادی", async ({ page }) => {
    await loginThroughUi(page, NORMAL_SUPPLIER_EMAIL, SUPPLIER_PASSWORD);
    await expect(page.locator(".kpi-grid")).toBeVisible({ timeout: 30_000 });
    await page.context().storageState({ path: NORMAL_STATE });
  });

  setup("setup:maker-supplier — ورودِ تأمین‌کنندهٔ تولیدکننده", async ({ page }) => {
    setup.skip(MAKER_SUPPLIER_EMAIL.length === 0, "KOLBE_E2E_SUPPLIER_MAKER_EMAIL تنظیم نشده است");
    await loginThroughUi(page, MAKER_SUPPLIER_EMAIL, SUPPLIER_PASSWORD);
    await expect(page.locator(".kpi-grid")).toBeVisible({ timeout: 30_000 });
    await page.context().storageState({ path: MAKER_STATE });
  });
});
