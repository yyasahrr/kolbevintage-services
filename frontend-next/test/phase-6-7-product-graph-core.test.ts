/**
 * آزمونِ هستهٔ خالصِ ساختِ گرافِ محصولِ تأمین‌کننده.
 *
 * این ماژول مستقل از مرورگر است، پس آزمونش هم DOM نمی‌خواهد. هدف: اثباتِ اینکه
 * «آنچه ویرایشگر می‌سازد» دقیقاً قراردادِ کانونیکِ مرحله‌بندی‌شده است و هیچ
 * تبدیلِ پنهانی رخ نمی‌دهد — و اینکه هیچ ترکیبِ پنهانی ساخته نمی‌شود.
 */

import { describe, expect, it } from "vitest";
import {
  buildStagedProduct,
  buildVariantMatrix,
  matrixCellSku,
  previewPackageTotalPieces,
  validateDraftProduct,
  MOQ_UNIT_LABELS_FA,
  PACKAGE_TYPE_LABELS_FA,
  type DraftProduct,
} from "../shared/supplier/product-graph";
import { MOQ_UNITS, PACKAGE_TYPES } from "../shared/supplier/contracts";

let rowCounter = 0;
const rowId = (prefix: string) => `${prefix}-${(rowCounter += 1)}`;

function linenShirtDraft(): DraftProduct {
  const variant = (color: string, size: string, onHand: number) => ({
    rowId: rowId("var"),
    sku: `LINEN-${color}-${size}`,
    attributes: { color, size, material: "لینن" },
    status: "active" as const,
    onHand,
    include: true,
  });
  return {
    name: "پیراهن لینن آزمایشی",
    slug: "linen-shirt",
    description: "پیراهن لینن سبک",
    categoryId: "cat_1",
    brandId: "brn_1",
    attributes: { material: "لینن", fit: "regular" },
    variants: [
      variant("BLACK", "S", 40),
      variant("BLACK", "M", 60),
      variant("BLACK", "L", 20),
    ],
    media: [
      { rowId: rowId("m"), url: "https://cdn.kolbe.test/main.jpg", include: true },
      { rowId: rowId("m"), url: "https://cdn.kolbe.test/black-s.jpg", variantSku: "LINEN-BLACK-S", include: true },
    ],
    commercial: {
      sku: "LINEN-SHIRT",
      wholesalePrice: "1250000",
      retailPrice: "1890000",
      currency: "IRR",
      moq: 2,
      moqUnit: "SERIES",
      packageType: "SIZE_RUN",
    },
    packages: [
      {
        rowId: rowId("pkg"),
        packageType: "SIZE_RUN",
        name: "سری سایزبندی S-L",
        items: [
          { sku: "LINEN-BLACK-S", quantity: 2 },
          { sku: "LINEN-BLACK-M", quantity: 2 },
          { sku: "LINEN-BLACK-L", quantity: 2 },
        ],
        include: true,
      },
    ],
    pricingTiers: [
      { rowId: rowId("t"), minQuantity: 2, maxQuantity: 9, unitPrice: "1250000", moqUnit: "SERIES", include: true },
      { rowId: rowId("t"), minQuantity: 10, maxQuantity: 49, unitPrice: "1180000", moqUnit: "SERIES", include: true },
      { rowId: rowId("t"), minQuantity: 50, maxQuantity: null, unitPrice: "1090000", moqUnit: "SERIES", include: true },
    ],
  };
}

describe("buildStagedProduct — نگاشت به قراردادِ کانونیک", () => {
  it("produces the canonical staged graph with no hidden transformation", () => {
    const staged = buildStagedProduct(linenShirtDraft());

    expect(staged.name).toBe("پیراهن لینن آزمایشی");
    expect(staged.slug).toBe("linen-shirt");
    expect(staged.categoryId).toBe("cat_1");
    expect(staged.brandId).toBe("brn_1");
    expect(staged.attributes).toEqual({ material: "لینن", fit: "regular" });

    expect(staged.variants).toHaveLength(3);
    expect(staged.variants[0]).toMatchObject({
      sku: "LINEN-BLACK-S",
      attributes: { color: "BLACK", size: "S", material: "لینن" },
      status: "active",
      inventory: { onHand: 40 },
    });

    expect(staged.media).toHaveLength(2);
    expect(staged.media[0]).toMatchObject({ url: "https://cdn.kolbe.test/main.jpg", variantSku: null });
    expect(staged.media[1]).toMatchObject({ url: "https://cdn.kolbe.test/black-s.jpg", variantSku: "LINEN-BLACK-S" });

    const commercial = staged.commercial!;
    expect(commercial.sku).toBe("LINEN-SHIRT");
    // پول رشته می‌ماند — هرگز عدد نمی‌شود.
    expect(commercial.wholesalePrice).toBe("1250000");
    expect(typeof commercial.wholesalePrice).toBe("string");
    expect(commercial.retailPrice).toBe("1890000");
    expect(commercial.currency).toBe("IRR");
    expect(commercial.moq).toBe(2);
    expect(commercial.moqUnit).toBe("SERIES");
    expect(commercial.packageType).toBe("SIZE_RUN");

    // بسته‌ها و پله‌ها داخلِ commercial مرحله‌بندی می‌شوند (پیش از تأیید offerId نیست).
    expect(commercial.packages).toHaveLength(1);
    expect(commercial.packages![0]!.items).toEqual([
      { sku: "LINEN-BLACK-S", quantity: 2 },
      { sku: "LINEN-BLACK-M", quantity: 2 },
      { sku: "LINEN-BLACK-L", quantity: 2 },
    ]);
    expect(commercial.pricingTiers).toHaveLength(3);
    // بازهٔ باز: `maxQuantity` نباید ظاهر شود (نه صفر، نه null).
    expect(commercial.pricingTiers![2]).toEqual({ minQuantity: 50, unitPrice: "1090000", moqUnit: "SERIES" });
    expect("maxQuantity" in commercial.pricingTiers![2]!).toBe(false);
  });

  it("excluded variants and media are omitted — and nothing invented in their place", () => {
    const draft = linenShirtDraft();
    draft.variants[2]!.include = false;
    draft.media[1]!.include = false;
    draft.pricingTiers[2]!.include = false;

    const staged = buildStagedProduct(draft);
    expect(staged.variants.map((variant) => variant.sku)).toEqual(["LINEN-BLACK-S", "LINEN-BLACK-M"]);
    expect(staged.media).toHaveLength(1);
    expect(staged.commercial!.pricingTiers).toHaveLength(2);
  });

  it("omits optional sections entirely rather than sending empty placeholders", () => {
    const draft = linenShirtDraft();
    draft.commercial = null;
    draft.packages = [];
    draft.pricingTiers = [];
    draft.media = [];
    draft.attributes = {};
    draft.description = "";

    const staged = buildStagedProduct(draft);
    expect("commercial" in staged).toBe(false);
    expect("description" in staged).toBe(false);
    expect("attributes" in staged).toBe(false);
    expect(staged.media).toEqual([]);
  });

  it("omits inventory when the supplier entered nothing (never invents zero stock)", () => {
    const draft = linenShirtDraft();
    draft.variants[0]!.onHand = null;
    const staged = buildStagedProduct(draft);
    expect("inventory" in staged.variants[0]!).toBe(false);
  });

  it("normalises SKU casing so client and server agree", () => {
    const draft = linenShirtDraft();
    draft.variants[0]!.sku = "linen-black-s";
    draft.media[1]!.variantSku = "linen-black-s";
    draft.packages[0]!.items[0]!.sku = "linen-black-s";
    const staged = buildStagedProduct(draft);
    expect(staged.variants[0]!.sku).toBe("LINEN-BLACK-S");
    expect(staged.media[1]!.variantSku).toBe("LINEN-BLACK-S");
    expect(staged.commercial!.packages![0]!.items[0]!.sku).toBe("LINEN-BLACK-S");
  });
});

describe("validateDraftProduct — بازخوردِ پیش‌ازارسال", () => {
  const codes = (draft: DraftProduct) => validateDraftProduct(draft).map((issue) => issue.code);

  it("accepts the rich linen-shirt draft with no issues", () => {
    expect(validateDraftProduct(linenShirtDraft())).toEqual([]);
  });

  it("flags duplicate and empty variant SKUs", () => {
    const draft = linenShirtDraft();
    draft.variants[1]!.sku = draft.variants[0]!.sku;
    expect(codes(draft)).toContain("DUPLICATE_VARIANT_SKU");

    const empty = linenShirtDraft();
    empty.variants[0]!.sku = "   ";
    expect(codes(empty)).toContain("VARIANT_SKU_REQUIRED");
  });

  it("flags non-decimal money instead of doing JS arithmetic on it", () => {
    const draft = linenShirtDraft();
    draft.commercial!.wholesalePrice = "12.5";
    expect(codes(draft)).toContain("INVALID_WHOLESALE_PRICE");

    const tier = linenShirtDraft();
    tier.pricingTiers[0]!.unitPrice = "1180000.5";
    expect(codes(tier)).toContain("INVALID_TIER_PRICE");
  });

  it("flags overlapping pricing tiers", () => {
    const draft = linenShirtDraft();
    draft.pricingTiers[1]!.minQuantity = 5;
    expect(codes(draft)).toContain("OVERLAPPING_PRICING_TIER");
  });

  it("flags an inverted tier range", () => {
    const draft = linenShirtDraft();
    draft.pricingTiers[0]!.maxQuantity = 1;
    expect(codes(draft)).toContain("INVALID_PRICING_RANGE");
  });

  it("flags a package referencing a variant that is not in the product", () => {
    const draft = linenShirtDraft();
    draft.packages[0]!.items[0]!.sku = "GHOST-SKU";
    expect(codes(draft)).toContain("INVALID_PACKAGE_VARIANT");
  });

  it("flags SIZE_RUN with a single size and FIXED_QUANTITY with two variants", () => {
    const sizeRun = linenShirtDraft();
    sizeRun.packages[0]!.items = [{ sku: "LINEN-BLACK-S", quantity: 2 }];
    expect(codes(sizeRun)).toContain("SIZE_RUN_NEEDS_MULTIPLE_SIZES");

    const fixed = linenShirtDraft();
    fixed.packages[0]!.packageType = "FIXED_QUANTITY";
    expect(codes(fixed)).toContain("FIXED_QUANTITY_SINGLE_VARIANT");
  });

  it("flags zero/negative package quantity and a missing package name", () => {
    const zero = linenShirtDraft();
    zero.packages[0]!.items[0]!.quantity = 0;
    expect(codes(zero)).toContain("INVALID_PACKAGE_QUANTITY");

    const unnamed = linenShirtDraft();
    unnamed.packages[0]!.name = "  ";
    expect(codes(unnamed)).toContain("INVALID_PACKAGE_NAME");
  });

  it("flags negative inventory", () => {
    const draft = linenShirtDraft();
    draft.variants[0]!.onHand = -5;
    expect(codes(draft)).toContain("INVALID_INVENTORY_ON_HAND");
  });

  it("flags media pointing at a variant that does not exist", () => {
    const draft = linenShirtDraft();
    draft.media[1]!.variantSku = "GHOST-SKU";
    expect(codes(draft)).toContain("MEDIA_VARIANT_NOT_FOUND");
  });

  it("refuses commercial fields smuggled into product attributes", () => {
    const draft = linenShirtDraft();
    draft.attributes = { ...draft.attributes, sku: "SNEAKY" };
    expect(codes(draft)).toContain("COMMERCIAL_IN_ATTRIBUTES");
  });

  it("ignores an excluded variant's own defects (a disabled row cannot block submit)", () => {
    const draft = linenShirtDraft();
    // یک واریانتِ اضافه با موجودیِ نامعتبر که کاربر غیرفعالش کرده و هیچ بسته‌ای
    // هم به آن ارجاع نمی‌دهد — نباید مانعِ ارسال شود.
    draft.variants.push({
      rowId: rowId("var"),
      sku: "LINEN-BLACK-XL",
      attributes: { color: "BLACK", size: "XL", material: "لینن" },
      onHand: -5,
      include: false,
    });
    expect(validateDraftProduct(draft)).toEqual([]);
  });

  it("still rejects a package that references a variant the user excluded", () => {
    // این یک خطای واقعی است: بسته به واریانتی ارجاع دارد که ارسال نمی‌شود.
    const draft = linenShirtDraft();
    draft.variants[1]!.include = false;
    expect(codes(draft)).toContain("INVALID_PACKAGE_VARIANT");
  });
});

describe("buildVariantMatrix — نمایش بدونِ ساختِ ترکیبِ پنهان", () => {
  it("lays existing variants onto a grid without inventing new ones", () => {
    const draft = linenShirtDraft();
    const matrix = buildVariantMatrix(draft.variants, "color", "size");

    expect(matrix.rows).toEqual(["BLACK"]);
    expect(matrix.columns).toEqual(["S", "M", "L"]);
    expect(matrix.cells).toHaveLength(1);
    expect(matrix.cells[0]).toHaveLength(3);
    expect(matrix.cells[0]!.every((cell) => cell.selected && cell.variant != null)).toBe(true);
  });

  it("marks an unselected cell as not selected and creates no variant for it", () => {
    const draft = linenShirtDraft();
    draft.variants[1]!.include = false;
    const matrix = buildVariantMatrix(draft.variants, "color", "size");

    // ستون‌ها از همهٔ ردیف‌ها مشتق می‌شوند، پس M دیده می‌شود اما انتخاب‌نشده است.
    expect(matrix.columns).toContain("M");
    const mCell = matrix.cells[0]![1]!;
    expect(mCell.selected).toBe(false);
    // شمارِ واریانت‌ها تغییر نکرده — ماتریس چیزی نساخته است.
    expect(draft.variants).toHaveLength(3);
  });

  it("supports multiple colours as separate rows", () => {
    const draft = linenShirtDraft();
    draft.variants.push({
      rowId: rowId("var"),
      sku: "LINEN-CREAM-S",
      attributes: { color: "CREAM", size: "S", material: "لینن" },
      onHand: 10,
      include: true,
    });
    const matrix = buildVariantMatrix(draft.variants, "color", "size");
    expect(matrix.rows).toEqual(["BLACK", "CREAM"]);
    expect(matrix.cells[1]![0]!.selected).toBe(true);
    expect(matrix.cells[1]![1]!.selected).toBe(false);
    expect(matrix.cells[1]![1]!.variant).toBeNull();
  });

  it("derives a stable SKU for a matrix cell", () => {
    expect(matrixCellSku("linen", "black", "s")).toBe("LINEN-BLACK-S");
    // ورودیِ کاملاً فارسی: بخش‌های خالی حذف می‌شوند تا SKUِ degenerate نسازیم.
    expect(matrixCellSku("کیف", "قهوه ای", "free")).toBe("FREE");
    expect(matrixCellSku("کیف", "قهوه ای", "فری")).toBe("");
  });
});

describe("previewPackageTotalPieces — فقط پیش‌نمایش", () => {
  it("sums integer quantities for the UI preview", () => {
    expect(previewPackageTotalPieces([{ quantity: 2 }, { quantity: 2 }, { quantity: 2 }])).toBe(6);
    expect(previewPackageTotalPieces([])).toBe(0);
  });
});

describe("برچسب‌های فارسی", () => {
  it("covers every canonical MOQ unit and package type", () => {
    expect(Object.keys(MOQ_UNIT_LABELS_FA).sort()).toEqual([...MOQ_UNITS].sort());
    expect(Object.keys(PACKAGE_TYPE_LABELS_FA).sort()).toEqual([...PACKAGE_TYPES].sort());
    expect(MOQ_UNIT_LABELS_FA.SERIES).toBe("سری");
    expect(PACKAGE_TYPE_LABELS_FA.SIZE_RUN).toBe("سری سایزبندی");
  });
});
