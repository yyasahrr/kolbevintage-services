import { describe, it, expect } from "vitest";
import {
  assertProductOwnership,
  assertOfferAllowedForProduct,
  assertProductStatusTransition,
  calculatePackageTotalPieces,
  validateWholesalePackage,
  findDuplicateCandidates,
  calculateWholesalePrice,
  validateBrandCreation,
  calculateSearchRank,
} from "./catalog.logic";

describe("مالکیت محصول — تأمین‌کننده نمی‌تواند خرده‌فروشی کند", () => {
  it("تأمین‌کننده نمی‌تواند محصول کلبه بسازد", () => {
    expect(() =>
      assertProductOwnership("supplier", {
        name: "Shirt",
        slug: "shirt",
        ownerType: "KOLBE",
        isKolbeExclusive: false,
      }),
    ).toThrow("تأمین‌کننده نمی‌تواند محصول با مالک کلبه بسازد");
  });

  it("تأمین‌کننده نمی‌تواند محصول انحصاری بسازد", () => {
    expect(() =>
      assertProductOwnership("supplier", {
        name: "Shirt",
        slug: "shirt",
        ownerType: "SUPPLIER",
        isKolbeExclusive: true,
      }),
    ).toThrow("تأمین‌کننده نمی‌تواند محصول انحصاری کلبه بسازد");
  });

  it("محصول انحصاری فقط مالک کلبه می‌تواند داشته باشد", () => {
    expect(() =>
      assertProductOwnership("admin", {
        name: "Exclusive",
        slug: "exclusive",
        ownerType: "SUPPLIER",
        isKolbeExclusive: true,
      }),
    ).toThrow("محصول انحصاری فقط می‌تواند مالک کلبه داشته باشد");
  });

  it("ادمین می‌تواند محصول کلبه بسازد", () => {
    expect(() =>
      assertProductOwnership("admin", {
        name: "Kolbe Shirt",
        slug: "kolbe-shirt",
        ownerType: "KOLBE",
        isKolbeExclusive: true,
      }),
    ).not.toThrow();
  });

  it("تأمین‌کننده می‌تواند محصول عمده خودش بسازد", () => {
    expect(() =>
      assertProductOwnership("supplier", {
        name: "Supplier Shirt",
        slug: "supplier-shirt",
        ownerType: "SUPPLIER",
        isKolbeExclusive: false,
      }),
    ).not.toThrow();
  });
});

describe("انحصاری کلبه — بدون پیشنهاد تأمین‌کننده", () => {
  it("پیشنهاد تأمین‌کننده برای محصول انحصاری رد می‌شود", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: true,
        wholesalePrice: BigInt(100000),
        moq: 1,
        moqUnit: "PACKAGE",
      }),
    ).toThrow("محصول انحصاری کلبه نمی‌تواند پیشنهاد تأمین‌کننده داشته باشد");
  });

  it("تأمین‌کننده نمی‌تواند retail_price داشته باشد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "SUPPLIER",
        productIsKolbeExclusive: false,
        retailPrice: BigInt(200000),
        wholesalePrice: BigInt(100000),
        moq: 1,
        moqUnit: "PIECE",
      }),
    ).toThrow("تأمین‌کننده فقط عمده می‌فروشد");
  });

  it("کلبه می‌تواند خرده و عمده بفروشد", () => {
    expect(() =>
      assertOfferAllowedForProduct({
        productId: "prod_1",
        sellerType: "KOLBE",
        productIsKolbeExclusive: false,
        retailPrice: BigInt(200000),
        wholesalePrice: BigInt(100000),
        moq: 1,
        moqUnit: "PIECE",
      }),
    ).not.toThrow();
  });
});

describe("چرخهٔ حیات محصول", () => {
  it("تأمین‌کننده فقط می‌تواند draft و pending_review بسازد", () => {
    expect(() => assertProductStatusTransition("draft", "pending_review", "supplier")).not.toThrow();
    // draft → approved is invalid for anyone (must go via pending_review)
    expect(() => assertProductStatusTransition("draft", "approved", "supplier")).toThrow();
    // pending_review → approved is admin only
    expect(() => assertProductStatusTransition("pending_review", "approved", "supplier")).toThrow("فقط با نقش ادمین");
  });

  it("انتقال نامعتبر رد می‌شود", () => {
    expect(() => assertProductStatusTransition("draft", "published", "admin")).toThrow("مجاز نیست");
  });

  it("ادمین می‌تواند تأیید و انتشار کند", () => {
    expect(() => assertProductStatusTransition("pending_review", "approved", "admin")).not.toThrow();
    expect(() => assertProductStatusTransition("approved", "published", "admin")).not.toThrow();
  });
});

describe("بستهٔ عمده — محاسبهٔ سایز-ران", () => {
  it("مجموع قطعات بسته محاسبه می‌شود", () => {
    const items = [
      { variantId: "v_s", quantity: 2 },
      { variantId: "v_m", quantity: 2 },
      { variantId: "v_l", quantity: 2 },
    ];
    expect(calculatePackageTotalPieces(items)).toBe(6);
  });

  it("بستهٔ سایز-ران باید حداقل ۲ سایز داشته باشد", () => {
    expect(() =>
      validateWholesalePackage({
        offerId: "offer_1",
        packageType: "SIZE_RUN",
        name: "Size Run S-L",
        totalPieces: 2,
        items: [{ variantId: "v_s", quantity: 2 }],
      }),
    ).toThrow("حداقل ۲ سایز");
  });

  it("بستهٔ تعداد ثابت فقط یک واریانت", () => {
    expect(() =>
      validateWholesalePackage({
        offerId: "offer_1",
        packageType: "FIXED_QUANTITY",
        name: "Fixed 10",
        totalPieces: 10,
        items: [
          { variantId: "v_s", quantity: 5 },
          { variantId: "v_m", quantity: 5 },
        ],
      }),
    ).toThrow("فقط یک واریانت");
  });

  it("بستهٔ معتبر سایز-ران قبول می‌شود", () => {
    expect(() =>
      validateWholesalePackage({
        offerId: "offer_1",
        packageType: "SIZE_RUN",
        name: "S(2)+M(2)+L(2)",
        totalPieces: 6,
        items: [
          { variantId: "v_s", quantity: 2 },
          { variantId: "v_m", quantity: 2 },
          { variantId: "v_l", quantity: 2 },
        ],
      }),
    ).not.toThrow();
  });

  it("عدم تطابق totalPieces رد می‌شود", () => {
    expect(() =>
      validateWholesalePackage({
        offerId: "offer_1",
        packageType: "SIZE_RUN",
        name: "Mismatch",
        totalPieces: 10,
        items: [
          { variantId: "v_s", quantity: 2 },
          { variantId: "v_m", quantity: 2 },
        ],
      }),
    ).toThrow("هم‌خوانی ندارد");
  });
});

describe("موتور تطبیق — تشخیص تکراری", () => {
  it("slug یکسان کاندید تکراری است", () => {
    const existing = [
      { id: "prod_1", name: "Black Linen Shirt", slug: "black-linen-shirt", brandId: "brand_1", categoryId: "cat_1" },
    ];
    const dup = findDuplicateCandidates(
      { name: "Black Linen Shirt New", slug: "black-linen-shirt", brandId: "brand_1", categoryId: "cat_1" },
      existing,
    );
    expect(dup).toHaveLength(1);
    expect(dup[0].id).toBe("prod_1");
  });

  it("نام یکسان با برند و دسته یکسان تکراری است", () => {
    const existing = [
      { id: "prod_1", name: "Black Linen Shirt", slug: "black-linen-shirt-1", brandId: "brand_1", categoryId: "cat_1" },
    ];
    const dup = findDuplicateCandidates(
      { name: "Black Linen Shirt", slug: "black-linen-shirt-2", brandId: "brand_1", categoryId: "cat_1" },
      existing,
    );
    expect(dup).toHaveLength(1);
  });

  it("نام یکسان با برند متفاوت تکراری نیست", () => {
    const existing = [
      { id: "prod_1", name: "Black Linen Shirt", slug: "black-linen-shirt-1", brandId: "brand_1", categoryId: "cat_1" },
    ];
    const dup = findDuplicateCandidates(
      { name: "Black Linen Shirt", slug: "black-linen-shirt-2", brandId: "brand_2", categoryId: "cat_1" },
      existing,
    );
    expect(dup).toHaveLength(0);
  });

  it("بدون تکراری", () => {
    const existing = [
      { id: "prod_1", name: "White Shirt", slug: "white-shirt", brandId: "brand_1", categoryId: "cat_1" },
    ];
    const dup = findDuplicateCandidates(
      { name: "Black Linen Shirt", slug: "black-linen-shirt", brandId: "brand_1", categoryId: "cat_1" },
      existing,
    );
    expect(dup).toHaveLength(0);
  });
});

describe("تیرهای قیمت عمده — 1/10/50 بسته", () => {
  it("قیمت بر اساس تیر محاسبه می‌شود", () => {
    const tiers = [
      { minQuantity: 1, maxQuantity: 9, unitPrice: BigInt(100000), moqUnit: "PACKAGE" as const },
      { minQuantity: 10, maxQuantity: 49, unitPrice: BigInt(90000), moqUnit: "PACKAGE" as const },
      { minQuantity: 50, maxQuantity: null, unitPrice: BigInt(80000), moqUnit: "PACKAGE" as const },
    ];
    expect(calculateWholesalePrice(1, tiers)).toBe(BigInt(100000));
    expect(calculateWholesalePrice(5, tiers)).toBe(BigInt(100000));
    expect(calculateWholesalePrice(10, tiers)).toBe(BigInt(90000));
    expect(calculateWholesalePrice(25, tiers)).toBe(BigInt(90000));
    expect(calculateWholesalePrice(50, tiers)).toBe(BigInt(80000));
    expect(calculateWholesalePrice(100, tiers)).toBe(BigInt(80000));
  });
});

describe("برند — انتخاب موجود یا جدید نیاز به بررسی", () => {
  it("برند موجود نیاز به بررسی ندارد", () => {
    const existing = [{ name: "Kolbe", slug: "kolbe" }];
    const result = validateBrandCreation("Kolbe", existing, "supplier");
    expect(result.isNew).toBe(false);
    expect(result.requiresReview).toBe(false);
  });

  it("برند جدید تأمین‌کننده نیاز به بررسی دارد", () => {
    const existing = [{ name: "Kolbe", slug: "kolbe" }];
    const result = validateBrandCreation("New Brand", existing, "supplier");
    expect(result.isNew).toBe(true);
    expect(result.requiresReview).toBe(true);
  });

  it("برند جدید ادمین نیاز به بررسی ندارد", () => {
    const existing = [{ name: "Kolbe", slug: "kolbe" }];
    const result = validateBrandCreation("New Brand", existing, "admin");
    expect(result.isNew).toBe(true);
    expect(result.requiresReview).toBe(false);
  });
});

describe("رتبه‌بندی جستجو — عوامل فروش/بازدید/امتیاز، اولویت کلبه", () => {
  it("کلبه اولویت دارد", () => {
    const base = {
      salesCount: 100,
      viewCount: 1000,
      conversionRate: 0.05,
      availability: 1,
      rating: 4.5,
    };
    const kolbeRank = calculateSearchRank({ ...base, isKolbe: true });
    const supplierRank = calculateSearchRank({ ...base, isKolbe: false });
    expect(kolbeRank).toBeGreaterThan(supplierRank);
  });

  it("رتبه بین 0 و 100 است", () => {
    const rank = calculateSearchRank({
      salesCount: 0,
      viewCount: 0,
      availability: 0,
      rating: 0,
      isKolbe: false,
    });
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThanOrEqual(100);
  });
});
