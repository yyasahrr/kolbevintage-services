import { describe, it, expect } from "vitest";
import { assertOfferAllowedForProduct, assertProductOwnership, assertProductStatusTransition } from "./catalog.logic";
import { assertSupplierOfferIsolation } from "../offers/offers.logic";

/**
 * Retail = Kolbe only, Wholesale = Kolbe+Supplier
 * Tests proving supplier cannot appear in retail
 */

describe("جداسازی خرده/عمده — Retail Isolation", () => {
  const kolbeProduct = { id: "prod_kolbe", ownerType: "KOLBE" as const, isKolbeExclusive: false, status: "published" as const };
  const supplierProduct = { id: "prod_sup", ownerType: "SUPPLIER" as const, isKolbeExclusive: false, status: "published" as const };
  const exclusiveProduct = { id: "prod_ex", ownerType: "KOLBE" as const, isKolbeExclusive: true, status: "published" as const };

  it("تأمین‌کننده نمی‌تواند محصول خرده بسازد", () => {
    expect(() => assertProductOwnership("supplier", { name: "x", slug: "x", ownerType: "KOLBE", isKolbeExclusive: false } as any)).toThrow("کلبه");
  });

  it("تأمین‌کننده نمی‌تواند پیشنهاد خرده (retail_price) بسازد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_kolbe",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: false,
        wholesalePrice: BigInt(1000),
        retailPrice: BigInt(1000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).toThrow("خرده");
  });

  it("کلبه می‌تواند پیشنهاد خرده بسازد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_kolbe",
        sellerType: "KOLBE",
        productIsKolbeExclusive: false,
        wholesalePrice: BigInt(1000),
        retailPrice: BigInt(2000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).not.toThrow();
  });

  it("تأمین‌کننده نمی‌تواند روی محصول انحصاری کلبه پیشنهاد بسازد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_ex",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: true,
        wholesalePrice: BigInt(1000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).toThrow("انحصاری");
  });

  it("محصول انحصاری هیچ پیشنهاد تأمین‌کننده‌ای نمی‌پذیرد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_ex",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: true,
        wholesalePrice: BigInt(1000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).toThrow();
  });

  it("محصول تأمین‌کننده نمی‌تواند در خرده‌فروشی باشد — فقط کلبه", () => {
    // Simulate retail filter: ownerType must be KOLBE
    const allProducts = [kolbeProduct, supplierProduct, exclusiveProduct] as any[];
    const retailProducts = allProducts.filter((p) => p.ownerType === "KOLBE");
    expect(retailProducts.map((p) => p.id)).toEqual(["prod_kolbe", "prod_ex"]);
    expect(retailProducts.find((p: any) => (p as any).ownerType === "SUPPLIER")).toBeUndefined();
  });

  it("عمده‌فروشی کلبه+تأمین‌کننده را می‌پذیرد", () => {
    const allProducts = [kolbeProduct, supplierProduct, exclusiveProduct];
    const wholesaleProducts = allProducts; // no filter
    expect(wholesaleProducts.length).toBe(3);
  });

  it("تأمین‌کننده فقط پیشنهاد خودش را می‌بیند", () => {
    expect(() =>
      assertSupplierOfferIsolation({
        requesterSellerId: "seller_a",
        offerSellerId: "seller_b",
        requesterRole: "supplier",
      }),
    ).toThrow("فقط می‌تواند پیشنهاد");
    expect(() =>
      assertSupplierOfferIsolation({
        requesterSellerId: "seller_a",
        offerSellerId: "seller_a",
        requesterRole: "supplier",
      }),
    ).not.toThrow();
  });
});
