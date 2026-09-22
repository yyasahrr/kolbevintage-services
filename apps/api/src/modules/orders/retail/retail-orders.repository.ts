import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, gte, lte, sql } from "drizzle-orm";
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

  async findByOrderCode(orderCode: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailOrder).where(eq(retailOrder.orderCode, orderCode)).limit(1);
    return row ?? null;
  }

  /**
   * Phase 5.9-A — customer order history page. Keyset on
   * (created_at DESC, id DESC): stable under inserts, no offset drift.
   * `cursor` is [createdAtISO, id]; returns at most `limit + 1` rows so the
   * caller can detect a next page.
   */
  async listByCustomerId(userId: string, limit: number, cursor: [string, string] | null, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const conditions = [eq(retailOrder.customerId, userId)];
    if (cursor) {
      conditions.push(sql`(${retailOrder.createdAt}, ${retailOrder.id}) < (${cursor[0]}::timestamptz, ${cursor[1]})`);
    }
    return ex
      .select()
      .from(retailOrder)
      .where(sql.join(conditions, sql` AND `))
      .orderBy(sql`${retailOrder.createdAt} DESC, ${retailOrder.id} DESC`)
      .limit(limit + 1);
  }

  /**
   * Phase 5.11-A — staff operations list. Filters are fixed, parameterized
   * Drizzle conditions (status / payment state / customer identity / order
   * code / created range); `shipmentStatus` filters on the order's LATEST
   * retail-side shipment status (a real fact, evaluated in a correlated
   * EXISTS — no arbitrary SQL, no offset pagination). Keyset on
   * (created_at DESC, id DESC), same cursor shape as the customer history.
   */
  async listForAdmin(
    filters: {
      status?: string | null;
      paymentStatus?: string | null;
      customerId?: string | null;
      customerPhone?: string | null;
      orderCode?: string | null;
      shipmentStatus?: string | null;
      dateFrom?: Date | null;
      dateTo?: Date | null;
    },
    limit: number,
    cursor: [string, string] | null,
    executor?: any,
  ) {
    const ex = (executor as any) ?? this.db;
    const conditions: any[] = [];
    if (filters.status) conditions.push(eq(retailOrder.orderStatus, filters.status));
    if (filters.paymentStatus) conditions.push(eq(retailOrder.paymentStatus, filters.paymentStatus));
    if (filters.customerId) conditions.push(eq(retailOrder.customerId, filters.customerId));
    if (filters.customerPhone) conditions.push(eq(retailOrder.phone, filters.customerPhone));
    if (filters.orderCode) conditions.push(eq(retailOrder.orderCode, filters.orderCode));
    if (filters.dateFrom) conditions.push(gte(retailOrder.createdAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(retailOrder.createdAt, filters.dateTo));
    if (filters.shipmentStatus) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM "shipment" AS s
          WHERE s."retail_order_id" = ${retailOrder.id}
            AND s."status" = ${filters.shipmentStatus}
            AND s."created_at" = (
              SELECT MAX(s2."created_at") FROM "shipment" AS s2 WHERE s2."retail_order_id" = ${retailOrder.id}
            )
        )`,
      );
    }
    if (cursor) {
      conditions.push(sql`(${retailOrder.createdAt}, ${retailOrder.id}) < (${cursor[0]}::timestamptz, ${cursor[1]})`);
    }
    return ex
      .select()
      .from(retailOrder)
      .where(sql.join(conditions.length ? conditions : [sql`true`], sql` AND `))
      .orderBy(sql`${retailOrder.createdAt} DESC, ${retailOrder.id} DESC`)
      .limit(limit + 1);
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

  /** Phase 5.9-A: revocation is a versioned write (hash cleared, revoked_at kept for audit). */
  async updateGuestCapability(orderId: string, patch: { hash: string | null; revokedAt: Date | null }, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [updated] = await ex
      .update(retailOrder)
      .set({
        guestCapabilityHash: patch.hash,
        guestCapabilityRevokedAt: patch.revokedAt,
        version: sql`${retailOrder.version} + 1`,
        updatedAt: new Date(),
      })
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
