/**
 * هلپرهای مشترکِ تست‌های مرورگری فاز ۶.۲ (پورتال تأمین‌کننده).
 *
 * چرا این فایل وجود دارد:
 *   ۱) هر تست پیش از این جداگانه login می‌کرد. اما `POST /api/v1/auth/login`
 *      در سرور با `@RateLimit({ limit: 5, windowSeconds: 60, scope: "ip" })`
 *      محافظت می‌شود — پس از پنج ورود در یک دقیقه، ورودهای بعدی ۴۲۹ می‌گیرند و
 *      تست‌ها نه به‌خاطرِ نقصِ محصول بلکه به‌خاطرِ محدودسازیِ نرخ شکست می‌خوردند.
 *      راه‌حلِ درست، «یک ورود و بازاستفاده از `storageState`» است (الگوی رسمی
 *      Playwright) — نه شل‌کردنِ محدودسازیِ نرخ.
 *   ۲) ناوبری در موبایل پشتِ دکمهٔ منو است؛ بدونِ این هلپر، انتخابگرها در
 *      ویوپورتِ کوچک هیچ‌گاه عنصر را نمی‌بینند.
 *
 * هیچ دادهٔ جعلی به پورتال تزریق نمی‌شود: اگر سرور داده‌ای ندارد، انتظارِ ما
 * «حالتِ خالیِ راستین» است، نه مقدارِ ساختگی.
 */

import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.NEXT_PUBLIC_E2E_BASE_URL ?? "http://127.0.0.1:3000";

/** اعتبارنامهٔ تست — فقط از محیط خوانده می‌شود؛ هرگز در مخزن hardcode نیست. */
export const NORMAL_SUPPLIER_EMAIL = process.env.KOLBE_E2E_SUPPLIER_EMAIL ?? "";
export const MAKER_SUPPLIER_EMAIL = process.env.KOLBE_E2E_SUPPLIER_MAKER_EMAIL ?? "";
export const SUPPLIER_PASSWORD = process.env.KOLBE_E2E_SUPPLIER_PASSWORD ?? "";

export const HAS_CREDENTIALS = NORMAL_SUPPLIER_EMAIL.length > 0 && SUPPLIER_PASSWORD.length > 0;

/** مسیرِ فایل‌های `storageState` (خارج از git). */
export const NORMAL_STATE = "e2e/.auth/supplier-normal.json";
export const MAKER_STATE = "e2e/.auth/supplier-maker.json";

/** برچسبِ دقیقِ ناوبری — باید با `supplier-src/navigation.ts` هم‌خوان باشد. */
export const NAV_LABEL = {
  dashboard: "داشبورد",
  products: "محصولات",
  "product-editor": "ثبت محصول جدید",
  inventory: "موجودی",
  orders: "سفارش‌ها",
  rfqs: "صندوق RFQ",
  production: "تولید و کنترل کیفیت",
  capacity: "ظرفیت و تعطیلی",
  finance: "مالی و تسویه",
  withdrawals: "برداشت‌ها",
  team: "تیم و دسترسی‌ها",
  compliance: "انطباق و اسناد",
  support: "پشتیبانی",
  analytics: "عملکرد",
  settings: "تنظیمات کارخانه",
} as const;

export type NavId = keyof typeof NAV_LABEL;

/** صفحه‌هایی که اسکرین‌شات/بررسیِ بصریِ نماینده می‌گیرند. */
export const SCREENSHOT_PAGES: NavId[] = [
  "dashboard",
  "products",
  "product-editor",
  "orders",
  "finance",
  "team",
  "compliance",
  "support",
  "analytics",
];

/** آیا پورتال اصلاً در دسترس است؟ (اگر نه، skip — نه fail.) */
export async function portalReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/supplier`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/** انتظار برای اینکه پوستهٔ احراز هویت‌شده رندر شده باشد. */
export async function expectShell(page: Page): Promise<void> {
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
}

/**
 * پوستهٔ احراز هویت‌شده را آماده می‌کند — بدونِ بارگذاریِ دوبارهٔ بی‌مورد.
 *
 * چرا reloadِ همیشگی غلط است: لیمترِ سراسریِ API روی `۳۰۰ درخواست / ۶۰ ثانیه / هر IP`
 * تنظیم شده و هر `goto("/supplier")` یک بازیابیِ نشست (`GET /auth/me`) به‌همراهِ چند
 * واکشیِ دیگر دارد. در ماتریسِ ۱۴ ویوپورتی، reload پیش از *هر* تست سهمیه را تمام کرد و
 * تست‌ها با پیامِ راستینِ «تعداد درخواست‌ها بیش از حد مجاز است» شکستند.
 *
 * راه‌حل، کاهشِ حجمِ درخواست از سمتِ هارنس است، **نه** تضعیفِ لیمتر: محدودسازیِ نرخ یک
 * محافظتِ امنیتیِ محصول است و دست‌نخورده می‌ماند.
 */
export async function ensureShell(page: Page): Promise<void> {
  const shellAlreadyUp =
    page.url().includes("/supplier") && (await page.locator(".app-shell").count()) > 0;
  if (!shellAlreadyUp) {
    await page.goto("/supplier");
  }
  await expectShell(page);
}

/**
 * در ویوپورتِ موبایل، ناوبری پشتِ کشو است؛ این کمک‌تابع کشو را **فقط اگر بسته باشد**
 * باز می‌کند و پایانِ گذار را صبر می‌کند (کلیک روی پیوندِ در حالِ حرکت شکننده است).
 *
 * نکته: کشویِ بسته اکنون `visibility: hidden` دارد (رفعِ نقصِ دسترس‌پذیریِ فاز ۶.۲)، پس
 * پیوندهای ناوبری پیش از باز کردنِ کشو برای Playwright هم «نامرئی»‌اند. این درست است —
 * کاربرِ کیبورد هم نباید به کنترلِ پنهان برسد؛ پس تست باید اول کشو را باز کند.
 */
export async function openMobileNav(page: Page): Promise<void> {
  if ((await page.locator(".sidebar.open").count()) > 0) return;
  const menu = page.locator(".mobile-menu");
  if (!(await menu.isVisible().catch(() => false))) return;
  await menu.click();
  await expect(page.locator(".sidebar.open")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)", {
    timeout: 10_000,
  });
}

/**
 * رفتن به یک صفحهٔ پورتال.
 *
 * در ویوپورتِ موبایل، نوارِ کناری پشتِ دکمهٔ «باز کردن منو» پنهان است؛ پس نخست
 * منو باز می‌شود. `exact: true` لازم است چون برچسب‌ها زیررشتهٔ یکدیگرند
 * (مثلاً «تنظیمات» و «تنظیمات کارخانه»).
 */
export async function gotoPage(page: Page, id: NavId): Promise<void> {
  await ensureShell(page);
  await openMobileNav(page);
  const link = page.getByRole("button", { name: NAV_LABEL[id], exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`page=${id}`));
  await settled(page);
}

/**
 * پایانِ درخواست‌های در جریان.
 *
 * عمداً شکست را می‌بلعیم: `networkidle` در صفحه‌ای که polling دارد هرگز رخ
 * نمی‌دهد و نباید تست را بشکند — هدف فقط «اسکرین‌شات وسطِ بارگذاری نگرفتن» است.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(150);
}

/**
 * معیارِ سرریزِ افقیِ سند.
 *
 * این همان چیزی است که «نبودِ سرریزِ افقی» را واقعاً می‌سنجد، نه حدس از CSS.
 */
export async function documentOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
}

export async function expectNoHorizontalBodyOverflow(page: Page, label: string): Promise<void> {
  const overflow = await documentOverflow(page);
  expect(
    overflow.scrollWidth,
    `${label}: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * هیچ کلید/نشانیِ خصوصیِ ذخیره‌سازی نباید در DOM نشت کند.
 * (قاعدهٔ فاز ۶.۲: دسترسیِ اسناد فقط با grantِ سمتِ سرور.)
 */
export async function expectNoPrivateStorageLeak(page: Page): Promise<void> {
  const html = await page.content();
  expect(html).not.toMatch(/s3:\/\/|storage\.googleapis\.com|x-amz-signature/i);
}

/**
 * ورودِ واقعی از راهِ UI — فقط در پروژهٔ setup استفاده می‌شود.
 */
export async function loginThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/supplier");
  await expect(page.locator(".auth-shell")).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /ورود به پنل/ }).click();
  await expectShell(page);
}
