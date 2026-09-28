/**
 * Phase 4.7 / 4.7.1 — ShippingProvider contract.
 *
 * Provider-independent DTOs only. Adapters own NO tables and never read the
 * catalog/orders: everything they need is handed to them by the tableless
 * `ShippingOrchestrator`, and every network call happens OUTSIDE database
 * transactions (B1). Adapters must be idempotent on `idempotencyKey` (B2/B3):
 * a retried quote/shipment request with the same key returns the same
 * external quote/shipment instead of creating a second one.
 */

export type ShippingQuoteRequest = {
  childOrderId: string;
  sellerId: string;
  wholesaleOrderId: string;
  serviceLevel?: string;
  currency?: string;
  /** Stable per business command; providers MUST dedupe on it. */
  idempotencyKey: string;
};

export type ShippingQuoteResult = {
  quoteReference: string;
  provider: string;
  amount: bigint;
  currency: string;
  estimatedFrom?: Date;
  estimatedTo?: Date;
  expiresAt?: Date;
  snapshot: Record<string, unknown>;
};

export type ShipmentCreateRequest = {
  /** Canonical shipment id — doubles as the provider idempotency identity (persisted BEFORE the call). */
  shipmentId: string;
  shipmentCode: string;
  /**
   * Order linkage, exactly one side set (mirrors the `shipment_single_order_side`
   * CHECK). Wholesale passes the wholesale side; Phase 5.8-C retail passes
   * `retailOrderId` with the wholesale side unset. Callers validate; adapters
   * must treat the unset side as absent, never as an empty string.
   */
  wholesaleOrderId?: string | null;
  childOrderId?: string | null;
  /** Phase 5.8-C — set only for retail shipments (KOLBE seller, KOLBE responsibility). */
  retailOrderId?: string | null;
  sellerId: string;
  shippingResponsibility: "SUPPLIER" | "KOLBE" | "EXTERNAL_CARRIER";
  /** Server-derived fulfillment address (never client supplied). */
  addressSnapshot: Record<string, unknown>;
  quoteSnapshot?: Record<string, unknown>;
  items: Array<{ wholesaleOrderItemId?: string | null; retailOrderItemId?: string | null; variantId?: string | null; pieceQuantity: number }>;
  idempotencyKey: string;
};

export type ShipmentCreateResult = {
  provider: string;
  externalReference: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  /** true when the provider recognised `idempotencyKey` and returned the earlier shipment. */
  replayed?: boolean;
};

export type TrackingQuery = {
  shipmentId: string;
  externalReference?: string | null;
  trackingCode?: string | null;
};

/** Normalised carrier states. `unknown` is never authoritative. */
export type CarrierState = "created" | "in_transit" | "delivered" | "failed" | "cancelled" | "unknown";

export type TrackingResult = {
  state: CarrierState;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  externalReference?: string | null;
  estimatedDelivery?: Date;
  events?: Array<{ type: string; at: Date; description?: string }>;
};

export type ProviderWebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

/** What an adapter extracts from an authenticated carrier webhook. No PII, no secrets. */
export type NormalizedCarrierWebhook = {
  /** Deterministic: provider event id, or a fingerprint of the canonical payload. */
  externalEventId: string;
  externalReference: string | null;
  trackingCode: string | null;
  /** Carrier-reported state (informational — the orchestrator re-queries `getTracking`). */
  reportedState: CarrierState;
  safeMetadata: Record<string, unknown>;
};

export interface ShippingProvider {
  readonly name: string;
  readonly supportsWebhooks: boolean;
  getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult>;
  createShipment(input: ShipmentCreateRequest): Promise<ShipmentCreateResult>;
  cancelShipment(input: { shipmentId: string; externalReference?: string | null; reason?: string }): Promise<{ success: boolean; failureReason?: string }>;
  getTracking(input: TrackingQuery): Promise<TrackingResult>;
  /**
   * Authenticate + normalise a webhook. MUST return `null` when the request is
   * not authentic (wrong signature/secret) — the orchestrator then rejects it
   * without persisting anything.
   */
  parseWebhook?(request: ProviderWebhookRequest): NormalizedCarrierWebhook | null;
}
