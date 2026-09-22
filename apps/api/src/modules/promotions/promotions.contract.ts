/**
 * Phase 5.7 — Promotions public contract.
 *
 * This is the ONLY surface other modules may import (`*.contract.ts` is on the
 * module-boundary allowlist). It carries:
 *
 *   1. the deterministic commercial evaluation input/output (money as decimal
 *      strings in JSON, bigint internally — never floats);
 *   2. the attribution snapshot future orders will persist (5.7-B);
 *   3. the owner-facts provider interface through which Promotions reads
 *      Catalog/Offers/VIP/CRM authority (Promotions never tables-reads them).
 *
 * Trust rule: `priceBasis.kind` MUST be `SERVER_RESOLVED`. There is no
 * representation for a browser-submitted price — callers are server-side only
 * (future checkout passes PricingService / accepted-terms values; admin
 * preview is admin-only and labeled as such in `resolvedBy`).
 */

export const PROMOTION_EVALUATION_VERSION = "promo-eval-v1" as const;

/**
 * Phase 5.8: the only `priceBasis.resolvedBy` value that marks a RETAIL
 * evaluation OWNER_RESOLVED. Any other retail resolver keeps the honest
 * CALLER_ATTESTED_RETAIL_TRANSITION flag.
 */
export const RETAIL_PRICING_RESOLVER = "retail-pricing-service" as const;

export type PromotionChannel = "RETAIL" | "WHOLESALE";

export type EvaluationActorKind = "RETAIL_CUSTOMER" | "WHOLESALE_ACCOUNT";

export interface EvaluationActorInput {
  kind: EvaluationActorKind;
  /** Retail customer user id, or the wholesale buyer's user id. */
  userId: string;
  /** Wholesale account id. Required when kind is WHOLESALE_ACCOUNT. */
  accountId?: string;
}

export interface EvaluationLineInput {
  /** Caller-stable line key (used for deterministic allocation + output map). */
  lineId: string;
  productId: string;
  variantId?: string | null;
  packageId?: string | null;
  /** Wholesale commercial anchor. Required for WHOLESALE; optional for RETAIL. */
  offerId?: string | null;
  quantity: number;
  /** Decimal-string bigint (IRR). Server-resolved base unit price. */
  unitPrice: string;
}

export interface EvaluationPriceBasis {
  kind: "SERVER_RESOLVED";
  /** Server component that resolved the base prices, e.g. `wholesale-pricing-service`. */
  resolvedBy: string;
  /** Optional upstream reference (accepted-terms hash, pricebook version…). */
  reference?: string;
}

export interface EvaluatePromotionsInput {
  channel: PromotionChannel;
  actor: EvaluationActorInput;
  lines: EvaluationLineInput[];
  /** Decimal-string bigint (IRR), or null when there is no shipping context. */
  shippingBase?: string | null;
  priceBasis: EvaluationPriceBasis;
  couponCodes?: string[];
  /** ISO timestamp. Defaults to server now; tests pin it for determinism. */
  now?: string;
}

export interface AppliedPromotionResult {
  promotionId: string;
  promotionCode: string;
  revisionId: string;
  revisionNumber: number;
  couponId: string | null;
  benefitType: string;
  benefitScope: string;
  stackingPolicy: string;
  /** Decimal-string bigint amounts (IRR). baseAmount is the remaining base
   * the discount was computed from (sequential stacking). */
  baseAmount: string;
  discountAmount: string;
  /** Per-line share of this promotion's discount (ORDER scope allocation). */
  allocatedLines: Record<string, string>;
}

export interface RejectedPromotionResult {
  promotionId: string;
  revisionId: string | null;
  /** Allowlisted machine reason (see PROMOTION_REJECTION_REASONS). */
  reason: string;
  detail?: Record<string, string>;
}

export interface EvaluatePromotionsResult {
  evaluationVersion: typeof PROMOTION_EVALUATION_VERSION;
  channel: PromotionChannel;
  /** Decimal-string bigint amounts (IRR). */
  baseSubtotal: string;
  lineDiscounts: Record<string, string>;
  orderDiscount: string;
  shippingDiscount: string;
  totalDiscount: string;
  finalSubtotal: string;
  /** Null when no shipping context was provided. */
  finalShipping: string | null;
  grandTotal: string;
  appliedPromotions: AppliedPromotionResult[];
  rejectedPromotions: RejectedPromotionResult[];
  /** Presented codes that attached to nothing, with machine reasons. */
  unmatchedCouponCodes: Array<{ code: string; reason: string }>;
  /** `OWNER_RESOLVED` for wholesale (re-derived via PricingService); retail is
   * caller-attested until the retail price authority lands (honest transition). */
  priceAuthority: "OWNER_RESOLVED" | "CALLER_ATTESTED_RETAIL_TRANSITION";
  priceBasis: { resolvedBy: string; reference: string | null };
  /** sha256 over the canonical applied-terms payload (order snapshot binding). */
  termsHash: string;
}

/**
 * What an order snapshots per applied promotion (5.7-B: written by
 * `recordRedemption` at checkout time, read back via `getOrderAttribution`).
 * Historical totals never recompute from live promotion rows.
 */
export interface PromotionAttributionSnapshot {
  promotionId: string;
  promotionRevisionId: string;
  couponId: string | null;
  /** Decimal-string bigint amounts (IRR). */
  baseAmount: string;
  discountAmount: string;
  finalAmount: string;
  /**
   * Evaluation binding. Null only for ledger rows predating migration 0032;
   * every write since requires both values.
   */
  evaluationVersion: string | null;
  termsHash: string | null;
}

/**
 * Display-safe campaign state for CMS/SiteBuilder presentation references
 * (5.7-B). Fixed key set by design: anything eligibility- or actor-related
 * must never appear here. `displayActive` gates *rendering* ("show the hero
 * banner"); it is not eligibility, which is always per-basket at evaluation.
 */
export interface PromotionDisplayBenefit {
  type: string;
  scope: string;
  /** Basis points for PERCENT_DISCOUNT, else null (render hint, not math input). */
  percentBps: number | null;
  /** Decimal-string bigint IRR for FIXED_AMOUNT_DISCOUNT, else null. */
  amount: string | null;
  couponRequired: boolean;
  inWindow: boolean;
}

export interface PromotionDisplayState {
  code: string;
  title: string;
  channel: string;
  status: string;
  displayActive: boolean;
  window: { startsAt: string | null; endsAt: string | null };
  benefit: PromotionDisplayBenefit | null;
}

/* ── Owner-facts provider ─────────────────────────────────────────────── */

export interface ProductFacts {
  productId: string;
  categoryId: string | null;
  status: string;
  ownerType: string;
}

export interface OfferFacts {
  offerId: string;
  productId: string;
  sellerId: string;
  status: string;
}

export interface PricingTierFacts {
  id: string;
  offerId: string;
  minQuantity: number;
  maxQuantity: number | null;
  unitPrice: bigint;
  currency: string;
  moqUnit: string;
  pricingUnit: string;
}

export interface PackageFacts {
  id: string;
  offerId: string;
  packageType: string;
  name: string;
  totalPieces: number;
  composition: Array<{ variantId: string; quantity: number }>;
}

export interface VipFacts {
  accountId: string;
  userId: string;
  accountStatus: string;
  membershipId: string;
  planId: string;
  planCode: string | null;
  membershipStatus: string;
}

export interface SegmentFacts {
  contactId: string | null;
  stage: string | null;
  tagKeys: string[];
}

export interface WholesaleLineBaseInput {
  offerId: string;
  variantId?: string | null;
  packageId?: string | null;
  quantity: number;
}

export interface WholesaleLineBase {
  unitPrice: bigint;
  lineTotal: bigint;
  pricingUnit: string;
  pricingTierId: string | null;
}

export interface WholesaleLineBaseInput {
  offerId: string;
  variantId?: string | null;
  packageId?: string | null;
  quantity: number;
}

export interface WholesaleLineBase {
  unitPrice: bigint;
  lineTotal: bigint;
  pricingUnit: string;
  pricingTierId: string | null;
}

/**
 * Reads authoritative facts through owner-domain services. Methods return
 * `null` for missing/ineligible references (fail closed at evaluation);
 * identity-mismatch is an invariant violation and throws.
 */
export interface PromotionFactsProvider {
  getProductFacts(productId: string): Promise<ProductFacts | null>;
  assertRetailProduct(productId: string): Promise<ProductFacts>;
  getOfferFacts(offerId: string): Promise<OfferFacts | null>;
  listPricingTiers(offerId: string): Promise<PricingTierFacts[]>;
  getPackageFacts(packageId: string, offerId: string): Promise<PackageFacts | null>;
  /** Re-derives the authoritative wholesale base via PricingService. */
  resolveWholesaleLineBase(input: WholesaleLineBaseInput): Promise<WholesaleLineBase>;
  getVipFacts(accountId: string, userId: string): Promise<VipFacts | null>;
  vipPlanExists(planId: string): Promise<boolean>;
  wholesaleAccountExists(accountId: string): Promise<boolean>;
  getSegmentFacts(ref: { userId: string; linkType: "account_user" | "wholesale_account" }): Promise<SegmentFacts>;
  tagExists(tagKey: string): Promise<boolean>;
}

export const PROMOTION_FACTS_PROVIDER = "PROMOTION_FACTS_PROVIDER";
