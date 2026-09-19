/**
 * Phase 4.7 — ShippingProvider contract
 * Provider-independent DTOs only, no Catalog re-read.
 */

export type ShippingQuoteRequest = {
  childOrderId: string;
  sellerId: string;
  wholesaleOrderId: string;
  serviceLevel?: string;
  currency?: string;
  idempotencyKey?: string;
};

export type ShippingQuoteResult = {
  quoteId: string;
  quoteReference: string;
  provider: string;
  amount: bigint;
  currency: string;
  estimatedFrom?: Date;
  estimatedTo?: Date;
  expiresAt?: Date;
  snapshot: any;
};

export type ShipmentCreateRequest = {
  wholesaleOrderId: string;
  childOrderId: string;
  sellerId: string;
  shippingResponsibility: "SUPPLIER" | "KOLBE" | "EXTERNAL_CARRIER";
  provider: string;
  addressSnapshot: any;
  quoteSnapshot?: any;
  items: Array<{
    wholesaleOrderItemId: string;
    purchaseOrderItemId?: string;
    variantId?: string;
    pieceQuantity: number;
  }>;
  idempotencyKey?: string;
};

export type ShipmentCreateResult = {
  shipmentId: string;
  shipmentCode: string;
  provider: string;
  externalReference?: string;
  trackingCode?: string;
  trackingUrl?: string;
};

export type TrackingQuery = {
  shipmentId: string;
  externalReference?: string;
  trackingCode?: string;
};

export type TrackingResult = {
  status: string;
  trackingCode?: string;
  trackingUrl?: string;
  estimatedDelivery?: Date;
  events?: Array<{ type: string; at: Date; description?: string }>;
};

export interface ShippingProvider {
  readonly name: string;
  getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult>;
  createShipment(input: ShipmentCreateRequest): Promise<ShipmentCreateResult>;
  cancelShipment(input: { shipmentId: string; reason?: string }): Promise<{ success: boolean; failureReason?: string }>;
  getTracking(input: TrackingQuery): Promise<TrackingResult>;
}
