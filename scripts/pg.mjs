#!/usr/bin/env node
/**
 * مدیریت PostgreSQL امبدد برای بک‌اند Medusa کلبه.
 *
 *   node scripts/pg.mjs ensure   → اگر پایین است راه میاندازد (initdb + start + ساخت دیتابیس)
 *   node scripts/pg.mjs start    → مثل ensure
 *   node scripts/pg.mjs stop     → خاموش میکند (pg_ctl)
 *   node scripts/pg.mjs status   → وضعیت پورت
 *
 * باینریهای postgres از پکیج npm  @embedded-postgres/linux-x64  میآیند و
 * دیتای دیتابیس بیرون از ریپو نگهداری میشود (پیشفرض /home/user/pg) تا وارد
 * git نشود. اگر پوشه دیتا تازه ساخته شود، مارکر «آماده» بک‌اند حذف میشود
 * تا dev-all مجدد مهاجرت و seed را اجرا کند.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "node_modules/@embedded-postgres/linux-x64/native/bin");
const DB_DIR = process.env.KOLBE_PG_DIR ?? "/home/user/pg";
const PORT = Number(process.env.KOLBE_PG_PORT ?? 5432);
const HOST = "127.0.0.1";
const USER = "postgres";
const PASSWORD = "postgres";
const DB_NAME = process.env.KOLBE_PG_DB ?? "kolbe_medusa";
const READY_MARKER = path.join(ROOT, "backend/.kolbe-db-ready");
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
    "unix_socket_directories = '/tmp'",
    "max_connections = 120",
  ];
  fs.appendFileSync(
    conf,
    `\n# --- kolbe dev ---\n${settings.join("\n")}\n`,
  );
}

async function createDatabase() {
  const require = createRequire(path.join(ROOT, "backend/package.json"));
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
    sh(path.join(BIN, "pg_ctl"), ["-D", DB_DIR, "-m", "fast", "-w", "stop"]);
    console.log("postgres: stopped");
    return;
  }

  // ensure / start
  if (await isPortOpen(PORT)) {
    console.log(`postgres: already running (port ${PORT})`);
    return;
  }

  fs.mkdirSync(DB_DIR, { recursive: true });
  const fresh = !fs.existsSync(path.join(DB_DIR, "PG_VERSION"));
  if (fresh) {
    const pwfile = path.join(os.tmpdir(), `kolbe-pw-${Date.now()}`);
    fs.writeFileSync(pwfile, PASSWORD, { mode: 0o600 });
    try {
      console.log(`postgres: initdb at ${DB_DIR}`);
      sh(path.join(BIN, "initdb"), [
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
    fs.rmSync(READY_MARKER, { force: true });
    configure();
  }

  console.log(`postgres: starting on ${HOST}:${PORT}`);
  sh(path.join(BIN, "pg_ctl"), ["-D", DB_DIR, "-l", PG_LOG, "-w", "start"]);
  await createDatabase();
  console.log(fresh ? "postgres: FRESH" : "postgres: READY");
}

main().catch((err) => {
  console.error("postgres error:", err?.message ?? err);
  process.exit(1);
});
