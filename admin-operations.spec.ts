import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/#/admin");
  await page.getByLabel("نام کاربری").fill("kolbe.admin");
  await page.getByLabel("رمز عبور").fill("KvAdmin#1405");
  await page.getByRole("button", { name: "ورود به پنل مدیریت" }).click();
});

test("1000-question audit loads, navigates by category and saves an answer", async ({ page }) => {
  await page.getByRole("button", { name: "ممیزی ۱۰۰۰ سؤالی" }).click();
  await expect(page.getByRole("heading", { name: "ممیزی جامع کلبه وینتیج" })).toBeVisible();
  await expect(page.getByText("سؤال ۱ از ۱٬۰۰۰")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4);

  await page.getByRole("radio").nth(2).click();
  await expect(page.getByText("۱ از ۱٬۰۰۰", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /حقوقی، قراردادها و انطباق/ }).click();
  await expect(page.getByText("سؤال ۹۵۱ از ۱٬۰۰۰")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4);

  await page.reload();
  await page.getByRole("button", { name: "ممیزی ۱۰۰۰ سؤالی" }).click();
  await expect(page.getByText("۱ از ۱٬۰۰۰", { exact: true })).toBeVisible();
});

test("inventory module adds a warehouse and persists it", async ({ page }) => {
  await page.getByRole("button", { name: "موجودی و تأمین" }).click();
  await expect(page.getByRole("heading", { name: "موجودی و تأمین" })).toBeVisible();
  await page.getByLabel("نام انبار").fill("انبار تست شمال");
  await page.getByLabel("شهر").fill("رشت");
  await page.getByRole("button", { name: "افزودن انبار" }).click();
  await expect(page.getByText("انبار تست شمال")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "موجودی و تأمین" }).click();
  await expect(page.getByText("انبار تست شمال")).toBeVisible();
});

test("product creation and editing persist after reload", async ({ page }) => {
  await page.getByRole("button", { name: "محصولات" }).click();
  await page.getByRole("button", { name: "ایجاد محصول" }).click();
  await expect(page.getByTestId("product-editor-toolbar")).toHaveCSS("position", "static");
  await page.getByRole("button", { name: "انتشار محصول" }).click();
  await expect(page.getByRole("alert")).toContainText("نام محصول الزامی است");
  await page.getByLabel("نام محصول").fill("کت آزمایشی پایدار");
  await page.getByLabel("نام لاتین").fill("Persistent Test Jacket");
  await page.getByLabel("قیمت پایه (تومان)").fill("5250000");
  await page.getByLabel("افزودن کالکشن‌ها").fill("پاییز ۱۴۰۵");
  await page.getByRole("button", { name: "افزودن", exact: true }).first().click();
  await page.getByRole("button", { name: "تنوع و موجودی" }).click();
  await page.getByRole("button", { name: "افزودن تنوع" }).click();
  await page.getByLabel(/stock variant-/).fill("14");
  await page.getByLabel(/price variant-/).fill("5450000");
  await page.getByRole("button", { name: "به‌روزرسانی رنگ‌ها و سایزهای فروشگاه" }).click();
  await page.getByRole("button", { name: "رسانه" }).click();
  await page.getByLabel("آپلود تصویر").setInputFiles({ name:"product.png", mimeType:"image/png", buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAFAgI/69sX8QAAAABJRU5ErkJggg==","base64") });
  await expect(page.getByAltText("تصویر 1")).toBeVisible();
  await page.getByRole("button", { name: "مشخصات" }).click();
  await page.getByRole("button", { name: "افزودن مشخصه" }).click();
  await page.getByLabel(/عنوان مشخصه/).fill("نوع آستر");
  await page.getByLabel(/مقدار مشخصه/).fill("ویسکوز");
  await page.getByRole("button", { name: "جدول سایز" }).click();
  await page.getByRole("button", { name: "افزودن ردیف" }).click();
  await page.getByLabel("chest 0").fill("102");
  await page.getByRole("button", { name: "انتشار محصول" }).click();
  await expect(page.getByRole("status")).toContainText("نسخه جدید");
  await page.getByRole("button", { name: "بازگشت" }).click();
  await expect(page.getByText("کت آزمایشی پایدار")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "محصولات" }).click();
  await expect(page.getByText("کت آزمایشی پایدار")).toBeVisible();
  await page.goto("http://127.0.0.1:5173/#/shop");
  await expect(page.getByText("کت آزمایشی پایدار").first()).toBeVisible();
});

test("variant template, media URL and real version restore work", async ({ page }) => {
  await page.getByRole("button", { name: "محصولات" }).click();
  await page.getByRole("button", { name: "ایجاد محصول" }).click();
  await page.getByLabel("نام محصول").fill("پیراهن نسخه‌پذیر");
  await page.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
  await page.getByLabel("نام محصول").fill("پیراهن نسخه دوم");
  await page.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
  await page.getByRole("button", { name: "تنوع و موجودی" }).click();
  await page.getByLabel("نام رنگ قالب").fill("زیتونی");
  await page.getByRole("button", { name: "ساخت ماتریس رنگ و سایز" }).click();
  await expect(page.getByLabel(/colour variant-/)).toHaveCount(4);
  await page.getByRole("button", { name: "رسانه" }).click();
  await page.getByLabel("افزودن تصویر با آدرس").fill("https://picsum.photos/seed/kolbe-product/600/800");
  await page.getByRole("button", { name: "افزودن از URL" }).click();
  await expect(page.getByAltText("تصویر 1")).toBeVisible();
  await page.getByRole("button", { name: "انتشار و نسخه‌ها" }).click();
  await page.getByRole("button", { name: "مقایسه" }).last().click();
  await expect(page.getByLabel("مقایسه نسخه")).toBeVisible();
  await page.getByRole("button", { name: "بازیابی این نسخه" }).click();
  await page.getByRole("button", { name: "اطلاعات پایه" }).click();
  await expect(page.getByLabel("نام محصول")).toHaveValue("پیراهن نسخه‌پذیر");
});

test("duplicate, trash, restore and CSV import are functional", async ({ page }) => {
  await page.getByRole("button", { name: "محصولات" }).click();
  await page.getByRole("button", { name: "کپی" }).first().click();
  await expect(page.getByLabel("نام محصول")).toHaveValue(/کپی/);
  await page.getByRole("button", { name: "بازگشت" }).click();
  await page.getByRole("button", { name: "حذف" }).first().click();
  await expect(page.getByRole("status")).toContainText("سطل زباله");
  await page.getByRole("button", { name: /سطل زباله/ }).click();
  await page.getByRole("button", { name: "بازیابی" }).first().click();
  await expect(page.getByRole("status")).toContainText("بازیابی شد");
  await page.getByRole("button", { name: "بازگشت به محصولات" }).click();
  await page.getByLabel("ورود CSV محصولات").setInputFiles({ name:"products.csv", mimeType:"text/csv", buffer:Buffer.from("name,latin,price,code,category,status\nمحصول CSV,CSV Product,2100000,KV-CSV,shirt,draft","utf8") });
  await expect(page.getByText("محصول CSV")).toBeVisible();
});

test("order status and detail view are functional", async ({ page }) => {
  await page.getByRole("button", { name: "سفارش‌ها" }).click();
  const status = page.getByLabel("وضعیت سفارش KV-482910");
  await status.selectOption("در حال ارسال");
  await page.reload();
  await page.getByRole("button", { name: "سفارش‌ها" }).click();
  await expect(page.getByLabel("وضعیت سفارش KV-482910")).toHaveValue("در حال ارسال");
  await page.getByRole("button", { name: "جزئیات" }).first().click();
  await expect(page.getByLabel("جزئیات سفارش")).toContainText("KV-482910");
});

test("customer wallet, content and wholesale request persist", async ({ page }) => {
  await page.getByRole("button", { name: "مشتریان" }).click();
  await page.getByRole("button", { name: "پروفایل" }).first().click();
  await expect(page.getByLabel("پروفایل مشتری")).toContainText("CUSTOMER 360");
  await page.getByLabel("موجودی (تومان)").fill("350000");
  await page.getByRole("button", { name: "ذخیره موجودی کیف پول" }).click();
  await page.getByRole("button", { name: "محتوا و صفحات" }).click();
  await page.getByRole("button", { name: "مقاله جدید" }).click();
  await expect(page.locator('input[value="مقاله جدید"]')).toBeVisible();
  await page.getByRole("button", { name: "درخواست‌های عمده" }).click();
  const status = page.getByLabel(/وضعیت درخواست/).first();
  await status.selectOption("تأیید شده");
  await page.reload();
  await page.getByRole("button", { name: "درخواست‌های عمده" }).click();
  await expect(page.getByLabel(/وضعیت درخواست/).first()).toHaveValue("تأیید شده");
});

test("operations, access, integrations and system modules are usable", async ({ page }) => {
  await page.getByRole("button", { name: "مرجوعی و ارسال" }).click();
  await page.getByRole("button", { name: "کانبان" }).click();
  await expect(page.getByText("واریز به کیف پول", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "دسترسی و امنیت" }).click();
  await expect(page.getByText("ورود دومرحله‌ای", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "اتصال و اتوماسیون" }).click();
  await expect(page.getByText("درگاه زرین‌پال")).toBeVisible();
  await page.getByRole("button", { name: "مرکز سیستم" }).click();
  await page.getByRole("button", { name: "ذخیره تنظیمات" }).click();
  await expect(page.getByRole("status")).toContainText("ذخیره شد");
});

test("admin modules remain reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "منو" }).click();
  await page.getByRole("button", { name: "موجودی و تأمین" }).click();
  await expect(page.getByRole("heading", { name: "موجودی و تأمین" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
