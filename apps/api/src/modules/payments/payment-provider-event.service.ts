import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import type { DbOrTx } from "../inventory/inventory.service";

export type ProviderEventStatus = "received" | "processing" | "processed" | "ignored" | "failed";
export type ProviderEventType =
  | "payment.created"
  | "payment.pending"
  | "payment.success"
  | "payment.failed"
  | "payment.cancelled"
  | "refund.created"
  | "refund.success"
  | "refund.failed"
  | "unknown";

function hashPayload(payload: any): string {
  const str = JSON.stringify(payload || {});
  return createHash("sha256").update(str).digest("hex").slice(0, 32);
}

/**
 * Inbox for provider events (`payment_provider_event`, owned by Payments).
 *
 * Phase 4.7.1 invariants:
 *  - identity is (provider, external_event_id) — UNIQUE in the DB; the caller
 *    supplies a deterministic id (A2), so a redelivery is a duplicate row.
 *  - `claim` is an atomic compare-and-set (`received|failed → processing`,
 *    A3): two concurrent deliveries of the same event can never both process.
 *  - `processed` is only written by the canonical path after every domain
 *    effect committed in the same transaction (A1/A4); anything else ends in
 *    `failed` (retryable) or `ignored` (terminal, e.g. unauthenticated).
 *  - only allow-listed, non-sensitive metadata is stored.
 */
@Injectable()
export class PaymentProviderEventService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  private getDb(executor?: DbOrTx): DbOrTx {
    return (executor as any) || this.db;
  }

  async recordEvent(
    input: {
      provider: string;
      externalEventId: string;
      externalPaymentReference?: string | null;
      eventType: ProviderEventType;
      safeMetadata?: any;
      payloadHash?: string;
      executor?: DbOrTx;
    },
    executor?: DbOrTx,
  ): Promise<{ id: string; isDuplicate: boolean; existingStatus?: string }> {
    const dbTx = this.getDb(executor || input.executor) as any;
    if (!input.externalEventId || !input.externalEventId.trim()) {
      throw new Error("PaymentProviderEventService.recordEvent: externalEventId is required (deterministic identity)");
    }
    const id = randomUUID();
    const payloadHash = input.payloadHash || hashPayload(input.safeMetadata);
    const sanitized = this.sanitizeMetadata(input.safeMetadata || {});
    const externalPaymentReference = input.externalPaymentReference || null;

    const result = await dbTx.execute(sql`
      INSERT INTO payment_provider_event (id, provider, external_event_id, external_payment_reference, event_type, payload_hash, safe_metadata, status, received_at, created_at, updated_at)
      VALUES (${id}, ${input.provider}, ${input.externalEventId}, ${externalPaymentReference}, ${input.eventType}, ${payloadHash}, ${JSON.stringify(sanitized)}::jsonb, 'received', NOW(), NOW(), NOW())
      ON CONFLICT (provider, external_event_id) DO NOTHING
      RETURNING id, status
    `);
    const rows = (result as any).rows || [];
    if (rows.length === 0) {
      const existing = await dbTx.execute(sql`
        SELECT id, status FROM payment_provider_event WHERE provider = ${input.provider} AND external_event_id = ${input.externalEventId} LIMIT 1
      `);
      const existingRows = (existing as any).rows || [];
      return { id: existingRows[0]?.id || id, isDuplicate: true, existingStatus: existingRows[0]?.status || "received" };
    }
    return { id: rows[0]?.id || id, isDuplicate: false };
  }

  /**
   * Atomic claim: exactly one caller wins `received|failed → processing`.
   * Returns the claimed row, or null when another worker holds/finished it.
   */
  async claim(eventId: string, executor?: DbOrTx): Promise<any | null> {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`
      UPDATE payment_provider_event
      SET status = 'processing', updated_at = NOW()
      WHERE id = ${eventId} AND status IN ('received', 'failed')
      RETURNING *
    `);
    return (result as any).rows?.[0] || null;
  }

  /** Kept for callers that already hold the claim; prefer `claim`. */
  async markProcessing(eventId: string, _provider?: string, executor?: DbOrTx) {
    const claimed = await this.claim(eventId, executor);
    return claimed !== null;
  }

  async markProcessed(eventId: string, _provider?: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    await dbTx.execute(
      sql`UPDATE payment_provider_event SET status = 'processed', processed_at = NOW(), failure_reason = NULL, updated_at = NOW() WHERE id = ${eventId} AND status = 'processing'`,
    );
  }

  async markFailed(eventId: string, providerOrReason: string, reasonOrExecutor?: string | DbOrTx, executor?: DbOrTx) {
    const dbTx = this.getDb((typeof reasonOrExecutor !== "string" ? (reasonOrExecutor as any) : executor) as any) as any;
    const reason = typeof providerOrReason === "string" && typeof reasonOrExecutor === "string" ? reasonOrExecutor : providerOrReason;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'failed', failure_reason = ${String(reason).slice(0, 500)}, updated_at = NOW() WHERE id = ${eventId}`);
  }

  async markIgnored(eventId: string, reason: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'ignored', failure_reason = ${String(reason).slice(0, 500)}, updated_at = NOW() WHERE id = ${eventId}`);
  }

  sanitizeMetadata(metadata: any): any {
    if (!metadata || typeof metadata !== "object") return {};
    const allowed = ["paymentId", "amount", "currency", "status", "reference", "provider", "eventType", "externalReference", "paymentReference", "providerReference", "refundId", "childOrderId", "orderId", "amountString", "identity", "reason"];
    const sanitized: any = {};
    for (const key of allowed) {
      const value = metadata[key];
      if (value === undefined || value === null) continue;
      if (typeof value === "bigint") sanitized[key] = value.toString();
      else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") sanitized[key] = value;
    }
    return sanitized;
  }

  async getEventByProviderAndExternalId(provider: string, externalEventId: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`SELECT * FROM payment_provider_event WHERE provider = ${provider} AND external_event_id = ${externalEventId} LIMIT 1`);
    return (result as any).rows?.[0] || null;
  }

  async getEventById(eventId: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`SELECT * FROM payment_provider_event WHERE id = ${eventId} LIMIT 1`);
    return (result as any).rows?.[0] || null;
  }

  /**
   * A worker that crashed between claim and completion leaves `processing` behind.
   * After a grace period such rows become `failed` (retryable by reconciliation).
   */
  async reclaimStaleProcessing(olderThanMinutes: number, executor?: DbOrTx): Promise<number> {
    const dbTx = this.getDb(executor) as any;
    const minutes = Math.max(1, Math.floor(olderThanMinutes));
    const result = await dbTx.execute(sql`
      UPDATE payment_provider_event
      SET status = 'failed', failure_reason = 'stale_processing_reclaimed', updated_at = NOW()
      WHERE status = 'processing' AND updated_at < NOW() - (${minutes} * INTERVAL '1 minute')
      RETURNING id
    `);
    return ((result as any).rows || []).length;
  }

  /** Events that still need work: never-claimed or failed (retryable). `processing` rows belong to a live worker. */
  async findUnresolvedEvents(limit = 20, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`SELECT * FROM payment_provider_event WHERE status IN ('received','failed') ORDER BY received_at ASC LIMIT ${limit}`);
    return (result as any).rows || [];
  }
}
