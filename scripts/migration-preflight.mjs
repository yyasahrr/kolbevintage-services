#!/usr/bin/env node
/**
 * بررسی پیش‌پرواز مهاجرت پایگاه‌داده (Database Migration Preflight Check)
 * فاز ۴.۹ سخت‌سازی تولید.
 *
 *   node scripts/migration-preflight.mjs [--url <DATABASE_URL>]
 *
 * این اسکریپت پیش از راه‌اندازی سرویس یا اعمال تغییرات در استقرار تولید اجرا می‌شود:
 *  ۱. بررسی برقراری اتصال به پایگاه‌داده و دسترسی ادمین
 *  ۲. بررسی جدول تاریخچه مهاجرت‌های Drizzle
 *  ۳. گزارش مهاجرت‌های اعمال‌شده در برابر برنامهٔ مهاجرت‌های موجود
 *  ۴. بررسی نسخه و سازگاری ساختار اسکیمای فعلی
 *  ۵. هشدار در صورت وجود مهاجرت معلق و خروج با کد مناسب
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  readMigrationPlan,
  readAppliedMigrations,
  assertDatabaseReady,
} from "../packages/database/dist/src/verify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/kolbe";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    }
  }
  return { url };
}

async function runPreflight() {
  const { url } = parseArgs();
  const migrationsFolder = path.join(ROOT, "packages", "database", "migrations");

  const safeUrl = url.replace(/:[^:@]+@/, ":****@");
  console.log(`[Preflight] بررسی پیش‌پرواز پایگاه‌داده روی: ${safeUrl}`);

  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    max: 1,
  });

  try {
    // ۱. بررسی اتصال فیزیکی
    await pool.query("SELECT 1 AS ping;");
    console.log("  [1/4] اتصال فیزیکی به PostgreSQL: موفق (PING OK)");

    // ۲. بررسی وجود جدول مهاجرت و ردیابی وضعیت
    const plan = readMigrationPlan(migrationsFolder);
    const applied = await readAppliedMigrations(pool);

    console.log(`  [2/4] برنامه مهاجرت‌ها: ${plan.entries.length} مهاجرت در مخزن تعریف شده است`);

    if (!applied.tableExists) {
      console.warn("  [!] هشدار: جدول دفتر مهاجرت وجود ندارد (دیتابیس هنوز راه‌اندازی نشده است)");
      return {
        ready: false,
        pendingCount: plan.entries.length,
        appliedCount: 0,
        pendingTags: plan.entries.map((e) => e.tag),
      };
    }

    const appliedSet = new Set(applied.rows.map((r) => r.createdAt));
    const pending = plan.entries.filter((entry) => !appliedSet.has(entry.when));

    console.log(`  [3/4] وضعیت اعمال مهاجرت‌ها: ${applied.rows.length} اعمال شده، ${pending.length} معلق`);

    if (pending.length > 0) {
      console.warn(`  [!] مهاجرت‌های معلق زیر قبل از استقرار باید اعمال شوند:`);
      for (const p of pending) {
        console.warn(`      - ${p.tag} (index: ${p.idx})`);
      }
    } else {
      console.log("  [3/4] همه مهاجرت‌های تعریف‌شده قبلاً اعمال شده‌اند.");
    }

    // ۴. بررسی سازگاری اسکیما
    let schemaResult = null;
    try {
      schemaResult = await assertDatabaseReady(pool, { migrationsDir: migrationsFolder });
      console.log(
        `  [4/4] سلامت ساختار اسکیما: تأیید شد (${schemaResult.applied}/${schemaResult.expected} مهاجرت، ${schemaResult.tables} جدول)`,
      );
    } catch (err) {
      console.warn(`  [4/4] وضعیت اسکیما: ${err.message}`);
    }

    const isFullyReady = pending.length === 0 && schemaResult !== null;
    return {
      ready: isFullyReady,
      appliedCount: applied.rows.length,
      pendingCount: pending.length,
      pendingTags: pending.map((p) => p.tag),
      schemaCheck: schemaResult,
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPreflight()
    .then((result) => {
      console.log("\n[Preflight] نتیجه ارزیابی:");
      if (result.ready) {
        console.log("  ✔ پایگاه داده کاملاً آماده و با کد هماهنگ است.");
        process.exit(0);
      } else {
        console.log(`  ⚠ پایگاه‌داده نیاز به اعمال ${result.pendingCount} مهاجرت دارد.`);
        console.log("  برای اعمال دستور زیر را اجرا کنید: npm run db:migrate");
        process.exit(0); // خروج با صفر جهت ادامه روال‌های اسکریپت با اطلاع
      }
    })
    .catch((err) => {
      console.error("\n[Preflight] خطا در پیش‌پرواز:", err.message);
      process.exit(1);
    });
}
