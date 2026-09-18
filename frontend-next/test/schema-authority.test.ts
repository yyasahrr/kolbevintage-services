import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseNotMigratedError, assertDatabaseReady, resolveMigrationsDir } from "../../packages/database/src/verify";
import { publicError } from "../server/kolbe-api";
import { rows } from "../server/database";

/**
 * آزمون «مرجع واحد اسکیما» در لایهٔ گذار Next.js (گام ۱.۲).
 *
 * چه چیزی را اثبات می‌کند؟
 *   ۱) route handler قدیمی روی دیتابیس **مهاجرت‌شده** بالا می‌آید (مسیر عادی).
 *   ۲) روی دیتابیس مهاجرت‌نشده، بالا نمی‌آید و **ترمیم خودکار** نمی‌کند
 *      (fail closed، بدون هیچ CREATE TABLE).
 *   ۳) خطای نگهبان به HTTP **درز نمی‌کند**: پاسخ ۵۰۳ با پیام عمومی است و
 *      هیچ نام جدول/ستون/SQLSTATE در آن نیست (ادامهٔ اصلاح D26).
 *   ۴) کد زمان اجرای این اپ هیچ DDL نمی‌سازد (اسکن ایستا).
 */

const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const SCRATCH_DB = "kolbe_next_guard_test";
const SCRATCH_URL = `postgres://postgres:postgres@127.0.0.1:55432/${SCRATCH_DB}`;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(root: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

async function adminQuery(sql: string): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

describe("مرجع واحد اسکیما در لایهٔ Next.js (گام ۱.۲)", () => {
  beforeAll(async () => {
    await adminQuery(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
    await adminQuery(`CREATE DATABASE "${SCRATCH_DB}"`);
  }, 120_000);

  afterAll(async () => {
    await adminQuery(`DROP DATABASE IF EXISTS "${SCRATCH_DB}" WITH (FORCE)`);
  });

  it("روی دیتابیس مهاجرت‌شده، اپ عادی بالا می‌آید (پنج مهاجرت اعمال شده)", async () => {
    await expect(rows("SELECT 1")).resolves.toBeDefined();
    const ledger = await rows<{ count: string }>("SELECT count(*) AS count FROM drizzle.__drizzle_migrations");
    expect(Number(ledger[0].count)).toBeGreaterThanOrEqual(5);
  });

  it("مسیر مهاجرت‌ها از دید اپ Next.js همان پوشهٔ مرجع است", () => {
    const resolved = resolveMigrationsDir([path.join(REPO_ROOT, "frontend-next")]);
    expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(path.join(REPO_ROOT, "packages", "database", "migrations")));
  });

  it("روی دیتابیس مهاجرت‌نشده می‌بندد و هیچ جدولی نمی‌سازد", async () => {
    const client = new Client({ connectionString: SCRATCH_URL });
    await client.connect();
    try {
      const before = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public'",
      );

      let failure: unknown = null;
      try {
        await assertDatabaseReady(client);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(DatabaseNotMigratedError);
      const error = failure as DatabaseNotMigratedError;
      expect(error.code).toBe("MIGRATIONS_NOT_APPLIED");
      expect(error.message).toBe(
        "Database migrations are required. Run the documented migration command (npm run db:migrate).",
      );

      const after = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public'",
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
      expect(Number(after.rows[0].count)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("خطای نگهبان به HTTP درز نمی‌کند: ۵۰۳ با پیام عمومی، بدون نام جدول/ستون", () => {
    const error = new DatabaseNotMigratedError("SCHEMA_SHAPE_MISMATCH", [
      "missing columns on retail_order: price_book_version",
      "migration not applied: 0002_oval_puff_adder",
    ]);

    const mapped = publicError(error);
    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe("SERVICE_UNAVAILABLE");
    expect(mapped.message).not.toContain("retail_order");
    expect(mapped.message).not.toContain("price_book_version");
    expect(mapped.message).not.toContain("0002");
    expect(mapped.message).not.toContain("drizzle");
    // کد SQLSTATE هم هیچ‌وقت به بیرون نمی‌رود (اصلاح D26).
    expect(mapped.code).not.toMatch(/^[0-9A-Z]{5}$/);
  });

  it("کد زمان اجرای Next.js هیچ DDL نمی‌سازد (اسکن ایستا)", () => {
    const ddl = /\b(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|CREATE\s+OR\s+REPLACE\s+FUNCTION|DROP\s+TABLE)\b/i;
    const offenders: string[] = [];
    for (const root of ["server", "app", "storefront", "supplier-src"]) {
      for (const file of walk(path.join(REPO_ROOT, "frontend-next", root), [".ts", ".tsx", ".mjs", ".js"])) {
        const source = stripComments(fs.readFileSync(file, "utf8"));
        const match = source.match(ddl);
        if (match) offenders.push(`${path.relative(REPO_ROOT, file)} → ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
