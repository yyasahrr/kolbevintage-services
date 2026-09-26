/**
 * Phase 6.7 — seed of L5 end-to-end identities (idempotent).
 *
 * The acceptance gate needs real browser logins, so the stack needs a supplier
 * who can submit, an admin who can moderate, and a VIP who can consume. This
 * script is safe to re-run: every row is keyed by a stable id derived from a
 * namespace, and inserts are `ON CONFLICT DO NOTHING/UPDATE`.
 *
 * Password hashing mirrors apps/api auth.service (scrypt(password, hexSalt, 64)
 * rendered as hex) so the seeded users can log in via /api/v1/auth/login.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-e2e-identities.mjs
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const password = process.env.KOLBE_E2E_PASSWORD || "Kolbe!TestPassword123";
const supplierEmail = process.env.KOLBE_E2E_SUPPLIER_EMAIL || "supplier@kolbe.test";
const adminEmail = process.env.KOLBE_E2E_ADMIN_EMAIL || "admin@kolbe.test";

const stableId = (namespace, prefix) => `${prefix}_${createHash("sha256").update(namespace).digest("hex").slice(0, 24)}`;
const passwordRecord = () => {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 64).toString("hex") };
};

const db = new Client({ connectionString });
await db.connect();

async function upsertUser(email, role, displayName) {
  const { salt, passwordHash } = passwordRecord();
  const { rows } = await db.query(
    `INSERT INTO account_user (id, email, password_hash, salt, role, display_name, status)
     VALUES ($1,$2,$3,$4,$5,$6,'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt,
       role = EXCLUDED.role, status = 'active', token_version = account_user.token_version + 1
     RETURNING id`,
    [stableId(`user:${email}`, "usr"), email, passwordHash, salt, role, displayName],
  );
  return rows[0].id;
}

/** Idempotent single-row insert keyed on the primary key. */
async function ensure(table, columns, values) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
  const updates = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");
  await db.query(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})
     ON CONFLICT (id) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`,
    values,
  );
}

const supplierUserId = await upsertUser(supplierEmail, "supplier", "تأمین‌کنندهٔ آزمایشی کلبه");
const adminUserId = await upsertUser(adminEmail, "admin", "مدیر کاتالوگ کلبه");

const supplierId = stableId("supplier:e2e", "sup");
const sellerId = stableId("seller:e2e", "sel");
await ensure("supplier", ["id", "legal_name", "display_name", "status"], [supplierId, "نساجی نیلگون", "نساجی نیلگون", "approved"]);
await ensure("seller", ["id", "type", "supplier_id", "display_name", "status"], [sellerId, "SUPPLIER", supplierId, "نساجی نیلگون", "active"]);
await ensure("supplier_member", ["id", "supplier_id", "user_id", "role", "title"], [
  stableId("member:e2e", "mem"),
  supplierId,
  supplierUserId,
  "owner",
  "Owner",
]);

// Admin RBAC for retail:catalog:manage — the moderation endpoints require it.
const adminRoleId = stableId("role:catalog-admin", "role");
await ensure("admin_role", ["id", "name", "display_name"], [adminRoleId, "catalog_admin_e2e", "Catalog Admin"]);
await ensure("admin_role_permission", ["id", "role_id", "action"], [stableId("perm:catalog-manage", "perm"), adminRoleId, "retail:catalog:manage"]);
await ensure("admin_user_role", ["id", "role_id", "user_id", "assigned_by"], [
  stableId("userrole:catalog-admin", "ur"),
  adminRoleId,
  adminUserId,
  adminUserId,
]);

// A canonical category with a real attributes_schema and an approved brand, so
// the editor exercises schema-driven attributes rather than an empty form.
const categoryId = stableId("category:linen-shirts", "cat");
await db.query(
  `INSERT INTO category (id, slug, name, attributes_schema)
   VALUES ($1,$2,$3,$4::jsonb)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, attributes_schema = EXCLUDED.attributes_schema`,
  [
    categoryId,
    "linen-shirts",
    "پیراهن لینن",
    JSON.stringify({ material: "string", fit: { type: "select", options: ["regular", "slim"] }, origin: "string" }),
  ],
);
const brandId = stableId("brand:kolbe-linen", "brn");
await ensure("brand", ["id", "slug", "name", "verification_status"], [brandId, "kolbe-linen", "Kolbe Linen", "approved"]);

/* ── VIP identities ───────────────────────────────────────────────────────────
 * Entitlements are derived by the API (auth.service.ts) as:
 *   catalog: wholesale_account.status === 'approved' && !expired
 *   rfq:     catalog && an active, unexpired vip_subscription
 *   orders:  catalog
 * So the three identities below produce three genuinely different server-side
 * capability sets. Nothing here invents an entitlement the API will not grant.
 */
const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

// (a) catalog-only: approved account, NO subscription -> rfq must be false.
const vipCatalogUserId = await upsertUser("vip-catalog@kolbe.test", "customer", "خریدار عمده — فقط کاتالوگ");
const vipCatalogAccountId = stableId("vipaccount:catalog-only", "wac");
await ensure("wholesale_account", ["id", "user_id", "member_name", "store_name", "phone", "city", "plan_name", "status", "activated_at", "expires_at"], [
  vipCatalogAccountId, vipCatalogUserId, "بوتیک نیلوفر", "بوتیک نیلوفر", "02100000001", "تهران", "پایه", "approved", new Date().toISOString(), farFuture,
]);

// (b) full VIP: approved account PLUS an active subscription -> rfq true.
const vipFullUserId = await upsertUser("vip-full@kolbe.test", "customer", "خریدار عمده — دسترسی کامل");
const vipFullAccountId = stableId("vipaccount:full", "wac");
await ensure("wholesale_account", ["id", "user_id", "member_name", "store_name", "phone", "city", "plan_name", "status", "activated_at", "expires_at"], [
  vipFullAccountId, vipFullUserId, "گالری آرش", "گالری آرش", "02100000002", "تهران", "حرفه‌ای", "approved", new Date().toISOString(), farFuture,
]);
const vipPlanId = stableId("vipplan:e2e", "vpl");
await ensure("vip_plan", ["id", "name", "slug", "price", "duration_days", "features", "limits", "status"], [
  vipPlanId, "پلن آزمایشی عمده", "vip-e2e", "0", 365, JSON.stringify([]), JSON.stringify({}), "active",
]);
await ensure("vip_subscription", ["id", "user_id", "plan_id", "status", "started_at", "expires_at"], [
  stableId("vipsub:full", "vsub"), vipFullUserId, vipPlanId, "active", new Date().toISOString(), farFuture,
]);

// (c) pending VIP: account awaiting approval -> no entitlement at all.
const vipPendingUserId = await upsertUser("vip-pending@kolbe.test", "customer", "خریدار عمده — در انتظار");
await ensure("wholesale_account", ["id", "user_id", "member_name", "store_name", "phone", "city", "plan_name", "status"], [
  stableId("vipaccount:pending", "wac"), vipPendingUserId, "فروشگاه سایه", "فروشگاه سایه", "02100000003", "شیراز", "پایه", "pending",
]);

console.log(
  JSON.stringify(
    {
      supplierEmail, adminEmail, password, supplierId, sellerId, categoryId, brandId,
      vipCatalogEmail: "vip-catalog@kolbe.test",
      vipFullEmail: "vip-full@kolbe.test",
      vipPendingEmail: "vip-pending@kolbe.test",
    },
    null,
    2,
  ),
);

await db.end();
