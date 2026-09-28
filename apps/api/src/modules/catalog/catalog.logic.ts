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
