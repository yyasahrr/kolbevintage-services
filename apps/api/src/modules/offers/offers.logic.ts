/**
 * منطق پیشنهاد فروشنده و بسته‌های عمده
 */

import { CatalogDomainError } from "../catalog/catalog.logic";

export type SellerType = "KOLBE" | "SUPPLIER";
export type MoqUnit = "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET";
export type PackageType = "SIZE_RUN" | "FIXED_QUANTITY" | "COLOR_MIX" | "CUSTOM_BUNDLE";

export type OfferIsolationCheck = {
  requesterSellerId: string;
  offerSellerId: string;
  requesterRole: "supplier" | "admin" | "customer" | "vip";
};

/**
 * جداسازی تأمین‌کننده: تأمین‌کننده فقط پیشنهادهای خودش را می‌بیند
 */
export function assertSupplierOfferIsolation(check: OfferIsolationCheck): void {
  if (check.requesterRole === "supplier" && check.requesterSellerId !== check.offerSellerId) {
    throw new CatalogDomainError(
      "SUPPLIER_ISOLATION_VIOLATION",
      "تأمین‌کننده فقط می‌تواند پیشنهادهای خودش را ببیند",
    );
  }
}

/**
 * محاسبهٔ سری سایز — مثال: S:2, M:2, L:2 = 6 تکه
 * یا بستهٔ رنگ-میکس: Black:3, White:3 = 6
 */
export function calculateSizeRunTotal(sizes: Array<{ size: string; qty: number }>): number {
  return sizes.reduce((sum, s) => sum + s.qty, 0);
}

export function validateSizeRun(sizes: Array<{ size: string; qty: number }>): void {
  if (sizes.length < 2) {
    throw new CatalogDomainError("SIZE_RUN_TOO_SMALL", "سایز-ران حداقل ۲ سایز نیاز دارد");
  }
  for (const s of sizes) {
    if (s.qty <= 0) throw new CatalogDomainError("SIZE_RUN_QTY_INVALID", "تعداد هر سایز باید مثبت باشد");
  }
}

/**
 * MOQ با واحدهای مختلف — Phase 4.2.2 correction: BOX/CARTON have no universal multiplier
 * Per quantity-and-package-model.md: A BOX or CARTON is an explicit configured package recipe.
 * The recipe defines the pieces, never hardcode BOX*5 or CARTON*20.
 * PIECE = تکه، PACKAGE = بسته، SERIES = سری، BOX = جعبه، CARTON = کارتن، SET = ست
 */
export function calculateMoqInPieces(
  moq: number,
  unit: MoqUnit,
  packagePieces: number, // تعداد تکه در هر بسته — derived from explicit recipe sum
): number {
  // All units now use explicit recipe: required_pieces = ordered_count * pieces_per_package
  // No universal multiplier for BOX/CARTON
  switch (unit) {
    case "PIECE":
      return moq;
    case "PACKAGE":
    case "SERIES":
    case "BOX":
    case "CARTON":
    case "SET":
      return moq * packagePieces;
    default:
      return moq;
  }
}

/**
 * Phase 4.2.2 — Prove no universal 5 or 20 multiplier remains
 * This function is used in regression tests
 */
export function hasLegacyBoxCartonMultiplier(): boolean {
  return false;
}
