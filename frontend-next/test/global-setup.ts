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

  // Phase 5.12-A: compatibility tests exercise the real canonical Nest API.
  // The old in-process Next writer is no longer a valid test backend.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.KOLBE_SESSION_SECRET = "test-session-secret-that-is-long-enough";
  process.env.KOLBE_INTERNAL_API_TOKEN = "phase-5-12-test-internal-token-long-enough";
  process.env.TRUST_PROXY = "loopback";
  process.env.KOLBE_SEED_DEMO_DATA = "true";
  const { database } = await import("../server/database");
  await database();

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../../apps/api/src/app.module");
  const app = await NestFactory.create(AppModule, { logger: ["error"] });
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback");
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string") throw new Error("Nest test server did not expose a TCP port");
  process.env.KOLBE_API_INTERNAL_URL = `http://127.0.0.1:${address.port}/api/v1`;
  return async () => app.close();
}
