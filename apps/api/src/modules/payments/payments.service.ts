import { Injectable, Inject } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  wholesaleOrder,
  wholesaleOrderItem,
  purchaseOrder,
  purchaseOrderItem,
  wholesaleProforma,
  wholesaleProformaLine,
  payment,
  paymentAllocation,
  orderFinancialRelease,
  financialLedgerEntry,
  refund,
  orderStatusHistory,
  orderEvent,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { PaymentsRepository, type DbOrTx } from "./payments.repository";
import { AuditService } from "../audit/audit.service";
import { DomainError } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

function proformaId(): string {
  return `prof_${randomUUID().replaceAll("-", "")}`;
}
function proformaLineId(): string {
  return `profl_${randomUUID().replaceAll("-", "")}`;
}
function paymentId(): string {
  return `pay_${randomUUID().replaceAll("-", "")}`;
}
function allocationId(): string {
  return `pall_${randomUUID().replaceAll("-", "")}`;
}
function releaseId(): string {
  return `frel_${randomUUID().replaceAll("-", "")}`;
}
function ledgerId(): string {
  return `fled_${randomUUID().replaceAll("-", "")}`;
}
function refundId(): string {
  return `ref_${randomUUID().replaceAll("-", "")}`;
}
function historyId(): string {
  return `osh_${randomUUID().replaceAll("-", "")}`;
}
function eventId(): string {
  return `oev_${randomUUID().replaceAll("-", "")}`;
}

function generateProformaNumber(): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `PROF-${suffix}`;
}
function generatePaymentReference(): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `PAY-${suffix}`;
}
function generateRefundReference(): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `REF-${suffix}`;
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

export class FinanceDomainError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "PROFORMA_NOT_FOUND" || code === "PAYMENT_NOT_FOUND" || code === "REFUND_NOT_FOUND" || code === "ORDER_NOT_FOUND") status = 404;
    else if (code === "IDEMPOTENCY_KEY_REUSED") status = 409;
    else if (code === "ORDER_OWNERSHIP_VIOLATION" || code === "PROFORMA_ACCESS_DENIED") status = 403;
    else if (code === "INVALID_STATUS_TRANSITION" || code === "PAYMENT_ALREADY_VERIFIED" || code === "REFUND_ALREADY_COMPLETED" || code === "OVERPAYMENT_ALLOCATION" || code === "PROFORMA_OVERPAID") status = 409;
    else if (code === "BNPL_NOT_ALLOWED" || code === "INVALID_PAYMENT_METHOD" || code === "INVALID_PAYMENT_MODE") status = 400;
    else if (code === "PAYMENT_GATE_BLOCKED" || code === "INSUFFICIENT_PAYMENT_COVERAGE") status = 409;
    super(status, code, message);
    this.name = "FinanceDomainError";
  }
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PaymentsRepository) private readonly repository: PaymentsRepository,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private async withExecutor<T>(executor: DbOrTx | undefined, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    if (executor) return work(executor);
    return this.db.transaction(async (tx) => work(tx as any));
  }

  // ── Proforma Issuance ────────────────────────────────────────────────
  async issueProformasForOrder(orderId: string, executor: DbOrTx): Promise<{ proformas: any[]; lines: any[] }> {
    const tx = executor as any;
    // Lock parent
    const parentResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} FOR UPDATE`);
    const parent = parentResult.rows?.[0];
    if (!parent) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);

    // Get children deterministic id ASC
    const childrenResult = await tx.execute(sql`SELECT * FROM purchase_order WHERE wholesale_order_id = ${orderId} ORDER BY id ASC FOR UPDATE`);
    const children = childrenResult.rows;

    // Get order items
    const orderItemsResult = await tx.execute(sql`SELECT * FROM wholesale_order_item WHERE order_id = ${orderId} ORDER BY id ASC`);
    const orderItems = orderItemsResult.rows;

    // Get child items
    const childItemsResult = await tx.execute(sql`SELECT * FROM purchase_order_item WHERE purchase_order_id IN (${sql.join(children.map((c: any) => sql`${c.id}`), sql`, `)}) ORDER BY id ASC`);
    const childItems = childItemsResult.rows;

    const now = new Date();
    const createdProformas: any[] = [];
    const createdLines: any[] = [];

    for (const child of children) {
      const childId = child.id;
      // Check if already has issued proforma
      const [existing] = await tx.select().from(wholesaleProforma).where(and(eq(wholesaleProforma.childOrderId, childId), eq(wholesaleProforma.status, "issued"))).limit(1).for("update");
      if (existing) {
        // Already issued, skip (idempotent issuance per child)
        createdProformas.push(existing);
        const lines = await tx.select().from(wholesaleProformaLine).where(eq(wholesaleProformaLine.proformaId, existing.id));
        createdLines.push(...lines);
        continue;
      }

      const sellerId = child.seller_id || child.sellerId;
      const supplierId = child.supplier_id || child.supplierId || null;
      const currency = child.currency || parent.currency || "IRR";

      // Items for this child: via purchase_order_item -> wholesale_order_item
      const childItemMap = childItems.filter((ci: any) => (ci.purchase_order_id || ci.purchaseOrderId) === childId);
      let itemsTotal = 0n;
      for (const ci of childItemMap) {
        const woItemId = ci.wholesale_order_item_id || ci.wholesaleOrderItemId;
        const woItem = orderItems.find((oi: any) => oi.id === woItemId);
        if (woItem) {
          itemsTotal += BigInt(woItem.line_total || woItem.lineTotal || 0);
        } else {
          itemsTotal += BigInt(ci.total_amount || ci.totalAmount || 0);
        }
      }
      // shipping_total 0 means not yet quoted, not free
      const shippingTotal = 0n;
      const totalAmount = itemsTotal + shippingTotal;

      const termsSnapshot = {
        orderId,
        childOrderId: childId,
        sellerId,
        supplierId,
        currency,
        itemsTotal: itemsTotal.toString(),
        shippingTotal: shippingTotal.toString(),
        totalAmount: totalAmount.toString(),
        paymentMode: parent.payment_mode || parent.paymentMode,
        issuedAt: now.toISOString(),
        // Immutable snapshots from order
        parentOrderCode: parent.order_code || parent.orderCode,
        childOrderCode: child.order_code || child.orderCode,
        // Original order snapshots preserved
        originalGrandTotal: (parent.grand_total || parent.grandTotal || 0).toString(),
      };

      const pid = proformaId();
      const pNumber = generateProformaNumber();

      const [proforma] = await tx
        .insert(wholesaleProforma)
        .values({
          id: pid,
          proformaNumber: pNumber,
          wholesaleOrderId: orderId,
          childOrderId: childId,
          sellerId,
          supplierId,
          version: 1,
          status: "issued",
          currency,
          itemsTotal: itemsTotal as any,
          shippingTotal: shippingTotal as any,
          totalAmount: totalAmount as any,
          termsSnapshot: sanitizeForJsonb(termsSnapshot) as any,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      createdProformas.push(proforma);

      // Create lines
      for (const ci of childItemMap) {
        const woItemId = ci.wholesale_order_item_id || ci.wholesaleOrderItemId;
        const woItem = orderItems.find((oi: any) => oi.id === woItemId);
        const lineId = proformaLineId();
        const quantity = woItem ? woItem.quantity || woItem.piece_quantity || 1 : ci.quantity || 1;
        const unitPrice = woItem ? BigInt(woItem.unit_price || woItem.unitPrice || 0) : BigInt(ci.unit_price || ci.unitPrice || 0);
        const lineTotal = woItem ? BigInt(woItem.line_total || woItem.lineTotal || 0) : BigInt(ci.total_amount || ci.totalAmount || 0);
        const descriptionSnapshot = woItem ? woItem.product_name_snapshot || woItem.productNameSnapshot || woItem.product_name || "" : ci.product_name || "";
        const skuSnapshot = woItem ? woItem.sku_snapshot || woItem.skuSnapshot || woItem.sku || "" : ci.sku || "";
        const pricingUnit = woItem ? woItem.pricing_unit || woItem.pricingUnit || "PIECE" : "PIECE";

        const [line] = await tx
          .insert(wholesaleProformaLine)
          .values({
            id: lineId,
            proformaId: pid,
            wholesaleOrderItemId: woItemId,
            purchaseOrderItemId: ci.id,
            descriptionSnapshot,
            skuSnapshot,
            quantity,
            pricingUnit,
            unitPrice: unitPrice as any,
            lineTotal: lineTotal as any,
            currency,
            createdAt: now,
          })
          .returning();
        createdLines.push(line);
      }

      // If no child items (edge), still create proforma with total from child
      if (childItemMap.length === 0) {
        // Use child totals directly
        const childTotal = BigInt(child.grand_total || child.total_amount || child.items_total || 0);
        if (childTotal > 0n) {
          // Update proforma totals
          await tx.update(wholesaleProforma).set({ itemsTotal: childTotal as any, totalAmount: childTotal as any, updatedAt: now }).where(eq(wholesaleProforma.id, pid));
          proforma.itemsTotal = childTotal as any;
          proforma.totalAmount = childTotal as any;
        }
      }
    }

    return { proformas: createdProformas, lines: createdLines };
  }

  async voidProforma(proformaId: string, actorId: string, reason: string, executor: DbOrTx) {
    const tx = executor as any;
    const [proforma] = await tx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, proformaId)).limit(1).for("update");
    if (!proforma) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${proformaId} not found`);
    if (proforma.status !== "issued") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot void from ${proforma.status}`);
    const now = new Date();
    const [updated] = await tx.update(wholesaleProforma).set({ status: "voided", updatedAt: now }).where(eq(wholesaleProforma.id, proformaId)).returning();
    // Audit
    await this.auditService.record(
      {
        actorId,
        actorRole: "admin",
        action: "proforma.voided",
        entityType: "wholesale_proforma",
        entityId: proformaId,
        before: { status: proforma.status },
        after: { status: "voided", reason },
        metadata: { orderId: proforma.wholesaleOrderId },
      },
      tx,
    );
    return updated;
  }

  async supersedeProforma(oldProformaId: string, newProformaData: any, actorId: string, executor: DbOrTx) {
    const tx = executor as any;
    const [old] = await tx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, oldProformaId)).limit(1).for("update");
    if (!old) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${oldProformaId} not found`);
    if (old.status !== "issued") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot supersede from ${old.status}`);

    const now = new Date();
    const newId = proformaId();
    const newNumber = generateProformaNumber();

    const [newProforma] = await tx
      .insert(wholesaleProforma)
      .values({
        id: newId,
        proformaNumber: newNumber,
        wholesaleOrderId: old.wholesaleOrderId,
        childOrderId: old.childOrderId,
        sellerId: old.sellerId,
        supplierId: old.supplierId,
        version: old.version + 1,
        status: "issued",
        currency: old.currency,
        itemsTotal: newProformaData.itemsTotal ?? old.itemsTotal,
        shippingTotal: newProformaData.shippingTotal ?? old.shippingTotal,
        totalAmount: newProformaData.totalAmount ?? old.totalAmount,
        termsSnapshot: old.termsSnapshot,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        supersededBy: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.update(wholesaleProforma).set({ status: "superseded", supersededBy: newId, updatedAt: now }).where(eq(wholesaleProforma.id, oldProformaId));

    await this.auditService.record(
      {
        actorId,
        actorRole: "admin",
        action: "proforma.superseded",
        entityType: "wholesale_proforma",
        entityId: oldProformaId,
        before: { status: old.status, id: oldProformaId },
        after: { status: "superseded", newId, version: newProforma.version },
        metadata: { orderId: old.wholesaleOrderId },
      },
      tx,
    );

    return newProforma;
  }

  // ── Payment Submission ───────────────────────────────────────────────
  async submitTransferPayment(input: {
    orderId: string;
    buyerUserId: string;
    amount: string; // decimal string
    bankReference?: string;
    evidenceReference?: string;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    // Validate amount decimal string bigint
    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(input.amount);
    } catch {
      throw new FinanceDomainError("INVALID_AMOUNT", `Amount ${input.amount} invalid, must be decimal string bigint`);
    }
    if (amountBigInt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");

    // Reject BNPL retail
    // This is payment method check, but submitTransfer is only for manual_transfer
    return this.db.transaction(async (tx: any) => {
      // Lock order FOR UPDATE
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
      const owner = order.buyer_user_id || order.buyerUserId;
      if (owner !== input.buyerUserId) throw new FinanceDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");

      const status = order.status;
      if (!["awaiting_payment", "confirmed", "processing"].includes(status)) {
        // Allow submission in awaiting_payment, but also in confirmed for backward compat? Spec says confirmed→awaiting_payment via orchestration, payment after awaiting_payment
        if (status !== "awaiting_payment") {
          throw new FinanceDomainError("PAYMENT_GATE_BLOCKED", `Cannot submit payment from ${status}`);
        }
      }

      // Check idempotency
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, amount: input.amount, bankReference: input.bankReference, evidenceReference: input.evidenceReference, method: "manual_transfer" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "payments.submit_transfer"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const existingPayment = await tx.select().from(payment).where(eq(payment.id, existingIdem.resultResourceId)).limit(1);
          return { payment: existingPayment[0], replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "payments.submit_transfer",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Also check payment table idempotency
      const [existingPaymentByKey] = await tx.select().from(payment).where(and(eq(payment.wholesaleOrderId, input.orderId), eq(payment.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingPaymentByKey) {
        return { payment: existingPaymentByKey, replayed: true };
      }

      const currency = order.currency || "IRR";
      const now = new Date();
      const pid = paymentId();
      const ref = generatePaymentReference();

      const [pay] = await tx
        .insert(payment)
        .values({
          id: pid,
          paymentReference: ref,
          wholesaleOrderId: input.orderId,
          method: "manual_transfer",
          provider: "manual",
          status: "evidence_submitted",
          amount: amountBigInt as any,
          currency,
          externalReference: input.bankReference || input.evidenceReference || null,
          submittedBy: input.buyerUserId,
          submittedAt: now,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          version: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Event
      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "payment.evidence_submitted",
        payload: sanitizeForJsonb({ paymentId: pid, amount: amountBigInt.toString(), currency, externalReference: pay.externalReference }) as any,
        actorId: input.buyerUserId,
        actorRole: "buyer",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.buyerUserId,
          actorRole: input.actorRole || "buyer",
          action: "payment.evidence_submitted",
          entityType: "payment",
          entityId: pid,
          after: { orderId: input.orderId, amount: amountBigInt.toString(), currency, method: "manual_transfer" },
          metadata: { idempotencyKey: input.idempotencyKey },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: pid, resultPayload: sanitizeForJsonb(pay) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "payments.submit_transfer"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { payment: pay, replayed: false };
    });
  }

  // ── Payment Verification ─────────────────────────────────────────────
  async verifyPayment(input: {
    paymentId: string;
    adminUserId: string;
    expectedVersion?: number;
    externalReference: string;
    idempotencyKey: string;
    actorRole?: string;
    reason?: string;
  }) {
    if (!input.externalReference || input.externalReference.trim().length === 0) {
      throw new FinanceDomainError("EXTERNAL_REFERENCE_REQUIRED", "externalReference required for verification");
    }

    return this.db.transaction(async (tx: any) => {
      // Lock payment FOR UPDATE
      const payResult = await tx.execute(sql`SELECT * FROM payment WHERE id = ${input.paymentId} FOR UPDATE`);
      const pay = payResult.rows?.[0];
      if (!pay) throw new FinanceDomainError("PAYMENT_NOT_FOUND", `Payment ${input.paymentId} not found`);

      if (input.expectedVersion !== undefined && pay.version !== input.expectedVersion) {
        throw new FinanceDomainError("VERSION_CONFLICT", `Version conflict expected ${input.expectedVersion} got ${pay.version}`);
      }

      if (pay.status === "verified") {
        return { payment: pay, replayed: true };
      }
      if (pay.status !== "evidence_submitted") {
        throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot verify from ${pay.status}`);
      }

      // Idempotency
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ paymentId: input.paymentId, externalReference: input.externalReference, action: "verify" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "payment"),
            eq(commandIdempotency.scopeId, input.paymentId),
            eq(commandIdempotency.commandType, "payments.verify"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          return { payment: pay, replayed: true, payload: existingIdem.resultPayload };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "payment",
          scopeId: input.paymentId,
          commandType: "payments.verify",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Verify currency matches order
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${pay.wholesale_order_id} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", "Order not found for payment");

      // Amount check already stored, but ensure currency match
      if (pay.currency !== order.currency) {
        throw new FinanceDomainError("CURRENCY_MISMATCH", `Payment currency ${pay.currency} != order ${order.currency}`);
      }

      const now = new Date();
      // Transition to verified
      const [verified] = await tx
        .update(payment)
        .set({
          status: "verified",
          verifiedBy: input.adminUserId,
          verifiedAt: now,
          externalReference: input.externalReference,
          version: pay.version + 1,
          updatedAt: now,
        })
        .where(eq(payment.id, input.paymentId))
        .returning();

      // Create ledger IN entry — only verified Payment IN
      const ledgerEntryId = ledgerId();
      await tx.insert(financialLedgerEntry).values({
        id: ledgerEntryId,
        orderId: pay.wholesale_order_id,
        paymentId: input.paymentId,
        entryType: "payment_verified",
        direction: "IN",
        amount: pay.amount,
        currency: pay.currency,
        externalReference: input.externalReference,
        occurredAt: now,
        createdAt: now,
        metadata: sanitizeForJsonb({ verifiedBy: input.adminUserId, reason: input.reason }) as any,
      });

      // Allocation — deterministic policy: child id ASC, proforma total not overpaid
      const allocations = await this.allocatePaymentToProformas(
        {
          paymentId: input.paymentId,
          orderId: pay.wholesale_order_id,
          amount: BigInt(pay.amount),
          currency: pay.currency,
        },
        tx,
      );

      // Check if payable fully covered -> release order
      const releaseResult = await this.tryReleaseOrderIfFullyCovered(pay.wholesale_order_id, input.adminUserId, tx);

      // Events
      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: pay.wholesale_order_id,
        eventType: "payment.verified",
        payload: sanitizeForJsonb({ paymentId: input.paymentId, amount: pay.amount.toString(), allocations: allocations.map((a: any) => ({ proformaId: a.proformaId, amount: a.amount.toString() })) }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      for (const alloc of allocations) {
        await tx.insert(orderEvent).values({
          id: eventId(),
          aggregateType: "wholesale_order",
          aggregateId: pay.wholesale_order_id,
          eventType: "payment.allocated",
          payload: sanitizeForJsonb({ paymentId: input.paymentId, proformaId: alloc.proformaId, amount: alloc.amount.toString() }) as any,
          actorId: input.adminUserId,
          actorRole: "admin",
          createdAt: now,
        });
      }

      if (allocations.length > 0) {
        const allocatedSum = allocations.reduce((s: bigint, a: any) => s + BigInt(a.amount), 0n);
        const overpaid = BigInt(pay.amount) - allocatedSum;
        if (overpaid > 0n) {
          await tx.insert(orderEvent).values({
            id: eventId(),
            aggregateType: "wholesale_order",
            aggregateId: pay.wholesale_order_id,
            eventType: "payment.overpaid",
            payload: sanitizeForJsonb({ paymentId: input.paymentId, overpaid: overpaid.toString(), total: pay.amount.toString() }) as any,
            actorId: input.adminUserId,
            actorRole: "admin",
            createdAt: now,
          });
        }
      }

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "payment.verified",
          entityType: "payment",
          entityId: input.paymentId,
          before: { status: pay.status },
          after: { status: "verified", externalReference: input.externalReference, amount: pay.amount.toString() },
          metadata: { orderId: pay.wholesale_order_id, idempotencyKey: input.idempotencyKey },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: verified.id, resultPayload: sanitizeForJsonb(verified) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "payment"),
            eq(commandIdempotency.scopeId, input.paymentId),
            eq(commandIdempotency.commandType, "payments.verify"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { payment: verified, allocations, release: releaseResult, replayed: false };
    });
  }

  async rejectPayment(input: { paymentId: string; adminUserId: string; reason: string; idempotencyKey: string; expectedVersion?: number; actorRole?: string }) {
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "Reason required for rejection");
    return this.db.transaction(async (tx: any) => {
      const payResult = await tx.execute(sql`SELECT * FROM payment WHERE id = ${input.paymentId} FOR UPDATE`);
      const pay = payResult.rows?.[0];
      if (!pay) throw new FinanceDomainError("PAYMENT_NOT_FOUND", `Payment ${input.paymentId} not found`);
      if (pay.status === "failed") return { payment: pay, replayed: true };
      if (pay.status !== "evidence_submitted") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot reject from ${pay.status}`);

      if (input.expectedVersion !== undefined && pay.version !== input.expectedVersion) {
        throw new FinanceDomainError("VERSION_CONFLICT", "Version conflict");
      }

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ paymentId: input.paymentId, reason: input.reason, action: "reject" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "payment"),
            eq(commandIdempotency.scopeId, input.paymentId),
            eq(commandIdempotency.commandType, "payments.reject"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { payment: pay, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "payment",
          scopeId: input.paymentId,
          commandType: "payments.reject",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(payment)
        .set({ status: "failed", failureReason: input.reason, version: pay.version + 1, updatedAt: now })
        .where(eq(payment.id, input.paymentId))
        .returning();

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: pay.wholesale_order_id,
        eventType: "payment.failed",
        payload: sanitizeForJsonb({ paymentId: input.paymentId, reason: input.reason }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "payment.failed",
          entityType: "payment",
          entityId: input.paymentId,
          before: { status: pay.status },
          after: { status: "failed", reason: input.reason },
          metadata: { orderId: pay.wholesale_order_id },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "payment"),
            eq(commandIdempotency.scopeId, input.paymentId),
            eq(commandIdempotency.commandType, "payments.reject"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { payment: updated, replayed: false };
    });
  }

  private async allocatePaymentToProformas(
    input: { paymentId: string; orderId: string; amount: bigint; currency: string },
    tx: any,
  ) {
    // Get active issued proformas for order sorted by child id ASC (deterministic)
    const proformasResult = await tx.execute(sql`
      SELECT * FROM wholesale_proforma
      WHERE wholesale_order_id = ${input.orderId} AND status = 'issued'
      ORDER BY child_order_id ASC, id ASC
      FOR UPDATE
    `);
    const proformas = proformasResult.rows;

    // For each proforma, compute already allocated sum
    const allocations: any[] = [];
    let remaining = input.amount;

    for (const prof of proformas) {
      if (remaining <= 0n) break;
      const profId = prof.id;
      const profTotal = BigInt(prof.total_amount);
      // Sum allocations for this proforma
      const allocResult = await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment_allocation WHERE proforma_id = ${profId} AND status = 'active'`);
      const alreadyAllocated = BigInt(allocResult.rows?.[0]?.sum || 0);
      const needed = profTotal - alreadyAllocated;
      if (needed <= 0n) continue; // already fully paid
      const toAllocate = remaining < needed ? remaining : needed;
      if (toAllocate <= 0n) continue;

      const allocId = allocationId();
      const [alloc] = await tx
        .insert(paymentAllocation)
        .values({
          id: allocId,
          paymentId: input.paymentId,
          proformaId: profId,
          amount: toAllocate as any,
          currency: input.currency,
          status: "active",
          createdAt: new Date(),
        })
        .returning();
      allocations.push(alloc);
      remaining -= toAllocate;
    }

    // If remaining >0, it's overpayment — record unallocated, do NOT auto wallet credit
    // Overpayment exposed via financial summary unallocatedPaid

    return allocations;
  }

  private async tryReleaseOrderIfFullyCovered(orderId: string, actorId: string, tx: any) {
    // Check if payable fully covered by verified Payments
    const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} FOR UPDATE`);
    const order = orderResult.rows?.[0];
    if (!order) return null;
    if (order.status !== "awaiting_payment") return null;

    // Sum active issued proforma totals
    const proformaSumResult = await tx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId} AND status = 'issued'`);
    const payable = BigInt(proformaSumResult.rows?.[0]?.sum || 0);

    // Sum verified payment allocations (or verified payments total? Use verified payments allocated)
    const verifiedSumResult = await tx.execute(sql`
      SELECT COALESCE(SUM(p.amount),0) as sum FROM payment p WHERE p.wholesale_order_id = ${orderId} AND p.status = 'verified'
    `);
    const verifiedTotal = BigInt(verifiedSumResult.rows?.[0]?.sum || 0);

    // Also sum allocations to ensure coverage per proforma? Simplistic: verified total >= payable
    // But need to ensure allocations cover each proforma? We use verified total >= payable as coverage
    if (verifiedTotal < payable) return null;
    if (payable === 0n) return null;

    // Release: awaiting_payment → processing in ONE tx
    const now = new Date();
    const releaseIdVal = releaseId();
    await tx.insert(orderFinancialRelease).values({
      id: releaseIdVal,
      orderId,
      releaseType: "payment_verified",
      evidenceReference: `payments_verified_${verifiedTotal.toString()}`,
      amount: payable as any,
      currency: order.currency || "IRR",
      actorId,
      actorRole: "admin",
      reason: `Payable ${payable.toString()} covered by verified ${verifiedTotal.toString()}`,
      createdAt: now,
    });

    const [updated] = await tx
      .update(wholesaleOrder)
      .set({ status: "processing", version: order.version + 1, updatedAt: now })
      .where(eq(wholesaleOrder.id, orderId))
      .returning();

    await tx.insert(orderStatusHistory).values({
      id: historyId(),
      orderId,
      childOrderId: null,
      fromStatus: order.status,
      toStatus: "processing",
      actorId,
      actorRole: "system",
      reason: "payment_verified",
      metadata: { releaseId: releaseIdVal, payable: payable.toString(), verifiedTotal: verifiedTotal.toString() } as any,
      orderVersion: updated.version,
      createdAt: now,
    });

    await tx.insert(orderEvent).values({
      id: eventId(),
      aggregateType: "wholesale_order",
      aggregateId: orderId,
      eventType: "order.processing_started",
      payload: sanitizeForJsonb({ releaseId: releaseIdVal, releaseType: "payment_verified", payable: payable.toString(), verifiedTotal: verifiedTotal.toString() }) as any,
      actorId,
      actorRole: "system",
      createdAt: now,
    });

    await tx.insert(orderEvent).values({
      id: eventId(),
      aggregateType: "wholesale_order",
      aggregateId: orderId,
      eventType: "financial.release_created",
      payload: sanitizeForJsonb({ releaseId: releaseIdVal, releaseType: "payment_verified", amount: payable.toString() }) as any,
      actorId,
      actorRole: "system",
      createdAt: now,
    });

    await this.auditService.record(
      {
        actorId,
        actorRole: "admin",
        action: "financial.release_created",
        entityType: "wholesale_order",
        entityId: orderId,
        before: { status: order.status },
        after: { status: "processing", releaseType: "payment_verified", payable: payable.toString() },
        metadata: { releaseId: releaseIdVal },
      },
      tx,
    );

    return { releaseId: releaseIdVal, order: updated };
  }

  // ── Credit / COD Release ─────────────────────────────────────────────
  async releaseWithCredit(input: {
    orderId: string;
    adminUserId: string;
    evidenceReference: string;
    amount?: string;
    currency?: string;
    reason: string;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      if (!input.evidenceReference || input.evidenceReference.trim().length === 0) throw new FinanceDomainError("EVIDENCE_REQUIRED", "evidenceReference required for credit approval");
      if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "reason required");

      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
      if (order.status !== "awaiting_payment" && order.status !== "confirmed") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot credit release from ${order.status}`);

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, evidenceReference: input.evidenceReference, type: "credit" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.credit_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { order, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "finance.credit_approve",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const relId = releaseId();
      await tx.insert(orderFinancialRelease).values({
        id: relId,
        orderId: input.orderId,
        releaseType: "credit_approved",
        evidenceReference: input.evidenceReference,
        amount: input.amount ? (BigInt(input.amount) as any) : null,
        currency: input.currency || order.currency || "IRR",
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        createdAt: now,
      });

      const [updated] = await tx
        .update(wholesaleOrder)
        .set({ status: "processing", version: order.version + 1, updatedAt: now })
        .where(eq(wholesaleOrder.id, input.orderId))
        .returning();

      await tx.insert(orderStatusHistory).values({
        id: historyId(),
        orderId: input.orderId,
        fromStatus: order.status,
        toStatus: "processing",
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        metadata: { releaseId: relId, releaseType: "credit_approved", evidenceReference: input.evidenceReference } as any,
        orderVersion: updated.version,
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.processing_started",
        payload: sanitizeForJsonb({ releaseId: relId, releaseType: "credit_approved", evidenceReference: input.evidenceReference }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "financial.release_created",
        payload: sanitizeForJsonb({ releaseId: relId, releaseType: "credit_approved" }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "financial.credit_approved",
          entityType: "wholesale_order",
          entityId: input.orderId,
          after: { status: "processing", releaseType: "credit_approved", evidenceReference: input.evidenceReference },
          metadata: { releaseId: relId },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.credit_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { order: updated, releaseId: relId, replayed: false };
    });
  }

  async releaseWithCod(input: {
    orderId: string;
    adminUserId: string;
    evidenceReference: string;
    reason: string;
    idempotencyKey: string;
    actorRole?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      if (!input.evidenceReference || input.evidenceReference.trim().length === 0) throw new FinanceDomainError("EVIDENCE_REQUIRED", "evidenceReference required for COD policy approval");
      if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "reason required");

      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);
      if (order.status !== "awaiting_payment" && order.status !== "confirmed") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot COD release from ${order.status}`);

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, evidenceReference: input.evidenceReference, type: "cod" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.cod_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { order, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "finance.cod_approve",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const relId = releaseId();
      await tx.insert(orderFinancialRelease).values({
        id: relId,
        orderId: input.orderId,
        releaseType: "cod_policy_approved",
        evidenceReference: input.evidenceReference,
        currency: order.currency || "IRR",
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        createdAt: now,
      });

      const [updated] = await tx
        .update(wholesaleOrder)
        .set({ status: "processing", version: order.version + 1, updatedAt: now })
        .where(eq(wholesaleOrder.id, input.orderId))
        .returning();

      await tx.insert(orderStatusHistory).values({
        id: historyId(),
        orderId: input.orderId,
        fromStatus: order.status,
        toStatus: "processing",
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        metadata: { releaseId: relId, releaseType: "cod_policy_approved", evidenceReference: input.evidenceReference } as any,
        orderVersion: updated.version,
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "order.processing_started",
        payload: sanitizeForJsonb({ releaseId: relId, releaseType: "cod_policy_approved", evidenceReference: input.evidenceReference }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        createdAt: now,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "financial.release_created",
        payload: sanitizeForJsonb({ releaseId: relId, releaseType: "cod_policy_approved" }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "financial.cod_approved",
          entityType: "wholesale_order",
          entityId: input.orderId,
          after: { status: "processing", releaseType: "cod_policy_approved", evidenceReference: input.evidenceReference },
          metadata: { releaseId: relId },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.cod_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { order: updated, releaseId: relId, replayed: false };
    });
  }

  // ── Financial Summary ────────────────────────────────────────────────
  async getOrderFinancialSummary(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const orderResult = await dbTx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);

      const originalOrderTotal = BigInt(order.grand_total || order.grandTotal || order.total_amount || 0);

      const activeProformaResult = await dbTx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId} AND status = 'issued'`);
      const activeProformaTotal = BigInt(activeProformaResult.rows?.[0]?.sum || 0);

      const verifiedPaidResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment WHERE wholesale_order_id = ${orderId} AND status = 'verified'`);
      const verifiedPaid = BigInt(verifiedPaidResult.rows?.[0]?.sum || 0);

      const allocatedResult = await dbTx.execute(sql`
        SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
        JOIN payment p ON p.id = pa.payment_id
        WHERE p.wholesale_order_id = ${orderId} AND pa.status = 'active' AND p.status = 'verified'
      `);
      const allocated = BigInt(allocatedResult.rows?.[0]?.sum || 0);
      const unallocatedPaid = verifiedPaid - allocated;

      const refundRequestedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status IN ('requested','approved','processing')`);
      const refundRequested = BigInt(refundRequestedResult.rows?.[0]?.sum || 0);

      const refundCompletedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status = 'completed'`);
      const refundCompleted = BigInt(refundCompletedResult.rows?.[0]?.sum || 0);

      const currentPayable = activeProformaTotal; // after voids/supersedes
      const netCollected = verifiedPaid - refundCompleted;

      return {
        orderId,
        originalOrderTotal: originalOrderTotal.toString(),
        activeProformaTotal: activeProformaTotal.toString(),
        verifiedPaid: verifiedPaid.toString(),
        allocatedPaid: allocated.toString(),
        unallocatedPaid: unallocatedPaid.toString(),
        refundRequested: refundRequested.toString(),
        refundCompleted: refundCompleted.toString(),
        currentPayable: currentPayable.toString(),
        netCollected: netCollected.toString(),
        currency: order.currency || "IRR",
      };
    });
  }

  // ── Refund ───────────────────────────────────────────────────────────
  async createRefund(input: {
    orderId: string;
    childOrderId?: string;
    exceptionId?: string;
    paymentId?: string;
    amount: string;
    currency?: string;
    reasonCode?: string;
    reason?: string;
    actorUserId: string;
    actorRole?: string;
    idempotencyKey: string;
  }) {
    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(input.amount);
    } catch {
      throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be bigint decimal string");
    }
    if (amountBigInt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");

    return this.db.transaction(async (tx: any) => {
      const orderResult = await tx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${input.orderId} FOR UPDATE`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${input.orderId} not found`);

      // Determine refundable per child isolation
      let refundable: bigint;
      if (input.childOrderId) {
        // Refundable B = verified Payment allocations to B minus completed/pending refunds for B
        const allocResult = await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
          WHERE wp.child_order_id = ${input.childOrderId} AND p.status = 'verified' AND pa.status = 'active'
        `);
        const allocatedToChild = BigInt(allocResult.rows?.[0]?.sum || 0);

        const refundResult = await tx.execute(sql`
          SELECT COALESCE(SUM(amount),0) as sum FROM refund
          WHERE child_order_id = ${input.childOrderId} AND status IN ('requested','approved','processing','completed')
        `);
        const alreadyRefunded = BigInt(refundResult.rows?.[0]?.sum || 0);

        refundable = allocatedToChild - alreadyRefunded;
      } else {
        // Parent refundable = verified total - already refunded
        const verifiedResult = await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment WHERE wholesale_order_id = ${input.orderId} AND status = 'verified'`);
        const verified = BigInt(verifiedResult.rows?.[0]?.sum || 0);
        const refundResult = await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${input.orderId} AND status IN ('requested','approved','processing','completed')`);
        const alreadyRefunded = BigInt(refundResult.rows?.[0]?.sum || 0);
        refundable = verified - alreadyRefunded;
      }

      if (amountBigInt > refundable) {
        throw new FinanceDomainError("REFUND_EXCEEDS_ALLOCATED", `Refund ${amountBigInt.toString()} exceeds refundable ${refundable.toString()} for child ${input.childOrderId || "parent"}`, 409);
      }

      // Idempotency
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, childOrderId: input.childOrderId, amount: input.amount, reasonCode: input.reasonCode });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "refunds.create"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") {
          const [existingRefund] = await tx.select().from(refund).where(eq(refund.id, existingIdem.resultResourceId)).limit(1);
          return { refund: existingRefund, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wholesale_order",
          scopeId: input.orderId,
          commandType: "refunds.create",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Check payment table idempotency
      const [existingRefundByKey] = await tx.select().from(refund).where(and(eq(refund.wholesaleOrderId, input.orderId), eq(refund.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingRefundByKey) return { refund: existingRefundByKey, replayed: true };

      const now = new Date();
      const rid = refundId();
      const rref = generateRefundReference();

      const [created] = await tx
        .insert(refund)
        .values({
          id: rid,
          refundReference: rref,
          wholesaleOrderId: input.orderId,
          childOrderId: input.childOrderId || null,
          fulfillmentExceptionId: input.exceptionId || null,
          paymentId: input.paymentId || null,
          amount: amountBigInt as any,
          currency: input.currency || order.currency || "IRR",
          reasonCode: input.reasonCode || null,
          reason: input.reason || null,
          status: "requested",
          requestedAt: now,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          version: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: input.orderId,
        eventType: "refund.requested",
        payload: sanitizeForJsonb({ refundId: rid, childOrderId: input.childOrderId, amount: amountBigInt.toString(), reasonCode: input.reasonCode }) as any,
        actorId: input.actorUserId,
        actorRole: input.actorRole || "admin",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.requested",
          entityType: "refund",
          entityId: rid,
          after: { orderId: input.orderId, childOrderId: input.childOrderId, amount: amountBigInt.toString() },
          metadata: { idempotencyKey: input.idempotencyKey },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: rid, resultPayload: sanitizeForJsonb(created) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wholesale_order"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "refunds.create"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { refund: created, replayed: false };
    });
  }

  async approveRefund(input: { refundId: string; adminUserId: string; idempotencyKey: string; reason?: string; actorRole?: string }) {
    return this.db.transaction(async (tx: any) => {
      const refResult = await tx.execute(sql`SELECT * FROM refund WHERE id = ${input.refundId} FOR UPDATE`);
      const refRow = refResult.rows?.[0];
      if (!refRow) throw new FinanceDomainError("REFUND_NOT_FOUND", `Refund ${input.refundId} not found`);
      if (refRow.status !== "requested") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot approve from ${refRow.status}`);

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ refundId: input.refundId, action: "approve" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "refund"),
            eq(commandIdempotency.scopeId, input.refundId),
            eq(commandIdempotency.commandType, "refunds.approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { refund: refRow, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "refund",
          scopeId: input.refundId,
          commandType: "refunds.approve",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(refund)
        .set({ status: "approved", approvedAt: now, version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: refRow.wholesale_order_id,
        eventType: "refund.approved",
        payload: sanitizeForJsonb({ refundId: input.refundId, amount: refRow.amount.toString() }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.approved",
          entityType: "refund",
          entityId: input.refundId,
          before: { status: refRow.status },
          after: { status: "approved" },
          metadata: { orderId: refRow.wholesale_order_id },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "refund"),
            eq(commandIdempotency.scopeId, input.refundId),
            eq(commandIdempotency.commandType, "refunds.approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { refund: updated, replayed: false };
    });
  }

  async completeRefund(input: { refundId: string; adminUserId: string; externalReference: string; idempotencyKey: string; actorRole?: string }) {
    if (!input.externalReference || input.externalReference.trim().length === 0) throw new FinanceDomainError("EXTERNAL_REFERENCE_REQUIRED", "externalReference required for refund completion");

    return this.db.transaction(async (tx: any) => {
      const refResult = await tx.execute(sql`SELECT * FROM refund WHERE id = ${input.refundId} FOR UPDATE`);
      const refRow = refResult.rows?.[0];
      if (!refRow) throw new FinanceDomainError("REFUND_NOT_FOUND", `Refund ${input.refundId} not found`);
      if (refRow.status === "completed") return { refund: refRow, replayed: true };
      if (!["approved", "processing"].includes(refRow.status)) throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot complete from ${refRow.status}`);

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ refundId: input.refundId, externalReference: input.externalReference, action: "complete" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "refund"),
            eq(commandIdempotency.scopeId, input.refundId),
            eq(commandIdempotency.commandType, "refunds.complete"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { refund: refRow, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "refund",
          scopeId: input.refundId,
          commandType: "refunds.complete",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(refund)
        .set({ status: "completed", completedAt: now, externalReference: input.externalReference, version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

      // Ledger OUT entry — only completed Refund OUT
      const ledgerEntryId = ledgerId();
      await tx.insert(financialLedgerEntry).values({
        id: ledgerEntryId,
        orderId: refRow.wholesale_order_id,
        childOrderId: refRow.child_order_id,
        refundId: input.refundId,
        paymentId: refRow.payment_id,
        entryType: "refund_completed",
        direction: "OUT",
        amount: refRow.amount,
        currency: refRow.currency,
        externalReference: input.externalReference,
        occurredAt: now,
        createdAt: now,
        metadata: sanitizeForJsonb({ completedBy: input.adminUserId }) as any,
      });

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: refRow.wholesale_order_id,
        eventType: "refund.completed",
        payload: sanitizeForJsonb({ refundId: input.refundId, amount: refRow.amount.toString(), externalReference: input.externalReference, childOrderId: refRow.child_order_id }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.completed",
          entityType: "refund",
          entityId: input.refundId,
          before: { status: refRow.status },
          after: { status: "completed", externalReference: input.externalReference },
          metadata: { orderId: refRow.wholesale_order_id, ledgerId: ledgerEntryId },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: updated.id, resultPayload: sanitizeForJsonb(updated) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "refund"),
            eq(commandIdempotency.scopeId, input.refundId),
            eq(commandIdempotency.commandType, "refunds.complete"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { refund: updated, ledgerId: ledgerEntryId, replayed: false };
    });
  }

  async failRefund(input: { refundId: string; adminUserId: string; reason: string; idempotencyKey: string; actorRole?: string }) {
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "Reason required");
    return this.db.transaction(async (tx: any) => {
      const refResult = await tx.execute(sql`SELECT * FROM refund WHERE id = ${input.refundId} FOR UPDATE`);
      const refRow = refResult.rows?.[0];
      if (!refRow) throw new FinanceDomainError("REFUND_NOT_FOUND", `Refund ${input.refundId} not found`);
      if (refRow.status === "failed") return { refund: refRow, replayed: true };
      if (!["requested", "approved", "processing"].includes(refRow.status)) throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot fail from ${refRow.status}`);

      const now = new Date();
      const [updated] = await tx
        .update(refund)
        .set({ status: "failed", version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

      await tx.insert(orderEvent).values({
        id: eventId(),
        aggregateType: "wholesale_order",
        aggregateId: refRow.wholesale_order_id,
        eventType: "refund.failed",
        payload: sanitizeForJsonb({ refundId: input.refundId, reason: input.reason }) as any,
        actorId: input.adminUserId,
        actorRole: "admin",
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.failed",
          entityType: "refund",
          entityId: input.refundId,
          after: { status: "failed", reason: input.reason },
          metadata: { orderId: refRow.wholesale_order_id },
        },
        tx,
      );

      return { refund: updated, replayed: false };
    });
  }

  // ── Getters with access control helpers ──────────────────────────────
  async getProformasForBuyer(orderId: string, buyerUserId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const orderResult = await dbTx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
      const owner = order.buyer_user_id || order.buyerUserId;
      if (owner !== buyerUserId) throw new FinanceDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
      const proformas = await dbTx.select().from(wholesaleProforma).where(eq(wholesaleProforma.wholesaleOrderId, orderId)).orderBy(wholesaleProforma.createdAt);
      return proformas.map((p: any) => ({
        id: p.id,
        proformaNumber: p.proformaNumber,
        wholesaleOrderId: p.wholesaleOrderId,
        childOrderId: p.childOrderId,
        sellerId: p.sellerId,
        supplierId: p.supplierId,
        status: p.status,
        currency: p.currency,
        itemsTotal: (p.itemsTotal || 0).toString(),
        shippingTotal: (p.shippingTotal || 0).toString(),
        totalAmount: (p.totalAmount || 0).toString(),
        version: p.version,
        issuedAt: p.issuedAt,
        expiresAt: p.expiresAt,
        termsSnapshot: p.termsSnapshot,
      }));
    });
  }

  async getProformasForSupplier(supplierId: string, sellerId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const proformas = await dbTx
        .select()
        .from(wholesaleProforma)
        .where(and(eq(wholesaleProforma.sellerId, sellerId)))
        .orderBy(wholesaleProforma.createdAt);
      // Filter to only supplier's own, and scoped DTO: no buyer evidence, no other seller allocations, no internal audit
      return proformas.map((p: any) => ({
        id: p.id,
        proformaNumber: p.proformaNumber,
        childOrderId: p.childOrderId,
        status: p.status,
        currency: p.currency,
        itemsTotal: (p.itemsTotal || 0).toString(),
        shippingTotal: (p.shippingTotal || 0).toString(),
        totalAmount: (p.totalAmount || 0).toString(),
        version: p.version,
        issuedAt: p.issuedAt,
        // termsSnapshot minimal, no buyer PII
        termsSnapshot: {
          childOrderId: p.childOrderId,
          sellerId: p.sellerId,
          totalAmount: (p.totalAmount || 0).toString(),
          currency: p.currency,
        },
      }));
    });
  }

  async getPaymentsForBuyer(orderId: string, buyerUserId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const orderResult = await dbTx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
      const owner = order.buyer_user_id || order.buyerUserId;
      if (owner !== buyerUserId) throw new FinanceDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
      const payments = await dbTx.select().from(payment).where(eq(payment.wholesaleOrderId, orderId)).orderBy(payment.createdAt);
      return payments.map((p: any) => ({
        id: p.id,
        paymentReference: p.paymentReference,
        method: p.method,
        status: p.status,
        amount: (p.amount || 0).toString(),
        currency: p.currency,
        externalReference: p.externalReference,
        submittedAt: p.submittedAt,
        verifiedAt: p.verifiedAt,
        version: p.version,
      }));
    });
  }

  async getRefundsForBuyer(orderId: string, buyerUserId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const orderResult = await dbTx.execute(sql`SELECT * FROM wholesale_order WHERE id = ${orderId} LIMIT 1`);
      const order = orderResult.rows?.[0];
      if (!order) throw new FinanceDomainError("ORDER_NOT_FOUND", `Order ${orderId} not found`);
      const owner = order.buyer_user_id || order.buyerUserId;
      if (owner !== buyerUserId) throw new FinanceDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
      const refunds = await dbTx.select().from(refund).where(eq(refund.wholesaleOrderId, orderId)).orderBy(refund.createdAt);
      return refunds.map((r: any) => ({
        id: r.id,
        refundReference: r.refundReference,
        childOrderId: r.childOrderId,
        amount: (r.amount || 0).toString(),
        currency: r.currency,
        status: r.status,
        reasonCode: r.reasonCode,
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        completedAt: r.completedAt,
      }));
    });
  }
}
