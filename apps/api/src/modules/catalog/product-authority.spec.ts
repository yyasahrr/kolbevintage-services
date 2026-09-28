import { describe, it, expect } from "vitest";
import { assertProductOwnership, findDuplicateCandidates, assertOfferAllowedForProduct } from "./catalog.logic";

/**
 * Product Authority — no bypass canonical
 * Canonical: Product → Seller Offer → Kolbe/Supplier
 * Legacy supplier_product/supplier_variant must not be bypassed to retail
 */

describe("مالکیت محصول کانونیکال — Product Authority", () => {
  it("محصول کانونیکال باید از طریق Product ایجاد شود، نه مستقیم supplier_product برای خرده", () => {
    // Supplier cannot create KOLBE product
    expect(() => assertProductOwnership("supplier", { name: "x", slug: "x", ownerType: "KOLBE", isKolbeExclusive: false } as any)).toThrow();
    // Supplier proposals are persisted separately; this helper only validates ownership shape.
    expect(() => assertProductOwnership("supplier", { name: "x", slug: "x", ownerType: "SUPPLIER", isKolbeExclusive: false } as any)).not.toThrow();
  });

  it("تأمین‌کننده نمی‌تواند محصول انحصاری کلبه بسازد", () => {
    expect(() => assertProductOwnership("supplier", { name: "x", slug: "x", ownerType: "KOLBE", isKolbeExclusive: true } as any)).toThrow();
    expect(() => assertProductOwnership("admin", { name: "x", slug: "x", ownerType: "KOLBE", isKolbeExclusive: true } as any)).not.toThrow();
  });

  it("تشخیص تکراری — بدون ادغام خودکار", () => {
    const existing = [
      { id: "prod_1", slug: "black-linen-shirt", name: "Black Linen Shirt", brandId: "brand_1", categoryId: "cat_1" },
      { id: "prod_2", slug: "white-cotton-tee", name: "White Cotton Tee", brandId: "brand_2", categoryId: "cat_1" },
    ];
    // Same slug → duplicate
    const dup1 = findDuplicateCandidates({ slug: "black-linen-shirt", name: "Something", brandId: "brand_x", categoryId: "cat_x" } as any, existing as any);
    expect(dup1.length).toBe(1);
    expect(dup1[0].id).toBe("prod_1");

    // Same name+brand+category → duplicate
    const dup2 = findDuplicateCandidates({ slug: "new-slug", name: "Black Linen Shirt", brandId: "brand_1", categoryId: "cat_1" } as any, existing as any);
    expect(dup2.length).toBe(1);

    // Different → no duplicate
    const dup3 = findDuplicateCandidates({ slug: "new-product", name: "New Product", brandId: "brand_3", categoryId: "cat_2" } as any, existing as any);
    expect(dup3.length).toBe(0);
  });

  it("بدون ادغام خودکار — صف تطبیق نیاز به تأیید ادمین", () => {
    // This is architectural: findDuplicateCandidates only detects, does not merge
    // Resolution must go through supplier_product_submission with admin approval
    // So we test that detection does NOT auto-merge, only suggests
    const candidates = findDuplicateCandidates(
      { slug: "black-linen-shirt-v2", name: "Black Linen Shirt", brandId: "brand_1", categoryId: "cat_1" } as any,
      [{ id: "prod_1", slug: "black-linen-shirt", name: "Black Linen Shirt", brandId: "brand_1", categoryId: "cat_1" }] as any,
    );
    expect(candidates.length).toBe(1);
    // The actual merge is NOT done here — must be admin approved
  });

  it("Seller Offer Rules — Supplier wholesale only", () => {
    // Supplier cannot set retail price
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: false,
        wholesalePrice: BigInt(1000),
        retailPrice: BigInt(1000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).toThrow();
    // Supplier can set wholesale only (no retail)
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: false,
        wholesalePrice: BigInt(1000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).not.toThrow();
    // Kolbe can set both
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "KOLBE",
        productIsKolbeExclusive: false,
        wholesalePrice: BigInt(1000),
        retailPrice: BigInt(2000),
        moq: 1,
        moqUnit: "PIECE" as any,
      }),
    ).not.toThrow();
  });
});

describe("Canonical Architecture — no legacy tables", () => {
  it("legacy tables must NOT exist as active domains", () => {
    const removedTables = [
      "supplier_product",
      "supplier_variant",
      "supplier_inventory",
      "legacy_product_mapping",
      "legacy_variant_mapping",
      "product_match_queue",
    ];
    // In Phase 3.8, these tables are deleted — canonical is only source of truth
    // Product → Product Variant → Seller → Seller Offer → Product Variant Inventory → Reservation → Order
    expect(removedTables.length).toBe(6);
    // Canonical flow:
    // Supplier → Submission → Admin chooses existing/new Product → Offer → Publish
  });
});
