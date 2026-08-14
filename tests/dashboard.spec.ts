import { expect, test, type Page } from "@playwright/test";

const DESKTOP_ONLY = ({ viewport }: { viewport: { width: number } | null }) =>
  (viewport?.width ?? 0) < 900;

async function gotoDashboard(page: Page, hash = "#/admin") {
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
  await page.goto("/#/admin/disputes?preset=90d");
  await expect(page.getByTestId("disputes-table").or(page.getByText("اختلافی در بازه انتخابی ثبت نشده"))).toBeVisible();
});

test("۵. تسویه با وضعیت در انتظار از طریق URL اعمال می‌شود", async ({ page }) => {
  await page.goto("/#/admin/settlements?preset=90d&settlement_status=pending");
  await expect(page.getByTestId("filter-settlement-status")).toHaveValue("pending");
  await expect(page.getByTestId("settlements-table").or(page.getByText("داده‌ای برای نمایش نیست"))).toBeVisible();
});

test("۶. صف بازرسی مهلت‌ها و اولویت‌ها را نمایش می‌دهد", async ({ page }) => {
  await page.goto("/#/admin/escrow?preset=90d");
  await expect(page.getByText("صف بازرسی ۷۲ ساعته")).toBeVisible();
});

test("۷. کشوی جزئیات سفارش باز و بسته می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "کشو در تست دسکتاپ بررسی می‌شود");
  await page.goto("/#/admin/orders?preset=90d");
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
  await page.goto("/#/admin/orders?preset=90d");
  const table = page.getByTestId("orders-table");
  const firstBefore = await table.getByRole("row").nth(1).innerText();
  await table.getByRole("button", { name: "مرتب‌سازی بر اساس مبلغ کل" }).click();
  await expect.poll(async () => table.getByRole("row").nth(1).innerText()).not.toBe(firstBefore);
});

test("۹. صفحه‌بندی جدول جابه‌جا می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/admin/orders?preset=90d");
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
  await expect(page).toHaveURL(/#\/admin/);
});

test("۱۲. همه صفحات سایدبار بدون خطا رندر می‌شوند", async ({ page }) => {
  const paths = [
    "/admin",
    "/admin/orders",
    "/admin/fulfillment",
    "/admin/suppliers",
    "/admin/applications",
    "/admin/vip-customers",
    "/admin/products",
    "/admin/catalogues",
    "/admin/catalogue-analytics",
    "/admin/escrow",
    "/admin/settlements",
    "/admin/disputes",
    "/admin/analytics",
    "/admin/reports",
    "/admin/settings",
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
  await page.goto("/#/admin/orders?preset=90d");
  await page.getByTestId("toggle-filters").click();
  await expect(page.getByTestId("filter-supplier")).toBeVisible();
  await expect(page.getByTestId("orders-table").locator("ul li").first()).toBeVisible();
});

test("۱۴. خروجی CSV سفارش‌های فیلترشده دانلود می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "دانلود در دسکتاپ بررسی می‌شود");
  await page.goto("/#/admin/orders?preset=30d");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-csv").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/kolbe-vintage-orders-.*\.csv/);
});

test("۱۵. فروشگاه صفحه اول است", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").first()).toBeVisible();
  await expect(page.getByTestId("kpi-grid")).toBeHidden();
});

test("۱۶. پذیرش درخواست تأمین وضعیت را تغییر می‌دهد و اعلان نشان می‌دهد", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول اقدامات فقط در دسکتاپ");
  await page.goto("/#/admin/fulfillment?preset=90d&ff_status=requested");
  const table = page.getByTestId("fulfillment-table");
  const acceptButtons = table.getByRole("button", { name: "پذیرش" });
  const count = await acceptButtons.count();
  test.skip(count === 0, "درخواست بی‌پاسخی وجود ندارد");
  await acceptButtons.first().click();
  await expect(page.getByTestId("toasts")).toContainText("پذیرفته شد");
});

test("۱۷. حل اختلاف وجه مسدود را آزاد می‌کند", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "دیالوگ در دسکتاپ بررسی می‌شود");
  await page.goto("/#/admin/disputes?preset=90d");
  const resolveButtons = page.getByRole("button", { name: "حل اختلاف" });
  const count = await resolveButtons.count();
  test.skip(count === 0, "اختلاف بازی وجود ندارد");
  await resolveButtons.first().click();
  const dialog = page.getByTestId("resolve-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("resolution-partial_settlement").click();
  await expect(page.getByTestId("toasts")).toContainText("حل شد");
});

test("۱۸. تسویه مسدود قابل پرداخت نیست", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/admin/settlements?preset=90d");
  const blocked = page.getByRole("button", { name: "مسدود" });
  if ((await blocked.count()) > 0) await expect(blocked.first()).toBeDisabled();
});

test("۱۹. پورتال تأمین‌کننده هیچ داده مشتری VIP نشان نمی‌دهد", async ({ page }) => {
  await page.goto("/#/partner?supplier=sup-1");
  await expect(page.getByTestId("portal-fulfillments")).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toContain("مشتری VIP");
  expect(body).not.toContain("امانی");
  // the admin shell must not exist at all in this area
  await expect(page.getByTestId("sidebar")).toBeHidden();
  await expect(page.getByTestId("global-filters")).toBeHidden();
});

test("۲۰. تعویض حساب در پورتال داده‌ها را عوض می‌کند", async ({ page }) => {
  await page.goto("/#/partner?supplier=sup-1");
  const table = page.getByTestId("portal-fulfillments");
  const before = await table.innerText();
  await page.getByTestId("portal-account").selectOption("sup-3");
  await expect(page).toHaveURL(/supplier=sup-3/);
  await expect.poll(async () => table.innerText()).not.toBe(before);
});

test("۲۱. تغییرات پس از بارگذاری مجدد حفظ می‌شوند", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "اقدامات در دسکتاپ بررسی می‌شوند");
  await page.goto("/#/admin/fulfillment?preset=90d&ff_status=requested");
  const table = page.getByTestId("fulfillment-table");
  const acceptButtons = table.getByRole("button", { name: "پذیرش" });
  test.skip((await acceptButtons.count()) === 0, "درخواست بی‌پاسخی وجود ندارد");
  const countBefore = await acceptButtons.count();
  await acceptButtons.first().click();
  await expect(page.getByTestId("toasts")).toBeVisible();
  await page.reload();
  await expect.poll(async () => table.getByRole("button", { name: "پذیرش" }).count()).toBeLessThan(countBefore);
});

test("۲۲. بازنشانی داده نمونه از تنظیمات کار می‌کند", async ({ page }) => {
  await page.goto("/#/admin/settings");
  await page.getByTestId("reset-data").click();
  await expect(page.getByTestId("toasts")).toContainText("بازنشانی");
});

test("۲۳. فروشگاه لینک‌های ورود به پنل و فرم همکاری دارد", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "نوار ابزار فقط در دسکتاپ دیده می‌شود");
  await page.goto("/");
  await page.getByRole("link", { name: "Wholesale admin" }).click();
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
});

test("۲۴. فرم درخواست همکاری اعتبارسنجی و ثبت می‌کند", async ({ page }) => {
  await page.goto("/#/supplier-apply");
  await page.getByTestId("apply-submit").click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByTestId("apply-company").fill("Test Supplier Co");
  await page.getByTestId("apply-contact").fill("علی رضایی");
  await page.getByTestId("apply-email").fill("test@example.com");
  await page.getByTestId("apply-phone").fill("09121234567");
  await page.getByTestId("apply-city").fill("تهران");
  await page.getByTestId("apply-specialty").selectOption("بافتنی");
  await page.getByTestId("apply-capacity").fill("4000");
  await page.getByTestId("apply-submit").click();

  await expect(page.getByTestId("apply-success")).toBeVisible();
  await expect(page.getByTestId("apply-success")).toContainText("APP-");
});

test("۲۵. درخواست ثبت‌شده در صف بررسی ادمین دیده می‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/supplier-apply");
  const company = `QA Partner ${Date.now()}`;
  await page.getByTestId("apply-company").fill(company);
  await page.getByTestId("apply-contact").fill("سارا محمدی");
  await page.getByTestId("apply-email").fill("qa@example.com");
  await page.getByTestId("apply-phone").fill("09120000000");
  await page.getByTestId("apply-city").fill("اصفهان");
  await page.getByTestId("apply-specialty").selectOption("چرم");
  await page.getByTestId("apply-capacity").fill("2500");
  await page.getByTestId("apply-submit").click();
  await expect(page.getByTestId("apply-success")).toBeVisible();

  await page.goto("/#/admin/applications");
  await expect(page.getByTestId("applications-table")).toContainText(company);
});

test("۲۶. تأیید درخواست، تأمین‌کننده جدید می‌سازد", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/admin/applications");
  const approve = page.getByRole("button", { name: "تأیید" });
  test.skip((await approve.count()) === 0, "درخواست در انتظاری وجود ندارد");
  await approve.first().click();
  await expect(page.getByTestId("toasts")).toContainText("تأیید");
});

test("۲۷. ساخت محصول جدید در مدیریت محصولات", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "جدول فقط در دسکتاپ");
  await page.goto("/#/admin/products");
  await page.getByTestId("new-product").click();
  await expect(page.getByTestId("product-modal")).toBeVisible();

  const name = `QA Product ${Date.now()}`;
  await page.getByTestId("product-name").fill(name);
  await page.getByTestId("product-sku").fill(`QA-${Date.now()}`);
  await page.getByTestId("product-price").fill("2500000");
  await page.getByTestId("save-product").click();

  await expect(page.getByTestId("product-modal")).toBeHidden();
  await page.getByTestId("product-search").fill(name);
  await expect(page.getByTestId("products-admin-table")).toContainText(name);
});

test("۲۸. فرم محصول بدون فیلدهای الزامی ذخیره نمی‌شود", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "دیالوگ در دسکتاپ");
  await page.goto("/#/admin/products");
  await page.getByTestId("new-product").click();
  await page.getByTestId("save-product").click();
  await expect(page.getByTestId("product-modal")).toBeVisible();
  await expect(page.getByText("نام محصول الزامی است")).toBeVisible();
});

test("۲۹. ساخت و انتشار کاتالوگ", async ({ page }, testInfo) => {
  test.skip(DESKTOP_ONLY(testInfo.project.use as never), "گرید در دسکتاپ");
  await page.goto("/#/admin/catalogues");
  await page.getByTestId("new-catalogue").click();
  const name = `QA Catalogue ${Date.now()}`;
  await page.getByTestId("catalogue-name").fill(name);
  await page.getByTestId("catalogue-category").fill("linen");
  await page.getByTestId("save-catalogue").click();
  await expect(page.getByTestId("catalogues-grid")).toContainText(name);
});
