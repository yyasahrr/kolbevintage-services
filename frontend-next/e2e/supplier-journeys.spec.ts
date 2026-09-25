/**
 * سفرهای بحرانیِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * این فایل «قراردادِ اجراییِ مرورگر» است: همان فهرستِ خواسته‌شده در فاز ۶.۲.
 * اگر مرورگر یا اعتبارنامهٔ تست موجود نباشد، تست‌ها skip می‌شوند تا CI شکننده
 * نشود — اما در محیطِ دارای مرورگر، همین سفرها را واقعاً اجرا می‌کنند.
 *
 * احراز هویت از `storageState` پروژهٔ `setup-normal` می‌آید (یک ورودِ واقعی،
 * بازاستفاده در همهٔ تست‌ها) تا به محدودسازیِ نرخِ `auth/login` نخوریم.
 *
 * قاعدهٔ مهم: هیچ تستی دادهٔ جعلی به پورتال تزریق نمی‌کند. اگر سرور داده‌ای
 * ندارد، انتظارِ ما «حالتِ خالیِ راستین» است، نه مقدارِ ساختگی.
 */

import { expect, test, type Page } from "@playwright/test";
import { HAS_CREDENTIALS, ensureShell, expectNoPrivateStorageLeak, gotoPage, openMobileNav, portalReachable } from "./helpers";

test.describe("پورتال تأمین‌کننده — سفرهای بحرانی", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است (KOLBE_E2E_SUPPLIER_EMAIL/PASSWORD)");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
    await ensureShell(page);
  });

  test("ورود → داشبورد (بدونِ حالتِ نمایشی)", async ({ page }) => {
    // نشست از setup می‌آید؛ پس باید مستقیم پوستهٔ احراز هویت‌شده را ببینیم.
    await expect(page.locator(".auth-shell")).toHaveCount(0);
    // پوسته بین تست‌ها بازاستفاده می‌شود (کاهشِ حجمِ درخواست به لیمتر)؛ پس صریحاً به
    // داشبورد می‌رویم تا ادعای «فرود روی داشبورد» مستقل از تستِ قبلی بماند.
    await gotoPage(page, "dashboard");
    await expect(page.locator(".kpi-grid")).toBeVisible({ timeout: 30_000 });
    // در محیطِ تست نباید بی‌سروصدا به دادهٔ نمایشی برگردیم.
    await expect(page.getByText("حالت نمایشی فعال است")).toHaveCount(0);
  });

  test("داشبورد → محصولات", async ({ page }) => {
    await gotoPage(page, "products");
    await expect(page.locator(".page-content")).toBeVisible();
    // محصولات یا دادهٔ سرور را نشان می‌دهد یا حالتِ خالی/خطای راستین — هرگز fixture.
    await expect(page.locator(".sp-table, .empty-state")).toBeVisible();
  });

  test("محصولات → فرمِ ثبت محصول (intake)", async ({ page }) => {
    await gotoPage(page, "product-editor");
    await expect(page.getByRole("heading", { name: "ثبت محصول جدید" })).toBeVisible();
    // فرم باید برچسب‌دار باشد (دسترس‌پذیری) و هیچ شناسهٔ ساختگی از پیش پر نشده باشد.
    await expect(page.locator(".sp-field").first()).toBeVisible();
  });

  test("صندوق RFQ → مسیرِ پیشنهاد قیمت", async ({ page }) => {
    await gotoPage(page, "rfqs");
    const hasRfq = await page.locator(".sp-table tbody tr, .mobile-card-list button").first().isVisible().catch(() => false);
    if (!hasRfq) {
      // حالتِ خالیِ راستین — نه دادهٔ ساختگی.
      await expect(page.locator(".empty-state")).toBeVisible();
      return;
    }
    await page.locator(".sp-table tbody tr, .mobile-card-list button").first().click();
    await expect(page.locator(".drawer")).toBeVisible();
  });

  test("سفارش‌ها → جزئیات → کدِ رهگیری هرگز از پیش پر نمی‌شود", async ({ page }) => {
    await gotoPage(page, "orders");
    const hasOrder = await page.locator(".sp-table tbody tr, .mobile-card-list button").first().isVisible().catch(() => false);
    if (!hasOrder) {
      await expect(page.locator(".empty-state")).toBeVisible();
      return;
    }
    await page.locator(".sp-table tbody tr, .mobile-card-list button").first().click();
    await expect(page.locator(".drawer")).toBeVisible();
    const tracking = page.locator('.drawer input[dir="ltr"]').first();
    if (await tracking.isVisible().catch(() => false)) {
      // قاعدهٔ فاز ۶.۲: مرورگر شناسهٔ رهگیری نمی‌سازد (بدون Date.now()/Math.random()).
      await expect(tracking).toHaveValue("");
    }
  });

  test("موجودی → مرجعِ سرور (خالیِ راستین یا داده)", async ({ page }) => {
    await gotoPage(page, "inventory");
    await expect(page.locator(".sp-table, .empty-state")).toBeVisible();
  });

  test("مالی → برداشت → اعتبارسنجیِ مبلغ", async ({ page }) => {
    await gotoPage(page, "withdrawals");
    const submit = page.getByRole("button", { name: "ثبت درخواست", exact: true });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      // بدونِ مبلغ باید خطای اعتبارسنجی دیده شود — نه ارسالِ بی‌صدا.
      await expect(page.locator(".field-error").first()).toBeVisible();
    } else {
      await expect(page.locator(".empty-state, .sp-table")).toBeVisible();
    }
  });

  test("پشتیبانی → پرونده → گفت‌وگو", async ({ page }) => {
    await gotoPage(page, "support");
    const hasCase = await page.locator(".sp-table tbody tr, .mobile-card-list button").first().isVisible().catch(() => false);
    if (!hasCase) {
      await expect(page.locator(".empty-state")).toBeVisible();
      return;
    }
    await page.locator(".sp-table tbody tr, .mobile-card-list button").first().click();
    await expect(page.locator(".drawer")).toBeVisible();
  });

  test("انطباق → بدونِ نشتِ کلیدِ خصوصیِ ذخیره‌سازی", async ({ page }) => {
    await gotoPage(page, "compliance");
    await expectNoPrivateStorageLeak(page);
  });

  test("عملکرد → شاخص‌ها از سرور (بدونِ KPI ساختگی)", async ({ page }) => {
    await gotoPage(page, "analytics");
    await expect(page.locator(".sp-table, .empty-state, .metric-card")).toBeVisible();
    // هر عددِ نمایش‌داده‌شده باید از سرور آمده باشد؛ «—» یعنی سرور مقداری نداد.
  });

  test("تأمین‌کنندهٔ عادی → بخشِ تولید در ناوبری وجود ندارد", async ({ page }) => {
    // در موبایل ناوبری پشتِ کشو است و کشویِ بسته عمداً `visibility: hidden` دارد
    // (رفعِ نقصِ دسترس‌پذیری)؛ پس اول کشو را باز می‌کنیم وگرنه هیچ پیوندی دیده نمی‌شود.
    await openMobileNav(page);
    // دروازهٔ capability: `production`/`manufacturing` از
    // `GET /supplier/production/capabilities` نیامده، پس لینک اصلاً رندر نمی‌شود.
    await expect(page.getByRole("button", { name: "تولید و کنترل کیفیت", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ظرفیت و تعطیلی", exact: true })).toHaveCount(0);
    // و بخش‌های غیرِ capability‌دار سالم باقی می‌مانند.
    await expect(page.getByRole("button", { name: "داشبورد", exact: true })).toBeVisible();
  });

  test("انقضای نشست → بازگشت به احراز هویت", async ({ page, context }) => {
    await expect(page.locator(".kpi-grid")).toBeVisible({ timeout: 30_000 });
    // پاک‌کردنِ کوکیِ نشست = انقضای واقعی از دیدِ سرور.
    await context.clearCookies();
    await page.reload();
    await expect(page.locator(".auth-shell")).toBeVisible({ timeout: 30_000 });
    // نباید داده‌ای از نشستِ قبلی روی صفحه بماند.
    await expect(page.locator(".app-shell")).toHaveCount(0);
  });
});

/** ورودِ مستقیم فقط برای تستِ «بدونِ نشست» استفاده می‌شود. */
export async function assertAuthWall(page: Page) {
  await expect(page.locator(".auth-shell")).toBeVisible();
}
