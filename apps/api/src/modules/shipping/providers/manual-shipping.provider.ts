import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ShippingProvider,
  ShippingQuoteRequest,
  ShippingQuoteResult,
  ShipmentCreateRequest,
  ShipmentCreateResult,
  TrackingQuery,
  TrackingResult,
} from "../shipping-provider.interface";

/**
 * ManualShippingProvider — operational manual shipping, no external carrier.
 * Supplier/Admin enters trusted carrier name, tracking code, handoff evidence.
 */

@Injectable()
export class ManualShippingProvider implements ShippingProvider {
  readonly name = "manual";

  async getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    // Manual quotes are 0 = NOT QUOTED per spec, but we can return 0 amount as not quoted
    // For manual, we treat shipping_total = 0 as not quoted, so quote not authoritative
    // To create authoritative quote, use fake or future carrier
    const ref = `Q-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    return {
      quoteId: `quote_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      quoteReference: ref,
      provider: this.name,
      amount: 0n,
      currency: input.currency || "IRR",
      snapshot: { manual: true, childOrderId: input.childOrderId, serviceLevel: input.serviceLevel || "standard" },
    };
  }

  async createShipment(input: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    const code = `SHP-MANUAL-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    return {
      shipmentId: `ship_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      shipmentCode: code,
      provider: this.name,
      externalReference: null as any,
    };
  }

  async cancelShipment(_input: { shipmentId: string; reason?: string }): Promise<{ success: boolean; failureReason?: string }> {
    return { success: true };
  }

  async getTracking(input: TrackingQuery): Promise<TrackingResult> {
    return {
      status: "pending",
      trackingCode: input.trackingCode,
    };
  }
}
