import { Injectable, Inject } from "@nestjs/common";
import { eq, and, sql, desc } from "drizzle-orm";
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

export type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  // Proforma
  async findProformasByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(wholesaleProforma).where(eq(wholesaleProforma.wholesaleOrderId, orderId)).orderBy(wholesaleProforma.createdAt);
  }

  async findProformaByChildId(childOrderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(wholesaleProforma).where(and(eq(wholesaleProforma.childOrderId, childOrderId), eq(wholesaleProforma.status, "issued"))).limit(1);
    return row || null;
  }

  async findProformaById(id: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(wholesaleProforma).where(eq(wholesaleProforma.id, id)).limit(1);
    return row || null;
  }

  async findProformaLines(proformaId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(wholesaleProformaLine).where(eq(wholesaleProformaLine.proformaId, proformaId));
  }

  // Payment
  async findPaymentsByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(payment).where(eq(payment.wholesaleOrderId, orderId)).orderBy(desc(payment.createdAt));
  }

  async findPaymentById(id: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(payment).where(eq(payment.id, id)).limit(1);
    return row || null;
  }

  async findPaymentByIdempotency(orderId: string, idempotencyKey: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(payment).where(and(eq(payment.wholesaleOrderId, orderId), eq(payment.idempotencyKey, idempotencyKey))).limit(1);
    return row || null;
  }

  // Allocation
  async findAllocationsByPaymentId(paymentId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(paymentAllocation).where(eq(paymentAllocation.paymentId, paymentId));
  }

  async findAllocationsByProformaId(proformaId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(paymentAllocation).where(eq(paymentAllocation.proformaId, proformaId));
  }

  async findAllocationsByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    // Join via payment
    const result = await db.execute(sql`
      SELECT pa.* FROM payment_allocation pa
      JOIN payment p ON p.id = pa.payment_id
      WHERE p.wholesale_order_id = ${orderId}
    `);
    return result.rows || [];
  }

  // Financial release
  async findReleasesByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(orderFinancialRelease).where(eq(orderFinancialRelease.orderId, orderId)).orderBy(orderFinancialRelease.createdAt);
  }

  // Ledger
  async findLedgerByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(financialLedgerEntry).where(eq(financialLedgerEntry.orderId, orderId)).orderBy(financialLedgerEntry.createdAt);
  }

  async findLedgerByPaymentId(paymentId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(financialLedgerEntry).where(eq(financialLedgerEntry.paymentId, paymentId));
  }

  // Refund
  async findRefundsByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(refund).where(eq(refund.wholesaleOrderId, orderId)).orderBy(desc(refund.createdAt));
  }

  async findRefundById(id: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(refund).where(eq(refund.id, id)).limit(1);
    return row || null;
  }

  async findRefundByIdempotency(orderId: string, idempotencyKey: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    const [row] = await db.select().from(refund).where(and(eq(refund.wholesaleOrderId, orderId), eq(refund.idempotencyKey, idempotencyKey))).limit(1);
    return row || null;
  }

  async findRefundsByChildId(childOrderId: string, executor?: DbOrTx) {
    const db = (executor ?? this.db) as any;
    return db.select().from(refund).where(eq(refund.childOrderId, childOrderId));
  }
}
