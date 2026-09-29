import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { makeId, rows, transaction } from "./database";
import { OpsError } from "./wholesale-ops";
import { renderInvoicePdf, toJalali, type InvoiceSnapshot } from "./invoice-pdf";

type Json = Record<string, any>;
type Actor = { sub: string; role: string } | null;
type RequestLike = { method: string; url: string; json: () => Promise<unknown> };

export const SUPPLIER_STATUSES = ["pending_review", "active", "limited", "suspended", "blocked", "rejected"] as const;
export const BUYER_STATUSES = ["pending", "approved", "suspended", "blocked", "rejected", "expired", "financial_blocked", "cancelled"] as const;
export const BUYER_RESTRICTIONS = ["place_order", "wholesale_pricing", "messaging"] as const;
export const RESTRICTION_CODES = [
  "create_product", "edit_product", "publish_product", "receive_order", "wallet_withdraw",
  "settlement_request", "feature", "product_cap", "sales_cap",
] as const;
export const INVOICE_KINDS = ["retail", "wholesale", "vip", "supplier_statement", "settlement", "refund", "adjustment"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "cancelled", "refunded", "void"] as const;
export const INVOICE_VARIABLES = [
  "invoice.number", "invoice.date", "invoice.dueDate", "invoice.kind", "invoice.status",
  "seller.name", "seller.address", "seller.taxId",
  "customer.name", "customer.phone", "customer.address", "customer.email",
  "supplier.name", "supplier.phone", "supplier.city",
  "order.reference", "payment.method", "payment.reference",
  "subtotal", "discount", "tax", "shipping", "total", "paid", "remaining",
] as const;
export const CRM_EVENTS = [
  "customer.created", "customer.updated", "order.created", "order.paid", "order.shipped", "order.delivered", "cart.abandoned",
  "membership.activated", "membership.expiring", "membership.expired", "product.viewed", "product.created", "product.rejected",
  "coupon.used", "coupon.issued", "ticket.created", "product.submitted", "supplier.status_changed", "invoice.issued", "restriction.applied",
  "commission.changed", "membership.cancelled", "membership.refunded",
  "shipment.tracking.updated", "shipment.updated", "review.created",
  "payment.completed", "refund.completed", "supplier.payable.created",
  "settlement.created", "settlement.approved", "settlement.paid",
  "withdrawal.requested", "withdrawal.paid", "adjustment.created",
] as const;
export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس", issued: "صادرشده", partially_paid: "پرداخت ناقص", paid: "پرداخت‌شده",
  cancelled: "لغوشده", refunded: "برگشت‌شده", void: "باطل",
};
const INVOICE_KIND_LABEL: Record<string, string> = {
  retail: "فاکتور خرید خرده", wholesale: "فاکتور خرید عمده", vip: "فاکتور مشتری VIP",
  supplier_statement: "صورت‌حساب تأمین‌کننده", settlement: "صورتحساب تسویه", refund: "سند برگشت وجه", adjustment: "سند اصلاحی",
};
const STATUS_LABEL: Record<string, string> = {
  pending_review: "در انتظار بررسی", active: "فعال", limited: "محدودشده", suspended: "تعلیق‌شده",
  blocked: "مسدود", rejected: "ردشده", pending: "در انتظار", approved: "فعال", expired: "منقضی",
  financial_blocked: "مسدود مالی",
};
const RESTRICTION_LABEL: Record<string, string> = {
  create_product: "عدم اجازه ثبت محصول جدید",
  edit_product: "عدم اجازه ویرایش محصول",
  publish_product: "عدم اجازه انتشار محصول",
  receive_order: "عدم اجازه دریافت سفارش جدید",
  wallet_withdraw: "عدم اجازه برداشت از کیف پول",
  settlement_request: "عدم اجازه درخواست تسویه",
  feature: "عدم اجازه استفاده از قابلیت",
  product_cap: "محدودیت تعداد محصول",
  sales_cap: "محدودیت حجم فروش",
};

const SCHEMA = `
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS responsible_name text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS cooperation_type text NOT NULL DEFAULT 'marketplace';
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified';
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS cooperation_status text NOT NULL DEFAULT 'active';
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS cooperation_until timestamptz;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS commission_rate numeric NOT NULL DEFAULT 8;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS plan_code text NOT NULL DEFAULT 'vip';
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS credit_limit bigint NOT NULL DEFAULT 0;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS guild_id text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS legal_info text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS activity_type text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS internal_note text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS scheduled_plan_code text;
ALTER TABLE wholesale_account ADD COLUMN IF NOT EXISTS scheduled_plan_at timestamptz;
CREATE TABLE IF NOT EXISTS supplier_profile_revision (
  id text PRIMARY KEY, supplier_id text NOT NULL, version integer NOT NULL, snapshot jsonb NOT NULL,
  actor_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS party_document (
  id text PRIMARY KEY, party_type text NOT NULL, party_id text NOT NULL, title text NOT NULL,
  status text NOT NULL DEFAULT 'pending', note text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
  reviewer_id text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_status_event (
  id text PRIMARY KEY, supplier_id text NOT NULL, from_status text, to_status text NOT NULL,
  reason text NOT NULL, note text NOT NULL DEFAULT '', until timestamptz, actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_restriction (
  id text PRIMARY KEY, supplier_id text NOT NULL, code text NOT NULL, active boolean NOT NULL DEFAULT true,
  reason text NOT NULL, note text NOT NULL DEFAULT '', until timestamptz, limit_value bigint,
  feature text, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, code)
);
CREATE TABLE IF NOT EXISTS ledger_entry (
  id text PRIMARY KEY, party_type text NOT NULL, party_id text NOT NULL, kind text NOT NULL,
  amount bigint NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL, memo text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entry_ref ON ledger_entry(party_type, party_id, kind, reference_type, reference_id);
CREATE TABLE IF NOT EXISTS withdrawal_request (
  id text PRIMARY KEY, party_type text NOT NULL, party_id text NOT NULL, amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'requested', note text NOT NULL DEFAULT '', actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_event (
  id text PRIMARY KEY, actor_id text, actor_role text, subject_type text NOT NULL, subject_id text NOT NULL,
  action text NOT NULL, reason text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_event_subject ON audit_event(subject_type, subject_id, created_at DESC);
CREATE TABLE IF NOT EXISTS domain_event (
  id text PRIMARY KEY, name text NOT NULL, subject_type text NOT NULL, subject_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_event_subject ON domain_event(subject_type, subject_id, created_at DESC);
CREATE TABLE IF NOT EXISTS membership_plan (
  code text PRIMARY KEY, name text NOT NULL, rank integer NOT NULL, price bigint NOT NULL,
  duration_days integer NOT NULL, credit_limit bigint NOT NULL DEFAULT 0, wholesale_access boolean NOT NULL DEFAULT true,
  entitlements jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS membership_payment (
  id text PRIMARY KEY, account_id text, user_id text NOT NULL, plan_code text NOT NULL, amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending', intent text NOT NULL DEFAULT 'purchase', provider text NOT NULL DEFAULT 'kolbe-gateway',
  provider_ref text, verified_at timestamptz, verification_source text, failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_payment_provider_ref ON membership_payment(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS membership_history (
  id text PRIMARY KEY, account_id text NOT NULL, action text NOT NULL, from_plan text, to_plan text,
  payment_id text, actor_id text, note text NOT NULL DEFAULT '', effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_label (
  id text PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, kind text NOT NULL DEFAULT 'manual',
  subject text NOT NULL DEFAULT 'buyer', rule jsonb, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_assignment (
  id text PRIMARY KEY, label_id text NOT NULL, subject_type text NOT NULL, subject_id text NOT NULL,
  source text NOT NULL DEFAULT 'manual', snapshot jsonb NOT NULL DEFAULT '{}', assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (label_id, subject_type, subject_id)
);
CREATE TABLE IF NOT EXISTS sms_campaign (
  id text PRIMARY KEY, name text NOT NULL, body text NOT NULL, label_code text NOT NULL, status text NOT NULL DEFAULT 'queued',
  actor_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sms_delivery (
  id text PRIMARY KEY, campaign_id text NOT NULL, subject_type text NOT NULL, subject_id text NOT NULL,
  phone text NOT NULL DEFAULT '', rendered text NOT NULL, status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_endpoint (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'n8n', url text NOT NULL, secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_delivery (
  id text PRIMARY KEY, endpoint_id text NOT NULL, event_id text, event_name text NOT NULL, status text NOT NULL,
  detail text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoice_template (
  id text PRIMARY KEY, code text NOT NULL, name text NOT NULL, kind text NOT NULL, version integer NOT NULL,
  body jsonb NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
CREATE TABLE IF NOT EXISTS invoice (
  id text PRIMARY KEY, number text NOT NULL UNIQUE, kind text NOT NULL, status text NOT NULL DEFAULT 'issued',
  owner_type text NOT NULL, owner_id text NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL,
  template_id text NOT NULL, template_version integer NOT NULL, template_snapshot jsonb NOT NULL, snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_reference ON invoice(kind, reference_type, reference_id);
CREATE TABLE IF NOT EXISTS invoice_file (
  id text PRIMARY KEY, invoice_id text NOT NULL UNIQUE, mime text NOT NULL DEFAULT 'application/pdf', bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_permission (
  id text PRIMARY KEY, actor_id text NOT NULL, code text NOT NULL, UNIQUE (actor_id, code)
);
CREATE TABLE IF NOT EXISTS document_counter (
  name text PRIMARY KEY, value integer NOT NULL
);
CREATE TABLE IF NOT EXISTS buyer_address (
  id text PRIMARY KEY, account_id text NOT NULL, label text NOT NULL DEFAULT 'اصلی',
  city text NOT NULL DEFAULT '', line text NOT NULL DEFAULT '', postal text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS buyer_favorite (
  id text PRIMARY KEY, account_id text NOT NULL, product_id text NOT NULL, name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (account_id, product_id)
);
CREATE TABLE IF NOT EXISTS buyer_restriction (
  id text PRIMARY KEY, account_id text NOT NULL, code text NOT NULL, active boolean NOT NULL DEFAULT true,
  reason text NOT NULL, note text NOT NULL DEFAULT '', until timestamptz, actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);
CREATE TABLE IF NOT EXISTS buyer_notification (
  id text PRIMARY KEY, account_id text NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commerce_signal (
  id text PRIMARY KEY, account_id text, user_id text, name text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_automation (
  id text PRIMARY KEY, name text NOT NULL, event_name text NOT NULL, label_code text,
  action text NOT NULL, config jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_note (
  id text PRIMARY KEY, subject_type text NOT NULL, subject_id text NOT NULL, kind text NOT NULL,
  body text NOT NULL, actor_id text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE support_ticket ADD COLUMN IF NOT EXISTS account_id text;
`;

export async function ensurePlatformSchema(client: PoolClient) {
  await client.query(SCHEMA);
  await seedPlatform(client);
}

async function seedPlatform(client: PoolClient) {
  await client.query(
    `INSERT INTO site_setting (setting_key, value) VALUES ('payment_gateway', $1::jsonb) ON CONFLICT (setting_key) DO NOTHING`,
    [JSON.stringify({ provider: "kolbe-gateway", secret: "kolbe-gateway-sandbox-secret", sandbox: true })],
  );
  const plans = [
    ["basic", "همکار", 1, 6_000_000, 365, 20_000_000],
    ["pro", "همکار حرفه‌ای", 2, 12_000_000, 365, 80_000_000],
    ["vip", "ویژه VIP", 3, 24_000_000, 365, 200_000_000],
  ] as const;
  for (const [code, name, rank, price, days, credit] of plans) {
    await client.query(
      `INSERT INTO membership_plan (code, name, rank, price, duration_days, credit_limit, wholesale_access, entitlements)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb) ON CONFLICT (code) DO NOTHING`,
      [code, name, rank, price, days, credit, JSON.stringify({ pricingAccess: true, wholesaleAccess: true })],
    );
  }
  const labels = [
    ["new_customer", "مشتری جدید", "buyer", { all: [{ metric: "account_age_days", op: "<=", value: 14 }] }],
    ["loyal", "مشتری وفادار", "buyer", { all: [{ metric: "order_count", op: ">=", value: 10 }] }],
    ["high_spender", "پرخرج", "buyer", { all: [{ metric: "spend_90d", op: ">=", value: 50_000_000 }] }],
    ["churn_risk", "در معرض ریزش", "buyer", { all: [{ metric: "days_since_order", op: ">=", value: 60 }, { metric: "order_count", op: ">=", value: 1 }] }],
    ["inactive", "کم‌فعال", "buyer", { all: [{ metric: "days_since_order", op: ">=", value: 90 }] }],
    ["no_recent_purchase", "بدون خرید اخیر", "buyer", { all: [{ metric: "days_since_order", op: ">=", value: 30 }] }],
    ["expiring", "عضویت رو به انقضا", "buyer", { all: [{ metric: "days_to_expiry", op: "<=", value: 7 }, { metric: "days_to_expiry", op: ">=", value: 0 }] }],
    ["vip", "VIP", "buyer", { all: [{ metric: "plan_rank", op: ">=", value: 3 }] }],
    ["wholesale_buyer", "خریدار عمده", "buyer", { all: [{ metric: "wholesale_access", op: "==", value: 1 }] }],
    ["failed_payment", "پرداخت ناموفق", "buyer", { all: [{ metric: "failed_payments", op: ">=", value: 1 }] }],
    ["upgraded", "Plan ارتقایافته", "buyer", { all: [{ metric: "upgrades", op: ">=", value: 1 }] }],
    ["active_member", "فعال", "buyer", { all: [{ metric: "membership_active", op: "==", value: 1 }] }],
    ["repeat_buyer", "خریدار تکراری", "buyer", { all: [{ metric: "order_count", op: ">=", value: 2 }] }],
    ["churned", "ریزش‌یافته", "buyer", { all: [{ metric: "days_since_order", op: ">=", value: 120 }, { metric: "order_count", op: ">=", value: 1 }] }],
    ["abandoned_cart", "سبد رهاشده", "buyer", { all: [{ metric: "abandoned_carts", op: ">=", value: 1 }] }],
    ["category_interest", "علاقه‌مند به دسته", "buyer", { all: [{ metric: "category_views", op: ">=", value: 3 }] }],
  ] as const;
  for (const [code, name, subject, rule] of labels) {
    await client.query(
      `INSERT INTO crm_label (id, code, name, kind, subject, rule) VALUES ($1,$2,$3,'rule',$4,$5::jsonb) ON CONFLICT (code) DO NOTHING`,
      [`lbl_${code}`, code, name, subject, JSON.stringify(rule)],
    );
  }
  await client.query(
    `INSERT INTO invoice_template (id, code, name, kind, version, body, active)
     VALUES ('itpl_official_v1','official','فاکتور رسمی','wholesale',1,$1::jsonb,true)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(defaultTemplate("فاکتور فروش"))],
  );
  await client.query(`INSERT INTO document_counter (name, value) VALUES ('invoice', 1000) ON CONFLICT (name) DO NOTHING`);
  await client.query(
    `INSERT INTO sms_campaign (id, name, body, label_code, status) VALUES ('camp_system','اتوماسیون سیستم','{{customer.name}}','expiring','system')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO crm_automation (id, name, event_name, label_code, action, config)
     VALUES ('auto_expiring_sms','یادآوری انقضای عضویت','membership.expiring','expiring','sms',$1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify({ body: "{{customer.name}} عزیز، عضویت {{plan.name}} تا {{days_to_expiry}} روز دیگر منقضی می‌شود." })],
  );
}

function defaultTemplate(title: string) {
  return {
    title,
    logoText: "کلبه وینتیج",
    show: ["seller", "buyer", "supplier", "items", "totals", "payment", "terms", "footer"],
    seller: { name: "کلبه وینتیج", address: "تهران", taxId: "14000000000" },
    terms: "این سند مالی مطابق اطلاعات زمان صدور صادر شده است.",
    footer: "{{seller.name}} · {{invoice.number}}",
    signature: "",
    stamp: "",
    columns: ["name", "sku", "variant", "quantity", "unitPrice", "total"],
  };
}

async function audit(actor: Actor, subjectType: string, subjectId: string, action: string, reason = "", note = "", payload: Json = {}) {
  await rows(
    `INSERT INTO audit_event (id, actor_id, actor_role, subject_type, subject_id, action, reason, note, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [makeId("aud"), actor?.sub ?? null, actor?.role ?? null, subjectType, subjectId, action, reason, note, JSON.stringify(payload)],
  );
}

export async function emitEvent(name: string, subjectType: string, subjectId: string, payload: Json = {}) {
  if (!CRM_EVENTS.includes(name as typeof CRM_EVENTS[number])) return;
  const id = makeId("evt");
  await rows(
    `INSERT INTO domain_event (id, name, subject_type, subject_id, payload) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [id, name, subjectType, subjectId, JSON.stringify(payload)],
  );
  try {
    const { enqueueOutbox } = await import("./operations-center");
    await enqueueOutbox({ eventId: id, eventType: name, entityType: subjectType, entityId: subjectId, data: payload });
  } catch (error) {
    console.error("outbox enqueue failed", error);
  }
  await runAutomations(name, subjectType, subjectId, payload);
}

async function runAutomations(eventName: string, subjectType: string, subjectId: string, payload: Json) {
  const rules = await rows<any>(`SELECT * FROM crm_automation WHERE active AND event_name=$1`, [eventName]);
  if (!rules.length) return;
  if (rules.some((rule) => rule.label_code)) await evaluateLabels();
  const accountId = subjectType === "buyer" ? subjectId : null;
  const [account] = accountId
    ? await rows<any>("SELECT id, member_name, phone, plan_name, expires_at FROM wholesale_account WHERE id=$1", [accountId])
    : [null];
  for (const rule of rules) {
    if (rule.label_code) {
      const [hit] = await rows(
        `SELECT 1 FROM crm_assignment s JOIN crm_label l ON l.id=s.label_id
         WHERE l.code=$1 AND s.subject_id=$2 LIMIT 1`,
        [rule.label_code, subjectId],
      );
      if (!hit) continue;
    }
    const days = account?.expires_at ? Math.max(0, Math.ceil((new Date(account.expires_at).getTime() - Date.now()) / 86400_000)) : "";
    const text = String(rule.config?.body ?? rule.name)
      .replaceAll("{{customer.name}}", account?.member_name || String(payload.name ?? ""))
      .replaceAll("{{plan.name}}", account?.plan_name || String(payload.planCode ?? ""))
      .replaceAll("{{days_to_expiry}}", String(days));
    if (rule.action === "sms" && account) {
      await rows(
        `INSERT INTO sms_delivery (id, campaign_id, subject_type, subject_id, phone, rendered) VALUES ($1,'camp_system','buyer',$2,$3,$4)`,
        [makeId("smd"), account.id, account.phone || "", text],
      );
    } else if (rule.action === "notification" && account) {
      await rows(`INSERT INTO buyer_notification (id, account_id, title, body) VALUES ($1,$2,$3,$4)`, [makeId("bnot"), account.id, rule.name, text]);
    } else if (rule.action === "note") {
      await rows(`INSERT INTO crm_note (id, subject_type, subject_id, kind, body) VALUES ($1,$2,$3,'automation',$4)`, [makeId("cnote"), subjectType, subjectId, text]);
    } else if (rule.action === "coupon") {
      const code = String(rule.config?.couponCode ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      if (code) await rows(`INSERT INTO crm_note (id, subject_type, subject_id, kind, body) VALUES ($1,$2,$3,'coupon',$4)`, [makeId("cnote"), subjectType, subjectId, code]);
    } else if (rule.action === "webhook") {
      await rows(`INSERT INTO crm_note (id, subject_type, subject_id, kind, body) VALUES ($1,$2,$3,'webhook',$4)`, [makeId("cnote"), subjectType, subjectId, "تحویل از مرکز اتصال انجام می‌شود"]);
    }
  }
}

async function requireAdmin(actor: Actor, permission: string) {
  if (!actor || actor.role !== "admin") throw new OpsError(401, "UNAUTHORIZED");
  const grants = await rows<{ code: string }>("SELECT code FROM staff_permission WHERE actor_id=$1", [actor.sub]);
  if (grants.length && !grants.some((grant) => grant.code === permission || grant.code === "*")) throw new OpsError(403, "FORBIDDEN");
  return actor;
}

function requireUser(actor: Actor) {
  if (!actor || !["customer", "vip", "admin", "supplier"].includes(actor.role)) throw new OpsError(401, "UNAUTHORIZED");
  return actor;
}

async function jsonBody(req: RequestLike): Promise<Json> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Json : {};
  } catch {
    return {};
  }
}

export async function assertSupplierAllowed(supplierId: string, capability: string, client?: PoolClient) {
  const query = client ? (sql: string, values: unknown[]) => client.query(sql, values).then((result) => result.rows) : (sql: string, values: unknown[]) => rows(sql, values);
  const [supplier] = await query("SELECT status, cooperation_status, cooperation_until, commission_rate FROM supplier WHERE id=$1", [supplierId]);
  if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
  const until = supplier.cooperation_until ? new Date(supplier.cooperation_until) : null;
  const expired = until ? until.getTime() <= Date.now() : false;
  const cooperation = expired && ["suspended", "limited"].includes(supplier.cooperation_status) ? "active" : supplier.cooperation_status;
  if (["blocked", "rejected", "suspended", "pending_review"].includes(cooperation) || !["approved", "active"].includes(supplier.status) && cooperation !== "active" && cooperation !== "limited") {
    if (["blocked", "rejected", "suspended", "pending_review"].includes(cooperation)) throw new OpsError(403, "SUPPLIER_RESTRICTED");
  }
  if (["blocked", "rejected", "suspended"].includes(cooperation)) throw new OpsError(403, "SUPPLIER_RESTRICTED");
  const [restriction] = await query(
    `SELECT * FROM supplier_restriction WHERE supplier_id=$1 AND code=$2 AND active AND (until IS NULL OR until > now())`,
    [supplierId, capability],
  );
  if (restriction) throw new OpsError(403, "SUPPLIER_RESTRICTED");
  if (capability === "create_product") {
    const [cap] = await query(
      `SELECT limit_value FROM supplier_restriction WHERE supplier_id=$1 AND code='product_cap' AND active AND (until IS NULL OR until > now())`,
      [supplierId],
    );
    if (cap?.limit_value != null) {
      const [count] = await query("SELECT count(*)::int AS count FROM supplier_product WHERE supplier_id=$1", [supplierId]);
      if (Number(count.count) >= Number(cap.limit_value)) throw new OpsError(403, "SUPPLIER_RESTRICTED");
    }
  }
  if (capability === "receive_order") {
    const [cap] = await query(
      `SELECT limit_value FROM supplier_restriction WHERE supplier_id=$1 AND code='sales_cap' AND active AND (until IS NULL OR until > now())`,
      [supplierId],
    );
    if (cap?.limit_value != null) {
      const [sum] = await query(
        `SELECT COALESCE(SUM(amount),0)::bigint AS total FROM ledger_entry
         WHERE party_type='supplier' AND party_id=$1 AND kind='sale' AND occurred_at >= date_trunc('month', now())`,
        [supplierId],
      );
      if (Number(sum.total) >= Number(cap.limit_value)) throw new OpsError(403, "SUPPLIER_RESTRICTED");
    }
  }
}

export async function assertBuyerAllowed(accountId: string, code: string, client?: PoolClient) {
  const query = client ? (sql: string, values: unknown[]) => client.query(sql, values).then((result) => result.rows) : (sql: string, values: unknown[]) => rows(sql, values);
  const [restriction] = await query(
    `SELECT id FROM buyer_restriction WHERE account_id=$1 AND code=$2 AND active AND (until IS NULL OR until > now())`,
    [accountId, code],
  );
  if (restriction) throw new OpsError(403, "BUYER_RESTRICTED");
}

export async function refreshMembershipLifecycle() {
  const expired = await rows<any>(
    `UPDATE wholesale_account SET status='expired', updated_at=now()
     WHERE status='approved' AND expires_at IS NOT NULL AND expires_at <= now()
     RETURNING id, user_id, plan_code`,
  );
  for (const account of expired) {
    await rows(`UPDATE account_user SET role='customer', updated_at=now() WHERE id=$1 AND role='vip'`, [account.user_id]);
    await emitEvent("membership.expired", "buyer", account.id, { planCode: account.plan_code });
  }
  const due = await rows<any>(
    `SELECT * FROM wholesale_account WHERE scheduled_plan_code IS NOT NULL AND scheduled_plan_at IS NOT NULL AND scheduled_plan_at <= now()`,
  );
  for (const account of due) {
    const plan = await planByCode(account.scheduled_plan_code);
    if (!plan) continue;
    await rows(
      `UPDATE wholesale_account SET plan_code=$2, plan_name=$3, credit_limit=$4, scheduled_plan_code=NULL, scheduled_plan_at=NULL, updated_at=now() WHERE id=$1`,
      [account.id, plan.code, plan.name, plan.credit_limit],
    );
    await rows(
      `INSERT INTO membership_history (id, account_id, action, from_plan, to_plan, note) VALUES ($1,$2,'downgrade',$3,$4,'applied at period end')`,
      [makeId("mhst"), account.id, account.plan_code, plan.code],
    );
  }
  const expiring = await rows<any>(
    `SELECT id, plan_code FROM wholesale_account
     WHERE status='approved' AND expires_at IS NOT NULL AND expires_at > now() AND expires_at <= now() + interval '7 days'`,
  );
  for (const account of expiring) {
    const [seen] = await rows(
      `SELECT 1 FROM domain_event WHERE name='membership.expiring' AND subject_id=$1 AND created_at > now() - interval '1 day' LIMIT 1`,
      [account.id],
    );
    if (!seen) await emitEvent("membership.expiring", "buyer", account.id, { planCode: account.plan_code });
  }
}

async function planByCode(code: string) {
  return (await rows<any>("SELECT * FROM membership_plan WHERE code=$1 AND active", [code]))[0] ?? null;
}

async function gatewayConfig() {
  const [row] = await rows<any>("SELECT value FROM site_setting WHERE setting_key='payment_gateway'");
  return row?.value ?? { provider: "kolbe-gateway", secret: "", sandbox: false };
}

export function signGatewayPayload(paymentId: string, providerRef: string, amount: number, secret: string) {
  return createHmac("sha256", secret).update(`${paymentId}|${providerRef}|${amount}`).digest("hex");
}

function signaturesMatch(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function syncSupplierLedger(supplierId: string) {
  const [supplier] = await rows<any>("SELECT commission_rate FROM supplier WHERE id=$1", [supplierId]);
  const rate = Number(supplier?.commission_rate ?? 8);
  await rows(
    `INSERT INTO ledger_entry (id, party_type, party_id, kind, amount, reference_type, reference_id, memo, occurred_at)
     SELECT 'ledsale_' || wi.id, 'supplier', p.supplier_id, 'sale', wi.quantity * wi.unit_price, 'wholesale_order_item', wi.id, wi.product_name, o.created_at
     FROM wholesale_order_item wi
     JOIN supplier_product p ON p.id = wi.product_id
     JOIN wholesale_order o ON o.id = wi.order_id
     WHERE p.supplier_id=$1
     ON CONFLICT (party_type, party_id, kind, reference_type, reference_id) DO NOTHING`,
    [supplierId],
  );
  await rows(
    `INSERT INTO ledger_entry (id, party_type, party_id, kind, amount, reference_type, reference_id, memo, occurred_at)
     SELECT 'ledfee_' || wi.id, 'supplier', p.supplier_id, 'fee', -ROUND(wi.quantity * wi.unit_price * $2 / 100.0), 'wholesale_order_item', wi.id, 'کارمزد کلبه', o.created_at
     FROM wholesale_order_item wi
     JOIN supplier_product p ON p.id = wi.product_id
     JOIN wholesale_order o ON o.id = wi.order_id
     WHERE p.supplier_id=$1
     ON CONFLICT (party_type, party_id, kind, reference_type, reference_id) DO NOTHING`,
    [supplierId, rate],
  );
}

async function financials(partyType: string, partyId: string) {
  if (partyType === "supplier") await syncSupplierLedger(partyId);
  const [row] = await rows<any>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE kind='sale'),0)::bigint AS sales,
       COALESCE(SUM(amount) FILTER (WHERE kind='sale' AND occurred_at >= date_trunc('month', now())),0)::bigint AS sales_month,
       COALESCE(SUM(amount) FILTER (WHERE kind='sale' AND occurred_at >= now() - interval '7 days'),0)::bigint AS sales_week,
       COALESCE(SUM(amount) FILTER (WHERE kind='fee'),0)::bigint AS fees,
       COALESCE(SUM(amount) FILTER (WHERE kind IN ('payout','withdrawal')),0)::bigint AS settled,
       COALESCE(SUM(amount) FILTER (WHERE kind='hold'),0)::bigint AS held,
       COALESCE(SUM(amount) FILTER (WHERE kind='refund'),0)::bigint AS refunds,
       COALESCE(SUM(amount) FILTER (WHERE kind='return'),0)::bigint AS returns,
       COALESCE(SUM(amount),0)::bigint AS balance
     FROM ledger_entry WHERE party_type=$1 AND party_id=$2`,
    [partyType, partyId],
  );
  const [pending] = await rows<any>(
    `SELECT COALESCE(SUM(amount),0)::bigint AS amount, count(*)::int AS count FROM withdrawal_request
     WHERE party_type=$1 AND party_id=$2 AND status='requested'`,
    [partyType, partyId],
  );
  const balance = Number(row.balance);
  return {
    salesTotal: Number(row.sales),
    salesMonth: Number(row.sales_month),
    salesWeek: Number(row.sales_week),
    payable: Math.max(balance, 0),
    pendingSettlement: Number(pending.amount),
    settled: Math.abs(Number(row.settled)),
    fees: Math.abs(Number(row.fees)),
    debt: balance < 0 ? Math.abs(balance) : 0,
    credit: balance > 0 ? balance : 0,
    held: Math.abs(Number(row.held)),
    refunds: Math.abs(Number(row.refunds)),
    returns: Math.abs(Number(row.returns)),
    withdrawals: Math.abs(Number(row.settled)),
    withdrawalRequests: Number(pending.count),
    balance,
  };
}

async function supplierPerformance(id: string) {
  const [row] = await rows<any>(
    `SELECT
      (SELECT count(*) FROM purchase_order WHERE supplier_id=$1)::int AS orders_total,
      (SELECT count(*) FROM purchase_order WHERE supplier_id=$1 AND status='delivered')::int AS orders_completed,
      (SELECT count(*) FROM purchase_order WHERE supplier_id=$1 AND status='cancelled')::int AS orders_cancelled,
      (SELECT COALESCE(AVG(EXTRACT(epoch FROM (shipped_at - created_at))/3600),0) FROM purchase_order WHERE supplier_id=$1 AND shipped_at IS NOT NULL) AS avg_prep_hours,
      (SELECT COALESCE(AVG(EXTRACT(epoch FROM (po.created_at - o.created_at))/3600),0) FROM purchase_order po JOIN wholesale_order o ON o.id=po.wholesale_order_id WHERE po.supplier_id=$1) AS avg_confirm_hours,
      (SELECT count(*) FROM ledger_entry WHERE party_type='supplier' AND party_id=$1 AND kind='return')::int AS returns,
      (SELECT count(*) FROM purchase_order WHERE supplier_id=$1 AND due_date IS NOT NULL AND ((shipped_at IS NOT NULL AND shipped_at > due_date) OR (shipped_at IS NULL AND due_date < now() AND status NOT IN ('delivered','cancelled'))))::int AS late_shipments,
      (SELECT count(*) FROM supplier_product WHERE supplier_id=$1 AND status='rejected')::int AS rejected_products,
      (SELECT count(*) FROM supplier_product WHERE supplier_id=$1)::int AS products_total,
      (SELECT count(*) FROM supplier_product WHERE supplier_id=$1 AND status='approved')::int AS approved_products,
      (SELECT count(*) FROM support_ticket WHERE supplier_id=$1)::int AS tickets`,
    [id],
  );
  const orders = Number(row.orders_total);
  const products = Number(row.products_total);
  return {
    ordersTotal: orders,
    ordersCompleted: Number(row.orders_completed),
    ordersCancelled: Number(row.orders_cancelled),
    avgPrepHours: Number(row.avg_prep_hours),
    avgConfirmHours: Number(row.avg_confirm_hours),
    lateShipments: Number(row.late_shipments),
    returnRate: orders ? Number(row.returns) / orders : 0,
    cancelRate: orders ? Number(row.orders_cancelled) / orders : 0,
    rejectedProducts: Number(row.rejected_products),
    approvalRate: products ? Number(row.approved_products) / products : 0,
    tickets: Number(row.tickets),
    slaViolations: Number(row.late_shipments),
    customerScore: null,
  };
}

async function timeline(subjectType: string, subjectId: string) {
  if (subjectType === "supplier") {
    return rows(
      `SELECT created_at, source, title, body FROM (
         SELECT created_at, 'audit' AS source, action AS title, COALESCE(NULLIF(note,''), reason) AS body FROM audit_event WHERE subject_type='supplier' AND subject_id=$1
         UNION ALL SELECT created_at, 'event', name, payload::text FROM domain_event WHERE subject_type='supplier' AND subject_id=$1
         UNION ALL SELECT created_at, 'status', to_status, reason FROM supplier_status_event WHERE supplier_id=$1
         UNION ALL SELECT created_at, 'order', order_code, status FROM purchase_order WHERE supplier_id=$1
         UNION ALL SELECT created_at, 'ticket', subject, status FROM support_ticket WHERE supplier_id=$1
         UNION ALL SELECT reviewed_at, 'product', name, COALESCE(status,'') || COALESCE(' — ' || rejection_reason, '') FROM supplier_product WHERE supplier_id=$1 AND reviewed_at IS NOT NULL
         UNION ALL SELECT created_at, 'document', title, status FROM party_document WHERE party_type='supplier' AND party_id=$1
         UNION ALL SELECT created_at, 'withdrawal', status, note FROM withdrawal_request WHERE party_type='supplier' AND party_id=$1
       ) events WHERE created_at IS NOT NULL ORDER BY created_at DESC LIMIT 80`,
      [subjectId],
    );
  }
  return rows(
    `SELECT created_at, source, title, body FROM (
       SELECT created_at, 'audit' AS source, action AS title, COALESCE(NULLIF(note,''), reason) AS body FROM audit_event WHERE subject_type='buyer' AND subject_id=$1
       UNION ALL SELECT created_at, 'event', name, payload::text FROM domain_event WHERE subject_type='buyer' AND subject_id=$1
       UNION ALL SELECT created_at, 'membership', action, COALESCE(to_plan,'') FROM membership_history WHERE account_id=$1
       UNION ALL SELECT created_at, 'payment', status, plan_code FROM membership_payment WHERE account_id=$1
       UNION ALL SELECT created_at, 'order', order_code, status FROM wholesale_order WHERE account_id=$1
       UNION ALL SELECT issued_at, 'invoice', number, status FROM invoice WHERE owner_type='buyer' AND owner_id=$1
     ) events WHERE created_at IS NOT NULL ORDER BY created_at DESC LIMIT 80`,
    [subjectId],
  );
}

async function supplier360(id: string) {
  const [supplier] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [id]);
  if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
  const [member] = await rows<any>(
    `SELECT u.email, u.display_name, u.phone AS user_phone FROM supplier_member m JOIN account_user u ON u.id=m.user_id WHERE m.supplier_id=$1 LIMIT 1`,
    [id],
  );
  const finance = await financials("supplier", id);
  const performance = await supplierPerformance(id);
  const restrictions = await rows("SELECT * FROM supplier_restriction WHERE supplier_id=$1 ORDER BY code", [id]);
  const documents = await rows("SELECT * FROM party_document WHERE party_type='supplier' AND party_id=$1 ORDER BY created_at DESC", [id]);
  const revisions = await rows("SELECT id, version, created_at, actor_id FROM supplier_profile_revision WHERE supplier_id=$1 ORDER BY version DESC", [id]);
  const products = await rows("SELECT id, name, sku, status, wholesale_price, updated_at FROM supplier_product WHERE supplier_id=$1 ORDER BY updated_at DESC LIMIT 20", [id]);
  const orders = await rows("SELECT id, order_code, status, total_amount, created_at, shipped_at FROM purchase_order WHERE supplier_id=$1 ORDER BY created_at DESC LIMIT 20", [id]);
  const tickets = await rows("SELECT id, subject, status, priority, created_at FROM support_ticket WHERE supplier_id=$1 ORDER BY created_at DESC LIMIT 20", [id]);
  const ledger = await rows("SELECT id, kind, amount, memo, reference_type, reference_id, occurred_at FROM ledger_entry WHERE party_type='supplier' AND party_id=$1 ORDER BY occurred_at DESC LIMIT 30", [id]);
  const withdrawals = await rows("SELECT * FROM withdrawal_request WHERE party_type='supplier' AND party_id=$1 ORDER BY created_at DESC LIMIT 20", [id]);
  const [inventory] = await rows<any>(
    `SELECT COALESCE(SUM(i.on_hand),0)::bigint AS on_hand, COALESCE(SUM(i.reserved),0)::bigint AS reserved
     FROM supplier_inventory i JOIN supplier_variant v ON v.id=i.variant_id JOIN supplier_product p ON p.id=v.product_id
     WHERE p.supplier_id=$1`,
    [id],
  );
  return {
    supplier: {
      ...supplier,
      cooperationLabel: STATUS_LABEL[supplier.cooperation_status] ?? supplier.cooperation_status,
      email: supplier.email || member?.email || null,
      responsibleName: supplier.responsible_name || member?.display_name || null,
    },
    finance,
    performance,
    restrictions,
    restrictionCatalog: RESTRICTION_CODES.map((code) => ({ code, label: RESTRICTION_LABEL[code] })),
    statusCatalog: SUPPLIER_STATUSES.map((code) => ({ code, label: STATUS_LABEL[code] })),
    documents,
    revisions,
    products,
    orders,
    tickets,
    ledger,
    withdrawals,
    inventory: { onHand: Number(inventory?.on_hand ?? 0), reserved: Number(inventory?.reserved ?? 0) },
    invoices: await rows("SELECT id, number, kind, status, issued_at, template_version FROM invoice WHERE owner_type='supplier' AND owner_id=$1 ORDER BY issued_at DESC LIMIT 20", [id]),
    violations: await rows("SELECT id, to_status, reason, note, actor_id, created_at FROM supplier_status_event WHERE supplier_id=$1 AND to_status IN ('limited','suspended','blocked','rejected') ORDER BY created_at DESC LIMIT 20", [id]),
    tenureDays: Math.max(0, Math.floor((Date.now() - new Date(supplier.started_at || supplier.created_at).getTime()) / 86400_000)),
    timeline: await timeline("supplier", id),
  };
}

async function buyer360(id: string) {
  const [account] = await rows<any>(
    `SELECT a.*, u.email AS user_email, u.display_name, u.phone AS user_phone, u.created_at AS user_created_at, u.role
     FROM wholesale_account a JOIN account_user u ON u.id=a.user_id WHERE a.id=$1`,
    [id],
  );
  if (!account) throw new OpsError(404, "ACCOUNT_NOT_FOUND");
  const finance = await financials("buyer", id);
  const payments = await rows("SELECT * FROM membership_payment WHERE account_id=$1 OR user_id=$2 ORDER BY created_at DESC", [id, account.user_id]);
  const history = await rows("SELECT * FROM membership_history WHERE account_id=$1 ORDER BY created_at DESC", [id]);
  const invoices = await rows("SELECT id, number, kind, status, issued_at FROM invoice WHERE owner_type='buyer' AND owner_id=$1 ORDER BY issued_at DESC", [id]);
  const orders = await rows("SELECT id, order_code, status, payment_status, total_amount, total_units, created_at FROM wholesale_order WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20", [id]);
  const retail = await rows(
    `SELECT id, order_code, total_amount, payment_status, created_at FROM retail_order WHERE phone=$1 OR email=$2 ORDER BY created_at DESC LIMIT 20`,
    [account.phone, account.user_email],
  );
  const documents = await rows("SELECT * FROM party_document WHERE party_type='buyer' AND party_id=$1 ORDER BY created_at DESC", [id]);
  const labels = await rows(
    `SELECT l.code, l.name, s.source, s.assigned_at FROM crm_assignment s JOIN crm_label l ON l.id=s.label_id
     WHERE s.subject_type='buyer' AND s.subject_id=$1`,
    [id],
  );
  const [stats] = await rows<any>(
    `SELECT count(*)::int AS orders, COALESCE(SUM(total_amount),0)::bigint AS spend, COALESCE(AVG(total_amount),0)::bigint AS average,
            MAX(created_at) AS last_order FROM wholesale_order WHERE account_id=$1`,
    [id],
  );
  return {
    account,
    stats,
    finance,
    payments,
    history,
    invoices,
    orders,
    retail,
    documents,
    labels,
    plans: await rows("SELECT code, name, rank, price, duration_days, credit_limit FROM membership_plan WHERE active ORDER BY rank"),
    messages: await rows(
      `SELECT d.id, d.rendered, d.status, d.phone, d.created_at, c.name AS campaign
       FROM sms_delivery d JOIN sms_campaign c ON c.id=d.campaign_id
       WHERE d.subject_id=$1 ORDER BY d.created_at DESC LIMIT 20`,
      [id],
    ),
    notifications: await rows("SELECT id, title, body, created_at FROM buyer_notification WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20", [id]),
    addresses: await rows("SELECT * FROM buyer_address WHERE account_id=$1 ORDER BY created_at DESC", [id]),
    favorites: await rows("SELECT product_id, name, created_at FROM buyer_favorite WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20", [id]),
    restrictions: await rows("SELECT code, active, reason, note, until FROM buyer_restriction WHERE account_id=$1 ORDER BY code", [id]),
    tickets: await rows("SELECT id, subject, status, priority, created_at FROM support_ticket WHERE account_id=$1 ORDER BY created_at DESC LIMIT 20", [id]),
    notes: await rows("SELECT id, kind, body, created_at FROM crm_note WHERE subject_type='buyer' AND subject_id=$1 ORDER BY created_at DESC LIMIT 20", [id]),
    paymentFailures: payments.filter((payment: any) => payment.status === "failed"),
    returns: await rows("SELECT id, amount, memo, occurred_at FROM ledger_entry WHERE party_type='buyer' AND party_id=$1 AND kind IN ('refund','return') ORDER BY occurred_at DESC LIMIT 20", [id]),
    cancels: orders.filter((order: any) => order.status === "cancelled"),
    retailCount: retail.length,
    tenureDays: Math.max(0, Math.floor((Date.now() - new Date(account.user_created_at).getTime()) / 86400_000)),
    restrictionCatalog: BUYER_RESTRICTIONS.map((code) => ({ code, label: code === "place_order" ? "عدم اجازه ثبت سفارش" : code === "wholesale_pricing" ? "عدم دسترسی به قیمت عمده" : "عدم ارسال پیام" })),
    timeline: await timeline("buyer", id),
  };
}

async function setSupplierStatus(actor: Actor, id: string, body: Json) {
  const status = String(body.status ?? "");
  const reason = String(body.reason ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (!SUPPLIER_STATUSES.includes(status as typeof SUPPLIER_STATUSES[number])) throw new OpsError(422, "INVALID_STATUS");
  if (!reason) throw new OpsError(422, "REASON_REQUIRED");
  const until = body.until ? new Date(String(body.until)) : null;
  if (body.until && Number.isNaN(until?.getTime())) throw new OpsError(422, "INVALID_INPUT");
  const [current] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [id]);
  if (!current) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
  const loginStatus = ["active", "limited"].includes(status) || (until && until.getTime() > Date.now() && status === "suspended") ? "approved" : status === "pending_review" ? "pending" : status;
  await rows(
    `UPDATE supplier SET cooperation_status=$2, cooperation_until=$3, status=$4, updated_at=now() WHERE id=$1`,
    [id, status, until, ["active", "limited"].includes(status) ? "approved" : loginStatus],
  );
  await rows(
    `INSERT INTO supplier_status_event (id, supplier_id, from_status, to_status, reason, note, until, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [makeId("ssts"), id, current.cooperation_status, status, reason, note, until, actor!.sub],
  );
  await audit(actor, "supplier", id, "status_changed", reason, note, { from: current.cooperation_status, to: status, until });
  await emitEvent("supplier.status_changed", "supplier", id, { from: current.cooperation_status, to: status, reason });
  return { status, label: STATUS_LABEL[status] };
}

async function setRestriction(actor: Actor, id: string, body: Json) {
  const code = String(body.code ?? "");
  if (!RESTRICTION_CODES.includes(code as typeof RESTRICTION_CODES[number])) throw new OpsError(422, "INVALID_RESTRICTION");
  const reason = String(body.reason ?? "").trim();
  if (!reason) throw new OpsError(422, "REASON_REQUIRED");
  const active = body.active !== false;
  const until = body.until ? new Date(String(body.until)) : null;
  if (body.until && Number.isNaN(until?.getTime())) throw new OpsError(422, "INVALID_INPUT");
  const limit = body.limit === undefined || body.limit === null || body.limit === "" ? null : Math.trunc(Number(body.limit));
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new OpsError(422, "INVALID_INPUT");
  const [supplier] = await rows("SELECT id FROM supplier WHERE id=$1", [id]);
  if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
  await rows(
    `INSERT INTO supplier_restriction (id, supplier_id, code, active, reason, note, until, limit_value, feature, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (supplier_id, code) DO UPDATE SET active=EXCLUDED.active, reason=EXCLUDED.reason, note=EXCLUDED.note,
       until=EXCLUDED.until, limit_value=EXCLUDED.limit_value, feature=EXCLUDED.feature, actor_id=EXCLUDED.actor_id, updated_at=now()`,
    [makeId("sres"), id, code, active, reason, String(body.note ?? ""), until, limit, body.feature ? String(body.feature) : null, actor!.sub],
  );
  await audit(actor, "supplier", id, active ? "restriction_applied" : "restriction_lifted", reason, String(body.note ?? ""), { code, until, limit });
  await emitEvent("restriction.applied", "supplier", id, { code, active, reason });
  return { code, active };
}

function readPath(source: Json, key: string) {
  return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Json)[part] : undefined, source);
}

function assertTemplateVariables(body: Json) {
  const text = JSON.stringify(body);
  const found = [...text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((match) => match[1]);
  const unknown = found.filter((key) => !INVOICE_VARIABLES.includes(key as typeof INVOICE_VARIABLES[number]));
  if (unknown.length || /\{\{[^}]*[()[\];]/.test(text)) throw new OpsError(422, "INVALID_TEMPLATE_VARIABLE");
}

function applyVariables(value: string, snapshot: Json) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    if (!INVOICE_VARIABLES.includes(key as typeof INVOICE_VARIABLES[number])) return "";
    const resolved = readPath(snapshot, key);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

async function nextInvoiceNumber() {
  const [row] = await rows<any>(
    `UPDATE document_counter SET value = value + 1 WHERE name='invoice' RETURNING value`,
  );
  return `INV-${row.value}`;
}

async function activeTemplate(kind: string) {
  const [exact] = await rows<any>(`SELECT * FROM invoice_template WHERE active AND kind=$1 ORDER BY version DESC LIMIT 1`, [kind]);
  if (exact) return exact;
  const [fallback] = await rows<any>(`SELECT * FROM invoice_template WHERE active ORDER BY version DESC LIMIT 1`);
  if (fallback) return fallback;
  const [anyTemplate] = await rows<any>(`SELECT * FROM invoice_template ORDER BY version DESC LIMIT 1`);
  if (!anyTemplate) throw new OpsError(422, "TEMPLATE_NOT_FOUND");
  return anyTemplate;
}

export async function issueInvoice(input: {
  kind: string;
  ownerType: string;
  ownerId: string;
  referenceType: string;
  referenceId: string;
  actorId?: string | null;
  customer?: Partial<InvoiceSnapshot["customer"]>;
  supplier?: Partial<InvoiceSnapshot["supplier"]>;
  items?: InvoiceSnapshot["items"];
  totals?: Partial<Pick<InvoiceSnapshot, "subtotal" | "discount" | "tax" | "shipping" | "total" | "paid" | "remaining">>;
  payment?: Partial<InvoiceSnapshot["payment"]>;
  orderReference?: string;
}) {
  if (!INVOICE_KINDS.includes(input.kind as typeof INVOICE_KINDS[number])) throw new OpsError(422, "INVALID_INVOICE_KIND");
  const [existing] = await rows<any>(
    "SELECT * FROM invoice WHERE kind=$1 AND reference_type=$2 AND reference_id=$3",
    [input.kind, input.referenceType, input.referenceId],
  );
  if (existing) return existing;
  const template = await activeTemplate(input.kind);
  const issued = new Date();
  const due = new Date(issued.getTime() + 7 * 86400_000);
  const totals = {
    subtotal: 0, discount: 0, tax: 0, shipping: 0, total: 0, paid: 0, remaining: 0,
    ...input.totals,
  };
  const snapshot: InvoiceSnapshot = {
    invoice: { number: "", date: toJalali(issued), dueDate: toJalali(due), kind: input.kind, status: "issued" },
    seller: template.body.seller ?? { name: "کلبه وینتیج", address: "", taxId: "" },
    customer: { name: input.customer?.name || "—", phone: input.customer?.phone || "—", address: input.customer?.address || "—", email: input.customer?.email || "" },
    supplier: { name: input.supplier?.name || "", phone: input.supplier?.phone || "", city: input.supplier?.city || "" },
    order: { reference: input.orderReference || input.referenceId },
    payment: { method: input.payment?.method || "gateway", reference: input.payment?.reference || "" },
    ...totals,
    items: input.items ?? [],
    templateVersion: template.version,
    terms: template.body.terms || "",
    footer: template.body.footer || "",
    layout: {
      show: Array.isArray(template.body.show) ? template.body.show : undefined,
      signature: template.body.signature || "",
      stamp: template.body.stamp || "",
      logoText: template.body.logoText || "",
    },
  };
  snapshot.invoice.number = await nextInvoiceNumber();
  snapshot.terms = applyVariables(snapshot.terms || "", snapshot as unknown as Json);
  snapshot.footer = applyVariables(snapshot.footer || "", snapshot as unknown as Json);
  const title = applyVariables(String(template.body.title || "فاکتور"), snapshot as unknown as Json);
  const pdf = await renderInvoicePdf(snapshot, title);
  const id = makeId("inv");
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO invoice (id, number, kind, status, owner_type, owner_id, reference_type, reference_id, template_id, template_version, template_snapshot, snapshot, due_at)
       VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [id, snapshot.invoice.number, input.kind, input.ownerType, input.ownerId, input.referenceType, input.referenceId, template.id, template.version, JSON.stringify(template.body), JSON.stringify(snapshot), due],
    );
    await client.query(`INSERT INTO invoice_file (id, invoice_id, bytes) VALUES ($1,$2,$3)`, [makeId("ifile"), id, pdf]);
  });
  await emitEvent("invoice.issued", input.ownerType, input.ownerId, { invoiceId: id, number: snapshot.invoice.number, kind: input.kind });
  return (await rows<any>("SELECT * FROM invoice WHERE id=$1", [id]))[0];
}

async function renderStoredInvoice(invoiceId: string) {
  const [invoice] = await rows<any>("SELECT * FROM invoice WHERE id=$1", [invoiceId]);
  if (!invoice) throw new OpsError(404, "INVOICE_NOT_FOUND");
  const snapshot = invoice.snapshot as InvoiceSnapshot;
  const title = applyVariables(String(invoice.template_snapshot?.title || "فاکتور"), snapshot as unknown as Json);
  const pdf = await renderInvoicePdf(snapshot, title);
  await rows(`INSERT INTO invoice_file (id, invoice_id, bytes) VALUES ($1,$2,$3) ON CONFLICT (invoice_id) DO UPDATE SET bytes=EXCLUDED.bytes, created_at=now()`, [makeId("ifile"), invoice.id, pdf]);
  return pdf;
}

export async function syncOrderPaid(orderId: string) {
  const [order] = await rows<any>(
    `SELECT o.*, a.member_name, a.phone, a.city, a.address, a.id AS buyer_id FROM wholesale_order o JOIN wholesale_account a ON a.id=o.account_id WHERE o.id=$1`,
    [orderId],
  );
  if (!order || order.payment_status !== "paid") return null;
  const items = await rows<any>(
    `SELECT wi.*, p.supplier_id, s.display_name AS supplier_name, s.city AS supplier_city FROM wholesale_order_item wi
     LEFT JOIN supplier_product p ON p.id=wi.product_id LEFT JOIN supplier s ON s.id=p.supplier_id WHERE wi.order_id=$1`,
    [orderId],
  );
  const supplierIds = [...new Set(items.map((item) => item.supplier_id).filter(Boolean))];
  for (const supplierId of supplierIds) await syncSupplierLedger(supplierId);
  await emitEvent("order.paid", "buyer", order.buyer_id, { orderId, orderCode: order.order_code });
  return issueInvoice({
    kind: "wholesale",
    ownerType: "buyer",
    ownerId: order.buyer_id,
    referenceType: "wholesale_order",
    referenceId: order.id,
    customer: { name: order.member_name, phone: order.phone, address: order.address || order.city },
    supplier: { name: items[0]?.supplier_name || "", city: items[0]?.supplier_city || "" },
    orderReference: order.order_code,
    payment: { method: "wholesale", reference: order.order_code },
    items: items.map((item) => ({
      name: item.product_name, sku: item.sku, variant: [item.color, item.size].filter(Boolean).join(" / "),
      quantity: item.quantity, unitPrice: Number(item.unit_price), discount: 0, total: item.quantity * Number(item.unit_price),
    })),
    totals: {
      subtotal: Number(order.total_amount), discount: 0, tax: 0, shipping: 0,
      total: Number(order.total_amount), paid: Number(order.total_amount), remaining: 0,
    },
  });
}

async function checkoutMembership(actor: Actor, body: Json) {
  const user = requireUser(actor);
  if (!["customer", "vip"].includes(user.role)) throw new OpsError(401, "UNAUTHORIZED");
  const plan = await planByCode(String(body.planCode ?? ""));
  if (!plan) throw new OpsError(422, "INVALID_PLAN");
  if (!body.storeName?.trim() || !body.phone?.trim() || !body.city?.trim()) throw new OpsError(422, "INVALID_INPUT");
  const [existing] = await rows<any>("SELECT * FROM wholesale_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [user.sub]);
  const account = existing ?? (await rows<any>(
    `INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, plan_name, plan_code, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *`,
    [makeId("wacc"), user.sub, body.memberName?.trim() || body.storeName.trim(), body.storeName.trim(), body.phone.trim(), body.city.trim(), plan.name, plan.code],
  ))[0];
  if (existing) {
    await rows(
      `UPDATE wholesale_account SET member_name=$2, store_name=$3, phone=$4, city=$5, updated_at=now() WHERE id=$1`,
      [account.id, body.memberName?.trim() || existing.member_name, body.storeName.trim(), body.phone.trim(), body.city.trim()],
    );
  }
  const current = existing && existing.status === "approved" ? await planByCode(existing.plan_code || "basic") : null;
  const currentRank = current ? Number(current.rank) : 0;
  const intent = currentRank === 0 ? "purchase" : Number(plan.rank) > currentRank ? "upgrade" : Number(plan.rank) < currentRank ? "downgrade" : "renew";
  const paymentId = makeId("mpay");
  await rows(
    `INSERT INTO membership_payment (id, account_id, user_id, plan_code, amount, status, intent, provider)
     VALUES ($1,$2,$3,$4,$5,'pending',$6,'kolbe-gateway')`,
    [paymentId, account.id, user.sub, plan.code, plan.price, intent],
  );
  return { paymentId, status: "pending", amount: Number(plan.price), intent, planCode: plan.code, activated: false };
}

async function confirmGatewayPayment(body: Json, source: string) {
  const paymentId = String(body.paymentId ?? "");
  const providerRef = String(body.providerRef ?? "").trim();
  const signature = String(body.signature ?? "");
  if (!paymentId || !providerRef || !signature) throw new OpsError(422, "PAYMENT_NOT_VERIFIED");
  if ("success" in body && Object.keys(body).every((key) => ["success", "paymentId"].includes(key))) throw new OpsError(422, "PAYMENT_NOT_VERIFIED");
  const [payment] = await rows<any>("SELECT * FROM membership_payment WHERE id=$1", [paymentId]);
  if (!payment) throw new OpsError(404, "PAYMENT_NOT_FOUND");
  if (payment.status === "confirmed") return { status: "confirmed", replay: true, accountId: payment.account_id };
  const config = await gatewayConfig();
  const expected = signGatewayPayload(payment.id, providerRef, Number(payment.amount), String(config.secret ?? ""));
  if (!signaturesMatch(signature, expected)) throw new OpsError(422, "PAYMENT_NOT_VERIFIED");
  return transaction(async (client) => {
    const locked = (await client.query<any>("SELECT * FROM membership_payment WHERE id=$1 FOR UPDATE", [paymentId])).rows[0];
    if (locked.status === "confirmed") return { status: "confirmed", replay: true, accountId: locked.account_id };
    const plan = (await client.query<any>("SELECT * FROM membership_plan WHERE code=$1", [locked.plan_code])).rows[0];
    const account = (await client.query<any>("SELECT * FROM wholesale_account WHERE id=$1 FOR UPDATE", [locked.account_id])).rows[0];
    if (!plan || !account) throw new OpsError(422, "INVALID_PLAN");
    const current = account.status === "approved" ? (await client.query<any>("SELECT * FROM membership_plan WHERE code=$1", [account.plan_code])).rows[0] : null;
    const intent = locked.intent;
    let expires = account.expires_at ? new Date(account.expires_at) : new Date();
    if (intent === "renew" && expires.getTime() > Date.now()) expires = new Date(expires.getTime() + plan.duration_days * 86400_000);
    else if (intent !== "downgrade") expires = new Date(Date.now() + plan.duration_days * 86400_000);
    if (intent === "downgrade") {
      await client.query(
        `UPDATE wholesale_account SET scheduled_plan_code=$2, scheduled_plan_at=COALESCE(expires_at, now()), updated_at=now() WHERE id=$1`,
        [account.id, plan.code],
      );
    } else {
      await client.query(
        `UPDATE wholesale_account SET status='approved', plan_code=$2, plan_name=$3, credit_limit=$4, activated_at=COALESCE(activated_at, now()), expires_at=$5, updated_at=now() WHERE id=$1`,
        [account.id, plan.code, plan.name, plan.credit_limit, expires],
      );
      await client.query(`UPDATE account_user SET role='vip', updated_at=now() WHERE id=$1`, [account.user_id]);
    }
    await client.query(
      `UPDATE membership_payment SET status='confirmed', provider_ref=$2, verified_at=now(), verification_source=$3, updated_at=now() WHERE id=$1`,
      [locked.id, providerRef, source],
    );
    await client.query(
      `INSERT INTO membership_history (id, account_id, action, from_plan, to_plan, payment_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [makeId("mhst"), account.id, intent, current?.code ?? null, plan.code, locked.id, source],
    );
    await client.query(
      `INSERT INTO ledger_entry (id, party_type, party_id, kind, amount, reference_type, reference_id, memo)
       VALUES ($1,'buyer',$2,'payment',$3,'membership_payment',$4,$5)
       ON CONFLICT (party_type, party_id, kind, reference_type, reference_id) DO NOTHING`,
      [makeId("led"), account.id, -Number(plan.price), locked.id, plan.name],
    );
    return { status: "confirmed", replay: false, accountId: account.id, plan, account, payment: locked, intent };
  }).then(async (result) => {
    if (!result.replay && result.plan) {
      await issueInvoice({
        kind: "vip",
        ownerType: "buyer",
        ownerId: result.accountId,
        referenceType: "membership_payment",
        referenceId: paymentId,
        customer: { name: result.account.member_name, phone: result.account.phone, address: result.account.address || result.account.city },
        orderReference: paymentId,
        payment: { method: "gateway", reference: providerRef },
        items: [{ name: result.plan.name, sku: result.plan.code, variant: result.intent, quantity: 1, unitPrice: Number(result.plan.price), discount: 0, total: Number(result.plan.price) }],
        totals: { subtotal: Number(result.plan.price), total: Number(result.plan.price), paid: Number(result.plan.price), remaining: 0, discount: 0, tax: 0, shipping: 0 },
      });
      await emitEvent("membership.activated", "buyer", result.accountId, { planCode: result.plan.code, intent: result.intent, paymentId });
      await evaluateLabels();
    }
    return { status: "confirmed", accountId: result.accountId, activated: true };
  });
}

function compareRule(actual: number, op: string, expected: number) {
  if (Number.isNaN(actual)) return false;
  if (op === ">=") return actual >= expected;
  if (op === "<=") return actual <= expected;
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  throw new OpsError(422, "INVALID_RULE");
}

function ruleMatches(rule: Json, metrics: Record<string, number>) {
  const check = (cond: Json) => compareRule(Number(metrics[cond.metric]), String(cond.op), Number(cond.value));
  const all = Array.isArray(rule.all) ? rule.all.every(check) : true;
  const any = Array.isArray(rule.any) ? rule.any.some(check) : true;
  return all && any;
}

export async function evaluateLabels() {
  const buyers = await rows<any>(
    `SELECT a.id, a.member_name, a.phone, a.plan_code, a.status, a.expires_at, a.created_at,
      COALESCE(p.rank,0)::int AS plan_rank,
      CASE WHEN a.status='approved' AND (a.expires_at IS NULL OR a.expires_at > now()) THEN 1 ELSE 0 END AS membership_active,
      CASE WHEN a.status='approved' THEN 1 ELSE 0 END AS wholesale_access,
      (SELECT count(*) FROM wholesale_order o WHERE o.account_id=a.id)::int AS order_count,
      (SELECT COALESCE(SUM(total_amount),0) FROM wholesale_order o WHERE o.account_id=a.id AND o.created_at > now() - interval '90 days')::bigint AS spend_90d,
      (SELECT EXTRACT(day FROM now() - MAX(o.created_at)) FROM wholesale_order o WHERE o.account_id=a.id) AS days_since_order,
      EXTRACT(day FROM a.expires_at - now()) AS days_to_expiry,
      EXTRACT(day FROM now() - a.created_at) AS account_age_days,
      (SELECT count(*) FROM membership_payment mp WHERE mp.account_id=a.id AND mp.status='failed')::int AS failed_payments,
      (SELECT count(*) FROM membership_history h WHERE h.account_id=a.id AND h.action='upgrade')::int AS upgrades,
      (SELECT count(*) FROM commerce_signal cs WHERE cs.account_id=a.id AND cs.name='cart.abandoned' AND cs.created_at > now() - interval '14 days')::int AS abandoned_carts,
      (SELECT count(*) FROM commerce_signal cs WHERE cs.account_id=a.id AND cs.name='product.viewed' AND cs.created_at > now() - interval '30 days')::int AS category_views
     FROM wholesale_account a LEFT JOIN membership_plan p ON p.code=a.plan_code`,
  );
  const labels = await rows<any>("SELECT * FROM crm_label WHERE active AND kind='rule'");
  let assigned = 0;
  for (const label of labels) {
    await rows(`DELETE FROM crm_assignment WHERE label_id=$1 AND source='rule'`, [label.id]);
    for (const buyer of buyers) {
      const metrics = {
        order_count: Number(buyer.order_count),
        spend_90d: Number(buyer.spend_90d),
        days_since_order: buyer.days_since_order === null ? Number.NaN : Number(buyer.days_since_order),
        days_to_expiry: buyer.days_to_expiry === null ? Number.NaN : Number(buyer.days_to_expiry),
        account_age_days: Number(buyer.account_age_days),
        plan_rank: Number(buyer.plan_rank),
        wholesale_access: Number(buyer.wholesale_access),
        failed_payments: Number(buyer.failed_payments),
        upgrades: Number(buyer.upgrades),
        membership_active: Number(buyer.membership_active),
        abandoned_carts: Number(buyer.abandoned_carts),
        category_views: Number(buyer.category_views),
      };
      if (!ruleMatches(label.rule ?? {}, metrics)) continue;
      await rows(
        `INSERT INTO crm_assignment (id, label_id, subject_type, subject_id, source, snapshot)
         VALUES ($1,$2,'buyer',$3,'rule',$4::jsonb) ON CONFLICT (label_id, subject_type, subject_id) DO NOTHING`,
        [makeId("casg"), label.id, buyer.id, JSON.stringify({ name: buyer.member_name, phone: buyer.phone, plan: buyer.plan_code })],
      );
      assigned += 1;
    }
  }
  return { assigned, buyers: buyers.length };
}

async function canReadInvoice(actor: Actor, invoice: any) {
  if (!actor) throw new OpsError(401, "UNAUTHORIZED");
  if (actor.role === "admin") return;
  if (invoice.owner_type === "buyer") {
    const [account] = await rows("SELECT id FROM wholesale_account WHERE id=$1 AND user_id=$2", [invoice.owner_id, actor.sub]);
    if (account) return;
  }
  if (invoice.owner_type === "supplier") {
    const [member] = await rows("SELECT id FROM supplier_member WHERE supplier_id=$1 AND user_id=$2", [invoice.owner_id, actor.sub]);
    if (member) return;
  }
  if (invoice.owner_type === "customer" && invoice.owner_id === actor.sub) return;
  throw new OpsError(403, "FORBIDDEN");
}

function transitionAllowed(from: string, to: string) {
  const next: Record<string, string[]> = {
    draft: ["issued", "void"],
    issued: ["partially_paid", "paid", "cancelled", "void", "refunded"],
    partially_paid: ["paid", "refunded", "cancelled"],
    paid: ["refunded"],
    cancelled: [],
    refunded: [],
    void: [],
  };
  return next[from]?.includes(to) ?? false;
}

async function issueRetailInvoice(order: any, actorId?: string) {
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const shipping = Number(order.shipping_price || 0);
  const total = Number(order.total_amount || 0);
  return issueInvoice({
    kind: "retail",
    ownerType: "customer",
    ownerId: order.email || order.phone,
    referenceType: "retail_order",
    referenceId: order.id,
    actorId,
    customer: { name: order.customer_name, phone: order.phone, email: order.email || "", address: order.address?.line1 || order.address?.city || "—" },
    orderReference: order.order_code,
    payment: { method: order.pay_method, reference: order.order_code },
    items: lines.map((line: any) => ({
      name: String(line.name || "کالا"),
      sku: String(line.id || ""),
      variant: [line.colour, line.size].filter(Boolean).join(" / "),
      quantity: Number(line.qty || 1),
      unitPrice: Number(line.price || 0),
      discount: 0,
      total: Number(line.price || 0) * Number(line.qty || 1),
    })),
    totals: { subtotal: total - shipping, discount: 0, tax: 0, shipping, total, paid: total, remaining: 0 },
  });
}

export async function markRetailPaid(reference: string, actorId: string) {
  const [order] = await rows<any>("SELECT * FROM retail_order WHERE id=$1 OR order_code=$1", [reference]);
  if (!order) throw new OpsError(404, "ORDER_NOT_FOUND");
  if (order.payment_status !== "paid") {
    await rows(`UPDATE retail_order SET payment_status='paid', updated_at=now() WHERE id=$1`, [order.id]);
  }
  await emitEvent("order.paid", "customer", order.email || order.phone, { orderId: order.id, orderCode: order.order_code });
  await emitEvent("payment.completed", "customer", order.email || order.phone, { orderId: order.id, orderCode: order.order_code, amount: Number(order.total_amount) });
  return issueRetailInvoice({ ...order, payment_status: "paid" }, actorId);
}

export async function completeSettlement(supplierId: string, amount: number, actorId: string) {
  const [supplier] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [supplierId]);
  if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
  if (!Number.isInteger(amount) || amount <= 0) throw new OpsError(422, "INVALID_INPUT");
  const referenceId = makeId("setl");
  await rows(
    `INSERT INTO ledger_entry (id, party_type, party_id, kind, amount, reference_type, reference_id, memo)
     VALUES ($1,'supplier',$2,'payout',$3,'settlement',$4,'تسویه تکمیل‌شده')`,
    [referenceId, supplierId, -amount, referenceId],
  );
  await emitEvent("settlement.paid", "supplier", supplierId, { referenceId, amount });
  await emitEvent("withdrawal.paid", "supplier", supplierId, { referenceId, amount });
  return issueInvoice({
    kind: "settlement",
    ownerType: "supplier",
    ownerId: supplier.id,
    referenceType: "settlement",
    referenceId,
    actorId,
    supplier: { name: supplier.display_name, phone: supplier.phone, city: supplier.city },
    customer: { name: "کلبه وینتیج", phone: "—", address: "تهران" },
    items: [{ name: "صورت‌حساب تسویه", sku: "SETTLEMENT", variant: "", quantity: 1, unitPrice: amount, discount: 0, total: amount }],
    totals: { subtotal: amount, discount: 0, tax: 0, shipping: 0, total: amount, paid: amount, remaining: 0 },
  });
}

export function isPlatformPath(path: string) {
  return path === "payments/gateway/verify"
    || path === "membership/checkout"
    || path.startsWith("membership/payments/")
    || path === "supplier/wallet"
    || path === "supplier/wallet/withdraw"
    || path === "crm/events"
    || /^admin\/suppliers\/[^/]+\/(360|profile|status|restrictions|documents|commission)$/.test(path)
    || path === "admin/buyers"
    || /^admin\/buyers\/[^/]+\/(360|status|plan|credit|note|restrictions|addresses|documents|favorites)$/.test(path)
    || path === "wholesale/favorites"
    || path.startsWith("admin/crm/")
    || path === "admin/integrations" || path.startsWith("admin/integrations/")
    || /^admin\/membership\/payments\/[^/]+\/(verify-sandbox|refund)$/.test(path)
    || path === "admin/settlements/complete"
    || /^admin\/retail-orders\/[^/]+\/mark-paid$/.test(path)
    || path.startsWith("admin/invoice")
    || path.startsWith("invoices/");
}

export async function handlePlatformRequest(req: RequestLike, path: string, actor: Actor): Promise<{ status: number; data: unknown } | Response | null> {
  const method = req.method;
  if (path === "payments/gateway/verify" && method === "POST") {
    return { status: 200, data: await confirmGatewayPayment(await jsonBody(req), "gateway") };
  }
  if (path === "membership/checkout" && method === "POST") {
    return { status: 201, data: await checkoutMembership(actor, await jsonBody(req)) };
  }
  const complete = path.match(/^membership\/payments\/([^/]+)\/complete$/);
  if (complete && method === "POST") {
    await jsonBody(req);
    const [payment] = await rows<any>("SELECT id, status, account_id FROM membership_payment WHERE id=$1 AND user_id=$2", [complete[1], actor?.sub ?? ""]);
    if (!payment) throw new OpsError(404, "PAYMENT_NOT_FOUND");
    throw new OpsError(422, "PAYMENT_NOT_VERIFIED");
  }
  const paymentView = path.match(/^membership\/payments\/([^/]+)$/);
  if (paymentView && method === "GET") {
    requireUser(actor);
    const [payment] = await rows("SELECT id, status, amount, plan_code, intent, created_at FROM membership_payment WHERE id=$1 AND user_id=$2", [paymentView[1], actor!.sub]);
    if (!payment) throw new OpsError(404, "PAYMENT_NOT_FOUND");
    return { status: 200, data: { payment, activated: false } };
  }
  if (path === "crm/events" && method === "POST") {
    const user = requireUser(actor);
    const body = await jsonBody(req);
    const name = String(body.name ?? "");
    if (!CRM_EVENTS.includes(name as typeof CRM_EVENTS[number])) throw new OpsError(422, "INVALID_EVENT");
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const [account] = await rows<any>("SELECT id FROM wholesale_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [user.sub]);
    if (["cart.abandoned", "product.viewed", "coupon.used"].includes(name)) {
      await rows(
        `INSERT INTO commerce_signal (id, account_id, user_id, name, payload) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [makeId("sig"), account?.id ?? null, user.sub, name, JSON.stringify(payload)],
      );
    }
    await emitEvent(name, account ? "buyer" : "customer", account?.id ?? user.sub, payload);
    if (name === "product.viewed" && payload.favorite && account && payload.productId) {
      await rows(
        `INSERT INTO buyer_favorite (id, account_id, product_id, name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_id, product_id) DO NOTHING`,
        [makeId("fav"), account.id, String(payload.productId), String(payload.name ?? "")],
      );
    }
    return { status: 202, data: { accepted: true } };
  }
  if (path === "wholesale/favorites" && method === "POST") {
    const user = requireUser(actor);
    const body = await jsonBody(req);
    const [account] = await rows<any>("SELECT id FROM wholesale_account WHERE user_id=$1 AND status='approved' ORDER BY created_at DESC LIMIT 1", [user.sub]);
    if (!account || !body.productId) throw new OpsError(422, "INVALID_INPUT");
    await rows(
      `INSERT INTO buyer_favorite (id, account_id, product_id, name) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id, product_id) DO NOTHING`,
      [makeId("fav"), account.id, String(body.productId), String(body.name ?? "")],
    );
    return { status: 201, data: { saved: true } };
  }
  if (path === "supplier/wallet" && method === "GET") {
    if (!actor || actor.role !== "supplier") throw new OpsError(401, "UNAUTHORIZED");
    const [member] = await rows<any>("SELECT supplier_id FROM supplier_member WHERE user_id=$1", [actor.sub]);
    if (!member) throw new OpsError(403, "SUPPLIER_ACCESS_INACTIVE");
    return { status: 200, data: { finance: await financials("supplier", member.supplier_id), withdrawals: await rows("SELECT * FROM withdrawal_request WHERE party_id=$1 ORDER BY created_at DESC", [member.supplier_id]) } };
  }
  if (path === "supplier/wallet/withdraw" && method === "POST") {
    if (!actor || actor.role !== "supplier") throw new OpsError(401, "UNAUTHORIZED");
    const [member] = await rows<any>("SELECT supplier_id FROM supplier_member WHERE user_id=$1", [actor.sub]);
    if (!member) throw new OpsError(403, "SUPPLIER_ACCESS_INACTIVE");
    await assertSupplierAllowed(member.supplier_id, "wallet_withdraw");
    await assertSupplierAllowed(member.supplier_id, "settlement_request");
    const body = await jsonBody(req);
    const amount = Math.trunc(Number(body.amount));
    if (!Number.isInteger(amount) || amount <= 0) throw new OpsError(422, "INVALID_INPUT");
    const finance = await financials("supplier", member.supplier_id);
    if (finance.payable < amount) throw new OpsError(422, "INSUFFICIENT_BALANCE");
    const id = makeId("wd");
    await rows(`INSERT INTO withdrawal_request (id, party_type, party_id, amount, note, actor_id) VALUES ($1,'supplier',$2,$3,$4,$5)`, [id, member.supplier_id, amount, String(body.note ?? ""), actor.sub]);
    await emitEvent("withdrawal.requested", "supplier", member.supplier_id, { id, amount });
    return { status: 201, data: { id, status: "requested" } };
  }

  const supplier360Path = path.match(/^admin\/suppliers\/([^/]+)\/360$/);
  if (supplier360Path && method === "GET") {
    await requireAdmin(actor, "supplier.read");
    return { status: 200, data: await supplier360(supplier360Path[1]) };
  }
  const supplierProfile = path.match(/^admin\/suppliers\/([^/]+)\/profile$/);
  if (supplierProfile && method === "POST") {
    const admin = await requireAdmin(actor, "supplier.profile");
    const body = await jsonBody(req);
    const [current] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [supplierProfile[1]]);
    if (!current) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
    await rows(
      `INSERT INTO supplier_profile_revision (id, supplier_id, version, snapshot, actor_id) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [makeId("srev"), current.id, current.profile_version, JSON.stringify(current), admin.sub],
    );
    await rows(
      `UPDATE supplier SET display_name=COALESCE(NULLIF($2,''), display_name), legal_name=COALESCE(NULLIF($3,''), legal_name),
        responsible_name=$4, phone=COALESCE(NULLIF($5,''), phone), email=$6, city=COALESCE(NULLIF($7,''), city), address=$8,
        cooperation_type=COALESCE(NULLIF($9,''), cooperation_type), verification_status=COALESCE(NULLIF($10,''), verification_status),
        profile_version=profile_version+1, updated_at=now() WHERE id=$1`,
      [current.id, body.displayName, body.legalName, body.responsibleName ?? current.responsible_name, body.phone, body.email ?? current.email, body.city, body.address ?? current.address, body.cooperationType, body.verificationStatus],
    );
    await audit(admin, "supplier", current.id, "profile_updated", String(body.reason ?? "ویرایش پرونده"), String(body.note ?? ""));
    return { status: 200, data: { version: current.profile_version + 1 } };
  }
  const supplierStatus = path.match(/^admin\/suppliers\/([^/]+)\/status$/);
  if (supplierStatus && method === "POST") {
    const admin = await requireAdmin(actor, "supplier.status");
    return { status: 200, data: await setSupplierStatus(admin, supplierStatus[1], await jsonBody(req)) };
  }
  const supplierRestriction = path.match(/^admin\/suppliers\/([^/]+)\/restrictions$/);
  if (supplierRestriction && method === "POST") {
    const admin = await requireAdmin(actor, "supplier.restrict");
    return { status: 200, data: await setRestriction(admin, supplierRestriction[1], await jsonBody(req)) };
  }
  const supplierDocument = path.match(/^admin\/suppliers\/([^/]+)\/documents$/);
  if (supplierDocument && method === "POST") {
    const admin = await requireAdmin(actor, "supplier.profile");
    const body = await jsonBody(req);
    if (!body.title?.trim()) throw new OpsError(422, "INVALID_INPUT");
    const id = makeId("doc");
    await rows(
      `INSERT INTO party_document (id, party_type, party_id, title, status, note, reviewer_id, reviewed_at)
       VALUES ($1,'supplier',$2,$3,$4,$5,$6,CASE WHEN $4='verified' THEN now() ELSE NULL END)`,
      [id, supplierDocument[1], body.title.trim(), ["pending", "verified", "rejected"].includes(body.status) ? body.status : "pending", String(body.note ?? ""), admin.sub],
    );
    await audit(admin, "supplier", supplierDocument[1], "document_recorded", String(body.title), String(body.note ?? ""));
    return { status: 201, data: { id } };
  }
  const supplierCommission = path.match(/^admin\/suppliers\/([^/]+)\/commission$/);
  if (supplierCommission && method === "POST") {
    const admin = await requireAdmin(actor, "supplier.profile");
    const body = await jsonBody(req);
    const rate = Number(body.rate);
    const reason = String(body.reason ?? "").trim();
    if (!reason || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new OpsError(422, "INVALID_INPUT");
    const [current] = await rows<any>("SELECT commission_rate FROM supplier WHERE id=$1", [supplierCommission[1]]);
    if (!current) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
    await rows(`UPDATE supplier SET commission_rate=$2, updated_at=now() WHERE id=$1`, [supplierCommission[1], rate]);
    await audit(admin, "supplier", supplierCommission[1], "commission_changed", reason, "", { from: Number(current.commission_rate), to: rate });
    await emitEvent("commission.changed", "supplier", supplierCommission[1], { from: Number(current.commission_rate), to: rate, reason });
    return { status: 200, data: { rate } };
  }

  if (path === "admin/buyers" && method === "GET") {
    await requireAdmin(actor, "buyer.read");
    return { status: 200, data: { buyers: await rows(`SELECT a.id, a.member_name, a.store_name, a.phone, a.city, a.plan_name, a.plan_code, a.status, a.expires_at, a.credit_limit, u.email FROM wholesale_account a JOIN account_user u ON u.id=a.user_id ORDER BY a.created_at DESC`) } };
  }
  const buyer360Path = path.match(/^admin\/buyers\/([^/]+)\/360$/);
  if (buyer360Path && method === "GET") {
    await requireAdmin(actor, "buyer.read");
    return { status: 200, data: await buyer360(buyer360Path[1]) };
  }
  const buyerStatus = path.match(/^admin\/buyers\/([^/]+)\/status$/);
  if (buyerStatus && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    const status = String(body.status ?? "");
    const reason = String(body.reason ?? "").trim();
    if (!BUYER_STATUSES.includes(status as typeof BUYER_STATUSES[number])) throw new OpsError(422, "INVALID_STATUS");
    if (!reason) throw new OpsError(422, "REASON_REQUIRED");
    const [account] = await rows<any>("SELECT * FROM wholesale_account WHERE id=$1", [buyerStatus[1]]);
    if (!account) throw new OpsError(404, "ACCOUNT_NOT_FOUND");
    await rows(`UPDATE wholesale_account SET status=$2, blocked_at=CASE WHEN $2 IN ('blocked','suspended','financial_blocked') THEN now() ELSE NULL END, updated_at=now() WHERE id=$1`, [account.id, status]);
    if (status === "approved") await rows(`UPDATE account_user SET role='vip', updated_at=now() WHERE id=$1`, [account.user_id]);
    if (["blocked", "rejected", "expired", "suspended", "cancelled"].includes(status)) await rows(`UPDATE account_user SET role='customer', updated_at=now() WHERE id=$1 AND role='vip'`, [account.user_id]);
    if (status === "cancelled") await emitEvent("membership.cancelled", "buyer", account.id, { reason });
    await audit(admin, "buyer", account.id, "membership_status", reason, String(body.note ?? ""), { from: account.status, to: status });
    return { status: 200, data: { status } };
  }
  const buyerPlan = path.match(/^admin\/buyers\/([^/]+)\/plan$/);
  if (buyerPlan && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    const reason = String(body.reason ?? "").trim();
    if (!reason) throw new OpsError(422, "REASON_REQUIRED");
    const plan = await planByCode(String(body.planCode ?? ""));
    if (!plan) throw new OpsError(422, "INVALID_PLAN");
    const [account] = await rows<any>("SELECT * FROM wholesale_account WHERE id=$1", [buyerPlan[1]]);
    if (!account) throw new OpsError(404, "ACCOUNT_NOT_FOUND");
    await rows(`UPDATE wholesale_account SET plan_code=$2, plan_name=$3, credit_limit=$4, updated_at=now() WHERE id=$1`, [account.id, plan.code, plan.name, plan.credit_limit]);
    await rows(`INSERT INTO membership_history (id, account_id, action, from_plan, to_plan, actor_id, note) VALUES ($1,$2,'admin_change',$3,$4,$5,$6)`, [makeId("mhst"), account.id, account.plan_code, plan.code, admin.sub, reason]);
    await audit(admin, "buyer", account.id, "plan_changed", reason, String(body.note ?? ""), { from: account.plan_code, to: plan.code });
    return { status: 200, data: { planCode: plan.code } };
  }
  const buyerCredit = path.match(/^admin\/buyers\/([^/]+)\/credit$/);
  if (buyerCredit && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    const reason = String(body.reason ?? "").trim();
    const credit = Math.trunc(Number(body.creditLimit));
    if (!reason || !Number.isInteger(credit) || credit < 0) throw new OpsError(422, "INVALID_INPUT");
    await rows(`UPDATE wholesale_account SET credit_limit=$2, updated_at=now() WHERE id=$1`, [buyerCredit[1], credit]);
    await audit(admin, "buyer", buyerCredit[1], "credit_limit", reason, "", { creditLimit: credit });
    return { status: 200, data: { creditLimit: credit } };
  }
  const buyerNote = path.match(/^admin\/buyers\/([^/]+)\/note$/);
  if (buyerNote && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    await rows(`UPDATE wholesale_account SET internal_note=$2, updated_at=now() WHERE id=$1`, [buyerNote[1], String(body.note ?? "")]);
    await audit(admin, "buyer", buyerNote[1], "internal_note", "یادداشت داخلی", String(body.note ?? ""));
    return { status: 200, data: { saved: true } };
  }
  const buyerRestriction = path.match(/^admin\/buyers\/([^/]+)\/restrictions$/);
  if (buyerRestriction && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    const code = String(body.code ?? "");
    const reason = String(body.reason ?? "").trim();
    if (!BUYER_RESTRICTIONS.includes(code as typeof BUYER_RESTRICTIONS[number]) || !reason) throw new OpsError(422, "INVALID_INPUT");
    await rows(
      `INSERT INTO buyer_restriction (id, account_id, code, active, reason, note, until, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (account_id, code) DO UPDATE SET active=EXCLUDED.active, reason=EXCLUDED.reason, note=EXCLUDED.note, until=EXCLUDED.until, actor_id=EXCLUDED.actor_id, updated_at=now()`,
      [makeId("bres"), buyerRestriction[1], code, body.active !== false, reason, String(body.note ?? ""), body.until ? new Date(String(body.until)) : null, admin.sub],
    );
    await audit(admin, "buyer", buyerRestriction[1], body.active === false ? "restriction_lifted" : "restriction_applied", reason, "", { code });
    return { status: 200, data: { code, active: body.active !== false } };
  }
  const buyerAddress = path.match(/^admin\/buyers\/([^/]+)\/addresses$/);
  if (buyerAddress && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    if (!body.city?.trim() || !body.line?.trim()) throw new OpsError(422, "INVALID_INPUT");
    const id = makeId("addr");
    await rows(`INSERT INTO buyer_address (id, account_id, label, city, line, postal) VALUES ($1,$2,$3,$4,$5,$6)`, [id, buyerAddress[1], String(body.label ?? "آدرس"), body.city.trim(), body.line.trim(), String(body.postal ?? "")]);
    await audit(admin, "buyer", buyerAddress[1], "address_added", body.city.trim());
    return { status: 201, data: { id } };
  }
  const buyerDocument = path.match(/^admin\/buyers\/([^/]+)\/documents$/);
  if (buyerDocument && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    if (!body.title?.trim()) throw new OpsError(422, "INVALID_INPUT");
    const id = makeId("doc");
    await rows(`INSERT INTO party_document (id, party_type, party_id, title, status, note, reviewer_id) VALUES ($1,'buyer',$2,$3,$4,$5,$6)`, [id, buyerDocument[1], body.title.trim(), body.status || "pending", String(body.note ?? ""), admin.sub]);
    await audit(admin, "buyer", buyerDocument[1], "document_recorded", body.title.trim());
    return { status: 201, data: { id } };
  }
  const sandbox = path.match(/^admin\/membership\/payments\/([^/]+)\/verify-sandbox$/);
  if (sandbox && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const config = await gatewayConfig();
    if (!config.sandbox) throw new OpsError(403, "SANDBOX_DISABLED");
    const [payment] = await rows<any>("SELECT * FROM membership_payment WHERE id=$1", [sandbox[1]]);
    if (!payment) throw new OpsError(404, "PAYMENT_NOT_FOUND");
    const providerRef = `sandbox-${payment.id.slice(-8)}`;
    const signature = signGatewayPayload(payment.id, providerRef, Number(payment.amount), String(config.secret));
    const result = await confirmGatewayPayment({ paymentId: payment.id, providerRef, signature }, `sandbox:${admin.sub}`);
    await audit(admin, "buyer", payment.account_id, "sandbox_gateway_verify", "تأیید آزمایشی درگاه", "", { paymentId: payment.id });
    return { status: 200, data: result };
  }
  const membershipRefund = path.match(/^admin\/membership\/payments\/([^/]+)\/refund$/);
  if (membershipRefund && method === "POST") {
    const admin = await requireAdmin(actor, "buyer.manage");
    const body = await jsonBody(req);
    const reason = String(body.reason ?? "").trim();
    if (!reason) throw new OpsError(422, "REASON_REQUIRED");
    const [payment] = await rows<any>("SELECT * FROM membership_payment WHERE id=$1", [membershipRefund[1]]);
    if (!payment || payment.status !== "confirmed") throw new OpsError(422, "INVALID_STATUS");
    await rows(`UPDATE membership_payment SET status='refunded', updated_at=now() WHERE id=$1`, [payment.id]);
    await rows(
      `INSERT INTO ledger_entry (id, party_type, party_id, kind, amount, reference_type, reference_id, memo)
       VALUES ($1,'buyer',$2,'refund',$3,'membership_payment',$4,'بازگشت وجه عضویت')
       ON CONFLICT (party_type, party_id, kind, reference_type, reference_id) DO NOTHING`,
      [makeId("led"), payment.account_id, Number(payment.amount), payment.id],
    );
    await emitEvent("refund.completed", "buyer", payment.account_id, { paymentId: payment.id, amount: Number(payment.amount), reason });
    const [account] = await rows<any>("SELECT * FROM wholesale_account WHERE id=$1", [payment.account_id]);
    if (body.suspend && account) {
      await rows(`UPDATE wholesale_account SET status='suspended', updated_at=now() WHERE id=$1`, [account.id]);
      await rows(`UPDATE account_user SET role='customer', updated_at=now() WHERE id=$1 AND role='vip'`, [account.user_id]);
    }
    const invoice = await issueInvoice({
      kind: "refund", ownerType: "buyer", ownerId: payment.account_id, referenceType: "membership_payment", referenceId: `${payment.id}:refund`,
      customer: { name: account?.member_name || "—", phone: account?.phone || "—", address: account?.city || "—" },
      items: [{ name: "بازگشت وجه عضویت", sku: payment.plan_code, variant: "", quantity: 1, unitPrice: Number(payment.amount), discount: 0, total: Number(payment.amount) }],
      totals: { subtotal: Number(payment.amount), total: Number(payment.amount), paid: Number(payment.amount), remaining: 0, discount: 0, tax: 0, shipping: 0 },
      actorId: admin.sub,
    });
    await audit(admin, "buyer", payment.account_id, "membership_refunded", reason, "", { paymentId: payment.id });
    await emitEvent("membership.refunded", "buyer", payment.account_id, { paymentId: payment.id, amount: Number(payment.amount) });
    return { status: 200, data: { refunded: true, invoiceId: invoice.id } };
  }

  if (path === "admin/crm/labels" && method === "GET") {
    await requireAdmin(actor, "crm.manage");
    return { status: 200, data: { labels: await rows("SELECT id, code, name, kind, subject, rule, active FROM crm_label ORDER BY name") } };
  }
  if (path === "admin/crm/labels" && method === "POST") {
    const admin = await requireAdmin(actor, "crm.manage");
    const body = await jsonBody(req);
    const code = String(body.code ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(code) || !body.name?.trim()) throw new OpsError(422, "INVALID_INPUT");
    if (body.rule) {
      const text = JSON.stringify(body.rule);
      if (/function|eval|process|require/.test(text)) throw new OpsError(422, "INVALID_RULE");
    }
    const id = makeId("lbl");
    await rows(`INSERT INTO crm_label (id, code, name, kind, subject, rule) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id, code, body.name.trim(), body.kind === "rule" ? "rule" : "manual", body.subject || "buyer", body.rule ? JSON.stringify(body.rule) : null]);
    await audit(admin, "crm", id, "label_created", code);
    return { status: 201, data: { id, code } };
  }
  if (path === "admin/crm/evaluate" && method === "POST") {
    await requireAdmin(actor, "crm.manage");
    return { status: 200, data: await evaluateLabels() };
  }
  if (path === "admin/crm/automations" && method === "GET") {
    await requireAdmin(actor, "crm.manage");
    return { status: 200, data: { automations: await rows("SELECT id, name, event_name, label_code, action, config, active FROM crm_automation ORDER BY created_at DESC") } };
  }
  if (path === "admin/crm/automations" && method === "POST") {
    const admin = await requireAdmin(actor, "crm.manage");
    const body = await jsonBody(req);
    const action = String(body.action ?? "");
    if (!body.name?.trim() || !CRM_EVENTS.includes(body.eventName) || !["sms", "notification", "note", "coupon", "webhook"].includes(action)) throw new OpsError(422, "INVALID_INPUT");
    if (action === "webhook") throw new OpsError(422, "WEBHOOK_VIA_INTEGRATION_CENTER");
    const id = makeId("auto");
    await rows(
      `INSERT INTO crm_automation (id, name, event_name, label_code, action, config) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [id, body.name.trim(), body.eventName, body.labelCode || null, action, JSON.stringify({ body: body.body ?? "", couponCode: body.couponCode ?? "" })],
    );
    await audit(admin, "crm", id, "automation_created", body.eventName);
    return { status: 201, data: { id } };
  }
  if (path === "admin/crm/assignments" && method === "POST") {
    const admin = await requireAdmin(actor, "crm.manage");
    const body = await jsonBody(req);
    const [label] = await rows<any>("SELECT * FROM crm_label WHERE code=$1", [body.labelCode]);
    if (!label || !body.subjectId) throw new OpsError(422, "INVALID_INPUT");
    await rows(
      `INSERT INTO crm_assignment (id, label_id, subject_type, subject_id, source, snapshot) VALUES ($1,$2,$3,$4,'manual',$5::jsonb)
       ON CONFLICT (label_id, subject_type, subject_id) DO UPDATE SET source='manual', assigned_at=now()`,
      [makeId("casg"), label.id, body.subjectType || "buyer", body.subjectId, JSON.stringify({ note: body.note ?? "" })],
    );
    await audit(admin, "crm", label.id, "manual_label", String(body.labelCode), String(body.note ?? ""), { subjectId: body.subjectId });
    return { status: 200, data: { assigned: true } };
  }
  if (path === "admin/crm/campaigns" && method === "GET") {
    await requireAdmin(actor, "crm.manage");
    return { status: 200, data: { campaigns: await rows("SELECT * FROM sms_campaign ORDER BY created_at DESC LIMIT 50") } };
  }
  if (path === "admin/crm/campaigns" && method === "POST") {
    const admin = await requireAdmin(actor, "crm.manage");
    const body = await jsonBody(req);
    if (!body.name?.trim() || !body.body?.trim() || !body.labelCode) throw new OpsError(422, "INVALID_INPUT");
    const [label] = await rows<any>("SELECT * FROM crm_label WHERE code=$1", [body.labelCode]);
    if (!label) throw new OpsError(404, "LABEL_NOT_FOUND");
    const recipients = await rows<any>(
      `SELECT s.subject_type, s.subject_id, s.snapshot, a.phone, a.member_name, a.plan_name, a.expires_at
       FROM crm_assignment s LEFT JOIN wholesale_account a ON a.id=s.subject_id
       WHERE s.label_id=$1`,
      [label.id],
    );
    const id = makeId("camp");
    await rows(`INSERT INTO sms_campaign (id, name, body, label_code, actor_id) VALUES ($1,$2,$3,$4,$5)`, [id, body.name.trim(), body.body.trim(), label.code, admin.sub]);
    for (const recipient of recipients) {
      const days = recipient.expires_at ? Math.ceil((new Date(recipient.expires_at).getTime() - Date.now()) / 86400_000) : "";
      const rendered = String(body.body)
        .replaceAll("{{customer.name}}", recipient.member_name || recipient.snapshot?.name || "")
        .replaceAll("{{plan.name}}", recipient.plan_name || "")
        .replaceAll("{{days_to_expiry}}", String(days));
      await rows(
        `INSERT INTO sms_delivery (id, campaign_id, subject_type, subject_id, phone, rendered) VALUES ($1,$2,$3,$4,$5,$6)`,
        [makeId("smd"), id, recipient.subject_type, recipient.subject_id, recipient.phone || "", rendered],
      );
    }
    await audit(admin, "crm", id, "sms_campaign", label.code, "", { recipients: recipients.length });
    return { status: 201, data: { id, recipients: recipients.length, status: "queued" } };
  }

  if (path === "admin/integrations" && method === "GET") {
    await requireAdmin(actor, "integration.manage");
    const endpoints = await rows<any>("SELECT id, name, kind, url, events, active, created_at FROM integration_endpoint ORDER BY created_at DESC");
    const deliveries = await rows("SELECT id, endpoint_id, event_name, status, detail, created_at FROM integration_delivery ORDER BY created_at DESC LIMIT 30");
    return { status: 200, data: { endpoints, deliveries, events: CRM_EVENTS } };
  }
  if (path === "admin/integrations" && method === "POST") {
    const admin = await requireAdmin(actor, "integration.manage");
    const body = await jsonBody(req);
    let url: URL;
    try { url = new URL(String(body.url ?? "")); } catch { throw new OpsError(422, "INVALID_INPUT"); }
    if (!["http:", "https:"].includes(url.protocol) || !body.name?.trim() || !body.secret || String(body.secret).length < 8) throw new OpsError(422, "INVALID_INPUT");
    const allowedEvents = new Set<string>(CRM_EVENTS);
    const events = Array.isArray(body.events) ? body.events.filter((event: unknown) => typeof event === "string" && allowedEvents.has(event)) : [];
    if (!events.length) throw new OpsError(422, "INVALID_EVENT");
    const id = makeId("intg");
    await rows(
      `INSERT INTO integration_endpoint (id, name, kind, url, secret, events) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, body.name.trim(), body.kind === "sms" ? "sms" : "n8n", url.toString(), String(body.secret), events],
    );
    await audit(admin, "integration", id, "endpoint_created", body.name.trim());
    return { status: 201, data: { id } };
  }

  if (path === "admin/settlements/complete" && method === "POST") {
    const admin = await requireAdmin(actor, "invoice.manage");
    const body = await jsonBody(req);
    const invoice = await completeSettlement(String(body.supplierId ?? ""), Math.trunc(Number(body.amount)), admin.sub);
    await audit(admin, "supplier", String(body.supplierId ?? ""), "settlement_completed", String(body.reason ?? "تسویه"), "", { amount: body.amount, invoiceId: invoice.id });
    return { status: 201, data: { invoice } };
  }
  const retailPaid = path.match(/^admin\/retail-orders\/([^/]+)\/mark-paid$/);
  if (retailPaid && method === "POST") {
    const admin = await requireAdmin(actor, "invoice.manage");
    const invoice = await markRetailPaid(decodeURIComponent(retailPaid[1]), admin.sub);
    return { status: 201, data: { invoice } };
  }

  if (path === "admin/invoice-templates" && method === "GET") {
    await requireAdmin(actor, "invoice.manage");
    return { status: 200, data: { templates: await rows("SELECT id, code, name, kind, version, body, active, created_at FROM invoice_template ORDER BY code, version DESC"), variables: INVOICE_VARIABLES } };
  }
  if (path === "admin/invoice-templates" && method === "POST") {
    const admin = await requireAdmin(actor, "invoice.manage");
    const body = await jsonBody(req);
    const code = String(body.code ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(code) || !body.name?.trim() || !body.body) throw new OpsError(422, "INVALID_INPUT");
    assertTemplateVariables(body.body);
    const kind = INVOICE_KINDS.includes(body.kind) ? body.kind : "wholesale";
    const [latest] = await rows<any>("SELECT COALESCE(MAX(version),0)::int AS version FROM invoice_template WHERE code=$1", [code]);
    const version = Number(latest.version) + 1;
    const id = makeId("itpl");
    await rows(`UPDATE invoice_template SET active=false WHERE code=$1`, [code]);
    await rows(`INSERT INTO invoice_template (id, code, name, kind, version, body, active) VALUES ($1,$2,$3,$4,$5,$6::jsonb,true)`, [id, code, body.name.trim(), kind, version, JSON.stringify(body.body)]);
    await audit(admin, "invoice_template", id, "template_version", code, "", { version });
    return { status: 201, data: { id, version } };
  }
  if (path === "admin/invoices" && method === "GET") {
    await requireAdmin(actor, "invoice.manage");
    return { status: 200, data: { invoices: await rows("SELECT id, number, kind, status, owner_type, owner_id, reference_type, reference_id, template_version, issued_at FROM invoice ORDER BY issued_at DESC LIMIT 100"), statusLabels: INVOICE_STATUS_LABEL, kindLabels: INVOICE_KIND_LABEL } };
  }
  if (path === "admin/invoices/issue" && method === "POST") {
    const admin = await requireAdmin(actor, "invoice.manage");
    const body = await jsonBody(req);
    if (body.kind === "wholesale" && body.referenceId) {
      const invoice = await syncOrderPaid(String(body.referenceId)) ?? await issueFromOrder(String(body.referenceId), admin.sub);
      return { status: 201, data: { invoice } };
    }
    if (body.kind === "settlement" && body.supplierId) {
      const finance = await financials("supplier", String(body.supplierId));
      const [supplier] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [body.supplierId]);
      if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
      const invoice = await issueInvoice({
        kind: "settlement", ownerType: "supplier", ownerId: supplier.id, referenceType: "settlement", referenceId: `${supplier.id}:${toJalali(new Date())}`,
        supplier: { name: supplier.display_name, phone: supplier.phone, city: supplier.city },
        customer: { name: "کلبه وینتیج", phone: "—", address: "تهران" },
        items: [{ name: "صورت‌حساب تسویه", sku: "SETTLEMENT", variant: "", quantity: 1, unitPrice: finance.payable, discount: 0, total: finance.payable }],
        totals: { subtotal: finance.salesTotal, discount: 0, tax: 0, shipping: 0, total: finance.payable, paid: finance.settled, remaining: finance.payable },
        actorId: admin.sub,
      });
      return { status: 201, data: { invoice } };
    }
    if (body.kind === "supplier_statement" && body.supplierId) {
      const finance = await financials("supplier", String(body.supplierId));
      const [supplier] = await rows<any>("SELECT * FROM supplier WHERE id=$1", [body.supplierId]);
      if (!supplier) throw new OpsError(404, "SUPPLIER_NOT_FOUND");
      const invoice = await issueInvoice({
        kind: "supplier_statement", ownerType: "supplier", ownerId: supplier.id, referenceType: "supplier_statement", referenceId: `${supplier.id}:${toJalali(new Date())}`,
        supplier: { name: supplier.display_name, phone: supplier.phone, city: supplier.city },
        customer: { name: "کلبه وینتیج", phone: "—", address: "تهران" },
        items: [{ name: "صورت‌حساب همکاری", sku: "STATEMENT", variant: "", quantity: 1, unitPrice: finance.salesTotal, discount: 0, total: finance.payable }],
        totals: { subtotal: finance.salesTotal, discount: finance.fees, tax: 0, shipping: 0, total: finance.payable, paid: finance.settled, remaining: finance.payable },
        actorId: admin.sub,
      });
      return { status: 201, data: { invoice } };
    }
    if (body.kind === "adjustment" && body.referenceId) {
      const [source] = await rows<any>("SELECT * FROM invoice WHERE id=$1", [body.referenceId]);
      if (!source) throw new OpsError(404, "INVOICE_NOT_FOUND");
      const invoice = await issueInvoice({
        kind: "adjustment", ownerType: source.owner_type, ownerId: source.owner_id, referenceType: "invoice", referenceId: `${source.id}:adjustment`,
        customer: source.snapshot.customer, supplier: source.snapshot.supplier, orderReference: source.number,
        items: source.snapshot.items ?? [],
        totals: source.snapshot,
        actorId: admin.sub,
      });
      return { status: 201, data: { invoice } };
    }
    throw new OpsError(422, "INVALID_INPUT");
  }
  const invoiceStatus = path.match(/^admin\/invoices\/([^/]+)\/status$/);
  if (invoiceStatus && method === "POST") {
    const admin = await requireAdmin(actor, "invoice.manage");
    const body = await jsonBody(req);
    const [invoice] = await rows<any>("SELECT * FROM invoice WHERE id=$1", [invoiceStatus[1]]);
    if (!invoice) throw new OpsError(404, "INVOICE_NOT_FOUND");
    const next = String(body.status ?? "");
    if (!INVOICE_STATUSES.includes(next as typeof INVOICE_STATUSES[number]) || !transitionAllowed(invoice.status, next)) throw new OpsError(422, "INVALID_STATUS");
    const snapshot = { ...invoice.snapshot, invoice: { ...invoice.snapshot.invoice, status: next } };
    await rows(`UPDATE invoice SET status=$2, snapshot=$3::jsonb WHERE id=$1`, [invoice.id, next, JSON.stringify(snapshot)]);
    if (next === "refunded") {
      await issueInvoice({
        kind: "refund",
        ownerType: invoice.owner_type,
        ownerId: invoice.owner_id,
        referenceType: "invoice",
        referenceId: invoice.id,
        actorId: admin.sub,
        customer: invoice.snapshot.customer,
        supplier: invoice.snapshot.supplier,
        orderReference: invoice.snapshot.order?.reference,
        payment: { method: "refund", reference: invoice.number },
        items: invoice.snapshot.items ?? [],
        totals: {
          subtotal: Number(invoice.snapshot.subtotal || 0),
          discount: Number(invoice.snapshot.discount || 0),
          tax: Number(invoice.snapshot.tax || 0),
          shipping: Number(invoice.snapshot.shipping || 0),
          total: Number(invoice.snapshot.total || 0),
          paid: Number(invoice.snapshot.total || 0),
          remaining: 0,
        },
      });
    }
    await audit(admin, "invoice", invoice.id, "status", String(body.reason ?? next));
    return { status: 200, data: { status: next } };
  }
  const invoicePdf = path.match(/^(?:admin\/)?invoices\/([^/]+)\/pdf$/);
  if (invoicePdf && method === "GET") {
    const [invoice] = await rows<any>("SELECT * FROM invoice WHERE id=$1", [invoicePdf[1]]);
    if (!invoice) throw new OpsError(404, "INVOICE_NOT_FOUND");
    await canReadInvoice(actor, invoice);
    const [file] = await rows<any>("SELECT bytes FROM invoice_file WHERE invoice_id=$1", [invoice.id]);
    const bytes = file?.bytes ? Buffer.from(file.bytes) : await renderStoredInvoice(invoice.id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${invoice.number}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const invoiceGet = path.match(/^(?:admin\/)?invoices\/([^/]+)$/);
  if (invoiceGet && method === "GET") {
    const [invoice] = await rows<any>("SELECT id, number, kind, status, owner_type, owner_id, template_id, template_version, snapshot, issued_at FROM invoice WHERE id=$1", [invoiceGet[1]]);
    if (!invoice) throw new OpsError(404, "INVOICE_NOT_FOUND");
    await canReadInvoice(actor, invoice);
    return { status: 200, data: { invoice } };
  }
  return null;
}

async function issueFromOrder(orderId: string, actorId: string) {
  const [order] = await rows<any>(
    `SELECT o.*, a.member_name, a.phone, a.city, a.address, a.id AS buyer_id FROM wholesale_order o JOIN wholesale_account a ON a.id=o.account_id WHERE o.id=$1`,
    [orderId],
  );
  if (!order) throw new OpsError(404, "ORDER_NOT_FOUND");
  const items = await rows<any>("SELECT * FROM wholesale_order_item WHERE order_id=$1", [orderId]);
  return issueInvoice({
    kind: "wholesale", ownerType: "buyer", ownerId: order.buyer_id, referenceType: "wholesale_order", referenceId: order.id, actorId,
    customer: { name: order.member_name, phone: order.phone, address: order.address || order.city },
    orderReference: order.order_code,
    payment: { method: order.payment_status, reference: order.order_code },
    items: items.map((item) => ({ name: item.product_name, sku: item.sku, variant: "", quantity: item.quantity, unitPrice: Number(item.unit_price), discount: 0, total: item.quantity * Number(item.unit_price) })),
    totals: { subtotal: Number(order.total_amount), total: Number(order.total_amount), paid: order.payment_status === "paid" ? Number(order.total_amount) : 0, remaining: order.payment_status === "paid" ? 0 : Number(order.total_amount), discount: 0, tax: 0, shipping: 0 },
  });
}
