import { Injectable, Inject } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import type { DbOrTx } from "../inventory/inventory.service";
import { commandIdempotency, shipment, shipmentEvent, shipmentItem, shippingQuote } from "@kolbe/database";
import { AuditService } from "../audit/audit.service";
import { DomainError, RETAIL_SHIPMENT_TRANSITIONS } from "@kolbe/shared";

/**
 * Phase 4.7.1 — ShippingService is the SINGLE WRITER of the shipping tables
 * (`shipping_quote`, `shipment`, `shipment_item`, `shipment_event`).
 *
 * It knows nothing about orders, sellers, inventory or providers: every
 * cross-domain fact (ordered quantities, financial gate, address, seller
 * membership) is resolved by the tableless `ShippingOrchestrator` through the
 * owning module's public contract and handed in as plain data (B4/B5).
 *
 * Nothing in here performs network I/O, so every method can safely run under
 * row locks (B1). Status changes go through ONE transition function that
 * enforces the formal state machine (B13) — there is no raw status overwrite.
 */

export const SHIPMENT_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["ready", "cancelled", "failed"],
  ready: ["handed_over", "cancelled", "failed"],
  handed_over: ["in_transit", "delivered", "failed"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
};

/** Allocations that still count against the ordered quantity (B11/C8). */
export const ACTIVE_ALLOCATION_STATUSES = ["pending", "ready", "handed_over", "in_transit", "delivered"] as const;
/** Goods physically gone (C5/C6). */
export const HANDED_OVER_STATUSES = ["handed_over", "in_transit", "delivered"] as const;

export class ShippingDomainError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (["QUOTE_NOT_FOUND", "SHIPMENT_NOT_FOUND", "ORDER_NOT_FOUND", "SHIPMENT_EVENT_NOT_FOUND"].includes(code)) status = 404;
    else if (["SHIPMENT_ACCESS_DENIED", "SUPPLIER_MEMBERSHIP_REQUIRED", "ROLE_NOT_ALLOWED", "PROVIDER_NOT_ALLOWED", "WEBHOOK_SIGNATURE_INVALID"].includes(code)) status = 403;
    else if (
      [
        "IDEMPOTENCY_KEY_REUSED",
        "QUOTE_EXPIRED",
        "QUOTE_ALREADY_SELECTED",
        "QUOTE_NOT_SELECTABLE",
        "SHIPMENT_QUANTITY_EXCEEDED",
        "SHIPMENT_ALREADY_DELIVERED",
        "INVALID_SHIPMENT_TRANSITION",
        "SHIPMENT_ORDER_MISMATCH",
        "SHIPMENT_RESPONSIBILITY_MISMATCH",
        "FINANCIAL_GATE_BLOCKED",
        "CHILD_ORDER_NOT_SHIPPABLE",
        "SHIPMENT_COMMAND_IN_PROGRESS",
        "RESERVATION_NOT_AVAILABLE",
      ].includes(code)
    ) status = 409;
    else if (code === "PROVIDER_ERROR") status = 502;
    super(status, code, message);
    this.name = "ShippingDomainError";
  }
}

export function hashShippingRequest(input: unknown): string {
  const canonical = JSON.stringify(input, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) sorted[k] = (val as any)[k];
      return sorted;
    }
    return val;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Deterministic ids derived from the business command → a retried command re-creates the SAME row (B3). */
export function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32)}`;
}

function shipmentEventId(): string { return `shpe_${randomUUID().replaceAll("-", "")}`; }

export type IdempotencyClaim =
  | { state: "new" }
  | { state: "pending"; resourceId: string | null }
  | { state: "completed"; resourceId: string | null; payload: any };

@Injectable()
export class ShippingService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private async withExecutor<T>(executor: DbOrTx | undefined, work: (tx: any) => Promise<T>): Promise<T> {
    if (executor) return work(executor as any);
    return this.db.transaction(async (tx) => work(tx as any));
  }

  async getDbNow(tx: any): Promise<Date> {
    const result = await tx.execute(sql`SELECT NOW() as now`);
    return new Date((result as any).rows?.[0]?.now || (result as any)[0]?.now);
  }

  // ── command idempotency (persistent, keyed by the caller's Idempotency-Key) ──
  async claimCommand(
    tx: any,
    scope: { scopeType: string; scopeId: string; commandType: string; idempotencyKey: string; requestHash: string },
  ): Promise<IdempotencyClaim> {
    const [existing] = await tx
      .select()
      .from(commandIdempotency)
      .where(
        and(
          eq(commandIdempotency.scopeType, scope.scopeType),
          eq(commandIdempotency.scopeId, scope.scopeId),
          eq(commandIdempotency.commandType, scope.commandType),
          eq(commandIdempotency.idempotencyKey, scope.idempotencyKey),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      if (existing.requestHash !== scope.requestHash) {
        throw new ShippingDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with a different payload");
      }
      if (existing.state === "completed") return { state: "completed", resourceId: existing.resultResourceId, payload: existing.resultPayload };
      return { state: "pending", resourceId: existing.resultResourceId };
    }
    const now = await this.getDbNow(tx);
    // Two workers may race for the same key before either row exists. The unique
    // index (scope_type, scope_id, command_type, idempotency_key) decides: the
    // loser's insert is a no-op and it then blocks on the winner's row until that
    // transaction commits, observing its final state — never a raw 23505.
    const inserted = await tx
      .insert(commandIdempotency)
      .values({
        id: `cid_${randomUUID().replaceAll("-", "")}`,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        commandType: scope.commandType,
        idempotencyKey: scope.idempotencyKey,
        requestHash: scope.requestHash,
        state: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: commandIdempotency.id });
    if (inserted.length > 0) return { state: "new" };
    const [winner] = await tx
      .select()
      .from(commandIdempotency)
      .where(
        and(
          eq(commandIdempotency.scopeType, scope.scopeType),
          eq(commandIdempotency.scopeId, scope.scopeId),
          eq(commandIdempotency.commandType, scope.commandType),
          eq(commandIdempotency.idempotencyKey, scope.idempotencyKey),
        ),
      )
      .for("update")
      .limit(1);
    if (!winner) throw new ShippingDomainError("IDEMPOTENCY_CLAIM_RACE", "Idempotency claim vanished during a race; retry", 409);
    if (winner.requestHash !== scope.requestHash) {
      throw new ShippingDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with a different payload");
    }
    if (winner.state === "completed") return { state: "completed", resourceId: winner.resultResourceId, payload: winner.resultPayload };
    return { state: "pending", resourceId: winner.resultResourceId };
  }

  async attachCommandResource(tx: any, scope: { scopeType: string; scopeId: string; commandType: string; idempotencyKey: string }, resourceId: string) {
    const now = await this.getDbNow(tx);
    await tx
      .update(commandIdempotency)
      .set({ resultResourceId: resourceId, updatedAt: now })
      .where(
        and(
          eq(commandIdempotency.scopeType, scope.scopeType),
          eq(commandIdempotency.scopeId, scope.scopeId),
          eq(commandIdempotency.commandType, scope.commandType),
          eq(commandIdempotency.idempotencyKey, scope.idempotencyKey),
        ),
      );
  }

  async completeCommand(tx: any, scope: { scopeType: string; scopeId: string; commandType: string; idempotencyKey: string }, resourceId: string, payload: unknown) {
    const now = await this.getDbNow(tx);
    await tx
      .update(commandIdempotency)
      .set({ state: "completed", resultResourceId: resourceId, resultPayload: payload as any, completedAt: now, updatedAt: now })
      .where(
        and(
          eq(commandIdempotency.scopeType, scope.scopeType),
          eq(commandIdempotency.scopeId, scope.scopeId),
          eq(commandIdempotency.commandType, scope.commandType),
          eq(commandIdempotency.idempotencyKey, scope.idempotencyKey),
        ),
      );
  }

  async failCommand(tx: any, scope: { scopeType: string; scopeId: string; commandType: string; idempotencyKey: string }) {
    const now = await this.getDbNow(tx);
    await tx
      .update(commandIdempotency)
      .set({ state: "failed", updatedAt: now })
      .where(
        and(
          eq(commandIdempotency.scopeType, scope.scopeType),
          eq(commandIdempotency.scopeId, scope.scopeId),
          eq(commandIdempotency.commandType, scope.commandType),
          eq(commandIdempotency.idempotencyKey, scope.idempotencyKey),
        ),
      );
  }

  // ── quotes ────────────────────────────────────────────────────────────
  /**
   * TxB of the quote flow: persist the immutable provider quote. The row id is
   * deterministic per command, so a retry after a failed TxB re-creates the
   * same quote instead of a second one (B3).
   */
  async persistQuote(input: {
    quoteId: string;
    childOrderId: string;
    provider: string;
    serviceLevel: string;
    providerResult: { quoteReference: string; amount: bigint; currency: string; estimatedFrom?: Date; estimatedTo?: Date; expiresAt?: Date; snapshot: Record<string, unknown> };
    actorId: string | null;
    actorRole: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const [existing] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, input.quoteId)).limit(1);
    if (existing) return { quote: existing, created: false };
    const now = await this.getDbNow(tx);
    const [inserted] = await tx
      .insert(shippingQuote)
      .values({
        id: input.quoteId,
        quoteReference: input.providerResult.quoteReference,
        provider: input.provider,
        childOrderId: input.childOrderId,
        serviceLevel: input.serviceLevel,
        amount: input.providerResult.amount as any,
        currency: input.providerResult.currency,
        estimatedFrom: input.providerResult.estimatedFrom || null,
        estimatedTo: input.providerResult.estimatedTo || null,
        expiresAt: input.providerResult.expiresAt || null,
        snapshot: { childOrderId: input.childOrderId, serviceLevel: input.serviceLevel, provider: input.provider, providerSnapshot: input.providerResult.snapshot } as any,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "shipping.quote_created",
        entityType: "shipping_quote",
        entityId: input.quoteId,
        after: { childOrderId: input.childOrderId, amount: input.providerResult.amount.toString(), provider: input.provider },
        metadata: { quoteReference: input.providerResult.quoteReference, provider: input.provider },
      },
      tx,
    );
    return { quote: inserted, created: true };
  }

  async getQuoteById(quoteId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const [quote] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, quoteId)).limit(1);
      if (!quote) throw new ShippingDomainError("QUOTE_NOT_FOUND", `Quote ${quoteId} not found`);
      return quote;
    });
  }

  async listQuotesForChild(childOrderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) =>
      tx.select().from(shippingQuote).where(eq(shippingQuote.childOrderId, childOrderId)).orderBy(desc(shippingQuote.createdAt)),
    );
  }

  /** Lock + select. Quote content is immutable — only `status`/`updated_at` change. */
  async selectQuote(input: { quoteId: string; actorId: string | null; actorRole: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const [quote] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, input.quoteId)).for("update").limit(1);
    if (!quote) throw new ShippingDomainError("QUOTE_NOT_FOUND", `Quote ${input.quoteId} not found`);
    if (quote.status === "selected") throw new ShippingDomainError("QUOTE_ALREADY_SELECTED", `Quote ${input.quoteId} is already selected`);
    if (quote.status !== "active") throw new ShippingDomainError("QUOTE_NOT_SELECTABLE", `Quote status ${quote.status} is not selectable`);
    const now = await this.getDbNow(tx);
    if (quote.expiresAt && new Date(quote.expiresAt).getTime() < now.getTime()) {
      await tx.update(shippingQuote).set({ status: "expired", updatedAt: now }).where(eq(shippingQuote.id, input.quoteId));
      throw new ShippingDomainError("QUOTE_EXPIRED", `Quote ${input.quoteId} expired at ${new Date(quote.expiresAt).toISOString()}`);
    }
    // Only one selected quote per child: previously selected quotes become historical (`voided`).
    const previouslySelected = await tx
      .select()
      .from(shippingQuote)
      .where(and(eq(shippingQuote.childOrderId, quote.childOrderId), eq(shippingQuote.status, "selected")))
      .for("update");
    for (const prev of previouslySelected) {
      await tx.update(shippingQuote).set({ status: "voided", updatedAt: now }).where(eq(shippingQuote.id, prev.id));
    }
    const [updated] = await tx.update(shippingQuote).set({ status: "selected", updatedAt: now }).where(eq(shippingQuote.id, input.quoteId)).returning();
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "shipping.quote_selected",
        entityType: "shipping_quote",
        entityId: input.quoteId,
        before: { status: quote.status },
        after: { status: "selected", amount: (quote.amount ?? 0n).toString(), replaced: previouslySelected.map((p: any) => p.id) },
        metadata: { childOrderId: quote.childOrderId },
      },
      tx,
    );
    return { quote: updated, previouslySelected };
  }

  // ── shipments ─────────────────────────────────────────────────────────
  /** SUM(piece_quantity) per wholesale item over allocations that still count (B11). */
  async getAllocatedQuantitiesForChild(childOrderId: string, executor: DbOrTx, statuses: readonly string[] = ACTIVE_ALLOCATION_STATUSES) {
    const tx = executor as any;
    const rows = await tx
      .select({ wholesaleOrderItemId: shipmentItem.wholesaleOrderItemId, qty: sql<string>`COALESCE(SUM(${shipmentItem.pieceQuantity}), 0)` })
      .from(shipmentItem)
      .innerJoin(shipment, eq(shipment.id, shipmentItem.shipmentId))
      .where(and(eq(shipment.childOrderId, childOrderId), inArray(shipment.status, [...statuses])))
      .groupBy(shipmentItem.wholesaleOrderItemId);
    const map = new Map<string, number>();
    for (const r of rows as any[]) map.set(r.wholesaleOrderItemId, Number(r.qty));
    return map;
  }

  /** TxA of the shipment flow: canonical `pending` shipment + immutable items. */
  async createPendingShipment(input: {
    shipmentId: string;
    wholesaleOrderId: string;
    childOrderId: string;
    sellerId: string;
    provider: string;
    shippingResponsibility: string;
    addressSnapshot: Record<string, unknown>;
    quoteSnapshot: Record<string, unknown>;
    items: Array<{ wholesaleOrderItemId: string; purchaseOrderItemId: string | null; variantId: string | null; pieceQuantity: number }>;
    actorId: string | null;
    actorRole: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const now = await this.getDbNow(tx);
    const shipmentCode = `SHP-${createHash("sha256").update(input.shipmentId).digest("hex").slice(0, 12).toUpperCase()}`;
    const [inserted] = await tx
      .insert(shipment)
      .values({
        id: input.shipmentId,
        shipmentCode,
        wholesaleOrderId: input.wholesaleOrderId,
        childOrderId: input.childOrderId,
        sellerId: input.sellerId,
        provider: input.provider,
        shippingResponsibility: input.shippingResponsibility as any,
        status: "pending",
        addressSnapshot: input.addressSnapshot as any,
        quoteSnapshot: input.quoteSnapshot as any,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const items: any[] = [];
    for (const item of input.items) {
      const [row] = await tx
        .insert(shipmentItem)
        .values({
          id: deterministicId("shpi", input.shipmentId, item.wholesaleOrderItemId),
          shipmentId: input.shipmentId,
          wholesaleOrderItemId: item.wholesaleOrderItemId,
          purchaseOrderItemId: item.purchaseOrderItemId,
          variantId: item.variantId,
          pieceQuantity: item.pieceQuantity,
          createdAt: now,
        })
        .returning();
      items.push(row);
    }
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "shipping.shipment_created",
        entityType: "shipment",
        entityId: input.shipmentId,
        after: { childOrderId: input.childOrderId, shipmentCode, provider: input.provider, itemCount: items.length, status: "pending" },
        metadata: { wholesaleOrderId: input.wholesaleOrderId, provider: input.provider },
      },
      tx,
    );
    return { shipment: inserted, items };
  }

  async lockShipment(shipmentId: string, executor: DbOrTx) {
    const tx = executor as any;
    const [row] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).for("update").limit(1);
    if (!row) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${shipmentId} not found`);
    return row;
  }

  async getShipmentItems(shipmentId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipmentItem).where(eq(shipmentItem.shipmentId, shipmentId)).orderBy(asc(shipmentItem.wholesaleOrderItemId)));
  }

  /**
   * The ONLY way a shipment changes status (B13). Caller holds the row lock.
   * `patch` may carry provider/tracking/timestamp columns; `status` itself is
   * never accepted from the outside.
   */
  async transitionShipment(input: {
    shipmentId: string;
    from: string;
    to: string;
    patch?: Partial<{ externalReference: string | null; trackingCode: string | null; trackingUrl: string | null; failureReason: string | null }>;
    actorId: string | null;
    actorRole: string;
    reason?: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const allowed = SHIPMENT_TRANSITIONS[input.from] || [];
    if (!allowed.includes(input.to)) {
      throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Shipment ${input.shipmentId}: ${input.from} → ${input.to} is not allowed`);
    }
    const now = await this.getDbNow(tx);
    const set: Record<string, unknown> = { status: input.to, updatedAt: now, ...(input.patch || {}) };
    if (input.to === "handed_over") { set.handedOverAt = now; set.shippedAt = now; }
    if (input.to === "delivered") set.deliveredAt = now;
    if (input.to === "cancelled") set.cancelledAt = now;
    const [updated] = await tx
      .update(shipment)
      .set(set as any)
      .where(and(eq(shipment.id, input.shipmentId), eq(shipment.status, input.from)))
      .returning();
    if (!updated) {
      throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Shipment ${input.shipmentId} is no longer in ${input.from}`);
    }
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: `shipping.shipment_${input.to}`,
        entityType: "shipment",
        entityId: input.shipmentId,
        before: { status: input.from },
        after: { status: input.to, trackingCodePresent: Boolean(updated.trackingCode) },
        metadata: { reason: input.reason || null, childOrderId: updated.childOrderId },
      },
      tx,
    );
    return updated;
  }

  /** Tracking data only — no status change. */
  async updateTracking(input: { shipmentId: string; trackingCode?: string | null; trackingUrl?: string | null; executor: DbOrTx }) {
    const tx = input.executor as any;
    const now = await this.getDbNow(tx);
    const [updated] = await tx
      .update(shipment)
      .set({ trackingCode: input.trackingCode ?? undefined, trackingUrl: input.trackingUrl ?? undefined, updatedAt: now } as any)
      .where(eq(shipment.id, input.shipmentId))
      .returning();
    return updated;
  }

  async getShipmentById(shipmentId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const [row] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
      if (!row) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${shipmentId} not found`);
      const items = await tx.select().from(shipmentItem).where(eq(shipmentItem.shipmentId, shipmentId)).orderBy(asc(shipmentItem.wholesaleOrderItemId));
      return { shipment: row, items };
    });
  }

  async listShipmentsForOrder(wholesaleOrderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipment).where(eq(shipment.wholesaleOrderId, wholesaleOrderId)).orderBy(asc(shipment.createdAt)));
  }

  async listShipmentsForChild(childOrderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipment).where(eq(shipment.childOrderId, childOrderId)).orderBy(asc(shipment.createdAt)));
  }

  async listShipmentsForSeller(sellerId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipment).where(eq(shipment.sellerId, sellerId)).orderBy(desc(shipment.createdAt)).limit(200));
  }

  async findShipmentByProviderReference(input: { provider: string; externalReference?: string | null; trackingCode?: string | null }, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      if (input.externalReference) {
        const [row] = await tx.select().from(shipment).where(and(eq(shipment.provider, input.provider), eq(shipment.externalReference, input.externalReference))).limit(1);
        if (row) return row;
      }
      if (input.trackingCode) {
        const [row] = await tx.select().from(shipment).where(and(eq(shipment.provider, input.provider), eq(shipment.trackingCode, input.trackingCode))).limit(1);
        if (row) return row;
      }
      return null;
    });
  }

  /** Provider-backed shipments whose external state may have moved without us noticing (B18). */
  async findShipmentsNeedingReconciliation(input: { provider: string; limit: number; pendingOlderThanSeconds: number }, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const rows = await tx
        .select()
        .from(shipment)
        .where(
          and(
            eq(shipment.provider, input.provider),
            sql`(
              (${shipment.status} = 'pending' AND ${shipment.createdAt} < NOW() - make_interval(secs => ${input.pendingOlderThanSeconds}))
              OR ${shipment.status} IN ('handed_over', 'in_transit')
            )`,
          ),
        )
        .orderBy(asc(shipment.createdAt))
        .limit(input.limit);
      return rows;
    });
  }

  // ── carrier event inbox (B16/B17) ─────────────────────────────────────
  private sanitizeMetadata(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== "object") return {};
    const allowed = ["shipmentId", "status", "state", "reportedState", "trackingCode", "provider", "eventType", "externalReference", "childOrderId", "orderId", "retailOrderId", "trigger", "reason"];
    const out: Record<string, unknown> = {};
    for (const key of allowed) if ((metadata as any)[key] !== undefined) out[key] = (metadata as any)[key];
    return out;
  }

  /** Persist a normalised carrier event exactly once (provider + external id). */
  async persistShipmentEvent(input: {
    shipmentId: string | null;
    provider: string;
    externalEventId: string;
    eventType: string;
    safeMetadata?: Record<string, unknown>;
    payloadHash?: string;
    executor?: DbOrTx;
  }) {
    return this.withExecutor(input.executor, async (tx) => {
      const id = shipmentEventId();
      const sanitized = this.sanitizeMetadata(input.safeMetadata);
      const payloadHash = input.payloadHash || hashShippingRequest(sanitized);
      const inserted = await tx.execute(sql`
        INSERT INTO shipment_event (id, shipment_id, provider, external_event_id, event_type, payload_hash, safe_metadata, status, received_at, created_at, updated_at)
        VALUES (${id}, ${input.shipmentId}, ${input.provider}, ${input.externalEventId}, ${input.eventType}, ${payloadHash}, ${JSON.stringify(sanitized)}::jsonb, 'received', NOW(), NOW(), NOW())
        ON CONFLICT (provider, external_event_id) DO NOTHING
        RETURNING id, status`);
      const rows = (inserted as any).rows || [];
      if (rows.length > 0) return { id: rows[0].id as string, status: "received" as string, duplicate: false };
      const existing = await tx.execute(sql`SELECT id, status FROM shipment_event WHERE provider = ${input.provider} AND external_event_id = ${input.externalEventId} LIMIT 1`);
      const row = ((existing as any).rows || [])[0];
      return { id: row.id as string, status: row.status as string, duplicate: true };
    });
  }

  /** Atomic claim: received|failed → processing. Exactly one worker wins. */
  async claimShipmentEvent(eventId: string, executor?: DbOrTx): Promise<{ claimed: boolean; status: string }> {
    return this.withExecutor(executor, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE shipment_event SET status = 'processing', updated_at = NOW()
        WHERE id = ${eventId} AND status IN ('received', 'failed')
        RETURNING id`);
      if (((result as any).rows || []).length > 0) return { claimed: true, status: "processing" };
      const current = await tx.execute(sql`SELECT status FROM shipment_event WHERE id = ${eventId} LIMIT 1`);
      const row = ((current as any).rows || [])[0];
      if (!row) throw new ShippingDomainError("SHIPMENT_EVENT_NOT_FOUND", `Shipment event ${eventId} not found`);
      return { claimed: false, status: row.status as string };
    });
  }

  async finishShipmentEvent(input: { eventId: string; status: "processed" | "ignored" | "failed"; shipmentId?: string | null; failureReason?: string | null; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE shipment_event
        SET status = ${input.status},
            shipment_id = COALESCE(${input.shipmentId ?? null}, shipment_id),
            failure_reason = ${input.failureReason ?? null},
            processed_at = CASE WHEN ${input.status} = 'processed' THEN NOW() ELSE processed_at END,
            updated_at = NOW()
        WHERE id = ${input.eventId} AND status = 'processing'
        RETURNING id`);
      return ((result as any).rows || []).length > 0;
    });
  }

  async getShipmentEventById(eventId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const [row] = await tx.select().from(shipmentEvent).where(eq(shipmentEvent.id, eventId)).limit(1);
      return row || null;
    });
  }

  async findUnresolvedShipmentEvents(input: { provider?: string; limit: number }, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const conditions = [inArray(shipmentEvent.status, ["received", "failed"])];
      if (input.provider) conditions.push(eq(shipmentEvent.provider, input.provider));
      return tx.select().from(shipmentEvent).where(and(...conditions)).orderBy(asc(shipmentEvent.receivedAt)).limit(input.limit);
    });
  }

  /** Events stuck in `processing` (worker died) become claimable again. */
  async reclaimStaleProcessingEvents(minutes: number, executor?: DbOrTx): Promise<number> {
    return this.withExecutor(executor, async (tx) => {
      const result = await tx.execute(sql`
        UPDATE shipment_event SET status = 'failed', failure_reason = 'stale_processing_reclaimed', updated_at = NOW()
        WHERE status = 'processing' AND updated_at < NOW() - make_interval(mins => ${minutes})
        RETURNING id`);
      return ((result as any).rows || []).length;
    });
  }

  async listShipmentEvents(shipmentId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipmentEvent).where(eq(shipmentEvent.shipmentId, shipmentId)).orderBy(asc(shipmentEvent.receivedAt)));
  }

  // ── Phase 5.8-C — retail shipments ──────────────────────────────────
  // Retail shipments live in the same tables (the single-side CHECK keeps
  // the channels apart) but move under their own transition table. No
  // wholesale method above is reused for retail rows, and no retail method
  // below reads or writes wholesale linkage: cross-channel access fails
  // closed at this layer, not in the caller.

  /** TxA of the retail shipment flow: canonical `pending` shipment + immutable items. */
  async createRetailPendingShipment(input: {
    shipmentId: string;
    retailOrderId: string;
    sellerId: string;
    provider: string;
    shippingResponsibility: string;
    addressSnapshot: Record<string, unknown>;
    quoteSnapshot: Record<string, unknown>;
    items: Array<{ retailOrderItemId: string; variantId: string | null; pieceQuantity: number }>;
    actorId: string | null;
    actorRole: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const now = await this.getDbNow(tx);
    const shipmentCode = `RSHP-${createHash("sha256").update(input.shipmentId).digest("hex").slice(0, 12).toUpperCase()}`;
    const [inserted] = await tx
      .insert(shipment)
      .values({
        id: input.shipmentId,
        shipmentCode,
        wholesaleOrderId: null,
        childOrderId: null,
        retailOrderId: input.retailOrderId,
        sellerId: input.sellerId,
        provider: input.provider,
        shippingResponsibility: input.shippingResponsibility as any,
        status: "pending",
        addressSnapshot: input.addressSnapshot as any,
        quoteSnapshot: input.quoteSnapshot as any,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const items: any[] = [];
    for (const item of input.items) {
      const [row] = await tx
        .insert(shipmentItem)
        .values({
          id: deterministicId("shpi", input.shipmentId, item.retailOrderItemId),
          shipmentId: input.shipmentId,
          wholesaleOrderItemId: null,
          retailOrderItemId: item.retailOrderItemId,
          purchaseOrderItemId: null,
          variantId: item.variantId,
          pieceQuantity: item.pieceQuantity,
          createdAt: now,
        })
        .returning();
      items.push(row);
    }
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "shipping.shipment_created",
        entityType: "shipment",
        entityId: input.shipmentId,
        after: { shipmentCode, itemCount: items.length, status: "pending" },
        metadata: { retailOrderId: input.retailOrderId, provider: input.provider },
      },
      tx,
    );
    return { shipment: inserted, items };
  }

  /**
   * The ONLY way a retail shipment changes status. Same mechanics as the
   * wholesale transition (table check, lock-free compare-and-set, timestamp
   * side-effects, audit) but under `RETAIL_SHIPMENT_TRANSITIONS`, and it
   * refuses wholesale rows outright. Caller holds the row lock.
   */
  async transitionRetailShipment(input: {
    shipmentId: string;
    from: string;
    to: string;
    patch?: Partial<{ externalReference: string | null; trackingCode: string | null; trackingUrl: string | null; failureReason: string | null }>;
    actorId: string | null;
    actorRole: string;
    reason?: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const allowed = (RETAIL_SHIPMENT_TRANSITIONS as Record<string, readonly string[]>)[input.from] || [];
    if (!allowed.includes(input.to)) {
      throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Retail shipment ${input.shipmentId}: ${input.from} → ${input.to} is not allowed`);
    }
    const now = await this.getDbNow(tx);
    const set: Record<string, unknown> = { status: input.to, updatedAt: now, ...(input.patch || {}) };
    if (input.to === "handed_over") { set.handedOverAt = now; set.shippedAt = now; }
    if (input.to === "delivered") set.deliveredAt = now;
    if (input.to === "cancelled") set.cancelledAt = now;
    const [updated] = await tx
      .update(shipment)
      .set(set as any)
      .where(and(eq(shipment.id, input.shipmentId), eq(shipment.status, input.from), sql`${shipment.retailOrderId} IS NOT NULL`))
      .returning();
    if (!updated) {
      throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Retail shipment ${input.shipmentId} is no longer in ${input.from} (or is not a retail shipment)`);
    }
    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: `shipping.shipment_${input.to}`,
        entityType: "shipment",
        entityId: input.shipmentId,
        before: { status: input.from },
        after: { status: input.to, trackingCodePresent: Boolean(updated.trackingCode) },
        metadata: { reason: input.reason || null, retailOrderId: updated.retailOrderId },
      },
      tx,
    );
    return updated;
  }

  /** Retail-scoped read: wholesale rows are invisible here (fail closed). */
  async getRetailShipmentById(shipmentId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const [row] = await tx.select().from(shipment).where(and(eq(shipment.id, shipmentId), sql`${shipment.retailOrderId} IS NOT NULL`)).limit(1);
      if (!row) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Retail shipment ${shipmentId} not found`);
      const items = await tx.select().from(shipmentItem).where(eq(shipmentItem.shipmentId, shipmentId)).orderBy(asc(shipmentItem.retailOrderItemId));
      return { shipment: row, items };
    });
  }

  async listRetailShipments(retailOrderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => tx.select().from(shipment).where(eq(shipment.retailOrderId, retailOrderId)).orderBy(asc(shipment.createdAt)));
  }

  /**
   * Phase 5.11-A — Retail Admin shipment queue (READ seam). Retail-side rows
   * only (`retail_order_id` IS NOT NULL — wholesale rows are invisible),
   * fixed parameterized filters, keyset on (created_at DESC, id DESC).
   * Returns at most `limit + 1` rows so the caller can page.
   */
  async listRetailShipmentsForAdmin(input: {
    retailOrderId?: string | null;
    status?: string | null;
    limit?: number;
    cursor?: [string, string] | null;
  }): Promise<Array<Record<string, unknown>>> {
    const db = this.db as any;
    const conditions: any[] = [sql`${shipment.retailOrderId} IS NOT NULL`];
    if (input.retailOrderId) conditions.push(eq(shipment.retailOrderId, input.retailOrderId));
    if (input.status) conditions.push(eq(shipment.status, input.status));
    if (input.cursor) {
      conditions.push(sql`(${shipment.createdAt}, ${shipment.id}) < (${input.cursor[0]}::timestamptz, ${input.cursor[1]})`);
    }
    const limit = input.limit ?? 20;
    const rows = (await db
      .select()
      .from(shipment)
      .where(and(...conditions))
      .orderBy(sql`${shipment.createdAt} DESC, ${shipment.id} DESC`)
      .limit(limit + 1)) as any[];
    return rows.map((row) => ({
      id: row.id,
      shipmentCode: row.shipmentCode,
      retailOrderId: row.retailOrderId,
      provider: row.provider,
      status: row.status,
      trackingCode: row.trackingCode ?? null,
      trackingUrl: row.trackingUrl ?? null,
      externalReference: row.externalReference ?? null,
      failureReason: row.failureReason ?? null,
      handedOverAt: row.handedOverAt ?? null,
      shippedAt: row.shippedAt ?? null,
      deliveredAt: row.deliveredAt ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  /**
   * Phase 5.11-A — per-order LATEST retail shipment status for operational
   * lists (a real fact; orders with no shipment are absent from the map).
   * Owner read: retail-side rows only, bounded by the page's order ids.
   */
  async latestRetailShipmentStatusesByOrderIds(retailOrderIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (retailOrderIds.length === 0) return out;
    const db = this.db as any;
    const rows = (await db
      .select({
        retailOrderId: shipment.retailOrderId,
        status: shipment.status,
        createdAt: shipment.createdAt,
      })
      .from(shipment)
      .where(inArray(shipment.retailOrderId, retailOrderIds))) as any[];
    const latest = new Map<string, { status: string; createdAt: Date }>();
    for (const row of rows) {
      if (row.retailOrderId == null) continue;
      const seen = latest.get(row.retailOrderId);
      if (!seen || row.createdAt.getTime() >= seen.createdAt.getTime()) {
        latest.set(row.retailOrderId, { status: row.status, createdAt: row.createdAt });
      }
    }
    for (const [orderId, value] of latest) out.set(orderId, value.status);
    return out;
  }

  async findRetailShipmentByProviderRef(input: { provider: string; externalReference?: string | null; trackingCode?: string | null }, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      if (input.externalReference) {
        const [row] = await tx
          .select()
          .from(shipment)
          .where(and(eq(shipment.provider, input.provider), eq(shipment.externalReference, input.externalReference), sql`${shipment.retailOrderId} IS NOT NULL`))
          .limit(1);
        if (row) return row;
      }
      if (input.trackingCode) {
        const [row] = await tx
          .select()
          .from(shipment)
          .where(and(eq(shipment.provider, input.provider), eq(shipment.trackingCode, input.trackingCode), sql`${shipment.retailOrderId} IS NOT NULL`))
          .limit(1);
        if (row) return row;
      }
      return null;
    });
  }

  /** Retail mirror of `getAllocatedQuantitiesForChild`: shipped qty per retail line over the given statuses. */
  async getAllocatedQuantitiesForRetailOrder(retailOrderId: string, executor: DbOrTx, statuses: readonly string[] = ACTIVE_ALLOCATION_STATUSES) {
    const tx = executor as any;
    const rows = await tx
      .select({ retailOrderItemId: shipmentItem.retailOrderItemId, qty: sql<string>`COALESCE(SUM(${shipmentItem.pieceQuantity}), 0)` })
      .from(shipmentItem)
      .innerJoin(shipment, eq(shipment.id, shipmentItem.shipmentId))
      .where(and(eq(shipment.retailOrderId, retailOrderId), inArray(shipment.status, [...statuses])))
      .groupBy(shipmentItem.retailOrderItemId);
    const map = new Map<string, number>();
    for (const r of rows as any[]) map.set(r.retailOrderItemId, Number(r.qty));
    return map;
  }
}
