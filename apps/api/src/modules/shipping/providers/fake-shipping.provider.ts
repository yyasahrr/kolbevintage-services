import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  CarrierState,
  NormalizedCarrierWebhook,
  ProviderWebhookRequest,
  ShipmentCreateRequest,
  ShipmentCreateResult,
  ShippingProvider,
  ShippingQuoteRequest,
  ShippingQuoteResult,
  TrackingQuery,
  TrackingResult,
} from "../shipping-provider.interface";

/**
 * Phase 4.7.1 — deterministic FakeShippingProvider (TEST/DEV ONLY; the registry
 * refuses to resolve it when NODE_ENV=production — A10).
 *
 * It behaves like a real carrier API for the properties the orchestrator relies on:
 *   • idempotent on `idempotencyKey` (quote + shipment) so crash/retry never
 *     creates a second external shipment (B2/B3);
 *   • controllable outages (`failNextCreateShipment`, `failNextQuote`,
 *     `failNextTracking`) to simulate provider timeouts;
 *   • an external tracking state per shipment (`setCarrierState`) that
 *     `getTracking` reports — the orchestrator treats it as authoritative;
 *   • authenticated webhooks (`x-fake-shipping-signature` shared secret) with a
 *     deterministic event id (`eventId` or a sha256 fingerprint of the payload).
 *
 * It owns no domain tables and never touches the database.
 */

type ExternalShipment = {
  externalReference: string;
  trackingCode: string;
  trackingUrl: string;
  state: CarrierState;
  createCalls: number;
};

@Injectable()
export class FakeShippingProvider implements ShippingProvider {
  readonly name = "fake";
  readonly supportsWebhooks = true;
  private readonly logger = new Logger(FakeShippingProvider.name);

  private readonly quotesByKey = new Map<string, ShippingQuoteResult>();
  private readonly quoteCalls = new Map<string, number>();
  private readonly shipmentsByKey = new Map<string, ExternalShipment>();
  private readonly shipmentsByReference = new Map<string, ExternalShipment>();
  private quoteFailures = 0;
  private createFailures = 0;
  private trackingFailures = 0;
  private quoteAmountOverride: bigint | null = null;
  private quoteExpiresInMs: number | null = null;

  // ── test controls ─────────────────────────────────────────────────────
  clear() {
    this.quotesByKey.clear();
    this.quoteCalls.clear();
    this.shipmentsByKey.clear();
    this.shipmentsByReference.clear();
    this.quoteFailures = 0;
    this.createFailures = 0;
    this.trackingFailures = 0;
    this.quoteAmountOverride = null;
    this.quoteExpiresInMs = null;
  }
  failNextQuote(times = 1) { this.quoteFailures = times; }
  failNextCreateShipment(times = 1) { this.createFailures = times; }
  failNextTracking(times = 1) { this.trackingFailures = times; }
  setNextQuoteAmount(amount: bigint | null) { this.quoteAmountOverride = amount; }
  /** Negative values produce an already-expired quote. */
  setNextQuoteExpiry(ms: number | null) { this.quoteExpiresInMs = ms; }
  setCarrierState(externalReference: string, state: CarrierState) {
    const rec = this.shipmentsByReference.get(externalReference);
    if (!rec) throw new Error(`fake shipping: unknown external reference ${externalReference}`);
    rec.state = state;
  }
  externalShipmentCount(): number { return this.shipmentsByReference.size; }
  externalShipmentByKey(key: string): ExternalShipment | undefined { return this.shipmentsByKey.get(key); }
  createCallsFor(key: string): number { return this.shipmentsByKey.get(key)?.createCalls ?? 0; }
  quoteCallsFor(key: string): number { return this.quoteCalls.get(key) ?? 0; }

  static webhookSecret(): string {
    return process.env.FAKE_SHIPPING_WEBHOOK_SECRET || "fake-shipping-webhook-secret";
  }

  private static fingerprint(input: unknown): string {
    const canonical = JSON.stringify(input, (_k, v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) sorted[k] = (v as any)[k];
        return sorted;
      }
      return v;
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  // ── provider contract ─────────────────────────────────────────────────
  async getQuote(input: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    this.quoteCalls.set(input.idempotencyKey, (this.quoteCalls.get(input.idempotencyKey) ?? 0) + 1);
    if (this.quoteFailures > 0) {
      this.quoteFailures--;
      throw new Error("fake shipping: quote service unavailable");
    }
    const existing = this.quotesByKey.get(input.idempotencyKey);
    if (existing) return existing;
    const level = (input.serviceLevel || "standard").toLowerCase();
    const digest = FakeShippingProvider.fingerprint({ key: input.idempotencyKey, child: input.childOrderId });
    const amount = this.quoteAmountOverride ?? (level === "express" ? 300_000n : 150_000n);
    const expiresIn = this.quoteExpiresInMs ?? 24 * 60 * 60 * 1000;
    this.quoteAmountOverride = null;
    this.quoteExpiresInMs = null;
    const now = Date.now();
    const result: ShippingQuoteResult = {
      quoteReference: `Q-FAKE-${digest.slice(0, 12).toUpperCase()}`,
      provider: this.name,
      amount,
      currency: input.currency || "IRR",
      estimatedFrom: new Date(now + 24 * 60 * 60 * 1000),
      estimatedTo: new Date(now + 3 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(now + expiresIn),
      snapshot: { fake: true, serviceLevel: level, childOrderId: input.childOrderId },
    };
    this.quotesByKey.set(input.idempotencyKey, result);
    return result;
  }

  async createShipment(input: ShipmentCreateRequest): Promise<ShipmentCreateResult> {
    const key = input.idempotencyKey || input.shipmentId;
    const existing = this.shipmentsByKey.get(key);
    if (existing) {
      existing.createCalls++;
      return { provider: this.name, externalReference: existing.externalReference, trackingCode: existing.trackingCode, trackingUrl: existing.trackingUrl, replayed: true };
    }
    if (this.createFailures > 0) {
      this.createFailures--;
      throw new Error("fake shipping: create shipment timed out");
    }
    const digest = FakeShippingProvider.fingerprint({ key, child: input.childOrderId, items: input.items });
    const trackingCode = `TRK-${digest.slice(0, 10).toUpperCase()}`;
    const rec: ExternalShipment = {
      externalReference: `EXT-${digest.slice(10, 22).toUpperCase()}`,
      trackingCode,
      trackingUrl: `https://fake-carrier.example/track/${trackingCode}`,
      state: "created",
      createCalls: 1,
    };
    this.shipmentsByKey.set(key, rec);
    this.shipmentsByReference.set(rec.externalReference, rec);
    this.logger.debug(`fake shipment created ${rec.externalReference} for ${input.shipmentId}`);
    return { provider: this.name, externalReference: rec.externalReference, trackingCode: rec.trackingCode, trackingUrl: rec.trackingUrl, replayed: false };
  }

  async cancelShipment(input: { shipmentId: string; externalReference?: string | null; reason?: string }): Promise<{ success: boolean; failureReason?: string }> {
    const rec = input.externalReference ? this.shipmentsByReference.get(input.externalReference) : this.shipmentsByKey.get(input.shipmentId);
    if (!rec) return { success: true };
    if (rec.state === "delivered" || rec.state === "in_transit") return { success: false, failureReason: `carrier_state_${rec.state}` };
    rec.state = "cancelled";
    return { success: true };
  }

  async getTracking(input: TrackingQuery): Promise<TrackingResult> {
    if (this.trackingFailures > 0) {
      this.trackingFailures--;
      throw new Error("fake shipping: tracking service unavailable");
    }
    const rec = (input.externalReference && this.shipmentsByReference.get(input.externalReference)) || this.shipmentsByKey.get(input.shipmentId);
    if (!rec) return { state: "unknown", trackingCode: input.trackingCode ?? null };
    return { state: rec.state, trackingCode: rec.trackingCode, trackingUrl: rec.trackingUrl, externalReference: rec.externalReference };
  }

  parseWebhook(request: ProviderWebhookRequest): NormalizedCarrierWebhook | null {
    const headers = request.headers || {};
    const raw = headers["x-fake-shipping-signature"];
    const signature = Array.isArray(raw) ? raw[0] : raw;
    if (!signature || signature !== FakeShippingProvider.webhookSecret()) return null;
    const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
    const externalReference = typeof body.externalReference === "string" ? body.externalReference : null;
    const trackingCode = typeof body.trackingCode === "string" ? body.trackingCode : null;
    const stateRaw = String(body.state || body.status || "unknown").toLowerCase();
    const reportedState: CarrierState = (["created", "in_transit", "delivered", "failed", "cancelled"] as CarrierState[]).includes(stateRaw as CarrierState)
      ? (stateRaw as CarrierState)
      : "unknown";
    const externalEventId = typeof body.eventId === "string" && body.eventId.trim()
      ? body.eventId.trim()
      : `fs_${FakeShippingProvider.fingerprint({ externalReference, trackingCode, state: reportedState })}`;
    return {
      externalEventId,
      externalReference,
      trackingCode,
      reportedState,
      safeMetadata: { provider: this.name, reportedState, externalReference, trackingCode },
    };
  }
}
