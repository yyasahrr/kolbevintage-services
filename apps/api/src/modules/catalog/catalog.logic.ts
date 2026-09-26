/**
 * منطق خالص بازار کاتالوگ — قابل آزمون بدون دیتابیس.
 *
 * قوانین کسب‌وکار فاز ۳:
 * - خرده‌فروشی فقط کلبه (Retail = Kolbe only)
 * - عمده = کلبه + تأمین‌کننده (Wholesale = Kolbe+Supplier برای VIP/بوتیک)
 * - مدل فروشنده KOLBE (خرده+عمده، بدون کمیسیون، اولویت) در برابر SUPPLIER (فقط عمده)
 * - معماری محصول کانونیکال → پیشنهادهای فروشنده (Kolbe Offer + Supplier Offers)
 * - Kolbe Exclusive owner_type=KOLBE محافظت‌شده، بدون پیشنهاد تأمین‌کننده
 * - چرخهٔ حیات DRAFT→PENDING_REVIEW→APPROVED→PUBLISHED→SUSPENDED با کنترل ادمین
 * - دسته‌بندی عمومی با attributes_schema JSON
 */

import {
  SELLER_TYPES,
  PRODUCT_STATUSES,
  OFFER_STATUSES,
  PACKAGE_TYPES,
  MOQ_UNITS,
  BRAND_VERIFICATION_STATUSES,
} from "@kolbe/database";

export type Role = "customer" | "vip" | "supplier" | "admin";

export type ProductInput = {
  name: string;
  slug: string;
  brandId?: string | null;
  categoryId?: string | null;
  ownerType: (typeof SELLER_TYPES)[number];
  isKolbeExclusive: boolean;
  status?: (typeof PRODUCT_STATUSES)[number];
};

export type OfferInput = {
  productId: string;
  sellerType: (typeof SELLER_TYPES)[number];
  productIsKolbeExclusive: boolean;
  retailPrice?: bigint | null;
  wholesalePrice: bigint;
  moq: number;
  moqUnit: (typeof MOQ_UNITS)[number];
  packageType?: (typeof PACKAGE_TYPES)[number] | null;
};

export type WholesalePackageItemInput = {
  variantId: string;
  quantity: number;
};

export type WholesalePackageInput = {
  offerId: string;
  packageType: (typeof PACKAGE_TYPES)[number];
  name: string;
  totalPieces: number;
  items: WholesalePackageItemInput[];
};

export class CatalogDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogDomainError";
  }
}

/**
 * قانون: تأمین‌کننده نمی‌تواند محصول با مالک کلبه بسازد.
 * Retail = Kolbe only → supplier forbidden retail.
 */
export function assertProductOwnership(
  role: Role,
  input: ProductInput,
): void {
  if (role === "supplier") {
    if (input.ownerType !== "SUPPLIER") {
      throw new CatalogDomainError(
        "SUPPLIER_CANNOT_CREATE_KOLBE_PRODUCT",
        "تأمین‌کننده نمی‌تواند محصول با مالک کلبه بسازد",
      );
    }
    if (input.isKolbeExclusive) {
      throw new CatalogDomainError(
        "SUPPLIER_CANNOT_CREATE_EXCLUSIVE",
        "تأمین‌کننده نمی‌تواند محصول انحصاری کلبه بسازد",
      );
    }
    // supplier cannot create retail product (status published with retail intent)
    // در فاز ۳، هر محصول کانونیکال که owner_type=SUPPLIER باشد، فقط عمده است.
    // اگر کسی بخواهد مستقیم retail_price بدهد، در لایهٔ offer رد می‌شود.
  }

  if (input.isKolbeExclusive && input.ownerType !== "KOLBE") {
    throw new CatalogDomainError(
      "EXCLUSIVE_MUST_BE_KOLBE",
      "محصول انحصاری فقط می‌تواند مالک کلبه داشته باشد",
    );
  }

  if (!SELLER_TYPES.includes(input.ownerType as any)) {
    throw new CatalogDomainError("INVALID_OWNER_TYPE", "نوع مالک نامعتبر است");
  }
}

/**
 * قانون: محصول انحصاری کلبه نمی‌تواند پیشنهاد تأمین‌کننده دریافت کند.
 */
export function assertOfferAllowedForProduct(
  input: OfferInput,
): void {
  if (input.productIsKolbeExclusive && input.sellerType === "SUPPLIER") {
    throw new CatalogDomainError(
      "KOLBE_EXCLUSIVE_NO_SUPPLIER_OFFER",
      "محصول انحصاری کلبه نمی‌تواند پیشنهاد تأمین‌کننده داشته باشد",
    );
  }

  // Retail = Kolbe only: تأمین‌کننده نمی‌تواند retail_price داشته باشد
  if (input.sellerType === "SUPPLIER" && input.retailPrice != null) {
    throw new CatalogDomainError(
      "SUPPLIER_CANNOT_SELL_RETAIL",
      "تأمین‌کننده فقط عمده می‌فروشد، خرده‌فروشی فقط کلبه",
    );
  }

  // KOLBE can have both retail and wholesale, no commission, priority
  // SUPPLIER only wholesale — enforced above

  if (!MOQ_UNITS.includes(input.moqUnit as any)) {
    throw new CatalogDomainError("INVALID_MOQ_UNIT", "واحد MOQ نامعتبر است");
  }

  if (input.packageType && !PACKAGE_TYPES.includes(input.packageType as any)) {
    throw new CatalogDomainError("INVALID_PACKAGE_TYPE", "نوع بستهٔ عمده نامعتبر است");
  }

  if (input.moq <= 0) {
    throw new CatalogDomainError("INVALID_MOQ", "حداقل سفارش باید مثبت باشد");
  }
}

/**
 * چرخهٔ حیات محصول: فقط ادمین می‌تواند تأیید/انتشار/تعلیق کند.
 * DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED → SUSPENDED
 * تأمین‌کننده فقط می‌تواند DRAFT و PENDING_REVIEW بسازد.
 */
export function assertProductStatusTransition(
  current: (typeof PRODUCT_STATUSES)[number],
  next: (typeof PRODUCT_STATUSES)[number],
  role: Role,
): void {
  const allowedTransitions: Record<string, string[]> = {
    draft: ["pending_review", "archived"],
    pending_review: ["approved", "suspended", "archived"],
    approved: ["published", "suspended", "archived"],
    published: ["suspended", "archived"],
    suspended: ["approved", "archived"],
    archived: [],
  };

  if (!allowedTransitions[current]?.includes(next)) {
    throw new CatalogDomainError(
      "INVALID_STATUS_TRANSITION",
      `انتقال وضعیت از ${current} به ${next} مجاز نیست`,
    );
  }

  // فقط ادمین می‌تواند تأیید/انتشار/تعلیق کند
  const adminOnly = ["approved", "published", "suspended"];
  if (adminOnly.includes(next) && role !== "admin") {
    throw new CatalogDomainError(
      "ADMIN_ONLY_TRANSITION",
      `انتقال به ${next} فقط با نقش ادمین ممکن است`,
    );
  }
}

/**
 * محاسبهٔ بستهٔ عمده — مثال SIZE_RUN
 * مثلاً یک بسته شامل S:2, M:2, L:2 → total 6
 */
export function calculatePackageTotalPieces(items: WholesalePackageItemInput[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function validateWholesalePackage(input: WholesalePackageInput): void {
  if (!PACKAGE_TYPES.includes(input.packageType as any)) {
    throw new CatalogDomainError("INVALID_PACKAGE_TYPE", "نوع بسته نامعتبر است");
  }

  if (input.items.length === 0 || input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    throw new CatalogDomainError("INVALID_PACKAGE_QUANTITY", "بسته باید حداقل یک قلم با تعداد مثبت داشته باشد");
  }

  const calculated = calculatePackageTotalPieces(input.items);
  if (input.totalPieces !== calculated) {
    throw new CatalogDomainError(
      "PACKAGE_TOTAL_MISMATCH",
      `مجموع قطعات بسته (${calculated}) با total_pieces (${input.totalPieces}) هم‌خوانی ندارد`,
    );
  }

  // مثال‌ها:
  // SIZE_RUN: باید چند سایز مختلف داشته باشد
  // FIXED_QUANTITY: همهٔ آیتم‌ها یک واریانت
  // COLOR_MIX: چند رنگ
  // CUSTOM_BUNDLE: آزاد

  if (input.packageType === "SIZE_RUN" && input.items.length < 2) {
    throw new CatalogDomainError(
      "SIZE_RUN_NEEDS_MULTIPLE_SIZES",
      "بستهٔ سایز-ران باید حداقل ۲ سایز داشته باشد",
    );
  }

  if (input.packageType === "FIXED_QUANTITY") {
    const variantIds = new Set(input.items.map((i) => i.variantId));
    if (variantIds.size !== 1) {
      throw new CatalogDomainError(
        "FIXED_QUANTITY_SINGLE_VARIANT",
        "بستهٔ تعداد ثابت باید فقط یک واریانت داشته باشد",
      );
    }
  }
}

/**
 * تشخیص تکراری — موتور تطبیق
 * Supplier draft → Matching → Admin review → Attach Offer or Create Canonical, no auto-merge
 */
export type ProductCandidate = {
  id: string;
  name: string;
  slug: string;
  brandId?: string | null;
  categoryId?: string | null;
};

export function findDuplicateCandidates(
  newProduct: { name: string; slug: string; brandId?: string | null; categoryId?: string | null },
  existing: ProductCandidate[],
): ProductCandidate[] {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const newName = normalize(newProduct.name);
  const newSlug = normalize(newProduct.slug);

  return existing.filter((candidate) => {
    const candidateName = normalize(candidate.name);
    const candidateSlug = normalize(candidate.slug);

    // تطبیق دقیق slug یا نام + برند + دسته
    const slugMatch = candidateSlug === newSlug;
    const nameMatch = candidateName === newName;

    const brandMatch =
      !newProduct.brandId || !candidate.brandId ? true : newProduct.brandId === candidate.brandId;

    const categoryMatch =
      !newProduct.categoryId || !candidate.categoryId
        ? true
        : newProduct.categoryId === candidate.categoryId;

    // اگر slug یکی باشد، حتماً کاندید است
    // یا اگر نام یکی و برند و دسته هم یکی باشند
    return slugMatch || (nameMatch && brandMatch && categoryMatch);
  });
}

/**
 * محاسبهٔ قیمت با توجه به تیرهای عمده
 * مثال: 1 بسته = 100,000، 10 بسته = 90,000، 50 بسته = 80,000
 */
export type PricingTier = {
  minQuantity: number;
  maxQuantity?: number | null;
  unitPrice: bigint;
  moqUnit: (typeof MOQ_UNITS)[number];
};

export function calculateWholesalePrice(
  quantity: number,
  tiers: PricingTier[],
): bigint {
  if (tiers.length === 0) throw new CatalogDomainError("NO_PRICING_TIERS", "هیچ تیر قیمتی تعریف نشده است");

  // مرتب‌سازی بر اساس minQuantity صعودی
  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);

  // پیدا کردن تیر مناسب: بزرگ‌ترین minQuantity که <= quantity
  let matched = sorted[0];
  for (const tier of sorted) {
    if (quantity >= tier.minQuantity) {
      if (tier.maxQuantity == null || quantity <= tier.maxQuantity) {
        matched = tier;
      } else if (quantity > tier.maxQuantity) {
        matched = tier; // اگر از max گذشت، باز هم همین تیر تا تیر بعدی
        continue;
      }
    }
  }

  // اگر quantity از همهٔ minها بزرگ‌تر باشد، آخرین تیر
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (quantity >= sorted[i].minQuantity) {
      matched = sorted[i];
      break;
    }
  }

  return matched.unitPrice;
}

/**
 * Phase 3.9.1 — explicit commercial separation: attributes must NOT contain commercial fields
 * Catalog attributes vs commercial terms must be separate.
 */
export const COMMERCIAL_FIELDS_IN_ATTRIBUTES_FORBIDDEN = [
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

export function assertSubmissionSeparation(input: {
  attributes?: Record<string, unknown> | null;
  commercial?: Record<string, unknown> | null;
}): void {
  const attrs = (input.attributes ?? {}) as Record<string, unknown>;
  for (const field of COMMERCIAL_FIELDS_IN_ATTRIBUTES_FORBIDDEN) {
    if (field in attrs) {
      throw new CatalogDomainError(
        "COMMERCIAL_IN_ATTRIBUTES",
        `فیلد تجاری «${field}» نباید در attributes عمومی باشد — باید در commercial جدا باشد`,
      );
    }
  }
}

/**
 * برند: تأمین‌کننده می‌تواند موجود را انتخاب کند یا جدید وارد کند که نیاز به بررسی دارد
 */
export function validateBrandCreation(
  name: string,
  existingBrands: Array<{ name: string; slug: string }>,
  role: Role,
): { isNew: boolean; requiresReview: boolean } {
  const normalize = (s: string) => s.trim().toLowerCase();
  const normalizedName = normalize(name);
  const exists = existingBrands.some((b) => normalize(b.name) === normalizedName);

  if (exists) {
    return { isNew: false, requiresReview: false };
  }

  // برند جدید نیاز به بررسی دارد، مگر اینکه ادمین بسازد
  return {
    isNew: true,
    requiresReview: role !== "admin",
  };
}

/**
 * جستجو/رتبه‌بندی پایه — عوامل: فروش/بازدید/تبدیل/پاسخ/موجودی/امتیاز، اولویت کلبه قابل توسعه
 */
export type RankingFactors = {
  salesCount: number;
  viewCount: number;
  conversionRate?: number; // 0..1
  responseTimeHours?: number; // supplier response
  availability: number; // 0..1 موجودی
  rating: number; // 0..5
  isKolbe: boolean;
};

export function calculateSearchRank(factors: RankingFactors): number {
  // وزن‌ها — قابل توسعه
  const weights = {
    sales: 0.3,
    views: 0.1,
    conversion: 0.2,
    response: 0.1,
    availability: 0.15,
    rating: 0.15,
  };

  const normalizedSales = Math.log10(factors.salesCount + 1) / 5; // log scale
  const normalizedViews = Math.log10(factors.viewCount + 1) / 6;
  const conversion = factors.conversionRate ?? 0;
  const responseScore = factors.responseTimeHours != null ? Math.max(0, 1 - factors.responseTimeHours / 48) : 0.5;
  const availability = factors.availability;
  const rating = factors.rating / 5;

  let score =
    normalizedSales * weights.sales +
    normalizedViews * weights.views +
    conversion * weights.conversion +
    responseScore * weights.response +
    availability * weights.availability +
    rating * weights.rating;

  // اولویت کلبه
  if (factors.isKolbe) {
    score *= 1.2; // 20% boost for Kolbe
  }

  // مقیاس 0..100
  return Math.round(score * 100);
}

/* ── گرافِ تجاریِ مرحله‌بندی‌شده در پیشنهادِ تأمین‌کننده ────────────────────────
 * ظرفیتِ مرحله‌بندی از قبل در `supplier_product_submission` وجود دارد
 * (variants/media/commercial به‌صورت JSONB)؛ پس برای حفظِ گرافِ کاملِ تجاریِ
 * تأمین‌کننده پیش از تأیید، هیچ مهاجرتی لازم نیست. این تایپ‌ها و اعتبارسنجِ خالص
 * همان قراردادی است که `approveSubmissionAsNew` بدونِ اتلاف ماده‌سازی می‌کند.
 *
 * قاعدهٔ کلیدی: کلیدِ واریانت در بسته‌ها **SKU** است (نه شناسهٔ واریانت)، چون
 * واریانت‌ها پیش از تأیید وجود ندارند؛ در ماده‌سازی به شناسهٔ ساخته‌شده نگاشت می‌شود.
 * پول همیشه رشتهٔ ده‌دهیِ تمام‌رقم است؛ هرگز عددِ شناور.
 * ─────────────────────────────────────────────────────────────────────────── */

export type StagedMediaInput = { url: string; type?: string; position?: number; variantSku?: string | null };
export type StagedVariantInput = {
  sku: string;
  attributes?: Record<string, unknown>;
  status?: string;
  media?: StagedMediaInput[];
  inventory?: { onHand?: number };
};
export type StagedPackageInput = {
  packageType: (typeof PACKAGE_TYPES)[number];
  name: string;
  description?: string;
  items: Array<{ sku: string; quantity: number }>;
};
export type StagedPricingTierInput = {
  minQuantity: number;
  maxQuantity?: number | null;
  unitPrice: string;
  moqUnit?: (typeof MOQ_UNITS)[number];
};
export type StagedCommercialInput = {
  sku?: string;
  wholesalePrice?: string;
  retailPrice?: string | null;
  currency?: string;
  moq?: number;
  moqUnit?: (typeof MOQ_UNITS)[number];
  packageType?: (typeof PACKAGE_TYPES)[number] | null;
  variantSku?: string | null;
  packages?: StagedPackageInput[];
  pricingTiers?: StagedPricingTierInput[];
};

const DECIMAL_MONEY = /^\d+$/;

function isDecimalMoney(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_MONEY.test(value);
}

/**
 * اعتبارسنجیِ گرافِ تجاریِ مرحله‌بندی‌شده — خالص و قابلِ آزمون.
 *
 * «شکستِ صریح» جای «ردِ بی‌صدا» را می‌گیرد: پیش‌تر قیمتِ نامعتبر باعث می‌شد
 * پیشنهاد **اصلاً** ساخته نشود بدون هیچ خطایی (ماده‌سازیِ نیمه‌کاره).
 * پیکربندیِ ساده/قدیمی (بدونِ moqUnit و بسته) معتبر می‌ماند تا سازگاریِ
 * backward حفظ شود.
 */
export function validateStagedCommercialGraph(input: {
  variants: StagedVariantInput[];
  media: StagedMediaInput[];
  commercial: StagedCommercialInput;
}): void {
  const { variants, media, commercial } = input;

  const skus = variants.map((variant) => variant.sku);
  if (skus.some((sku) => typeof sku !== "string" || sku.trim().length === 0)) {
    throw new CatalogDomainError("VARIANT_SKU_REQUIRED", "هر واریانت باید SKU غیرخالی داشته باشد");
  }
  if (new Set(skus).size !== skus.length) {
    throw new CatalogDomainError("DUPLICATE_VARIANT_SKU", "SKU واریانت‌ها باید یکتا باشد");
  }
  const skuSet = new Set(skus);

  for (const item of media) {
    if (typeof item.url !== "string" || item.url.trim().length === 0) {
      throw new CatalogDomainError("INVALID_MEDIA_URL", "نشانی رسانه نامعتبر است");
    }
    if (item.variantSku != null && !skuSet.has(item.variantSku)) {
      throw new CatalogDomainError("MEDIA_VARIANT_NOT_FOUND", "رسانه به واریانتِ ناموجود ارجاع دارد");
    }
  }
  for (const variant of variants) {
    for (const item of variant.media ?? []) {
      if (typeof item.url !== "string" || item.url.trim().length === 0) {
        throw new CatalogDomainError("INVALID_MEDIA_URL", "نشانی رسانهٔ واریانت نامعتبر است");
      }
    }
    const onHand = variant.inventory?.onHand;
    if (onHand != null && (!Number.isInteger(onHand) || onHand < 0)) {
      throw new CatalogDomainError("INVALID_INVENTORY_ON_HAND", "موجودی پیشنهادی باید عددِ صحیحِ نامنفی باشد");
    }
  }

  // پیشنهادِ تجاری اختیاری است؛ اما اگر باشد باید کامل و صریح باشد.
  if (commercial.wholesalePrice != null || commercial.moq != null || commercial.moqUnit != null) {
    if (!isDecimalMoney(commercial.wholesalePrice)) {
      throw new CatalogDomainError("INVALID_WHOLESALE_PRICE", "قیمت عمده باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
    if (commercial.retailPrice != null && !isDecimalMoney(commercial.retailPrice)) {
      throw new CatalogDomainError("INVALID_RETAIL_PRICE", "قیمت خرده باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
    if (!Number.isInteger(commercial.moq) || (commercial.moq as number) <= 0) {
      throw new CatalogDomainError("INVALID_MOQ", "حداقل تعداد سفارش باید عددِ صحیحِ مثبت باشد");
    }
    if (commercial.moqUnit != null && !MOQ_UNITS.includes(commercial.moqUnit as any)) {
      throw new CatalogDomainError("INVALID_MOQ_UNIT", "واحدِ حداقل تعداد نامعتبر است");
    }
    if (commercial.packageType != null && !PACKAGE_TYPES.includes(commercial.packageType as any)) {
      throw new CatalogDomainError("INVALID_PACKAGE_TYPE", "نوع بسته نامعتبر است");
    }
    if (commercial.variantSku != null && !skuSet.has(commercial.variantSku)) {
      throw new CatalogDomainError("OFFER_VARIANT_NOT_FOUND", "پیشنهاد به واریانتِ ناموجود ارجاع دارد");
    }
  }

  for (const tier of commercial.pricingTiers ?? []) {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity <= 0) {
      throw new CatalogDomainError("INVALID_PRICING_RANGE", "بازهٔ قیمت‌گذاری نامعتبر است");
    }
    if (tier.maxQuantity != null && (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < tier.minQuantity)) {
      throw new CatalogDomainError("INVALID_PRICING_RANGE", "بازهٔ قیمت‌گذاری نامعتبر است");
    }
    if (!isDecimalMoney(tier.unitPrice)) {
      throw new CatalogDomainError("INVALID_TIER_PRICE", "قیمتِ پله باید رشتهٔ ده‌دهیِ تمام‌رقم باشد");
    }
    if (tier.moqUnit != null && !MOQ_UNITS.includes(tier.moqUnit as any)) {
      throw new CatalogDomainError("INVALID_MOQ_UNIT", "واحدِ پلهٔ قیمت‌گذاری نامعتبر است");
    }
  }
  // هم‌پوشانیِ پله‌ها — همان قاعدهٔ `offers.service.ts`.
  const tiers = commercial.pricingTiers ?? [];
  for (let i = 0; i < tiers.length; i += 1) {
    for (let j = i + 1; j < tiers.length; j += 1) {
      const a = tiers[i]!; const b = tiers[j]!;
      const aMax = a.maxQuantity ?? Number.POSITIVE_INFINITY;
      const bMax = b.maxQuantity ?? Number.POSITIVE_INFINITY;
      if (a.minQuantity <= bMax && b.minQuantity <= aMax) {
        throw new CatalogDomainError("OVERLAPPING_PRICING_TIER", "بازهٔ قیمت‌گذاری هم‌پوشان است");
      }
    }
  }

  for (const pkg of commercial.packages ?? []) {
    if (typeof pkg.name !== "string" || pkg.name.trim().length === 0) {
      throw new CatalogDomainError("INVALID_PACKAGE_NAME", "نام بسته الزامی است");
    }
    if (pkg.items.some((item) => !skuSet.has(item.sku))) {
      throw new CatalogDomainError("INVALID_PACKAGE_VARIANT", "واریانتِ بسته متعلق به این محصول نیست");
    }
    if (new Set(pkg.items.map((item) => item.sku)).size !== pkg.items.length) {
      throw new CatalogDomainError("INVALID_PACKAGE_ITEMS", "اقلام بسته باید غیرتکراری باشند");
    }
    // بازاستفاده از همان قاعدهٔ دامنه (نوعِ بسته + مجموع + ترکیبِ SIZE_RUN).
    validateWholesalePackage({
      offerId: "staged",
      packageType: pkg.packageType,
      name: pkg.name,
      totalPieces: calculatePackageTotalPieces(pkg.items.map((item) => ({ variantId: item.sku, quantity: item.quantity }))),
      items: pkg.items.map((item) => ({ variantId: item.sku, quantity: item.quantity })),
    });
  }
}

/* ── نرمال‌سازهای ورودیِ مرحله‌بندی‌شده (JSONB → تایپِ قوی) ────────────────────
 * JSONB تایپ ندارد؛ این توابع تنها فیلدهای معتبر را برمی‌دارند تا ماده‌سازی
 * هرگز روی `any` تکیه نکند. هیچ محاسبهٔ پولی انجام نمی‌دهند.
 * ─────────────────────────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * ویژگی‌های سطحِ محصول (نه واریانت).
 *
 * مقصدِ کانونیکِ این مقدار ستونِ `product.attributes` است (مهاجرت ۰۰۴۷)؛ پیش از
 * آن این داده پذیرفته می‌شد ولی جایی برای ماندن نداشت. اینجا فقط «شیء بودن» را
 * تضمین می‌کنیم — اعتبارسنجیِ معنا در `assertSubmissionSeparation` انجام می‌شود
 * که اجازه نمی‌دهد فیلدهای تجاری داخل attributes بیایند.
 */
export function normalizeStagedAttributes(raw: unknown): Record<string, unknown> {
  return asRecord(raw);
}

export function normalizeStagedVariants(raw: unknown): StagedVariantInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const record = asRecord(entry);
    const mediaRaw = Array.isArray(record.media) ? record.media : [];
    const inventory = asRecord(record.inventory);
    return {
      sku: asString(record.sku) ?? "",
      attributes: asRecord(record.attributes),
      status: asString(record.status),
      media: mediaRaw.map((item) => {
        const mediaRecord = asRecord(item);
        return {
          url: asString(mediaRecord.url) ?? "",
          type: asString(mediaRecord.type),
          position: typeof mediaRecord.position === "number" ? mediaRecord.position : undefined,
        };
      }),
      inventory: typeof inventory.onHand === "number" ? { onHand: inventory.onHand } : undefined,
    };
  });
}

export function normalizeStagedMedia(raw: unknown): StagedMediaInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const record = asRecord(entry);
    return {
      url: asString(record.url) ?? "",
      type: asString(record.type),
      position: typeof record.position === "number" ? record.position : undefined,
      variantSku: asString(record.variantSku) ?? null,
    };
  });
}

export function normalizeStagedCommercial(raw: unknown): StagedCommercialInput {
  const record = asRecord(raw);
  const packagesRaw = Array.isArray(record.packages) ? record.packages : [];
  const tiersRaw = Array.isArray(record.pricingTiers) ? record.pricingTiers : [];
  return {
    sku: asString(record.sku),
    wholesalePrice: asString(record.wholesalePrice),
    retailPrice: asString(record.retailPrice) ?? null,
    currency: asString(record.currency),
    moq: typeof record.moq === "number" ? record.moq : undefined,
    moqUnit: asString(record.moqUnit) as StagedCommercialInput["moqUnit"],
    packageType: (asString(record.packageType) ?? null) as StagedCommercialInput["packageType"],
    variantSku: asString(record.variantSku) ?? null,
    packages: packagesRaw.map((entry) => {
      const pkg = asRecord(entry);
      const itemsRaw = Array.isArray(pkg.items) ? pkg.items : [];
      return {
        packageType: asString(pkg.packageType) as StagedPackageInput["packageType"],
        name: asString(pkg.name) ?? "",
        description: asString(pkg.description),
        items: itemsRaw.map((item) => {
          const itemRecord = asRecord(item);
          return { sku: asString(itemRecord.sku) ?? "", quantity: typeof itemRecord.quantity === "number" ? itemRecord.quantity : 0 };
        }),
      };
    }),
    pricingTiers: tiersRaw.map((entry) => {
      const tier = asRecord(entry);
      return {
        minQuantity: typeof tier.minQuantity === "number" ? tier.minQuantity : 0,
        maxQuantity: typeof tier.maxQuantity === "number" ? tier.maxQuantity : null,
        unitPrice: asString(tier.unitPrice) ?? "",
        moqUnit: asString(tier.moqUnit) as StagedPricingTierInput["moqUnit"],
      };
    }),
  };
}
