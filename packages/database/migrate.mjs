#!/usr/bin/env node
/**
 * اجرای مهاجرت‌های Drizzle — تنها راه تغییر اسکیما.
 *
 *   npm run db:migrate                          → اجرای مهاجرت‌های اعمال‌نشده + بررسی نتیجه
 *   npm run db:migrate -- --status              → فقط نمایش وضعیت (بدون اعمال)
 *   npm run db:migrate -- --adopt-legacy        → پذیرش یک دیتابیس ساخته‌شده با DDL قدیمی (یک‌بار)
 *   npm run db:migrate -- --verify-only         → فقط بررسی سازگاری (برای healthcheck/CI)
 *
 * ورودی‌ها:
 *   DATABASE_URL   رشتهٔ اتصال (پیش‌فرض: postgres://postgres:postgres@127.0.0.1:55432/kolbe)
 *
 * قاعدهٔ عملیاتی: مهاجرت‌ها **فقط رو به جلو** هستند. هیچ down-migration وجود
 * ندارد؛ بازگشت هر فاز با برگرداندن مسیر Nginx انجام می‌شود، نه با حذف داده.
 * پس هر مهاجرت باید افزودنی و سازگار با نسخهٔ قبلی کد باشد.
 *
 * ── `--adopt-legacy` برای چیست؟ ──────────────────────────────────────────────
 * تا پیش از گام ۱.۲، خودِ اپلیکیشن Next.js اسکیما را در زمان اجرا می‌ساخت. چنین
 * دیتابیسی جدول‌ها را دارد ولی **دفتر مهاجرت ندارد**؛ پس اجرای مهاجرت پایه روی آن
 * با «جدول از قبل وجود دارد» شکست می‌خورد.
 *
 * `--adopt-legacy` این یک بار را پوشش می‌دهد:
 *   ۱) شکل فعلی دیتابیس را با «شکل پایه» (`meta/0000_snapshot.json`) می‌سنجد؛
 *      اگر جدول/ستونی کم باشد، **هیچ‌چیز ثبت نمی‌شود** و دستور با پیام روشن می‌شکند.
 *   ۲) مهاجرت‌های پایه (۰۰۰۰ و ۰۰۰۱) را «اعمال‌شده» علامت می‌زند (بدون اجرای DDL).
 *   ۳) بقیهٔ مهاجرت‌ها را به‌صورت عادی اجرا می‌کند.
 *
 * بدون این گام، ارتقای دیتابیس مرحلهٔ ۱.۵ به ۱.۲ ممکن نیست.
 *
 * ── محدودیت بازیابی (صادقانه) ───────────────────────────────────────────────
 *  - اگر دیتابیس قدیمی‌تر از اسکیمای پایه باشد (ستون‌های گام ۰ را نداشته باشد)،
 *    پذیرش انجام نمی‌شود. راه‌حل: یک بار اپلیکیشن نسخهٔ ۱.۵ را بالا بیاورید تا
 *    ALTERهای idempotent خودش را اجرا کند، سپس مهاجرت را اجرا کنید.
 *  - مهاجرت‌ها تراکنشی‌اند: شکست یعنی هیچ تغییر جزئی باقی نمی‌ماند.
 *  - بازگشت (rollback) خودکار وجود ندارد. بازگشت به عقب = بازیابی از پشتیبان
 *    + برگرداندن نسخهٔ کد. پیش از اجرا روی تولید، پشتیبان بگیرید.
 *  - `--adopt-legacy` فقط نشانه‌گذاری و بررسی می‌کند؛ هیچ DDL ترمیمی اجرا نمی‌کند.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
/**
 * ماژول نگهبان/بررسی از خروجی **کامپایل‌شده** بارگذاری می‌شود.
 *
 * چرا dist؟ این اسکریپت `.mjs` است و با `node` خالی اجرا می‌شود؛ Node 22.6 هنوز
 * نمی‌تواند مستقیم `.ts` را import کند (strip-types از 22.18 پیش‌فرض شده است).
 * پس منبع از `dist/src/verify.js` خوانده می‌شود (که `npm run build:packages` یا
 * اسکریپت‌های ریشه می‌سازند)؛ اگر نبود، منبع TS امتحان می‌شود و در نهایت با پیام
 * روشن متوقف می‌شویم — نه با خطای مبهم.
 */
async function loadVerifyModule() {
  const compiled = path.resolve(import.meta.dirname, "dist", "src", "verify.js");
  if (fs.existsSync(compiled)) return await import(pathToFileURL(compiled).href);
  const source = path.resolve(import.meta.dirname, "src", "verify.ts");
  try {
    return await import(pathToFileURL(source).href);
  } catch (error) {
    console.error(
      "drizzle: ماژول بررسی بارگذاری نشد. راه‌حل: `npm run build:packages` را اجرا کنید.",
    );
    console.error(`drizzle: جزئیات → ${error?.message ?? error}`);
    process.exit(2);
  }
}

const V = await loadVerifyModule();

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe";
const migrationsFolder = path.resolve(import.meta.dirname, "migrations");

const args = process.argv.slice(2);
const statusOnly = args.includes("--status");
const adoptLegacy = args.includes("--adopt-legacy");
const verifyOnly = args.includes("--verify-only");

const pool = new Pool({ connectionString, max: 1 });
const db = drizzle(pool);

/** مقایسهٔ ستون‌های واقعی با یک snapshot مشخص (برای پذیرش دیتابیس قدیمی). */
function columnProblems(expected, actual) {
  const problems = [];
  for (const table of expected.tables) {
    const columns = actual.get(table.name);
    if (!columns) {
      problems.push(`missing table: ${table.name}`);
      continue;
    }
    const missing = table.columns.filter((column) => !columns.has(column.name)).map((column) => column.name);
    if (missing.length > 0) problems.push(`missing columns on ${table.name}: ${missing.join(", ")}`);
  }
  return problems;
}

/** اگر ماژول بررسی در دسترس نباشد، دستورهایی که به آن نیاز دارند با پیام روشن تمام می‌شوند. */
function requireVerifyModule(command) {
  if (V) return;
  console.error(`drizzle: دستور ${command} به ماژول بررسی نیاز دارد ولی بارگذاری نشد.`);
  console.error("drizzle: راه‌حل: npm run build:packages");
  process.exit(2);
}

async function status() {
  requireVerifyModule("--status");
  const plan = V.readMigrationPlan(migrationsFolder);
  const applied = await V.readAppliedMigrations(pool);
  if (!applied.tableExists) {
    console.log("drizzle: هیچ مهاجرتی اعمال نشده است (دفتر مهاجرت وجود ندارد)");
    console.log("drizzle: اگر دیتابیس با DDL قدیمی زمان‌اجرا ساخته شده، یک بار `npm run db:migrate -- --adopt-legacy` را اجرا کنید.");
    return false;
  }
  const appliedAt = new Set(applied.rows.map((row) => row.createdAt));
  let complete = true;
  for (const entry of plan.entries) {
    const isApplied = appliedAt.has(entry.when);
    if (!isApplied) complete = false;
    console.log(`drizzle: ${isApplied ? "✓" : "✗"} ${entry.tag}`);
  }
  console.log(
    complete
      ? `drizzle: همهٔ ${plan.entries.length} مهاجرت اعمال شده است`
      : "drizzle: مهاجرت اعمال‌نشده وجود دارد → `npm run db:migrate`",
  );
  return complete;
}

/**
 * یک دیتابیس ساخته‌شده با DDL قدیمی (مرحلهٔ ۱.۵) را می‌پذیرد: شکلش را با
 * snapshot پایه می‌سنجد و سپس ۰۰۰۰/۰۰۰۱ را «اعمال‌شده» علامت می‌زند.
 */
async function adopt() {
  requireVerifyModule("--adopt-legacy");
  const plan = V.readMigrationPlan(migrationsFolder);
  const applied = await V.readAppliedMigrations(pool);
  if (applied.tableExists && applied.rows.length > 0) {
    console.log("drizzle: دفتر مهاجرت از قبل وجود دارد؛ پذیرش لازم نیست.");
    return true;
  }

  const actualColumns = await V.readActualColumns(pool);
  const baseline = V.readExpectedShape(plan, plan.entries[0]);
  const problems = columnProblems(baseline, actualColumns);
  if (problems.length > 0) {
    console.error("drizzle: پذیرش دیتابیس قدیمی انجام نشد — شکل آن با اسکیمای پایه نمی‌خواند:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "drizzle: راه‌حل: یک بار اپلیکیشن نسخهٔ ۱.۵ را بالا بیاورید تا ALTERهای idempotent خود را اجرا کند، سپس دوباره تلاش کنید.",
    );
    process.exitCode = 2;
    return false;
  }

  const { rows } = await pool.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS present");
  if (!rows[0]?.present) {
    await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await pool.query(
      "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)",
    );
  }
  // فقط مهاجرت‌هایی که شکل پایه را ساخته‌اند علامت می‌خورند: ۰۰۰۰ (اسکیمای پایه)
  // و ۰۰۰۱ (تریگر فقط-افزودنی audit_log) — هر دو روی دیتابیس قدیمی موجودند.
  for (const entry of plan.entries.filter((item) => item.idx <= 1)) {
    await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [
      `legacy-adopted:${entry.tag}`,
      entry.when,
    ]);
    console.log(`drizzle: مهاجرت پایه به‌عنوان اعمال‌شده علامت خورد → ${entry.tag}`);
  }
  console.log("drizzle: پذیرش دیتابیس قدیمی کامل شد؛ ادامهٔ مهاجرت‌ها در گام بعد اجرا می‌شود.");
  return true;
}

async function verify() {
  if (!V) return null;
  const result = await V.assertDatabaseReady(pool, { migrationsDir: migrationsFolder });
  const plan = V.readMigrationPlan(migrationsFolder);
  const expected = V.readExpectedShape(plan);
  const actual = await V.readActualConstraints(pool);
  const shapeProblems = V.compareShape(expected, actual);
  if (shapeProblems.length > 0) {
    console.error("drizzle: بررسی پس از مهاجرت، ناسازگاری قیدها را نشان داد:");
    for (const problem of shapeProblems) console.error(`  - ${problem}`);
    process.exitCode = 3;
    return false;
  }
  console.log(
    `drizzle: بررسی سازگاری موفق — ${result.applied} مهاجرت، ${result.tables} جدول، ` +
      `${actual.foreignKeys.length} کلید خارجی، ${actual.checks.length} قید CHECK`,
  );
  return true;
}

try {
  if (statusOnly) {
    await status();
  } else if (verifyOnly) {
    await verify();
  } else if (adoptLegacy) {
    const adopted = await adopt();
    if (adopted) {
      await migrate(db, { migrationsFolder });
      await verify();
    }
  } else {
    await migrate(db, { migrationsFolder });
    console.log("drizzle: مهاجرت‌ها با موفقیت اعمال شدند");
    const ready = await verify();
    if (ready === false) {
      console.error(`drizzle: ${V.MIGRATIONS_REQUIRED_MESSAGE}`);
    }
  }
} catch (error) {
  console.error("drizzle: اجرای مهاجرت شکست خورد →", error?.message ?? error);
  /**
   * Drizzle خطای درایور را در `cause` نگه می‌دارد و متن خودش فقط «Failed query: …»
   * است. برای عیب‌یابی، پیام واقعی PostgreSQL (مثلاً فهرست مشکلات پیش‌بَررسی) و
   * جزئیات آن را هم چاپ می‌کنیم.
   */
  const cause = error?.cause;
  if (cause?.message) console.error(`drizzle: پیام دیتابیس → ${cause.message}`);
  if (cause?.detail) console.error(`drizzle: جزئیات → ${cause.detail}`);
  if (cause?.where) console.error(`drizzle: محل → ${cause.where}`);
  if (error?.details) for (const detail of error.details) console.error(`  - ${detail}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
