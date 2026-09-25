/*
 * Phase 6.3 — VIP/Wholesale identity seed (idempotent).
 * Creates the four test identities the acceptance gate needs:
 *   - ordinary customer (no wholesale membership)      → KOLBE_E2E_CUSTOMER_EMAIL
 *   - pending wholesale applicant (not approved yet)   → KOLBE_E2E_VIP_PENDING_EMAIL
 *   - active VIP (approved account + active sub)       → KOLBE_E2E_VIP_EMAIL
 * Password hashing mirrors apps/api auth.service (scrypt(password, hexSalt, 64).hex)
 * so the seeded users can log in through /api/v1/auth/login.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const db = new Client({ connectionString: process.env.DATABASE_URL });

const password = process.env.KOLBE_E2E_CUSTOMER_PASSWORD || "Kolbe!TestPassword123";
const customerEmail = process.env.KOLBE_E2E_CUSTOMER_EMAIL || "customer@kolbe.test";
const vipEmail = process.env.KOLBE_E2E_VIP_EMAIL || "vip@kolbe.test";
const vipPendingEmail = process.env.KOLBE_E2E_VIP_PENDING_EMAIL || "vip-pending@kolbe.test";

const stableId = (ns) => createHash("sha256").update(ns).digest("hex").slice(0, 32);
const passwordRecord = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(pw, salt, 64).toString("hex") };
};

async function upsertUser(email, displayName) {
  const { salt, passwordHash } = passwordRecord(password);
  const { rows } = await db.query(
    `INSERT INTO account_user (id, email, password_hash, salt, role, display_name, status)
     VALUES ($1,$2,$3,$4,'customer',$5,'active')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt,
       status = 'active', token_version = account_user.token_version + 1
     RETURNING id`,
    [stableId(`user:${email}`), email, passwordHash, salt, displayName],
  );
  return rows[0].id;
}

async function ensurePlan() {
  const id = stableId("vip-plan:standard");
  await db.query(
    `INSERT INTO vip_plan (id, name, slug, price, duration_days, features, limits, status)
     VALUES ($1,'اشتراک عمده‌فروشی','vip-standard',0,365,'{}','{}','active')
     ON CONFLICT (id) DO NOTHING`,
    [id],
  );
  return id;
}

async function setMembership(userId, kind, planId) {
  const now = new Date();
  const yearOut = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  // subscription
  await db.query(`DELETE FROM vip_subscription WHERE user_id = $1`, [userId]);
  if (kind === "active") {
    await db.query(
      `INSERT INTO vip_subscription (id, user_id, plan_id, status, started_at, expires_at)
       VALUES ($1,$2,$3,'active',$4,$5)`,
      [stableId(`vip-sub:${userId}`), userId, planId, now, yearOut],
    );
  }
  // wholesale account
  await db.query(`DELETE FROM wholesale_account WHERE user_id = $1`, [userId]);
  if (kind === "active" || kind === "pending") {
    await db.query(
      `INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, plan_name, status, activated_at, expires_at)
       VALUES ($1,$2,$3,$4,'09120000000','تهران','وی‌آی‌پی',$5,$6,$7)`,
      [
        stableId(`ws-acct:${userId}`),
        userId,
        kind === "active" ? "کاربر VIP" : "متقاضی VIP",
        kind === "active" ? "فروشگاه VIP" : "فروشگاه متقاضی",
        kind === "active" ? "approved" : "pending",
        kind === "active" ? now : null,
        kind === "active" ? yearOut : null,
      ],
    );
  }
}

try {
  await db.connect();
  const planId = await ensurePlan();
  const customer = await upsertUser(customerEmail, "مشتری عادی");
  const vip = await upsertUser(vipEmail, "کاربر VIP");
  const vipPending = await upsertUser(vipPendingEmail, "متقاضی VIP");
  await setMembership(customer, "none", planId);
  await setMembership(vip, "active", planId);
  await setMembership(vipPending, "pending", planId);
  console.log(
    `[vip-identities] seeded: customer=${customerEmail} (none), pending=${vipPendingEmail} (pending), vip=${vipEmail} (active); plan=${planId}`,
  );
} catch (error) {
  console.error("[vip-identities] failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await db.end();
}
