#!/usr/bin/env node
/**
 * ابزار پشتیبان‌گیری خودکار از دیتابیس کلبه — فاز ۴.۹ سخت‌سازی تولید.
 *
 *   node scripts/backup-db.mjs [--url <DATABASE_URL>] [--output <file_path>]
 *
 * ویژگی‌ها:
 *  - استخراج کامل جدول‌ها و داده‌ها
 *  - محاسبهٔ هش SHA-256 برای تضمین عدم فساد داده (Non-corruption verification)
 *  - پشتیبانی دوگانه: استفاده از pg_dump در صورت وجود، یا استخراج مستقیم SQL از طریق pg driver
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  let url = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/kolbe";
  let output = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === "--output" && args[i + 1]) {
      output = args[++i];
    }
  }

  if (!output) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(ROOT, "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    output = path.join(backupDir, `kolbe-backup-${timestamp}.sql`);
  }

  return { url, output };
}

async function exportViaDriver(url, outputPath) {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const tableRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC;
    `);

    const tables = tableRes.rows.map((r) => r.table_name);
    const sqlChunks = [
      "-- =================================================================",
      `-- Kolbe Platform Database Backup Generated at ${new Date().toISOString()}`,
      "-- =================================================================",
      "SET statement_timeout = 0;",
      "SET client_encoding = 'UTF8';",
      "SET standard_conforming_strings = on;",
      "SET check_function_bodies = false;",
      "SET client_min_messages = warning;",
      "SET row_security = off;",
      "SET session_replication_role = 'replica';\n",
    ];

    let totalRows = 0;

    for (const table of tables) {
      const rowsRes = await client.query(`SELECT * FROM public."${table}"`);
      totalRows += rowsRes.rows.length;

      if (rowsRes.rows.length === 0) continue;

      const columns = Object.keys(rowsRes.rows[0]);
      const quotedCols = columns.map((c) => `"${c}"`).join(", ");

      sqlChunks.push(`-- Data for Name: ${table}; Type: TABLE DATA; Rows: ${rowsRes.rows.length}`);
      sqlChunks.push(`TRUNCATE TABLE public."${table}" CASCADE;`);

      for (const row of rowsRes.rows) {
        const values = columns.map((c) => {
          const val = row[c];
          if (val === null || val === undefined) return "NULL";
          if (typeof val === "boolean") return val ? "true" : "false";
          if (typeof val === "number" || typeof val === "bigint") return String(val);
          if (val instanceof Date) return `'${val.toISOString()}'::timestamptz`;
          if (typeof val === "object") {
            const jsonStr = JSON.stringify(val).replace(/'/g, "''");
            return `'${jsonStr}'::jsonb`;
          }
          const str = String(val).replace(/'/g, "''");
          return `'${str}'`;
        });

        sqlChunks.push(`INSERT INTO public."${table}" (${quotedCols}) VALUES (${values.join(", ")});`);
      }
      sqlChunks.push("");
    }

    sqlChunks.push("SET session_replication_role = 'origin';\n");

    const fullSql = sqlChunks.join("\n");
    fs.writeFileSync(outputPath, fullSql, "utf8");

    const sha256 = createHash("sha256").update(fullSql).digest("hex");
    fs.writeFileSync(`${outputPath}.sha256`, `${sha256}  ${path.basename(outputPath)}\n`, "utf8");

    return {
      method: "driver",
      tablesCount: tables.length,
      totalRows,
      outputPath,
      sha256,
      sizeBytes: Buffer.byteLength(fullSql),
    };
  } finally {
    await client.end();
  }
}

export async function runBackup(options = {}) {
  const url = options.url || parseArgs().url;
  const output = options.output || parseArgs().output;

  // بررسی وجود باینری pg_dump
  const pgDumpCheck = spawnSync("pg_dump", ["--version"], { stdio: "pipe" });
  if (pgDumpCheck.status === 0) {
    const res = spawnSync("pg_dump", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "-d", url, "-f", output], {
      stdio: "pipe",
    });
    if (res.status === 0 && fs.existsSync(output)) {
      const data = fs.readFileSync(output);
      const sha256 = createHash("sha256").update(data).digest("hex");
      fs.writeFileSync(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`, "utf8");
      return {
        method: "pg_dump",
        outputPath: output,
        sha256,
        sizeBytes: data.length,
      };
    }
  }

  // اگر pg_dump نبود، استخراج ایمن با pg client انجام می‌شود
  return await exportViaDriver(url, output);
}

// اگر مستقیماً به عنوان اسکریپت اجرا شده باشد
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url, output } = parseArgs();
  console.log(`[Backup] در حال تهیه پشتیبان از: ${url.replace(/:[^:@]+@/, ":****@")}`);
  console.log(`[Backup] مقصد: ${output}`);

  runBackup({ url, output })
    .then((result) => {
      console.log(`[Backup] پشتیبان‌گیری موفق:`);
      console.log(`  - روش: ${result.method}`);
      console.log(`  - حجم: ${(result.sizeBytes / 1024).toFixed(2)} KB`);
      console.log(`  - هش SHA-256: ${result.sha256}`);
      console.log(`  - مسیر: ${result.outputPath}`);
    })
    .catch((err) => {
      console.error("[Backup] خطا در تهیه پشتیبان:", err.message);
      process.exit(1);
    });
}
