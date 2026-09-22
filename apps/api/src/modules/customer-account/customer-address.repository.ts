import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { customerAddress } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";

/**
 * Phase 5.9-A — saved-address persistence. Thin Drizzle wrapper; every
 * method threads the caller's executor so default switches read and write
 * in one transaction. No business rules here (service owns them).
 */
@Injectable()
export class CustomerAddressRepository {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  /** Serializes one customer's default switches and creates (xact-scoped). */
  async advisoryLock(userId: string, executor?: any): Promise<void> {
    const ex = (executor as any) ?? this.db;
    await ex.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer-address:${userId}`}))`);
  }

  async findById(id: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [row] = await ex.select().from(customerAddress).where(eq(customerAddress.id, id)).limit(1);
    return row ?? null;
  }

  async listByUserId(userId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    return ex
      .select()
      .from(customerAddress)
      .where(and(eq(customerAddress.userId, userId), isNull(customerAddress.archivedAt)))
      .orderBy(desc(customerAddress.isDefault), desc(customerAddress.createdAt));
  }

  async countByUserId(userId: string, executor?: any): Promise<number> {
    const ex = (executor as any) ?? this.db;
    const rows = await ex
      .select({ id: customerAddress.id })
      .from(customerAddress)
      .where(and(eq(customerAddress.userId, userId), isNull(customerAddress.archivedAt)));
    return rows.length;
  }

  async insert(row: typeof customerAddress.$inferInsert, executor?: any) {
    const ex = (executor as any) ?? this.db;
    const [created] = await ex.insert(customerAddress).values(row).returning();
    return created;
  }

  async clearDefaults(userId: string, executor?: any) {
    const ex = (executor as any) ?? this.db;
    await ex
      .update(customerAddress)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(customerAddress.userId, userId), isNull(customerAddress.archivedAt)));
  }

  async updateVersioned(
    id: string,
    expectedVersion: number,
    patch: Partial<typeof customerAddress.$inferInsert>,
    executor?: any,
  ) {
    const ex = (executor as any) ?? this.db;
    const [updated] = await ex
      .update(customerAddress)
      .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(customerAddress.id, id), eq(customerAddress.version, expectedVersion)))
      .returning();
    return updated ?? null;
  }
}
