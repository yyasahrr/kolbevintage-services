/**
 * رگرسیونِ بصریِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * هدف: اثباتِ «انجمادِ بصری». حالتِ روشن باید همان هویتِ تأییدشده بماند و
 * حالتِ تیره کامل و خوانا باشد. اسکرین‌شات‌ها در
 * `e2e/__screenshots__/<project>/` ذخیره می‌شوند و در PR بازبینی می‌شوند.
 *
 * ماتریسِ ویوپورت دیگر داخلِ تست حلقه نمی‌خورد: هر ویوپورت یک **پروژهٔ
 * Playwright** است (۱۲ کلاسِ ویوپورت + تمِ تاریکِ نماینده) تا شواهدِ هر کلاس
 * جدا و قابلِ استناد باشد.
 *
 * تفاوتِ بصری فقط در این موارد پذیرفته است (و در گزارشِ فاز ثبت شده):
 *   - رفعِ نقص (سرریز، تراز، کنتراست)
 *   - اصلاحِ واکنش‌گرایی
 *   - اصلاحِ دسترس‌پذیری
 *   - هم‌راستایی با توکن‌های طراحی
 *   - UI تازه برای قابلیتِ صرفاً-بک‌اندی
 */

import { expect, test } from "@playwright/test";
import { HAS_CREDENTIALS, SCREENSHOT_PAGES, ensureShell, expectNoHorizontalBodyOverflow, expectNoPrivateStorageLeak, gotoPage, portalReachable } from "./helpers";

test.describe("رگرسیونِ بصری — وضعیت‌های نماینده", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
    await ensureShell(page);
  });

  for (const id of SCREENSHOT_PAGES) {
    test(`اسکرین‌شاتِ ${id}`, async ({ page }) => {
      await gotoPage(page, id);
      // اجازهٔ پایانِ درخواست‌ها؛ اسکرین‌شاتِ وسطِ بارگذاری بی‌ارزش است.
      await expectNoHorizontalBodyOverflow(page, `${id} @ ${test.info().project.name}`);
      await expectNoPrivateStorageLeak(page);
      await expect(page.locator(".page-content")).toHaveScreenshot(`${id}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }

  test("اسکرین‌شاتِ جزئیاتِ سفارش (کشو)", async ({ page }) => {
    await gotoPage(page, "orders");
    const row = page.locator(".sp-table tbody tr, .mobile-card-list button").first();
    if (!(await row.isVisible().catch(() => false))) {
      // بدونِ سفارش کشویی باز نمی‌شود؛ همان حالتِ خالیِ راستین شواهدِ بصری است.
      await expect(page.locator(".empty-state")).toBeVisible();
      await expect(page.locator(".page-content")).toHaveScreenshot("order-detail-empty.png", {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
      return;
    }
    await row.click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveScreenshot("order-detail.png", { maxDiffPixelRatio: 0.01 });
  });
});
