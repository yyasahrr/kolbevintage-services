/**
 * دروازهٔ capability — سمتِ «باز» (فاز ۶.۲).
 *
 * تست‌های `supplier-journeys.spec.ts` اثبات می‌کنند که برای تأمین‌کنندهٔ **عادی**
 * بخشِ تولید اصلاً رندر نمی‌شود. اما آن تست به‌تنهایی نمی‌تواند بینِ
 * «دروازه درست کار می‌کند» و «دروازه همیشه بسته است» تفاوت بگذارد.
 *
 * این فایل با هویتِ **تولیدکننده** اجرا می‌شود (`storageState` پروژهٔ
 * `setup-maker`) تا اثبات کند وقتی `GET /supplier/production/capabilities`
 * کدِ `production`/`manufacturing` برمی‌گرداند، بخش‌های تولید واقعاً باز می‌شوند.
 *
 * تنها روی پروژهٔ `desktop-1440-light-maker` اجرا می‌شود.
 */

import { expect, test } from "@playwright/test";
import { HAS_CREDENTIALS, ensureShell, expectNoHorizontalBodyOverflow, expectNoPrivateStorageLeak, gotoPage, openMobileNav, portalReachable } from "./helpers";

test.describe("تأمین‌کنندهٔ تولیدکننده — بخشِ تولید باز است", () => {
  test.skip(!HAS_CREDENTIALS, "اعتبارنامهٔ تستِ تأمین‌کننده تنظیم نشده است");

  test.beforeEach(async ({ page }) => {
    test.skip(!(await portalReachable()), "پورتال در دسترس نیست");
    await ensureShell(page);
  });

  test("ناوبریِ تولید و ظرفیت رندر می‌شود", async ({ page }) => {
    await openMobileNav(page);
    await expect(page.getByRole("button", { name: "تولید و کنترل کیفیت", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "ظرفیت و تعطیلی", exact: true })).toBeVisible();
  });

  test("تولید → شغل‌ها از سرور (خالیِ راستین یا داده)", async ({ page }) => {
    await gotoPage(page, "production");
    await expect(page.locator(".sp-table, .empty-state")).toBeVisible();
    await expectNoHorizontalBodyOverflow(page, "production");
    await expectNoPrivateStorageLeak(page);
  });

  test("ظرفیت → دوره‌ها از سرور", async ({ page }) => {
    await gotoPage(page, "capacity");
    await expect(page.locator(".sp-table, .empty-state")).toBeVisible();
    await expectNoHorizontalBodyOverflow(page, "capacity");
  });

  test("اسکرین‌شاتِ صفحهٔ تولید (هویتِ تولیدکننده)", async ({ page }) => {
    await gotoPage(page, "production");
    await expectNoHorizontalBodyOverflow(page, `production @ ${test.info().project.name}`);
    await expect(page.locator(".page-content")).toHaveScreenshot("production.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });

  test("capabilityها از قراردادِ سرور خوانده می‌شوند، نه از مرورگر", async ({ page, request }) => {
    // همان کوکیِ نشستِ مرورگر را برای فراخوانیِ قرارداد استفاده می‌کنیم تا
    // اثبات شود منبعِ حقیقت سرور است.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await request.get("/api/v1/supplier/production/capabilities", {
      headers: { cookie: cookieHeader },
    });
    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as { capabilities: Array<{ capabilityCode: string }> };
    const codes = payload.capabilities.map((capability) => capability.capabilityCode);
    expect(codes.some((code) => code === "production" || code === "manufacturing")).toBeTruthy();
  });
});
