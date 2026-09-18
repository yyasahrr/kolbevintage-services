import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

/**
 * آماده‌سازی دیتابیس تست.
 *
 * ⚠️ قاعدهٔ ایمنی: تست‌ها هرگز نباید روی دیتابیس توسعه (kolbe) اجرا شوند.
 * این فایل یک دیتابیس جدا (`kolbe_test`) می‌سازد و آن را پیش از هر اجرا از صفر
 * بازسازی می‌کند تا نتیجه‌ها قطعی (deterministic) باشند.
 *
 * ── تغییر گام ۱.۲ ───────────────────────────────────────────────────────────
 * پیش از این، اسکیمای دیتابیس تست «تصادفی» ساخته می‌شد: نخستین فراخوانی
 * `database()` در نخستین فایل تست، DDL زمان‌اجرا را اجرا می‌کرد. با حذف آن DDL،
 * اسکیما باید **صریح** با مهاجرت ساخته شود — همان مسیری که تولید هم می‌رود.
 * پس اینجا یک‌بار مهاجرت‌ها اعمال می‌شوند و تست‌ها فقط روی اسکیمای مهاجرت‌شده
 * اجرا می‌شوند (اگر مهاجرتی در آینده از قلم بیفتد، همین‌جا شکست می‌خورد).
 */
export const TEST_DATABASE_URL =
  process.env.KOLBE_TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:55432/kolbe_test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export default async function setup() {
  // ۱) بالا آوردن PostgreSQL امبدد (خارج از git؛ در /home/user/pg).
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], {
    cwd: ROOT,
    stdio: "inherit",
  });

  // ۲) بازسازی دیتابیس تست.
  const parsed = new URL(TEST_DATABASE_URL);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `دیتابیس تست باید به «_test» ختم شود تا اجرای تصادفی روی دیتابیس واقعی رخ ندهد (دریافت‌شده: ${databaseName})`,
    );
  }

  const admin = new Client({
    connectionString: `postgres://${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}@${parsed.hostname}:${parsed.port}/postgres`,
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }

  // ۳) اعمال مهاجرت‌ها روی دیتابیس تازه — تنها راه ساخت اسکیما.
  execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
