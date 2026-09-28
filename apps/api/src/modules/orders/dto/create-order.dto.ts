/**
 * Phase 4.3 — Canonical wholesale order creation DTOs
 */

export class CreateWholesaleOrderRequestDto {
  requests!: Array<{ requestId: string; expectedVersion: number }>;
  paymentMode!: string;
  shippingAddress!: Record<string, unknown>;
  billingAddress!: Record<string, unknown>;
}

export class CreateWholesaleOrderResponseDto {
  order!: {
    id: string;
    orderCode: string;
    accountId: string;
    buyerUserId: string;
    status: string;
    currency: string;
    itemsTotal: string;
    shippingTotal: string;
    grandTotal: string;
    totalUnits: number;
    paymentMode: string | null;
    version: number;
    idempotencyKey: string | null;
    creationRequestHash: string | null;
    createdAt: string;
  };
  items!: Array<{
    id: string;
    orderId: string;
    productId: string;
    variantId: string | null;
    packageId: string | null;
    sourceRequestId: string | null;
    sellerId: string;
    supplierId: string | null;
    quantity: number;
    packageQuantity: number | null;
    pieceQuantity: number;
    unitPrice: string;
    lineTotal: string;
    currency: string;
    pricingUnit: string;
  }>;
  children!: Array<{
    id: string;
    orderCode: string;
    sellerId: string;
    supplierId: string | null;
    status: string;
    itemsTotal: string;
    grandTotal: string;
    shippingResponsibility: string;
  }>;
  links!: Array<{
    id: string;
    orderId: string;
    requestId: string;
    requestVersion: number;
    acceptedTermsHash: string | null;
  }>;
  replayed?: boolean;
}
