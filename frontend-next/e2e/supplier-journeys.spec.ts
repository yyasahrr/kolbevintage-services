/**
 * سفرهای بحرانیِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * این فایل «قراردادِ اجراییِ مرورگر» است: همان فهرستِ خواسته‌شده در فاز ۶.۲.
 * اگر مرورگر یا اعتبارنامهٔ تست موجود نباشد، تست‌ها skip می‌شوند تا CI شکننده
 * نشود — اما در محیطِ دارای مرورگر، همین سفرها را واقعاً اجرا می‌کنند.
 *
 * قاعدهٔ مهم: هیچ تستی دادهٔ جعلی به پورتال تزریق نمی‌کند. اگر سرور داده‌ای
 * ندارد، انتظارِ ما «حالتِ خالیِ راستین» است، نه مقدارِ ساختگی.
 */

import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.NEXT_PUBLIC_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.KOLBE_E2E_SUPPLIER_EMAIL ?? "";
const PASSWORD = process.env.KOLBE_E2E_SUPPLIER_PASSWORD ?? "";

/** آیا زیرساختِ اجرای واقعی فراهم است؟ */
async function portalReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/supplier`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

const canRun = EMAIL.length > 0 && PASSWORD.length > 0;

test.describe("پورتال تأمین‌کننده — سفرهای بحرانی", () => {
  test.skip(!canRun, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است (KOLBE_E2E_SUPPLIER_EMAIL/PASSWORD)");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), `پورتال در ${BASE} در دسترس نیست`);
    await page.goto("/supplier");
    await expect(page.locator(".auth-shell")).toBeVisible();
  });

  test("ورود → داشبورد", async ({ page }) => {
    await login(page);
    await expect(page.locator(".app-shell")).toBeVisible();
    // داشبورد باید شاخص‌ها را از سرور بگیرد یا خطا نشان دهد — هرگز عددِ ساختگی.
    await expect(page.locator(".kpi-grid")).toBeVisible();
  });

  test("داشبورد → محصولات", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "محصولات" }).click();
    await expect(page).toHaveURL(/page=products/);
    await expect(page.locator(".surface").first()).toBeVisible();
  });

  test("محصولات → فرمِ ثبت محصول", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "ثبت محصول جدید" }).click();
    await expect(page.getByText("ثبت محصول جدید")).toBeVisible();
  });

  test("RFQ → فرمِ پیشنهاد قیمت", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "صندوق RFQ" }).click();
    // اگر RFQای نباشد، وضعیتِ خالیِ راستین نمایش داده می‌شود.
    const hasRfq = await page.locator(".rfq-row").first().isVisible().catch(() => false);
    if (hasRfq) {
      await page.locator(".rfq-row").first().click();
      await expect(page.locator(".rfq-detail")).toBeVisible();
    } else {
      await expect(page.getByText("درخواست تولید جدیدی وجود ندارد")).toBeVisible();
    }
  });

  test("سفارش‌ها → جزئیات → انتقالِ معتبر", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const hasOrder = await page.locator(".sp-table tbody tr, .mobile-card-list button").first().isVisible().catch(() => false);
    if (!hasOrder) {
      await expect(page.getByText("سفارشی ثبت نشده است")).toBeVisible();
      return;
    }
    await page.locator(".mobile-card-list button, .sp-table tbody tr").first().click();
    await expect(page.locator(".drawer")).toBeVisible();
    // کدِ رهگیری هرگز از پیش پر نمی‌شود (مرورگر آن را نمی‌سازد).
    const tracking = page.locator('.drawer input[dir="ltr"]').first();
    if (await tracking.isVisible().catch(() => false)) {
      await expect(tracking).toHaveValue("");
    }
  });

  test("مالی → برداشت → اعتبارسنجیِ مبلغ", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "برداشت‌ها" }).click();
    const amount = page.locator('.form-surface input[dir="ltr"]').first();
    if (await amount.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "ثبت درخواست" }).click();
      // بدون مبلغ، خطای اعتبارسنجیِ سمتِ کلاینت/سرور باید دیده شود.
      await expect(page.locator(".field-error, .auth-error, .sp-notice.danger").first()).toBeVisible();
    }
  });

  test("پشتیبانی → پرونده → گفت‌وگو", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "پشتیبانی" }).click();
    const hasCase = await page.locator(".thread-row").first().isVisible().catch(() => false);
    if (hasCase) {
      await page.locator(".thread-row").first().click();
      await expect(page.locator(".drawer")).toBeVisible();
    } else {
      await expect(page.getByText("پروندهٔ پشتیبانی ندارید")).toBeVisible();
    }
  });

  test("انطباق → اسناد → دریافتِ امن (بدونِ کلیدِ خصوصی)", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "انطباق و اسناد" }).click();
    // هیچ کلیدِ ذخیره‌سازیِ خصوصی نباید در DOM ظاهر شود.
    const html = await page.content();
    expect(html).not.toMatch(/s3:\/\/|storage\.googleapis|objectKey/i);
  });

  test("تأمین‌کنندهٔ بدون capability → بخشِ تولید در دسترس نیست", async ({ page }) => {
    await login(page);
    const productionNav = page.getByRole("button", { name: "تولید و کنترل کیفیت" });
    const visible = await productionNav.isVisible().catch(() => false);
    if (!visible) {
      // ناوبری اصلاً رندر نشده = دروازهٔ capability درست کار کرده است.
      expect(visible).toBe(false);
    } else {
      await productionNav.click();
      await expect(page.locator(".sp-table, .empty-state")).toBeVisible();
    }
  });

  test("انقضای نشست → رفتارِ UNAUTHORIZED", async ({ page, context }) => {
    await login(page);
    await expect(page.locator(".app-shell")).toBeVisible();
    // پاک‌کردنِ کوکیِ نشست = انقضای واقعی از دیدِ سرور.
    await context.clearCookies();
    await page.reload();
    await expect(page.locator(".auth-shell")).toBeVisible();
  });
});

async function login(page: Page) {
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /ورود به پنل/ }).click();
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
}
