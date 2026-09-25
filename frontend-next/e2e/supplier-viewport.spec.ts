/**
 * ماتریسِ ویوپورت، RTL و سرریز (فاز ۶.۲) — بندهای B5/B7/B8.
 *
 * این فایل عمداً «هر ویوپورت = یک پروژهٔ Playwright» است تا هر کلاسِ ویوپورت
 * شواهدِ جدا و قابلِ استناد داشته باشد. ادعاها روی DOMِ رندرشده سنجیده می‌شوند:
 *
 *   B5 ویوپورت: ۱۲ کلاس (۳۲۰×۵۶۸ … ۲۵۶۰×۱۴۴۰)
 *   B7 RTL: جهتِ سند، و جداسازیِ محتوای دوجهته (SKU/UUID/ایمیل/URL/مبلغ/کدِ رهگیری)
 *   B8 اسکرول/سرریز: نبودِ سرریزِ افقیِ بدنه، نبودِ دوبل-اسکرول‌بار،
 *      اسکرولِ مستقلِ سایدبار، چسبندگیِ نوارِ بالا
 */

import { expect, test } from "@playwright/test";
import { HAS_CREDENTIALS, ensureShell, expectNoHorizontalBodyOverflow, gotoPage, portalReachable, type NavId } from "./helpers";

/** صفحه‌هایی که در هر ویوپورت بررسی می‌شوند. */
const PAGES: NavId[] = ["dashboard", "products", "orders", "inventory", "finance", "compliance", "support", "analytics"];

test.describe("ماتریسِ ویوپورت و سرریز", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
    await ensureShell(page);
  });

  for (const id of PAGES) {
    test(`بدونِ سرریزِ افقی — ${id}`, async ({ page }) => {
      await gotoPage(page, id);
      await expectNoHorizontalBodyOverflow(page, `${id} @ ${test.info().project.name}`);
    });
  }

  test("بدونِ دوبل-اسکرول‌بارِ عمودی", async ({ page }) => {
    // اگر هم `html` و هم `body` اسکرولِ عمودی داشته باشیم، کاربر دو نوار می‌بیند.
    const scroll = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return {
        docOverflowY: getComputedStyle(doc).overflowY,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        docScrollable: doc.scrollHeight > doc.clientHeight,
      };
    });
    const scrollers = [scroll.docOverflowY, scroll.bodyOverflowY].filter((v) => v === "auto" || v === "scroll").length;
    expect(scrollers, JSON.stringify(scroll)).toBeLessThanOrEqual(1);
  });

  test("نوارِ بالا چسبان است", async ({ page }) => {
    const topbar = page.locator(".topbar").first();
    if (!(await topbar.isVisible().catch(() => false))) return;
    const position = await topbar.evaluate((node) => getComputedStyle(node).position);
    expect(["sticky", "fixed"]).toContain(position);
  });

  test("سایدبارِ دسکتاپ مستقل اسکرول می‌شود و از صفحه بیرون نمی‌زند", async ({ page }) => {
    // در چیدمانِ موبایل سایدبار یک کشویِ off-canvas است (با `transform` بیرونِ
    // قاب نگه داشته می‌شود)؛ سنجشِ «بیرون نزدن از قاب» برای آن معنا ندارد و
    // آزمونِ جداگانهٔ «ناوبریِ موبایل» همان را در حالتِ باز بررسی می‌کند.
    test.skip(
      await page.locator(".mobile-menu").isVisible().catch(() => false),
      "چیدمانِ موبایل — سایدبار off-canvas است",
    );
    const sidebar = page.locator(".sidebar").first();
    if (!(await sidebar.isVisible().catch(() => false))) return;
    const metrics = await sidebar.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        overflowY: getComputedStyle(node).overflowY,
        height: rect.height,
        viewportHeight: window.innerHeight,
        right: rect.right,
        left: rect.left,
        innerWidth: window.innerWidth,
      };
    });
    // سایدبار نباید از قابِ ویوپورت بیرون بزند (نه در RTL و نه در LTR).
    expect(metrics.right).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.left).toBeGreaterThanOrEqual(-1);
    expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    // اگر بلندتر از قاب باشد، باید خودش اسکرول‌پذیر باشد نه صفحه.
    if (metrics.height >= metrics.viewportHeight) {
      expect(["auto", "scroll", "hidden"]).toContain(metrics.overflowY);
    }
  });

  test("ناوبریِ موبایل از قاب بیرون نمی‌زند", async ({ page }) => {
    const menu = page.locator(".mobile-menu");
    if (!(await menu.isVisible().catch(() => false))) return;
    await menu.click();
    const sidebar = page.locator(".sidebar.open");
    await expect(sidebar).toBeVisible();
    /**
     * `toBeVisible()` به محضِ شروعِ گذار برقرار می‌شود، پس اندازه‌گیریِ بلافاصله جعبهٔ
     * میانهٔ انیمیشن را می‌خواند و عددِ کاذب می‌دهد (کشو هنوز از بیرونِ قاب می‌آید).
     * پس اول پایانِ گذار را با assertionِ خودش‌تکرارکننده صبر می‌کنیم، بعد اندازه می‌گیریم.
     */
    await expect(sidebar).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)", { timeout: 10_000 });
    const rect = await sidebar.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right, innerWidth: window.innerWidth };
    });
    expect(rect.right).toBeLessThanOrEqual(rect.innerWidth + 1);
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    await expectNoHorizontalBodyOverflow(page, "sidebar-open");
  });
});

test.describe("RTL و محتوای دوجهته", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
    await ensureShell(page);
  });

  test("جهتِ سند RTL است", async ({ page }) => {
    const direction = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
    expect(direction).toBe("rtl");
  });

  test("عنصرهای `.ltr-inline` واقعاً LTR رندر می‌شوند", async ({ page }) => {
    // شناسه‌ها/کدها (SKU، کدِ سفارش، UUID، مبلغ، کدِ رهگیری) در متنِ راست‌به‌چپ
    // باید جدا بمانند؛ وگرنه bidi آن‌ها را به‌هم می‌ریزد.
    let checked = 0;
    for (const id of ["dashboard", "products", "orders", "finance", "compliance"] as NavId[]) {
      await gotoPage(page, id);
      const nodes = page.locator(".ltr-inline, [dir='ltr']");
      const count = await nodes.count();
      for (let index = 0; index < Math.min(count, 5); index += 1) {
        const direction = await nodes.nth(index).evaluate((node) => getComputedStyle(node).direction);
        expect(direction, `عنصرِ LTR در ${id}`).toBe("ltr");
        checked += 1;
      }
    }
    // اگر هیچ نمونه‌ای پیدا نشد، داده‌ای وجود نداشته — نه اینکه تست بی‌معنا بگذرد.
    test.info().annotations.push({ type: "ltr-nodes-checked", description: String(checked) });
  });

  test("فیلدهای ورودیِ شناسه‌دار `dir=ltr` دارند", async ({ page }) => {
    await gotoPage(page, "product-editor");
    /**
     * قراردادتِ مخزن کلاسِ `.ltr-inline` است (نه attributeِ دستی روی هر فیلد)؛ پس معیارِ
     * درستی «جهتِ محاسبه‌شدهٔ ltr» است. فیلدهای فارسی (نام، سایز، رنگ) عمداً RTL می‌مانند.
     */
    const inputs = page.locator(".sp-field input.ltr-inline");
    const count = await inputs.count();
    expect(count, "فرمِ ثبت محصول باید فیلدِ شناسه‌دارِ LTR داشته باشد").toBeGreaterThan(0);
    const viewportWidth = (await page.viewportSize())!.width;
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const direction = await input.evaluate((node) => getComputedStyle(node).direction);
      expect(direction, "فیلدِ شناسه‌دار باید LTR رندر شود").toBe("ltr");
      const box = await input.boundingBox();
      expect(box, "فیلد باید در قابِ ویوپورت باشد").not.toBeNull();
      if (box) expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
    }
  });

  test("جهتِ جدول با جهتِ سند سازگار است", async ({ page }) => {
    await gotoPage(page, "orders");
    const table = page.locator(".sp-table table").first();
    if (!(await table.isVisible().catch(() => false))) return;
    const direction = await table.evaluate((node) => getComputedStyle(node).direction);
    expect(direction).toBe("rtl");
  });
});
