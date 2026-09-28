/**
 * Phase 4.5 — Compatibility Adapter
 * Maps canonical Nest DTOs to existing Next BFF page models
 * Do NOT change canonical schema, only adapt for existing UI
 * Edge cases: immutable snapshots, no current product name/SKU/package recipe/seller display/offer price required
 */

export type CanonicalOrderDetail = {
  order: {
    id: string;
    orderCode: string;
    status: string;
    currency: string;
    itemsTotal?: string;
    shippingTotal?: string;
    grandTotal?: string;
    totalUnits: number;
    paymentMode?: string;
    version: number;
    createdAt: string | Date;
    shippingAddressSnapshot?: any;
    billingAddressSnapshot?: any;
  };
  items: Array<{
    id: string;
    productId: string;
    variantId?: string | null;
    packageId?: string | null;
    sellerId: string;
    supplierId?: string | null;
    quantity: number;
    packageQuantity?: number | null;
    pieceQuantity: number;
    unitPrice: string;
    lineTotal: string;
    currency: string;
    pricingUnit?: string;
    productNameSnapshot?: string;
    skuSnapshot?: string;
    variantSnapshot?: any;
    sellerSnapshot?: any;
    packageTypeSnapshot?: string | null;
    packageNameSnapshot?: string | null;
    packageCompositionSnapshot?: any;
    sourceRequestId?: string;
  }>;
  children: Array<{
    id: string;
    orderCode: string;
    sellerId: string;
    supplierId?: string | null;
    status: string;
    itemsTotal?: string;
    grandTotal?: string;
    shippingResponsibility?: string;
    version?: number;
    createdAt?: string | Date;
  }>;
  links?: Array<{
    id: string;
    orderId: string;
    requestId: string;
    requestVersion: number;
    acceptedTermsHash?: string;
  }>;
};

export type BffOrderModel = {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  total_units: number;
  created_at: string;
  account_id?: string;
  wholesale_order_items: Array<{
    id: string;
    product_id: string;
    variant_id?: string | null;
    product_name: string;
    sku: string;
    quantity: number;
    unit_price: number;
  }>;
  purchase_orders?: Array<{
    id: string;
    order_code: string;
    status: string;
    supplier_id?: string | null;
    wholesale_order_id: string;
    total_amount: number;
    tracking_code?: string | null;
  }>;
  // Phase 4.5 extensions
  children?: CanonicalOrderDetail["children"];
  exceptions?: any[];
  timeline?: any[];
  replacementLinks?: any[];
};

export function canonicalToBff(detail: CanonicalOrderDetail): BffOrderModel {
  const order = detail.order;
  const items = detail.items.map((it) => ({
    id: it.id,
    product_id: it.productId,
    variant_id: it.variantId || null,
    product_name: it.productNameSnapshot || it.productId,
    sku: it.skuSnapshot || "UNKNOWN",
    quantity: it.pieceQuantity,
    unit_price: Number(it.unitPrice || 0),
  }));

  const purchase_orders = detail.children.map((c) => ({
    id: c.id,
    order_code: c.orderCode,
    status: c.status,
    supplier_id: c.supplierId || null,
    wholesale_order_id: order.id,
    total_amount: Number(c.grandTotal || c.itemsTotal || 0),
    tracking_code: null,
  }));

  return {
    id: order.id,
    order_code: order.orderCode,
    status: order.status,
    total_amount: Number(order.grandTotal || order.itemsTotal || 0),
    total_units: order.totalUnits,
    created_at: typeof order.createdAt === "string" ? order.createdAt : (order.createdAt as Date).toISOString(),
    wholesale_order_items: items,
    purchase_orders,
    children: detail.children,
  };
}

export function timelineToBff(timeline: Array<{ at: string; type: string; description: string; data: any }>) {
  // Map canonical timeline to existing UI timeline model without mutating sources
  // Example: Order created/Supplier A confirmed/B reported shortage/Buyer requested replacement/A started preparing/B portion cancelled/A shipped
  return timeline.map((t) => ({
    timestamp: t.at,
    event: t.type,
    message: t.description,
    // redact internal metadata already done in service, but ensure no PII
    meta: t.data ? { ...t.data, actorId: undefined, metadata: undefined } : undefined,
  }));
}

export function exceptionToBff(exception: any) {
  return {
    id: exception.id,
    childOrderId: exception.childOrderId,
    sellerId: exception.sellerId,
    type: exception.type,
    status: exception.status,
    reasonCode: exception.reasonCode,
    reason: exception.reason,
    affectedAmount: exception.affectedAmount,
    currency: exception.currency,
    buyerResolution: exception.buyerResolution,
    reportedAt: exception.reportedAt,
    buyerResolvedAt: exception.buyerResolvedAt,
    affectedItemsSnapshot: exception.affectedItemsSnapshot,
  };
}
