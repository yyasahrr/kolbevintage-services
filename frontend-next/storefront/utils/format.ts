const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/**
 * تبدیل ارقام لاتین به فارسی.
 *
 * مقدار خالی/تعریف‌نشده به «—» تبدیل می‌شود؛ پیش‌تر رشتهٔ «undefined» در جاهایی
 * مثل تلفن ناقص حساب کاربری به رابط درز می‌کرد و هم زشت بود و هم متن لاتین.
 */
export function fa(input: string | number | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** قیمت تومانی با جداکننده هزارگان و ارقام فارسی */
export function toman(value: number): string {
  return fa(value.toLocaleString("en-US")) + " تومان";
}

/** برچسب فارسی سایزها — تصمیم کاربر: هیچ متن لاتینی در رابط نماند. */
const SIZE_LABELS: Record<string, string> = {
  "XS": "خیلی کوچک",
  "S": "کوچک",
  "M": "متوسط",
  "L": "بزرگ",
  "XL": "بزرگ‌تر",
  "XXL": "خیلی بزرگ",
  "2XL": "خیلی بزرگ",
  "3XL": "بسیار بزرگ",
  "4XL": "بسیار بزرگ",
  "FREE": "اندازهٔ آزاد",
  "ONESIZE": "اندازهٔ آزاد",
  "ONE SIZE": "اندازهٔ آزاد",
  "OS": "اندازهٔ آزاد",
};

/** کد سایز (XS/M/…) را به برچسب فارسی تبدیل می‌کند؛ اعداد هم فارسی می‌شوند. */
export function sizeLabel(size: string): string {
  const key = size.trim().toUpperCase();
  return SIZE_LABELS[key] ?? fa(size);
}

/**
 * کد ماشینی (سفارش/کالا) را برای نمایش آماده می‌کند: پیشوند لاتین حذف و ارقام فارسی می‌شوند.
 * اگر کد حروف لاتین داشته باشد (مثل SKUهای ساپلایر) `null` برمی‌گردد تا در رابط نمایش داده نشود؛
 * این کدها فقط در فرم‌های ورودی ادمین و فایل خروجی CSV باقی می‌مانند.
 */
export function codeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = String(code).trim();
  if (!trimmed) return null;
  const numeric = trimmed.match(/^[A-Za-z]{1,5}[-_\s]?(\d+(?:[-_/]\d+)*)$/);
  if (numeric) return fa(numeric[1].replace(/[_/]/g, "-"));
  if (/[A-Za-z]/.test(trimmed)) return null;
  return fa(trimmed.replace(/[-_]+/g, "\u200c"));
}
