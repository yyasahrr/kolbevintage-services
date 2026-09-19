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
  refundAllocation,
  refundLine,
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
function refundAllocationId(): string {
  return `rall_${randomUUID().replaceAll("-", "")}`;
}
function refundLineId(): string {
  return `rline_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Phase 4.7.1 (A11) — refund completion evidence must be a *real* external
 * reference (bank tracking code / provider refund id). Placeholders that the
 * code base itself used to fabricate are rejected explicitly.
 */
const FABRICATED_REFERENCE_PATTERN = /^(provider-|ref-manual-|auto-|generated-|placeholder|n\/a$|none$|test$|todo$|tbd$)/i;
export function assertRealRefundEvidence(externalReference: string | undefined | null): string {
  const trimmed = (externalReference || "").trim();
  if (trimmed.length === 0) throw new FinanceDomainError("EXTERNAL_REFERENCE_REQUIRED", "externalReference required for refund completion");
  if (trimmed.length < 4) throw new FinanceDomainError("REFUND_EVIDENCE_INVALID", "externalReference too short to be real evidence");
  if (FABRICATED_REFERENCE_PATTERN.test(trimmed)) throw new FinanceDomainError("REFUND_EVIDENCE_INVALID", "externalReference looks fabricated; a real bank/provider reference is required");
  return trimmed;
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
    // Phase 4.7.1 — provider evidence & refund basis (stable codes)
    else if (
      code === "PAYMENT_PROVIDER_REFERENCE_MISMATCH" ||
      code === "PAYMENT_PROVIDER_AMOUNT_MISMATCH" ||
      code === "PAYMENT_PROVIDER_CURRENCY_MISMATCH" ||
      code === "PAYMENT_PROVIDER_STATE_NOT_FINAL" ||
      code === "PAYMENT_PROVIDER_MISMATCH" ||
      code === "REFUND_SOURCE_PAYMENT_INVALID" ||
      code === "REFUND_ALLOCATION_MISMATCH" ||
      code === "REFUND_LINE_BASIS_MISMATCH" ||
      code === "REFUND_LINE_QUANTITY_EXCEEDED" ||
      code === "REFUND_EXCEEDS_ALLOCATED" ||
      code === "PROVIDER_REFUND_UNSUPPORTED"
    )
      status = 409;
    else if (code === "PROVIDER_NOT_ALLOWED") status = 403;
    else if (code === "REFUND_EVIDENCE_INVALID" || code === "EXTERNAL_REFERENCE_REQUIRED") status = 400;
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

  // Phase 4.7 — Online payment intent with no network under lock pattern
  async createOnlinePaymentIntent(input: {
    orderId: string;
    buyerUserId: string;
    providerName?: string;
    idempotencyKey: string;
    callbackUrl?: string;
    actorRole?: string;
    executor?: DbOrTx;
  }): Promise<{ payment: any; isNew: boolean; replayed: boolean }> {
    // Amount authority: server derives from canonical financial summary currentPayable
    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const providerName = (input.providerName || process.env.WHOLESALE_PAYMENT_PROVIDER || "manual").toLowerCase();

      // Reject fake in production guard (also in registry, but double-check here)
      const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
      const mode = (process.env.PAYMENT_PROVIDER_MODE || "disabled").toLowerCase();
      if (nodeEnv === "production" && (providerName === "fake" || mode === "fake")) {
        throw new FinanceDomainError("PROVIDER_NOT_ALLOWED", "Fake provider prohibited in production", 403);
      }

      const requestHash = hashRequest({ orderId: input.orderId, provider: providerName, method: "online" });

      const [existingIdem] = await tx
        .select()
        .from(commandIdempotency)
        .where(
          and(
            eq(commandIdempotency.scopeType, "wOrder"),
            eq(commandIdempotency.scopeId, input.orderId),
            eq(commandIdempotency.commandType, "payments.create_online_intent"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);

      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new FinanceDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const existingPayment = await tx.select().from(payment).where(eq(payment.id, existingIdem.resultResourceId)).limit(1);
          return { payment: existingPayment[0], isNew: false, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({
          id: `cid_${randomUUID().replaceAll("-", "")}`,
          scopeType: "wOrder",
          scopeId: input.orderId,
          commandType: "payments.create_online_intent",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          state: "pending",
          createdAt: await this.getDbNow(tx),
          updatedAt: await this.getDbNow(tx),
        });
      }

      // Check existing pending payment for same idempotency
      const [existingPaymentByKey] = await tx.select().from(payment).where(and(eq(payment.wholesaleOrderId, input.orderId), eq(payment.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingPaymentByKey) {
        return { payment: existingPaymentByKey, isNew: false, replayed: true };
      }

      // Server derives currency and currentPayable from financial summary
      const summary = await this.getOrderFinancialSummary(input.orderId, tx);
      const currency = summary.currency || "IRR";
      let currentPayable: bigint;
      try {
        currentPayable = BigInt(summary.currentPayable);
      } catch {
        currentPayable = 0n;
      }
      if (currentPayable <= 0n) {
        throw new FinanceDomainError("INSUFFICIENT_PAYMENT_COVERAGE", `Current payable is ${currentPayable.toString()}, cannot create online payment`);
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
              method: "online",
              provider: providerName,
              status: "pending",
              amount: currentPayable as any,
              currency,
              externalReference: null,
              providerReference: null,
              providerState: "created",
              redirectUrl: input.callbackUrl || null,
              providerPayloadHash: null,
              lastProviderCallAt: null,
              providerAttempts: 0,
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
          action: "payment.provider_intent_created",
          entityType: "payment",
          entityId: pid,
          after: { orderId: input.orderId, amount: currentPayable.toString(), currency, provider: providerName, method: "online" },
          metadata: { idempotencyKey: input.idempotencyKey, provider: providerName },
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
            eq(commandIdempotency.commandType, "payments.create_online_intent"),
            eq(commandIdempotency.idempotencyKey, input.idempotencyKey),
          ),
        );

      return { payment: pay, isNew: true, replayed: false };
    });
  }

  // Phase 4.7 — Persist provider intent result outside lock (Transaction B)
  async persistProviderIntentResult(input: {
    paymentId: string;
    providerReference?: string;
    redirectUrl?: string;
    providerState?: string;
    payloadHash?: string;
    providerResult?: any;
    error?: string;
    executor?: DbOrTx;
  }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const payResult = await tx.execute(sql`SELECT * FROM payment WHERE id = ${input.paymentId} FOR UPDATE`);
      const pay = payResult.rows?.[0];
      if (!pay) throw new FinanceDomainError("PAYMENT_NOT_FOUND", `Payment ${input.paymentId} not found`);
      const now = await this.getDbNow(tx);
      let providerReference = input.providerReference;
      let redirectUrl = input.redirectUrl;
      let providerState = input.providerState;
      let payloadHash = input.payloadHash;
      if (input.providerResult) {
        providerReference = input.providerResult.providerReference || input.providerResult.authority || input.providerResult.reference || providerReference;
        redirectUrl = input.providerResult.redirectUrl || input.providerResult.paymentUrl || redirectUrl;
        providerState = input.providerResult.providerState || input.providerResult.state || providerState || "created";
        payloadHash = hashRequest(input.providerResult);
      }
      if (input.error) {
        providerState = "failed";
      }
      const [updated] = await tx
        .update(payment)
        .set({
          providerReference: providerReference || pay.provider_reference,
          redirectUrl: redirectUrl || pay.redirect_url,
          providerState: providerState || pay.provider_state || "pending",
          providerPayloadHash: payloadHash || pay.provider_payload_hash,
          lastProviderCallAt: now,
          providerAttempts: (pay.provider_attempts || 0) + 1,
          updatedAt: now,
        })
        .where(eq(payment.id, input.paymentId))
        .returning();
      return updated;
    });
  }

  // Phase 4.7 — Supersede proforma for shipping fee (fee triggers Finance via Proforma supersede not Order rewrite)
  async supersedeProformaForShipping(input: { proformaId: string; childOrderId: string; shippingAmount: string; quoteId: string; actorId: string; executor: DbOrTx }) {
    const tx = input.executor as any;
    const shippingAmt = BigInt(input.shippingAmount);
    if (shippingAmt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Shipping amount must be >0 for supersede");
    const [old] = await tx.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, input.proformaId)).limit(1).for("update");
    if (!old) throw new FinanceDomainError("PROFORMA_NOT_FOUND", `Proforma ${input.proformaId} not found`);
    if (old.status !== "issued") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot supersede from ${old.status}`);
    if (old.childOrderId !== input.childOrderId) throw new FinanceDomainError("PROFORMA_MISMATCH", "Child order mismatch for supersede");

    // Load lines
    const existingLines = await tx.select().from(wholesaleProformaLine).where(eq(wholesaleProformaLine.proformaId, old.id));
    const itemsTotal = BigInt(old.itemsTotal || 0);
    const newTotal = itemsTotal + shippingAmt;

    // Check if already superseded for same shipping (idempotent guard handled by caller idempotency, but double-check)
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
      itemsTotal: itemsTotal.toString(),
      shippingTotal: shippingAmt.toString(),
      totalAmount: newTotal.toString(),
      issuedAt: now.toISOString(),
      supersededFrom: old.id,
      version: old.version + 1,
      shippingQuoteId: input.quoteId,
      lines: existingLines.map((l: any) => ({
        wholesaleOrderItemId: l.wholesaleOrderItemId,
        purchaseOrderItemId: l.purchaseOrderItemId,
        descriptionSnapshot: l.descriptionSnapshot,
        skuSnapshot: l.skuSnapshot,
        quantity: l.quantity,
        pricingUnit: l.pricingUnit,
        unitPrice: (l.unitPrice || 0).toString(),
        lineTotal: (l.lineTotal || 0).toString(),
      })),
    };

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
            itemsTotal: itemsTotal as any,
            shippingTotal: shippingAmt as any,
            totalAmount: newTotal as any,
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
    if (!newProforma) throw new FinanceDomainError("PROFORMA_NUMBER_COLLISION", "Failed to supersede proforma for shipping", 409);

    for (const l of existingLines) {
      const lineId = proformaLineId();
      await tx.insert(wholesaleProformaLine).values({
        id: lineId,
        proformaId: newProforma.id,
        wholesaleOrderItemId: l.wholesaleOrderItemId,
        purchaseOrderItemId: l.purchaseOrderItemId,
        descriptionSnapshot: l.descriptionSnapshot,
        skuSnapshot: l.skuSnapshot,
        quantity: l.quantity,
        pricingUnit: l.pricingUnit,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        currency: l.currency,
        createdAt: now,
      });
    }

    await tx.update(wholesaleProforma).set({ status: "superseded", supersededBy: newProforma.id, updatedAt: now }).where(eq(wholesaleProforma.id, old.id));

    await this.auditService.record(
      {
        actorId: input.actorId,
        actorRole: "admin",
        action: "proforma.superseded_shipping",
        entityType: "wholesale_proforma",
        entityId: old.id,
        before: { status: old.status, shippingTotal: (old.shippingTotal || 0).toString(), totalAmount: (old.totalAmount || 0).toString() },
        after: { status: "superseded", newId: newProforma.id, shippingTotal: shippingAmt.toString(), totalAmount: newTotal.toString() },
        metadata: { orderId: old.wholesaleOrderId, childOrderId: input.childOrderId, quoteId: input.quoteId },
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
    /** Human verifier (FK account_user). `null` for provider/system-driven verification (webhook, reconciliation). */
    adminUserId: string | null;
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
    if (!["admin", "finance", "system"].includes(input.actorRole || "")) {
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
      if (!["evidence_submitted", "pending"].includes(pay.status)) {
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
          verifiedBy: input.actorRole === "system" ? null : input.adminUserId,
          verifiedAt: now,
          externalReference: input.externalReference,
          providerState: "success",
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
        metadata: sanitizeForJsonb({ verifiedBy: input.adminUserId ?? "system", actorRole: input.actorRole || "admin", reason: input.reason }) as any,
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

  async rejectPayment(input: { paymentId: string; adminUserId: string | null; reason: string; idempotencyKey: string; expectedVersion?: number; actorRole?: string; executor?: DbOrTx }) {
    if (!input.reason) throw new FinanceDomainError("REASON_REQUIRED", "Reason required for rejection");
    if (!["admin", "finance", "system"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may reject payments", 403);
    }
    return this.withExecutor(input.executor, async (tx: any) => {
      const payResult = await tx.execute(sql`SELECT * FROM payment WHERE id = ${input.paymentId} FOR UPDATE`);
      const pay = payResult.rows?.[0];
      if (!pay) throw new FinanceDomainError("PAYMENT_NOT_FOUND", `Payment ${input.paymentId} not found`);
      if (pay.status === "failed") return { payment: pay, replayed: true };
      if (!["evidence_submitted", "pending"].includes(pay.status)) throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot reject from ${pay.status}`);

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
        .set({ status: "failed", failureReason: input.reason, version: pay.version + 1, updatedAt: now, providerState: "failed" })
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
      // Phase 4.7.1 (D2/D4): allocations on superseded ancestors of this proforma
      // (same child) stay immutable and still count — a late fee only leaves the delta open.
      const alreadyAllocated = await this.getLineageAllocatedForProforma(prof, tx, { verifiedOnly: false });
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

  /**
   * Phase 4.7.1 (D2/D3/D4) — verified money allocated to a proforma *lineage*.
   *
   * A superseded proforma (e.g. replaced because a shipping fee was added after
   * payment) keeps its allocations immutable; the successor proforma of the same
   * child inherits that coverage so only the delta remains payable. Voided
   * proformas are excluded (void is only possible before any allocation).
   */
  private async getLineageAllocatedForProforma(prof: { id: string; child_order_id?: string | null; childOrderId?: string | null }, tx: any, opts: { verifiedOnly: boolean }): Promise<bigint> {
    const childId = prof.child_order_id ?? prof.childOrderId ?? null;
    const paymentFilter = opts.verifiedOnly ? sql` AND p.status = 'verified'` : sql``;
    const result = childId
      ? await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
          WHERE wp.child_order_id = ${childId} AND wp.status IN ('issued','superseded') AND pa.status = 'active'${paymentFilter}
        `)
      : await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          WHERE pa.proforma_id = ${prof.id} AND pa.status = 'active'${paymentFilter}
        `);
    return BigInt(result.rows?.[0]?.sum || 0);
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
      const allocated = await this.getLineageAllocatedForProforma(prof, tx, { verifiedOnly: true });
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
    /** FK account_user — `null` for system-driven releases (provider verification). */
    actorId: string | null;
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
      const allProformaResult = await dbTx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId}`);
      const allProformaTotal = BigInt(allProformaResult.rows?.[0]?.sum || 0);

      const activeProformaResult = await dbTx.execute(sql`SELECT COALESCE(SUM(total_amount),0) as sum FROM wholesale_proforma WHERE wholesale_order_id = ${orderId} AND status = 'issued'`);
      const activeProformaTotal = BigInt(activeProformaResult.rows?.[0]?.sum || 0);

      const verifiedPaidResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM payment WHERE wholesale_order_id = ${orderId} AND status = 'verified'`);
      const verifiedPaid = BigInt(verifiedPaidResult.rows?.[0]?.sum || 0);

      // Phase 4.7.1 (D2/D4): allocations on superseded proformas remain immutable
      // and keep covering the child's active proforma (lineage), so a late fee
      // only opens the delta.
      const allocatedResult = await dbTx.execute(sql`
        SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
        JOIN payment p ON p.id = pa.payment_id
        JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
        WHERE p.wholesale_order_id = ${orderId} AND pa.status = 'active' AND p.status = 'verified' AND wp.status IN ('issued','superseded')
      `);
      const allocated = BigInt(allocatedResult.rows?.[0]?.sum || 0);
      const unallocatedPaid = verifiedPaid - allocated;

      const refundRequestedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status IN ('requested','approved','processing')`);
      const refundRequested = BigInt(refundRequestedResult.rows?.[0]?.sum || 0);

      const refundCompletedResult = await dbTx.execute(sql`SELECT COALESCE(SUM(amount),0) as sum FROM refund WHERE wholesale_order_id = ${orderId} AND status = 'completed'`);
      const refundCompleted = BigInt(refundCompletedResult.rows?.[0]?.sum || 0);

      // Outstanding obligation = active proformas minus what verified payments already cover.
      const outstanding = activeProformaTotal - allocated;
      const currentPayable = outstanding > 0n ? outstanding : 0n;
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
    /** Decimal string. Optional when `lines` are supplied (then derived exactly from the lines). */
    amount?: string;
    currency?: string;
    reasonCode?: string;
    reason?: string;
    /** Phase 4.7.1 (A14) — exact item/quantity basis of a partial refund. */
    lines?: Array<{ wholesaleOrderItemId: string; quantity: number }>;
    actorUserId: string;
    actorRole?: string;
    idempotencyKey: string;
    executor?: DbOrTx;
  }) {
    if (!["admin", "finance"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may create refunds", 403);
    }
    const requestedLines = (input.lines || []).map((l) => ({ wholesaleOrderItemId: String(l.wholesaleOrderItemId || ""), quantity: Number(l.quantity) }));
    for (const l of requestedLines) {
      if (!l.wholesaleOrderItemId) throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", "Refund line requires wholesaleOrderItemId");
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", "Refund line quantity must be a positive integer");
    }
    if (requestedLines.length > 0 && !input.childOrderId) {
      throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", "Item-based refunds require childOrderId");
    }
    if (new Set(requestedLines.map((l) => l.wholesaleOrderItemId)).size !== requestedLines.length) {
      throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", "Duplicate wholesaleOrderItemId in refund lines");
    }
    let requestedAmount: bigint | null = null;
    if (input.amount !== undefined && input.amount !== null && String(input.amount).length > 0) {
      try {
        requestedAmount = BigInt(input.amount);
      } catch {
        throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be bigint decimal string");
      }
      if (requestedAmount <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");
    }
    if (requestedAmount === null && requestedLines.length === 0) throw new FinanceDomainError("INVALID_AMOUNT", "Amount or lines required");

    return this.withExecutor(input.executor, async (tx: any) => {
      // ── Serialize refund creation per order: lock the verified source payments ──
      // (Payments owns `payment`; no order-table lock is taken here.)
      const lockedPaymentsResult = await tx.execute(sql`
        SELECT * FROM payment WHERE wholesale_order_id = ${input.orderId} AND status = 'verified' ORDER BY verified_at ASC, id ASC FOR UPDATE
      `);
      const verifiedPayments: any[] = lockedPaymentsResult.rows || [];

      // ── A14: exact item basis (unit price × quantity from the immutable proforma line) ──
      const resolvedLines: Array<{ wholesaleOrderItemId: string; quantity: number; unitPrice: bigint; lineTotal: bigint; currency: string }> = [];
      if (requestedLines.length > 0) {
        const proformaLinesResult = await tx.execute(sql`
          SELECT pl.wholesale_order_item_id, pl.quantity, pl.unit_price, pl.currency
          FROM wholesale_proforma_line pl
          JOIN wholesale_proforma wp ON wp.id = pl.proforma_id
          WHERE wp.child_order_id = ${input.childOrderId} AND wp.wholesale_order_id = ${input.orderId} AND wp.status = 'issued'
        `);
        const byItem = new Map<string, { quantity: number; unitPrice: bigint; currency: string }>();
        for (const row of proformaLinesResult.rows || []) {
          byItem.set(String(row.wholesale_order_item_id), { quantity: Number(row.quantity), unitPrice: BigInt(row.unit_price), currency: String(row.currency || "IRR") });
        }
        for (const line of requestedLines) {
          const basis = byItem.get(line.wholesaleOrderItemId);
          if (!basis) throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", `Item ${line.wholesaleOrderItemId} is not on the active proforma of child ${input.childOrderId}`);
          const refundedQtyResult = await tx.execute(sql`
            SELECT COALESCE(SUM(rl.quantity),0) as sum FROM refund_line rl
            JOIN refund r ON r.id = rl.refund_id
            WHERE rl.wholesale_order_item_id = ${line.wholesaleOrderItemId} AND r.status IN ('requested','approved','processing','completed')
          `);
          const alreadyRefundedQty = Number(refundedQtyResult.rows?.[0]?.sum || 0);
          if (line.quantity + alreadyRefundedQty > basis.quantity) {
            throw new FinanceDomainError(
              "REFUND_LINE_QUANTITY_EXCEEDED",
              `Item ${line.wholesaleOrderItemId}: requested ${line.quantity} + already refunded ${alreadyRefundedQty} exceeds ordered ${basis.quantity}`,
            );
          }
          resolvedLines.push({
            wholesaleOrderItemId: line.wholesaleOrderItemId,
            quantity: line.quantity,
            unitPrice: basis.unitPrice,
            lineTotal: basis.unitPrice * BigInt(line.quantity),
            currency: basis.currency,
          });
        }
      }
      const linesTotal = resolvedLines.reduce((sum, l) => sum + l.lineTotal, 0n);
      let amountBigInt: bigint;
      if (requestedAmount === null) amountBigInt = linesTotal;
      else if (resolvedLines.length > 0 && requestedAmount !== linesTotal) {
        throw new FinanceDomainError("REFUND_LINE_BASIS_MISMATCH", `Amount ${requestedAmount.toString()} does not equal the exact line basis ${linesTotal.toString()}`);
      } else amountBigInt = requestedAmount;
      if (amountBigInt <= 0n) throw new FinanceDomainError("INVALID_AMOUNT", "Amount must be >0");

      // ── Refundable ceiling (child-scoped or order-scoped) ──
      const allocResult = input.childOrderId
        ? await tx.execute(sql`
          SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
          JOIN payment p ON p.id = pa.payment_id
          JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
          WHERE wp.child_order_id = ${input.childOrderId} AND p.status = 'verified' AND pa.status = 'active' AND wp.status IN ('issued','superseded')
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
      const requestHash = hashRequest({
        orderId: input.orderId,
        childOrderId: input.childOrderId,
        amount: amountBigInt.toString(),
        reasonCode: input.reasonCode,
        paymentId: input.paymentId || null,
        lines: requestedLines.map((l) => `${l.wholesaleOrderItemId}:${l.quantity}`).sort(),
      });
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

      // ── A13: map the refund onto concrete verified source payment(s) ──
      // Capacity of a payment = what it contributed to this child (or, order-scoped, its
      // full amount) minus what earlier live refunds already drew from it.
      const candidatePayments = input.paymentId ? verifiedPayments.filter((p) => p.id === input.paymentId) : verifiedPayments;
      if (input.paymentId && candidatePayments.length === 0) {
        throw new FinanceDomainError("REFUND_SOURCE_PAYMENT_INVALID", `Payment ${input.paymentId} is not a verified payment of order ${input.orderId}`);
      }
      const plannedAllocations: Array<{ paymentId: string; amount: bigint; currency: string }> = [];
      let remaining = amountBigInt;
      for (const pay of candidatePayments) {
        if (remaining <= 0n) break;
        const contributedResult = input.childOrderId
          ? await tx.execute(sql`
              SELECT COALESCE(SUM(pa.amount),0) as sum FROM payment_allocation pa
              JOIN wholesale_proforma wp ON wp.id = pa.proforma_id
              WHERE pa.payment_id = ${pay.id} AND pa.status = 'active' AND wp.child_order_id = ${input.childOrderId} AND wp.status IN ('issued','superseded')
            `)
          : { rows: [{ sum: pay.amount }] };
        const contributed = BigInt(contributedResult.rows?.[0]?.sum || 0);
        const drawnResult = await tx.execute(sql`
          SELECT COALESCE(SUM(ra.amount),0) as sum FROM refund_allocation ra
          JOIN refund r ON r.id = ra.refund_id
          WHERE ra.payment_id = ${pay.id} AND r.status IN ('requested','approved','processing','completed')
            ${input.childOrderId ? sql`AND r.child_order_id = ${input.childOrderId}` : sql``}
        `);
        const drawn = BigInt(drawnResult.rows?.[0]?.sum || 0);
        const capacity = contributed - drawn;
        if (capacity <= 0n) continue;
        const take = remaining < capacity ? remaining : capacity;
        plannedAllocations.push({ paymentId: pay.id, amount: take, currency: pay.currency });
        remaining -= take;
      }
      const plannedSum = plannedAllocations.reduce((sum, a) => sum + a.amount, 0n);
      if (remaining !== 0n || plannedSum !== amountBigInt) {
        throw new FinanceDomainError(
          "REFUND_ALLOCATION_MISMATCH",
          `Refund ${amountBigInt.toString()} cannot be mapped onto verified source payments (mappable ${plannedSum.toString()})`,
        );
      }
      const currency = input.currency || plannedAllocations[0]?.currency || "IRR";
      if (plannedAllocations.some((a) => a.currency !== currency) || resolvedLines.some((l) => l.currency !== currency)) {
        throw new FinanceDomainError("CURRENCY_MISMATCH", "Refund currency differs from its source payments / lines");
      }

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
              paymentId: plannedAllocations.length === 1 ? plannedAllocations[0].paymentId : input.paymentId || null,
              amount: amountBigInt as any,
              currency,
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

      for (const alloc of plannedAllocations) {
        await tx.insert(refundAllocation).values({
          id: refundAllocationId(),
          refundId: rid,
          paymentId: alloc.paymentId,
          amount: alloc.amount as any,
          currency,
          createdAt: now,
        });
      }
      for (const line of resolvedLines) {
        await tx.insert(refundLine).values({
          id: refundLineId(),
          refundId: rid,
          wholesaleOrderItemId: line.wholesaleOrderItemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice as any,
          lineTotal: line.lineTotal as any,
          currency,
          createdAt: now,
        });
      }

      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.requested",
          entityType: "refund",
          entityId: rid,
          after: {
            orderId: input.orderId,
            childOrderId: input.childOrderId,
            amount: amountBigInt.toString(),
            sourcePayments: plannedAllocations.map((a) => ({ paymentId: a.paymentId, amount: a.amount.toString() })),
            lines: resolvedLines.map((l) => ({ wholesaleOrderItemId: l.wholesaleOrderItemId, quantity: l.quantity, lineTotal: l.lineTotal.toString() })),
          },
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

      return {
        refund: created,
        allocations: plannedAllocations.map((a) => ({ paymentId: a.paymentId, amount: a.amount })),
        lines: resolvedLines,
        replayed: false,
      };
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
    // A11 — completion needs real evidence (bank tracking code / provider refund id); nothing fabricated.
    const externalReference = assertRealRefundEvidence(input.externalReference);
    input = { ...input, externalReference };

    return this.withExecutor(input.executor, async (tx: any) => {
      // A12 — row lock + persistent idempotency: exactly one completion, exactly one ledger OUT.
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

  /**
   * Phase 4.7.1 (A12) — claim a refund for provider execution: `approved → processing`
   * under the row lock. Exactly one caller wins; the provider call then happens
   * *outside* any DB lock and the outcome is recorded by `completeRefund`/`failRefund`.
   */
  async markRefundProcessing(input: { refundId: string; actorUserId: string; actorRole?: string; executor?: DbOrTx }) {
    if (!["admin", "finance", "system"].includes(input.actorRole || "")) {
      throw new FinanceDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may execute refunds", 403);
    }
    return this.withExecutor(input.executor, async (tx: any) => {
      const refResult = await tx.execute(sql`SELECT * FROM refund WHERE id = ${input.refundId} FOR UPDATE`);
      const refRow = refResult.rows?.[0];
      if (!refRow) throw new FinanceDomainError("REFUND_NOT_FOUND", `Refund ${input.refundId} not found`);
      if (refRow.status === "processing") return { refund: refRow, claimed: false, alreadyProcessing: true };
      if (refRow.status === "completed") return { refund: refRow, claimed: false, alreadyCompleted: true };
      if (refRow.status !== "approved") throw new FinanceDomainError("INVALID_STATUS_TRANSITION", `Cannot execute refund from ${refRow.status}`);
      const now = await this.getDbNow(tx);
      const [updated] = await tx
        .update(refund)
        .set({ status: "processing", version: refRow.version + 1, updatedAt: now })
        .where(eq(refund.id, input.refundId))
        .returning();
      await this.auditService.record(
        {
          actorId: input.actorUserId,
          actorRole: input.actorRole || "admin",
          action: "refund.processing",
          entityType: "refund",
          entityId: input.refundId,
          before: { status: refRow.status },
          after: { status: "processing" },
          metadata: { orderId: refRow.wholesale_order_id },
        },
        tx,
      );
      return { refund: updated, claimed: true };
    });
  }

  async failRefund(input: { refundId: string; adminUserId: string; reason: string; idempotencyKey: string; actorRole?: string; executor?: DbOrTx }) {
    if (!["admin", "finance", "system"].includes(input.actorRole || "")) {
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
      WHERE wp.child_order_id = ${childOrderId} AND p.status = 'verified' AND pa.status = 'active' AND wp.status IN ('issued','superseded')
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

  /**
   * Phase 4.7.1 (A5) — a provider reference identifies exactly one payment *per provider*
   * (DB: partial UNIQUE (provider, provider_reference)). Never look a reference up
   * without its provider.
   */
  async findPaymentByProviderReference(provider: string, providerReference: string, executor?: DbOrTx) {
    if (!provider || !providerReference) return null;
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`SELECT * FROM payment WHERE provider = ${provider.toLowerCase()} AND provider_reference = ${providerReference} LIMIT 1`);
      return result.rows?.[0] || null;
    });
  }

  async getPaymentRowById(paymentId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`SELECT * FROM payment WHERE id = ${paymentId} LIMIT 1`);
      return result.rows?.[0] || null;
    });
  }

  /** Non-manual payments still awaiting a final provider state (reconciliation input). */
  async listUnresolvedProviderPayments(limit = 20, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`
        SELECT id, payment_reference, provider, provider_reference, external_reference, amount, currency, status, provider_state, wholesale_order_id
        FROM payment
        WHERE status IN ('pending','evidence_submitted') AND provider <> 'manual' AND provider_reference IS NOT NULL
        ORDER BY created_at ASC
        LIMIT ${limit}
      `);
      return result.rows || [];
    });
  }

  async getRefundRowById(refundId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`SELECT * FROM refund WHERE id = ${refundId} LIMIT 1`);
      return result.rows?.[0] || null;
    });
  }

  async getRefundAllocations(refundId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`
        SELECT ra.id, ra.refund_id, ra.payment_id, ra.amount, ra.currency, p.provider, p.provider_reference
        FROM refund_allocation ra JOIN payment p ON p.id = ra.payment_id
        WHERE ra.refund_id = ${refundId} ORDER BY ra.created_at ASC, ra.id ASC
      `);
      return result.rows || [];
    });
  }

  async getRefundLines(refundId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const result = await tx.execute(sql`SELECT * FROM refund_line WHERE refund_id = ${refundId} ORDER BY created_at ASC, id ASC`);
      return result.rows || [];
    });
  }
}
