import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { database, makeId, passwordRecord, rows, transaction } from "./database";
import {
  assertRedirectSafe,
  googlePreview,
  merchantReadiness,
  recordNotFound,
  renderProductDocument,
  renderSitemapIndex,
  renderUrlSet,
  resolveRedirect,
  robotsBody,
  runSeoCrawl,
  seoHealth,
  sitemapEntries,
  slugify,
} from "./seo-discovery";

type Json = Record<string, any>;
type Actor = { sub: string; role: string } | null;

export class DiscoveryError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const SCHEMA = `
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'supplier';
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS retail_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS wholesale_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS retail_cash_price bigint;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS retail_installment_price bigint;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS installment_policy text NOT NULL DEFAULT 'disabled';
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 4;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS moq integer NOT NULL DEFAULT 1;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS series_code text;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS legacy_id text;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'kolbe';
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS retail_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS wholesale_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS sale_price bigint;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS installment_policy text NOT NULL DEFAULT 'disabled';
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 4;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS installment_price bigint;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS legacy_id text;
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'پوشاک';
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS legacy_id text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS password_reset_required boolean NOT NULL DEFAULT false;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS customer_level text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS signed_up_at timestamptz;
ALTER TABLE wholesale_order_item ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'legacy';
ALTER TABLE purchase_order_item ADD COLUMN IF NOT EXISTS stock_source text NOT NULL DEFAULT 'legacy';
CREATE TABLE IF NOT EXISTS warehouse (
  id text PRIMARY KEY, name text NOT NULL, city text, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_balance (
  variant_id text NOT NULL, warehouse_id text NOT NULL REFERENCES warehouse(id), on_hand integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (variant_id, warehouse_id)
);
CREATE TABLE IF NOT EXISTS inventory_adjustment (
  id text PRIMARY KEY, variant_id text NOT NULL, warehouse_id text NOT NULL, delta integer NOT NULL, reason text NOT NULL,
  actor_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_job (
  id text PRIMARY KEY, kind text NOT NULL, filename text NOT NULL, format text NOT NULL, mode text NOT NULL DEFAULT 'upsert',
  purpose text NOT NULL DEFAULT 'balance', status text NOT NULL DEFAULT 'uploaded', admin_id text, mapping jsonb NOT NULL DEFAULT '{}',
  report jsonb NOT NULL DEFAULT '{}', file_text text, file_bytes bytea, progress integer NOT NULL DEFAULT 0, cursor_row integer NOT NULL DEFAULT 0,
  total_rows integer NOT NULL DEFAULT 0, valid_count integer NOT NULL DEFAULT 0, warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0, created_count integer NOT NULL DEFAULT 0, updated_count integer NOT NULL DEFAULT 0,
  dry_run boolean NOT NULL DEFAULT false, started_at timestamptz, finished_at timestamptz, duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_error (
  id text PRIMARY KEY, job_id text NOT NULL, row_number integer NOT NULL, severity text NOT NULL, code text NOT NULL,
  message text NOT NULL, row_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS media_asset (
  id text PRIMARY KEY, entity_id text, role text NOT NULL DEFAULT 'original', parent_id text, filename text, mime text,
  alt text, title text, caption text, variant_color text, width integer, height integer, byte_size integer,
  bytes bytea, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_category (
  id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE, parent_id text, legacy_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seo_template (
  id text PRIMARY KEY, entity_type text NOT NULL, title_template text NOT NULL, description_template text NOT NULL,
  active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seo_document (
  id text PRIMARY KEY, entity_type text NOT NULL, entity_id text, slug text, seo_title text, meta_description text,
  canonical text, robots_index boolean NOT NULL DEFAULT true, robots_follow boolean NOT NULL DEFAULT true, h1 text,
  h1_count integer NOT NULL DEFAULT 1, parent_id text, links jsonb NOT NULL DEFAULT '[]', updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seo_change (
  id text PRIMARY KEY, document_id text, actor_id text, field text NOT NULL, old_value text, new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seo_redirect (
  id text PRIMARY KEY, source_path text NOT NULL, target_path text, status_code integer NOT NULL DEFAULT 301,
  active boolean NOT NULL DEFAULT true, actor_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_redirect_source ON seo_redirect(source_path) WHERE active;
CREATE TABLE IF NOT EXISTS seo_404 (
  id text PRIMARY KEY, path text NOT NULL, referrer text, hit_count integer NOT NULL DEFAULT 1, fingerprint text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seo_issue (
  id text PRIMARY KEY, crawl_id text, fingerprint text NOT NULL UNIQUE, code text NOT NULL, severity text NOT NULL,
  message text NOT NULL, path text, entity_id text, status text NOT NULL DEFAULT 'open', first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), fixed_at timestamptz
);
CREATE TABLE IF NOT EXISTS seo_crawl (
  id text PRIMARY KEY, actor_id text, schedule text NOT NULL DEFAULT 'manual', started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz, duration_ms integer, new_count integer NOT NULL DEFAULT 0, fixed_count integer NOT NULL DEFAULT 0,
  remaining_count integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seo_vital (
  id text PRIMARY KEY, path text NOT NULL, lcp_ms integer, inp_ms integer, cls numeric, source text NOT NULL DEFAULT 'recorded',
  measured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_review (
  id text PRIMARY KEY, product_id text NOT NULL, rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5), body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS password_reset_challenge (
  id text PRIMARY KEY, user_id text NOT NULL, phone text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
  used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION kolbe_lock_supplier_channel() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.owner_type IS NULL OR NEW.owner_type = 'supplier' THEN
    NEW.owner_type := 'supplier';
    NEW.retail_enabled := false;
    NEW.wholesale_enabled := true;
    NEW.retail_cash_price := NULL;
  ELSIF NEW.owner_type <> 'kolbe' THEN
    RAISE EXCEPTION 'INVALID_OWNER';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS supplier_channel_lock ON supplier_product;
CREATE TRIGGER supplier_channel_lock BEFORE INSERT OR UPDATE ON supplier_product
FOR EACH ROW EXECUTE FUNCTION kolbe_lock_supplier_channel();
`;

let ready: Promise<void> | null = null;

export async function ensureCommerceSchema(client?: PoolClient) {
  const apply = async (db: PoolClient) => {
    await db.query(SCHEMA);
    await db.query(
      `INSERT INTO warehouse (id, name, city) VALUES ('wh_teh','انبار تهران','تهران'), ('wh_isf','انبار اصفهان','اصفهان')
       ON CONFLICT (id) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO supplier (id, legal_name, display_name, city, status) VALUES ('sup_kolbe','کلبه وینتیج','کلبه وینتیج','تهران','approved')
       ON CONFLICT (id) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO site_setting (setting_key, value) VALUES
        ('seo_robots', '{"body":"User-agent: *\\nAllow: /\\nDisallow: /admin\\nDisallow: /supplier\\n"}'),
        ('seo_organization', '{"name":"کلبه وینتیج","description":"پوشاک کلاسیک و وینتیج با دوخت دست"}'),
        ('seo_facets', '{"color":{"indexable":true},"size":{"indexable":true},"price":{"indexable":false},"discount":{"indexable":false},"brand":{"indexable":true}}'),
        ('seo_crawl', '{"schedule":"manual"}'),
        ('installment_overrides', '{}')
       ON CONFLICT (setting_key) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO seo_template (id, entity_type, title_template, description_template)
       VALUES ('seo_tpl_product','product','{{product.name}} | کلبه وینتیج','{{product.name}} — {{product.description}}')
       ON CONFLICT (id) DO NOTHING`,
    );
  };
  if (client) return apply(client);
  ready ??= (async () => {
    const db = await database();
    const held = await db.connect();
    try {
      await held.query("BEGIN");
      await apply(held);
      await held.query("COMMIT");
    } catch (error) {
      await held.query("ROLLBACK");
      ready = null;
      throw error;
    } finally {
      held.release();
    }
  })();
  return ready;
}

export function isDiscoveryPath(path: string) {
  return path === "catalog/products" || path === "pricing/quote" || path === "auth/password/otp" || path === "auth/password/reset"
    || path.startsWith("media/") || path.startsWith("admin/channels") || path.startsWith("admin/imports")
    || path.startsWith("admin/warehouses") || path.startsWith("admin/inventory") || path.startsWith("admin/variants/") || path.startsWith("admin/seo")
    || path.startsWith("seo/");
}

export function supplierRetailAttempt(body: Json) {
  const channel = String(body.salesChannel ?? body.channel ?? body.sales_channel ?? "").toLowerCase();
  return body.retailEnabled === true || body.retail === true || body.retail_enabled === true
    || channel === "retail" || channel === "both" || channel === "خرده" || channel === "هر دو"
    || body.retailCashPrice != null || body.retail_cash_price != null;
}

const POLICIES = new Set(["disabled", "enabled", "disabled_when_discounted", "enabled_when_discounted"]);

export function installmentEligible(policy: string, discounted: boolean) {
  if (!POLICIES.has(policy) || policy === "disabled") return false;
  if (policy === "disabled_when_discounted") return !discounted;
  return true;
}

export async function decideRetailPrice(client: PoolClient, productId: string, payMethod: string) {
  const supplier = (await client.query("SELECT id, owner_type, retail_enabled, wholesale_enabled, retail_cash_price, installment_policy, installment_count, name, status FROM supplier_product WHERE id=$1", [productId])).rows[0];
  if (supplier?.owner_type === "supplier") return { ok: false as const, status: 422, error: "CHANNEL_FORBIDDEN" };
  const retail = (await client.query(
    "SELECT * FROM retail_product WHERE id=$1 AND active=true AND owner_type='kolbe' AND retail_enabled=true LIMIT 1",
    [productId],
  )).rows[0];
  const source = retail ?? (supplier?.owner_type === "kolbe" && supplier.retail_enabled && supplier.status === "approved" ? supplier : null);
  if (!source) return { ok: false as const, status: 422, error: "UNKNOWN_PRODUCT" };
  const base = Number(source.price ?? source.retail_cash_price ?? 0);
  const sale = source.sale_price == null ? null : Number(source.sale_price);
  const discounted = sale != null && sale < base;
  const final = discounted ? sale : base;
  const overrides = (await client.query("SELECT value FROM site_setting WHERE setting_key='installment_overrides'")).rows[0]?.value ?? {};
  const policy = String(overrides.products?.[productId] || overrides.categories?.[source.category] || overrides.campaign || source.installment_policy || "disabled");
  const eligible = installmentEligible(policy, discounted);
  const count = Math.max(1, Number(source.installment_count ?? 4));
  const snapshot = {
    base, discount: base - final, final, eligibility: eligible, policy,
    installmentPrice: eligible ? final : null,
    count: eligible ? count : 0,
    amount: eligible ? Math.ceil(final / count) : null,
    payMethod,
  };
  if (payMethod === "installment" && !eligible) return { ok: false as const, status: 422, error: "INSTALLMENT_NOT_ALLOWED" };
  return { ok: true as const, price: final, name: String(source.name ?? ""), snapshot };
}

export async function overlayWarehouseStock<T extends { id: string; inventory: { on_hand: number; reserved: number; available?: number; source?: string } }>(variants: T[]) {
  if (!variants.length) return variants;
  const balances = await rows<any>(
    `SELECT variant_id, COALESCE(SUM(on_hand),0)::int AS on_hand, COALESCE(SUM(reserved),0)::int AS reserved
     FROM inventory_balance WHERE variant_id = ANY($1::text[]) GROUP BY variant_id`,
    [variants.map((variant) => variant.id)],
  );
  const map = new Map(balances.map((row) => [row.variant_id, row]));
  for (const variant of variants) {
    const balance = map.get(variant.id);
    if (!balance) continue;
    const onHand = Number(balance.on_hand);
    const reserved = Number(balance.reserved);
    variant.inventory = { on_hand: onHand, reserved, available: onHand - reserved, source: "wms" };
  }
  return variants;
}

export async function warehouseStock(client: PoolClient, variantId: string) {
  const stock = (await client.query("SELECT on_hand, reserved FROM inventory_balance WHERE variant_id=$1 FOR UPDATE", [variantId])).rows;
  if (!stock.length) return null;
  const onHand = stock.reduce((sum, row) => sum + Number(row.on_hand), 0);
  const reserved = stock.reduce((sum, row) => sum + Number(row.reserved), 0);
  return { on_hand: onHand, reserved, available: onHand - reserved };
}

export async function reserveWarehouse(client: PoolClient, variantId: string, quantity: number) {
  let left = quantity;
  const stock = (await client.query("SELECT warehouse_id, on_hand, reserved FROM inventory_balance WHERE variant_id=$1 ORDER BY warehouse_id FOR UPDATE", [variantId])).rows;
  for (const row of stock) {
    const available = Number(row.on_hand) - Number(row.reserved);
    if (available <= 0) continue;
    const take = Math.min(available, left);
    await client.query("UPDATE inventory_balance SET reserved=reserved+$3, updated_at=now() WHERE variant_id=$1 AND warehouse_id=$2", [variantId, row.warehouse_id, take]);
    left -= take;
    if (!left) return;
  }
  throw new DiscoveryError(409, "INSUFFICIENT_STOCK");
}

export async function releaseWarehouse(client: PoolClient, variantId: string, quantity: number) {
  let left = quantity;
  const stock = (await client.query("SELECT warehouse_id, reserved FROM inventory_balance WHERE variant_id=$1 ORDER BY warehouse_id DESC FOR UPDATE", [variantId])).rows;
  for (const row of stock) {
    const take = Math.min(Number(row.reserved), left);
    if (!take) continue;
    await client.query("UPDATE inventory_balance SET reserved=GREATEST(0, reserved-$3), updated_at=now() WHERE variant_id=$1 AND warehouse_id=$2", [variantId, row.warehouse_id, take]);
    left -= take;
  }
}

export async function consumeWarehouse(client: PoolClient, variantId: string, quantity: number) {
  let left = quantity;
  const stock = (await client.query("SELECT warehouse_id, on_hand, reserved FROM inventory_balance WHERE variant_id=$1 ORDER BY warehouse_id FOR UPDATE", [variantId])).rows;
  for (const row of stock) {
    const take = Math.min(Number(row.reserved) || Number(row.on_hand), left);
    if (!take) continue;
    await client.query(
      "UPDATE inventory_balance SET on_hand=GREATEST(0,on_hand-$3), reserved=GREATEST(0,reserved-$3), updated_at=now() WHERE variant_id=$1 AND warehouse_id=$2",
      [variantId, row.warehouse_id, take],
    );
    left -= take;
  }
}

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["title", "product_name", "name", "نام", "نام محصول", "عنوان"],
  sku: ["sku", "product_code", "code", "کد", "کد محصول"],
  legacy_id: ["legacy_id", "old_id", "شناسه قدیمی"],
  category: ["category", "دسته", "دسته‌بندی"],
  product_type: ["product_type", "type", "نوع"],
  description: ["description", "توضیحات"],
  price: ["price", "retail_price", "قیمت"],
  wholesale_price: ["wholesale_price", "قیمت عمده"],
  sale_price: ["sale_price", "discount_price", "قیمت تخفیف"],
  stock: ["stock", "qty", "quantity", "موجودی"],
  warehouse: ["warehouse", "انبار"],
  color: ["color", "colour", "رنگ"],
  size: ["size", "سایز"],
  image: ["image", "image_url", "تصویر"],
  email: ["email", "ایمیل"],
  phone: ["phone", "موبایل", "تلفن"],
  signed_up_at: ["signup_date", "created_at", "تاریخ عضویت"],
  address: ["address", "آدرس"],
  city: ["city", "شهر"],
  customer_level: ["customer_level", "level", "سطح مشتری"],
  password: ["password", "password_hash", "رمز"],
  slug: ["slug"],
  owner_type: ["owner_type", "owner"],
  channel: ["channel", "sales_channel", "کانال"],
  installment_policy: ["installment_policy", "اقساط"],
  parent_sku: ["parent_sku", "parent"],
};

function suggestMapping(headers: string[]) {
  const suggestions: Record<string, string> = {};
  for (const header of headers) {
    const key = header.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((alias) => alias.toLowerCase() === key) && !suggestions[field]) suggestions[field] = header;
    }
  }
  return suggestions;
}

function parseCsv(text: string) {
  const rowsOut: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rowsOut.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rowsOut.push(row); }
  return rowsOut.filter((item) => item.some((value) => value.trim()));
}

async function recordsFromFile(filename: string, bytes: Buffer) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".zip")) return { format: "zip", headers: [], records: [] as Json[] };
  if (lower.endsWith(".csv") || (!lower.endsWith(".xlsx") && !lower.endsWith(".xls") && bytes.subarray(0, 2).toString() !== "PK")) {
    const table = parseCsv(bytes.toString("utf8"));
    const headers = table[0] ?? [];
    return { format: "csv", headers, records: table.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""]))) };
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Json>(sheet, { defval: "" });
  const headers = records[0] ? Object.keys(records[0]) : [];
  return { format: lower.endsWith(".xls") ? "xls" : "xlsx", headers, records };
}

function mapped(record: Json, mapping: Record<string, string>) {
  const out: Json = {};
  for (const [field, header] of Object.entries(mapping)) out[field] = record[header];
  return out;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicImageUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function knownSizes(client: PoolClient) {
  const sizes = new Set(["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "FREE", "تک‌سایز", "فری"]);
  try {
    const listed = (await client.query("SELECT label FROM product_type_size")).rows as Array<{ label: string }>;
    for (const row of listed) sizes.add(row.label);
  } catch { /* size catalog is optional during early migration */ }
  return sizes;
}

async function validateImport(client: PoolClient, job: any, records: Json[], write: boolean) {
  const mapping = job.mapping ?? {};
  const issues: Json[] = [];
  const sizes = await knownSizes(client);
  const seenSku = new Set<string>();
  let valid = 0;
  let created = 0;
  let updated = 0;
  const house = "sup_kolbe";
  for (let index = job.cursor_row ?? 0; index < records.length; index += 1) {
    const source = records[index];
    const row = mapped(source, mapping);
    const rowIssues: Json[] = [];
    const push = (severity: string, code: string, message: string) => rowIssues.push({ severity, code, message, row: index + 2, data: source });
    if (job.kind === "users") {
      if (mapping.password || row.password) push("warning", "PASSWORD_IGNORED", "رمز یا هش ناامن وارد نمی‌شود و کاربر باید با OTP بازنشانی کند");
      if (!row.email || !validEmail(String(row.email))) push("error", "INVALID_EMAIL", "ایمیل نامعتبر است");
      if (!rowIssues.some((item) => item.severity === "error") && write) {
        const email = String(row.email).trim().toLowerCase();
        const existing = (await client.query("SELECT id FROM account_user WHERE email=$1 OR legacy_id=$2 LIMIT 1", [email, row.legacy_id || null])).rows[0];
        if (existing && job.mode === "create_only") push("error", "DUPLICATE", "کاربر از قبل وجود دارد");
        else if (!existing && job.mode === "update_existing") push("error", "NOT_FOUND", "کاربر برای به‌روزرسانی پیدا نشد");
        else if (!rowIssues.some((item) => item.code === "DUPLICATE" || item.code === "NOT_FOUND")) {
          if (existing) {
            await client.query(
              `UPDATE account_user SET display_name=COALESCE($2, display_name), phone=COALESCE($3, phone), city=$4, address=$5, customer_level=$6, signed_up_at=COALESCE($7, signed_up_at), legacy_id=COALESCE($8, legacy_id), password_reset_required=true, updated_at=now() WHERE id=$1`,
              [existing.id, row.name || null, row.phone || null, row.city || null, row.address || null, row.customer_level || null, row.signed_up_at || null, row.legacy_id || null],
            );
            updated += 1;
          } else {
            const secret = passwordRecord(randomUUID());
            await client.query(
              `INSERT INTO account_user (id, email, password_hash, salt, role, display_name, phone, city, address, customer_level, signed_up_at, legacy_id, password_reset_required)
               VALUES ($1,$2,$3,$4,'customer',$5,$6,$7,$8,$9,$10,$11,true)`,
              [makeId("usr"), email, secret.passwordHash, secret.salt, row.name || email.split("@")[0], row.phone || null, row.city || null, row.address || null, row.customer_level || null, row.signed_up_at || null, row.legacy_id || null],
            );
            created += 1;
          }
        }
      }
    } else if (job.kind === "inventory") {
      const sku = String(row.sku ?? "").trim();
      const quantity = Number(row.stock ?? row.quantity);
      if (!sku) push("error", "MISSING_PARENT", "SKU والد یا واریانت خالی است");
      if (!Number.isFinite(quantity) || quantity < 0) push("error", "NEGATIVE_STOCK", "موجودی منفی یا نامعتبر است");
      const variant = sku ? (await client.query("SELECT id FROM supplier_variant WHERE sku=$1 OR product_id IN (SELECT id FROM supplier_product WHERE sku=$1) LIMIT 1", [sku])).rows[0] : null;
      if (sku && !variant) push("error", "MISSING_PARENT", "واریانت یا محصول والد پیدا نشد");
      const warehouse = row.warehouse ? (await client.query("SELECT id FROM warehouse WHERE id=$1 OR name=$1 LIMIT 1", [String(row.warehouse)])).rows[0] : (await client.query("SELECT id FROM warehouse ORDER BY id LIMIT 1")).rows[0];
      if (!warehouse) push("error", "MISSING_WAREHOUSE", "انبار پیدا نشد");
      if (!rowIssues.some((item) => item.severity === "error") && write && variant && warehouse) {
        if (job.purpose === "receipt") {
          await client.query(
            `INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand) VALUES ($1,$2,$3)
             ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand=inventory_balance.on_hand+EXCLUDED.on_hand, updated_at=now()`,
            [variant.id, warehouse.id, quantity],
          );
        } else {
          await client.query(
            `INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand) VALUES ($1,$2,$3)
             ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand=EXCLUDED.on_hand, updated_at=now()`,
            [variant.id, warehouse.id, quantity],
          );
        }
        updated += 1;
      }
    } else if (job.kind === "seo") {
      if (!row.slug && !row.legacy_id) push("error", "MISSING_PARENT", "اسلاگ یا شناسه خالی است");
      if (!rowIssues.some((item) => item.severity === "error") && write) {
        await client.query(
          `INSERT INTO seo_document (id, entity_type, entity_id, slug, seo_title, meta_description, canonical, h1, updated_by)
           VALUES ($1,'product',$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [makeId("seod"), row.legacy_id || null, slugify(String(row.slug || row.name || "item")), row.name || null, row.description || null, row.canonical || null, row.name || null, job.admin_id],
        );
        created += 1;
      }
    } else {
      const sku = String(row.sku ?? "").trim().toUpperCase();
      const owner = String(row.owner_type || "kolbe").toLowerCase() === "supplier" ? "supplier" : "kolbe";
      if (!row.name) push("error", "MISSING_NAME", "نام محصول خالی است");
      if (!sku) push("error", "MISSING_SKU", "SKU خالی است");
      if (!row.product_type && !row.category) push("error", "MISSING_TYPE", "نوع یا دسته‌بندی محصول خالی است");
      if (row.size && !sizes.has(String(row.size).trim())) push("error", "INVALID_SIZE", "سایز نامعتبر است");
      if (row.stock != null && row.stock !== "" && Number(row.stock) < 0) push("error", "NEGATIVE_STOCK", "موجودی منفی است");
      if (row.image && !publicImageUrl(String(row.image))) push("error", "UNREACHABLE_IMAGE", "نشانی تصویر در دسترس یا مجاز نیست");
      if (sku && seenSku.has(sku)) push("error", "DUPLICATE_SKU", "SKU در فایل تکراری است");
      if (sku) seenSku.add(sku);
      if (row.parent_sku) {
        const parent = (await client.query("SELECT id FROM supplier_product WHERE sku=$1", [String(row.parent_sku).toUpperCase()])).rows[0];
        if (!parent && !seenSku.has(String(row.parent_sku).toUpperCase())) push("error", "MISSING_PARENT", "محصول والد پیدا نشد");
      }
      const existing = sku ? (await client.query("SELECT id, slug FROM supplier_product WHERE sku=$1 OR legacy_id=$2 LIMIT 1", [sku, row.legacy_id || null])).rows[0] : null;
      if (existing && job.mode === "create_only") push("error", "DUPLICATE_SKU", "SKU از قبل وجود دارد");
      if (!existing && job.mode === "update_existing") push("error", "NOT_FOUND", "محصول برای به‌روزرسانی پیدا نشد");
      if (!rowIssues.some((item) => item.severity === "error")) {
        valid += 1;
        if (write) {
          const channel = owner === "supplier" ? "wholesale" : String(row.channel || "retail");
          const retailEnabled = owner === "kolbe" && channel !== "wholesale";
          const wholesaleEnabled = owner === "supplier" || channel !== "retail";
          const id = existing?.id ?? makeId("prd");
          const slug = slugify(String(row.slug || row.name || sku));
          if (existing) {
            await client.query(
              `UPDATE supplier_product SET name=$2, category=COALESCE($3, category), description=COALESCE($4, description), wholesale_price=COALESCE($5, wholesale_price),
                 retail_cash_price=$6, owner_type=$7, retail_enabled=$8, wholesale_enabled=$9, slug=$10, legacy_id=COALESCE($11, legacy_id), installment_policy=COALESCE($12, installment_policy), updated_at=now()
               WHERE id=$1`,
              [id, row.name, row.category || null, row.description || null, row.wholesale_price ? Math.round(Number(row.wholesale_price)) : null, owner === "kolbe" && row.price ? Math.round(Number(row.price)) : null, owner, retailEnabled, wholesaleEnabled, slug, row.legacy_id || null, row.installment_policy || null],
            );
            if (existing.slug && existing.slug !== slug) await saveRedirect(client, `/product/${existing.slug}`, `/product/${slug}`, 301, job.admin_id);
            updated += 1;
          } else {
            await client.query(
              `INSERT INTO supplier_product (id, supplier_id, name, sku, category, description, wholesale_price, status, owner_type, retail_enabled, wholesale_enabled, retail_cash_price, slug, legacy_id, installment_policy)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9,$10,$11,$12,$13,$14)`,
              [id, house, row.name, sku, row.category || row.product_type || "پوشاک", row.description || "", Math.round(Number(row.wholesale_price || row.price || 0)), owner, retailEnabled, wholesaleEnabled, owner === "kolbe" ? Math.round(Number(row.price || 0)) : null, slug, row.legacy_id || null, row.installment_policy || "disabled"],
            );
            created += 1;
          }
          if (retailEnabled) {
            await client.query(
              `INSERT INTO retail_product (id, name, price, sale_price, slug, category, description, owner_type, retail_enabled, installment_policy)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'kolbe',true,$8)
               ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, sale_price=EXCLUDED.sale_price, slug=EXCLUDED.slug, installment_policy=EXCLUDED.installment_policy, updated_at=now()`,
              [id, row.name, Math.round(Number(row.price || 0)), row.sale_price ? Math.round(Number(row.sale_price)) : null, slug, row.category || "پوشاک", row.description || "", row.installment_policy || "disabled"],
            );
          }
          if (row.size || row.color || row.stock) {
            const variantSku = `${sku}-${row.size || "OS"}`.toUpperCase();
            const variantId = makeId("var");
            await client.query(
              `INSERT INTO supplier_variant (id, product_id, sku, color, size, cost) VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (sku) DO UPDATE SET color=EXCLUDED.color, size=EXCLUDED.size`,
              [variantId, id, variantSku, row.color || "بدون رنگ", row.size || "تک‌سایز", Math.round(Number(row.price || 0))],
            );
            const variant = (await client.query("SELECT id FROM supplier_variant WHERE sku=$1", [variantSku])).rows[0];
            const warehouse = row.warehouse
              ? (await client.query("SELECT id FROM warehouse WHERE id=$1 OR name=$1", [String(row.warehouse)])).rows[0]
              : (await client.query("SELECT id FROM warehouse ORDER BY id LIMIT 1")).rows[0];
            if (variant && warehouse && row.stock !== "" && row.stock != null) {
              await client.query(
                `INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand) VALUES ($1,$2,$3)
                 ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand=EXCLUDED.on_hand, updated_at=now()`,
                [variant.id, warehouse.id, Math.max(0, Number(row.stock))],
              );
            }
          }
        }
      }
    }
    if (job.kind !== "products" && !rowIssues.some((item) => item.severity === "error")) valid += 1;
    issues.push(...rowIssues);
    if (write && index % 25 === 0) await client.query("UPDATE import_job SET cursor_row=$2, progress=$3 WHERE id=$1", [job.id, index + 1, Math.round(((index + 1) / records.length) * 100)]);
  }
  return { issues, valid, created, updated };
}

async function saveRedirect(client: PoolClient, source: string, target: string, status: number, actorId: string | null) {
  try {
    await assertRedirectSafe(source, target, status);
  } catch (error) {
    if (error instanceof Error && ["INVALID_REDIRECT", "REDIRECT_LOOP"].includes(error.message)) throw new DiscoveryError(422, error.message);
    throw error;
  }
  await client.query(
    `INSERT INTO seo_redirect (id, source_path, target_path, status_code, actor_id) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (source_path) WHERE active DO UPDATE SET target_path=EXCLUDED.target_path, status_code=EXCLUDED.status_code`,
    [makeId("sred"), source, target, status, actorId],
  );
}

const running = new Set<string>();

export async function processImportJob(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const job = (await rows<any>("SELECT * FROM import_job WHERE id=$1", [id]))[0];
    if (!job || job.status === "completed") return;
    const started = Date.now();
    await rows("UPDATE import_job SET status='running', started_at=COALESCE(started_at, now()) WHERE id=$1", [id]);
    const bytes = job.file_bytes ? Buffer.from(job.file_bytes) : Buffer.from(job.file_text ?? "", "utf8");
    const parsed = await recordsFromFile(job.filename, bytes);
    const result = await transaction(async (client) => validateImport(client, job, parsed.records, !job.dry_run));
    const errors = result.issues.filter((item) => item.severity === "error");
    const warnings = result.issues.filter((item) => item.severity === "warning");
    if (!job.dry_run) {
      await transaction(async (client) => {
        await client.query("DELETE FROM import_error WHERE job_id=$1", [id]);
        for (const issue of result.issues) {
          await client.query(
            "INSERT INTO import_error (id, job_id, row_number, severity, code, message, row_data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [makeId("ierr"), id, issue.row, issue.severity, issue.code, issue.message, issue.data],
          );
        }
      });
    }
    await rows(
      `UPDATE import_job SET status=$2, progress=100, cursor_row=$3, valid_count=$4, warning_count=$5, error_count=$6, created_count=$7, updated_count=$8, finished_at=now(), duration_ms=$9, report=$10 WHERE id=$1`,
      [id, job.dry_run ? "dry_ran" : "completed", parsed.records.length, result.valid, warnings.length, errors.length, job.dry_run ? 0 : result.created, job.dry_run ? 0 : result.updated, Date.now() - started, { valid: result.valid, warnings: warnings.length, errors: errors.length, issues: result.issues.slice(0, 200) }],
    );
  } catch (error) {
    await rows("UPDATE import_job SET status='failed', report=$2, finished_at=now() WHERE id=$1", [id, { message: error instanceof Error ? error.message : "IMPORT_FAILED" }]);
  } finally {
    running.delete(id);
  }
}

function enqueueImport(id: string) {
  setTimeout(() => { void processImportJob(id); }, 10);
}

async function requireAdmin(actor: Actor) {
  if (!actor || actor.role !== "admin") throw new DiscoveryError(401, "UNAUTHORIZED");
  return actor;
}

async function requireStaff(actor: Actor, permission: string) {
  const admin = await requireAdmin(actor);
  const grants = await rows<{ code: string }>("SELECT code FROM staff_permission WHERE actor_id=$1", [admin.sub]);
  if (grants.length && !grants.some((grant) => grant.code === permission || grant.code === "*")) throw new DiscoveryError(403, "FORBIDDEN");
  return admin;
}

export function originOf(req: { url: string; headers: { get(name: string): string | null } }) {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) return `${req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"}://${forwardedHost}`;
  return new URL(req.url).origin;
}

async function jsonBody(req: NextRequest): Promise<Json> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Json : {};
  } catch {
    return {};
  }
}

function response(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

export async function handleDiscoveryRequest(req: NextRequest, path: string, actor: Actor) {
  try {
    await ensureCommerceSchema();
    const method = req.method;
    const url = new URL(req.url);
    if (path === "catalog/products" && method === "GET") {
      const channel = url.searchParams.get("channel");
      if (channel === "retail") {
        const products = await rows<any>(
          `SELECT id, name, price, sale_price, slug, category, owner_type, retail_enabled, wholesale_enabled FROM retail_product
           WHERE active AND owner_type='kolbe' AND retail_enabled
           AND NOT EXISTS (SELECT 1 FROM supplier_product s WHERE s.id=retail_product.id AND s.owner_type='supplier')
           ORDER BY name`,
        );
        return response({ channel: "retail", products: products.map((product) => ({ ...product, price: Number(product.price), ownerType: "kolbe" })) });
      }
      if (channel === "wholesale") {
        const products = await rows<any>(
          `SELECT id, name, sku, wholesale_price, owner_type, retail_enabled, wholesale_enabled, status FROM supplier_product
           WHERE status='approved' AND wholesale_enabled AND owner_type IN ('supplier','kolbe') ORDER BY name`,
        );
        return response({ channel: "wholesale", products });
      }
      throw new DiscoveryError(422, "CHANNEL_REQUIRED");
    }
    if (path === "pricing/quote" && method === "POST") {
      const body = await jsonBody(req);
      const quoted = await transaction(async (client) => decideRetailPrice(client, String(body.id ?? ""), String(body.payMethod ?? "gateway")));
      if (!quoted.ok) throw new DiscoveryError(quoted.status, quoted.error);
      return response({ snapshot: quoted.snapshot, ignoredClientPrice: body.price != null });
    }
    if (path === "auth/password/otp" && method === "POST") {
      const body = await jsonBody(req);
      const phone = String(body.phone ?? "").replace(/\D/g, "");
      const user = (await rows<any>("SELECT id, password_reset_required FROM account_user WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g')=$1 LIMIT 1", [phone]))[0];
      if (!user) return response({ sent: true });
      const recent = (await rows<any>("SELECT COUNT(*)::int AS count FROM password_reset_challenge WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [user.id]))[0];
      if (Number(recent.count) >= 5) throw new DiscoveryError(429, "OTP_RATE_LIMIT");
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await rows(
        "INSERT INTO password_reset_challenge (id, user_id, phone, code_hash, expires_at) VALUES ($1,$2,$3,$4, now() + interval '10 minutes')",
        [makeId("otp"), user.id, phone, createHash("sha256").update(code).digest("hex")],
      );
      return response({ sent: true, delivery: "integration_center", ...(process.env.NODE_ENV === "test" ? { code } : {}) });
    }
    if (path === "auth/password/reset" && method === "POST") {
      const body = await jsonBody(req);
      const phone = String(body.phone ?? "").replace(/\D/g, "");
      const code = String(body.code ?? "");
      if (String(body.password ?? "").length < 8) throw new DiscoveryError(422, "WEAK_PASSWORD");
      const challenge = (await rows<any>(
        "SELECT * FROM password_reset_challenge WHERE phone=$1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [phone],
      ))[0];
      const hash = createHash("sha256").update(code).digest("hex");
      if (!challenge || challenge.code_hash !== hash) throw new DiscoveryError(422, "INVALID_OTP");
      const secret = passwordRecord(String(body.password));
      await transaction(async (client) => {
        await client.query("UPDATE account_user SET password_hash=$2, salt=$3, password_reset_required=false, updated_at=now() WHERE id=$1", [challenge.user_id, secret.passwordHash, secret.salt]);
        await client.query("UPDATE password_reset_challenge SET used_at=now() WHERE id=$1", [challenge.id]);
      });
      return response({ reset: true });
    }
    const media = path.match(/^media\/([^/]+)$/);
    if (media && method === "GET") {
      const asset = (await rows<any>("SELECT mime, bytes, filename FROM media_asset WHERE id=$1", [media[1]]))[0];
      if (!asset?.bytes) throw new DiscoveryError(404, "NOT_FOUND");
      return new Response(asset.bytes, { headers: { "content-type": asset.mime || "application/octet-stream", "cache-control": "public, max-age=86400" } });
    }
    if (path === "seo/sitemap.xml" && method === "GET") return new Response(renderSitemapIndex(originOf(req)), { headers: { "content-type": "application/xml; charset=utf-8" } });
    const sitemap = path.match(/^seo\/sitemaps\/(products|categories|pages|blog|images)\.xml$/);
    if (sitemap && method === "GET") return new Response(renderUrlSet(await sitemapEntries(sitemap[1], originOf(req))), { headers: { "content-type": "application/xml; charset=utf-8" } });
    if (path === "seo/robots.txt" && method === "GET") {
      return new Response(await robotsBody(), { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const publicProduct = path.match(/^seo\/products\/([^/]+)$/);
    if (publicProduct && method === "GET") {
      const redirectTo = await resolveRedirect(`/product/${decodeURIComponent(publicProduct[1])}`);
      if (redirectTo?.status_code === 410) return response({ gone: true }, 410);
      if (redirectTo) return response({ redirect: redirectTo.target_path, status: redirectTo.status_code }, redirectTo.status_code);
      const { loadPublicProduct } = await import("./seo-discovery");
      const product = await loadPublicProduct(decodeURIComponent(publicProduct[1]));
      if (!product) {
        await recordNotFound(`/product/${publicProduct[1]}`, req.headers.get("referer"));
        throw new DiscoveryError(404, "NOT_FOUND");
      }
      const { loadShippingOffers } = await import("./seo-discovery");
      const html = renderProductDocument(product, originOf(req), url.searchParams, await loadShippingOffers());
      if (!html) throw new DiscoveryError(404, "VARIANT_NOT_FOUND");
      return response({ product, html, preview: googlePreview(product.seoTitle, product.seoDescription, `${originOf(req)}/product/${product.slug}`) });
    }
    if (path === "seo/not-found" && method === "POST") {
      const body = await jsonBody(req);
      await recordNotFound(String(body.path ?? url.pathname), body.referrer ?? req.headers.get("referer"));
      return response({ recorded: true }, 202);
    }

    if (path === "admin/channels" && method === "GET") {
      await requireAdmin(actor);
      const supplierProducts = await rows("SELECT id, name, sku, owner_type, retail_enabled, wholesale_enabled, retail_cash_price, wholesale_price, installment_policy, installment_count, moq, series_code, status FROM supplier_product ORDER BY updated_at DESC LIMIT 200");
      const retailProducts = await rows("SELECT id, name, price, sale_price, owner_type, retail_enabled, wholesale_enabled, installment_policy, installment_count, slug FROM retail_product ORDER BY name");
      return response({
        policies: ["disabled", "enabled", "disabled_when_discounted", "enabled_when_discounted"],
        supplierProducts, retailProducts,
      });
    }
    if (path === "admin/channels" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!POLICIES.has(body.installmentPolicy ?? "disabled") && body.installmentPolicy) throw new DiscoveryError(422, "INVALID_POLICY");
      if (body.id) {
        const current = (await rows<any>("SELECT * FROM supplier_product WHERE id=$1", [body.id]))[0];
        if (current?.owner_type === "supplier" && (body.retailEnabled === true || body.channel === "retail" || body.channel === "both")) throw new DiscoveryError(422, "CHANNEL_FORBIDDEN");
        if (current) {
          await rows(
            `UPDATE supplier_product SET retail_enabled=CASE WHEN owner_type='supplier' THEN false ELSE $2 END,
               wholesale_enabled=CASE WHEN owner_type='supplier' THEN true ELSE $3 END,
               retail_cash_price=CASE WHEN owner_type='supplier' THEN NULL ELSE $4 END,
               installment_policy=COALESCE($5, installment_policy), installment_count=COALESCE($6, installment_count), moq=COALESCE($7, moq), series_code=COALESCE($8, series_code), updated_at=now()
             WHERE id=$1`,
            [body.id, Boolean(body.retailEnabled), body.wholesaleEnabled !== false, body.retailCashPrice ?? null, body.installmentPolicy ?? null, body.installmentCount ?? null, body.moq ?? null, body.seriesCode ?? null],
          );
          return response({ updated: true });
        }
      }
      const id = makeId("prd");
      const sku = String(body.sku || id).toUpperCase();
      await rows(
        `INSERT INTO supplier_product (id, supplier_id, name, sku, category, description, wholesale_price, status, owner_type, retail_enabled, wholesale_enabled, retail_cash_price, installment_policy, installment_count, moq, series_code, slug)
         VALUES ($1,'sup_kolbe',$2,$3,$4,$5,$6,'approved','kolbe',$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, body.name, sku, body.category || "پوشاک", body.description || "", Math.round(Number(body.wholesalePrice ?? 0)), body.channel !== "wholesale", body.channel !== "retail", body.retailCashPrice ?? body.price ?? null, body.installmentPolicy || "disabled", body.installmentCount || 4, body.moq || 1, body.seriesCode || null, slugify(body.slug || body.name || sku)],
      );
      if (body.channel !== "wholesale") {
        await rows(
          `INSERT INTO retail_product (id, name, price, sale_price, slug, category, description, installment_policy, installment_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET price=EXCLUDED.price, sale_price=EXCLUDED.sale_price, installment_policy=EXCLUDED.installment_policy`,
          [id, body.name, Math.round(Number(body.price ?? body.retailCashPrice ?? 0)), body.salePrice ?? null, slugify(body.slug || body.name || sku), body.category || "پوشاک", body.description || "", body.installmentPolicy || "disabled", body.installmentCount || 4],
        );
      }
      const { emitEvent } = await import("./platform-360");
      await emitEvent("product.created", "product", id, { name: body.name, sku });
      return response({ id }, 201);
    }
    const channelItem = path.match(/^admin\/channels\/([^/]+)$/);
    if (channelItem && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const current = (await rows<any>("SELECT * FROM supplier_product WHERE id=$1", [channelItem[1]]))[0] ?? (await rows<any>("SELECT * FROM retail_product WHERE id=$1", [channelItem[1]]))[0];
      if (!current) throw new DiscoveryError(404, "NOT_FOUND");
      if (current.owner_type === "supplier") throw new DiscoveryError(422, "CHANNEL_FORBIDDEN");
      if (current.sku) {
        await rows(
          `UPDATE supplier_product SET retail_enabled=$2, wholesale_enabled=$3, installment_policy=COALESCE($4, installment_policy), installment_count=COALESCE($5, installment_count), updated_at=now() WHERE id=$1`,
          [current.id, Boolean(body.retailEnabled), Boolean(body.wholesaleEnabled), body.installmentPolicy ?? null, body.installmentCount ?? null],
        );
      }
      await rows(
        `UPDATE retail_product SET retail_enabled=$2, installment_policy=COALESCE($3, installment_policy), installment_count=COALESCE($4, installment_count), sale_price=$5, updated_at=now() WHERE id=$1`,
        [current.id, body.retailEnabled !== false, body.installmentPolicy ?? null, body.installmentCount ?? null, body.salePrice ?? current.sale_price ?? null],
      );
      return response({ updated: true });
    }

    if (path === "admin/imports" && method === "GET") {
      await requireAdmin(actor);
      const jobs = await rows("SELECT id, kind, filename, format, mode, status, admin_id, progress, total_rows, valid_count, warning_count, error_count, created_count, updated_count, dry_run, duration_ms, created_at, finished_at FROM import_job ORDER BY created_at DESC LIMIT 100");
      return response({ jobs });
    }
    if (path === "admin/imports" && method === "POST") {
      const staff = await requireAdmin(actor);
      const body = await jsonBody(req);
      const bytes = Buffer.from(String(body.contentBase64 ?? ""), "base64");
      const parsed = await recordsFromFile(String(body.filename ?? "import.csv"), bytes);
      const id = makeId("imp");
      await rows(
        `INSERT INTO import_job (id, kind, filename, format, mode, purpose, status, admin_id, file_text, file_bytes, total_rows)
         VALUES ($1,$2,$3,$4,$5,$6,'uploaded',$7,$8,$9,$10)`,
        [id, body.kind || "products", body.filename || "import.csv", parsed.format, body.mode || "upsert", body.purpose || "balance", staff.sub, parsed.format === "csv" ? bytes.toString("utf8") : null, bytes, parsed.records.length],
      );
      return response({ id, format: parsed.format, headers: parsed.headers, suggestions: suggestMapping(parsed.headers), preview: parsed.records.slice(0, 8), confirmationRequired: true }, 201);
    }
    const importMap = path.match(/^admin\/imports\/([^/]+)\/map$/);
    if (importMap && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!body.mapping || typeof body.mapping !== "object") throw new DiscoveryError(422, "MAPPING_REQUIRED");
      await rows("UPDATE import_job SET mapping=$2, mode=COALESCE($3, mode), purpose=COALESCE($4, purpose), status='mapped' WHERE id=$1", [importMap[1], body.mapping, body.mode ?? null, body.purpose ?? null]);
      return response({ mapped: true });
    }
    const importRun = path.match(/^admin\/imports\/([^/]+)\/(dry-run|run|resume)$/);
    if (importRun && method === "POST") {
      await requireAdmin(actor);
      const job = (await rows<any>("SELECT * FROM import_job WHERE id=$1", [importRun[1]]))[0];
      if (!job) throw new DiscoveryError(404, "NOT_FOUND");
      if (!job.mapping || !Object.keys(job.mapping).length) throw new DiscoveryError(422, "MAPPING_REQUIRED");
      const dry = importRun[2] === "dry-run";
      await rows("UPDATE import_job SET dry_run=$2, status=$3, cursor_row=CASE WHEN $4 THEN cursor_row ELSE 0 END WHERE id=$1", [job.id, dry, dry ? "queued" : "queued", importRun[2] === "resume"]);
      const asyncJob = req.headers.get("x-import-async") === "1" || job.total_rows > 250;
      if (asyncJob && !dry) {
        enqueueImport(job.id);
        return response({ id: job.id, status: "queued" }, 202);
      }
      await processImportJob(job.id);
      const done = (await rows<any>("SELECT id, status, valid_count, warning_count, error_count, created_count, updated_count, duration_ms, report FROM import_job WHERE id=$1", [job.id]))[0];
      return response(done);
    }
    const importErrors = path.match(/^admin\/imports\/([^/]+)\/errors$/);
    if (importErrors && method === "GET") {
      await requireAdmin(actor);
      const issues = await rows("SELECT row_number, severity, code, message, row_data FROM import_error WHERE job_id=$1 ORDER BY row_number", [importErrors[1]]);
      const csv = ["row,severity,code,message", ...issues.map((issue: any) => `${issue.row_number},${issue.severity},${issue.code},"${String(issue.message).replaceAll('"', '""')}"`)].join("\n");
      return response({ filename: `import-${importErrors[1]}-errors.csv`, csv, rows: issues });
    }

    if (path === "admin/warehouses" && method === "GET") {
      await requireAdmin(actor);
      return response({ warehouses: await rows("SELECT * FROM warehouse ORDER BY name") });
    }
    if (path === "admin/warehouses" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const id = makeId("wh");
      await rows("INSERT INTO warehouse (id, name, city) VALUES ($1,$2,$3)", [id, body.name, body.city || null]);
      return response({ id }, 201);
    }
    if (path === "admin/inventory/adjust" && method === "POST") {
      const staff = await requireAdmin(actor);
      const body = await jsonBody(req);
      await transaction(async (client) => {
        for (const line of body.lines ?? []) {
          const variant = (await client.query("SELECT id FROM supplier_variant WHERE sku=$1", [String(line.sku).toUpperCase()])).rows[0];
          const warehouse = (await client.query("SELECT id FROM warehouse WHERE id=$1 OR name=$1", [line.warehouse])).rows[0];
          if (!variant || !warehouse) throw new DiscoveryError(422, "MISSING_PARENT");
          const delta = Math.trunc(Number(line.delta));
          if (!Number.isFinite(delta)) throw new DiscoveryError(422, "INVALID_QUANTITY");
          await client.query(
            `INSERT INTO inventory_balance (variant_id, warehouse_id, on_hand) VALUES ($1,$2,$3)
             ON CONFLICT (variant_id, warehouse_id) DO UPDATE SET on_hand=GREATEST(0, inventory_balance.on_hand+$3), updated_at=now()`,
            [variant.id, warehouse.id, delta],
          );
          await client.query("INSERT INTO inventory_adjustment (id, variant_id, warehouse_id, delta, reason, actor_id) VALUES ($1,$2,$3,$4,$5,$6)", [makeId("adj"), variant.id, warehouse.id, delta, line.reason || "تعدیل", staff.sub]);
        }
      });
      return response({ adjusted: true });
    }
    const variantStock = path.match(/^admin\/variants\/([^/]+)\/inventory$/);
    if (variantStock && method === "GET") {
      await requireAdmin(actor);
      const balances = await rows<any>("SELECT b.*, w.name AS warehouse_name FROM inventory_balance b JOIN warehouse w ON w.id=b.warehouse_id WHERE b.variant_id=$1 ORDER BY w.name", [variantStock[1]]);
      const onHand = balances.reduce((sum, row) => sum + Number(row.on_hand), 0);
      const reserved = balances.reduce((sum, row) => sum + Number(row.reserved), 0);
      return response({ balances, onHand, reserved, available: onHand - reserved, source: balances.length ? "wms" : "none" });
    }

    if (path.startsWith("admin/seo")) return await handleSeoAdmin(req, path, actor);
    throw new DiscoveryError(404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof DiscoveryError) return response({ error: error.message }, error.status);
    if (error instanceof Error && ["INVALID_REDIRECT", "REDIRECT_LOOP"].includes(error.message)) return response({ error: error.message }, 422);
    console.error("discovery error", error);
    return response({ error: "INTERNAL_ERROR" }, 500);
  }
}

async function handleSeoAdmin(req: NextRequest, path: string, actor: Actor) {
  const method = req.method;
  const url = new URL(req.url);
  if (path === "admin/seo/documents" && method === "GET") {
    await requireStaff(actor, "seo:read");
    const documents = await rows("SELECT * FROM seo_document ORDER BY updated_at DESC LIMIT 200");
    return response({ documents, permissions: ["seo:read", "seo:manage", "seo:redirects", "seo:technical", "seo:integrations"] });
  }
  if (path === "admin/seo/documents" && method === "POST") {
    const staff = await requireStaff(actor, "seo:manage");
    const body = await jsonBody(req);
    const current = body.id ? (await rows<any>("SELECT * FROM seo_document WHERE id=$1", [body.id]))[0] : null;
    const id = current?.id ?? makeId("seod");
    const slug = body.slug ? slugify(body.slug) : current?.slug;
    if (current?.slug && slug && current.slug !== slug) await transaction(async (client) => saveRedirect(client, `/${current.entity_type}/${current.slug}`, `/${body.entityType || current.entity_type}/${slug}`, 301, staff.sub));
    await rows(
      `INSERT INTO seo_document (id, entity_type, entity_id, slug, seo_title, meta_description, canonical, robots_index, robots_follow, h1, h1_count, parent_id, links, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET seo_title=EXCLUDED.seo_title, meta_description=EXCLUDED.meta_description, canonical=EXCLUDED.canonical, robots_index=EXCLUDED.robots_index, robots_follow=EXCLUDED.robots_follow, h1=EXCLUDED.h1, slug=EXCLUDED.slug, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [id, body.entityType || current?.entity_type || "page", body.entityId ?? current?.entity_id ?? null, slug ?? null, body.seoTitle ?? null, body.metaDescription ?? null, body.canonical ?? null, body.index !== false, body.follow !== false, body.h1 ?? null, body.h1Count ?? 1, body.parentId ?? null, JSON.stringify(body.links ?? []), staff.sub],
    );
    if (current) {
      for (const field of ["seo_title", "meta_description", "canonical", "slug"] as const) {
        const next = field === "seo_title" ? body.seoTitle : field === "meta_description" ? body.metaDescription : field === "canonical" ? body.canonical : slug;
        if (next != null && next !== current[field]) await rows("INSERT INTO seo_change (id, document_id, actor_id, field, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6)", [makeId("schg"), id, staff.sub, field, current[field], String(next)]);
      }
    }
    const title = body.seoTitle || "";
    const description = body.metaDescription || "";
    return response({ id, preview: googlePreview(title, description, body.canonical || `/${slug ?? ""}`) }, current ? 200 : 201);
  }
  if (path === "admin/seo/templates" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response({ templates: await rows("SELECT * FROM seo_template ORDER BY entity_type") });
  }
  if (path === "admin/seo/templates" && method === "POST") {
    await requireStaff(actor, "seo:manage");
    const body = await jsonBody(req);
    const id = body.id || makeId("stpl");
    await rows(
      `INSERT INTO seo_template (id, entity_type, title_template, description_template) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET title_template=EXCLUDED.title_template, description_template=EXCLUDED.description_template, updated_at=now()`,
      [id, body.entityType || "product", body.titleTemplate, body.descriptionTemplate],
    );
    return response({ id });
  }
  if (path === "admin/seo/redirects" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response({ redirects: await rows("SELECT * FROM seo_redirect ORDER BY created_at DESC LIMIT 200") });
  }
  if (path === "admin/seo/redirects" && method === "POST") {
    const staff = await requireStaff(actor, "seo:redirects");
    const body = await jsonBody(req);
    await transaction(async (client) => saveRedirect(client, body.source, body.target ?? "", Number(body.status ?? 301), staff.sub));
    return response({ saved: true }, 201);
  }
  if (path === "admin/seo/robots" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response({ body: await robotsBody(), warning: "robots.txt صفحه را از ایندکس خارج نمی‌کند. برای حذف از نتایج از noindex یا کنترل دسترسی استفاده کنید." });
  }
  if (path === "admin/seo/robots" && method === "POST") {
    await requireStaff(actor, "seo:technical");
    const body = await jsonBody(req);
    await rows(
      `INSERT INTO site_setting (setting_key, value, updated_by) VALUES ('seo_robots', $1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [{ body: String(body.body ?? "") }, actor?.sub],
    );
    return response({ saved: true, warning: "ذخیره robots.txt به‌تنهایی deindex ایجاد نمی‌کند." });
  }
  if (path === "admin/seo/facets" && method === "GET") {
    await requireStaff(actor, "seo:read");
    const value = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='seo_facets'"))[0]?.value ?? {};
    return response({ facets: value, note: "ترکیب فیلترهای غیرایندکس در سایت‌مپ نمی‌آید و کنونیکال آن‌ها صفحه تمیز است." });
  }
  if (path === "admin/seo/facets" && method === "POST") {
    await requireStaff(actor, "seo:technical");
    const body = await jsonBody(req);
    await rows(
      `INSERT INTO site_setting (setting_key, value, updated_by) VALUES ('seo_facets', $1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [body.facets, actor?.sub],
    );
    return response({ saved: true });
  }
  if (path === "admin/seo/crawl" && method === "POST") {
    const staff = await requireStaff(actor, "seo:technical");
    const body = await jsonBody(req);
    if (body.schedule) {
      await rows(
        `INSERT INTO site_setting (setting_key, value, updated_by) VALUES ('seo_crawl', $1, $2)
         ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [{ schedule: body.schedule }, staff.sub],
      );
    }
    return response(await runSeoCrawl(staff.sub));
  }
  if (path === "admin/seo/issues" && method === "GET") {
    await requireStaff(actor, "seo:read");
    const schedule = (await rows<any>("SELECT value FROM site_setting WHERE setting_key='seo_crawl'"))[0]?.value ?? {};
    const last = (await rows<any>("SELECT finished_at FROM seo_crawl ORDER BY finished_at DESC LIMIT 1"))[0];
    const due = schedule.schedule === "daily" || schedule.schedule === "weekly";
    const age = last?.finished_at ? Date.now() - new Date(last.finished_at).getTime() : Infinity;
    if (due && age > (schedule.schedule === "daily" ? 86_400_000 : 7 * 86_400_000)) await runSeoCrawl(actor!.sub);
    const issues = await rows("SELECT * FROM seo_issue WHERE status='open' ORDER BY severity, last_seen_at DESC LIMIT 300");
    const latest = (await rows<any>("SELECT * FROM seo_crawl ORDER BY finished_at DESC LIMIT 1"))[0];
    return response({ issues, latest, health: await seoHealth() });
  }
  if (path === "admin/seo/health" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response(await seoHealth());
  }
  if (path === "admin/seo/vitals" && method === "POST") {
    await requireStaff(actor, "seo:technical");
    const body = await jsonBody(req);
    if (body.lcpMs == null && body.inpMs == null && body.cls == null) throw new DiscoveryError(422, "MEASUREMENT_REQUIRED");
    await rows("INSERT INTO seo_vital (id, path, lcp_ms, inp_ms, cls, source) VALUES ($1,$2,$3,$4,$5,'recorded')", [makeId("vital"), body.path || "/", body.lcpMs ?? null, body.inpMs ?? null, body.cls ?? null]);
    return response({ saved: true, thresholds: { lcpMs: 2500, inpMs: 200, cls: 0.1 } });
  }
  if (path === "admin/seo/not-found" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response({ misses: await rows("SELECT * FROM seo_404 ORDER BY hit_count DESC, last_seen_at DESC LIMIT 100") });
  }
  if (path === "admin/seo/changes" && method === "GET") {
    await requireStaff(actor, "seo:read");
    return response({ changes: await rows("SELECT * FROM seo_change ORDER BY created_at DESC LIMIT 100") });
  }
  if (path === "admin/seo/export" && method === "GET") {
    await requireStaff(actor, "seo:read");
    const documents = await rows<any>("SELECT entity_type, entity_id, slug, seo_title, meta_description, canonical, robots_index, robots_follow FROM seo_document ORDER BY entity_type");
    const csv = ["entity_type,entity_id,slug,seo_title,meta_description,canonical,index,follow", ...documents.map((doc) => [doc.entity_type, doc.entity_id, doc.slug, doc.seo_title, doc.meta_description, doc.canonical, doc.robots_index, doc.robots_follow].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    return response({ filename: "seo-metadata.csv", csv });
  }
  if (path === "admin/seo/integrations" && method === "POST") {
    await requireStaff(actor, "seo:integrations");
    const body = await jsonBody(req);
    if (body.secret || body.apiKey || body.token || body.password) throw new DiscoveryError(422, "SECRET_VIA_INTEGRATION_CENTER");
    const kind = body.kind === "merchant" ? "merchant" : "search_console";
    await rows(
      `INSERT INTO site_setting (setting_key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (setting_key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [`seo_${kind}`, { property: body.property ?? null, status: "pending_connection", connected: false }, actor?.sub],
    );
    const sample = (await rows<any>("SELECT id, name, price FROM retail_product WHERE active ORDER BY name LIMIT 1"))[0];
    return response({ status: "pending_connection", merchant: kind === "merchant" ? merchantReadiness({ name: sample?.name, price: sample ? Number(sample.price) : null, image: null, available: sample ? 1 : null }) : undefined });
  }
  if (path === "admin/seo/media" && method === "POST") {
    await requireStaff(actor, "seo:manage");
    const body = await jsonBody(req);
    const stored = [];
    const files = Array.isArray(body.files) ? body.files : [];
    if (body.zipBase64) {
      const unzipped = unzip(Buffer.from(String(body.zipBase64), "base64"));
      files.push(...unzipped.filter((file) => /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)).map((file) => ({ filename: file.name.split("/").pop(), contentBase64: file.data.toString("base64") })));
    }
    for (const file of files) {
      const bytes = Buffer.from(String(file.contentBase64 ?? ""), "base64");
      const size = imageSize(bytes);
      const id = makeId("media");
      await rows(
        `INSERT INTO media_asset (id, entity_id, role, filename, mime, alt, title, caption, variant_color, width, height, byte_size, bytes)
         VALUES ($1,$2,'original',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, body.entityId ?? null, file.filename || "image", file.mime || "image/jpeg", file.alt || body.alt || null, file.title || null, file.caption || null, file.variantColor || body.variantColor || null, size?.width ?? null, size?.height ?? null, bytes.length, bytes],
      );
      const derived = await transcode(bytes);
      if (derived.webp) await rows("INSERT INTO media_asset (id, entity_id, role, parent_id, filename, mime, width, height, byte_size, bytes, alt) VALUES ($1,$2,'webp',$3,$4,'image/webp',$5,$6,$7,$8,$9)", [makeId("media"), body.entityId ?? null, id, `${file.filename || "image"}.webp`, derived.width ?? null, derived.height ?? null, derived.webp.length, derived.webp, file.alt || null]);
      if (derived.avif) await rows("INSERT INTO media_asset (id, entity_id, role, parent_id, filename, mime, width, height, byte_size, bytes) VALUES ($1,$2,'avif',$3,$4,'image/avif',$5,$6,$7,$8)", [makeId("media"), body.entityId ?? null, id, `${file.filename || "image"}.avif`, derived.width ?? null, derived.height ?? null, derived.avif.length, derived.avif]);
      if (derived.thumb) await rows("INSERT INTO media_asset (id, entity_id, role, parent_id, filename, mime, width, byte_size, bytes) VALUES ($1,$2,'thumb',$3,$4,'image/webp',320,$5,$6)", [makeId("media"), body.entityId ?? null, id, `thumb-${file.filename || "image"}.webp`, derived.thumb.length, derived.thumb]);
      stored.push({ id, width: size?.width ?? derived.width ?? null, height: size?.height ?? derived.height ?? null, pipeline: derived.pipeline });
    }
    if (body.remoteUrl) {
      if (!publicImageUrl(String(body.remoteUrl))) throw new DiscoveryError(422, "UNREACHABLE_IMAGE");
      const fetched = await fetch(String(body.remoteUrl), { signal: AbortSignal.timeout(4000) });
      if (!fetched.ok) throw new DiscoveryError(422, "UNREACHABLE_IMAGE");
      const bytes = Buffer.from(await fetched.arrayBuffer());
      const id = makeId("media");
      await rows(
        "INSERT INTO media_asset (id, entity_id, role, filename, mime, alt, byte_size, bytes) VALUES ($1,$2,'original',$3,$4,$5,$6,$7)",
        [id, body.entityId ?? null, new URL(String(body.remoteUrl)).pathname.split("/").pop() || "remote", fetched.headers.get("content-type"), body.alt || null, bytes.length, bytes],
      );
      stored.push({ id, remote: true });
    }
    return response({ stored });
  }
  throw new DiscoveryError(404, "NOT_FOUND");
}

function unzip(buffer: Buffer) {
  const files: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const compressed = buffer.subarray(start, start + compSize);
    let data = compressed;
    if (method === 8) data = inflateRawSync(compressed);
    if (!name.endsWith("/") && (method === 0 || method === 8)) files.push({ name, data: Buffer.from(data) });
    offset = start + compSize;
  }
  return files;
}

function imageSize(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}

async function transcode(bytes: Buffer) {
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(bytes, { failOn: "none" });
    const meta = await image.metadata();
    const webp = await image.clone().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    const avif = await image.clone().resize({ width: 1600, withoutEnlargement: true }).avif({ quality: 48 }).toBuffer();
    const thumb = await image.clone().resize({ width: 320 }).webp({ quality: 70 }).toBuffer();
    return { width: meta.width, height: meta.height, webp, avif, thumb, pipeline: { resized: true, compressed: true, webp: true, avif: true, thumbnail: true } };
  } catch {
    return { width: null as number | null, height: null as number | null, webp: null as Buffer | null, avif: null as Buffer | null, thumb: null as Buffer | null, pipeline: { resized: false, compressed: false, webp: false, avif: false, thumbnail: false, reason: "IMAGE_WORKER_UNAVAILABLE" } };
  }
}

export async function publicSitemap(kind: "index" | "products" | "categories" | "pages" | "blog" | "images", origin: string) {
  await ensureCommerceSchema();
  if (kind === "index") return renderSitemapIndex(origin);
  return renderUrlSet(await sitemapEntries(kind, origin));
}

export async function publicRobots() {
  await ensureCommerceSchema();
  return robotsBody();
}

export async function publicProductHtml(slug: string, origin: string, query: URLSearchParams, referrer: string | null) {
  await ensureCommerceSchema();
  const { ensureOperationsSchema } = await import("./operations-center");
  await ensureOperationsSchema();
  const redirectTo = await resolveRedirect(`/product/${slug}`);
  if (redirectTo) return { kind: "redirect" as const, status: Number(redirectTo.status_code), target: redirectTo.target_path };
  const { loadPublicProduct } = await import("./seo-discovery");
  const product = await loadPublicProduct(slug);
  if (!product) {
    await recordNotFound(`/product/${slug}`, referrer);
    return { kind: "missing" as const };
  }
  const { loadShippingOffers } = await import("./seo-discovery");
  const html = renderProductDocument(product, origin, query, await loadShippingOffers());
  if (!html) return { kind: "missing" as const };
  return { kind: "html" as const, html };
}
