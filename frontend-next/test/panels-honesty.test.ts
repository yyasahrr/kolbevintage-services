import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETAIL_CHECKOUT_METHODS,
  isInstallmentAvailable,
  type PurchaseChannel,
} from "../storefront/lib/purchaseChannel";

/**
 * رگرسیون D22 / D24 / D29 / D38 — کنترل‌ها و وعده‌های قلابی در رابط کاربری.
 *
 * ── چه چیزی خراب بود ────────────────────────────────────────────────────────
 *   • D22 — بنر «پرداخت اقساطی» (BNPL) بی‌قید کانالی رندر می‌شد و `VIPPortal`
 *     همان `ProductPage` خرده‌فروشی را سوار می‌کرد؛ پس اعضای عمده‌فروشی هم
 *     تبلیغ خرید اقساطی می‌دیدند (نقض «BNPL فقط خرده‌فروشی»).
 *   • D24/D38 — ویرایشگر «کیف پول مشتری» در پنل مدیریت موجودی را در
 *     `localStorage` (`kv_wallet_<phone>`) می‌نوشت، و ماتریس نقش‌ها / کلید ورود
 *     دومرحله‌ای / روشن‌وخاموش‌کردن اتصال‌ها فقط در مرورگر ذخیره می‌شدند
 *     (`kv_admin_roles`, `kv_admin_2fa`, `kv_admin_integrations`) — بدون هیچ اثر
 *     واقعی روی دسترسی یا پرداخت. خطر اصلی «فریب امنیتی» است.
 *   • D29 — `previewMode.ts` (`PANELS_PREVIEW_MODE`, `DEMO_VIP_MEMBERSHIP`)
 *     باقی‌ماندهٔ یک حالت پیش‌نمایش موقت بود که ورود پنل‌ها را دور می‌زد.
 *
 * ── چرا مرحلهٔ دوم تست، کد را اسکن می‌کند ───────────────────────────────────
 * این‌ها رگرسیون‌های «حذف» هستند، نه منطق رفتاری: تضمین واقعی این است که کلید
 * ذخیره‌سازی و فایل مرده **برنگردند**. اسکن منبع، تنها تستی است که این را
 * می‌گیرد.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const STOREFRONT = path.join(ROOT, "storefront");

/**
 * حذف توضیحات پیش از اسکن.
 *
 * چرا: خودِ همین تست و کامنت‌های توضیحی، نام کلیدهای حذف‌شده را (برای مستندسازی)
 * ذکر می‌کنند. اگر توضیحات اسکن شوند، تست همیشه شکست می‌خورد. توضیحات با
 * `//` (و نه `://` مربوط به URL) و `/* … *\/` حذف می‌شوند و فقط کدِ واقعی می‌ماند.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("BNPL فقط خرده‌فروشی است — قاعدهٔ کانال (D22)", () => {
  it("قسط‌بندی تنها در کانال خرده‌فروشی مجاز است", () => {
    expect(isInstallmentAvailable("retail")).toBe(true);
    expect(isInstallmentAvailable("wholesale")).toBe(false);
  });

  it("برای هیچ کانالی نتیجهٔ مبهم برنمی‌گرداند", () => {
    for (const channel of ["retail", "wholesale"] as PurchaseChannel[]) {
      expect(typeof isInstallmentAvailable(channel)).toBe("boolean");
    }
  });

  it("ProductPage و ProductCard پیش‌فرض خرده‌فروشی دارند و پورتال عمده صریحاً کانال می‌دهد", () => {
    const productPage = fs.readFileSync(path.join(STOREFRONT, "pages", "ProductPage.tsx"), "utf8");
    const productCard = fs.readFileSync(path.join(STOREFRONT, "components", "ProductCard.tsx"), "utf8");
    const vipPortal = fs.readFileSync(path.join(STOREFRONT, "pages", "VIPPortal.tsx"), "utf8");

    // هر دو مولفه، رندر بخش اقساط را به کانال مقید کرده‌اند.
    expect(productPage).toContain("isInstallmentAvailable(channel)");
    expect(productCard).toContain("isInstallmentAvailable(channel)");
    // پورتال عمده، کانال عمده را صریح می‌دهد (وگرنه پیش‌فرض خرده‌فروشی می‌ماند).
    expect(vipPortal).toContain('channel="wholesale"');
  });
});

describe("چک‌اوت خرده‌فروشی — روش‌های واقعی پرداخت (D19a/D24)", () => {
  it("کیف پول از گزینه‌های قابل انتخاب حذف شده و روش‌های قابل‌اجرا مانده‌اند", () => {
    expect([...RETAIL_CHECKOUT_METHODS]).toEqual(["gateway", "installment", "cod"]);
    expect([...RETAIL_CHECKOUT_METHODS]).not.toContain("wallet");
  });

  it("صفحهٔ چک‌اوت همان فهرست را نشان می‌دهد", () => {
    const checkout = stripComments(fs.readFileSync(path.join(STOREFRONT, "pages", "Checkout.tsx"), "utf8"));
    expect(checkout).not.toContain("کیف پول کلبه");
    for (const method of RETAIL_CHECKOUT_METHODS) {
      expect(checkout).toContain(`id: "${method}"`);
    }
  });
});

describe("کنترل‌های قلابی حذف شده‌اند (D24/D38/D29)", () => {
  const files = sourceFiles(STOREFRONT);

  it("هیچ کلید ذخیره‌سازی قلابی در رابط کاربری باقی نمانده است", () => {
    const forbidden = ["kv_wallet_", "kv_admin_roles", "kv_admin_2fa", "kv_admin_integrations"];
    const offenders: string[] = [];

    for (const file of files) {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      for (const key of forbidden) {
        if (content.includes(key)) offenders.push(`${path.relative(ROOT, file)} → ${key}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("فایل و نشانه‌های حالت پیش‌نمایش وجود ندارند (D29)", () => {
    expect(fs.existsSync(path.join(STOREFRONT, "previewMode.ts"))).toBe(false);

    const offenders = files.filter((file) => {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      return content.includes("PANELS_PREVIEW_MODE") || content.includes("DEMO_VIP_MEMBERSHIP");
    });
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  it("پنل امنیت/اتصال صریحاً «ساخته‌نشده» اعلام می‌شود، نه کنترل قابل تغییر", () => {
    const operations = fs.readFileSync(path.join(STOREFRONT, "pages", "AdminOperations.tsx"), "utf8");
    expect(operations).toContain("NotAvailableYet");
    expect(operations).not.toContain('type="checkbox" checked={twoFactor}');
  });

  it("کیف پول مدیر دیگر از رابط کاربری قابل شارژ نیست", () => {
    const admin = fs.readFileSync(path.join(STOREFRONT, "pages", "Admin.tsx"), "utf8");
    expect(admin).not.toContain("saveWallet");
    expect(admin).not.toContain("setWallet");
  });
});
