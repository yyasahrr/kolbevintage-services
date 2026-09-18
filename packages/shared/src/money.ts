/**
 * پول — فقط اعداد صحیح.
 *
 * قاعدهٔ حاکم (PROMPT 0): «Do not store monetary values as float».
 *
 * چرا این ماژول وجود دارد؟ ممیزی معماری نشان داد محاسبات پولی در چند نقطه با
 * اعداد اعشاری انجام می‌شد (مثلاً `wholesale_price*(1+$3/100.0)`) و مبالغ سفارش
 * خرده‌فروشی مستقیماً از مرورگر گرفته می‌شد. جایی که پول در گردش است، `number`
 * اعشاری خطای گردکردن تولید می‌کند و خطا در دفتر مالی می‌ماند.
 *
 * تصمیم‌ها:
 *  - نمایش داخلی: `bigint` (ریال ایران واحد خرد ندارد؛ همهٔ مبالغ عدد صحیح‌اند).
 *  - نمایش روی سیم (JSON): `string` — چون `JSON.parse` هر عدد بزرگ را به
 *    `number` اعشاری تبدیل می‌کند و دقت را می‌شکند.
 *  - محاسبهٔ درصد: با basis point (صدم درصد) و حساب صحیح.
 */

/** مبلغ در واحد خرد (ریال). */
export type Money = bigint;

export class MoneyError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MoneyError";
  }
}

/** مرز ایمنی برای جلوگیری از سرریز/اشتباه واحد (۱۰۰۰ میلیارد ریال). */
export const MAX_MONEY: Money = 1_000_000_000_000_000n;

export function money(value: bigint | number | string): Money {
  if (typeof value === "bigint") return assertSafeMoney(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MoneyError("MONEY_NOT_FINITE");
    if (!Number.isInteger(value)) throw new MoneyError("MONEY_NOT_INTEGER");
    return assertSafeMoney(BigInt(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new MoneyError("MONEY_INVALID_STRING");
    return assertSafeMoney(BigInt(trimmed));
  }
  throw new MoneyError("MONEY_INVALID_TYPE");
}

function assertSafeMoney(value: Money): Money {
  if (value > MAX_MONEY || value < -MAX_MONEY) throw new MoneyError("MONEY_OUT_OF_RANGE");
  return value;
}

/** آیا این مقدار یک مبلغ صحیح و امن است؟ */
export function isMoney(value: unknown): value is Money {
  try {
    money(value as bigint);
    return true;
  } catch {
    return false;
  }
}

export const zero = (): Money => 0n;

export function add(...values: Money[]): Money {
  return assertSafeMoney(values.reduce((sum, value) => sum + value, 0n));
}

export function subtract(a: Money, b: Money): Money {
  return assertSafeMoney(a - b);
}

/** ضرب در یک ضریب صحیح (تعداد، ضریب). هرگز در عدد اعشاری ضرب نکنید. */
export function multiply(amount: Money, factor: bigint | number): Money {
  const f = typeof factor === "bigint" ? factor : money(factor);
  return assertSafeMoney(amount * f);
}

/**
 * درصد صحیح با basis point — معادل `amount * (1 + percent/100)`.
 *
 * مثال: `percent(1_000_000n, 10n)` → `1_100_000n` (۱۰٪ افزایش)
 * گردکردن: نیم‌به‌بالا برای مبالغ مثبت، با حساب صحیح (بدون آرگومان اعشاری).
 */
export function percent(amount: Money, percentValue: bigint | number, rounding: "half-up" | "down" = "half-up"): Money {
  const p = typeof percentValue === "bigint" ? percentValue : money(percentValue);
  const numerator = amount * (10_000n + p * 100n);
  const result = rounding === "half-up" ? roundDivide(numerator, 10_000n) : numerator / 10_000n;
  return assertSafeMoney(result);
}

/** تغییر مطلق (کاهش/افزایش به مقدار ثابت). */
export function adjust(amount: Money, delta: bigint | number): Money {
  return assertSafeMoney(amount + (typeof delta === "bigint" ? delta : money(delta)));
}

/** تقسیم صحیح با گردکردن نیم‌به‌بالا روی اعداد نامنفی. */
export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("MONEY_DIVIDE_BY_ZERO");
  const negative = numerator < 0n;
  const value = negative ? -numerator : numerator;
  const rounded = (value + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}

/** تقسیم امن بدون اعشار (سهم، کارمزد، مالیات). */
export function divide(amount: Money, divisor: bigint | number): Money {
  const d = typeof divisor === "bigint" ? divisor : money(divisor);
  if (d === 0n) throw new MoneyError("MONEY_DIVIDE_BY_ZERO");
  return assertSafeMoney(amount / d);
}

/** بزرگ‌ترین/کوچک‌ترین مقدار امن. */
export const min = (...values: Money[]): Money => values.reduce((a, b) => (b < a ? b : a));
export const max = (...values: Money[]): Money => values.reduce((a, b) => (b > a ? b : a));

/** خروجی JSON: همیشه رشته تا در `JSON.parse` به float تبدیل نشود. */
export function serializeMoney(amount: Money): string {
  return amount.toString();
}

/** تجزیهٔ ورودی API: رشته، عدد صحیح یا bigint؛ اعشار پذیرفته نمی‌شود. */
export function deserializeMoney(value: unknown): Money {
  return money(value as bigint);
}

/** نمایش فارسی برای UI (بدون تغییر مقدار). */
export function formatToman(amount: Money): string {
  return `${amount.toLocaleString("fa-IR")} تومان`;
}

/** جمع مبالغ با بررسی تطابق واحد پول. */
export function sumByCurrency(
  entries: ReadonlyArray<{ amount: Money; currency: string }>,
): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const entry of entries) {
    if (!entry.currency) throw new MoneyError("MONEY_CURRENCY_REQUIRED");
    totals.set(entry.currency, add(totals.get(entry.currency) ?? 0n, entry.amount));
  }
  return totals;
}
