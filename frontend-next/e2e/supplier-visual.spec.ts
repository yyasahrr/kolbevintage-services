/**
 * رگرسیونِ بصریِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * هدف: اثباتِ «انجمادِ بصری». حالتِ روشن باید همان هویتِ تأییدشده بماند و
 * حالتِ تیره کامل و خوانا باشد. اسکرین‌شات‌ها در
 * `e2e/__screenshots__/<project>/` ذخیره می‌شوند و در PR بازبینی می‌شوند.
 *
 * تفاوتِ بصری فقط در این موارد پذیرفته است (و در گزارشِ فاز ثبت شده):
 *   - رفعِ نقص (سرریز، تراز، کنتراست)
 *   - اصلاحِ واکنش‌گرایی
 *   - اصلاحِ دسترس‌پذیری
 *   - هم‌راستایی با توکن‌های طراحی
 *   - UI تازه برای قابلیتِ صرفاً-بک‌اندی
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.NEXT_PUBLIC_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.KOLBE_E2E_SUPPLIER_EMAIL ?? "";
const PASSWORD = process.env.KOLBE_E2E_SUPPLIER_PASSWORD ?? "";

const canRun = EMAIL.length > 0 && PASSWORD.length > 0;

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/supplier`)).ok;
  } catch {
    return false;
  }
}

/** ویوپورت‌های خواسته‌شده در فاز ۶.۲. */
const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "820x1180", width: 820, height: 1180 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
] as const;

test.describe("رگرسیونِ بصری — وضعیت‌های نماینده", () => {
  test.skip(!canRun, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await reachable()), `پورتال در ${BASE} در دسترس نیست`);
    await page.goto("/supplier");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /ورود به پنل/ }).click();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  });

  for (const page of ["dashboard", "products", "orders", "finance", "compliance", "support", "analytics"] as const) {
    test(`اسکرین‌شاتِ ${page}`, async ({ page: browser }, info) => {
      await browser.getByRole("button", { name: NAV_LABEL[page] }).click();
      await expect(browser).toHaveURL(new RegExp(`page=${page}`));
      // اجازهٔ پایانِ درخواست‌ها؛ اسکرین‌شاتِ وسطِ بارگذاری بی‌ارزش است.
      await browser.waitForLoadState("networkidle").catch(() => undefined);
      await expect(browser.locator(".page-content")).toHaveScreenshot(`${page}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
      expect(info.project.name).toBeTruthy();
    });
  }
});

test.describe("بدونِ سرریزِ افقی در هیچ ویوپورتی", () => {
  test.skip(!canRun, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  for (const viewport of VIEWPORTS) {
    test(`ویوپورتِ ${viewport.name}`, async ({ page }) => {
      test.skip(!(await reachable()), `پورتال در ${BASE} در دسترس نیست`);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/supplier");
      await page.locator('input[type="email"]').fill(EMAIL);
      await page.locator('input[type="password"]').fill(PASSWORD);
      await page.getByRole("button", { name: /ورود به پنل/ }).click();
      await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });

      for (const target of ["dashboard", "products", "orders", "finance", "compliance", "support"] as const) {
        await page.getByRole("button", { name: NAV_LABEL[target] }).click();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        // معیارِ اصلی: عرضِ محتوای سند نباید از ویوپورت بیشتر شود.
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
        });
        expect(
          overflow.scrollWidth,
          `${target} در ${viewport.name}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    });
  }
});

const NAV_LABEL = {
  dashboard: "داشبورد",
  products: "محصولات",
  orders: "سفارش‌ها",
  finance: "مالی و تسویه",
  compliance: "انطباق و اسناد",
  support: "پشتیبانی",
  analytics: "عملکرد",
} as const;
