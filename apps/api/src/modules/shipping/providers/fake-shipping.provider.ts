import { Injectable, Logger } from "@nestjs/common";
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
 * Phase 4.7 — DeterministicFakeShippingProvider for CI/dev
 * TEST/DEV ONLY — production guard rejects it.
 *
 * Controllable scenarios via serviceLevel or external flags:
 * - quote_success
 * - quote_expired
 * - create_success
 * - create_failure
 * - in_transit
 * - delivered
 * - duplicate_event
 */

export type FakeShippingScenario =
  | "quote_success"
  | "quote_expired"
  | "create_success"
  | "create_failure"
  | "in_transit"
  | "delivered"
  | "duplicate_event";

type QuoteRecord = {
  quoteId: string;
  childOrderId: string;
  amount: bigint;
  scenario: FakeShippingScenario;
};

@Injectable()
export class FakeShippingProvider implements ShippingProvider {
  readonly name = "fake";
  private readonly logger = new Logger(FakeShippingProvider.name);
  private quotes = new Map<string, QuoteRecord>();
  private shipments = new Map<string, { shipmentId: string; status: string; scenario: FakeShippingScenario }>();
  private scenarioOverrides = new Map<string, FakeShippingScenario>();

  setScenario(id: string, scenario: FakeShippingScenario) {
    this.scenarioOverrides.set(id, scenario);
  }

  clear() {
    this.quotes.clear();
    this.shipments.clear();
    this.scenarioOverrides.clear();
  }

  private resolveScenario(input: { serviceLevel?: string; childOrderId?: string; shipmentId?: string }): FakeShippingScenario {
    const level = (input.serviceLevel || "").toLowerCase();
    if (level.includes("expired")) return "quote_expired";
    if (level.includes("failure")) return "create_failure";
    if (level.includes("in_transit")) return "in_transit";
    if (level.includes("delivered")) return "delivered";
    if (level.includes("duplicate")) return "duplicate_event";
    if (input.childOrderId && this.scenarioOverrides.has(input.childOrderId)) {
      return this.scenarioOverrides.get(input.childOrderId)!;
    }
    if (input.shipmentId && this.scenarioOverrides.has(input.shipmentId)) {
      return this.scenarioOverrides.get(input.shipmentId)!;
    }
    return "quote_success";
  }

  async getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    const scenario = this.resolveScenario({ serviceLevel: input.serviceLevel, childOrderId: input.childOrderId });
    if (scenario === "quote_expired") {
      // Return expired quote
      const ref = `Q-FAKE-EXP-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      const quoteId = `quote_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const record: QuoteRecord = { quoteId, childOrderId: input.childOrderId, amount: 50000n, scenario };
      this.quotes.set(quoteId, record);
      return {
        quoteId,
        quoteReference: ref,
        provider: this.name,
        amount: 50000n,
        currency: input.currency || "IRR",
        estimatedFrom: new Date(),
        estimatedTo: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000), // already expired
        snapshot: { fake: true, scenario, childOrderId: input.childOrderId, serviceLevel: input.serviceLevel },
      };
    }

    const ref = `Q-FAKE-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const quoteId = `quote_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const amount = 150000n; // deterministic 150k Rial
    const record: QuoteRecord = { quoteId, childOrderId: input.childOrderId, amount, scenario: "quote_success" };
    this.quotes.set(quoteId, record);

    return {
      quoteId,
      quoteReference: ref,
      provider: this.name,
      amount,
      currency: input.currency || "IRR",
      estimatedFrom: new Date(),
      estimatedTo: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      snapshot: { fake: true, scenario: "quote_success", childOrderId: input.childOrderId, serviceLevel: input.serviceLevel || "standard" },
    };
  }

  async createShipment(input: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    const scenario = this.resolveScenario({ serviceLevel: input.quoteSnapshot?.serviceLevel, childOrderId: input.childOrderId });
    if (scenario === "create_failure") {
      throw new Error("Fake shipping create failure");
    }

    const code = `SHP-FAKE-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const shipmentId = `ship_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const trackingCode = `TRK-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

    this.shipments.set(shipmentId, { shipmentId, status: "ready", scenario });

    this.logger.log(`Fake shipment created ${shipmentId} for child ${input.childOrderId}`);

    return {
      shipmentId,
      shipmentCode: code,
      provider: this.name,
      externalReference: `EXT-${trackingCode}`,
      trackingCode,
      trackingUrl: `https://fake-carrier.example/track/${trackingCode}`,
    };
  }

  async cancelShipment(_input: { shipmentId: string; reason?: string }): Promise<{ success: boolean; failureReason?: string }> {
    const rec = this.shipments.get(_input.shipmentId);
    if (rec) rec.status = "cancelled";
    return { success: true };
  }

  async getTracking(input: TrackingQuery): Promise<TrackingResult> {
    const rec = this.shipments.get(input.shipmentId);
    const scenario = rec?.scenario || this.resolveScenario({ shipmentId: input.shipmentId });

    if (scenario === "delivered") {
      return {
        status: "delivered",
        trackingCode: input.trackingCode,
        trackingUrl: `https://fake-carrier.example/track/${input.trackingCode}`,
        events: [
          { type: "shipment.created", at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
          { type: "shipment.in_transit", at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
          { type: "shipment.delivered", at: new Date() },
        ],
      };
    }

    if (scenario === "in_transit") {
      return {
        status: "in_transit",
        trackingCode: input.trackingCode,
        events: [
          { type: "shipment.created", at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
          { type: "shipment.in_transit", at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
        ],
      };
    }

    return {
      status: rec?.status || "pending",
      trackingCode: input.trackingCode,
    };
  }
}
