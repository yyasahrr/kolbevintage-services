import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { orderEvent, retailOrder, retailOrderEvent, retailOrderItem } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";

/**
 * Phase 5.8 — Retail orders persistence. Thin Drizzle wrapper; every method
 * threads the caller's executor so checkout reads and writes in one
 * transaction. No business rules here (service owns them).
 */
@Injectable()
export class RetailOrdersRepository {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  /** Serializes concurrent creations on one idempotency key (xact-scoped). */
  async advisoryLock(key: string, executor?: any): Promise<void> {
    const ex = (executor as any) ?? this.db;
    await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  }

  async findById(id: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailOrder).where(eq(retailOrder.id, id)).limit(1);
    return row ?? null;
  }

  async findByIdForUpdate(id: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailOrder).where(eq(retailOrder.id, id)).for("update").limit(1);
    return row ?? null;
  }

  async findByIdempotencyKey(key: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailOrder).where(eq(retailOrder.idempotencyKey, key)).limit(1);
    return row ?? null;
  }

  async findItemsByOrderId(orderId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex.select().from(retailOrderItem).where(eq(retailOrderItem.orderId, orderId));
  }

  async findEventsByOrderId(orderId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex
      .select()
      .from(retailOrderEvent)
      .where(eq(retailOrderEvent.orderId, orderId))
      .orderBy(asc(retailOrderEvent.orderVersion));
  }

  async insertOrder(row: typeof retailOrder.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(retailOrder).values(row).returning();
    return created;
  }

  async insertItems(rows: Array<typeof retailOrderItem.$inferInsert>, executor?: any) {
    const ex = (executor as any) ?? this.db;
    if (rows.length === 0) return [];
    return ex.insert(retailOrderItem).values(rows).returning();
  }

  async insertEvent(row: typeof retailOrderEvent.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(retailOrderEvent).values(row).returning();
    return created;
  }

  /** Cross-aggregate creation fact on the shared outbox table (A12). */
  async insertOrderEvent(row: typeof orderEvent.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(orderEvent).values(row).returning();
    return created;
  }

  async updateStatus(orderId: string, toStatus: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [updated] = await ex
      .update(retailOrder)
      .set({ orderStatus: toStatus, version: sql`${retailOrder.version} + 1`, updatedAt: new Date() })
      .where(eq(retailOrder.id, orderId))
      .returning();
    return updated ?? null;
  }

  /** Checkpoint B: paid marking is a versioned write owned by verified-payment orchestration. */
  async markPaid(orderId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [updated] = await ex
      .update(retailOrder)
      .set({ paymentStatus: "paid", version: sql`${retailOrder.version} + 1`, updatedAt: new Date() })
      .where(eq(retailOrder.id, orderId))
      .returning();
    return updated ?? null;
  }
}
