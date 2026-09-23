import { Inject, Injectable } from "@nestjs/common";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { retailReturnEvent, retailReturnItem, retailReturnRequest } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";

/** Statuses that free the ordered quantity for re-request (terminal rejects). */
export const RETURN_CLOSED_STATUSES = ["REJECTED", "WITHDRAWN"] as const;

/**
 * Phase 5.9-B — return persistence. Thin Drizzle wrapper; every method
 * threads the caller's executor so filing reads delivered/active math and
 * writes in one transaction. No business rules here (service owns them).
 */
@Injectable()
export class RetailReturnsRepository {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  async insertRequest(row: typeof retailReturnRequest.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(retailReturnRequest).values(row).returning();
    return created;
  }

  async insertItems(rows: Array<typeof retailReturnItem.$inferInsert>, executor?: any) {
    const ex = (executor as any) ?? this.db;
    if (rows.length === 0) return [];
    return ex.insert(retailReturnItem).values(rows).returning();
  }

  async insertEvent(row: typeof retailReturnEvent.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(retailReturnEvent).values(row).returning();
    return created;
  }

  async findRequestById(id: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailReturnRequest).where(eq(retailReturnRequest.id, id)).limit(1);
    return row ?? null;
  }

  async findRequestByIdForUpdate(id: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(retailReturnRequest).where(eq(retailReturnRequest.id, id)).for("update").limit(1);
    return row ?? null;
  }

  async findByCustomerOrderIdempotencyKey(customerId: string, orderId: string, idempotencyKey: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex
      .select()
      .from(retailReturnRequest)
      .where(
        and(
          eq(retailReturnRequest.customerId, customerId),
          eq(retailReturnRequest.orderId, orderId),
          eq(retailReturnRequest.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findItemsByReturnId(returnId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex.select().from(retailReturnItem).where(eq(retailReturnItem.returnId, returnId));
  }

  async findItemsByReturnIds(returnIds: string[], executor?: any) {
    const ex = (executor as any) ?? this.db;
    if (returnIds.length === 0) return [];
    const rows: any[] = [];
    for (const returnId of returnIds) {
      rows.push(...(await ex.select().from(retailReturnItem).where(eq(retailReturnItem.returnId, returnId))));
    }
    return rows;
  }

  async findEventsByReturnId(returnId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex
      .select()
      .from(retailReturnEvent)
      .where(eq(retailReturnEvent.returnId, returnId))
      .orderBy(sql`${retailReturnEvent.returnVersion} ASC`);
  }

  /** Requests whose quantities still encumber the order (all non-closed). */
  async findActiveByOrderId(orderId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex
      .select()
      .from(retailReturnRequest)
      .where(
        and(eq(retailReturnRequest.orderId, orderId), notInArray(retailReturnRequest.status, [...RETURN_CLOSED_STATUSES])),
      );
  }

  async updateRequestVersioned(
    id: string,
    expectedVersion: number,
    patch: Partial<typeof retailReturnRequest.$inferInsert>,
    executor?: any,
  ) {
    const ex = (executor as any) ?? this.db;
    const [updated] = await ex
      .update(retailReturnRequest)
      .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(retailReturnRequest.id, id), eq(retailReturnRequest.version, expectedVersion)))
      .returning();
    return updated ?? null;
  }

  /**
   * Customer return list page. Keyset on (created_at DESC, id DESC),
   * mirroring the order-history seam. Returns at most `limit + 1` rows.
   */
  async listByCustomerId(customerId: string, limit: number, cursor: [string, string] | null, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const conditions = [eq(retailReturnRequest.customerId, customerId)];
    if (cursor) {
      conditions.push(sql`(${retailReturnRequest.createdAt}, ${retailReturnRequest.id}) < (${cursor[0]}::timestamptz, ${cursor[1]})`);
    }
    return ex
      .select()
      .from(retailReturnRequest)
      .where(sql.join(conditions, sql` AND `))
      .orderBy(sql`${retailReturnRequest.createdAt} DESC, ${retailReturnRequest.id} DESC`)
      .limit(limit + 1);
  }

  /** Phase 5.11-C — staff return queue: exact status + (created_at, id) keyset. */
  async listForStaff(status: string | undefined, limit: number, cursor: [string, string] | null, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const conditions = [];
    if (status) conditions.push(eq(retailReturnRequest.status, status));
    if (cursor) {
      conditions.push(sql`(${retailReturnRequest.createdAt}, ${retailReturnRequest.id}) < (${cursor[0]}::timestamptz, ${cursor[1]})`);
    }
    return ex
      .select()
      .from(retailReturnRequest)
      .where(conditions.length ? sql.join(conditions, sql` AND `) : undefined)
      .orderBy(sql`${retailReturnRequest.createdAt} DESC, ${retailReturnRequest.id} DESC`)
      .limit(limit + 1);
  }
}
