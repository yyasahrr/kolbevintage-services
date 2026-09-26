#!/usr/bin/env node
/** اجرای پلتفرم مستقل کلبه: PostgreSQL + Next.js. */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/*
 * بارگذاری `.env` ریشه به `process.env`. Next از `frontend-next` اجرا می‌شود و
 * فقط `frontend-next/.env` را خودکار می‌خواند، پس متغیرهای ریشه — به‌ویژه
 * `KOLBE_API_INTERNAL_URL` که rewrite پروکسی `/api/v1` (نشستِ قانونیِ فروشگاه)
 * به آن وابسته است — بدون این کار به Next نمی‌رسند. مقدار از `.env` خوانده
 * می‌شود (کپیِ `.env.example`)، نه hardcode در کد؛ اگر `.env` نباشد هیچ
 * متغیری تزریق نمی‌شود و رفتارِ بدونِ آن دست‌نخورده می‌ماند.
 */
const rootEnvFile = path.join(ROOT, ".env");
if (fs.existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
const npmArgs = (args) => isWindows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;

const postgres = spawnSync(process.execPath, ["scripts/pg.mjs", "ensure"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (postgres.status !== 0) {
  console.error("PostgreSQL بالا نیامد؛ اجرای برنامه متوقف شد.");
  process.exit(postgres.status ?? 1);
}

console.log("\nکلبه وینتیج — Next.js + PostgreSQL");

/*
 * بسته‌های workspace پیش از Next ساخته می‌شوند. لایهٔ سرورِ Next
 * (`server/database.ts` و `server/kolbe-api.ts`) `assertDatabaseReady` را از
 * مرز عمومی `@kolbe/database/verify` (→ `dist/src/verify.js`) وارد می‌کند؛ بدون
 * این ساخت، `dist` وجود ندارد و import در شروعِ تازه شکست می‌خورد. Turbopack هم
 * سورسِ ESM را در بستهٔ commonjs رد می‌کند، پس ساختِ بسته‌ها الزامی است.
 */
const packages = spawnSync(npmCommand, npmArgs(["run", "build:packages"]), {
  cwd: ROOT,
  stdio: "inherit",
});
if (packages.status !== 0) {
  console.error("ساخت بسته‌های workspace ناموفق بود؛ اجرای برنامه متوقف شد.");
  process.exit(packages.status ?? 1);
}

/*
 * دادهٔ نمایشی (حساب‌های admin/vip/supplier و کاتالوگ نمونه) از اصلاح D18
 * پیش‌فرض خاموش است و فقط با درخواست صریح کاشته می‌شود. `npm run dev` مسیر
 * توسعهٔ محلی است، پس اینجا صریحاً روشن می‌شود تا تجربهٔ توسعه‌دهنده عوض نشود.
 * محیط تولید هرگز از این اسکریپت اجرا نمی‌شود و در تولید حتی با فلگ روشن هم
 * کاشتی انجام نمی‌شود (`demoSeedDecision`).
 */
const devEnv = { ...process.env, KOLBE_SEED_DEMO_DATA: process.env.KOLBE_SEED_DEMO_DATA ?? "true" };

const child = spawn(npmCommand, npmArgs(["run", "dev", "--workspace", "kolbe-next"]), {
  cwd: ROOT,
  env: devEnv,
  stdio: "inherit",
});
child.on("error", (error) => console.error(error.message));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.on("exit", (code) => { process.exitCode = code ?? 0; });
