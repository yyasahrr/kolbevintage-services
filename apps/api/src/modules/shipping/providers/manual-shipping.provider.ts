import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  ShipmentCreateRequest,
  ShipmentCreateResult,
  ShippingProvider,
  ShippingQuoteRequest,
  ShippingQuoteResult,
  TrackingQuery,
  TrackingResult,
} from "../shipping-provider.interface";

/**
 * ManualShippingProvider — operational manual shipping without an external carrier.
 *
 * • Quotes are `amount = 0` which means NOT QUOTED (D1) — never "free".
 * • `createShipment` performs no external call and returns no external
 *   reference; tracking is entered by the supplier at handoff.
 * • `getTracking` is never authoritative (`unknown`), so reconciliation never
 *   moves a manual shipment on its own: humans do (handoff / delivered).
 * • No webhook channel (`supportsWebhooks = false`).
 */
@Injectable()
export class ManualShippingProvider implements ShippingProvider {
  readonly name = "manual";
  readonly supportsWebhooks = false;

  async getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    const digest = createHash("sha256").update(`${input.childOrderId}:${input.idempotencyKey}`).digest("hex");
    return {
      quoteReference: `Q-MANUAL-${digest.slice(0, 12).toUpperCase()}`,
      provider: this.name,
      amount: 0n,
      currency: input.currency || "IRR",
      snapshot: { manual: true, notQuoted: true, childOrderId: input.childOrderId, serviceLevel: input.serviceLevel || "standard" },
    };
  }

  async createShipment(_input: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    return { provider: this.name, externalReference: null, trackingCode: null, trackingUrl: null, replayed: false };
  }

  async cancelShipment(_input: { shipmentId: string; externalReference?: string | null; reason?: string }): Promise<{ success: boolean; failureReason?: string }> {
    return { success: true };
  }

  async getTracking(input: TrackingQuery): Promise<TrackingResult> {
    return { state: "unknown", trackingCode: input.trackingCode ?? null };
  }
}
