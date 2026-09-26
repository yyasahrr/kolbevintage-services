/**
 * هستهٔ خالصِ «ساختِ گرافِ محصول» — مستقل از مرورگر و قابلِ آزمون.
 *
 * قاعدهٔ حاکم: این ماژول **هیچ** محاسبهٔ پولیِ معتبر انجام نمی‌دهد و هیچ
 * اعتبارسنجیِ نهایی نیست. سرور مرجعِ نهایی است؛ اینجا فقط:
 *   ۱) وضعیتِ پیش‌نویسِ ویرایشگر را به قراردادِ کانونیکِ مرحله‌بندی‌شده نگاشت
 *      می‌کند (بدونِ تبدیلِ پنهان)،
 *   ۲) خطاهای بدیهی را پیش از ارسال نشان می‌دهد تا کاربر بازخوردِ سریع بگیرد،
 *   ۳) جمعِ قطعاتِ بسته را **فقط برای پیش‌نمایش** محاسبه می‌کند.
 *
 * پول همیشه رشتهٔ ده‌دهی است؛ هرگز `number`/`parseFloat` و هرگز حسابِ JS.
 */

import {
  MOQ_UNITS,
  PACKAGE_TYPES,
  type MoqUnit,
  type PackageType,
  type StagedCommercialInput,
  type StagedMediaInput,
  type StagedPackageInput,
  type StagedPricingTierInput,
  type StagedVariantInput,
  type SupplierStagedProductInput,
} from "./contracts";

/* ── وضعیتِ پیش‌نویسِ ویرایشگر ─────────────────────────────────────────────── */

/**
 * یک ردیفِ ویرایشگرِ واریانت.
 *
 * صفات در یک `Record` عمومی نگه داشته می‌شوند تا مدل به «مد/پوشاک» سخت‌کد
 * نشود: همان‌قدر که `size`/`color` ممکن است، `material`/`fit`/`eu_size` یا هر
 * صفتِ دامنهٔ دیگری هم مجاز است.
 */
export type DraftVariant = {
  /** شناسهٔ محلیِ ردیف (برای کلیدِ React)؛ هرگز ارسال نمی‌شود. */
  rowId: string;
  sku: string;
  attributes: Record<string, string>;
  status?: StagedVariantInput["status"];
  onHand?: number | null;
  imageUrl?: string;
  include: boolean;
};

export type DraftMedia = {
  rowId: string;
  url: string;
  type?: "image" | "video";
  /** SKU واریانت؛ تهی یعنی رسانهٔ سطحِ محصول. */
  variantSku?: string | null;
  include: boolean;
};

export type DraftPackage = {
  rowId: string;
  packageType: PackageType;
  name: string;
  description?: string;
  items: Array<{ sku: string; quantity: number }>;
  include: boolean;
};

export type DraftPricingTier = {
  rowId: string;
  minQuantity: number;
  /** `null` یعنی بدونِ سقف (بازهٔ باز). */
  maxQuantity: number | null;
  /** رشتهٔ ده‌دهی — هرگز عدد. */
  unitPrice: string;
  moqUnit?: MoqUnit;
  include: boolean;
};

export type DraftProduct = {
  name: string;
  slug: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  proposedBrandId?: string;
  attributes: Record<string, string>;
  variants: DraftVariant[];
  media: DraftMedia[];
  commercial: {
    sku: string;
    wholesalePrice: string;
    retailPrice?: string;
    currency?: string;
    moq: number;
    moqUnit: MoqUnit;
    packageType?: PackageType;
    variantSku?: string | null;
  } | null;
  packages: DraftPackage[];
  pricingTiers: DraftPricingTier[];
};

/* ── مسئلهٔ اعتبارسنجی ─────────────────────────────────────────────────────── */

export type DraftIssue = {
  /** کدِ مسئله — همان واژگانِ دامنهٔ سرور، تا پیام‌ها قابلِ نگاشت باشند. */
  code:
    | "NAME_REQUIRED"
    | "SLUG_REQUIRED"
    | "VARIANT_SKU_REQUIRED"
    | "DUPLICATE_VARIANT_SKU"
    | "INVALID_MEDIA_URL"
    | "MEDIA_VARIANT_NOT_FOUND"
    | "INVALID_INVENTORY_ON_HAND"
    | "INVALID_WHOLESALE_PRICE"
    | "INVALID_RETAIL_PRICE"
    | "INVALID_MOQ"
    | "INVALID_MOQ_UNIT"
    | "INVALID_PACKAGE_TYPE"
    | "INVALID_PRICING_RANGE"
    | "OVERLAPPING_PRICING_TIER"
    | "INVALID_TIER_PRICE"
    | "INVALID_PACKAGE_VARIANT"
    | "INVALID_PACKAGE_QUANTITY"
    | "SIZE_RUN_NEEDS_MULTIPLE_SIZES"
    | "FIXED_QUANTITY_SINGLE_VARIANT"
    | "INVALID_PACKAGE_NAME"
    | "COMMERCIAL_IN_ATTRIBUTES";
  field: string;
  message: string;
};

/** الگوی پول: رشتهٔ تمام‌رقم (همان `isDecimalMoney` سرور). */
export const DECIMAL_MONEY = /^\d+$/;

/**
 * فیلدهایی که در `attributes` سطحِ محصول **ممنوع** هستند.
 *
 * آینهٔ `COMMERCIAL_FIELDS_IN_ATTRIBUTES_FORBIDDEN` در `catalog.logic.ts`؛ اگر
 * سرور این فهرست را تغییر داد، اینجا هم باید تغییر کند.
 */
export const COMMERCIAL_FIELDS_FORBIDDEN_IN_ATTRIBUTES = [
  "sku",
  "wholesalePrice",
  "wholesale_price",
  "moq",
  "moqUnit",
  "moq_unit",
  "packageType",
  "package_type",
  "retailPrice",
  "retail_price",
  "commercial",
] as const;

/* ── نگاشت به قراردادِ کانونیک ─────────────────────────────────────────────── */

/**
 * ساختِ گرافِ کانونیکِ مرحله‌بندی‌شده از پیش‌نویس.
 *
 * «بدونِ تبدیلِ پنهان» یعنی هر آنچه صفحهٔ بازبینی نشان می‌دهد از همین خروجی
 * می‌آید و دقیقاً همین بدنه ارسال می‌شود. ردیف‌های `include: false` (واریانتی
 * که کاربر از ماتریس برداشته) حذف می‌شوند — و **هیچ** ترکیبِ پنهانی ساخته
 * نمی‌شود.
 */
export function buildStagedProduct(draft: DraftProduct): SupplierStagedProductInput {
  const variants = draft.variants.filter((variant) => variant.include);

  const stagedVariants: StagedVariantInput[] = variants.map((variant) => {
    const attributes: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(variant.attributes)) {
      if (key.trim().length > 0) attributes[key] = value;
    }
    const media = variant.imageUrl?.trim()
      ? [{ url: variant.imageUrl.trim(), type: "image" as const, position: 0 }]
      : undefined;
    const inventory =
      typeof variant.onHand === "number" && Number.isFinite(variant.onHand)
        ? { onHand: Math.trunc(variant.onHand) }
        : undefined;
    return {
      sku: variant.sku.trim().toUpperCase(),
      attributes,
      ...(variant.status ? { status: variant.status } : {}),
      ...(media ? { media } : {}),
      ...(inventory ? { inventory } : {}),
    };
  });

  const stagedMedia: StagedMediaInput[] = draft.media
    .filter((item) => item.include && item.url.trim().length > 0)
    .map((item, index) => ({
      url: item.url.trim(),
      ...(item.type ? { type: item.type } : {}),
      position: index,
      ...(item.variantSku ? { variantSku: item.variantSku.trim().toUpperCase() } : { variantSku: null }),
    }));

  let stagedCommercial: StagedCommercialInput | undefined;
  if (draft.commercial) {
    const packages: StagedPackageInput[] = draft.packages
      .filter((pkg) => pkg.include)
      .map((pkg) => ({
        packageType: pkg.packageType,
        name: pkg.name.trim(),
        ...(pkg.description?.trim() ? { description: pkg.description.trim() } : {}),
        items: pkg.items.map((item) => ({
          sku: item.sku.trim().toUpperCase(),
          quantity: Math.trunc(item.quantity),
        })),
      }));

    const pricingTiers: StagedPricingTierInput[] = draft.pricingTiers
      .filter((tier) => tier.include)
      .map((tier) => ({
        minQuantity: Math.trunc(tier.minQuantity),
        ...(tier.maxQuantity == null ? {} : { maxQuantity: Math.trunc(tier.maxQuantity) }),
        unitPrice: tier.unitPrice,
        ...(tier.moqUnit ? { moqUnit: tier.moqUnit } : {}),
      }));

    stagedCommercial = {
      sku: draft.commercial.sku.trim().toUpperCase(),
      wholesalePrice: draft.commercial.wholesalePrice,
      ...(draft.commercial.retailPrice ? { retailPrice: draft.commercial.retailPrice } : {}),
      ...(draft.commercial.currency ? { currency: draft.commercial.currency } : {}),
      moq: draft.commercial.moq,
      moqUnit: draft.commercial.moqUnit,
      ...(draft.commercial.packageType ? { packageType: draft.commercial.packageType } : {}),
      ...(draft.commercial.variantSku ? { variantSku: draft.commercial.variantSku.trim().toUpperCase() } : {}),
      ...(packages.length > 0 ? { packages } : {}),
      ...(pricingTiers.length > 0 ? { pricingTiers } : {}),
    };
  }

  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft.attributes)) {
    if (key.trim().length > 0) attributes[key] = value;
  }

  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    ...(draft.brandId ? { brandId: draft.brandId } : {}),
    ...(draft.proposedBrandId ? { proposedBrandId: draft.proposedBrandId } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    variants: stagedVariants,
    media: stagedMedia,
    ...(stagedCommercial ? { commercial: stagedCommercial } : {}),
  };
}

/* ── اعتبارسنجیِ پیش‌ازارسال (سرور مرجعِ نهایی است) ────────────────────────── */

/**
 * بررسیِ پیش‌ازارسال.
 *
 * این تابع **جایگزینِ** اعتبارسنجیِ سرور نیست؛ همان قواعد را زودتر نشان می‌دهد
 * تا کاربر پیش از یک رفت‌وبرگشتِ شبکه بداند مشکل کجاست.
 */
export function validateDraftProduct(draft: DraftProduct): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const push = (code: DraftIssue["code"], field: string, message: string) =>
    issues.push({ code, field, message });

  if (draft.name.trim().length === 0) push("NAME_REQUIRED", "name", "نام محصول الزامی است");
  if (draft.slug.trim().length === 0) push("SLUG_REQUIRED", "slug", "شناسهٔ یکتا (slug) الزامی است");

  for (const [key] of Object.entries(draft.attributes)) {
    if ((COMMERCIAL_FIELDS_FORBIDDEN_IN_ATTRIBUTES as readonly string[]).includes(key)) {
      push("COMMERCIAL_IN_ATTRIBUTES", `attributes.${key}`, "فیلد تجاری نباید در ویژگی‌های عمومی باشد");
    }
  }

  const variants = draft.variants.filter((variant) => variant.include);
  const skus = variants.map((variant) => variant.sku.trim().toUpperCase());
  variants.forEach((variant, index) => {
    if (skus[index]!.length === 0) {
      push("VARIANT_SKU_REQUIRED", `variants[${index}].sku`, "هر واریانت باید SKU غیرخالی داشته باشد");
    }
    if (variant.onHand != null && (!Number.isInteger(variant.onHand) || variant.onHand < 0)) {
      push("INVALID_INVENTORY_ON_HAND", `variants[${index}].onHand`, "موجودی باید عددِ صحیحِ نامنفی باشد");
    }
  });
  if (new Set(skus).size !== skus.length) {
    push("DUPLICATE_VARIANT_SKU", "variants", "SKU واریانت‌ها باید یکتا باشد");
  }
  const skuSet = new Set(skus);

  for (const [index, item] of draft.media.filter((entry) => entry.include).entries()) {
    if (item.url.trim().length === 0) {
      push("INVALID_MEDIA_URL", `media[${index}].url`, "نشانی رسانه نامعتبر است");
    }
    if (item.variantSku && !skuSet.has(item.variantSku.trim().toUpperCase())) {
      push("MEDIA_VARIANT_NOT_FOUND", `media[${index}].variantSku`, "رسانه به واریانتِ ناموجود ارجاع دارد");
    }
  }

  const commercial = draft.commercial;
  if (commercial) {
    if (!DECIMAL_MONEY.test(commercial.wholesalePrice)) {
      push("INVALID_WHOLESALE_PRICE", "commercial.wholesalePrice", "قیمت عمده باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
    if (commercial.retailPrice && !DECIMAL_MONEY.test(commercial.retailPrice)) {
      push("INVALID_RETAIL_PRICE", "commercial.retailPrice", "قیمت خرده باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
    if (!Number.isInteger(commercial.moq) || commercial.moq <= 0) {
      push("INVALID_MOQ", "commercial.moq", "حداقل تعداد سفارش باید عددِ صحیحِ مثبت باشد");
    }
    if (!MOQ_UNITS.includes(commercial.moqUnit)) {
      push("INVALID_MOQ_UNIT", "commercial.moqUnit", "واحدِ حداقل تعداد نامعتبر است");
    }
    if (commercial.packageType && !PACKAGE_TYPES.includes(commercial.packageType)) {
      push("INVALID_PACKAGE_TYPE", "commercial.packageType", "نوع بسته نامعتبر است");
    }
  }

  for (const [index, tier] of draft.pricingTiers.filter((entry) => entry.include).entries()) {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity <= 0) {
      push("INVALID_PRICING_RANGE", `pricingTiers[${index}].minQuantity`, "بازهٔ قیمت‌گذاری نامعتبر است");
    }
    if (tier.maxQuantity != null && (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < tier.minQuantity)) {
      push("INVALID_PRICING_RANGE", `pricingTiers[${index}].maxQuantity`, "بازهٔ قیمت‌گذاری نامعتبر است");
    }
    if (!DECIMAL_MONEY.test(tier.unitPrice)) {
      push("INVALID_TIER_PRICE", `pricingTiers[${index}].unitPrice`, "قیمتِ پله باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
  }
  const tiers = draft.pricingTiers.filter((entry) => entry.include);
  for (let i = 0; i < tiers.length; i += 1) {
    for (let j = i + 1; j < tiers.length; j += 1) {
      const a = tiers[i]!;
      const b = tiers[j]!;
      const aMax = a.maxQuantity ?? Number.POSITIVE_INFINITY;
      const bMax = b.maxQuantity ?? Number.POSITIVE_INFINITY;
      if (a.minQuantity <= bMax && b.minQuantity <= aMax) {
        push("OVERLAPPING_PRICING_TIER", `pricingTiers[${j}]`, "بازهٔ قیمت‌گذاری هم‌پوشان است");
      }
    }
  }

  for (const [index, pkg] of draft.packages.filter((entry) => entry.include).entries()) {
    if (pkg.name.trim().length === 0) {
      push("INVALID_PACKAGE_NAME", `packages[${index}].name`, "نام بسته الزامی است");
    }
    if (pkg.items.some((item) => !skuSet.has(item.sku.trim().toUpperCase()))) {
      push("INVALID_PACKAGE_VARIANT", `packages[${index}].items`, "واریانتِ بسته متعلق به این محصول نیست");
    }
    if (pkg.items.length === 0 || pkg.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      push("INVALID_PACKAGE_QUANTITY", `packages[${index}].items`, "بسته باید حداقل یک قلم با تعداد مثبت داشته باشد");
    }
    if (pkg.packageType === "SIZE_RUN" && pkg.items.length < 2) {
      push("SIZE_RUN_NEEDS_MULTIPLE_SIZES", `packages[${index}]`, "بستهٔ سایز-ران باید حداقل ۲ سایز داشته باشد");
    }
    if (pkg.packageType === "FIXED_QUANTITY" && new Set(pkg.items.map((item) => item.sku.trim().toUpperCase())).size !== 1) {
      push("FIXED_QUANTITY_SINGLE_VARIANT", `packages[${index}]`, "بستهٔ تعداد ثابت باید فقط یک واریانت داشته باشد");
    }
  }

  return issues;
}

/* ── ماتریسِ واریانت (نمایش) ───────────────────────────────────────────────── */

export type VariantMatrixCell = {
  /** `true` فقط اگر کاربر این ترکیب را **صریحاً** انتخاب کرده باشد. */
  selected: boolean;
  variant: DraftVariant | null;
};

export type VariantMatrix = {
  rowKey: string;
  columnKey: string;
  rows: string[];
  columns: string[];
  /** `[row][column]` */
  cells: VariantMatrixCell[][];
};

/**
 * ساختِ ماتریسِ نمایشی از واریانت‌های **موجود**.
 *
 * این تابع هرگز واریانتِ تازه نمی‌سازد: فقط آنچه کاربر ساخته را روی یک شبکه
 * می‌چیند. ساختِ واریانت از راهِ `toggleMatrixCell` و به‌صورتِ صریح است، پس
 * «ترکیبِ پنهانی که کاربر انتخاب نکرده» ساخته نمی‌شود.
 */
export function buildVariantMatrix(
  variants: DraftVariant[],
  rowKey: string,
  columnKey: string,
): VariantMatrix {
  const rows = uniquePreservingOrder(
    variants.map((variant) => variant.attributes[rowKey] ?? "").filter((value) => value.length > 0),
  );
  const columns = uniquePreservingOrder(
    variants.map((variant) => variant.attributes[columnKey] ?? "").filter((value) => value.length > 0),
  );

  const cells = rows.map((row) =>
    columns.map((column) => {
      const variant =
        variants.find(
          (entry) => entry.attributes[rowKey] === row && entry.attributes[columnKey] === column,
        ) ?? null;
      return { selected: variant != null && variant.include, variant } satisfies VariantMatrixCell;
    }),
  );

  return { rowKey, columnKey, rows, columns, cells };
}

/**
 * SKU **پیشنهادی** برای یک خانهٔ ماتریس.
 *
 * فقط ASCIIِ SKU-امن نگه داشته می‌شود. در یک محصولِ فارسی‌زبان ممکن است
 * پیشوند/ردیف/ستون هیچ بخشِ ASCII ای نداشته باشند؛ در آن صورت بخش‌های خالی
 * حذف می‌شوند تا SKUِ degenerate (مثل `--FREE`) ساخته نشود. اگر نتیجه خالی شد،
 * کاربر باید SKU را خودش وارد کند — این تابع هرگز SKU جعلی نمی‌سازد.
 */
export function matrixCellSku(prefix: string, row: string, column: string): string {
  const clean = (value: string) =>
    value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return [clean(prefix), clean(row), clean(column)].filter((part) => part.length > 0).join("-");
}

/* ── ابزارها ──────────────────────────────────────────────────────────────── */

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * جمعِ قطعاتِ یک بسته — **فقط برای پیش‌نمایشِ UI**.
 *
 * مرجعِ معتبر `calculatePackageTotalPieces` در سرور است و `wholesale_package.total_pieces`
 * از آن نوشته می‌شود. اگر این دو اختلاف داشتند، سرور برنده است.
 */
export function previewPackageTotalPieces(items: Array<{ quantity: number }>): number {
  return items.reduce((total, item) => total + (Number.isFinite(item.quantity) ? Math.trunc(item.quantity) : 0), 0);
}

/** برچسبِ فارسیِ واحدِ MOQ؛ مقدارِ کانونیک در قرارداد می‌ماند. */
export const MOQ_UNIT_LABELS_FA: Record<MoqUnit, string> = {
  PIECE: "عدد",
  PACKAGE: "بسته",
  SERIES: "سری",
  BOX: "جعبه",
  CARTON: "کارتن",
  SET: "ست",
};

/** برچسبِ فارسیِ نوعِ بسته. */
export const PACKAGE_TYPE_LABELS_FA: Record<PackageType, string> = {
  SIZE_RUN: "سری سایزبندی",
  FIXED_QUANTITY: "تعداد ثابت",
  COLOR_MIX: "ترکیب رنگ",
  CUSTOM_BUNDLE: "بستهٔ دلخواه",
};
