import { describe, expect, it } from "vitest";
import {
  add,
  adjust,
  allocateProportionally,
  basisPoints,
  divide,
  formatToman,
  MAX_MONEY,
  min,
  money,
  MoneyError,
  multiply,
  percent,
  roundDivide,
  serializeMoney,
  subtract,
  sumByCurrency,
} from "../src/money";

/**
 * قاعدهٔ A10: «Do not store monetary values as float».
 * این تست‌ها ثابت می‌کنند مسیر پول هرگز از `number` اعشاری عبور نمی‌کند.
 */
describe("money — حساب صحیح پول", () => {
  it("اعداد اعشاری را رد می‌کند", () => {
    expect(() => money(10.5)).toThrowError(MoneyError);
    expect(() => money("12.5")).toThrowError(/MONEY_INVALID_STRING/);
    expect(() => money(Number.NaN)).toThrowError(/MONEY_NOT_FINITE/);
  });

  it("رشته و عدد صحیح و bigint را می‌پذیرد", () => {
    expect(money("890000")).toBe(890_000n);
    expect(money(1_240_000)).toBe(1_240_000n);
    expect(money(5n)).toBe(5n);
  });

  it("از سرریز مقیاس جلوگیری می‌کند", () => {
    expect(() => money(MAX_MONEY + 1n)).toThrowError(/MONEY_OUT_OF_RANGE/);
  });

  it("جمع و تفریق دقیق است (بدون خطای اعشاری)", () => {
    // نمونهٔ کلاسیک خطای float: 0.1 + 0.2 !== 0.3
    const a = money(100_000);
    const b = money(200_000);
    expect(add(a, b, a)).toBe(400_000n);
    expect(subtract(b, a)).toBe(100_000n);
  });

  it("ضرب در تعداد، عدد صحیح می‌ماند", () => {
    expect(multiply(money(4_850_000), 3)).toBe(14_550_000n);
  });

  it("درصد صحیح، معادل محاسبهٔ ریاضی است", () => {
    expect(percent(money(1_000_000), 10)).toBe(1_100_000n);
    expect(percent(money(1_000_000), -25)).toBe(750_000n);
    expect(percent(money(1_000_000), 0)).toBe(1_000_000n);
    // نتیجه در سطح ریال گرد می‌شود (ریال واحد خرد ندارد)
    expect(percent(money(999_999), 10)).toBe(1_099_999n);
  });

  it("گردکردن نیم‌به‌بالا درست کار می‌کند", () => {
    expect(roundDivide(5n, 10n)).toBe(1n);
    expect(roundDivide(4n, 10n)).toBe(0n);
    expect(roundDivide(15n, 10n)).toBe(2n);
    expect(roundDivide(-5n, 10n)).toBe(-1n);
    expect(() => roundDivide(1n, 0n)).toThrowError(/MONEY_DIVIDE_BY_ZERO/);
  });

  it("تقسیم و تغییر مطلق امن هستند", () => {
    expect(divide(money(1_000_000), 3)).toBe(333_333n);
    expect(adjust(money(1_000_000), -250_000)).toBe(750_000n);
    expect(min(1n, 2n, 3n)).toBe(1n);
  });

  it("روی سیم به‌صورت رشته سریالایز می‌شود (نه float)", () => {
    const serialized = serializeMoney(9_007_199_254_740_993n);
    expect(typeof serialized).toBe("string");
    expect(JSON.parse(`{"amount":${JSON.stringify(serialized)}}`).amount).toBe("9007199254740993");
  });

  it("جمع چند ارز جدا نگه داشته می‌شود", () => {
    const totals = sumByCurrency([
      { amount: money(100), currency: "IRR" },
      { amount: money(250), currency: "IRR" },
      { amount: money(50), currency: "USD" },
    ]);
    expect(totals.get("IRR")).toBe(350n);
    expect(totals.get("USD")).toBe(50n);
  });

  it("نمایش فارسی مقدار را تغییر نمی‌دهد", () => {
    expect(formatToman(money(1_240_000))).toContain("تومان");
  });

  // ── Phase 4.7.6 — قواعد گردکردنِ منجمد برای Phase 4.8 (هیچ نرخی این‌جا تعریف نمی‌شود) ──
  it("basisPoints — سهم bps با حساب صحیح و گردکردن صریح", () => {
    expect(basisPoints(1_000_000n, 250n)).toBe(25_000n); // ۲٫۵٪
    expect(basisPoints(999n, 250n)).toBe(25n); // 24.975 → half-up
    expect(basisPoints(999n, 250n, "down")).toBe(24n); // کف
    expect(basisPoints(1n, 1n)).toBe(0n); // 0.0001 → 0
    expect(basisPoints(5_000n, 1n)).toBe(1n); // 0.5 → half-up 1
    expect(basisPoints(5_000n, 1n, "down")).toBe(0n);
    expect(basisPoints(123_456_789n, 0n)).toBe(0n); // پیش‌فرض کارمزد قبل از پیکربندی: صفر
    expect(basisPoints(123_456_789n, 10_000n)).toBe(123_456_789n); // ۱۰۰٪
    expect(basisPoints(100_000_000n, 3_333n)).toBe(33_330_000n); // مثال ۱۰۰ میلیون × ۳۳٫۳۳٪
    expect(() => basisPoints(1n, 10_001n)).toThrowError(/MONEY_BPS_OUT_OF_RANGE/);
    expect(() => basisPoints(1n, -1n)).toThrowError(/MONEY_BPS_OUT_OF_RANGE/);
    expect(() => basisPoints(-1n, 100n)).toThrowError(/MONEY_NEGATIVE_BASE/);
    expect(() => basisPoints(1n, 2.5)).toThrowError(MoneyError); // نرخ اعشاری پذیرفته نمی‌شود
  });

  it("allocateProportionally — بزرگ‌ترین باقی‌مانده؛ جمع اجزا همیشه برابر مبلغ است", () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(100_000_000n, [40n, 35n, 25n])).toEqual([40_000_000n, 35_000_000n, 25_000_000n]);
    expect(allocateProportionally(10n, [3n, 3n, 3n])).toEqual([4n, 3n, 3n]); // تساوی → اندیس کوچک‌تر
    expect(allocateProportionally(1n, [1n, 1n])).toEqual([1n, 0n]);
    expect(allocateProportionally(0n, [5n, 7n])).toEqual([0n, 0n]);
    expect(allocateProportionally(7n, [0n, 1n])).toEqual([0n, 7n]); // وزن صفر سهمی نمی‌گیرد
    const parts = allocateProportionally(999_999_999n, [7n, 11n, 13n, 17n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(999_999_999n);
    expect(() => allocateProportionally(1n, [])).toThrowError(/MONEY_ALLOCATION_NO_WEIGHTS/);
    expect(() => allocateProportionally(1n, [0n, 0n])).toThrowError(/MONEY_ALLOCATION_ZERO_WEIGHT/);
    expect(() => allocateProportionally(1n, [-1n, 2n])).toThrowError(/MONEY_ALLOCATION_NEGATIVE_WEIGHT/);
    expect(() => allocateProportionally(-1n, [1n])).toThrowError(/MONEY_NEGATIVE_BASE/);
  });
});
