/**
 * @kolbe/database — دسترسی دیتابیس و مهاجرت‌ها.
 *
 * قواعد حاکم:
 *  - A7: «Frontend never connects directly to PostgreSQL» — این پکیج فقط توسط
 *    `apps/api` (و آزمون‌ها) import می‌شود. هیچ کد مرورگری نباید آن را ببیند.
 *  - A10: مبالغ `bigint` هستند. Drizzle با `mode: "bigint"` همیشه bigint می‌دهد؛
 *    هرگز `mode: "number"` برای ستون پولی استفاده نکنید.
 *
 * تصمیم «Drizzle کجا و SQL خام کجا»:
 *  - خواندن‌های معمول، گزارش‌ها و CRUD → Drizzle (تایپ‌ایمنی و یکدستی).
 *  - عملیات حساس مالی/موجودی → SQL خام داخل یک تراکنش با `SELECT … FOR UPDATE`.
 *    Drizzle برای این کار مانع نیست: `db.execute(sql\`…\`)` در همان تراکنش اجرا می‌شود.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type KolbeDatabase = NodePgDatabase<typeof schema>;

export type DatabaseOptions = {
  connectionString: string;
  /** حداکثر اتصال‌های Pool؛ در تست‌ها پایین نگه داشته می‌شود. */
  max?: number;
};

export type KolbeDbHandle = {
  db: KolbeDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export function createDatabase(options: DatabaseOptions): KolbeDbHandle {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * تراکنش با تضمین `COMMIT`/`ROLLBACK`.
 *
 * برای عملیات مالی الگو این است:
 * ```ts
 * await withTransaction(db, async (tx) => {
 *   const [row] = await tx.select().from(wallets).where(eq(wallets.id, id)).for("update");
 *   ...
 * });
 * ```
 */
export async function withTransaction<T>(
  db: KolbeDatabase,
  work: (tx: KolbeDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work(tx as unknown as KolbeDatabase));
}

export { schema };
export * from "./schema";
/**
 * نگهبان/بررسی سازگاری اسکیما.
 *
 * `apps/api` در زمان راه‌اندازی `assertDatabaseReady` را صدا می‌زند تا سرویس روی
 * دیتابیس مهاجرت‌نشده بالا نیاید (fail closed). ابزار مهاجرت
 * (`packages/database/migrate.mjs`) هم از همین توابع استفاده می‌کند.
 */
export * from "./verify";
