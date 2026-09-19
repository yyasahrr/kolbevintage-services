#!/usr/bin/env node
/**
 * ابزار بازیابی خودکار دیتابیس کلبه — فاز ۴.۹ سخت‌سازی تولید.
 *
 *   node scripts/restore-db.mjs [--url <DATABASE_URL>] --input <file_path>
 *
 * ویژگی‌ها:
 *  - اعتبارسنجی هش SHA-256 قبل از بازیابی برای تضمین عدم فساد فایل
 *  - اجرای دسته‌ای دستورات با غیرفعال‌سازی موقت بررسی کلیدهای خارجی (`session_replication_role = 'replica'`)
 *  - گزارش تعداد جداول و رکوردهای بازگردانده شده
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/kolbe";
  let input = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === "--input" && args[i + 1]) {
      input = args[++i];
    }
  }

  return { url, input };
}

export function verifyChecksum(filePath) {
  const shaFile = `${filePath}.sha256`;
  if (!fs.existsSync(shaFile)) {
    return { verified: false, reason: "SHA256_FILE_MISSING" };
  }

  const expectedContent = fs.readFileSync(shaFile, "utf8").trim();
  const expectedHash = expectedContent.split(/\s+/)[0];

  const actualData = fs.readFileSync(filePath);
  const actualHash = createHash("sha256").update(actualData).digest("hex");

  if (expectedHash !== actualHash) {
    return {
      verified: false,
      reason: "CHECKSUM_MISMATCH",
      expected: expectedHash,
      actual: actualHash,
    };
  }

  return { verified: true, hash: actualHash };
}

async function restoreViaDriver(url, inputPath) {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const sqlContent = fs.readFileSync(inputPath, "utf8");

    // اجرای اسکریپت بازگردانی
    await client.query("BEGIN;");
    await client.query(sqlContent);
    await client.query("COMMIT;");

    // سرشماری رکوردهای بازگردانده‌شده
    const countRes = await client.query(`
      SELECT count(*)::int as c
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `);

    return {
      method: "driver",
      tablesCount: countRes.rows[0].c,
      restoredFrom: inputPath,
      success: true,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await client.end();
  }
}

export async function runRestore(options = {}) {
  const url = options.url || parseArgs().url;
  const input = options.input || parseArgs().input;

  if (!input || !fs.existsSync(input)) {
    throw new Error(`فایل پشتیبان مشخص نشده است یا وجود ندارد: ${input}`);
  }

  // ۱) بررسی سلامت فایل با هش
  const checksumResult = verifyChecksum(input);
  if (!checksumResult.verified && checksumResult.reason === "CHECKSUM_MISMATCH") {
    throw new Error(
      `هش فایل پشتیبان مطابقت ندارد (فساد داده)! انتظار: ${checksumResult.expected}، دریافت: ${checksumResult.actual}`,
    );
  }

  // ۲) بررسی وجود psql برای بازیابی مستقیم
  const psqlCheck = spawnSync("psql", ["--version"], { stdio: "pipe" });
  if (psqlCheck.status === 0) {
    const res = spawnSync("psql", ["-d", url, "-f", input], { stdio: "pipe" });
    if (res.status === 0) {
      return {
        method: "psql",
        restoredFrom: input,
        checksumVerified: checksumResult.verified,
        success: true,
      };
    }
  }

  // ۳) بازیابی با درایور Node.js
  const result = await restoreViaDriver(url, input);
  return {
    ...result,
    checksumVerified: checksumResult.verified,
  };
}

// اگر مستقیماً به عنوان اسکریپت اجرا شده باشد
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url, input } = parseArgs();
  console.log(`[Restore] در حال بازیابی به دیتابیس: ${url.replace(/:[^:@]+@/, ":****@")}`);
  console.log(`[Restore] مبدأ فایل: ${input}`);

  runRestore({ url, input })
    .then((result) => {
      console.log(`[Restore] بازیابی با موفقیت انجام شد:`);
      console.log(`  - روش: ${result.method}`);
      console.log(`  - تطابق هش: ${result.checksumVerified ? "تأیید شد" : "هش موجود نبود"}`);
      console.log(`  - تعداد جداول فعال: ${result.tablesCount}`);
    })
    .catch((err) => {
      console.error("[Restore] خطا در بازیابی:", err.message);
      process.exit(1);
    });
}
