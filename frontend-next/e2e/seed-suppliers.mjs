#!/usr/bin/env node
/**
 * کاشتِ هویت‌های تست برای دروازهٔ مرورگری فاز ۶.۲ (پورتال تأمین‌کننده).
 *
 * ── چرا این اسکریپت وجود دارد ────────────────────────────────────────────────
 * تست‌های Playwright باید روی دادهٔ **واقعیِ سرور** اجرا شوند، نه fixture
 * مرورگر. برای این کار به هویت‌های واقعی نیاز است:
 *   A) یک تأمین‌کنندهٔ عادی (بدون capability تولید) — برای اثباتِ دروازهٔ capability
 *   B) یک تأمین‌کنندهٔ تولیدکننده (با capability) — برای اثباتِ باز بودنِ بخش تولید
 *   C) اعضای تیم روی تأمین‌کنندهٔ A — برای صفحهٔ «تیم» و تستِ نقش‌ها
 *
 * ── چه چیزی hardcode نشده است ────────────────────────────────────────────────
 * هیچ رمز عبوری در این فایل یا در مخزن نیست. رمز از `KOLBE_E2E_SUPPLIER_PASSWORD`
 * خوانده می‌شود و در هیچ خروجی‌ای چاپ نمی‌شود. اگر تنظیم نشده باشد، اسکریپت
 * شکست می‌خورد (fail-closed) — رمز پیش‌فرض وجود ندارد.
 *
 * ── سازگاری با قراردادِ سرور ─────────────────────────────────────────────────
 *  • هَشِ رمز دقیقاً همان الگوریتمِ `passwordRecord()` در
 *    `apps/api/src/modules/auth/auth.service.ts` است: `scrypt(pwd, salt, 64)`.
 *  • رکوردهای `supplier`/`seller`/`supplier_member` دقیقاً همان چیزی است که
 *    `SuppliersService.createSupplier()` و `addMember()` می‌سازند
 *    (از جمله قراردادِ `seller_<supplierId>`).
 *  • اسکریپت DDL اجرا نمی‌کند؛ اسکیما باید از پیش مهاجرت شده باشد.
 *  • idempotent است: اجرای مجدد داده را خراب نمی‌کند.
 *
 * ── استفاده ──────────────────────────────────────────────────────────────────
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/kolbe_phase6_local \
 *   KOLBE_E2E_SUPPLIER_PASSWORD='یک-رمز-بلند-محلی' \
 *   node frontend-next/e2e/seed-suppliers.mjs
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { Client } = require(path.join(ROOT, "node_modules", "pg"));

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PASSWORD = process.env.KOLBE_E2E_SUPPLIER_PASSWORD ?? "";
const MIN_PASSWORD_LENGTH = 12;

/** همان `passwordRecord()` سمت سرور. */
function passwordRecord(password) {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
}

function fail(message) {
  process.stderr.write(`✖ ${message}\n`);
  process.exit(1);
}

if (!DATABASE_URL) fail("متغیر DATABASE_URL تنظیم نشده است.");
if (!PASSWORD) fail("متغیر KOLBE_E2E_SUPPLIER_PASSWORD تنظیم نشده است (رمز پیش‌فرض وجود ندارد).");
if (PASSWORD.length < MIN_PASSWORD_LENGTH) fail(`رمز باید حداقل ${MIN_PASSWORD_LENGTH} کاراکتر باشد.`);

/**
 * تعریفِ هویت‌های تست.
 *
 * `production: true` ⇒ ردیفِ `supplier_capability` با کد `production` ساخته
 * می‌شود؛ این همان چیزی است که `GET /supplier/production/capabilities` برمی‌گرداند
 * و `canUseProduction()` در `shared/permissions/capabilities.ts` می‌سنجد.
 */
const SUPPLIERS = [
  {
    id: "sup_e2e_normal",
    legalName: "کارگاه آزمون عادی",
    displayName: "کارگاه آزمون (عادی)",
    city: "تهران",
    category: "پوشاک",
    monthlyCapacity: 500,
    capabilities: [],
    production: false,
    members: [
      { email: "supplier-normal@kolbe.test", name: "مالک کارگاه آزمون", role: "owner", title: "مدیر کارگاه" },
      { email: "supplier-sales@kolbe.test", name: "فروشندهٔ کارگاه آزمون", role: "sales", title: "کارشناس فروش" },
      { email: "supplier-finance@kolbe.test", name: "مالی کارگاه آزمون", role: "finance", title: "مسئول مالی" },
    ],
  },
  {
    id: "sup_e2e_maker",
    legalName: "تولیدی آزمون توانا",
    displayName: "تولیدی آزمون (تولیدکننده)",
    city: "اصفهان",
    category: "چرم",
    monthlyCapacity: 5000,
    capabilities: ["production", "manufacturing"],
    production: true,
    members: [{ email: "supplier-maker@kolbe.test", name: "مالک تولیدی آزمون", role: "owner", title: "مدیر تولید" }],
  },
];

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // اطمینان از اینکه روی دیتابیسِ مهاجرت‌شده کار می‌کنیم (بدون اجرای DDL).
  const schema = await client.query(
    `SELECT to_regclass('public.supplier_member') AS member,
            to_regclass('public.supplier_capability') AS capability`,
  );
  if (!schema.rows[0].member) fail("جدول supplier_member وجود ندارد — ابتدا مهاجرت‌ها را اعمال کنید.");

  const summary = [];

  for (const sup of SUPPLIERS) {
    await client.query(
      `INSERT INTO supplier (id, legal_name, display_name, city, category, monthly_capacity, capabilities, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'approved')
       ON CONFLICT (id) DO UPDATE
         SET legal_name = EXCLUDED.legal_name,
             display_name = EXCLUDED.display_name,
             city = EXCLUDED.city,
             category = EXCLUDED.category,
             monthly_capacity = EXCLUDED.monthly_capacity,
             capabilities = EXCLUDED.capabilities,
             status = 'approved',
             updated_at = NOW()`,
      [sup.id, sup.legalName, sup.displayName, sup.city, sup.category, sup.monthlyCapacity, JSON.stringify(sup.capabilities)],
    );

    // قراردادِ `seller_<supplierId>` — همان چیزی که `createSupplier()` می‌سازد.
    const sellerId = `seller_${sup.id}`;
    await client.query(
      `INSERT INTO seller (id, type, supplier_id, display_name, status)
       VALUES ($1,'SUPPLIER',$2,$3,'active')
       ON CONFLICT (id) DO UPDATE
         SET display_name = EXCLUDED.display_name, status = 'active', updated_at = NOW()`,
      [sellerId, sup.id, sup.displayName],
    );

    const members = [];
    for (const member of sup.members) {
      const userId = `usr_e2e_${member.email.replace(/[^a-z0-9]+/gi, "_")}`;
      const { salt, passwordHash } = passwordRecord(PASSWORD);
      // نقشِ حساب `supplier` است؛ نقشِ عضوِ تیم در `supplier_member.role` است.
      await client.query(
        `INSERT INTO account_user (id, email, password_hash, salt, role, display_name, status, token_version)
         VALUES ($1,$2,$3,$4,'supplier',$5,'active',0)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               salt = EXCLUDED.salt,
               role = 'supplier',
               display_name = EXCLUDED.display_name,
               status = 'active',
               locked_until = NULL,
               failed_login_attempts = 0,
               updated_at = NOW()`,
        [userId, member.email, passwordHash, salt, member.name],
      );
      // `user_id` در `supplier_member` UNIQUE است ⇒ یک کاربر فقط به یک تأمین‌کننده تعلق دارد.
      await client.query(
        `INSERT INTO supplier_member (id, supplier_id, user_id, title, role)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE
           SET supplier_id = EXCLUDED.supplier_id,
               title = EXCLUDED.title,
               role = EXCLUDED.role,
               updated_at = NOW()`,
        [`smem_e2e_${userId}`, sup.id, userId, member.title, member.role],
      );
      members.push({ email: member.email, userId, role: member.role, title: member.title });
    }

    /**
     * capability تولید — تنها منبعِ حقیقتِ `GET /supplier/production/capabilities`.
     *
     * باید **پس از** ساخت کاربران اجرا شود: `supplier_capability.created_by`
     * یک FK واقعی به `account_user.id` دارد (`supplier_capability_created_by_fk`)،
     * پس هیچ شناسهٔ جعلی/ثابتی مثل "seed-e2e" قابل قبول نیست.
     */
    if (sup.production) {
      const owner = members.find((m) => m.role === "owner") ?? members[0];
      for (const code of ["production", "manufacturing"]) {
        await client.query(
          `INSERT INTO supplier_capability (id, supplier_id, capability_code, label, status, declared_units_per_period, metadata, created_by)
           VALUES ($1,$2,$3,$4,'active',$5,'{}'::jsonb,$6)
           ON CONFLICT (supplier_id, capability_code) DO UPDATE
             SET status = 'active', label = EXCLUDED.label, created_by = EXCLUDED.created_by, updated_at = NOW()`,
          [`scap_e2e_${sup.id}_${code}`, sup.id, code, code === "production" ? "تولید" : "ساخت", sup.monthlyCapacity, owner.userId],
        );
      }
    } else {
      await client.query(`DELETE FROM supplier_capability WHERE supplier_id = $1`, [sup.id]);
    }

    summary.push({ supplierId: sup.id, sellerId, production: sup.production, members });
  }

  process.stdout.write(`${JSON.stringify({ seeded: summary }, null, 2)}\n`);
  process.stdout.write("✓ هویت‌های تستِ فاز ۶.۲ کاشته شدند (رمز چاپ نشده است).\n");
} finally {
  await client.end();
}
