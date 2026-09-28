import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { retailOrder, retailOrderSuspiciousFlag } from "@kolbe/database";
import { DomainError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";

/**
 * Phase 5.11-C — manual suspicious-order flags (admin-owned operational
 * metadata, `retail_order_suspicious_flag`).
 *
 * A flag is a human review marker, NOT an enforcement state: flagging never
 * mutates the order, never cancels anything, and never moves money. One row
 * per order (unique on `retail_order_id`); re-flagging an order overwrites
 * the previous flag (including a cleared one) and clearing stamps the
 * clear columns. Every state change is audited; no-op clears (never-flagged
 * or already-cleared orders) succeed idempotently without an audit row.
 *
 * Concurrency is convergent by construction: flag is a single atomic
 * upsert, clear is a single conditional update, so racing flag/clear pairs
 * land last-writer-wins with both winners audited.
 */
@Injectable()
export class AdminOrderFlagsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async getFlag(orderId: string) {
    const [row] = await this.db
      .select()
      .from(retailOrderSuspiciousFlag)
      .where(eq(retailOrderSuspiciousFlag.retailOrderId, orderId))
      .limit(1);
    return row ?? null;
  }

  private assertReason(reason: unknown, required: boolean): void {
    // Service-level input check (the console convention: thin controllers,
    // seams own validation). Uses the existing shared VALIDATION_FAILED
    // (422) — no new error vocabulary.
    if (required && (typeof reason !== "string" || reason.length < 1 || reason.length > 500)) {
      throw new ValidationError([{ field: "reason", code: "INVALID_INPUT" }], "flag reason must be a 1–500 character string");
    }
    if (!required && reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      throw new ValidationError([{ field: "reason", code: "INVALID_INPUT" }], "clear reason must be a string of at most 500 characters");
    }
  }

  async flagOrder(orderId: string, actorId: string, reason: string) {
    this.assertReason(reason, true);
    const [order] = await this.db
      .select({ id: retailOrder.id })
      .from(retailOrder)
      .where(eq(retailOrder.id, orderId))
      .limit(1);
    if (!order) {
      throw new DomainError(404, "RETAIL_ORDER_NOT_FOUND", "retail order not found");
    }
    const attemptedId = this.makeId("rof");
    const now = new Date();
    const [flag] = await this.db
      .insert(retailOrderSuspiciousFlag)
      .values({ id: attemptedId, retailOrderId: orderId, reason, flaggedBy: actorId, flaggedAt: now })
      .onConflictDoUpdate({
        target: retailOrderSuspiciousFlag.retailOrderId,
        set: { reason, flaggedBy: actorId, flaggedAt: now, clearedBy: null, clearedAt: null, clearedReason: null },
      })
      .returning();
    await this.audit.record({
      actorId,
      actorRole: "admin",
      action: "retail_order.suspicious_flagged",
      entityType: "retail_order_suspicious_flag",
      entityId: flag.id,
      metadata: { orderId, reason },
    });
    return { flag, created: flag.id === attemptedId };
  }

  async clearFlag(orderId: string, actorId: string, reason?: string) {
    this.assertReason(reason, false);
    const now = new Date();
    const [updated] = await this.db
      .update(retailOrderSuspiciousFlag)
      .set({ clearedBy: actorId, clearedAt: now, clearedReason: reason ?? null })
      .where(and(eq(retailOrderSuspiciousFlag.retailOrderId, orderId), isNull(retailOrderSuspiciousFlag.clearedAt)))
      .returning();
    if (!updated) {
      return { flagged: false, flag: await this.getFlag(orderId), cleared: false };
    }
    await this.audit.record({
      actorId,
      actorRole: "admin",
      action: "retail_order.suspicious_cleared",
      entityType: "retail_order_suspicious_flag",
      entityId: updated.id,
      metadata: { orderId, reason: reason ?? null },
    });
    return { flagged: false, flag: updated, cleared: true };
  }
}
