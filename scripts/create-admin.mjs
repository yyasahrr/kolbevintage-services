#!/usr/bin/env node
/**
 * ساخت حساب مدیر — ابزار اپراتور.
 *
 * ── چرا این اسکریپت وجود دارد ────────────────────────────────────────────────
 * پیش از اصلاح D18، تنها راه داشتن حساب مدیر، `seed()` خودکار بود که در هر
 * محیطی سه حساب دمو (با رمز عبور موجود در مخزن) می‌ساخت. از فاز ۱.۵ به بعد آن
 * کاشت **پیش‌فرض خاموش** است و در تولید هرگز اجرا نمی‌شود. پس بدون این اسکریپت،
 * یک استقرار تازه هیچ راه قانونی برای ساخت نخستین مدیر نداشت.
 *
 * این اسکریپت «معادلِ جایگزین» آن مسیر است — با سه تفاوت مهم:
 *   ۱) رمز عبور داخل مخزن یا کد نیست؛ اپراتور آن را می‌دهد.
 *   ۲) هیچ رمز پیش‌فرضی ندارد و رمز کوتاه را رد می‌کند.
 *   ۳) آگاهانه و یک‌بار اجرا می‌شود، نه در هر بوت.
 *
 * ── استفاده ─────────────────────────────────────────────────────────────────
 *   KOLBE_ADMIN_EMAIL=you@example.com \
 *   KOLBE_ADMIN_PASSWORD='یک-رمز-تصادفی-بلند' \
 *   node scripts/create-admin.mjs
 *
 * برای حساب با نقشی غیر از مدیر (مثلاً VIP یا تأمین‌کننده) نام نمایشی و نقش را
 * هم می‌توان داد:
 *   KOLBE_ADMIN_ROLE=vip KOLBE_ADMIN_NAME='نام نمایشی' ...
 *
 * نکات:
 *   • اسکیما باید از قبل ساخته شده باشد (یک‌بار اپلیکیشن را بالا بیاورید تا
 *     `database()` اسکیما را بسازد). این اسکریپت DDL اجرا **نمی‌کند** تا مرجع
 *     اسکیما یکی بماند (بدهی D5/فاز ۱.۲).
 *   • اگر ایمیل از قبل وجود داشته باشد، چیزی تغییر نمی‌کند (idempotent) مگر
 *     `KOLBE_ADMIN_RESET_PASSWORD=true` بدهید که رمز را بازنشانی می‌کند.
 *   • رمز در هیچ لاگی چاپ نمی‌شود.
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:55432/kolbe";
const MIN_PASSWORD_LENGTH = 12;
const ALLOWED_ROLES = new Set(["admin", "customer", "vip", "supplier"]);

/** همان الگوریتم `passwordRecord()` در `frontend-next/server/database.ts`. */
function passwordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const email = String(process.env.KOLBE_ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = String(process.env.KOLBE_ADMIN_PASSWORD ?? "");
const role = String(process.env.KOLBE_ADMIN_ROLE ?? "admin").trim();
const displayName = String(process.env.KOLBE_ADMIN_NAME ?? "").trim() || null;
const phone = String(process.env.KOLBE_ADMIN_PHONE ?? "").trim() || null;
const resetPassword = process.env.KOLBE_ADMIN_RESET_PASSWORD === "true";

if (!email) fail("متغیر KOLBE_ADMIN_EMAIL تنظیم نشده است.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(`ایمیل نامعتبر است: ${email}`);
if (!password) fail("متغیر KOLBE_ADMIN_PASSWORD تنظیم نشده است (رمز پیش‌فرض وجود ندارد).");
if (password.length < MIN_PASSWORD_LENGTH) {
  fail(`رمز عبور باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر باشد.`);
}
if (!ALLOWED_ROLES.has(role)) {
  fail(`نقش «${role}» مجاز نیست. مقادیر مجاز: ${[...ALLOWED_ROLES].join(", ")}`);
}

const { Client } = require(path.join(ROOT, "node_modules", "pg"));
const connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const client = new Client({ connectionString });
await client.connect();

try {
  // اگر اسکیما ساخته نشده باشد، این اسکریپت نباید DDL اجرا کند؛ فقط راهنمایی می‌کند.
  const table = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='account_user'",
  );
  if (table.rowCount === 0) {
    fail(
      "جدول account_user وجود ندارد. یک‌بار اپلیکیشن را بالا بیاورید (یا مهاجرت‌ها را اجرا کنید) " +
        "تا اسکیما ساخته شود، سپس این اسکریپت را دوباره اجرا کنید.",
    );
  }

  const existing = await client.query("SELECT id, role FROM account_user WHERE email=$1", [email]);

  if (existing.rowCount > 0 && !resetPassword) {
    const account = existing.rows[0];
    console.log(`ℹ حساب «${email}» از قبل وجود دارد (نقش فعلی: ${account.role}). هیچ تغییری انجام نشد.`);
    console.log("  برای بازنشانی رمز: KOLBE_ADMIN_RESET_PASSWORD=true را هم تنظیم کنید.");
    process.exit(0);
  }

  if (existing.rowCount > 0) {
    const { salt, passwordHash } = passwordRecord(password);
    await client.query(
      `UPDATE account_user SET password_hash=$2, salt=$3, role=$4, status='active', updated_at=now()
       WHERE email=$1`,
      [email, passwordHash, salt, role],
    );
    console.log(`✔ رمز و نقش حساب «${email}» بازنشانی شد (نقش: ${role}).`);
    process.exit(0);
  }

  const { salt, passwordHash } = passwordRecord(password);
  const id = `usr_${randomUUID().replaceAll("-", "")}`;
  await client.query(
    `INSERT INTO account_user (id,email,password_hash,salt,role,display_name,phone,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
    [id, email, passwordHash, salt, role, displayName, phone],
  );
  console.log(`✔ حساب ساخته شد: ${email} (نقش: ${role}، شناسه: ${id})`);
  console.log("  رمز در هیچ لاگی ذخیره نشده است؛ آن را جای امنی نگه دارید.");
} finally {
  await client.end();
}
