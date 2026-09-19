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

@Injectable()
export class PaymentProviderEventService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  private getDb(executor?: DbOrTx): DbOrTx {
    return (executor as any) || this.db;
  }

  async recordEvent(input: {
    provider: string;
    externalEventId: string;
    externalPaymentReference?: string;
    externalPaymentRef?: string;
    eventType: ProviderEventType;
    safeMetadata?: any;
    payloadHash?: string;
    executor?: DbOrTx;
  }, executor?: DbOrTx): Promise<{ id: string; isDuplicate: boolean; existingStatus?: string }> {
    const dbTx = this.getDb(executor || input.executor) as any;
    const id = randomUUID();
    const payloadHash = input.payloadHash || hashPayload(input.safeMetadata);
    const safeMetadata = input.safeMetadata || {};
    const sanitized = this.sanitizeMetadata(safeMetadata);
    const externalPaymentReference = (input as any).externalPaymentReference || (input as any).externalPaymentRef || null;

    try {
      const result = await dbTx.execute(sql`
        INSERT INTO payment_provider_event (id, provider, external_event_id, external_payment_ref, event_type, payload_hash, safe_metadata, status, received_at, created_at, updated_at)
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
        const existingStatus = existingRows[0]?.status || "received";
        return { id: existingRows[0]?.id || id, isDuplicate: true, existingStatus };
      }
      return { id: rows[0]?.id || id, isDuplicate: false };
    } catch (e: any) {
      if (e.code === "23505") {
        const existing = await dbTx.execute(sql`
          SELECT id, status FROM payment_provider_event WHERE provider = ${input.provider} AND external_event_id = ${input.externalEventId} LIMIT 1
        `);
        const existingRows = (existing as any).rows || [];
        return { id: existingRows[0]?.id || id, isDuplicate: true, existingStatus: existingRows[0]?.status };
      }
      throw e;
    }
  }

  async markProcessing(eventId: string, provider?: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'processing', updated_at = NOW() WHERE id = ${eventId}`);
  }

  async markProcessed(eventId: string, provider?: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'processed', processed_at = NOW(), updated_at = NOW() WHERE id = ${eventId}`);
  }

  async markFailed(eventId: string, providerOrReason: string, reasonOrExecutor?: string | DbOrTx, executor?: DbOrTx) {
    const dbTx = this.getDb((typeof reasonOrExecutor !== 'string' ? reasonOrExecutor as any : executor) as any) as any;
    const reason = typeof providerOrReason === 'string' && typeof reasonOrExecutor === 'string' ? reasonOrExecutor : providerOrReason;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'failed', failure_reason = ${reason}, updated_at = NOW() WHERE id = ${eventId}`);
  }

  async markIgnored(eventId: string, reason: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    await dbTx.execute(sql`UPDATE payment_provider_event SET status = 'ignored', failure_reason = ${reason}, updated_at = NOW() WHERE id = ${eventId}`);
  }

  private sanitizeMetadata(metadata: any): any {
    if (!metadata || typeof metadata !== "object") return {};
    const allowed = ["paymentId", "amount", "currency", "status", "reference", "provider", "eventType", "externalReference", "paymentReference", "refundId", "childOrderId", "orderId", "amountString"];
    const sanitized: any = {};
    for (const key of allowed) {
      if (metadata[key] !== undefined) sanitized[key] = metadata[key];
    }
    const forbidden = ["pan", "card", "cvv", "secret", "apiKey", "api_key", "session", "cookie", "address", "password", "iban"];
    for (const f of forbidden) {
      if (f in sanitized) delete sanitized[f];
    }
    return sanitized;
  }

  async getEventByProviderAndExternalId(provider: string, externalEventId: string, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`SELECT * FROM payment_provider_event WHERE provider = ${provider} AND external_event_id = ${externalEventId} LIMIT 1`);
    return (result as any).rows?.[0] || null;
  }

  async findUnresolvedEvents(limit = 20, executor?: DbOrTx) {
    const dbTx = this.getDb(executor) as any;
    const result = await dbTx.execute(sql`SELECT * FROM payment_provider_event WHERE status IN ('received','processing','failed') ORDER BY received_at ASC LIMIT ${limit}`);
    return (result as any).rows || [];
  }
}
