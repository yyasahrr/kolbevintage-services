/**
 * Promotions public contract — the only surface other modules may consume.
 *
 * Ownership recap: promotions decides commercial eligibility + benefit. It
 * never owns product, offer, price, inventory, order, payment, shipping,
 * settlement, membership, segment, presentation, or delivery state.
 */

export type PromotionChannel = "RETAIL" | "WHOLESALE";

export type PromotionActor = {
  userId: string;
  role: "admin" | "supplier" | "customer" | "vip" | "system";
};

/**
 * Attribution snapshot for future order adoption (A12). Orders will embed
 * these exact fields at commit time so historical totals never shift when
 * campaign rules later change. Money is decimal strings on JSON.
 */
export type PromotionAttribution = {
  promotionId: string;
  promotionRevisionId: string;
  couponId: string | null;
  baseAmount: string;
  discountAmount: string;
  finalAmount: string;
  evaluationHash: string;
  evaluationVersion: string;
};

/** Server-resolved facts for one order line. No browser value is trusted. */
export type ResolvedLineFacts = {
  lineId: string;
  productId: string;
  /** Authoritative category from Catalog (single category per product). */
  categoryId: string | null;
  offerId: string | null;
  quantity: number;
  /** Server-resolved base prices (pricing authority output, revalidated). */
  unitPrice: bigint;
  lineTotal: bigint;
};

/** Server-resolved facts for the buying actor. */
export type ResolvedActorFacts = {
  customerKey: string;
  vipAccountId: string | null;
  vipPlanId: string | null;
  vipActive: boolean;
  /** CRM segment tag keys resolved server-side. */
  segments: string[];
};

/**
 * Owner-domain fact seam. Production wiring delegates to Catalog / Offers /
 * VIP / CRM public services; tests substitute scripted fakes. The seam
 * exists so browser-supplied ids can never reach a promotion decision.
 */
export type PromotionFactSource = {
  resolveLineFacts(
    lines: Array<{
      lineId: string;
      productId: string;
      offerId?: string | null;
      quantity: unknown;
      unitPrice: unknown;
      lineTotal: unknown;
    }>,
  ): Promise<ResolvedLineFacts[]>;
  resolveActorFacts(actor: { userId: string; vipAccountId?: string | null }): Promise<ResolvedActorFacts>;
};

export type EvaluationLineRequest = {
  lineId: string;
  productId: string;
  offerId?: string | null;
  quantity: unknown;
  unitPrice: unknown;
  lineTotal: unknown;
};

export type EvaluationRequest = {
  channel: PromotionChannel;
  actor: { userId: string; vipAccountId?: string | null };
  lines: EvaluationLineRequest[];
  /** Server-resolved shipping total (shipping authority output, revalidated). */
  shippingTotal: unknown;
  /** Raw browser input; normalized + resolved server-side. */
  couponCodes?: string[];
  now?: Date;
};

export type AppliedPromotionJson = PromotionAttribution & { promotionKey: string };

export type RejectedPromotionJson = {
  promotionId: string;
  promotionKey: string;
  revisionId: string | null;
  reason: string;
};

export type EvaluationResultJson = {
  evaluationVersion: string;
  baseSubtotal: string;
  baseShipping: string;
  lineDiscounts: Array<{ lineId: string; discount: string }>;
  orderDiscount: string;
  shippingDiscount: string;
  totalDiscount: string;
  finalSubtotal: string;
  finalShipping: string;
  finalTotal: string;
  appliedPromotions: AppliedPromotionJson[];
  rejectedPromotions: RejectedPromotionJson[];
  termsHash: string;
};
