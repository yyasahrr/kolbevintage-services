import { Injectable, Inject } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  wholesaleProforma,
  wholesaleProformaLine,
  payment,
  paymentAllocation,
  orderFinancialRelease,
  financialLedgerEntry,
  refund,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { PaymentsRepository, type DbOrTx } from "./payments.repository";
import { AuditService } from "../audit/audit.service";
import { DomainError } from "@kolbe/shared";
import { createHash, randomUUID } from "node:crypto";

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
    else if (code === "PROFORMA_LINES_MISSING") status = 422;
    super(status, code, message);
    this.name = "FinanceDomainError";
  }
}

export type OrderFinancialSnapshot = {
  orderId: string;
  orderCode: string;
  currency: string;
  paymentMode: string;
  buyerUserId: string;
  version: number;
  status: string;
  grandTotal: string;
  children: Array<{
    childOrderId: string;
    childOrderCode: string;
    sellerId: string;
    supplierId: string | null;
    currency: string;
    items: Array<{
      wholesaleOrderItemId: string;
      purchaseOrderItemId: string;
      descriptionSnapshot: string;
      skuSnapshot: string;
      quantity: number;
      pricingUnit: string;
      unitPrice: string;
      lineTotal: string;
    }>;
  }>;
};

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

  private async getDbNow(tx: any): Promise<Date> {
    const result = await tx.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  private getProformaValidityHours(): number | null {
    const raw = process.env.WHOLESALE_PROFORMA_VALIDITY_HOURS;
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) return null;
    return n;
  }

  async issueProformasFromSnapshot(snapshot: OrderFinancialSnapshot, executor: DbOrTx): Promise<{ proformas: any[]; lines: any[] }> {
    const tx = executor as any;
    const now = await this.getDbNow(tx);
    const validityHours = this.getProformaValidityHours();
    let expiresAt: Date | null = null;
    if (validityHours !== null) {
      expiresAt = new Date(now.getTime() + validityHours * 60 * 60 * 1000);
    }

    const createdProformas: any[] = [];
    const createdLines: any[] = [];

    for (const child of snapshot.children) {
      const childId = child.childOrderId;
      const [existing] = await tx.select().from(wholesaleProforma).where(and(eq(wholesaleProforma.childOrderId, childId), eq(wholesaleProforma.status, "issued"))).limit(1).for("update");
      if (existing) {
        createdProformas.push(existing);
        const lines = await tx.select().from(wholesaleProformaLine).where(eq(wholesaleProformaLine.proformaId, existing.id));
        createdLines.push(...lines);
        continue;
      }

      if (!child.items || child.items.length === 0) {
        throw new FinanceDomainError("PROFORMA_LINES_MISSING", `Child ${childId} has no financial line snapshot`);
      }

      const sellerId = child.sellerId;
      const supplierId = child.supplierId;
      const currency = child.currency || snapshot.currency || "IRR";

      let itemsTotal = 0n;
      for (const it of child.items) {
        itemsTotal += BigInt(it.lineTotal);
      }
      if (itemsTotal <= 0n) {
        throw new FinanceDomainError("PROFORMA_LINES_MISSING", `Child ${childId} has zero total`);
      }
      const shippingTotal = 0n;
      const totalAmount = itemsTotal + shippingTotal;

      const termsSnapshot = {
        orderId: snapshot.orderId,
        childOrderId: childId,
        sellerId,
        supplierId,
        currency,
        itemsTotal: itemsTotal.toString(),
        shippingTotal: shippingTotal.toString(),
        totalAmount: totalAmount.toString(),
        paymentMode: snapshot.paymentMode,
        issuedAt: now.toISOString(),
        parentOrderCode: snapshot.orderCode,
        childOrderCode: child.childOrderCode,
        originalGrandTotal: snapshot.grandTotal,
        version: 1,
        lines: child.items.map((it) => ({
          wholesaleOrderItemId: it.wholesaleOrderItemId,
          purchaseOrderItemId: it.purchaseOrderItemId,
          descriptionSnapshot: it.descriptionSnapshot,
          skuSnapshot: it.skuSnapshot,
          quantity: it.quantity,
          pricingUnit: it.pricingUnit,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
        })),
      };

      let proforma: any = null;
      let attempts = 0;
      const maxAttempts = 5;
      while (attempts < maxAttempts) {
        const pid = proformaId();
        const pNumber = generateProformaNumber();
        try {
          const [inserted] = await tx
            .insert(wholesaleProforma)
            .values({
              id: pid,
              proformaNumber: pNumber,
              wholesaleOrderId: snapshot.orderId,
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
              expiresAt,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          proforma = inserted;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && (e?.constraint?.includes("proforma_number") || e?.message?.includes("proforma_number") || e?.constraint?.includes("proformaNumber"))) {
            attempts++;
            if (attempts >= maxAttempts) throw new FinanceDomainError("PROFORMA_NUMBER_COLLISION", "Proforma number collision after retries", 409);
            continue;
          }
          throw e;
        }
      }
      if (!proforma) throw new FinanceDomainError("PROFORMA_NUMBER_COLLISION", "Failed to issue proforma", 409);

      createdProformas.push(proforma);

      for (const it of child.items) {
        const lineId = proformaLineId();
        const [line] = await tx
          .insert(wholesaleProformaLine)
          .values({
            id: lineId,
            proformaId: proforma.id,
            wholesaleOrderItemId: it.wholesaleOrderItemId,
            purchaseOrderItemId: it.purchaseOrderItemId,
            descriptionSnapshot: it.descriptionSnapshot,
            skuSnapshot: it.skuSnapshot,
            quantity: it.quantity,
            pricingUnit: it.pricingUnit,
            unitPrice: BigInt(it.unitPrice) as any,
            lineTotal: BigInt(it.lineTotal) as any,
            currency,
            createdAt: now,
          })
          .returning();
        createdLines.push(line);
      }
    }

    return { proformas: createdProformas, lines: createdLines };
  }

  async issueProformasForOrder(orderId: string, executor: DbOrTx): Promise<{ proformas: any[]; lines: any[] }> {
    throw new FinanceDomainError("DEPRECATED_METHOD", "issueProformasForOrder deprecated, use issueProformasFromSnapshot with Orders financial snapshot", 400);
  }

  async voidProforma(proformaId: string, actorId: string, reason: string, executor: DbOrTx) {
    const tx = executor as any;
    const [proforma] = await tx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, proformaId)).limit(1).for("update");
    if (!proforma) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${proformaId} not found`);
    if (proforma.status !== "issued") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot void from ${proforma.status}`);
    const now = await this.getDbNow(tx);
    const [updated] = await tx.update(wholesaleProforma).set({ status: "voided", updatedAt: now }).where(eq(wholesaleProforma.id, proformaId)).returning();
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

  async supersedeProforma(oldProformaId: string, newProformaData: { itemsTotal: bigint; shippingTotal: bigint; totalAmount: bigint; items: OrderFinancialSnapshot["children"][0]["items"] }, actorId: string, executor: DbOrTx) {
    const tx = executor as any;
    const [old] = await tx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, oldProformaId)).limit(1).for("update");
    if (!old) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${oldProformaId} not found`);
    if (old.status !== "issued") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot supersede from ${old.status}`);

    const now = await this.getDbNow(tx);
    const validityHours = this.getProformaValidityHours();
    let expiresAt: Date | null = null;
    if (validityHours !== null) {
      expiresAt = new Date(now.getTime() + validityHours * 60 * 60 * 1000);
    }

    const newTermsSnapshot = {
      orderId: old.wholesaleOrderId,
      childOrderId: old.childOrderId,
      sellerId: old.sellerId,
      supplierId: old.supplierId,
      currency: old.currency,
      itemsTotal: newProformaData.itemsTotal.toString(),
      shippingTotal: newProformaData.shippingTotal.toString(),
      totalAmount: newProformaData.totalAmount.toString(),
      issuedAt: now.toISOString(),
      supersededFrom: old.id,
      version: old.version + 1,
      lines: newProformaData.items.map((it) => ({
        wholesaleOrderItemId: it.wholesaleOrderItemId,
        purchaseOrderItemId: it.purchaseOrderItemId,
        descriptionSnapshot: it.descriptionSnapshot,
        skuSnapshot: it.skuSnapshot,
        quantity: it.quantity,
        pricingUnit: it.pricingUnit,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
      })),
    };

    if (newProformaData.itemsTotal + newProformaData.shippingTotal !== newProformaData.totalAmount) {
      throw new FinanceDomainError("PROFORMA_INCONSISTENT_SNAPSHOT", "New proforma totals inconsistent", 400);
    }

    let newProforma: any = null;
    let attempts = 0;
    while (attempts < 5) {
      const newId = proformaId();
      const newNumber = generateProformaNumber();
      try {
        const [inserted] = await tx
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
            itemsTotal: newProformaData.itemsTotal as any,
            shippingTotal: newProformaData.shippingTotal as any,
            totalAmount: newProformaData.totalAmount as any,
            termsSnapshot: sanitizeForJsonb(newTermsSnapshot) as any,
            issuedAt: now,
            expiresAt,
            supersededBy: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        newProforma = inserted;
        break;
      } catch (e: any) {
        if (e?.code === "23505" && e?.message?.includes("proforma_number")) {
          attempts++;
          continue;
        }
        throw e;
      }
    }
    if (!newProforma) throw new FinanceDomainError("PROFORMA_NUMBER_COLLISION", "Failed to supersede proforma", 409);

    for (const it of newProformaData.items) {
      const lineId = proformaLineId();
      await tx.insert(wholesaleProformaLine).values({
        id: lineId,
        proformaId: newProforma.id,
        wholesaleOrderItemId: it.wholesaleOrderItemId,
        purchaseOrderItemId: it.purchaseOrderItemId,
        descriptionSnapshot: it.descriptionSnapshot,
        skuSnapshot: it.skuSnapshot,
        quantity: it.quantity,
        pricingUnit: it.pricingUnit,
        unitPrice: BigInt(it.unitPrice) as any,
        lineTotal: BigInt(it.lineTotal) as any,
        currency: old.currency,
        createdAt: now,
      });
    }

    await tx.update(wholesaleProforma).set({ status: "superseded", supersededBy: newProforma.id, updatedAt: now }).where(eq(wholesaleProforma.id, oldProformaId));

    await this.auditService.record(
      {
        actorId,
        actorRole: "admin",
        action: "proforma.superseded",
        entityType: "wholesale_proforma",
        entityId: oldProformaId,
        before: { status: old.status, id: oldProformaId },
        after: { status: "superseded", newId: newProforma.id, version: newProforma.version },
        metadata: { orderId: old.wholesaleOrderId },
      },
      tx,
    );

    return newProforma;
  }

  async submitTransferPayment(input: {
    orderId: string;
    buyerUserId: string;
    amount: string;
    bankReference?: string;
    evidenceReference?: string;
    idempotencyKey: string;
    actorRole?: string;
    executor?: DbOrTx;
  }) {
    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(input.amount);
    } catch {
      throw new FinanceDomainError("INVALID_AMOUNT", `Amount ${input.amount} invalid, must be decimal string bigint`);
    }
    if (amountBigInt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");

    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, amount: input.amount, bankReference: input.bankReference, evidenceReference: input.evidenceReference, method: "manual_transfer" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
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
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "payments.submit_transfer",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const [existingPaymentByKey] = await tx.select().from(payment).where(and(eq(payment.wholesaleOrderId, input.orderId), eq(payment.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingPaymentByKey) {
        return { payment: existingPaymentByKey, replayed: true };
      }

      let currency = "IRR";
      const proformaResult = await tx.execute(sql`SELECT currency FROM wholesale_proforma WHERE wholesale_order_id = ${input.orderId} AND status = 'issued' LIMIT 1`);
      if (proformaResult.rows?.[0]?.currency) {
        currency = proformaResult.rows[0].currency;
      }

      const now = await this.getDbNow(tx);
      const pid = paymentId();
      let pref = generatePaymentReference();
      let pay: any = null;
      let attempts = 0;
      while (attempts < 5) {
        try {
          const [inserted] = await tx
            .insert(payment)
            .values({
              id: pid,
              paymentReference: pref,
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
          pay = inserted;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && e?.message?.includes("payment_reference")) {
            attempts++;
            pref = generatePaymentReference();
            continue;
          }
          throw e;
        }
      }
      if (!pay) throw new FinanceDomainError("PAYMENT_REFERENCE_COLLISION", "Payment reference collision", 409);

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
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "payments.submit_transfer"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { payment: pay, replayed: false };
    });
  }

  async verifyPayment(input: {
    paymentId: string;
    adminUserId: string;
    expectedVersion?: number;
    externalReference: string;
    idempotencyKey: string;
    actorRole?: string;
    reason?: string;
    executor?: DbOrTx;
  }) {
    if (!input.externalReference || input.externalReference.trim().length === 0) {
      throw new FinanceDomainError("EXTERNAL_REFERENCE_REQUIRED", "externalReference required for verification");
    }
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may verify payments", 403);
    }

    return this.withExecutor(input.executor, async (tx: any) => {
      const payResult = await tx.execute(sql`SELECT * FROM payment WHERE id = ${input.paymentId} FOR UPDATE`);
      const pay = payResult.rows?.[0];
      if (!pay) throw new FinanceDomainError("PAYMENT_NOT_FOUND", `Payment ${input.paymentId} not found`);

      if (input.expectedVersion !== undefined && pay.version !== input.expectedVersion) {
        throw new FinanceDomainError("VERSION_CONFLICT", `Version conflict expected ${input.expectedVersion} got ${pay.version}`);
      }

      if (pay.status === "verified") {
        return { payment: pay, replayed: true, allocations: [] };
      }
      if (pay.status !== "evidence_submitted") {
        throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot verify from ${pay.status}`);
      }

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
          return { payment: pay, replayed: true, allocations: [], payload: existingIdem.resultPayload };
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
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
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

      const allocations = await this.allocatePaymentToProformas(
        {
          paymentId: input.paymentId,
          orderId: pay.wholesale_order_id,
          amount: BigInt(pay.amount),
          currency: pay.currency,
        },
        tx,
      );

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "payment.verified",
          entityType: "payment",
          entityId: input.paymentId,
          before: { status: pay.status },
          after: { status: "verified", externalReference: "***masked***", amount: pay.amount.toString() },
          metadata: { orderId: pay.wholesale_order_id, idempotencyKey: input.idempotencyKey, referencePresent: true },
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

      return { payment: verified, allocations, ledgerId: ledgerEntryId, replayed: false };
    });
  }

  async rejectPayment(input: { paymentId: string; adminUserId: string; reason: string; idempotencyKey: string; expectedVersion?: number; actorRole?: string; executor?: DbOrTx }) {
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "Reason required for rejection");
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may reject payments", 403);
    }
    return this.withExecutor(input.executor, async (tx: any) => {
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
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
      const [updated] = await tx
        .update(payment)
        .set({ status: "failed", failureReason: input.reason, version: pay.version + 1, updatedAt: now })
        .where(eq(payment.id, input.paymentId))
        .returning();

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
    const proformasResult = await tx.execute(sql`
      SELECT * FROM wholesale_proforma
      WHERE wholesale_order_id = ${input.orderId} AND status = 'issued'
      ORDER BY child_order_id ASC, id ASC
      FOR UPDATE
    `);
    const proformas = proformasResult.rows;

    const allocations: any[] = [];
    let remaining = input.amount;

    for (const prof of proformas) {
      if (remaining <= 0n) break;
      if (prof.currency !== input.currency) {
        throw new FinanceDomainError("CURRENCY_MISMATCH", `Proforma ${prof.id} currency ${prof.currency} != payment ${input.currency}`);
      }
      const profId = prof.id;
      const profTotal = BigInt(prof.total_amount);
      const allocResult = await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment_allocation WHERE proforma_id = ${profId} AND status = 'active'`);
      const alreadyAllocated = BigInt(allocResult.rows?.[0]?.sum || 0);
      if (alreadyAllocated >= profTotal) continue;
      const needed = profTotal - alreadyAllocated;
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
          createdAt: await this.getDbNow(tx),
        })
        .returning();
      allocations.push(alloc);
      remaining -= toAllocate;
    }

    return allocations;
  }

  async getFinancialCoverageStatus(orderId: string, executor: DbOrTx): Promise<{ payable: bigint; allocated: bigint; isFullyCovered: boolean; proformaCoverage: Array<{ proformaId: string; total: bigint; allocated: bigint; covered: boolean }> }> {
    const tx = executor as any;
    const proformasResult = await tx.execute(sql`
      SELECT * FROM wholesale_proforma
      WHERE wholesale_order_id = ${orderId} AND status = 'issued'
      ORDER BY child_order_id ASC
      FOR UPDATE
    `);
    const proformas = proformasResult.rows;

    let payable = 0n;
    const proformaCoverage: Array<{ proformaId: string; total: bigint; allocated: bigint; covered: boolean }> = [];

    for (const prof of proformas) {
      const total = BigInt(prof.total_amount);
      payable += total;
      const allocResult = await tx.execute(sql`
        SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
        JOIN payment p ON p.id = pa.payment_id
        WHERE pa.proforma_id = ${prof.id} AND pa.status = 'active' AND p.status = 'verified'
      `);
      const allocated = BigInt(allocResult.rows?.[0]?.sum || 0);
      proformaCoverage.push({
        proformaId: prof.id,
        total,
        allocated,
        covered: allocated >= total,
      });
    }

    const isFullyCovered = proformaCoverage.length > 0 && proformaCoverage.every((c) => c.covered);
    const allocated = proformaCoverage.reduce((s, c) => s + c.allocated, 0n);

    return { payable, allocated, isFullyCovered, proformaCoverage };
  }

  async createFinancialRelease(input: {
    orderId: string;
    releaseType: string;
    evidenceReference?: string;
    amount: string;
    currency: string;
    actorId: string;
    actorRole: string;
    reason: string;
    executor: DbOrTx;
  }) {
    const tx = input.executor as any;
    const existing = await tx.execute(sql`SELECT * FROM order_financial_release WHERE order_id = ${input.orderId} AND release_type = ${input.releaseType} FOR UPDATE`);
    if (existing.rows?.length > 0 && input.releaseType === "payment_verified") {
      return { release: existing.rows[0], replayed: true };
    }

    const now = await this.getDbNow(tx);
    const relId = releaseId();
    const [release] = await tx
      .insert(orderFinancialRelease)
      .values({
        id: relId,
        orderId: input.orderId,
        releaseType: input.releaseType as any,
        evidenceReference: input.evidenceReference || null,
        amount: BigInt(input.amount) as any,
        currency: input.currency,
        actorId: input.actorId,
        actorRole: input.actorRole,
        reason: input.reason,
        createdAt: now,
      })
      .returning();

    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: "financial.release_created",
        entityType: "order_financial_release",
        entityId: relId,
        after: { orderId: input.orderId, releaseType: input.releaseType, amount: input.amount },
        metadata: { releaseId: relId, referencePresent: !!input.evidenceReference },
      },
      tx,
    );

    return { release, replayed: false };
  }

  async releaseWithCredit(input: {
    orderId: string;
    adminUserId: string;
    evidenceReference: string;
    amount?: string;
    currency?: string;
    reason: string;
    idempotencyKey: string;
    actorRole?: string;
    executor?: DbOrTx;
  }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may approve credit", 403);
    }
    if (!input.evidenceReference || input.evidenceReference.trim().length === 0) throw new FinanceDomainError("EVIDENCE_REQUIRED", "evidenceReference required for credit approval");
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "reason required");

    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, evidenceReference: input.evidenceReference, type: "credit" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.credit_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { orderId: input.orderId, replayed: true, result: existingIdem.resultPayload };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "finance.credit_approve",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
      const relId = releaseId();
      let currency = input.currency || "IRR";
      const proformaResult = await tx.execute(sql`SELECT currency FROM wholesale_proforma WHERE wholesale_order_id = ${input.orderId} AND status = 'issued' LIMIT 1`);
      if (proformaResult.rows?.[0]?.currency) currency = proformaResult.rows[0].currency;

      await tx.insert(orderFinancialRelease).values({
        id: relId,
        orderId: input.orderId,
        releaseType: "credit_approved",
        evidenceReference: input.evidenceReference,
        amount: input.amount ? (BigInt(input.amount) as any) : null,
        currency,
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "financial.credit_approved",
          entityType: "order_financial_release",
          entityId: relId,
          after: { orderId: input.orderId, releaseType: "credit_approved", referencePresent: true },
          metadata: { releaseId: relId },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: relId, resultPayload: sanitizeForJsonb({ releaseId: relId }) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.credit_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { releaseId: relId, replayed: false };
    });
  }

  async releaseWithCod(input: {
    orderId: string;
    adminUserId: string;
    evidenceReference: string;
    reason: string;
    idempotencyKey: string;
    actorRole?: string;
    executor?: DbOrTx;
  }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may approve COD", 403);
    }
    if (!input.evidenceReference || input.evidenceReference.trim().length === 0) throw new FinanceDomainError("EVIDENCE_REQUIRED", "evidenceReference required for COD policy approval");
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "reason required");

    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, evidenceReference: input.evidenceReference, type: "cod" });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.cod_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused", 409);
        if (existingIdem.state === "completed") return { orderId: input.orderId, replayed: true };
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "finance.cod_approve",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
      const relId = releaseId();
      let currency = "IRR";
      const proformaResult = await tx.execute(sql`SELECT currency FROM wholesale_proforma WHERE wholesale_order_id = ${input.orderId} AND status = 'issued' LIMIT 1`);
      if (proformaResult.rows?.[0]?.currency) currency = proformaResult.rows[0].currency;

      await tx.insert(orderFinancialRelease).values({
        id: relId,
        orderId: input.orderId,
        releaseType: "cod_policy_approved",
        evidenceReference: input.evidenceReference,
        currency,
        actorId: input.adminUserId,
        actorRole: "admin",
        reason: input.reason,
        createdAt: now,
      });

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "financial.cod_approved",
          entityType: "order_financial_release",
          entityId: relId,
          after: { orderId: input.orderId, releaseType: "cod_policy_approved", referencePresent: true },
          metadata: { releaseId: relId },
        },
        tx,
      );

      await tx
        .update(commandIdempotency)
        .set({ state: "completed", resultResourceId: relId, resultPayload: sanitizeForJsonb({ releaseId: relId }) as any, completedAt: now, updatedAt: now })
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "finance.cod_approve"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { releaseId: relId, replayed: false };
    });
  }

  async getOrderFinancialSummary(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      // Payments owns only its tables — do NOT read wholesale_order for original total
      // Active issued total is payable, original total is derived from sum of all proformas (issued+voided+superseded) or fallback to active
      const allProformaResult = await dbTx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId}`);
      const allProformaTotal = BigInt(allProformaResult.rows?.[0]?.sum || 0);

      const activeProformaResult = await dbTx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId} AND status = 'issued'`);
      const activeProformaTotal = BigInt(activeProformaResult.rows?.[0]?.sum || 0);

      const verifiedPaidResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment WHERE wholesale_order_id = ${orderId} AND status = 'verified'`);
      const verifiedPaid = BigInt(verifiedPaidResult.rows?.[0]?.sum || 0);

      const allocatedResult = await dbTx.execute(sql`
        SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
        JOIN payment p ON p.id = pa.payment_id
        JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
        WHERE p.wholesale_order_id = ${orderId} AND pa.status = 'active' AND p.status = 'verified' AND wp.status = 'issued'
      `);
      const allocated = BigInt(allocatedResult.rows?.[0]?.sum || 0);
      const unallocatedPaid = verifiedPaid - allocated;

      const refundRequestedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status IN ('requested','approved','processing')`);
      const refundRequested = BigInt(refundRequestedResult.rows?.[0]?.sum || 0);

      const refundCompletedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status = 'completed'`);
      const refundCompleted = BigInt(refundCompletedResult.rows?.[0]?.sum || 0);

      const currentPayable = activeProformaTotal;
      const netCollected = verifiedPaid - refundCompleted;
      const currencyResult = await dbTx.execute(sql`SELECT currency FROM wholesale_proforma WHERE wholesale_order_id = ${orderId} LIMIT 1`);
      const currency = currencyResult.rows?.[0]?.currency || "IRR";

      return {
        orderId,
        originalOrderTotal: allProformaTotal > 0n ? allProformaTotal.toString() : activeProformaTotal.toString(),
        activeProformaTotal: activeProformaTotal.toString(),
        verifiedPaid: verifiedPaid.toString(),
        allocatedPaid: allocated.toString(),
        unallocatedPaid: unallocatedPaid.toString(),
        refundRequested: refundRequested.toString(),
        refundCompleted: refundCompleted.toString(),
        currentPayable: currentPayable.toString(),
        netCollected: netCollected.toString(),
        currency,
      };
    });
  }

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
    executor?: DbOrTx;
  }) {
    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(input.amount);
    } catch {
      throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be bigint decimal string");
    }
    if (amountBigInt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may create refunds", 403);
    }

    return this.withExecutor(input.executor, async (tx: any) => {
      const allocResult = input.childOrderId
        ? await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
          WHERE wp.child_order_id = ${input.childOrderId} AND p.status = 'verified' AND pa.status = 'active' AND wp.status = 'issued'
        `)
        : await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment WHERE wholesale_order_id = ${input.orderId} AND status = 'verified'`);
      const allocatedToChild = BigInt(allocResult.rows?.[0]?.sum || 0);

      const refundResult = input.childOrderId
        ? await tx.execute(sql`
          SELECT COALESCE(SUM(amount),0) as sum FROM refund
          WHERE child_order_id = ${input.childOrderId} AND status IN ('requested','approved','processing','completed')
        `)
        : await tx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${input.orderId} AND status IN ('requested','approved','processing','completed')`);
      const alreadyRefunded = BigInt(refundResult.rows?.[0]?.sum || 0);

      const refundable = allocatedToChild - alreadyRefunded;

      if (amountBigInt > refundable) {
        throw new FinanceDomainError("REFUND_EXCEEDS_ALLOCATED", `Refund ${amountBigInt.toString()} exceeds refundable ${refundable.toString()} for child ${input.childOrderId || "parent"}`, 409);
      }

      const { commandIdempotency } = await import("@kolbe/database");
      const requestHash = hashRequest({ orderId: input.orderId, childOrderId: input.childOrderId, amount: input.amount, reasonCode: input.reasonCode });
      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
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
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "refunds.create",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const [existingRefundByKey] = await tx.select().from(refund).where(and(eq(refund.wholesaleOrderId, input.orderId), eq(refund.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingRefundByKey) return { refund: existingRefundByKey, replayed: true };

      const now = await this.getDbNow(tx);
      const rid = refundId();
      let rref = generateRefundReference();
      let created: any = null;
      let attempts = 0;
      while (attempts < 5) {
        try {
          const [inserted] = await tx
            .insert(refund)
            .values({
              id: rid,
              refundReference: rref,
              wholesaleOrderId: input.orderId,
              childOrderId: input.childOrderId || null,
              fulfillmentExceptionId: input.exceptionId || null,
              paymentId: input.paymentId || null,
              amount: amountBigInt as any,
              currency: input.currency || "IRR",
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
          created = inserted;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && e?.message?.includes("refund_reference")) {
            attempts++;
            rref = generateRefundReference();
            continue;
          }
          throw e;
        }
      }
      if (!created) throw new FinanceDomainError("REFUND_REFERENCE_COLLISION", "Refund reference collision", 409);

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
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "refunds.create"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { refund: created, replayed: false };
    });
  }

  async approveRefund(input: { refundId: string; adminUserId: string; idempotencyKey: string; reason?: string; actorRole?: string; executor?: DbOrTx }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may approve refunds", 403);
    }
    return this.withExecutor(input.executor, async (tx: any) => {
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
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
      const [updated] = await tx
        .update(refund)
        .set({ status: "approved", approvedAt: now, version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

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

  async completeRefund(input: { refundId: string; adminUserId: string; externalReference: string; idempotencyKey: string; actorRole?: string; executor?: DbOrTx }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may complete refunds", 403);
    }
    if (!input.externalReference || input.externalReference.trim().length === 0) throw new FinanceDomainError("EXTERNAL_REFERENCE_REQUIRED", "externalReference required for refund completion");

    return this.withExecutor(input.executor, async (tx: any) => {
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
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      const now = await this.getDbNow(tx);
      const [updated] = await tx
        .update(refund)
        .set({ status: "completed", completedAt: now, externalReference: input.externalReference, version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

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

      await this.auditService.record(
        {
          actorId: input.adminUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.completed",
          entityType: "refund",
          entityId: input.refundId,
          before: { status: refRow.status },
          after: { status: "completed", referencePresent: true },
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

  async failRefund(input: { refundId: string; adminUserId: string; reason: string; idempotencyKey: string; actorRole?: string; executor?: DbOrTx }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may fail refunds", 403);
    }
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "Reason required");
    return this.withExecutor(input.executor, async (tx: any) => {
      const refResult = await tx.execute(sql`SELECT * FROM refund WHERE id = ${input.refundId} FOR UPDATE`);
      const refRow = refResult.rows?.[0];
      if (!refRow) throw new FinanceDomainError("REFUND_NOT_FOUND", `Refund ${input.refundId} not found`);
      if (refRow.status === "failed") return { refund: refRow, replayed: true };
      if (!["requested", "approved", "processing"].includes(refRow.status)) throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot fail from ${refRow.status}`);

      const now = await this.getDbNow(tx);
      const [updated] = await tx
        .update(refund)
        .set({ status: "failed", version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();

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

  // ── Getters — Payments owns only its tables, no wholesale_order reads ──
  async getProformasForBuyer(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
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

  async getProformasForSupplierBySellerId(sellerId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const proformas = await dbTx
        .select()
        .from(wholesaleProforma)
        .where(and(eq(wholesaleProforma.sellerId, sellerId)))
        .orderBy(wholesaleProforma.createdAt);
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
        expiresAt: p.expiresAt,
        termsSnapshot: {
          childOrderId: p.childOrderId,
          sellerId: p.sellerId,
          totalAmount: (p.totalAmount || 0).toString(),
          currency: p.currency,
        },
      }));
    });
  }

  async getProformaForSupplierById(proformaId: string, sellerId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const [proforma] = await dbTx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, proformaId)).limit(1);
      if (!proforma) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${proformaId} not found`);
      if (proforma.sellerId !== sellerId) throw new FinanceDomainError("PROFORMA_ACCESS_DENIED", "Access denied to proforma", 403);
      return {
        id: proforma.id,
        proformaNumber: proforma.proformaNumber,
        childOrderId: proforma.childOrderId,
        status: proforma.status,
        currency: proforma.currency,
        itemsTotal: (proforma.itemsTotal || 0).toString(),
        shippingTotal: (proforma.shippingTotal || 0).toString(),
        totalAmount: (proforma.totalAmount || 0).toString(),
        version: proforma.version,
        issuedAt: proforma.issuedAt,
        expiresAt: proforma.expiresAt,
        termsSnapshot: {
          childOrderId: proforma.childOrderId,
          sellerId: proforma.sellerId,
          totalAmount: (proforma.totalAmount || 0).toString(),
          currency: proforma.currency,
        },
      };
    });
  }

  async getPaymentsForBuyer(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const payments = await dbTx.select().from(payment).where(eq(payment.wholesaleOrderId, orderId)).orderBy(payment.createdAt);
      return payments.map((p: any) => ({
        id: p.id,
        paymentReference: p.paymentReference,
        method: p.method,
        status: p.status,
        amount: (p.amount || 0).toString(),
        currency: p.currency,
        externalReference: p.status === "evidence_submitted" ? (p.externalReference ? "***present***" : null) : null,
        referencePresent: !!p.externalReference,
        submittedAt: p.submittedAt,
        verifiedAt: p.verifiedAt,
        version: p.version,
      }));
    });
  }

  async getPaymentsForAdmin(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const payments = await dbTx.select().from(payment).where(eq(payment.wholesaleOrderId, orderId)).orderBy(payment.createdAt);
      return payments.map((p: any) => ({
        id: p.id,
        paymentReference: p.paymentReference,
        wholesaleOrderId: p.wholesaleOrderId,
        method: p.method,
        provider: p.provider,
        status: p.status,
        amount: (p.amount || 0).toString(),
        currency: p.currency,
        externalReference: p.externalReference,
        submittedBy: p.submittedBy,
        submittedAt: p.submittedAt,
        verifiedBy: p.verifiedBy,
        verifiedAt: p.verifiedAt,
        version: p.version,
      }));
    });
  }

  async getRefundsForBuyer(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
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

  async getRefundsForAdmin(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx) => {
      const dbTx = tx as any;
      const refunds = await dbTx.select().from(refund).where(eq(refund.wholesaleOrderId, orderId)).orderBy(refund.createdAt);
      return refunds.map((r: any) => ({
        id: r.id,
        refundReference: r.refundReference,
        wholesaleOrderId: r.wholesaleOrderId,
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

  async getIssuedProformaForChild(childOrderId: string, executor: DbOrTx) {
    const tx = executor as any;
    const [proforma] = await tx.select().from(wholesaleProforma).where(and(eq(wholesaleProforma.childOrderId, childOrderId), eq(wholesaleProforma.status, "issued"))).limit(1).for("update");
    return proforma || null;
  }

  async getVerifiedAllocationSumForChild(childOrderId: string, executor: DbOrTx): Promise<bigint> {
    const tx = executor as any;
    const allocCheck = await tx.execute(sql`
      SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
      JOIN payment p ON p.id = pa.payment_id
      JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
      WHERE wp.child_order_id = ${childOrderId} AND p.status = 'verified' AND pa.status = 'active' AND wp.status = 'issued'
    `);
    return BigInt(allocCheck.rows?.[0]?.sum || 0);
  }

  async getRefundObligationsForOrder(orderId: string, childOrderIds: string[], executor: DbOrTx): Promise<Array<{ childOrderId: string; amount: bigint }>> {
    const tx = executor as any;
    const obligations: Array<{ childOrderId: string; amount: bigint }> = [];
    for (const childId of childOrderIds) {
      const sum = await this.getVerifiedAllocationSumForChild(childId, tx);
      if (sum > 0n) obligations.push({ childOrderId: childId, amount: sum });
    }
    return obligations;
  }

  async createManualReleaseForVoid(input: { orderId: string; childOrderId: string; actorId: string; actorRole: string; currency: string; reason: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const now = await this.getDbNow(tx);
    const relId = releaseId();
    await tx.insert(orderFinancialRelease).values({
      id: relId,
      orderId: input.orderId,
      releaseType: "manual_authorized_release",
      evidenceReference: `void_proforma_${input.childOrderId}`,
      amount: null,
      currency: input.currency || "IRR",
      actorId: input.actorId,
      actorRole: input.actorRole,
      reason: input.reason,
      createdAt: now,
    });
    return { releaseId: relId, createdAt: now };
  }
}
