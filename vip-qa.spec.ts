import { test, expect } from "@playwright/test";

const membership = {
  customerId: "KVC-9121234567",
  planId: "vip",
  planName: "وی‌آی‌پی",
  memberName: "آرمان نیک‌پی",
  storeName: "بوتیک آرمان",
  phone: "09121234567",
  city: "تهران",
  activatedAt: "۱۴۰۵/۰۵/۲۴",
  expiresAt: "۱۴۰۶/۰۵/۲۴",
  status: "active",
  vip: true,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    localStorage.setItem("kv_customer_identity", JSON.stringify({ id: value.customerId, name: value.memberName, phone: value.phone }));
    localStorage.setItem("kv_wholesale_membership", JSON.stringify(value));
  }, membership);
});

test("VIP dashboard, store modes, and quick order are usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("http://127.0.0.1:5173/#/vip");
  await expect(page.getByRole("heading", { name: "بوتیک آرمان" })).toBeVisible();
  await expect(page.getByText("سفارش‌های اخیر")).toBeVisible();

  await page.goto("http://127.0.0.1:5173/#/vip/store?view=grid");
  await expect(page.getByRole("heading", { name: "همه محصولات" })).toBeVisible();
  await page.getByRole("button", { name: "نمایش سفارش گروهی" }).click();
  await expect(page.getByText("ورود تعداد دستی غیرفعال است")).toBeVisible();
  await expect(page.getByRole("button", { name: /کالکشن شروع/ }).first()).toBeVisible();

  await page.goto("http://127.0.0.1:5173/#/vip/quick-order");
  const search = page.getByRole("textbox", { name: "جست‌وجوی نام یا کد محصول" });
  await search.fill("KV-");
  await expect(page.getByText(/KV-/).first()).toBeVisible();
  expect(errors.filter((error) => !error.includes("ERR_NETWORK_ACCESS_DENIED") && !error.includes("404"))).toEqual([]);
});

test("wholesale product keeps VIP shell and saves custom services", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/#/vip/store");
  await page.getByRole("link", { name: "مشاهده و سفارش" }).first().click();
  await expect(page.getByRole("link", { name: "خانه" }).first()).toBeVisible();
  await expect(page.getByText("خدمات اختصاصی این کالکشن")).toBeVisible();
  await page.getByText("لیبل اختصاصی برند").click();
  await page.getByRole("button", { name: /افزودن کالکشن ویترین/ }).click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("kv_wholesale_draft") ?? "[]"));
  expect(draft.at(-1).collectionName).toBe("کالکشن ویترین");
  expect(draft.at(-1).services).toContain("لیبل اختصاصی برند");
});

test("support ticket is persisted and visible to admin", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/#/vip/support");
  await page.getByLabel("موضوع").fill("پیگیری لیبل اختصاصی");
  await page.getByLabel("شرح درخواست").fill("فایل لوگو برای سفارش کالکشن آماده ارسال است.");
  await page.getByRole("button", { name: "ثبت و دریافت کد پیگیری" }).click();
  await expect(page.getByText("پیگیری لیبل اختصاصی")).toBeVisible();
  await page.goto("http://127.0.0.1:5173/#/admin");
  await page.getByLabel("نام کاربری").fill("kolbe.admin");
  await page.getByLabel("رمز عبور").fill("KvAdmin#1405");
  await page.getByRole("button", { name: "ورود به پنل مدیریت" }).click();
  await page.getByRole("button", { name: "مدیریت عمده‌فروشی" }).click();
  await expect(page.getByText("پیگیری لیبل اختصاصی")).toBeVisible();
});

test("customer can log out without deleting membership data", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/#/vip");
  await page.getByRole("button", { name: "خروج از حساب کاربری" }).click();
  await expect(page).toHaveURL(/#\/wholesale/);
  const state = await page.evaluate(() => ({ customer: localStorage.getItem("kv_customer_identity"), membership: localStorage.getItem("kv_wholesale_membership") }));
  expect(state.customer).toBeNull();
  expect(state.membership).not.toBeNull();
});

test("wholesale entry respects the shared customer membership", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173/#/wholesale");
  await expect(page).toHaveURL(/#\/vip\/store/);
  await page.evaluate(() => {
    localStorage.removeItem("kv_wholesale_membership");
    localStorage.removeItem("kv_customer_identity");
  });
  await page.goto("http://127.0.0.1:5173/#/wholesale");
  await expect(page.getByRole("heading", { name: "فروش عمده کلبه وینتیج" })).toBeVisible();
  await expect(page.getByText("پلن‌های عضویت")).toBeVisible();
  await expect(page.getByText("ورود / ثبت‌نام")).toBeVisible();
});

for (const [name, width, height] of [
  ["desktop", 1440, 900], ["wide", 1920, 1080], ["tablet-landscape", 1024, 768],
  ["tablet", 768, 1024], ["mobile", 390, 844], ["mobile-wide", 430, 932],
] as const) {
  test(`dashboard responsive ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:5173/#/vip");
    await expect(page.locator("#vip-main")).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
    await page.screenshot({ path: `test-results/vip-${name}.png`, fullPage: true });
  });
}
