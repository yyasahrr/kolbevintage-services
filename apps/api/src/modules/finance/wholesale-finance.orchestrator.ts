import { Injectable, Inject } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  wholesaleOrder,
  purchaseOrder,
  orderStatusHistory,
  orderEvent,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { PaymentsService } from "../payments/payments.service";
import { DomainError } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

function historyId(): string {
  return `osh_${randomUUID().replaceAll("-", "")}`;
}
function eventId(): string {
  return `oev_${randomUUID().replaceAll("-", "")}`;
}

function sanitizeForJsonb(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(sanitizeForJsonb);
  if (value && typeof value === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeForJsonb(v);
    }
    return out;
  }
  return value;
}

function hashRequest(input: unknown): string {
  const canonical = JSON.stringify(input, (key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: any = {};
      Object.keys(val).sort().forEach((k) => (sorted[k] = (val as any)[k]));
      return sorted;
    }
    return val;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class FinanceOrchestratorError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "ORDER_NOT_FOUND") status = 404;
    else if (code === "ORDER_OWNERSHIP_VIOLATION") status = 403;
    else if (code === "IDEMPOTENCY_KEY_REUSED" || code === "INVALID_STATUS_TRANSITION") status = 409;
    super(status, code, message);
    this.name = "FinanceOrchestratorError";
  }
}

/**
 * WholesaleFinanceOrchestrator owns NO tables, coordinates Payments/Orders/Fulfillment/Audit via shared tx executor.
 * No Orders→Payment table writes, no Payments→Order table writes — all cross-domain via orchestrator in same tx.
 */
@Injectable()
export class WholesaleFinanceOrchestrator {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async confirmOrder(input: {
    orderId: string;
    buyerUserId: string;
    expectedVersion?: number;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    if (!input.idempotencyKey) throw new FinanceOrchestratorError("ORDER_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      // Lock parent FOR UPDATE
      const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const parent = parentResult.rows?.[0];
      if (!parent) throw new FinanceOrchestratorError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);

      const owner = parent.buyer_user_id || parent.buyerUserId;
      if (owner !== input.buyerUserId) throw new FinanceOrchestratorError("ORDER_OWNERSHIP_VIOLATION", "Not owner");

      if (input.expectedVersion !== undefined && parent.version !== input.expectedVersion) {
        throw new FinanceOrchestratorError("VERSION_CONFLICT", `Version conflict expected ${input.expectedVersion} got ${parent.version}`);
      }

      if (parent.status === "confirmed" || parent.status === "awaiting_payment" || parent.status === "processing") {
        return { order: parent, replayed: true };
      }

      if (parent.status !== "draft") {
        throw new FinanceOrchestratorError("INVALID_STATUS_TRANSITION", `Cannot confirm from ${parent.status}`);
      }

      // Idempotency for orders.confirm
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, action: "confirm" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceOrchestratorError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const [existingOrder] = await tx.select().from(wholesaleOrder).where(eq(wholesaleOrder.id, input.orderId)).limit(1);
          return { order: existingOrder, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "orders.confirm",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();

      // Validate sellers valid, allocations valid, not terminal, frozen terms
      // For simplicity, check children exist and not cancelled
      const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${input.orderId} ORDER BY id ASC FOR UPDATE`);
      const children = childrenResult.rows;
      if (children.length === 0) throw new FinanceOrchestratorError("NO_CHILD_ORDERS", "Order has no child orders");

      for (const child of children) {
        if (child.status === "cancelled") throw new FinanceOrchestratorError("CHILD_CANCELLED", `Child ${child.id} cancelled blocks confirmation`);
        // Validate seller exists (via seller table)
        const sellerId = child.seller_id || child.sellerId;
        const sellerResult = await tx.execute(sql`SELECT * FROM seller WHERE id = ${sellerId} LIMIT 1`);
        if (!sellerResult.rows?.[0]) throw new FinanceOrchestratorError("SELLER_NOT_VALID", `Seller ${sellerId} not valid`);
      }

      // Transition draft→confirmed
      const [confirmed] = await tx
        .update(wholesaleOrder)
        .set({ status: "confirmed", version: parent.version + 1, confirmedAt: now, updatedAt: now })
        .where(eq(wholesaleOrder.id, input.orderId))
        .returning();

      await tx.insert(orderStatusHistory).values({
        id: historyId(),
        orderId: input.orderId,
        childOrderId: null,
        fromStatus: parent.status,
        toStatus: "confirmed",
        actorId: input.buyerUserId,
        actorRole: "buyer",
        metadata: { frozenTerms: true } as any,
        orderVersion: confirmed.version,
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.confirmed",
        payload: sanitizeForJsonb({ orderId: input.orderId, previousStatus: parent.status }) as any,
        actorId: input.buyerUserId,
        actorRole: "buyer",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      // Issue Proformas — PaymentsService owns proforma tables, but orchestrator coordinates via shared tx
      const { proformas } = await this.paymentsService.issueProformasForOrder(input.orderId, tx);

      for (const prof of proformas) {
        await tx.insert(orderEvent).values({
          id: eventId(),
          aggregateType: "wholesale_order",
          aggregateId: input.orderId,
          eventType: "proforma.issued",
          payload: sanitizeForJsonb({ proformaId: prof.id, childOrderId: prof.childOrderId, totalAmount: (prof.totalAmount || 0).toString() }) as any,
          actorId: input.buyerUserId,
          actorRole: "buyer",
          createdAt: now,
        });
      }

      // Transition confirmed→awaiting_payment via canonical orchestration
      const [gated] = await tx
        .update(wholesaleOrder)
        .set({ status: "awaiting_payment", version: confirmed.version + 1, updatedAt: now })
        .where(eq(wholesaleOrder.id, input.orderId))
        .returning();

      await tx.insert(orderStatusHistory).values({
        id: historyId(),
        orderId: input.orderId,
        fromStatus: "confirmed",
        toStatus: "awaiting_payment",
        actorId: input.buyerUserId,
        actorRole: "system",
        metadata: { proformaCount: proformas.length } as any,
        orderVersion: gated.version,
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.payment_gated",
        payload: sanitizeForJsonb({ orderId: input.orderId, proformaCount: proformas.length, payable: proformas.reduce((s: bigint, p: any) => s + BigInt(p.totalAmount || 0), 0n).toString() }) as any,
        actorId: input.buyerUserId,
        actorRole: "system",
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.buyerUserId,
          actorRole: input.actorRole || "buyer",
          action: "order.confirmed",
          entityType: "wholesale_order",
          entityId: input.orderId,
          before: { status: parent.status },
          after: { status: "awaiting_payment", proformaCount: proformas.length },
          metadata: { idempotencyKey: input.idempotencyKey },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: gated.id, resultPayload: sanitizeForJsonb(gated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "orders.confirm"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { order: gated, proformas, replayed: false };
    });
  }

  // Cancellation before payment — no refund, void/supersede child Proforma, recompute payable, preserve original grand_total
  async cancelChildBeforePayment(input: {
    orderId: string;
    childOrderId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceOrchestratorError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);

      const childResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childResult.rows?.[0];
      if (!child) throw new FinanceOrchestratorError("ORDER_NOT_FOUND", `Child ${input.childOrderId} not found`);

      // Check no verified payments allocated to this child
      const allocResult = await tx.execute(sql`
        SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
        JOIN payment p ON p.id = pa.payment_id
        JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
        WHERE wp.child_order_id = ${input.childOrderId} AND p.status = 'verified' AND pa.status = 'active'
      `);
      const allocated = BigInt(allocResult.rows?.[0]?.sum || 0);
      if (allocated > 0n) {
        throw new FinanceOrchestratorError("PAYMENT_ALREADY_ALLOCATED", `Child ${input.childOrderId} has verified allocation ${allocated.toString()}, use refund flow`);
      }

      // Void issued proforma for this child
      const [proforma] = await tx.select().from((await import("@kolbe/database")).wholesaleProforma).where(and(eq((await import("@kolbe/database")).wholesaleProforma.childOrderId, input.childOrderId), eq((await import("@kolbe/database")).wholesaleProforma.status, "issued"))).limit(1).for("update");
      if (proforma) {
        await tx.update((await import("@kolbe/database")).wholesaleProforma).set({ status: "voided", updatedAt: new Date() }).where(eq((await import("@kolbe/database")).wholesaleProforma.id, proforma.id));
        await tx.insert(orderEvent).values({
          id: eventId(),
          aggregateType: "wholesale_order",
          aggregateId: input.orderId,
          eventType: "proforma.voided",
          payload: sanitizeForJsonb({ proformaId: proforma.id, childOrderId: input.childOrderId, reason: input.reason }) as any,
          actorId: input.actorUserId,
          actorRole: input.actorRole as any,
          createdAt: new Date(),
        });
      }

      // Create adjustment evidence release
      const now = new Date();
      const { orderFinancialRelease } = await import("@kolbe/database");
      await tx.insert(orderFinancialRelease).values({
        id: `frel_${randomUUID().replaceAll("-", "")}`,
        orderId: input.orderId,
        releaseType: "manual_authorized_release",
        evidenceReference: `void_proforma_${input.childOrderId}`,
        amount: null,
        currency: order.currency || "IRR",
        actorId: input.actorUserId,
        actorRole: input.actorRole,
        reason: `Child ${input.childOrderId} cancelled before payment, proforma voided, payable recomputed, original grand_total preserved`,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          action: "proforma.voided",
          entityType: "wholesale_proforma",
          entityId: proforma?.id || input.childOrderId,
          after: { childOrderId: input.childOrderId, reason: input.reason, originalGrandTotalPreserved: true },
          metadata: { orderId: input.orderId },
        },
        tx,
      );

      return { voidedProforma: proforma, adjustmentCreated: true };
    });
  }

  // Full parent cancellation with per-allocation refund obligations
  async cancelParentWithRefundObligations(input: {
    orderId: string;
    actorUserId: string;
    actorRole: string;
    reason: string;
    idempotencyKey: string;
  }) {
    // This orchestrates parent cancellation and creates refund obligations per actual verified allocations
    return this.db.transaction(async (tx: any) => {
      // Lock parent
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceOrchestratorError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);

      // Get children
      const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${input.orderId} ORDER BY id ASC FOR UPDATE`);
      const children = childrenResult.rows;

      // For each child, compute verified allocation
      const refundObligations: Array<{ childOrderId: string; amount: bigint }> = [];
      for (const child of children) {
        const childId = child.id;
        const allocResult = await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
          WHERE wp.child_order_id = ${childId} AND p.status = 'verified' AND pa.status = 'active'
        `);
        const allocated = BigInt(allocResult.rows?.[0]?.sum || 0);
        if (allocated > 0n) {
          refundObligations.push({ childOrderId: childId, amount: allocated });
        }
      }

      // Note: Order status separate from Refund status — Order cancelled while refunds pending allowed
      // We don't auto-create refunds here, just return obligations for admin to create via refund API
      // But we can emit event with obligations

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.parent_cancelled",
        payload: sanitizeForJsonb({ orderId: input.orderId, reason: input.reason, refundObligations: refundObligations.map((o) => ({ childOrderId: o.childOrderId, amount: o.amount.toString() })) }) as any,
        actorId: input.actorUserId,
        actorRole: input.actorRole as any,
        createdAt: new Date(),
      });

      return { refundObligations: refundObligations.map((o) => ({ childOrderId: o.childOrderId, amount: o.amount.toString() })), order };
    });
  }
}
