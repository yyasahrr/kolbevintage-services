/**
 * پول در مرزِ فرانت‌اند (فاز ۶.۱).
 *
 * قاعدهٔ حاکم (هم‌راستا با `packages/shared/src/money.ts` و ممیزی فاز ۶.۰):
 *
 *      پولِ authoritative از API همیشه «رشتهٔ ده‌دهی» است و هرگز با عدد
 *      اعشاریِ جاوااسکریپت محاسبه یا ذخیره نمی‌شود.
 *
 * فاز ۶.۰ نشان داد بخشی از مسیرهای فرانت‌اند مبلغ را `number` نگه می‌دارند
 * (`wholesalePrice: number`, `totalAmount: number`) که برای نمایشِ ساده بی‌خطر
 * به‌نظر می‌رسد اما به‌محضِ جمع/ضرب، خطای گردکردن وارد دفتر مالی می‌کند.
 *
 * این ماژول فقط ابزار **نمایش** است:
 *  - تجزیه و قالب‌بندی بدون `parseFloat`/`Number()` روی مقدارِ پول؛
 *  - جمع برای جمعِ نمایشی (مثلاً جمعِ سبدِ پیش‌نویس) با اعلامِ صریح
 *    `forDisplay`؛ حقیقتِ تجاری (قیمت نهایی، تخفیف، تسویه) سروری است.
 *
 * هیچ وابستگی به Intl ندارد تا خروجی در Node و مرورگر یکسان و قطعی باشد.
 */

export const MONEY_STRING_PATTERN = /^-?\d+(\.\d{1,6})?$/;

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyFormatError";
  }
}

/** مبلغِ authoritative: رشتهٔ ده‌دهی (مثلاً `"1250000"` یا `"1250000.50"`). */
export type MoneyString = string;

export function isMoneyString(value: unknown): value is MoneyString {
  return typeof value === "string" && MONEY_STRING_PATTERN.test(value.trim());
}

export function assertMoneyString(value: unknown): MoneyString {
  if (!isMoneyString(value)) {
    throw new MoneyFormatError(
      `مبلغ باید رشتهٔ ده‌دهی باشد (مثال: "1250000")؛ مقدار دریافت‌شده: ${JSON.stringify(value)}`,
    );
  }
  return value.trim() as MoneyString;
}

/** تعداد ارقامِ اعشاریِ رشته (بدون تبدیل به عدد). */
export function moneyScale(value: MoneyString): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

function splitMoney(value: MoneyString): { sign: string; integer: string; fraction: string } {
  const trimmed = value.trim();
  const sign = trimmed.startsWith("-") ? "-" : "";
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf(".");
  const integer = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? "" : unsigned.slice(dot + 1);
  return { sign, integer: integer || "0", fraction };
}

/**
 * تبدیل به واحدِ خرد (بزرگ‌ترین عدد صحیح) — مسیرِ امنِ مقایسه و جمع.
 * اگر `scale` داده نشود، مقیاسِ خودِ رشته استفاده می‌شود.
 */
export function toMinorUnits(value: MoneyString, scale?: number): bigint {
  const { sign, integer, fraction } = splitMoney(assertMoneyString(value));
  const target = scale ?? fraction.length;
  if (target < fraction.length) {
    throw new MoneyFormatError(`مقیاسِ ${target} برای مبلغِ "${value}" کافی نیست (دقت از دست می‌رود).`);
  }
  const padded = fraction.padEnd(target, "0");
  const units = BigInt(`${integer}${padded}`) || 0n;
  return sign === "-" ? -units : units;
}

/** معکوسِ `toMinorUnits`. */
export function fromMinorUnits(units: bigint, scale: number): MoneyString {
  if (!Number.isInteger(scale) || scale < 0) throw new MoneyFormatError("مقیاس باید عدد صحیح نامنفی باشد.");
  if (scale === 0) return units.toString();
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

function groupDigits(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function toDigits(text: string, style: "fa" | "en"): string {
  if (style === "en") return text;
  return text.replace(/\d/g, (digit) => FA_DIGITS[Number(digit)] as string);
}

export type FormatMoneyOptions = {
  /** ارقام فارسی (پیش‌فرضِ فروشگاه) یا لاتین برای کدهای SKU/گزارش. */
  digits?: "fa" | "en";
  /** جداکنندهٔ هزارگان؛ پیش‌فرض «,» مطابق قراردادِ فعلیِ `toman()`. */
  separator?: string;
  grouping?: boolean;
  /** تعداد ارقام اعشاریِ خروجی؛ `null` یعنی همان مقدارِ ورودی. */
  fractionDigits?: number | null;
  /** پسوندِ نمایشی؛ پیش‌فرض « تومان». برای گزارش‌های بدون واحد `""` بفرستید. */
  suffix?: string;
};

/**
 * قالب‌بندیِ نمایشی — مقدار را تغییر نمی‌دهد.
 * خروجی برای `"1250000"` با تنظیماتِ پیش‌فرض: `۱,۲۵۰,۰۰۰ تومان`
 */
export function formatMoney(value: MoneyString, options: FormatMoneyOptions = {}): string {
  const {
    digits = "fa",
    separator = ",",
    grouping = true,
    fractionDigits = null,
    suffix = " تومان",
  } = options;
  const { sign, integer, fraction } = splitMoney(assertMoneyString(value));

  let fractionPart = fraction;
  if (fractionDigits !== null) {
    if (fractionDigits < 0) throw new MoneyFormatError("تعداد ارقام اعشاری نمی‌تواند منفی باشد.");
    fractionPart = fractionDigits === 0 ? "" : fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  }
  const integerPart = grouping ? groupDigits(integer, separator) : integer;
  const body = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart;
  return `${toDigits(sign, digits)}${toDigits(body, digits)}${suffix}`;
}

/** مقایسهٔ ایمن: -1 / 0 / 1 بدون لمسِ عدد اعشاری. */
export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  // مقیاسِ دو مقدار لزوماً یکی نیست ("10" و "10.00")؛ قبل از مقایسه هم‌تراز می‌شوند.
  const scale = Math.max(moneyScale(a), moneyScale(b));
  const left = toMinorUnits(a, scale);
  const right = toMinorUnits(b, scale);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function moneyEquals(a: MoneyString, b: MoneyString): boolean {
  return compareMoney(a, b) === 0;
}

/**
 * جمعِ **نمایشی** (جمع سبدِ پیش‌نویس، خلاصه‌ی جدول).
 * نامِ تابع عمداً «ForDisplay» است: خروجیِ آن هرگز نباید به‌عنوان مبلغِ قطعیِ
 * سفارش، تخفیف، بازپرداخت یا تسویه به سرور فرستاده یا ذخیره شود.
 */
export function sumMoneyForDisplay(values: readonly MoneyString[], scale = 0): MoneyString {
  let total = 0n;
  for (const value of values) total += toMinorUnits(value, scale);
  return fromMinorUnits(total, scale);
}
