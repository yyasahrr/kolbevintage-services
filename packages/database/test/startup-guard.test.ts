import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DatabaseNotMigratedError,
  MigrationsArtifactMissingError,
  assertDatabaseReady,
} from "../src/verify";
import {
  dropDatabase,
  ensurePostgres,
  guardOutcome,
  migrateOrFail,
  recreateDatabase,
  withClient,
} from "./helpers";

/**
 * آزمون نگهبان سازگاری اسکیمای زمان راه‌اندازی (الزام #۲ گام ۱.۲).
 *
 * قاعده: کد زمان اجرا اسکیما نمی‌سازد، فقط **بررسی** می‌کند و در صورت ناسازگاری
 * **می‌بندد** (fail closed). این آزمون هر سه حالت را روی دیتابیس واقعی می‌سنجد:
 *   • نسخهٔ درست  → ادامه بده
 *   • مهاجرت‌نشده  → ببند، با پیام عملیاتی روشن
 *   • ناقص        → ببند (نه ترمیم خودکار، نه ادامهٔ کار)
 * و یک چیز دیگر را هم ثابت می‌کند: نگهبان هیچ چیزی نمی‌نویسد.
 */

const OK_DB = "kolbe_phase12_guard_ok_test";
const EMPTY_DB = "kolbe_phase12_guard_empty_test";
const PARTIAL_DB = "kolbe_phase12_guard_partial_test";
const BROKEN_DB = "kolbe_phase12_guard_broken_test";

describe("نگهبان سازگاری اسکیما (گام ۱.۲)", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(OK_DB);
    migrateOrFail(OK_DB);

    await recreateDatabase(EMPTY_DB); // هیچ مهاجرتی اعمال نمی‌شود

    await recreateDatabase(PARTIAL_DB);
    migrateOrFail(PARTIAL_DB);

    await recreateDatabase(BROKEN_DB);
    migrateOrFail(BROKEN_DB);
  }, 300_000);

  afterAll(async () => {
    for (const database of [OK_DB, EMPTY_DB, PARTIAL_DB, BROKEN_DB]) await dropDatabase(database);
  });

  it("دیتابیس مهاجرت‌شده: نگهبان تأیید می‌کند و ادامه می‌دهد", async () => {
    const outcome = await guardOutcome(OK_DB);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.applied).toBe(outcome.result.expected);
      expect(outcome.result.tables).toBeGreaterThanOrEqual(22);
    }
  });

  it("دیتابیس بدون مهاجرت: با پیام عملیاتی می‌بندد و هیچ جدولی نمی‌سازد", async () => {
    const before = await withClient(EMPTY_DB, (client) =>
      client.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public'",
      ),
    );

    const outcome = await guardOutcome(EMPTY_DB);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(DatabaseNotMigratedError);
      expect(outcome.error.code).toBe("MIGRATIONS_NOT_APPLIED");
      expect(outcome.error.message).toBe(
        "Database migrations are required. Run the documented migration command (npm run db:migrate).",
      );
      // پیام خطا عملیاتی است و به دفتر مهاجرت اشاره می‌کند، نه به جزئیات داخلی اسکیما.
      expect(outcome.error.details?.join(" ")).toContain("drizzle.__drizzle_migrations");
    }

    // نگهبان «ترمیم خودکار» نمی‌کند: هیچ جدولی ساخته نشده است.
    const after = await withClient(EMPTY_DB, (client) =>
      client.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public'",
      ),
    );
    expect(Number(after.rows[0].count)).toBe(Number(before.rows[0].count));
    expect(Number(after.rows[0].count)).toBe(0);
  });

  it("دیتابیس ناقص (مهاجرت آخر اعمال نشده): می‌بندد", async () => {
    // شبیه‌سازی «نیمه‌مهاجرت‌شده»: ردیف آخرین مهاجرت از دفتر حذف می‌شود بدون
    // اینکه قیدهایش برداشته شوند — دقیقاً وضعیتی که نباید سرویس را بالا بیاورد.
    await withClient(PARTIAL_DB, (client) =>
      client.query(
        "DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)",
      ),
    );

    const outcome = await guardOutcome(PARTIAL_DB);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("MIGRATIONS_NOT_APPLIED");
      // باید حداقل یک مهاجرت اعمال‌نشده گزارش شود — نام دقیق با افزودن مهاجرت‌های جدید تغییر می‌کند
      expect(outcome.error.details?.join(" ")).toContain("migration not applied:");
    }
  });

  it("ستون گم‌شده (اسکیمای دست‌کاری‌شده): می‌بندد و ستون را نام می‌برد", async () => {
    await withClient(BROKEN_DB, (client) => client.query("ALTER TABLE retail_order DROP COLUMN price_book_version"));

    const outcome = await guardOutcome(BROKEN_DB);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("SCHEMA_SHAPE_MISMATCH");
      expect(outcome.error.details?.join(" ")).toContain("retail_order");
      expect(outcome.error.details?.join(" ")).toContain("price_book_version");
      // پیام عمومی هیچ جزئیات دیتابیس ندارد (اصلاح D26).
      expect(outcome.error.message).not.toContain("price_book_version");
      expect(outcome.error.message).not.toContain("retail_order");
    }
  });

  it("نبود مصنوعات مهاجرت، خطای استقرار می‌دهد (نه خطای دیتابیس)", async () => {
    await expect(
      withClient(OK_DB, (client) => assertDatabaseReady(client, { migrationsDir: "/tmp/kolbe-missing-migrations" })),
    ).rejects.toBeInstanceOf(MigrationsArtifactMissingError);
  });

  it("نگهبان هیچ DDL و هیچ نوشتنی در دیتابیس انجام نمی‌دهد", async () => {
    await withClient(EMPTY_DB, async (client) => {
      const before = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
      );
      await expect(assertDatabaseReady(client)).rejects.toBeInstanceOf(DatabaseNotMigratedError);
      const after = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'",
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });
  });
});
