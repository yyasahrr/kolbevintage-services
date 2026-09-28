/**
 * Phase 4.2.2 — Authoritative pricing and terms hash contracts
 * PricingService has no owned tables, uses Offers public query contracts.
 */

import { createHash } from "node:crypto";

export type PricingUnit = "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET" | "PER_PIECE";
export type SaleUnit = "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET";

export type PricingTier = {
  id: string;
  offerId: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPrice: bigint;
  currency: string;
  moqUnit: SaleUnit;
  pricingUnit: PricingUnit;
};

export type Offer = {
  id: string;
  productId: string;
  sellerId: string;
  wholesalePrice: bigint;
  currency: string;
  moq: number;
  moqUnit: SaleUnit;
  pricingUnit: PricingUnit;
  packageType?: string | null;
};

export type PackageComposition = Array<{ variantId: string; quantity: number }>;

export type Package = {
  id: string;
  offerId: string;
  packageType: string;
  name: string;
  totalPieces: number;
  composition: PackageComposition;
};

export type PriceResolutionInput = {
  offer: Offer;
  variantId?: string | null;
  packageId?: string | null;
  package?: Package | null;
  quantity: number;
  pricingTiers: PricingTier[];
};

export type PriceResolutionOutput = {
  pricingTierId: string | null;
  pricingUnit: PricingUnit;
  unitPrice: bigint;
  currency: string;
  quantityInPricingUnit: number;
  pieceQuantity: number;
  lineTotal: bigint;
};

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingValidationError";
  }
}

export class TierSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierSelectionError";
  }
}

/**
 * Calculate pieces per package from explicit recipe (no universal multiplier)
 * Per quantity-and-package-model.md: pieces_per_package = sum(r[v])
 */
export function calculatePiecesPerPackage(composition: PackageComposition): number {
  if (!composition || composition.length === 0) throw new PricingValidationError("package composition empty");
  const seen = new Set<string>();
  let total = 0;
  for (const item of composition) {
    if (!item.variantId) throw new PricingValidationError("variantId required in composition");
    if (seen.has(item.variantId)) throw new PricingValidationError(`duplicate variant ${item.variantId}`);
    seen.add(item.variantId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new PricingValidationError("composition quantity must be positive safe integer");
    total += item.quantity;
    if (!Number.isSafeInteger(total)) throw new PricingValidationError("pieces_per_package overflow");
  }
  return total;
}

export function calculateTotalPieces(packageCount: number, piecesPerPackage: number): number {
  if (!Number.isSafeInteger(packageCount) || packageCount <= 0) throw new PricingValidationError("packageCount invalid");
  if (!Number.isSafeInteger(piecesPerPackage) || piecesPerPackage <= 0) throw new PricingValidationError("piecesPerPackage invalid");
  const total = packageCount * piecesPerPackage;
  if (!Number.isSafeInteger(total)) throw new PricingValidationError("totalPieces overflow");
  return total;
}

/**
 * Authoritative price resolution — deterministic, bigint money, integer quantity, no float
 * Input: offer, selected variant/package, quantity, pricing tiers
 * Output: pricingTierId, pricingUnit, unitPrice, currency, quantityInPricingUnit, pieceQuantity, lineTotal
 */
export function resolvePrice(input: PriceResolutionInput): PriceResolutionOutput {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new PricingValidationError("quantity must be positive safe integer");

  // Validate selector: exactly one of variantId or packageId for PIECE vs PACKAGE-like, but allow both null for backward compat? For 4.2.2, enforce selector rules
  const hasVariant = !!input.variantId;
  const hasPackage = !!input.packageId;

  if (hasVariant && hasPackage) throw new PricingValidationError("Ambiguous selector: both variant_id and package_id provided");
  // PIECE sale requires variant, PACKAGE-like requires package — validated at higher level, but we check here for pricing unit consistency

  // Determine pricing unit from offer or package context
  // For pre-launch backfill, deterministic mapping: moqUnit → pricingUnit
  let pricingUnit: PricingUnit = input.offer.pricingUnit || (input.offer.moqUnit as PricingUnit) || "PIECE";

  // If package present, pricing unit should be PACKAGE-like (PACKAGE, SERIES, BOX, CARTON, SET) unless explicitly PER_PIECE
  // For PIECE sale, pricing unit is PIECE or PER_PIECE
  if (hasPackage && (pricingUnit === "PIECE" || pricingUnit === "PER_PIECE")) {
    // If offer's pricing unit is PIECE but package is selected, we still allow? The spec says pricing unit must match commercial sale/pricing semantics
    // For PACKAGE sale, price is per package, so pricingUnit should be PACKAGE-like
    // We will keep offer's pricingUnit as authoritative, but validate that package exists
  }

  if (hasVariant && !["PIECE", "PER_PIECE"].includes(pricingUnit)) {
    // For variant sale, pricing unit should be PIECE/PER_PIECE
    // If offer says PACKAGE but variant selected, it's invalid — reject
    // However for backfill, we allow deterministic mapping: if variant selected, force PIECE
    if (input.offer.moqUnit === "PIECE") {
      pricingUnit = "PIECE";
    } else {
      // If offer is PACKAGE-like but variant selector used, reject
      throw new PricingValidationError(`pricingUnit ${pricingUnit} incompatible with variant selector`);
    }
  }

  // Calculate pieceQuantity
  let pieceQuantity: number;
  if (hasVariant) {
    pieceQuantity = input.quantity; // PIECE: quantity = pieces
  } else if (hasPackage) {
    if (!input.package) throw new PricingValidationError("package composition required for package pricing");
    const ppp = calculatePiecesPerPackage(input.package.composition);
    pieceQuantity = calculateTotalPieces(input.quantity, ppp);
  } else {
    // No selector (legacy): treat as PIECE for backward compat
    pieceQuantity = input.quantity;
  }

  // Tier selection: deterministic, no ambiguous overlapping
  // Sort tiers by minQuantity ascending, then maxQuantity ascending (null last)
  const sortedTiers = [...input.pricingTiers].sort((a, b) => {
    if (a.minQuantity !== b.minQuantity) return a.minQuantity - b.minQuantity;
    if (a.maxQuantity === null && b.maxQuantity === null) return 0;
    if (a.maxQuantity === null) return 1;
    if (b.maxQuantity === null) return -1;
    return a.maxQuantity - b.maxQuantity;
  });

  // Validate no overlapping tiers with same min but different max that would cause ambiguity
  // For deterministic selection, we pick the tier with highest minQuantity <= quantity
  let selectedTier: PricingTier | null = null;
  for (const tier of sortedTiers) {
    // Tier unit must match commercial sale/pricing semantics — we check moqUnit matches offer's moqUnit or pricingUnit matches
    // For simplicity, tier's moqUnit should equal offer's moqUnit OR tier's pricingUnit should equal resolved pricingUnit
    // If mismatch, skip tier (or reject if all mismatch and fallback needed)
    const unitMatches = tier.moqUnit === input.offer.moqUnit || tier.pricingUnit === pricingUnit;
    if (!unitMatches && sortedTiers.length > 1) {
      // Allow fallback to offer price if no tier matches unit, but don't silently pick wrong unit
      continue;
    }

    const minOk = input.quantity >= tier.minQuantity;
    const maxOk = tier.maxQuantity === null || input.quantity <= tier.maxQuantity;
    if (minOk && maxOk) {
      // If multiple tiers match (overlapping), pick the one with highest minQuantity (most specific)
      if (!selectedTier || tier.minQuantity > selectedTier.minQuantity) {
        selectedTier = tier;
      } else if (tier.minQuantity === selectedTier.minQuantity) {
        // Overlapping tiers with same min — ambiguous, reject
        if (tier.maxQuantity !== selectedTier.maxQuantity || tier.unitPrice !== selectedTier.unitPrice) {
          throw new TierSelectionError(`Ambiguous overlapping tiers: ${selectedTier.id} and ${tier.id} both match quantity ${input.quantity}`);
        }
      }
    }
  }

  // If no tier matches, fallback to offer's wholesalePrice
  let unitPrice: bigint;
  let pricingTierId: string | null = null;
  let currency = input.offer.currency;

  if (selectedTier) {
    unitPrice = selectedTier.unitPrice;
    pricingTierId = selectedTier.id;
    currency = selectedTier.currency;
    // Ensure tier's pricingUnit is used as authoritative if tier selected
    pricingUnit = selectedTier.pricingUnit;
  } else {
    unitPrice = input.offer.wholesalePrice;
  }

  if (typeof unitPrice !== "bigint") throw new PricingValidationError("unitPrice must be bigint");
  if (unitPrice < 0n) throw new PricingValidationError("unitPrice must be >=0");

  // Calculate lineTotal: for PIECE pricing, line_total = piece_quantity * unit_price, for PACKAGE-like, quantity * unit_price
  const isPiecePricing = pricingUnit === "PIECE" || pricingUnit === "PER_PIECE";
  const multiplier = isPiecePricing ? pieceQuantity : input.quantity;
  const lineTotal = unitPrice * BigInt(multiplier);

  const MAX_MONEY = 1000000000000000n;
  if (lineTotal > MAX_MONEY) throw new PricingValidationError("lineTotal exceeds MAX_MONEY");

  return {
    pricingTierId,
    pricingUnit,
    unitPrice,
    currency,
    quantityInPricingUnit: input.quantity,
    pieceQuantity,
    lineTotal,
  };
}

/**
 * Accepted terms snapshot structure — Phase 4.3.1 complete freeze
 * Includes authoritative acceptance-time values for product, variant, seller, package
 */
export type AcceptedTermsSnapshot = {
  requestVersion: number;
  productId: string;
  offerId: string;
  sellerId: string;
  supplierId: string | null;
  variantId: string | null;
  packageId: string | null;
  quantity: number;
  saleUnit: SaleUnit;
  pricingUnit: PricingUnit;
  pricingTierId: string | null;
  unitPrice: string; // decimal string for JSON/API
  currency: string;
  product: {
    id: string;
    name: string;
  };
  variant?: {
    id: string;
    sku: string;
    attributes: Record<string, unknown>;
  } | null;
  seller: {
    id: string;
    type: string;
    displayName: string;
    supplierId: string | null;
  };
  package?: {
    id: string;
    type: string;
    name: string;
    piecesPerPackage: number;
    composition: Array<{ variantId: string; quantity: number }>;
  } | null;
  pieceQuantity: number;
  lineTotal: string; // decimal string
};

/**
 * Deterministic hash of normalized accepted terms
 * Uses canonical serialization (sorted keys) to avoid unstable JSON ordering
 */
export function canonicalStringify(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "bigint") return obj.toString();
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

export function hashAcceptedTerms(snapshot: AcceptedTermsSnapshot): string {
  const normalized = {
    requestVersion: snapshot.requestVersion,
    productId: snapshot.productId,
    offerId: snapshot.offerId,
    sellerId: snapshot.sellerId,
    supplierId: snapshot.supplierId,
    variantId: snapshot.variantId,
    packageId: snapshot.packageId,
    quantity: snapshot.quantity,
    saleUnit: snapshot.saleUnit,
    pricingUnit: snapshot.pricingUnit,
    pricingTierId: snapshot.pricingTierId,
    unitPrice: snapshot.unitPrice,
    currency: snapshot.currency,
    product: snapshot.product
      ? {
          id: snapshot.product.id,
          name: snapshot.product.name,
        }
      : null,
    variant: snapshot.variant
      ? {
          id: snapshot.variant.id,
          sku: snapshot.variant.sku,
          attributes: snapshot.variant.attributes,
        }
      : null,
    seller: snapshot.seller
      ? {
          id: snapshot.seller.id,
          type: snapshot.seller.type,
          displayName: snapshot.seller.displayName,
          supplierId: snapshot.seller.supplierId,
        }
      : null,
    package: snapshot.package
      ? {
          id: snapshot.package.id,
          type: snapshot.package.type,
          name: snapshot.package.name,
          piecesPerPackage: snapshot.package.piecesPerPackage,
          composition: [...snapshot.package.composition].sort((a, b) => a.variantId.localeCompare(b.variantId)),
        }
      : null,
    pieceQuantity: snapshot.pieceQuantity,
    lineTotal: snapshot.lineTotal,
  };
  const canonical = canonicalStringify(normalized);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Multi-request batch validation — pure
 * A set of requests can form one parent order only when:
 * all belong to same VIP account, same buyer_user, status=accepted, have snapshots, valid version/hash, none already linked, currency compatible, unexpired, different sellers allowed
 */
export type WholesaleRequestForBatch = {
  id: string;
  vipAccountId: string;
  buyerUserId: string; // derived from account.user_id
  status: string;
  acceptedTermsSnapshot: AcceptedTermsSnapshot | null;
  acceptedTermsHash: string | null;
  version: number;
  currency: string;
  acceptanceExpiresAt: Date | null;
  sellerId: string;
  alreadyLinked: boolean;
};

export class BatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchValidationError";
  }
}

export function validateMultiRequestBatch(requests: WholesaleRequestForBatch[]): void {
  if (requests.length === 0) throw new BatchValidationError("Batch empty");
  if (requests.length > 20) throw new BatchValidationError("Batch too large (max 20)");

  const firstAccount = requests[0].vipAccountId;
  const firstBuyer = requests[0].buyerUserId;
  const firstCurrency = requests[0].currency;

  const seenIds = new Set<string>();
  for (const req of requests) {
    if (seenIds.has(req.id)) throw new BatchValidationError(`Duplicate request in batch: ${req.id}`);
    seenIds.add(req.id);

    if (req.vipAccountId !== firstAccount) throw new BatchValidationError(`Account mismatch: ${req.id} has account ${req.vipAccountId} != ${firstAccount}`);
    if (req.buyerUserId !== firstBuyer) throw new BatchValidationError(`Buyer mismatch: ${req.id} has buyer ${req.buyerUserId} != ${firstBuyer}`);
    if (req.status !== "accepted") throw new BatchValidationError(`Request ${req.id} status not accepted: ${req.status}`);
    if (!req.acceptedTermsSnapshot) throw new BatchValidationError(`Request ${req.id} missing accepted_terms_snapshot`);
    if (!req.acceptedTermsHash) throw new BatchValidationError(`Request ${req.id} missing accepted_terms_hash`);
    if (req.alreadyLinked) throw new BatchValidationError(`Request ${req.id} already linked to an order`);
    if (req.currency !== firstCurrency) throw new BatchValidationError(`Currency mismatch: ${req.id} has ${req.currency} != ${firstCurrency}`);

    if (req.acceptanceExpiresAt && req.acceptanceExpiresAt.getTime() <= Date.now()) {
      throw new BatchValidationError(`Request ${req.id} acceptance expired at ${req.acceptanceExpiresAt.toISOString()}`);
    }

    // Verify hash matches snapshot
    const expectedHash = hashAcceptedTerms(req.acceptedTermsSnapshot);
    if (expectedHash !== req.acceptedTermsHash) {
      throw new BatchValidationError(`Request ${req.id} hash mismatch: expected ${expectedHash} != ${req.acceptedTermsHash}`);
    }
  }
}

/**
 * Request selector validation — PIECE vs PACKAGE
 */
export function validateRequestSelector(variantId: string | null | undefined, packageId: string | null | undefined): void {
  const hasVariant = !!variantId;
  const hasPackage = !!packageId;
  if (hasVariant && hasPackage) throw new PricingValidationError("Ambiguous selector: both variant_id and package_id");
  // Allow both null for legacy? For 4.2.2 canonical, PIECE requires variant, PACKAGE requires package, but we allow both null for backward compat in migration
  // For strict validation, uncomment:
  // if (!hasVariant && !hasPackage) throw new PricingValidationError("Selector required: either variant_id or package_id");
}

export function validateOrderItemSelector(variantId: string | null | undefined, packageId: string | null | undefined): void {
  const hasVariant = !!variantId;
  const hasPackage = !!packageId;
  if (hasVariant && hasPackage) throw new PricingValidationError("Order item selector ambiguous: both variant and package");
  if (!hasVariant && !hasPackage) throw new PricingValidationError("Order item selector required: either variant or package");
}
