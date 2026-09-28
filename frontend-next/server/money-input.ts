/**
 * اعتبارسنجی ورودی‌های پولی و شمارشی سمت سرور.
 *
 * ── چرا این فایل وجود دارد ───────────────────────────────────────────────────
 * یافتهٔ D25 ممیزی PROMPT 1: ثبت محصول تأمین‌کننده مقدار را با
 * `Number(body.wholesalePrice ?? 0)` مستقیم به ستون `bigint` می‌فرستاد. نتیجه:
 *   • `wholesalePrice: -999999` → **HTTP 201** (محصول با قیمت منفی ساخته می‌شد)
 *   • `wholesalePrice: 1234.56`  → **HTTP 500** `22P02` (خطای تبدیل bigint)
 *   • `wholesalePrice: "abc"`    → **HTTP 500** `22P02`
 * همین الگو برای `stock` هم بود (`Number("abc")` → `NaN` → خطای ستون integer).
 *
 * قاعدهٔ حاکم (A10): «مبالغ هرگز اعشاری نیستند.» پس هیچ مسیر ورودی نباید اجازه
 * دهد یک عدد اعشاری یا منفی به ستون پولی برسد.
 *
 * ⚠️ جایگزینی در فاز ۳: `packages/shared/src/money.ts` همین قواعد را دارد
 * (`money()` + `MAX_MONEY`) و پس از آنکه `frontend-next` به یک کلاینت نازک روی
 * `/api/v1` تبدیل شد، همین فایل حذف و از پکیج مشترک استفاده می‌شود. تا آن زمان
 * این فایل تک‌مرجع اعتبارسنجی پول در لایهٔ گذار است و هیچ ماژول دیگری نباید
 * مبلغ را خودش تبدیل کند.
 */

import { HttpError } from "./http-error";

/** هم‌ارز `MAX_MONEY` در `packages/shared/src/money.ts` (۱ کوادریلیون ریال). */
export const MAX_MONEY_INPUT = 1_000_000_000_000_000;

/**
 * تبدیل یک ورودی نامطمئن به مبلغ صحیح و نامنفی (به‌صورت رشته، برای پارامتر
 * `bigint` در پستگرس).
 *
 * @throws HttpError 422 با کد `code` اگر ورودی صحیح، نامنفی و در محدوده نباشد.
 */
export function parseMoneyInput(value: unknown, code = "INVALID_AMOUNT"): string {
  const amount = toBigInt(value, code);
  if (amount < 0n) throw new HttpError(422, code);
  if (amount > BigInt(MAX_MONEY_INPUT)) throw new HttpError(422, code);
  return amount.toString();
}

function toBigInt(value: unknown, code: string): bigint {
  if (typeof value === "number") {
    // `Number.isInteger` هم اعشار و هم NaN/Infinity را رد می‌کند.
    if (!Number.isInteger(value)) throw new HttpError(422, code);
    return BigInt(value);
  }
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    // فقط رقم؛ علامت منفی جداگانه بررسی می‌شود تا پیام «منفی» از «نامعتبر» جدا باشد.
    if (!/^-?\d+$/.test(trimmed)) throw new HttpError(422, code);
    return BigInt(trimmed);
  }
  throw new HttpError(422, code);
}

/**
 * تبدیل ورودی به عدد صحیح نامنفی محدود.
 * برای مقادیری مثل تعداد موجودی و تعداد در هر خط سفارش.
 */
export function parseNonNegativeInteger(value: unknown, code: string, max: number): number {
  const amount = toBigInt(value ?? 0, code);
  if (amount < 0n || amount > BigInt(max)) throw new HttpError(422, code);
  return Number(amount);
}
