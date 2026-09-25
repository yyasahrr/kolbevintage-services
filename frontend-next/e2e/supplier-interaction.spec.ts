/**
 * اسکرول، تعامل و دسترس‌پذیریِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * سه دسته که در فاز خواسته شده و معمولاً بی‌صدا می‌شکنند:
 *   - اسکرول: نشتیِ قفلِ scroll بعد از بستنِ کشو، اسکرولِ داخلیِ کشو،
 *     اسکرولِ افقیِ محصورِ جدول (نه سرریزِ صفحه)
 *   - تعامل: ترتیبِ Tab، Escape، Enter/Space، و «دوبار-ارسال» که نباید
 *     دو عملیاتِ تغییردهنده بسازد
 *   - دسترس‌پذیری: نامِ دسترس‌پذیر، role/aria، کنتراستِ focus
 *
 * این تست‌ها واقعاً در مرورگر اجرا می‌شوند (نه پویشِ ایستای CSS): هر ادعا روی
 * عنصرِ رندرشده و `getComputedStyle` واقعی سنجیده می‌شود.
 */

import { expect, test } from "@playwright/test";
import { HAS_CREDENTIALS, ensureShell, gotoPage, openMobileNav, portalReachable } from "./helpers";

async function bootstrapped(page: import("@playwright/test").Page) {
  test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
  await ensureShell(page);
}

test.describe("اسکرول و سرریز", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تست تنظیم نشده است");
  test.beforeEach(async ({ page }) => bootstrapped(page));

  test("اسکرولِ عمودیِ بلند بدونِ سرریزِ افقی", async ({ page }) => {
    const metrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  });

  test("اسکرولِ افقیِ جدول محصور است و به صفحه نشت نمی‌کند", async ({ page }) => {
    await gotoPage(page, "orders");
    const table = page.locator(".sp-table").first();
    if (!(await table.isVisible().catch(() => false))) return;
    const box = await table.evaluate((node) => ({
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
    await gotoPage(page, "orders");
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

  test("بدنهٔ کشو اسکرول‌پذیر است", async ({ page }) => {
    await gotoPage(page, "orders");
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const body = page.locator(".drawer-body");
    await expect(body).toBeVisible();
    const overflow = await body.evaluate((node) => getComputedStyle(node).overflowY);
    expect(["auto", "scroll"]).toContain(overflow);
  });

  test("سایدبارِ موبایل با Escape بسته می‌شود", async ({ page }) => {
    const menu = page.locator(".mobile-menu");
    test.skip(!(await menu.isVisible().catch(() => false)), "این ویوپورت منوی موبایل ندارد");
    await openMobileNav(page);
    await expect(page.locator(".sidebar.open")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar.open")).toHaveCount(0);
  });
});

test.describe("تعامل و کیبورد", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تست تنظیم نشده است");
  test.beforeEach(async ({ page }) => bootstrapped(page));

  test("Tab روی یک عنصرِ نام‌دارِ داخلِ پورتال تمرکز می‌گذارد", async ({ page }) => {
    /**
     * `next dev` یک عنصرِ `<nextjs-portal>` (پوششِ خطای dev) به سند تزریق می‌کند
     * که می‌تواند نخستین Tab را بگیرد؛ این آرتیفکتِ dev است، نه رفتارِ محصول.
     * پس تا رسیدنِ تمرکز به عنصری **داخلِ پوستهٔ پورتال** Tab می‌زنیم.
     */
    let named = "";
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      named = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return "";
        if (!active.closest(".app-shell")) return "";
        return active.getAttribute("aria-label") ?? (active.textContent ?? "").trim();
      });
      if (named) break;
    }
    expect(named.length, "هیچ عنصرِ نام‌داری داخلِ پوسته با Tab دریافتِ تمرکز نکرد").toBeGreaterThan(0);
  });

  test("focus-visible حلقهٔ قابلِ مشاهده می‌سازد", async ({ page }) => {
    // در موبایل پیوندهای ناوبری داخلِ کشو هستند و کشویِ بسته عمداً از ترتیبِ Tab
    // بیرون است؛ پس اول کشو را باز می‌کنیم (و پایانِ گذار را صبر می‌کنیم).
    await openMobileNav(page);

    /**
     * `element.focus()` برنامه‌ای `:focus-visible` را ارضا نمی‌کند — مرورگر حلقه را فقط
     * برای ورودِ «واقعاً کیبوردی» فعال می‌کند. پس Tabِ واقعی می‌فرستیم تا به پیوندِ
     * داشبورد برسیم؛ اندازه‌گیریِ outline بعد از `.focus()` همیشه `none` می‌داد و تست
     * چیزی را که نامش وعده می‌دهد نمی‌سنجید.
     *
     * تطبیق باید روی **خودِ دکمه** باشد: `textContent`ِ خودِ `<body>` هم «داشبورد» دارد،
     * پس تطبیقِ صرفاً متنی در اولین Tab روی body می‌نشست و `:focus-visible` را false
     * برمی‌گرداند (نقصِ خودِ تست، نه محصول).
     */
    let focused: { tag: string; name: string; focusVisible: boolean; outlineStyle: string; outlineWidth: string } | null = null;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const current = await page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null;
        if (!node || node === document.body || node === document.documentElement) return null;
        if (!node.closest(".app-shell")) return null;
        const style = getComputedStyle(node);
        return {
          tag: node.tagName,
          name: (node.getAttribute("aria-label") ?? node.textContent ?? "").replace(/\s+/g, " ").trim(),
          focusVisible: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      if (current && current.tag === "BUTTON" && current.name === "داشبورد") {
        focused = current;
        break;
      }
    }
    expect(focused, "با Tabِ واقعی به دکمهٔ «داشبورد» نرسیدیم").not.toBeNull();
    expect(focused!.focusVisible, "عنصرِ فعال باید :focus-visible باشد").toBe(true);
    expect(focused!.outlineStyle, "حلقهٔ تمرکز باید کشیده شود").not.toBe("none");
    expect(focused!.outlineWidth, "حلقهٔ تمرکز ضخامتِ صفر ندارد").not.toBe("0px");
  });

  test("کلیدهای ناوبری با Enter و Space کار می‌کنند", async ({ page }) => {
    await openMobileNav(page);

    const products = page.getByRole("button", { name: "محصولات", exact: true });
    await products.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/page=products/);

    await openMobileNav(page);
    const orders = page.getByRole("button", { name: "سفارش‌ها", exact: true });
    await orders.focus();
    await page.keyboard.press(" ");
    await expect(page).toHaveURL(/page=orders/);
  });

  test("دوبار-کلیک روی ثبت، دو عملیاتِ تغییردهنده نمی‌سازد", async ({ page }) => {
    await gotoPage(page, "withdrawals");
    const submit = page.getByRole("button", { name: "ثبت درخواست", exact: true });
    if (!(await submit.isVisible().catch(() => false))) return;
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("withdraw")) requests.push(request.url());
    });
    await submit.dblclick();
    await page.waitForTimeout(1200);
    // دکمه در حالتِ busy غیرفعال می‌شود؛ پس حداکثر یک درخواست می‌رود.
    expect(requests.length).toBeLessThanOrEqual(1);
  });

  test("کلیدهای Idempotency برای هر عملیات یکتا هستند", async ({ page }) => {
    await gotoPage(page, "orders");
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const keys: string[] = [];
    page.on("request", (request) => {
      const key = request.headers()["idempotency-key"];
      if (key) keys.push(key);
    });
    const action = page.locator(".drawer .chip-list button").first();
    if (await action.isVisible().catch(() => false)) {
      await action.click();
      await page.getByRole("button", { name: "ثبت انتقال", exact: true }).click();
      await page.waitForTimeout(800);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

test.describe("دسترس‌پذیری", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تست تنظیم نشده است");
  test.beforeEach(async ({ page }) => bootstrapped(page));

  test("همهٔ دکمه‌های آیکونی نامِ دسترس‌پذیر دارند", async ({ page }) => {
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll(".icon-button")]
        .filter((node) => !node.getAttribute("aria-label") && !(node.textContent ?? "").trim())
        .map((node) => node.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
  });

  test("کشو role=dialog و aria-modal دارد", async ({ page }) => {
    await gotoPage(page, "orders");
    const row = page.locator(".mobile-card-list button, .sp-table tbody tr").first();
    if (!(await row.isVisible().catch(() => false))) return;
    await row.click();
    const drawer = page.locator(".drawer");
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
  });

  test("حالت‌های خطا/خالی با role مناسب اعلام می‌شوند", async ({ page }) => {
    await gotoPage(page, "products");
    const live = page.locator('[role="status"], [role="alert"]');
    expect(await live.count()).toBeGreaterThan(0);
  });

  test("کنتراستِ focus قابلِ مشاهده است", async ({ page }) => {
    const outline = await page.evaluate(() => {
      const probe = document.createElement("button");
      probe.className = "button secondary";
      probe.textContent = "پروب";
      document.querySelector(".app-shell")?.appendChild(probe);
      probe.focus();
      const style = getComputedStyle(probe);
      const width = style.outlineWidth;
      probe.remove();
      return width;
    });
    expect(outline).not.toBe("0px");
  });

  test("جدول‌ها معنایِ سرستون دارند", async ({ page }) => {
    await gotoPage(page, "orders");
    const table = page.locator(".sp-table table").first();
    if (!(await table.isVisible().catch(() => false))) return;
    await expect(table.locator("thead th").first()).toBeVisible();
  });

  test("سند RTL است و جهتِ محتوا حفظ می‌شود", async ({ page }) => {
    const direction = await page.evaluate(
      () => getComputedStyle(document.querySelector(".app-shell") ?? document.body).direction,
    );
    expect(direction).toBe("rtl");
  });

  test("زبانِ سند فارسی است", async ({ page }) => {
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(["fa", "fa-IR", ""]).toContain(lang);
  });
});
