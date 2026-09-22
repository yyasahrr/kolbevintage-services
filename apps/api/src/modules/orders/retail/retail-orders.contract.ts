import { DomainError } from "@kolbe/shared";

/**
 * Phase 5.8 — Retail commerce contract: DTOs, actor, and the retail error.
 *
 * Money crosses this boundary as decimal strings (BIGINT IRR inside). Status
 * codes follow the wholesale precedent (OrderDomainError): structural input
 * failures are 400, semantic rejections 422, conflicts 409, ownership 403,
 * missing rows 404.
 */
export class RetailDomainError extends DomainError {
  constructor(code: string, message: string) {
    let status = 400;
    if (
      code === "RETAIL_PRODUCT_NOT_PUBLISHED" ||
      code === "RETAIL_PRODUCT_NOT_KOLBE" ||
      code === "RETAIL_VARIANT_INACTIVE" ||
      code === "RETAIL_VARIANT_MISMATCH" ||
      code === "RETAIL_VARIANT_UNRESOLVED" ||
      code === "RETAIL_VARIANT_AMBIGUOUS" ||
      code === "RETAIL_OFFER_MISSING" ||
      code === "RETAIL_OFFER_AMBIGUOUS" ||
      code === "RETAIL_MONETARY_OVERFLOW" ||
      code === "RETAIL_PROMOTION_BASE_MISMATCH" ||
      code === "RETAIL_TOTALS_MISMATCH"
    ) {
      status = 422;
    } else if (
      code === "RETAIL_IDEMPOTENCY_CONFLICT" ||
      code === "RETAIL_INSUFFICIENT_STOCK" ||
      code === "RETAIL_ORDER_CODE_COLLISION"
    ) {
      status = 409;
    } else if (code === "RETAIL_ORDER_FORBIDDEN") {
      status = 403;
    } else if (
      code === "RETAIL_ORDER_NOT_FOUND" ||
      code === "RETAIL_PRODUCT_NOT_FOUND" ||
      code === "RETAIL_VARIANT_NOT_FOUND"
    ) {
      status = 404;
    } else if (code === "RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED") {
      status = 503;
    }
    super(status, code, message);
    this.name = "RetailDomainError";
  }
}

/** Authenticated retail buyer (customer/vip session) or proxied guest. Never browser-claimed. */
export type RetailActor =
  | { kind: "customer"; userId: string }
  | { kind: "guest"; userId: null };

export type RetailLineInput = {
  productId: unknown;
  variantId?: unknown;
  size?: unknown;
  colour?: unknown;
  quantity: unknown;
  /** Browser-presented values: compared for the honesty flag, never authority. */
  presentedUnitPrice?: unknown;
  presentedName?: unknown;
};

export type CreateRetailOrderInput = {
  customer: unknown;
  lines: unknown;
  address: unknown;
  shippingMethodId: unknown;
  payMethod: unknown;
  couponCodes?: unknown;
  acceptedPolicyDocumentIds?: unknown;
  idempotencyKey: unknown;
  requestMetadata?: { ip?: string | null; userAgent?: string | null; requestId?: string | null } | null;
};

export type RetailOrderLineView = {
  productId: string;
  variantId: string | null;
  sku: string;
  productName: string;
  colour: string | null;
  size: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  baseLineTotal: string;
  promotionDiscount: string;
  lineTotal: string;
};

export type RetailOrderTotalsView = {
  itemsTotal: string;
  promotionDiscountTotal: string;
  shippingTotal: string;
  grandTotal: string;
};

export type RetailOrderEventView = {
  fromStatus: string | null;
  toStatus: string;
  actorRole: string | null;
  reason: string | null;
  orderVersion: number;
  createdAt: string;
};

export type RetailOrderView = {
  id: string;
  orderCode: string;
  status: string;
  replayed: boolean;
  currency: string;
  customer: { name: string; phone: string; email: string | null };
  address: Record<string, string>;
  totals: RetailOrderTotalsView;
  lines: RetailOrderLineView[];
  payment: { method: string; status: string; collected: boolean; requiresManualSettlement: boolean };
  legal: { mode: "off" | "enforce"; snapshotId: string | null };
  priceVersion: string | null;
  promotionTermsHash: string | null;
  history: RetailOrderEventView[];
  createdAt: string;
};
