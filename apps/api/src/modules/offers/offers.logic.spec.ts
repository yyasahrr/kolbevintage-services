import { describe, it, expect } from "vitest";
import { assertSupplierOfferIsolation, calculateMoqInPieces, validateSizeRun } from "./offers.logic";

describe("جداسازی تأمین‌کننده — فقط پیشنهادهای خودش", () => {
  it("تأمین‌کننده نمی‌تواند پیشنهاد دیگری را ببیند", () => {
    expect(() =>
      assertSupplierOfferIsolation({
        requesterSellerId: "seller_a",
        offerSellerId: "seller_b",
        requesterRole: "supplier",
      }),
    ).toThrow("فقط می‌تواند پیشنهادهای خودش را ببیند");
  });

  it("تأمین‌کننده می‌تواند پیشنهاد خودش را ببیند", () => {
    expect(() =>
      assertSupplierOfferIsolation({
        requesterSellerId: "seller_a",
        offerSellerId: "seller_a",
        requesterRole: "supplier",
      }),
    ).not.toThrow();
  });

  it("ادمین می‌تواند همه را ببیند", () => {
    expect(() =>
      assertSupplierOfferIsolation({
        requesterSellerId: "seller_a",
        offerSellerId: "seller_b",
        requesterRole: "admin",
      }),
    ).not.toThrow();
  });
});

describe("محاسبهٔ MOQ با واحدهای مختلف — Phase 4.2.2 BOX/CARTON no universal multiplier", () => {
  it("PIECE", () => {
    expect(calculateMoqInPieces(10, "PIECE", 6)).toBe(10);
  });
  it("PACKAGE", () => {
    expect(calculateMoqInPieces(2, "PACKAGE", 6)).toBe(12);
  });
  it("BOX — explicit recipe, no 5 multiplier", () => {
    // Previously BOX was moq*packagePieces*5, now it's moq*packagePieces
    expect(calculateMoqInPieces(1, "BOX", 6)).toBe(6);
    expect(calculateMoqInPieces(2, "BOX", 10)).toBe(20);
  });
  it("CARTON — explicit recipe, no 20 multiplier", () => {
    expect(calculateMoqInPieces(1, "CARTON", 6)).toBe(6);
    expect(calculateMoqInPieces(3, "CARTON", 8)).toBe(24);
  });
  it("no legacy multiplier remains", async () => {
    const { hasLegacyBoxCartonMultiplier } = await import("./offers.logic");
    expect(hasLegacyBoxCartonMultiplier()).toBe(false);
  });
  it("BOX and CARTON use same formula as PACKAGE (explicit recipe)", () => {
    // Proof that BOX/CARTON don't have universal 5/20
    const packagePieces = 12;
    const moq = 3;
    const expected = moq * packagePieces; // 36
    expect(calculateMoqInPieces(moq, "PACKAGE", packagePieces)).toBe(expected);
    expect(calculateMoqInPieces(moq, "BOX", packagePieces)).toBe(expected);
    expect(calculateMoqInPieces(moq, "CARTON", packagePieces)).toBe(expected);
    expect(calculateMoqInPieces(moq, "SERIES", packagePieces)).toBe(expected);
    expect(calculateMoqInPieces(moq, "SET", packagePieces)).toBe(expected);
  });
});

describe("سایز-ران", () => {
  it("حداقل ۲ سایز", () => {
    expect(() => validateSizeRun([{ size: "S", qty: 2 }])).toThrow();
  });
  it("معتبر", () => {
    expect(() => validateSizeRun([{ size: "S", qty: 2 }, { size: "M", qty: 2 }])).not.toThrow();
  });
});
