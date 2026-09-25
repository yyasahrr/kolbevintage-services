/**
 * مقدار/تعداد در مرزِ فرانت‌اند (فاز ۶.۱).
 *
 * تعداد فقط «یک عددِ صحیحِ ساده» نیست: بسته به قراردادِ کالا می‌تواند
 * تعدادِ عددی (تعداد در بسته)، مقدارِ وزنی/طولی یا واحدِ بسته‌بندی باشد. فاز ۶.۰
 * ثبت کرد که برخی صفحات مقدار را به `number` تبدیل می‌کنند و در نتیجه
 *  - مقدارِ `1.5` را `1` نشان می‌دهند،
 *  - یا برعکس، برای مقدارِ صحیح اعشارِ خیالی تولید می‌کنند.
 *
 * قاعده: معنا و دقتِ مقدار همان است که API فرستاده؛ تبدیل به `number` فقط برای
 * نمایش و بعد از تأییدِ قالب انجام می‌شود و هیچ‌وقت مرجعِ ارسال به سرور نیست
 * مگر اینکه خودِ API همان را خواسته باشد.
 */

export const QUANTITY_STRING_PATTERN = /^-?\d+(\.\d{1,6})?$/;

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export type QuantityUnit = "unit" | "package" | "kilogram" | "gram" | "meter" | (string & {});

export type Quantity = {
  /** مقدار به‌صورت رشتهٔ ده‌دهی — دقتِ API حفظ می‌شود. */
  value: string;
  /** تعداد ارقامِ اعشاریِ معنادار. */
  scale: number;
  unit: QuantityUnit;
};

export function isQuantityString(value: unknown): boolean {
  return typeof value === "string" && QUANTITY_STRING_PATTERN.test(value.trim());
}

function splitQuantity(value: string): { sign: string; integer: string; fraction: string } {
  const trimmed = value.trim();
  const sign = trimmed.startsWith("-") ? "-" : "";
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf(".");
  return {
    sign,
    integer: (dot === -1 ? unsigned : unsigned.slice(0, dot)) || "0",
    fraction: dot === -1 ? "" : unsigned.slice(dot + 1),
  };
}

export type ParseQuantityOptions = {
  /** حداکثر دقتِ مجاز برای این قرارداد؛ `0` یعنی فقط عددِ صحیح. */
  maxScale?: number;
  min?: string;
  max?: string;
  unit?: QuantityUnit;
};

function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const scale = Math.max(a.includes(".") ? a.length - a.indexOf(".") - 1 : 0, b.includes(".") ? b.length - b.indexOf(".") - 1 : 0);
  const pad = (value: string): bigint => {
    const { sign, integer, fraction } = splitQuantity(value);
    const units = BigInt(`${integer}${fraction.padEnd(scale, "0")}`) || 0n;
    return sign === "-" ? -units : units;
  };
  const left = pad(a);
  const right = pad(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * تجزیهٔ مقدار از پاسخِ API یا ورودیِ کاربر.
 * خروجی رشته است تا دقت از بین نرود؛ `scale` برای قالب‌بندی و اعتبارسنجی نگه داشته می‌شود.
 */
export function parseQuantity(input: unknown, options: ParseQuantityOptions = {}): ParseResult<Quantity> {
  const maxScale = options.maxScale ?? 6;
  let text: string;
  if (typeof input === "string") text = input.trim();
  else if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, reason: "مقدار باید عددی متناهی باشد." };
    text = String(input);
  } else return { ok: false, reason: "مقدار باید رشته یا عدد باشد." };

  if (!isQuantityString(text)) return { ok: false, reason: `قالبِ مقدار نامعتبر است: "${input}"` };

  const { fraction } = splitQuantity(text);
  const scale = fraction.replace(/0+$/, "").length;
  if (scale > maxScale) {
    return { ok: false, reason: `دقتِ مقدار (${scale}) بیش از سقف مجاز (${maxScale}) است.` };
  }
  if (options.min !== undefined && compareDecimalStrings(text, options.min) < 0) {
    return { ok: false, reason: `مقدار کمتر از حداقل مجاز (${options.min}) است.` };
  }
  if (options.max !== undefined && compareDecimalStrings(text, options.max) > 0) {
    return { ok: false, reason: `مقدار بیش از حداکثر مجاز (${options.max}) است.` };
  }
  return { ok: true, value: { value: text, scale, unit: options.unit ?? "unit" } };
}

export function isIntegerQuantity(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

export type FormatQuantityOptions = {
  digits?: "fa" | "en";
  /** نمایشِ اعشار حتی اگر صفر باشد (برای ستون‌های جدول). */
  minFractionDigits?: number;
};

/** قالب‌بندیِ نمایشیِ مقدار؛ مقدارِ واقعی تغییر نمی‌کند. */
export function formatQuantity(value: string, options: FormatQuantityOptions = {}): string {
  const { digits = "fa", minFractionDigits = 0 } = options;
  if (!isQuantityString(value)) return String(value);
  const { sign, integer, fraction } = splitQuantity(value);
  const kept = fraction.length > 0 || minFractionDigits > 0 ? fraction.padEnd(Math.max(fraction.length, minFractionDigits), "0") : "";
  const body = kept.length > 0 ? `${integer}.${kept}` : integer;
  const result = digits === "en" ? `${sign}${body}` : `${sign}${body}`.replace(/\d/g, (digit) => FA_DIGITS[Number(digit)] as string);
  return result;
}

/**
 * جمعِ مقدارها با حفظِ مقیاس — برای جمعِ ستون و خلاصه‌ی سبد.
 * مثل `sumMoneyForDisplay` فقط مصرفِ نمایشی دارد؛ موجودی و سقفِ سفارش سروری است.
 */
export function sumQuantities(values: readonly string[], scale = 0): string {
  let total = 0n;
  for (const value of values) {
    const { sign, integer, fraction } = splitQuantity(value.trim());
    if (fraction.length > scale) {
      throw new Error(`دقتِ مقدار "${value}" بیش از مقیاسِ ${scale} است؛ داده از دست می‌رود.`);
    }
    const units = BigInt(`${integer}${fraction.padEnd(scale, "0")}`) || 0n;
    total += sign === "-" ? -units : units;
  }
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  return `${negative ? "-" : ""}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}
