/**
 * تست‌های پول و مقدار (فاز ۶.۱-E).
 *
 * محور: پولِ authoritative رشتهٔ ده‌دهی است و هیچ مسیری آن را به عددِ اعشاریِ
 * جاوااسکریپت تبدیل نمی‌کند. این تست‌ها علاوه بر رفتار، **سورسِ ماژول** را هم
 * بررسی می‌کنند تا استفاده از `parseFloat` یا `Number()` روی مبالغ دوباره وارد
 * نشود.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MoneyFormatError,
  assertMoneyString,
  compareMoney,
  formatMoney,
  fromMinorUnits,
  isMoneyString,
  moneyScale,
  sumMoneyForDisplay,
  toMinorUnits,
} from "../shared/money/money";
import {
  formatQuantity,
  isIntegerQuantity,
  isQuantityString,
  parseQuantity,
  sumQuantities,
} from "../shared/money/quantity";

const moneySource = readFileSync(path.resolve(import.meta.dirname, "..", "shared", "money", "money.ts"), "utf8");
const quantitySource = readFileSync(path.resolve(import.meta.dirname, "..", "shared", "money", "quantity.ts"), "utf8");

describe("Phase 6.1-E money semantics", () => {
  it("accepts only decimal strings as authoritative money", () => {
    expect(isMoneyString("1250000")).toBe(true);
    expect(isMoneyString("1250000.50")).toBe(true);
    expect(isMoneyString("-1250000")).toBe(true);
    expect(isMoneyString(1250000)).toBe(false);
    expect(isMoneyString("1,250,000")).toBe(false);
    expect(isMoneyString("")).toBe(false);
    expect(isMoneyString("12.3456789")).toBe(false);
    expect(() => assertMoneyString(1250000)).toThrow(MoneyFormatError);
  });

  it("converts to and from minor units without floating point", () => {
    expect(toMinorUnits("1250000")).toBe(1_250_000n);
    expect(toMinorUnits("1250000.50")).toBe(125_000_050n);
    expect(toMinorUnits("1250000.5", 2)).toBe(125_000_050n);
    expect(toMinorUnits("-3.25")).toBe(-325n);
    expect(fromMinorUnits(125_000_050n, 2)).toBe("1250000.50");
    expect(fromMinorUnits(-325n, 2)).toBe("-3.25");
    expect(() => toMinorUnits("1.234", 2)).toThrow(MoneyFormatError);
  });

  it("reports the decimal scale of a money string", () => {
    expect(moneyScale("100")).toBe(0);
    expect(moneyScale("100.5")).toBe(1);
    expect(moneyScale("100.005")).toBe(3);
  });

  it("formats money in the storefront convention (Persian digits, comma grouping)", () => {
    expect(formatMoney("1250000")).toBe("۱,۲۵۰,۰۰۰ تومان");
    expect(formatMoney("1250000", { digits: "en" })).toBe("1,250,000 تومان");
    expect(formatMoney("1250000", { suffix: "" })).toBe("۱,۲۵۰,۰۰۰");
    expect(formatMoney("-1250000")).toBe("-۱,۲۵۰,۰۰۰ تومان");
    expect(formatMoney("1250.5")).toBe("۱,۲۵۰.۵ تومان");
    expect(formatMoney("1250", { fractionDigits: 2 })).toBe("۱,۲۵۰.۰۰ تومان");
    expect(formatMoney("1250.567", { fractionDigits: 2 })).toBe("۱,۲۵۰.۵۶ تومان");
    expect(formatMoney("1250000", { grouping: false })).toBe("۱۲۵۰۰۰۰ تومان");
  });

  it("compares and sums money using big integers", () => {
    expect(compareMoney("10.00", "10")).toBe(0);
    expect(compareMoney("10.01", "10")).toBe(1);
    expect(compareMoney("9.99", "10")).toBe(-1);
    expect(sumMoneyForDisplay(["0.1", "0.2"], 1)).toBe("0.3");
    expect(sumMoneyForDisplay(["1250000", "250000"])).toBe("1500000");
    // همان جمعی که با float غلط می‌شود:
    expect(Number(0.1) + Number(0.2)).not.toBe(0.3);
  });

  it("never uses parseFloat or Number() on monetary values", () => {
    expect(moneySource).not.toMatch(/parseFloat\s*\(/);
    expect(moneySource).not.toMatch(/Number\s*\(\s*(value|amount|input|text|trimmed)/);
    expect(quantitySource).not.toMatch(/parseFloat\s*\(/);
  });

  it("keeps quantity precision and meaning from the API", () => {
    expect(isQuantityString("12")).toBe(true);
    expect(isQuantityString("1.5")).toBe(true);
    expect(isQuantityString("abc")).toBe(false);
    expect(isIntegerQuantity("12")).toBe(true);
    expect(isIntegerQuantity("12.0")).toBe(false);

    const units = parseQuantity("12");
    expect(units).toEqual({ ok: true, value: { value: "12", scale: 0, unit: "unit" } });

    const weight = parseQuantity("1.5", { maxScale: 3, unit: "kilogram" });
    expect(weight).toEqual({ ok: true, value: { value: "1.5", scale: 1, unit: "kilogram" } });

    expect(parseQuantity("1.23456", { maxScale: 2 }).ok).toBe(false);
    expect(parseQuantity("0", { min: "1" }).ok).toBe(false);
    expect(parseQuantity("99", { max: "10" }).ok).toBe(false);
    expect(parseQuantity("abc").ok).toBe(false);
    expect(parseQuantity(Number.NaN).ok).toBe(false);
  });

  it("formats and sums quantities without losing precision", () => {
    expect(formatQuantity("12")).toBe("۱۲");
    expect(formatQuantity("1.5")).toBe("۱.۵");
    expect(formatQuantity("12", { digits: "en" })).toBe("12");
    expect(formatQuantity("12", { minFractionDigits: 2 })).toBe("۱۲.۰۰");
    expect(sumQuantities(["1", "2"])).toBe("3");
    expect(sumQuantities(["1.25", "2.50"], 2)).toBe("3.75");
    expect(() => sumQuantities(["1.234"], 2)).toThrow(/دقت/);
  });
});
