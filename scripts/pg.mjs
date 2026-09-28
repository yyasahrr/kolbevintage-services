#!/usr/bin/env node
/**
 * مدیریت PostgreSQL امبدد برای اپ یکپارچه کلبه.
 *
 *   node scripts/pg.mjs ensure   → اگر پایین است راه میاندازد (initdb + start + ساخت دیتابیس)
 *   node scripts/pg.mjs start    → مثل ensure
 *   node scripts/pg.mjs stop     → خاموش میکند (pg_ctl)
 *   node scripts/pg.mjs status   → وضعیت پورت
 *
 * باینریهای postgres از پکیج npm  @embedded-postgres/linux-x64  میآیند و
 * دیتای دیتابیس داخل `.postgres-data` در workspace نگهداری می‌شود. این مسیر
 * هم در توسعه و هم در runner لینوکس writable است و وارد git نمی‌شود.
 * ساخت جداول و (در صورت مجاز بودن) کاشت
 * دادهٔ نمایشی در اولین درخواست API انجام می‌شود — کاشت فقط با
 * `KOLBE_SEED_DEMO_DATA=true` و در محیط غیرِ تولید (اصلاح D18).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const platformPackage = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-arm64": "linux-arm64",
  "linux-x64": "linux-x64",
  "win32-x64": "windows-x64",
}[`${process.platform}-${process.arch}`];

if (!platformPackage) {
  throw new Error(`PostgreSQL امبدد برای ${process.platform}-${process.arch} پشتیبانی نشده است`);
}

const BIN = path.join(ROOT, "node_modules", "@embedded-postgres", platformPackage, "native", "bin");
const bin = (name) => path.join(BIN, process.platform === "win32" ? `${name}.exe` : name);

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  return line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").replace(/^[\"']|[\"']$/g, "");
}

const parsedDatabaseUrl = new URL(readDatabaseUrl() ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe");
const DB_DIR = process.env.KOLBE_PG_DIR ?? path.join(ROOT, ".postgres-data");
const PORT = Number(process.env.KOLBE_PG_PORT ?? parsedDatabaseUrl.port ?? 5432);
const HOST = parsedDatabaseUrl.hostname === "localhost" ? "127.0.0.1" : parsedDatabaseUrl.hostname;
const USER = decodeURIComponent(parsedDatabaseUrl.username || "postgres");
const PASSWORD = decodeURIComponent(parsedDatabaseUrl.password || "postgres");
const DB_NAME = process.env.KOLBE_PG_DB ?? decodeURIComponent(parsedDatabaseUrl.pathname.slice(1) || "kolbe");
const PG_LOG = path.join(DB_DIR, "postgres.log");

function isPortOpen(port, host = HOST) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function sh(file, args, opts = {}) {
  const result = spawnSync(file, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    throw new Error(`${path.basename(file)} با کد ${result.status} خارج شد`);
  }
  return result;
}

function configure() {
  const conf = path.join(DB_DIR, "postgresql.conf");
  const settings = [
    `listen_addresses = '${HOST}'`,
    `port = ${PORT}`,
    "max_connections = 120",
  ];
  if (process.platform !== "win32") settings.push("unix_socket_directories = '/tmp'");
  fs.appendFileSync(
    conf,
    `\n# --- kolbe dev ---\n${settings.join("\n")}\n`,
  );
}

async function createDatabase() {
  const require = createRequire(path.join(ROOT, "package.json"));
  const { Client } = require("pg");
  const client = new Client({
    connectionString: `postgres://${USER}:${PASSWORD}@${HOST}:${PORT}/postgres`,
  });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${DB_NAME}"`);
    console.log(`postgres: database created → ${DB_NAME}`);
  } else {
    console.log(`postgres: database exists → ${DB_NAME}`);
  }
  await client.end();
}

async function main() {
  const command = process.argv[2] ?? "ensure";

  if (command === "status") {
    console.log((await isPortOpen(PORT)) ? `postgres: running (port ${PORT})` : "postgres: stopped");
    return;
  }

  if (command === "stop") {
    if (!(await isPortOpen(PORT))) {
      console.log("postgres: already stopped");
      return;
    }
    sh(bin("pg_ctl"), ["-D", DB_DIR, "-m", "fast", "-w", "stop"]);
    console.log("postgres: stopped");
    return;
  }

  // ensure / start
  if (await isPortOpen(PORT)) {
    console.log(`postgres: already running (port ${PORT})`);
    await createDatabase();
    return;
  }

  fs.mkdirSync(DB_DIR, { recursive: true });
  const fresh = !fs.existsSync(path.join(DB_DIR, "PG_VERSION"));
  if (fresh) {
    const pwfile = path.join(os.tmpdir(), `kolbe-pw-${Date.now()}`);
    fs.writeFileSync(pwfile, PASSWORD, { mode: 0o600 });
    try {
      console.log(`postgres: initdb at ${DB_DIR}`);
      sh(bin("initdb"), [
        "-D", DB_DIR,
        "-U", USER,
        "-A", "password",
        "--pwfile", pwfile,
        "-E", "UTF8",
        "--locale=C",
      ]);
    } finally {
      fs.rmSync(pwfile, { force: true });
    }
    configure();
  }

  console.log(`postgres: starting on ${HOST}:${PORT}`);
  sh(bin("pg_ctl"), ["-D", DB_DIR, "-l", PG_LOG, "-w", "start"]);
  await createDatabase();
  console.log(fresh ? "postgres: FRESH" : "postgres: READY");
}

main().catch((err) => {
  console.error("postgres error:", err?.message ?? err);
  process.exit(1);
});
