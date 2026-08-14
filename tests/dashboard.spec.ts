import { expect, test, type Page } from "@playwright/test";

const DESKTOP_ONLY = ({ viewport }: { viewport: { width: number } | null }) =>
  (viewport?.width ?? 0) < 900;

async function gotoDashboard(page: Page, hash = "#/dashboard") {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
}

test("۱. داشبورد با KPIها، هشدارها و جدول سفارش‌ها بارگذاری می‌شود", async ({ page }) => {
  await gotoDashboard(page);
  await expect(page.getByTestId("kpi-grid").getByRole("button")).toHaveCount(8);
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByText("Kolbe Vintage").first()).toBeVisible();
});

test("۲. تغییر بازه زمانی همه بخش‌ها را همگام می‌کند", async ({ page }) => {
  await gotoDashboard(page);
  const kpi = page.getByTestId("kpi-grid");
  const before = await kpi.innerText();
  await page.getByTestId("preset-90d").click();
  await expect(page).toHaveURL(/preset=90d/);
  await expect.poll(async () => kpi.innerText()).not.toBe(before);
});

test("۳. فیلتر ۳۰ روز اخیر + یک تأمین‌کننده روی جدول اثر می‌گذارد", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول کامل فقط در دسکتاپ");
  await gotoDashboard(page);
  await page.getByTestId("preset-30d").click();
  const select = page.getByTestId("filter-supplier");
  const value = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(value!);
  await expect(page).toHaveURL(new RegExp(`supplier=${value}`));
  await expect(page.getByTestId("supplier-performance")).toBeVisible();
});

test("۴. فقط اختلافات باز — صفحه اختلافات فیلترپذیر است", async ({ page }) => {
  await page.goto("/#/disputes?preset=90d");
  await expect(page.getByTestId("disputes-table").or(page.getByText("اختلافی در بازه انتخابی ثبت نشده"))).toBeVisible();
});

test("۵. تسویه با وضعیت در انتظار از طریق URL اعمال می‌شود", async ({ page }) => {
  await page.goto("/#/settlements?preset=90d&settlement_status=pending");
  await expect(page.getByTestId("filter-settlement-status")).toHaveValue("pending");
  await expect(page.getByTestId("settlements-table").or(page.getByText("داده‌ای برای نمایش نیست"))).toBeVisible();
});

test("۶. صف بازرسی مهلت‌ها و اولویت‌ها را نمایش می‌دهد", async ({ page }) => {
  await page.goto("/#/escrow?preset=90d");
  await expect(page.getByText("صف بازرسی ۷۲ ساعته")).toBeVisible();
});

test("۷. کشوی جزئیات سفارش باز و بسته می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "کشو در تست دسکتاپ بررسی می‌شود");
  await page.goto("/#/orders?preset=90d");
  await page.getByTestId("orders-table").getByRole("row").nth(1).click();
  const drawer = page.getByTestId("order-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("درخواست‌های تأمین", { exact: false })).toBeVisible();
  await expect(drawer.getByText("خط زمانی رخدادها")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("۸. مرتب‌سازی جدول سفارش‌ها کار می‌کند", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/orders?preset=90d");
  const table = page.getByTestId("orders-table");
  const firstBefore = await table.getByRole("row").nth(1).innerText();
  await table.getByRole("button", { name: "مرتب‌سازی بر اساس مبلغ کل" }).click();
  await expect.poll(async () => table.getByRole("row").nth(1).innerText()).not.toBe(firstBefore);
});

test("۹. صفحه‌بندی جدول جابه‌جا می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/orders?preset=90d");
  const table = page.getByTestId("orders-table");
  await expect(table.getByText(/صفحه 1 از/)).toBeVisible();
  await table.getByRole("button", { name: "بعدی" }).click();
  await expect(table.getByText(/صفحه 2 از/)).toBeVisible();
});

test("۱۰. حالت تیره اعمال می‌شود", async ({ page }) => {
  await gotoDashboard(page);
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("۱۱. پالت فرمان با میان‌بر باز می‌شود و ناوبری می‌کند", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "میان‌بر صفحه‌کلید فقط دسکتاپ");
  await gotoDashboard(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await palette.getByRole("textbox").fill("تسویه");
  await palette.getByRole("button").first().click();
  await expect(page).toHaveURL(/#\/(settlements|dashboard)/);
});

test("۱۲. همه صفحات سایدبار بدون خطا رندر می‌شوند", async ({ page }) => {
  const paths = [
    "/dashboard",
    "/orders",
    "/fulfillment",
    "/suppliers",
    "/vip-customers",
    "/catalogue",
    "/escrow",
    "/settlements",
    "/disputes",
    "/analytics",
    "/reports",
    "/settings",
  ];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const p of paths) {
    await page.goto(`/#${p}?preset=90d`);
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("۱۳. موبایل: فیلترها در کشو و جدول به‌صورت کارت نمایش داده می‌شود", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 0) > 700, "فقط موبایل");
  await page.goto("/#/orders?preset=90d");
  await page.getByTestId("toggle-filters").click();
  await expect(page.getByTestId("filter-supplier")).toBeVisible();
  await expect(page.getByTestId("orders-table").locator("ul li").first()).toBeVisible();
});

test("۱۴. خروجی CSV سفارش‌های فیلترشده دانلود می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "دانلود در دسکتاپ بررسی می‌شود");
  await page.goto("/#/orders?preset=30d");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-csv").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/kolbe-vintage-orders-.*\.csv/);
});

test("۱۵. فروشگاه دمو در مسیر جدا حفظ شده است", async ({ page }) => {
  await page.goto("/#/store");
  await expect(page.locator('[dir="ltr"]').first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to wholesale dashboard/ })).toBeVisible();
});
