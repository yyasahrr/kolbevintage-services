/**
 * Phase 4.2 — Minimal read DTOs for Orders (no full creation yet)
 */

export type WholesaleOrderResponseDto = {
  id: string;
  orderCode: string;
  accountId: string;
  buyerUserId: string;
  originatingRequestId: string | null;
  status: string;
  currency: string;
  itemsTotal: string;
  shippingTotal: string;
  grandTotal: string;
  pricingVersion: string | null;
  paymentMode: string | null;
  version: number;
  confirmedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WholesaleOrderItemResponseDto = {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  sellerId: string;
  supplierId: string | null;
  packageId: string | null;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  variantSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
  packageTypeSnapshot: string | null;
  packageCompositionSnapshot: unknown;
  quantity: number;
  packageQuantity: number | null;
  pieceQuantity: number;
  unitPrice: string;
  lineTotal: string;
  currency: string;
};

export type ChildOrderResponseDto = {
  id: string;
  orderCode: string;
  wholesaleOrderId: string | null;
  sellerId: string;
  supplierId: string | null;
  status: string;
  currency: string;
  itemsTotal: string;
  grandTotal: string;
  shippingResponsibility: string;
  version: number;
};
