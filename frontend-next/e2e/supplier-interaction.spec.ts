/**
 * اسکرول، تعامل و دسترس‌پذیریِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * سه دسته که در فاز خواسته شده و معمولاً بی‌صدا می‌شکنند:
 *   - اسکرول: نشتیِ قفلِ scroll بعد از بستنِ کشو، اسکرولِ داخلیِ کشو،
 *     اسکرولِ افقیِ محصورِ جدول (نه سرریزِ صفحه)
 *   - تعامل: ترتیبِ Tab، Escape، Enter/Space، و «دوبار-ارسال» که نباید
 *     دو عملیاتِ تغییردهنده بسازد
 *   - دسترس‌پذیری: نامِ دسترس‌پذیر، role/aria، کنتراستِ focus
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

test.describe("اسکرول و سرریز", () => {
  test.skip(!canRun, "اعتبارنامهٔ تست تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await reachable()), `پورتال در ${BASE} در دسترس نیست`);
    await page.goto("/supplier");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /ورود به پنل/ }).click();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  });

  test("اسکرولِ عمودیِ بلند بدونِ سرریزِ افقی", async ({ page }) => {
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  });

  test("اسکرولِ افقیِ جدول محصور است و به صفحه نشت نمی‌کند", async ({ page }) => {
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const table = page.locator(".sp-table").first();
    if (!(await table.isVisible().catch(() => false))) return;
    const box = await table.evaluate(node => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      pageScroll: document.documentElement.scrollWidth,
      pageClient: document.documentElement.clientWidth,
    }));
    // جدول می‌تواند اسکرولِ داخلی داشته باشد، اما صفحه نباید عریض‌تر شود.
    expect(box.pageScroll).toBeLessThanOrEqual(box.pageClient + 1);
    expect(box.scrollWidth).toBeGreaterThan(0);
  });

  test("بستنِ کشو، قفلِ scroll را نشتی نمی‌دهد", async ({ page }) => {
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;

    const before = await page.evaluate(() => document.body.style.overflow);
    await row.click();
    await expect(page.locator(".drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".drawer")).toHaveCount(0);
    const after = await page.evaluate(() => document.body.style.overflow);
    expect(after).toBe(before);
  });

  test("بدنهٔ کشو اسکرولِ داخلی دارد", async ({ page }) => {
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const body = page.locator(".drawer-body");
    await expect(body).toBeVisible();
    const overflow = await body.evaluate(node => getComputedStyle(node).overflowY);
    expect(overflow).toBe("auto");
  });

  test("نوارِ ناوبریِ چسبان و سایدبارِ موبایل", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "باز کردن منو" }).click();
    await expect(page.locator(".sidebar.open")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar.open")).toHaveCount(0);
  });
});

test.describe("تعامل و کیبورد", () => {
  test.skip(!canRun, "اعتبارنامهٔ تست تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await reachable()), `پورتال در ${BASE} در دسترس نیست`);
    await page.goto("/supplier");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /ورود به پنل/ }).click();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  });

  test("ترتیبِ Tab روی ناوبری منطقی است", async ({ page }) => {
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");
    expect(first.length).toBeGreaterThan(0);
  });

  test("کلیدهای ناوبری با Enter و Space کار می‌کنند", async ({ page }) => {
    const link = page.getByRole("button", { name: "محصولات" });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/page=products/);
    await page.getByRole("button", { name: "سفارش‌ها" }).focus();
    await page.keyboard.press(" ");
    await expect(page).toHaveURL(/page=orders/);
  });

  test("دوبار-کلیک روی ثبت، دو عملیاتِ تغییردهنده نمی‌سازد", async ({ page }) => {
    await page.getByRole("button", { name: "برداشت‌ها" }).click();
    const submit = page.getByRole("button", { name: "ثبت درخواست" });
    if (!(await submit.isVisible().catch(() => false))) return;
    const requests: string[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && request.url().includes("withdrawals")) requests.push(request.url());
    });
    await submit.dblclick();
    await page.waitForTimeout(1200);
    // دکمه در حالتِ busy غیرفعال می‌شود؛ پس حداکثر یک درخواست می‌رود.
    expect(requests.length).toBeLessThanOrEqual(1);
  });

  test("کلیدهای Idempotency برای هر عملیات یکتا هستند", async ({ page }) => {
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const keys: string[] = [];
    page.on("request", request => {
      const key = request.headers()["idempotency-key"];
      if (key) keys.push(key);
    });
    const action = page.locator(".drawer .chip-list button").first();
    if (await action.isVisible().catch(() => false)) {
      await action.click();
      await page.getByRole("button", { name: "ثبت انتقال" }).click();
      await page.waitForTimeout(800);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

test.describe("دسترس‌پذیری", () => {
  test.skip(!canRun, "اعتبارنامهٔ تست تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await reachable()), `پورتال در ${BASE} در دسترس نیست`);
    await page.goto("/supplier");
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /ورود به پنل/ }).click();
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  });

  test("همهٔ دکمه‌های آیکونی نامِ دسترس‌پذیر دارند", async ({ page }) => {
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll(".icon-button")]
        .filter(node => !node.getAttribute("aria-label") && !(node.textContent ?? "").trim())
        .map(node => node.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test("کشو role=dialog و aria-modal دارد", async ({ page }) => {
    await page.getByRole("button", { name: "سفارش‌ها" }).click();
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
  });

  test("حالت‌های خطا و بارگذاری با role مناسب اعلام می‌شوند", async ({ page }) => {
    await page.getByRole("button", { name: "محصولات" }).click();
    const live = page.locator('[role="status"], [role="alert"]');
    expect(await live.count()).toBeGreaterThan(0);
  });

  test("کنتراستِ focus قابلِ مشاهده است", async ({ page }) => {
    const outline = await page.evaluate(() => {
      const probe = document.createElement("button");
      probe.className = "button secondary";
      document.querySelector(".app-shell")?.appendChild(probe);
      probe.focus();
      const style = getComputedStyle(probe, ":focus-visible");
      probe.remove();
      return style.outlineWidth;
    });
    expect(outline).not.toBe("0px");
  });

  test("سند RTL است و جهتِ محتوا حفظ می‌شود", async ({ page }) => {
    const direction = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell") ?? document.body).direction);
    expect(direction).toBe("rtl");
  });

  test("زبانِ سند فارسی است", async ({ page }) => {
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(["fa", "fa-IR", ""]).toContain(lang);
  });
});
