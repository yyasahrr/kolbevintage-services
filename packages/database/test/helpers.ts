/**
 * ابزار مشترک آزمون‌های گام ۱.۲.
 *
 * این آزمون‌ها روی PostgreSQL امبدد (خارج از git، در `/home/user/pg`) و روی
 * دیتابیس‌های **مجزا** اجرا می‌شوند: هیچ‌کدام به دیتابیس توسعه (`kolbe`) دست
 * نمی‌زنند. هر سناریو دیتابیس خودش را می‌سازد و در پایان پاک می‌کند تا نتیجه‌ها
 * قطعی (deterministic) و قابل اجرای مکرر باشند.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

export const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "..", "migrations");
export const MIGRATE_SCRIPT = path.resolve(import.meta.dirname, "..", "migrate.mjs");

export function urlFor(database: string): string {
  return `postgres://postgres:postgres@127.0.0.1:55432/${database}`;
}

/** PostgreSQL امبدد را (در صورت خاموش بودن) بالا می‌آورد. */
export function ensurePostgres(): void {
  execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts", "pg.mjs"), "ensure"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
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

/** دیتابیس آزمون را از صفر می‌سازد (اگر وجود داشته باشد حذف می‌کند). */
export async function recreateDatabase(database: string): Promise<void> {
  await adminQuery(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await adminQuery(`CREATE DATABASE "${database}"`);
}

export async function dropDatabase(database: string): Promise<void> {
  await adminQuery(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
}

export type MigrateResult = { code: number; stdout: string; stderr: string };

/**
 * اجرای اسکریپت مهاجرت روی یک دیتابیس مشخص.
 *
 * از `spawnSync` استفاده می‌شود (نه `execFileSync`) تا آزمون بتواند سناریوهای
 * شکست را هم بسنجد و stdout/stderr را بخواند.
 */
export function runMigrate(database: string, args: string[] = []): MigrateResult {
  const result = spawnSync(process.execPath, [MIGRATE_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: urlFor(database), KOLBE_MIGRATIONS_DIR: MIGRATIONS_DIR },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** اجرای مهاجرت با انتظار موفقیت (خطای واضح در صورت شکست). */
export function migrateOrFail(database: string, args: string[] = []): MigrateResult {
  const result = runMigrate(database, args);
  if (result.code !== 0) {
    throw new Error(`مهاجرت روی ${database} شکست خورد (کد ${result.code}):\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

/** اجرای یک تابع با یک اتصال زنده به دیتابیس. */
export async function withClient<T>(database: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** آیا این دیتابیس آمادهٔ نگهبان است یا خطا می‌دهد؟ (نتیجه: خطا یا null) */
export async function guardOutcome(database: string) {
  const { assertDatabaseReady } = await import("../src/verify");
  return withClient(database, async (client) => {
    try {
      const result = await assertDatabaseReady(client);
      return { ok: true as const, result };
    } catch (error) {
      return { ok: false as const, error: error as Error & { code?: string; details?: string[] } };
    }
  });
}

/**
 * انتظار نقض یک قید دیتابیس داخل یک تراکنش باز.
 *
 * چرا `SAVEPOINT`؟ در PostgreSQL هر خطا داخل تراکنش، آن را تا `ROLLBACK` «مسموم»
 * می‌کند و همهٔ دستورهای بعدی با «current transaction is aborted» شکست می‌خورند.
 * با savepoint، همان تراکنش برای بررسی چند قید پشت‌سرهم زنده می‌ماند.
 */
export async function expectSqlViolation(
  client: Client,
  sql: string,
  code: string,
  values: unknown[] = [],
): Promise<void> {
  await client.query("SAVEPOINT kolbe_expect_violation");
  try {
    await client.query(sql, values);
    throw new Error(`انتظار نقض قید (${code}) داشتیم ولی دستور موفق شد: ${sql}`);
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code) throw error;
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT kolbe_expect_violation");
  }
}

/** پیمایش بازگشتی فایل‌ها با پسوندهای داده‌شده. */
export function walkFiles(root: string, extensions: string[], skip: (file: string) => boolean = () => false): string[] {
  const found: string[] = [];
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (skip(full)) continue;
    if (entry.isDirectory()) found.push(...walkFiles(full, extensions, skip));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

/** حذف کامنت‌ها پیش از اسکن متن (کامنت‌ها مجازند از DDL حرف بزنند). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
