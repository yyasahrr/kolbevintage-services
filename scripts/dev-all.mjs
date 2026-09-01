#!/usr/bin/env node
/**
 * اجرای کل پلتفرم کلبه وینتیج با یک دستور:  npm run dev
 *
 *   PostgreSQL (امبدد، پورت ۵۴۳۲)
 *     └── بک‌اند Medusa v2 — Node/TypeScript (پورت ۹۰۰۰)
 *           └── لایه Next.js (پورت ۳۰۰۰) — فروشگاه + پورتال ساپلایر + API بک‌اند
 *
 * اگر دیتابیس تازه باشد، مهاجرتها (medusa db:setup) و seed هم اجرا میشود.
 * خرابی هر بخش مانع اجرای بقیه نمیشود (فقط هشدار میدهد).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
const READY_MARKER = path.join(BACKEND, ".kolbe-db-ready");

function npmArgs(args) {
  return isWindows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
}

function run(label, command, args, opts = {}) {
  console.log(`\n▶ ${label}`);
  const child = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    ...opts,
  });
  child.on("error", (err) => console.warn(`⚠ ${label}: ${err.message}`));
  return child;
}

function isPortOpen(port, host = "127.0.0.1") {
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

async function waitForPort(port, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  console.warn(`⚠ ${label}: انتظار برای پورت ${port} تمام شد`);
  return false;
}

async function ensurePostgres() {
  console.log("\n━━━ PostgreSQL ━━━");
  const result = spawnSync(process.execPath, ["scripts/pg.mjs", "ensure"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.warn("⚠ postgres بالا نیامد؛ بک‌اند Medusa کار نخواهد کرد (فرانت‌اند مستقل بالا میآید).");
    return false;
  }
  return true;
}

/** @returns {Promise<boolean>} true اگر مهاجرت و seed در همین اجرا انجام شد */
async function ensureDatabase() {
  console.log("\n━━━ مهاجرت بک‌اند ━━━");
  if (fs.existsSync(READY_MARKER)) {
    console.log("• اسکیمای بک‌اند از قبل آماده است (db:setup رد شد).");
    return false;
  }
  const setup = spawnSync(npmCommand, npmArgs(["exec", "medusa", "db:setup"]), {
    cwd: BACKEND,
    stdio: "inherit",
  });
  if (setup.status !== 0) {
    console.warn("⚠ medusa db:setup ناموفق بود؛ seed اجرا نمیشود.");
    return false;
  }
  return true;
}

async function seedWhenReady() {
  const ok = await waitForPort(9000, 240_000, "medusa");
  if (!ok) return;
  console.log("\n━━━ Seed دامنه کلبه ━━━");
  const seed = spawnSync(process.execPath, ["scripts/seed.mjs"], {
    cwd: BACKEND,
    stdio: "inherit",
  });
  if (seed.status !== 0) {
    console.warn("⚠ seed ناموفق بود (ممکن است از قبل انجام شده باشد).");
    return;
  }
  fs.writeFileSync(READY_MARKER, new Date().toISOString());
  console.log("✓ seed کامل شد");
}

async function main() {
  console.log("کلبه وینتیج — اجرای کل پلتفرم (Next.js + Medusa + PostgreSQL)");

  const pgOk = await ensurePostgres();
  const freshDb = pgOk ? await ensureDatabase() : false;

  const children = [];

  // بک‌اند Medusa (Node/TypeScript) روی پورت ۹۰۰۰
  children.push(run("بک‌اند Medusa (پورت ۹۰۰۰)", npmCommand, npmArgs(["--prefix", "backend", "run", "dev"])));

  // seed پس از بالا آمدن سرور — فقط وقتی دیتابیس همین حالا مهاجرت شده
  if (freshDb) {
    seedWhenReady();
  }

  // لایه Next.js — فروشگاه + ساپلایر + API (پورت ۳۰۰۰)
  children.push(run("Next.js (پورت ۳۰۰۰)", npmCommand, npmArgs(["run", "dev", "--workspace", "kolbe-next"])));

  let shuttingDown = false;
  function shutdown(signal = "SIGTERM") {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nدر حال خاموش کردن…");
    for (const child of children) {
      if (!child.killed) child.kill(signal);
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(signal));
  }
  for (const child of children) {
    child.on("exit", (code) => {
      if (!shuttingDown && code && code !== 0) {
        process.exitCode = code;
        shutdown();
      }
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
