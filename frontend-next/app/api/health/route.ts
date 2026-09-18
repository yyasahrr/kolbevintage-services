import { corsHeaders } from "@server/kolbe-api";
import { DatabaseNotMigratedError, database } from "@server/database";

/**
 * سلامت اپ یکپارچه Next.js و دیتابیس مستقل آن.
 *
 * ── تغییر گام ۱.۲ ───────────────────────────────────────────────────────────
 * پیش از این، متن خطای خام دیتابیس (`err.message`) در بدنهٔ پاسخ برگردانده
 * می‌شد — یعنی یک کلاینت بدون احراز هویت می‌توانست نام جدول/ستون یا کد SQLSTATE
 * را ببیند (همان دستهٔ اصلاح D26). حالا:
 *   • جزئیات خطا فقط در لاگ سرور می‌ماند؛
 *   • بدنه فقط وضعیت کلاس‌بندی‌شده می‌گوید: `query ok` یا `query-failed` یا
 *     `migrations-required`؛
 *   • اگر دیتابیس آماده نباشد، پاسخ ۵۰۳ است تا healthcheck واقعاً «ناسالم»
 *     ببیند و سرویسِ نیمه‌آماده ترافیک نگیرد (fail closed).
 */
export async function GET() {
  let databaseStatus: "up" | "down" = "down";
  let detail: "query ok" | "query-failed" | "migrations-required" = "query-failed";
  try {
    const db = await database();
    await db.query("SELECT 1");
    databaseStatus = "up";
    detail = "query ok";
  } catch (error) {
    const migrationsRequired = error instanceof DatabaseNotMigratedError;
    detail = migrationsRequired ? "migrations-required" : "query-failed";
    console.error(
      `[kolbe-health] دیتابیس آماده نیست (${detail}) →`,
      migrationsRequired && error instanceof Error ? error.message : error,
    );
  }

  // بدون جزئیات داخلی: نه پیام درایور، نه نام جدول/ستون، نه SQLSTATE.
  const migrationsRequired = detail === "migrations-required";
  return Response.json(
    {
      ok: databaseStatus === "up",
      service: "kolbe-vintage",
      runtime: "nextjs",
      database: { engine: "postgresql", status: databaseStatus, detail },
      ...(migrationsRequired ? { action: "run the documented database migration command" } : {}),
    },
    { status: databaseStatus === "up" ? 200 : 503, headers: corsHeaders() },
  );
}

export const dynamic = "force-dynamic";
