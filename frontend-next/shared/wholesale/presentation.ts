/**
 * ارائهٔ فارسیِ حقیقتِ تجاریِ عمده (فاز ۶.۴).
 *
 * این ماژول فقط «نمایش» است: برچسبِ واحدها، ارقامِ فارسی، قالبِ مبلغ و متنِ
 * خطا. هیچ مقدارِ تجاری تولید یا محاسبه نمی‌شود:
 *
 *  - `formatMoney` رشتهٔ اعشاریِ سرور را **بدونِ تبدیل به number** قالب می‌زند.
 *  - `moqUnitLabel` واحدی را که نمی‌شناسد همان‌طور خام برمی‌گرداند تا «سری»
 *    هرگز به «عدد» دروغ گفته نشود.
 *  - `errorCopy` خطا را به وضعیتِ قابل‌فهم ترجمه می‌کند، بی‌آنکه EMPTY و ERROR
 *    را یکی کند.
 *
 * پیش‌تر این هلپرها داخلِ `storefront/pages/WholesaleCatalog.tsx` بودند؛ با
 * بازطراحیِ صفحهٔ جزئیات، دو مصرف‌کننده (فهرست و پیکربندِ سری) باید **یک**
 * واژگان داشته باشند، پس اینجا منتقل شده‌اند و از آن فایل re-export می‌شوند تا
 * قراردادهای موجود نشکند.
 */

import type { ApiErrorKind } from "../http/errors";
import type { ApiResult } from "../http/types";
import type { WholesaleSellerType } from "./catalog";

/* ── واژگانِ واحدها و انواع ─────────────────────────────────────────────── */

export const MOQ_UNIT_LABELS_FA: Record<string, string> = {
  PIECE: "عدد",
  PACKAGE: "بسته",
  SERIES: "سری",
  BOX: "جعبه",
  CARTON: "کارتن",
  SET: "ست",
};

export const PACKAGE_TYPE_LABELS_FA: Record<string, string> = {
  SIZE_RUN: "سری سایزبندی",
  FIXED_QUANTITY: "تعداد ثابت",
  COLOR_MIX: "ترکیب رنگ",
  CUSTOM_BUNDLE: "بستهٔ دلخواه",
};

export const PRICING_UNIT_LABELS_FA: Record<string, string> = {
  ...MOQ_UNIT_LABELS_FA,
  PER_PIECE: "به ازای هر عدد",
};

export const SELLER_TYPE_LABELS_FA: Record<WholesaleSellerType, string> = {
  KOLBE: "کلبه",
  SUPPLIER: "تأمین‌کننده",
  UNKNOWN: "نامشخص",
};

/**
 * نمایشِ واحدِ MOQ. واحدِ ناشناخته همان‌طور خام نمایش داده می‌شود: فروکاستنِ
 * یک واحدِ ناشناخته به «عدد»، دروغِ تجاری است.
 */
export function moqUnitLabel(unit: string): string {
  return MOQ_UNIT_LABELS_FA[unit] ?? unit;
}

export function packageTypeLabel(type: string): string {
  return PACKAGE_TYPE_LABELS_FA[type] ?? type;
}

export function pricingUnitLabel(unit: string): string {
  return PRICING_UNIT_LABELS_FA[unit] ?? unit;
}

/* ── ارقام و مبلغ ──────────────────────────────────────────────────────── */

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/**
 * قالب‌بندیِ مبلغ از روی **رشتهٔ اعشاری**، بدونِ هیچ تبدیل به number.
 * جداکنندهٔ هزارگانِ فارسی (U+066C) استفاده می‌شود.
 */
export function formatMoney(decimalString: string): string {
  const cleaned = decimalString.trim();
  if (!/^\d+$/.test(cleaned)) return cleaned; // اگر قالبِ دیگری بود، دست‌نخورده نشان بده
  const grouped = cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, "\u066C");
  return toPersianDigits(grouped);
}

/** «۲ سری» — کمیت و واحد با هم، تا واحد هرگز حذف نشود. */
export function quantityWithUnit(quantity: number, unit: string): string {
  return `${toPersianDigits(quantity)} ${moqUnitLabel(unit)}`;
}

/* ── وضعیت‌های صریح UI ──────────────────────────────────────────────────── */

export type CatalogViewState =
  | { kind: "LOADING" }
  | { kind: "READY_WITH_DATA" }
  | { kind: "READY_EMPTY" }
  | { kind: "ERROR"; errorKind: ApiErrorKind; message: string };

/**
 * نگاشتِ صریحِ خطای سرور به وضعیتِ UI.
 *
 * ⚠️ خطا هرگز به «خالی» تبدیل نمی‌شود: `READY_EMPTY` فقط وقتی است که سرور
 * موفق پاسخ داده و فهرست واقعاً خالی بوده.
 */
export function viewStateFromResult(result: ApiResult<unknown>, hasData: boolean): CatalogViewState {
  if (result.ok) return hasData ? { kind: "READY_WITH_DATA" } : { kind: "READY_EMPTY" };
  return { kind: "ERROR", errorKind: result.error.kind, message: result.error.message };
}

const ERROR_COPY_FA: Partial<Record<ApiErrorKind, string>> = {
  UNAUTHORIZED: "برای دیدنِ کاتالوگِ عمده باید وارد شوید.",
  FORBIDDEN: "حساب شما اجازهٔ دسترسی به این بخش را ندارد. این یک محدودیتِ دسترسی است، نه خطای فنی.",
  NOT_FOUND: "موردِ درخواستی پیدا نشد.",
  RATE_LIMITED: "تعدادِ درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کنید.",
  SERVER_ERROR: "سرور در پردازشِ درخواست ناموفق بود.",
  NETWORK_ERROR: "اتصال به سرور برقرار نشد. داده‌ای نمایش داده نمی‌شود چون داده‌ای دریافت نشد.",
  PROVIDER_UNAVAILABLE: "سرویسِ وابسته در دسترس نیست.",
  MALFORMED_RESPONSE: "پاسخِ سرور قابل تفسیر نبود.",
};

export function errorCopy(kind: ApiErrorKind, fallback: string): string {
  return ERROR_COPY_FA[kind] ?? fallback;
}
