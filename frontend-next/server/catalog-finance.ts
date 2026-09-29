import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { database, makeId, rows, transaction } from "./database";
import { emitEvent } from "./platform-360";

const require = createRequire(import.meta.url);

export class CatalogFinanceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Actor = { sub: string; role: string } | null;
type Body = Record<string, any>;

const ATTRIBUTE_TYPES = new Set([
  "text", "textarea", "number", "decimal", "boolean", "single_select", "multi_select",
  "color", "date", "measurement", "file", "image", "video", "url",
]);
const RULE_STATUSES = new Set(["draft", "test", "active", "paused"]);
const TRIGGERS = new Set([
  "birthday", "spend_threshold", "first_purchase", "fifth_purchase", "inactive_60",
  "membership_expiry", "vip_upgrade", "cart_abandoned", "review_created", "high_rating",
  "low_rating", "returned_order",
]);
const ALLOCATION_METHODS = new Set(["weight", "quantity", "value", "volume", "equal"]);
const ACCOUNTS = [
  ["cash", "موجودی نقد", "asset"],
  ["receivable", "دریافتنی مشتری", "asset"],
  ["sales", "فروش", "income"],
  ["commission_revenue", "کارمزد", "income"],
  ["supplier_payable", "بدهی به تأمین‌کننده", "liability"],
  ["shipping_expense", "هزینه ارسال", "expense"],
  ["refund_expense", "بازپرداخت", "expense"],
  ["return_cost", "مرجوعی", "expense"],
  ["settlement_clearing", "تسویه در جریان", "liability"],
  ["supplier_advance", "پیش‌پرداخت تأمین‌کننده", "asset"],
  ["discount_cost", "هزینه تخفیف", "expense"],
  ["adjustment", "تعدیل", "expense"],
] as const;

let schemaReady: Promise<void> | null = null;

export function ensureCatalogFinanceSchema() {
  schemaReady ??= database().then((pool) => pool.connect()).then(async (client) => {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS attribute_definition (
          id text PRIMARY KEY, code text NOT NULL UNIQUE, label text NOT NULL, description text NOT NULL DEFAULT '',
          value_type text NOT NULL, unit text, required boolean NOT NULL DEFAULT false,
          searchable boolean NOT NULL DEFAULT false, filterable boolean NOT NULL DEFAULT false,
          variant_level boolean NOT NULL DEFAULT false, position integer NOT NULL DEFAULT 0,
          validation jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS attribute_option (
          id text PRIMARY KEY, attribute_id text NOT NULL, code text NOT NULL, label text NOT NULL,
          position integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
          UNIQUE (attribute_id, code)
        );
        CREATE TABLE IF NOT EXISTS spec_template (
          id text PRIMARY KEY, code text NOT NULL UNIQUE, name text NOT NULL, description text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS spec_group (
          id text PRIMARY KEY, template_id text NOT NULL, name text NOT NULL, position integer NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS spec_template_attribute (
          id text PRIMARY KEY, template_id text NOT NULL, group_id text, attribute_id text NOT NULL,
          position integer NOT NULL DEFAULT 0, required boolean,
          UNIQUE (template_id, attribute_id)
        );
        ALTER TABLE product_type ADD COLUMN IF NOT EXISTS spec_template_id text;
        CREATE TABLE IF NOT EXISTS product_spec_binding (
          product_id text PRIMARY KEY, template_id text NOT NULL, product_type_id text,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS product_attribute_value (
          product_id text NOT NULL, attribute_id text NOT NULL, value jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (product_id, attribute_id)
        );
        CREATE TABLE IF NOT EXISTS variant_attribute_value (
          variant_id text NOT NULL, attribute_id text NOT NULL, value jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (variant_id, attribute_id)
        );
        CREATE TABLE IF NOT EXISTS product_extra_attribute (
          id text PRIMARY KEY, product_id text NOT NULL, label text NOT NULL, value_type text NOT NULL,
          value jsonb NOT NULL, unit text, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS size_guide (
          id text PRIMARY KEY, code text NOT NULL, version integer NOT NULL, name text NOT NULL,
          guide_text text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT false,
          is_current boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (code, version)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS size_guide_current ON size_guide(code) WHERE is_current;
        CREATE TABLE IF NOT EXISTS size_guide_column (
          id text PRIMARY KEY, guide_id text NOT NULL, code text NOT NULL, label text NOT NULL,
          unit text, position integer NOT NULL DEFAULT 0, UNIQUE (guide_id, code)
        );
        CREATE TABLE IF NOT EXISTS size_guide_row (
          id text PRIMARY KEY, guide_id text NOT NULL, position integer NOT NULL DEFAULT 0, values jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS size_guide_media (
          id text PRIMARY KEY, guide_id text NOT NULL, kind text NOT NULL, media_id text, url text, caption text NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS product_size_guide (
          product_id text PRIMARY KEY, guide_code text NOT NULL, mode text NOT NULL,
          snapshot jsonb, updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE account_user ADD COLUMN IF NOT EXISTS marketing_sms boolean NOT NULL DEFAULT false;
        ALTER TABLE account_user ADD COLUMN IF NOT EXISTS transactional_sms boolean NOT NULL DEFAULT true;
        ALTER TABLE account_user ADD COLUMN IF NOT EXISTS unsubscribed boolean NOT NULL DEFAULT false;
        ALTER TABLE account_user ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;
        CREATE TABLE IF NOT EXISTS promotion_rule (
          id text PRIMARY KEY, name text NOT NULL, trigger_name text NOT NULL, status text NOT NULL DEFAULT 'draft',
          definition jsonb NOT NULL DEFAULT '{}', action jsonb NOT NULL DEFAULT '{}',
          daily_cap integer, audience_cap integer, cooldown_days integer, usage_limit integer,
          budget_cap bigint, expires_at timestamptz, requires_approval boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS promotion_run (
          id text PRIMARY KEY, rule_id text NOT NULL, dry_run boolean NOT NULL, matched integer NOT NULL,
          issued integer NOT NULL DEFAULT 0, status text NOT NULL, sample jsonb NOT NULL DEFAULT '[]',
          idempotency_key text, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS promotion_run_idem ON promotion_run(idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE TABLE IF NOT EXISTS personal_coupon (
          id text PRIMARY KEY, code text NOT NULL UNIQUE, rule_id text, owner_user_id text NOT NULL,
          percent numeric, amount bigint, max_discount bigint, single_use boolean NOT NULL DEFAULT true,
          used_at timestamptz, reserved_order text, expires_at timestamptz, minimum_order bigint NOT NULL DEFAULT 0,
          allowed_categories jsonb NOT NULL DEFAULT '[]', allowed_products jsonb NOT NULL DEFAULT '[]',
          installment_policy text NOT NULL DEFAULT 'allowed', created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS personal_coupon_open ON personal_coupon(rule_id, owner_user_id) WHERE used_at IS NULL;
        CREATE TABLE IF NOT EXISTS journal_account (
          code text PRIMARY KEY, label text NOT NULL, kind text NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounting_period (
          id text PRIMARY KEY, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
          status text NOT NULL DEFAULT 'open', closed_at timestamptz, closed_by text
        );
        CREATE TABLE IF NOT EXISTS journal_entry (
          id text PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), memo text NOT NULL,
          source_type text NOT NULL, source_id text NOT NULL, actor_id text, created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (source_type, source_id)
        );
        CREATE TABLE IF NOT EXISTS journal_line (
          id text PRIMARY KEY, entry_id text NOT NULL, account_code text NOT NULL,
          debit bigint NOT NULL DEFAULT 0, credit bigint NOT NULL DEFAULT 0,
          party_type text, party_id text, dimensions jsonb NOT NULL DEFAULT '{}',
          CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
        );
        CREATE TABLE IF NOT EXISTS settlement (
          id text PRIMARY KEY, supplier_id text NOT NULL, status text NOT NULL,
          gross bigint NOT NULL, commission bigint NOT NULL, shipping bigint NOT NULL,
          returns bigint NOT NULL, adjustments bigint NOT NULL, advances bigint NOT NULL, net bigint NOT NULL,
          due_on date, snapshot jsonb NOT NULL DEFAULT '{}', approved_by text, paid_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS settlement_line (
          id text PRIMARY KEY, settlement_id text NOT NULL, reference_type text NOT NULL, reference_id text NOT NULL,
          kind text NOT NULL, amount bigint NOT NULL, UNIQUE (reference_type, reference_id, kind)
        );
        CREATE TABLE IF NOT EXISTS settlement_exception (
          id text PRIMARY KEY, settlement_id text, supplier_id text NOT NULL, code text NOT NULL,
          detail jsonb NOT NULL DEFAULT '{}', resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS shipping_allocation (
          id text PRIMARY KEY, reference text NOT NULL, method text NOT NULL, total_fee bigint NOT NULL,
          snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS shipping_allocation_line (
          id text PRIMARY KEY, allocation_id text NOT NULL, supplier_id text NOT NULL,
          basis numeric NOT NULL, amount bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS finance_adjustment (
          id text PRIMARY KEY, party_type text NOT NULL, party_id text NOT NULL, amount bigint NOT NULL,
          reason text NOT NULL, reference text, actor_id text NOT NULL, approved_by text,
          journal_source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS finance_approval (
          id text PRIMARY KEY, subject_type text NOT NULL, subject_id text NOT NULL, status text NOT NULL,
          actor_id text NOT NULL, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS coupon_code text;
        ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS coupon_discount bigint NOT NULL DEFAULT 0;
        ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS coupon_snapshot jsonb NOT NULL DEFAULT '{}';
      `);
      for (const [code, label, kind] of ACCOUNTS) {
        await client.query(
          `INSERT INTO journal_account (code, label, kind) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`,
          [code, label, kind],
        );
      }
    } finally {
      client.release();
    }
  });
  return schemaReady;
}

function fail(status: number, code: string): never {
  throw new CatalogFinanceError(status, code);
}

async function jsonBody(req: { json: () => Promise<unknown> }): Promise<Body> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "INVALID_JSON");
  return body as Body;
}

function requireAdmin(actor: Actor) {
  if (!actor || actor.role !== "admin") fail(403, "ADMIN_REQUIRED");
  return actor;
}

function slug(value: unknown, field: string) {
  const code = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(code)) fail(422, `INVALID_${field.toUpperCase()}`);
  return code;
}

function tehranToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
}

function shapeAttribute(row: any, options: any[]) {
  return {
    id: row.id, code: row.code, label: row.label, description: row.description, type: row.value_type,
    unit: row.unit, required: row.required, searchable: row.searchable, filterable: row.filterable,
    variantLevel: row.variant_level, position: row.position, validation: row.validation, active: row.active,
    options: options.filter((option) => option.attribute_id === row.id).map((option) => ({
      id: option.id, code: option.code, label: option.label, position: option.position, active: option.active,
    })),
  };
}

function validateAttributeValue(attribute: any, options: any[], raw: unknown) {
  if (raw == null || raw === "") {
    if (attribute.required) fail(422, "REQUIRED_ATTRIBUTE");
    return null;
  }
  const rules = attribute.validation ?? {};
  if (attribute.value_type === "number" || attribute.value_type === "decimal") {
    const value = Number(raw);
    if (!Number.isFinite(value)) fail(422, "INVALID_ATTRIBUTE_VALUE");
    if (rules.min != null && value < Number(rules.min)) fail(422, "ATTRIBUTE_BELOW_MIN");
    if (rules.max != null && value > Number(rules.max)) fail(422, "ATTRIBUTE_ABOVE_MAX");
    return value;
  }
  if (attribute.value_type === "boolean") return raw === true || raw === "true";
  if (attribute.value_type === "single_select") {
    const code = String(raw);
    if (!options.some((option) => option.code === code && option.active)) fail(422, "UNKNOWN_OPTION");
    return code;
  }
  if (attribute.value_type === "multi_select") {
    const values = Array.isArray(raw) ? raw.map(String) : [];
    if (values.some((value) => !options.some((option) => option.code === value && option.active))) fail(422, "UNKNOWN_OPTION");
    return values;
  }
  if (attribute.value_type === "url") {
    try { return new URL(String(raw)).toString(); } catch { fail(422, "INVALID_URL"); }
  }
  if (attribute.value_type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) fail(422, "INVALID_DATE");
    return String(raw);
  }
  if (attribute.value_type === "measurement") {
    const value = raw as { value?: unknown; unit?: unknown };
    if (!value || !Number.isFinite(Number(value.value))) fail(422, "INVALID_MEASUREMENT");
    return { value: Number(value.value), unit: String(value.unit || attribute.unit || "") };
  }
  if (["file", "image", "video"].includes(attribute.value_type)) {
    const mediaId = String((raw as { mediaId?: string })?.mediaId ?? raw ?? "");
    if (!mediaId) fail(422, "MEDIA_REQUIRED");
    return { mediaId };
  }
  return String(raw).slice(0, 2000);
}

async function listAttributes() {
  const attributes = await rows<any>("SELECT * FROM attribute_definition ORDER BY position, code");
  const options = attributes.length
    ? await rows<any>("SELECT * FROM attribute_option WHERE attribute_id = ANY($1::text[]) ORDER BY position, code", [attributes.map((item) => item.id)])
    : [];
  return attributes.map((item) => shapeAttribute(item, options));
}

async function saveAttribute(body: Body, id?: string) {
  const code = slug(body.code, "code");
  const type = String(body.type ?? "");
  if (!ATTRIBUTE_TYPES.has(type) || !String(body.label ?? "").trim()) fail(422, "INVALID_ATTRIBUTE");
  const values = [
    code, String(body.label).trim(), String(body.description ?? ""), type, body.unit ? String(body.unit) : null,
    Boolean(body.required), Boolean(body.searchable), Boolean(body.filterable), Boolean(body.variantLevel ?? body.variant_level),
    Number(body.position ?? 0), JSON.stringify(body.validation ?? {}), body.active !== false,
  ];
  const [saved] = id
    ? await rows<any>(
      `UPDATE attribute_definition SET code=$2,label=$3,description=$4,value_type=$5,unit=$6,required=$7,searchable=$8,filterable=$9,variant_level=$10,position=$11,validation=$12::jsonb,active=$13,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, ...values],
    )
    : await rows<any>(
      `INSERT INTO attribute_definition (id,code,label,description,value_type,unit,required,searchable,filterable,variant_level,position,validation,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING *`,
      [makeId("attr"), ...values],
    );
  if (!saved) fail(404, "ATTRIBUTE_NOT_FOUND");
  if (Array.isArray(body.options)) {
    for (const option of body.options) {
      const optionCode = slug(option.code, "option");
      await rows(
        `INSERT INTO attribute_option (id, attribute_id, code, label, position, active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (attribute_id, code) DO UPDATE SET label=EXCLUDED.label, position=EXCLUDED.position, active=EXCLUDED.active`,
        [makeId("opt"), saved.id, optionCode, String(option.label ?? optionCode), Number(option.position ?? 0), option.active !== false],
      );
    }
  }
  return (await listAttributes()).find((item) => item.id === saved.id);
}

async function templateDetail(id: string) {
  const [template] = await rows<any>("SELECT * FROM spec_template WHERE id=$1", [id]);
  if (!template) fail(404, "TEMPLATE_NOT_FOUND");
  const groups = await rows<any>("SELECT * FROM spec_group WHERE template_id=$1 ORDER BY position, id", [id]);
  const links = await rows<any>(
    `SELECT l.*, a.code, a.label, a.value_type, a.unit, a.variant_level, a.required AS attribute_required
     FROM spec_template_attribute l JOIN attribute_definition a ON a.id=l.attribute_id
     WHERE l.template_id=$1 ORDER BY l.position, a.code`,
    [id],
  );
  return {
    id: template.id, code: template.code, name: template.name, description: template.description, active: template.active,
    groups: groups.map((group) => ({
      id: group.id, name: group.name, position: group.position,
      attributes: links.filter((link) => link.group_id === group.id).map(shapeLink),
    })),
    ungrouped: links.filter((link) => !link.group_id).map(shapeLink),
  };
}

function shapeLink(link: any) {
  return {
    id: link.attribute_id, code: link.code, label: link.label, type: link.value_type, unit: link.unit,
    variantLevel: link.variant_level, required: link.required ?? link.attribute_required, position: link.position,
  };
}

async function saveProductSpecs(productId: string, body: Body) {
  const templateId = String(body.templateId ?? "");
  if (!templateId) fail(422, "TEMPLATE_REQUIRED");
  const template = await templateDetail(templateId);
  const links = [...template.groups.flatMap((group) => group.attributes), ...template.ungrouped];
  const attributes = await rows<any>("SELECT * FROM attribute_definition WHERE id = ANY($1::text[])", [links.map((link) => link.id)]);
  const options = attributes.length
    ? await rows<any>("SELECT * FROM attribute_option WHERE attribute_id = ANY($1::text[])", [attributes.map((item) => item.id)])
    : [];
  const values = body.values ?? {};
  const variantValues = body.variantValues ?? {};
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO product_spec_binding (product_id, template_id, product_type_id)
       VALUES ($1,$2,$3) ON CONFLICT (product_id) DO UPDATE SET template_id=EXCLUDED.template_id, product_type_id=EXCLUDED.product_type_id, updated_at=now()`,
      [productId, templateId, body.productTypeId ?? null],
    );
    for (const link of links) {
      const attribute = attributes.find((item) => item.id === link.id);
      const target = attribute.variant_level ? null : values[attribute.code];
      if (!attribute.variant_level) {
        const value = validateAttributeValue({ ...attribute, required: link.required }, options.filter((option) => option.attribute_id === attribute.id), target);
        if (value == null) continue;
        await client.query(
          `INSERT INTO product_attribute_value (product_id, attribute_id, value) VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (product_id, attribute_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
          [productId, attribute.id, JSON.stringify(value)],
        );
      }
    }
    for (const [variantId, payload] of Object.entries(variantValues as Record<string, Record<string, unknown>>)) {
      for (const link of links.filter((item) => item.variantLevel)) {
        const attribute = attributes.find((item) => item.id === link.id);
        const value = validateAttributeValue(attribute, options.filter((option) => option.attribute_id === attribute.id), payload?.[attribute.code]);
        if (value == null) continue;
        await client.query(
          `INSERT INTO variant_attribute_value (variant_id, attribute_id, value) VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (variant_id, attribute_id) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
          [variantId, attribute.id, JSON.stringify(value)],
        );
      }
    }
    if (Array.isArray(body.extras)) {
      for (const extra of body.extras) {
        if (!String(extra.label ?? "").trim() || !ATTRIBUTE_TYPES.has(String(extra.type))) fail(422, "INVALID_EXTRA");
        await client.query(
          `INSERT INTO product_extra_attribute (id, product_id, label, value_type, value, unit) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
          [makeId("extra"), productId, String(extra.label).trim(), extra.type, JSON.stringify(extra.value ?? ""), extra.unit ?? null],
        );
      }
    }
  });
  return productSpecifications(productId);
}

async function promoteExtra(extraId: string, actor: Actor) {
  requireAdmin(actor);
  const [extra] = await rows<any>("SELECT * FROM product_extra_attribute WHERE id=$1", [extraId]);
  if (!extra) fail(404, "EXTRA_NOT_FOUND");
  const [binding] = await rows<any>("SELECT template_id FROM product_spec_binding WHERE product_id=$1", [extra.product_id]);
  if (!binding) fail(422, "TEMPLATE_REQUIRED");
  const code = slug(extra.label.replace(/\s+/g, "_"), "code");
  const attribute = await saveAttribute({ code, label: extra.label, type: extra.value_type, unit: extra.unit });
  await rows(
    `INSERT INTO spec_template_attribute (id, template_id, attribute_id, position) VALUES ($1,$2,$3,100)
     ON CONFLICT (template_id, attribute_id) DO NOTHING`,
    [makeId("link"), binding.template_id, attribute?.id],
  );
  return { promoted: true, attributeId: attribute?.id, templateId: binding.template_id };
}

export async function productSpecifications(productId: string) {
  const [binding] = await rows<any>("SELECT * FROM product_spec_binding WHERE product_id=$1", [productId]);
  if (!binding) return { productId, template: null, groups: [], extras: [] };
  const template = await templateDetail(binding.template_id);
  const values = await rows<any>(
    `SELECT a.code, v.value, a.variant_level FROM product_attribute_value v
     JOIN attribute_definition a ON a.id=v.attribute_id WHERE v.product_id=$1`,
    [productId],
  );
  const extras = await rows<any>("SELECT id, label, value_type, value, unit FROM product_extra_attribute WHERE product_id=$1 ORDER BY created_at", [productId]);
  const byCode = new Map(values.map((item) => [item.code, item.value]));
  const groups = template.groups.map((group) => ({
    name: group.name,
    attributes: group.attributes.filter((item) => !item.variantLevel && byCode.has(item.code)).map((item) => ({
      code: item.code, label: item.label, type: item.type, unit: item.unit, value: byCode.get(item.code),
    })),
  })).filter((group) => group.attributes.length);
  return { productId, template: { id: template.id, code: template.code, name: template.name }, groups, extras };
}

async function guidePayload(guideId: string, client?: PoolClient) {
  const query = client ? (sql: string, params: unknown[]) => client.query(sql, params).then((result) => result.rows) : (sql: string, params: unknown[]) => rows(sql, params);
  const [guide] = await query("SELECT * FROM size_guide WHERE id=$1", [guideId]);
  if (!guide) return null;
  const columns = await query("SELECT code, label, unit, position FROM size_guide_column WHERE guide_id=$1 ORDER BY position, code", [guideId]);
  const tableRows = await query("SELECT values, position FROM size_guide_row WHERE guide_id=$1 ORDER BY position, id", [guideId]);
  const media = await query("SELECT id, kind, media_id, url, caption FROM size_guide_media WHERE guide_id=$1", [guideId]);
  return {
    id: guide.id, code: guide.code, version: guide.version, name: guide.name, text: guide.guide_text,
    published: guide.published, current: guide.is_current, columns, rows: tableRows.map((row) => row.values), media,
  };
}

async function currentGuide(code: string) {
  const [guide] = await rows<any>("SELECT id FROM size_guide WHERE code=$1 AND published ORDER BY version DESC LIMIT 1", [code]);
  return guide ? guidePayload(guide.id) : null;
}

async function saveSizeGuide(body: Body) {
  const code = slug(body.code, "code");
  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (!columns.length || !String(body.name ?? "").trim()) fail(422, "INVALID_GUIDE");
  const columnCodes = new Set<string>();
  for (const column of columns) {
    const columnCode = slug(column.code, "column");
    if (columnCodes.has(columnCode)) fail(422, "DUPLICATE_COLUMN");
    columnCodes.add(columnCode);
  }
  return transaction(async (client) => {
    const current = (await client.query<any>("SELECT * FROM size_guide WHERE code=$1 AND is_current", [code])).rows[0];
    let guideId = current && !current.published ? current.id : null;
    let version = current ? Number(current.version) : 0;
    if (!guideId) {
      version += 1;
      guideId = makeId("guide");
      await client.query(
        `INSERT INTO size_guide (id, code, version, name, guide_text, published, is_current) VALUES ($1,$2,$3,$4,$5,false,$6)`,
        [guideId, code, version, String(body.name).trim(), String(body.text ?? ""), !current],
      );
    } else {
      await client.query("UPDATE size_guide SET name=$2, guide_text=$3 WHERE id=$1", [guideId, String(body.name).trim(), String(body.text ?? "")]);
      await client.query("DELETE FROM size_guide_column WHERE guide_id=$1", [guideId]);
      await client.query("DELETE FROM size_guide_row WHERE guide_id=$1", [guideId]);
      await client.query("DELETE FROM size_guide_media WHERE guide_id=$1", [guideId]);
    }
    for (const [index, column] of columns.entries()) {
      await client.query(
        "INSERT INTO size_guide_column (id, guide_id, code, label, unit, position) VALUES ($1,$2,$3,$4,$5,$6)",
        [makeId("gcol"), guideId, slug(column.code, "column"), String(column.label), column.unit ?? null, index],
      );
    }
    for (const [index, row] of (Array.isArray(body.rows) ? body.rows : []).entries()) {
      const values: Record<string, unknown> = {};
      for (const column of columns) values[slug(column.code, "column")] = row[column.code] ?? row[slug(column.code, "column")] ?? null;
      await client.query("INSERT INTO size_guide_row (id, guide_id, position, values) VALUES ($1,$2,$3,$4::jsonb)", [makeId("grow"), guideId, index, JSON.stringify(values)]);
    }
    for (const media of Array.isArray(body.media) ? body.media : []) {
      if (!["image", "diagram", "video", "gif", "text"].includes(String(media.kind))) fail(422, "INVALID_MEDIA");
      if (media.kind !== "text" && !media.mediaId && !media.url) fail(422, "MEDIA_REQUIRED");
      await client.query(
        "INSERT INTO size_guide_media (id, guide_id, kind, media_id, url, caption) VALUES ($1,$2,$3,$4,$5,$6)",
        [makeId("gmed"), guideId, media.kind, media.mediaId ?? null, media.url ?? null, String(media.caption ?? "")],
      );
    }
    return guidePayload(guideId, client);
  });
}

async function publishGuide(id: string) {
  const [guide] = await rows<any>("UPDATE size_guide SET published=true WHERE id=$1 RETURNING code", [id]);
  if (guide) await rows("UPDATE size_guide SET is_current=false WHERE code=$1 AND id<>$2", [guide.code, id]);
  if (guide) await rows("UPDATE size_guide SET is_current=true WHERE id=$1", [id]);
  if (!guide) fail(404, "GUIDE_NOT_FOUND");
  return currentGuide(guide.code);
}

async function linkSizeGuide(productId: string, body: Body) {
  const code = slug(body.code, "code");
  const guide = await currentGuide(code);
  if (!guide?.published) fail(422, "GUIDE_NOT_PUBLISHED");
  const mode = body.mode === "detached" ? "detached" : "linked";
  await rows(
    `INSERT INTO product_size_guide (product_id, guide_code, mode, snapshot)
     VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (product_id) DO UPDATE SET guide_code=EXCLUDED.guide_code, mode=EXCLUDED.mode, snapshot=EXCLUDED.snapshot, updated_at=now()`,
    [productId, code, mode, mode === "detached" ? JSON.stringify(guide) : null],
  );
  return productSizeGuide(productId);
}

export async function productSizeGuide(productId: string) {
  const [link] = await rows<any>("SELECT * FROM product_size_guide WHERE product_id=$1", [productId]);
  if (!link) return { productId, mode: null, guide: null };
  if (link.mode === "detached") return { productId, mode: "detached", guide: link.snapshot };
  return { productId, mode: "linked", guide: await currentGuide(link.guide_code) };
}

async function audience(rule: any) {
  const today = tehranToday();
  const [month, day] = today.slice(5).split("-").map(Number);
  const minSpend = Number(rule.definition?.minSpend ?? 0);
  const queries: Record<string, string> = {
    birthday: `SELECT id, phone, email, marketing_sms, unsubscribed, do_not_contact FROM account_user
      WHERE birth_date IS NOT NULL AND EXTRACT(MONTH FROM birth_date)=$1 AND EXTRACT(DAY FROM birth_date)=$2`,
    spend_threshold: `SELECT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM account_user u JOIN retail_order o ON o.phone=u.phone
      GROUP BY u.id HAVING COALESCE(SUM(o.total_amount),0) >= $1`,
    first_purchase: `SELECT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM account_user u JOIN retail_order o ON o.phone=u.phone GROUP BY u.id HAVING count(*)=1`,
    fifth_purchase: `SELECT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM account_user u JOIN retail_order o ON o.phone=u.phone GROUP BY u.id HAVING count(*)>=5`,
    inactive_60: `SELECT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM account_user u JOIN retail_order o ON o.phone=u.phone
      GROUP BY u.id HAVING max(o.created_at) < now() - interval '60 days'`,
    membership_expiry: `SELECT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM account_user u JOIN wholesale_account w ON w.user_id=u.id
      WHERE w.expires_at IS NOT NULL AND w.expires_at <= now() + interval '14 days' AND w.expires_at > now()`,
    vip_upgrade: `SELECT id, phone, email, marketing_sms, unsubscribed, do_not_contact FROM account_user WHERE role='vip'`,
    cart_abandoned: `SELECT DISTINCT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM domain_event e JOIN account_user u ON u.id=e.subject_id
      WHERE e.event_name='cart.abandoned' AND e.created_at > now() - interval '7 days'`,
    review_created: `SELECT DISTINCT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM product_review r JOIN account_user u ON u.id=r.user_id WHERE r.created_at > now() - interval '7 days'`,
    high_rating: `SELECT DISTINCT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM product_review r JOIN account_user u ON u.id=r.user_id WHERE r.rating >= 4`,
    low_rating: `SELECT DISTINCT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM product_review r JOIN account_user u ON u.id=r.user_id WHERE r.rating <= 2`,
    returned_order: `SELECT DISTINCT u.id, u.phone, u.email, u.marketing_sms, u.unsubscribed, u.do_not_contact
      FROM ledger_entry l JOIN account_user u ON u.id=l.party_id
      WHERE l.kind IN ('refund','return') AND l.occurred_at > now() - interval '30 days'`,
  };
  const sql = queries[rule.trigger_name];
  if (!sql) return [];
  const params = rule.trigger_name === "birthday" ? [month, day] : rule.trigger_name === "spend_threshold" ? [minSpend] : [];
  return rows<any>(sql, params);
}

function canMarket(user: any) {
  return Boolean(user.marketing_sms) && !user.unsubscribed && !user.do_not_contact;
}

async function saveRule(body: Body, id?: string) {
  if (!String(body.name ?? "").trim() || !TRIGGERS.has(String(body.trigger))) fail(422, "INVALID_RULE");
  const status = String(body.status ?? "draft");
  if (!RULE_STATUSES.has(status)) fail(422, "INVALID_STATUS");
  if (body.budgetCap != null && body.action?.maxDiscount == null && body.action?.amount == null) fail(422, "BUDGET_NEEDS_CAP_VALUE");
  const values = [
    String(body.name).trim(), body.trigger, status, JSON.stringify(body.definition ?? {}), JSON.stringify(body.action ?? {}),
    body.dailyCap ?? null, body.audienceCap ?? null, body.cooldownDays ?? null, body.usageLimit ?? 1,
    body.budgetCap ?? null, body.expiresAt ?? null, Boolean(body.requiresApproval),
  ];
  const [saved] = id
    ? await rows<any>(`UPDATE promotion_rule SET name=$2,trigger_name=$3,status=$4,definition=$5::jsonb,action=$6::jsonb,daily_cap=$7,audience_cap=$8,cooldown_days=$9,usage_limit=$10,budget_cap=$11,expires_at=$12,requires_approval=$13,updated_at=now() WHERE id=$1 RETURNING *`, [id, ...values])
    : await rows<any>(`INSERT INTO promotion_rule (id,name,trigger_name,status,definition,action,daily_cap,audience_cap,cooldown_days,usage_limit,budget_cap,expires_at,requires_approval) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [makeId("rule"), ...values]);
  if (!saved) fail(404, "RULE_NOT_FOUND");
  return saved;
}

async function runRule(id: string, body: Body, actor: Actor) {
  const [rule] = await rows<any>("SELECT * FROM promotion_rule WHERE id=$1", [id]);
  if (!rule) fail(404, "RULE_NOT_FOUND");
  if (rule.expires_at && new Date(rule.expires_at).getTime() < Date.now()) fail(422, "RULE_EXPIRED");
  const dryRun = body.dryRun !== false;
  if (!dryRun && rule.status !== "active") fail(422, "RULE_NOT_ACTIVE");
  if (!dryRun) {
    const [prior] = await rows<any>("SELECT id FROM promotion_run WHERE rule_id=$1 AND dry_run LIMIT 1", [id]);
    if (!prior) fail(422, "DRY_RUN_REQUIRED");
  }
  const key = body.idempotencyKey ? String(body.idempotencyKey) : null;
  if (key) {
    const [existing] = await rows<any>("SELECT * FROM promotion_run WHERE idempotency_key=$1", [key]);
    if (existing) return existing;
  }
  const [todayCount] = await rows<any>("SELECT count(*)::int AS count FROM promotion_run WHERE rule_id=$1 AND dry_run=false AND created_at::date=CURRENT_DATE", [id]);
  if (!dryRun && rule.daily_cap != null && Number(todayCount.count) >= Number(rule.daily_cap)) fail(422, "DAILY_CAP");
  let matches = await audience(rule);
  if (rule.cooldown_days) {
    const recent = await rows<any>(
      "SELECT owner_user_id FROM personal_coupon WHERE rule_id=$1 AND created_at > now() - ($2 || ' days')::interval",
      [id, String(rule.cooldown_days)],
    );
    const blocked = new Set(recent.map((item) => item.owner_user_id));
    matches = matches.filter((user) => !blocked.has(user.id));
  }
  const sample = matches.slice(0, 20).map((user) => ({ id: user.id, phone: user.phone, marketingAllowed: canMarket(user) }));
  if (dryRun) {
    const [run] = await rows<any>(
      `INSERT INTO promotion_run (id, rule_id, dry_run, matched, status, sample, idempotency_key) VALUES ($1,$2,true,$3,'dry_run',$4::jsonb,$5) RETURNING *`,
      [makeId("prun"), id, matches.length, JSON.stringify(sample), key],
    );
    return { ...run, issued: 0, coupons: [] };
  }
  if (rule.requires_approval && body.approved !== true) {
    const [run] = await rows<any>(
      `INSERT INTO promotion_run (id, rule_id, dry_run, matched, status, sample, idempotency_key) VALUES ($1,$2,false,$3,'pending_approval',$4::jsonb,$5) RETURNING *`,
      [makeId("prun"), id, matches.length, JSON.stringify(sample), key],
    );
    await rows(
      "INSERT INTO finance_approval (id, subject_type, subject_id, status, actor_id, note) VALUES ($1,'promotion_run',$2,'requested',$3,$4)",
      [makeId("appr"), run.id, actor?.sub ?? "system", "needs approval"],
    );
    return run;
  }
  const cap = rule.audience_cap == null ? matches.length : Math.min(matches.length, Number(rule.audience_cap));
  const selected = matches.slice(0, cap);
  const face = Number(rule.action?.amount ?? rule.action?.maxDiscount ?? 0);
  if (rule.budget_cap != null) {
    const [spent] = await rows<any>("SELECT COALESCE(SUM(COALESCE(amount, max_discount, 0)),0)::bigint AS total FROM personal_coupon WHERE rule_id=$1", [id]);
    if (Number(spent.total) + face * selected.length > Number(rule.budget_cap)) fail(422, "BUDGET_CAP");
  }
  const coupons: any[] = [];
  await transaction(async (client) => {
    for (const user of selected) {
      const [existing] = (await client.query("SELECT count(*)::int AS count FROM personal_coupon WHERE rule_id=$1 AND owner_user_id=$2", [id, user.id])).rows;
      if (Number(existing.count) >= Number(rule.usage_limit ?? 1)) continue;
      const code = `K${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const [coupon] = (await client.query(
        `INSERT INTO personal_coupon (id, code, rule_id, owner_user_id, percent, amount, max_discount, expires_at, minimum_order, allowed_categories, allowed_products, installment_policy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) RETURNING id, code, owner_user_id`,
        [makeId("cpn"), code, id, user.id, rule.action?.percent ?? null, rule.action?.amount ?? null, rule.action?.maxDiscount ?? null,
          rule.action?.expiresAt ?? rule.expires_at, rule.action?.minimumOrder ?? 0, JSON.stringify(rule.action?.categories ?? []),
          JSON.stringify(rule.action?.products ?? []), rule.action?.installmentPolicy ?? "allowed"],
      )).rows;
      coupons.push(coupon);
      if (rule.action?.sms && canMarket(user)) {
        await client.query(
          `INSERT INTO customer_notification (id, user_id, channel, title, body, status) VALUES ($1,$2,'sms',$3,$4,'queued')`,
          [makeId("ntf"), user.id, rule.name, String(rule.action.sms).slice(0, 500)],
        );
      } else if (rule.action?.sms && !canMarket(user)) {
        await client.query(
          `INSERT INTO crm_note (id, subject_type, subject_id, kind, body) VALUES ($1,'customer',$2,'sms_blocked',$3)`,
          [makeId("note"), user.id, "بازاریابی بدون رضایت ارسال نشد"],
        );
      }
    }
  });
  const [run] = await rows<any>(
    `INSERT INTO promotion_run (id, rule_id, dry_run, matched, issued, status, sample, idempotency_key) VALUES ($1,$2,false,$3,$4,'issued',$5::jsonb,$6) RETURNING *`,
    [makeId("prun"), id, matches.length, coupons.length, JSON.stringify(sample), key],
  );
  if (coupons.length) await emitEvent("coupon.issued", "promotion", id, { count: coupons.length, runId: run.id });
  return { ...run, coupons };
}

export async function priceCoupon(client: PoolClient, input: {
  code?: string; phone: string; email?: string | null; itemsAmount: number; lineIds: string[]; payMethod: string;
}) {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code) return { discount: 0, snapshot: null as any };
  const coupon = (await client.query<any>("SELECT * FROM personal_coupon WHERE code=$1 FOR UPDATE", [code])).rows[0];
  if (!coupon) fail(422, "COUPON_NOT_FOUND");
  if (coupon.used_at || coupon.reserved_order) fail(422, "COUPON_USED");
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) fail(422, "COUPON_EXPIRED");
  if (input.itemsAmount < Number(coupon.minimum_order)) fail(422, "COUPON_MINIMUM");
  const owner = (await client.query<any>("SELECT id, phone, email FROM account_user WHERE id=$1", [coupon.owner_user_id])).rows[0];
  if (!owner || (owner.phone !== input.phone && owner.email !== input.email)) fail(422, "COUPON_OWNER");
  if (coupon.installment_policy === "forbidden" && input.payMethod === "installment") fail(422, "COUPON_INSTALLMENT");
  if (coupon.installment_policy === "required" && input.payMethod !== "installment") fail(422, "COUPON_INSTALLMENT");
  const categories = Array.isArray(coupon.allowed_categories) ? coupon.allowed_categories : [];
  const products = Array.isArray(coupon.allowed_products) ? coupon.allowed_products : [];
  if (products.length && input.lineIds.some((id) => !products.includes(id))) fail(422, "COUPON_PRODUCT");
  if (categories.length) {
    const found = (await client.query<any>("SELECT DISTINCT category FROM product WHERE id = ANY($1::text[])", [input.lineIds])).rows.map((row) => row.category);
    if (found.some((category) => !categories.includes(category))) fail(422, "COUPON_CATEGORY");
  }
  const percent = Number(coupon.percent ?? 0);
  const fixed = Number(coupon.amount ?? 0);
  let discount = fixed > 0 ? fixed : Math.floor(input.itemsAmount * percent / 100);
  if (coupon.max_discount != null) discount = Math.min(discount, Number(coupon.max_discount));
  discount = Math.max(0, Math.min(discount, input.itemsAmount));
  return {
    discount,
    snapshot: { code, couponId: coupon.id, percent, amount: fixed, discount },
  };
}

export async function consumeCoupon(client: PoolClient, code: string, orderCode: string) {
  await client.query("UPDATE personal_coupon SET used_at=now(), reserved_order=$2 WHERE code=$1 AND used_at IS NULL", [code, orderCode]);
}

async function periodLocked(client: PoolClient, occurredAt: string) {
  const [period] = (await client.query<any>(
    "SELECT status FROM accounting_period WHERE starts_on <= $1::date AND ends_on >= $1::date AND status IN ('closed','locked') LIMIT 1",
    [occurredAt.slice(0, 10)],
  )).rows;
  if (period) fail(422, "PERIOD_LOCKED");
}

export async function postJournal(client: PoolClient, input: {
  memo: string; sourceType: string; sourceId: string; occurredAt?: string; actorId?: string | null;
  lines: Array<{ account: string; debit?: number; credit?: number; partyType?: string; partyId?: string; dimensions?: Record<string, unknown> }>;
}) {
  const debit = input.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const credit = input.lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  if (!input.lines.length || debit !== credit || debit <= 0) fail(422, "UNBALANCED_JOURNAL");
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  await periodLocked(client, occurredAt);
  const existing = (await client.query("SELECT id FROM journal_entry WHERE source_type=$1 AND source_id=$2", [input.sourceType, input.sourceId])).rows[0];
  if (existing) return existing.id as string;
  const entryId = makeId("jrnl");
  await client.query(
    "INSERT INTO journal_entry (id, occurred_at, memo, source_type, source_id, actor_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [entryId, occurredAt, input.memo, input.sourceType, input.sourceId, input.actorId ?? null],
  );
  for (const line of input.lines) {
    if (!ACCOUNTS.some((account) => account[0] === line.account)) fail(422, "UNKNOWN_ACCOUNT");
    await client.query(
      `INSERT INTO journal_line (id, entry_id, account_code, debit, credit, party_type, party_id, dimensions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [makeId("jln"), entryId, line.account, Math.round(Number(line.debit ?? 0)), Math.round(Number(line.credit ?? 0)), line.partyType ?? null, line.partyId ?? null, JSON.stringify(line.dimensions ?? {})],
    );
  }
  return entryId;
}

async function mirrorLedger(client: PoolClient) {
  const entries = (await client.query<any>("SELECT * FROM ledger_entry ORDER BY occurred_at, id")).rows;
  for (const entry of entries) {
    const amount = Math.abs(Number(entry.amount));
    if (!amount) continue;
    const locked = (await client.query(
      "SELECT 1 FROM accounting_period WHERE starts_on <= $1::date AND ends_on >= $1::date AND status IN ('closed','locked') LIMIT 1",
      [new Date(entry.occurred_at).toISOString().slice(0, 10)],
    )).rowCount;
    if (locked) continue;
    const party = { partyType: entry.party_type, partyId: entry.party_id, dimensions: { kind: entry.kind, reference: entry.reference_id } };
    if (entry.kind === "sale") {
      await postJournal(client, { memo: entry.memo || "فروش", sourceType: "ledger_entry", sourceId: entry.id, occurredAt: entry.occurred_at, lines: [
        { account: "receivable", debit: amount, ...party },
        { account: "supplier_payable", credit: amount, ...party },
      ] });
    } else if (entry.kind === "fee") {
      await postJournal(client, { memo: "کارمزد", sourceType: "ledger_entry", sourceId: entry.id, occurredAt: entry.occurred_at, lines: [
        { account: "supplier_payable", debit: amount, ...party },
        { account: "commission_revenue", credit: amount, ...party },
      ] });
    } else if (entry.kind === "refund" || entry.kind === "return") {
      await postJournal(client, { memo: entry.kind, sourceType: "ledger_entry", sourceId: entry.id, occurredAt: entry.occurred_at, lines: [
        { account: entry.kind === "refund" ? "refund_expense" : "return_cost", debit: amount, ...party },
        { account: "supplier_payable", credit: amount, ...party },
      ] });
    }
  }
}

function rangeBounds(search: URLSearchParams) {
  const range = search.get("range") || "30d";
  const now = new Date();
  const start = new Date(now);
  if (range === "today") start.setHours(0, 0, 0, 0);
  else if (range === "hour") start.setHours(now.getHours() - 1);
  else if (range === "7d") start.setDate(now.getDate() - 7);
  else if (range === "30d") start.setDate(now.getDate() - 30);
  else if (range === "3m") start.setMonth(now.getMonth() - 3);
  else if (range === "6m") start.setMonth(now.getMonth() - 6);
  else if (range === "ytd") start.setMonth(0, 1);
  else if (range === "12m") start.setMonth(now.getMonth() - 12);
  else if (range === "all") start.setTime(0);
  else if (range === "custom") {
    const from = search.get("from");
    const to = search.get("to");
    if (!from || !to) fail(422, "RANGE_REQUIRED");
    return { from, to, range };
  } else fail(422, "INVALID_RANGE");
  return { from: start.toISOString(), to: now.toISOString(), range };
}

async function financeSummary(search: URLSearchParams) {
  const bounds = rangeBounds(search);
  const previousLength = new Date(bounds.to).getTime() - new Date(bounds.from).getTime();
  const previousFrom = new Date(new Date(bounds.from).getTime() - previousLength).toISOString();
  const yearFrom = new Date(new Date(bounds.from).getTime() - 365 * 24 * 3600 * 1000).toISOString();
  const yearTo = new Date(new Date(bounds.to).getTime() - 365 * 24 * 3600 * 1000).toISOString();
  await transaction(async (client) => { await mirrorLedger(client); });
  const metric = async (from: string, to: string) => {
    const [orders] = await rows<any>(
      `SELECT COALESCE(SUM(total_amount),0)::bigint AS sales, COALESCE(SUM(shipping_price),0)::bigint AS shipping,
              COALESCE(SUM(coupon_discount),0)::bigint AS discounts, count(*)::int AS orders
       FROM retail_order WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    const [journal] = await rows<any>(
      `SELECT
         COALESCE(SUM(credit) FILTER (WHERE account_code='commission_revenue'),0)::bigint AS commission,
         COALESCE(SUM(debit) FILTER (WHERE account_code='refund_expense'),0)::bigint AS refunds,
         COALESCE(SUM(credit - debit) FILTER (WHERE account_code='supplier_payable'),0)::bigint AS payable
       FROM journal_line l JOIN journal_entry e ON e.id=l.entry_id
       WHERE e.occurred_at >= $1 AND e.occurred_at < $2`,
      [from, to],
    );
    return {
      sales: Number(orders.sales), shipping: Number(orders.shipping), discounts: Number(orders.discounts),
      orders: Number(orders.orders), commission: Number(journal.commission), refunds: Number(journal.refunds), payable: Number(journal.payable),
    };
  };
  const current = await metric(bounds.from, bounds.to);
  return {
    range: bounds, current, previous: await metric(previousFrom, bounds.from), previousYear: await metric(yearFrom, yearTo),
    source: "retail_order+journal",
  };
}

async function financeSeries(search: URLSearchParams) {
  const bounds = rangeBounds(search);
  const bucket = bounds.range === "hour" || bounds.range === "today" ? "hour" : "day";
  const points = await rows<any>(
    `SELECT date_trunc($3, created_at) AS bucket, COALESCE(SUM(total_amount),0)::bigint AS sales,
            COALESCE(SUM(shipping_price),0)::bigint AS shipping, count(*)::int AS orders
     FROM retail_order WHERE created_at >= $1 AND created_at < $2
     GROUP BY 1 ORDER BY 1`,
    [bounds.from, bounds.to, bucket],
  );
  return { source: "retail_order", bucket, points: points.map((point) => ({ date: point.bucket, sales: Number(point.sales), shipping: Number(point.shipping), orders: Number(point.orders) })) };
}

async function supplierStatement(supplierId: string) {
  await transaction(async (client) => { await mirrorLedger(client); });
  const lines = await rows<any>(
    `SELECT e.occurred_at, e.memo, e.source_type, e.source_id, l.account_code, l.debit, l.credit, l.dimensions
     FROM journal_line l JOIN journal_entry e ON e.id=l.entry_id
     WHERE l.party_type='supplier' AND l.party_id=$1
     ORDER BY e.occurred_at, l.id`,
    [supplierId],
  );
  let balance = 0;
  return {
    supplierId,
    lines: lines.map((line) => {
      balance += Number(line.credit) - Number(line.debit);
      return { ...line, debit: Number(line.debit), credit: Number(line.credit), balance };
    }),
    balance,
    source: "journal",
  };
}

async function aging(supplierId?: string) {
  const params: string[] = [];
  const filter = supplierId ? (params.push(supplierId), "AND s.supplier_id=$1") : "";
  const settlements = await rows<any>(
    `SELECT s.id, s.supplier_id, s.net, s.due_on, s.status FROM settlement s
     WHERE s.status NOT IN ('paid','cancelled') ${filter}`,
    params,
  );
  const buckets = { notDue: 0, d1_7: 0, d8_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  const today = new Date(tehranToday());
  for (const item of settlements) {
    const due = item.due_on ? new Date(item.due_on) : today;
    const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
    const amount = Number(item.net);
    if (days <= 0) buckets.notDue += amount;
    else if (days <= 7) buckets.d1_7 += amount;
    else if (days <= 30) buckets.d8_30 += amount;
    else if (days <= 60) buckets.d31_60 += amount;
    else if (days <= 90) buckets.d61_90 += amount;
    else buckets.d90 += amount;
  }
  return { buckets, count: settlements.length, source: "settlement" };
}

async function createSettlement(supplierId: string, actor: Actor) {
  return transaction(async (client) => {
    await mirrorLedger(client);
    const open = (await client.query<any>(
      `SELECT e.id, e.source_id, l.credit, l.debit, l.account_code, e.memo
       FROM journal_line l JOIN journal_entry e ON e.id=l.entry_id
       WHERE l.party_type='supplier' AND l.party_id=$1 AND l.account_code='supplier_payable'
         AND NOT EXISTS (SELECT 1 FROM settlement_line s WHERE s.reference_id=e.source_id AND s.kind=l.account_code)`,
      [supplierId],
    )).rows;
    if (!open.length) fail(422, "NOTHING_TO_SETTLE");
    const gross = open.filter((line) => Number(line.credit) > 0).reduce((sum, line) => sum + Number(line.credit), 0);
    const commission = open.filter((line) => Number(line.debit) > 0 && String(line.memo).includes("کارمزد")).reduce((sum, line) => sum + Number(line.debit), 0);
    const returns = open.filter((line) => Number(line.debit) > 0 && !String(line.memo).includes("کارمزد")).reduce((sum, line) => sum + Number(line.debit), 0);
    const [shipping] = (await client.query<any>("SELECT COALESCE(SUM(amount),0)::bigint AS total FROM shipping_allocation_line WHERE supplier_id=$1", [supplierId])).rows;
    const [advances] = (await client.query<any>(
      `SELECT COALESCE(SUM(l.debit - l.credit),0)::bigint AS total FROM journal_line l
       WHERE l.party_id=$1 AND l.account_code='supplier_advance'`,
      [supplierId],
    )).rows;
    const exceptions = (await client.query<any>(
      `SELECT o.id, o.fulfillment_status FROM wholesale_order o
       JOIN wholesale_order_item i ON i.order_id=o.id JOIN supplier_product p ON p.id=i.product_id
       WHERE p.supplier_id=$1 AND o.fulfillment_status IN ('issue','cancelled')`,
      [supplierId],
    )).rows;
    const net = gross - commission - Number(shipping.total) - returns - Number(advances.total);
    const id = makeId("stl");
    await client.query(
      `INSERT INTO settlement (id, supplier_id, status, gross, commission, shipping, returns, adjustments, advances, net, due_on, snapshot)
       VALUES ($1,$2,'requested',$3,$4,$5,$6,0,$7,$8, NULL, $9::jsonb)`,
      [id, supplierId, gross, commission, Number(shipping.total), returns, Number(advances.total), net, JSON.stringify({ lines: open.length, exceptions: exceptions.length, dueOn: null })],
    );
    for (const line of open) {
      await client.query(
        "INSERT INTO settlement_line (id, settlement_id, reference_type, reference_id, kind, amount) VALUES ($1,$2,'journal',$3,$4,$5) ON CONFLICT DO NOTHING",
        [makeId("stll"), id, line.source_id, line.account_code, Number(line.credit) - Number(line.debit)],
      );
    }
    for (const exception of exceptions) {
      await client.query(
        "INSERT INTO settlement_exception (id, settlement_id, supplier_id, code, detail) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [makeId("stex"), id, supplierId, exception.fulfillment_status, JSON.stringify({ orderId: exception.id })],
      );
    }
    await client.query(
      "INSERT INTO finance_approval (id, subject_type, subject_id, status, actor_id) VALUES ($1,'settlement',$2,'requested',$3)",
      [makeId("appr"), id, actor?.sub ?? "system"],
    );
    return { id, status: exceptions.length ? "exception" : "requested", net, exceptions: exceptions.length };
  }).then(async (result) => {
    if (result.exceptions) await rows("UPDATE settlement SET status='exception' WHERE id=$1", [result.id]);
    await emitEvent("supplier.payable.created", "supplier", supplierId, result);
    await emitEvent("settlement.created", "supplier", supplierId, result);
    return result;
  });
}

async function transitionSettlement(id: string, status: string, actor: Actor) {
  const allowed: Record<string, string[]> = { requested: ["reviewed", "exception"], reviewed: ["approved"], exception: ["reviewed"], approved: ["paid"] };
  return transaction(async (client) => {
    const current = (await client.query<any>("SELECT * FROM settlement WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!current) fail(404, "SETTLEMENT_NOT_FOUND");
    if (!(allowed[current.status] ?? []).includes(status)) fail(422, "INVALID_TRANSITION");
    if (status === "paid" && current.net > 50_000_000 && !current.approved_by) fail(422, "APPROVAL_REQUIRED");
    await client.query(
      "UPDATE settlement SET status=$2, approved_by=CASE WHEN $2='approved' THEN $3 ELSE approved_by END, paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END WHERE id=$1",
      [id, status, actor?.sub ?? null],
    );
    await client.query(
      "INSERT INTO finance_approval (id, subject_type, subject_id, status, actor_id) VALUES ($1,'settlement',$2,$3,$4)",
      [makeId("appr"), id, status, actor?.sub ?? "system"],
    );
    if (status === "paid") {
      await postJournal(client, {
        memo: "پرداخت تسویه", sourceType: "settlement_paid", sourceId: id, actorId: actor?.sub,
        lines: [
          { account: "supplier_payable", debit: Number(current.net), partyType: "supplier", partyId: current.supplier_id },
          { account: "cash", credit: Number(current.net), partyType: "supplier", partyId: current.supplier_id },
        ],
      });
    }
    return { id, status };
  }).then(async (result) => {
    const name = status === "approved" ? "settlement.approved" : status === "paid" ? "settlement.paid" : "settlement.created";
    await emitEvent(name, "settlement", id, result);
    return result;
  });
}

async function createAdjustment(body: Body, actor: Actor) {
  const admin = requireAdmin(actor);
  const amount = Math.round(Number(body.amount));
  if (!amount || !String(body.reason ?? "").trim() || !body.partyId) fail(422, "INVALID_ADJUSTMENT");
  if (Math.abs(amount) > 20_000_000 && !body.approvedBy) fail(422, "APPROVAL_REQUIRED");
  const sourceId = makeId("adj");
  await transaction(async (client) => {
    const direction = amount > 0 ? "credit" : "debit";
    const abs = Math.abs(amount);
    await postJournal(client, {
      memo: String(body.reason), sourceType: "adjustment", sourceId, actorId: admin.sub,
      lines: direction === "credit"
        ? [{ account: "adjustment", debit: abs, partyType: body.partyType ?? "supplier", partyId: body.partyId }, { account: "supplier_payable", credit: abs, partyType: body.partyType ?? "supplier", partyId: body.partyId }]
        : [{ account: "supplier_payable", debit: abs, partyType: body.partyType ?? "supplier", partyId: body.partyId }, { account: "adjustment", credit: abs, partyType: body.partyType ?? "supplier", partyId: body.partyId }],
    });
    await client.query(
      `INSERT INTO finance_adjustment (id, party_type, party_id, amount, reason, reference, actor_id, approved_by, journal_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sourceId, body.partyType ?? "supplier", body.partyId, amount, String(body.reason).trim(), body.reference ?? null, admin.sub, body.approvedBy ?? null, sourceId],
    );
  });
  await emitEvent("adjustment.created", String(body.partyType ?? "supplier"), String(body.partyId), { id: sourceId, amount });
  return { id: sourceId, amount };
}

function allocate(total: number, bases: number[]) {
  const sum = bases.reduce((item, value) => item + value, 0);
  if (sum <= 0) fail(422, "ALLOCATION_BASIS");
  const raw = bases.map((value) => Math.floor(total * value / sum));
  let remainder = total - raw.reduce((item, value) => item + value, 0);
  for (let index = 0; remainder > 0; index += 1) {
    raw[index % raw.length] += 1;
    remainder -= 1;
  }
  return raw;
}

async function saveAllocation(body: Body) {
  const method = String(body.method ?? "");
  if (!ALLOCATION_METHODS.has(method)) fail(422, "INVALID_ALLOCATION");
  const fee = Math.round(Number(body.totalFee));
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!fee || fee < 0 || !lines.length) fail(422, "INVALID_ALLOCATION");
  const basis = lines.map((line) => {
    const value = Number(line[method] ?? (method === "equal" ? 1 : NaN));
    if (!Number.isFinite(value) || value < 0) fail(422, "ALLOCATION_SNAPSHOT_MISSING");
    return value;
  });
  if (method !== "equal" && basis.some((value) => value === 0) && basis.every((value) => value === 0)) fail(422, "ALLOCATION_SNAPSHOT_MISSING");
  const amounts = allocate(fee, method === "equal" ? lines.map(() => 1) : basis);
  const id = makeId("alloc");
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO shipping_allocation (id, reference, method, total_fee, snapshot) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [id, String(body.reference ?? id), method, fee, JSON.stringify({ lines, weightGrams: body.weightGrams ?? null })],
    );
    for (const [index, line] of lines.entries()) {
      await client.query(
        "INSERT INTO shipping_allocation_line (id, allocation_id, supplier_id, basis, amount) VALUES ($1,$2,$3,$4,$5)",
        [makeId("aloc"), id, String(line.supplierId), basis[index], amounts[index]],
      );
    }
  });
  return { id, method, totalFee: fee, lines: lines.map((line, index) => ({ supplierId: line.supplierId, amount: amounts[index] })) };
}

async function reportRows(kind: string, search: URLSearchParams) {
  const bounds = rangeBounds(search);
  if (kind === "sales") return rows<any>("SELECT order_code, total_amount, shipping_price, coupon_discount, created_at FROM retail_order WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at", [bounds.from, bounds.to]);
  if (kind === "shipping") return rows<any>("SELECT id, reference, method, total_fee, snapshot, created_at FROM shipping_allocation WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at", [bounds.from, bounds.to]);
  if (kind === "settlements") return rows<any>("SELECT id, supplier_id, status, gross, commission, shipping, returns, net, due_on, created_at FROM settlement WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at", [bounds.from, bounds.to]);
  if (kind === "ledger") return rows<any>("SELECT e.occurred_at, e.memo, e.source_type, e.source_id, l.account_code, l.debit, l.credit, l.party_id FROM journal_line l JOIN journal_entry e ON e.id=l.entry_id WHERE e.occurred_at >= $1 AND e.occurred_at < $2 ORDER BY e.occurred_at", [bounds.from, bounds.to]);
  fail(404, "UNKNOWN_REPORT");
}

function csv(records: any[]) {
  if (!records.length) return "empty\n";
  const headers = Object.keys(records[0]);
  const escape = (value: unknown) => `"${JSON.stringify(value ?? "").replaceAll("\"", "\"\"")}"`;
  return [headers.join(","), ...records.map((record) => headers.map((header) => escape(record[header])).join(","))].join("\n");
}

async function reportExport(kind: string, search: URLSearchParams) {
  const records = await reportRows(kind, search);
  const format = search.get("format") || "json";
  if (format === "csv") return { body: csv(records), type: "text/csv" };
  if (format === "xlsx") {
    const xlsx = require("xlsx");
    const sheet = xlsx.utils.json_to_sheet(records);
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, kind);
    return { body: xlsx.write(book, { type: "buffer", bookType: "xlsx" }), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
  if (format === "pdf") return { body: await reportPdf(kind, records), type: "application/pdf" };
  return { body: JSON.stringify({ kind, source: "database", records }), type: "application/json" };
}

async function reportPdf(kind: string, records: any[]) {
  const pdfkit = require("pdfkit");
  const PDFDocument = pdfkit.default ?? pdfkit;
  const font = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", "DejaVuSans.ttf"));
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  doc.registerFont("fa", font);
  doc.font("fa").fontSize(14).text(kind, { align: "right" });
  doc.moveDown();
  doc.fontSize(8);
  for (const record of records.slice(0, 80)) doc.text(JSON.stringify(record), { align: "left" });
  if (!records.length) doc.text("no rows");
  return await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

export function isCatalogFinancePath(path: string) {
  return path.startsWith("admin/attributes")
    || path.startsWith("admin/spec-templates")
    || path.startsWith("admin/size-guides")
    || path.startsWith("admin/promotions")
    || path.startsWith("admin/finance")
    || /^admin\/products\/[^/]+\/(specifications|size-guide)/.test(path)
    || /^admin\/product-types\/[^/]+\/spec-template$/.test(path)
    || /^products\/[^/]+\/(specifications|size-guide)$/.test(path)
    || path === "promotions/preview";
}

export async function handleCatalogFinanceRequest(req: { method: string; json: () => Promise<unknown>; headers: Headers }, path: string, actor: Actor, search = "") {
  await ensureCatalogFinanceSchema();
  const method = req.method;
  if (path.startsWith("admin/")) requireAdmin(actor);
  const params = new URLSearchParams(search);
  if (path === "admin/attributes" && method === "GET") return { status: 200, data: { attributes: await listAttributes() } };
  if (path === "admin/attributes" && method === "POST") return { status: 201, data: { attribute: await saveAttribute(await jsonBody(req)) } };
  const attribute = path.match(/^admin\/attributes\/([^/]+)$/);
  if (attribute && method === "POST") return { status: 200, data: { attribute: await saveAttribute(await jsonBody(req), attribute[1]) } };
  if (path === "admin/spec-templates" && method === "GET") {
    const templates = await rows<any>("SELECT id, code, name, active FROM spec_template ORDER BY name");
    return { status: 200, data: { templates } };
  }
  if (path === "admin/spec-templates" && method === "POST") {
    const body = await jsonBody(req);
    const [template] = await rows<any>(
      "INSERT INTO spec_template (id, code, name, description) VALUES ($1,$2,$3,$4) RETURNING *",
      [makeId("tmpl"), slug(body.code, "code"), String(body.name ?? "").trim(), String(body.description ?? "")],
    );
    if (!template.name) fail(422, "INVALID_TEMPLATE");
    return { status: 201, data: { template } };
  }
  const template = path.match(/^admin\/spec-templates\/([^/]+)$/);
  if (template && method === "GET") return { status: 200, data: await templateDetail(template[1]) };
  const templateGroup = path.match(/^admin\/spec-templates\/([^/]+)\/groups$/);
  if (templateGroup && method === "POST") {
    const body = await jsonBody(req);
    if (!String(body.name ?? "").trim()) fail(422, "INVALID_GROUP");
    const [group] = await rows<any>("INSERT INTO spec_group (id, template_id, name, position) VALUES ($1,$2,$3,$4) RETURNING *", [makeId("grp"), templateGroup[1], String(body.name).trim(), Number(body.position ?? 0)]);
    return { status: 201, data: { group } };
  }
  const templateLink = path.match(/^admin\/spec-templates\/([^/]+)\/attributes$/);
  if (templateLink && method === "POST") {
    const body = await jsonBody(req);
    await rows(
      `INSERT INTO spec_template_attribute (id, template_id, group_id, attribute_id, position, required)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (template_id, attribute_id) DO UPDATE SET group_id=EXCLUDED.group_id, position=EXCLUDED.position, required=EXCLUDED.required`,
      [makeId("link"), templateLink[1], body.groupId ?? null, String(body.attributeId), Number(body.position ?? 0), body.required ?? null],
    );
    return { status: 200, data: await templateDetail(templateLink[1]) };
  }
  const typeBinding = path.match(/^admin\/product-types\/([^/]+)\/spec-template$/);
  if (typeBinding && method === "POST") {
    const body = await jsonBody(req);
    await rows("UPDATE product_type SET spec_template_id=$2, updated_at=now() WHERE id=$1", [typeBinding[1], String(body.templateId)]);
    return { status: 200, data: { productTypeId: typeBinding[1], templateId: body.templateId } };
  }
  const specs = path.match(/^(?:admin\/)?products\/([^/]+)\/specifications$/);
  if (specs && method === "GET") return { status: 200, data: await productSpecifications(specs[1]) };
  if (specs && method === "POST") return { status: 200, data: await saveProductSpecs(specs[1], await jsonBody(req)) };
  const promote = path.match(/^admin\/products\/([^/]+)\/specifications\/([^/]+)\/promote$/);
  if (promote && method === "POST") return { status: 200, data: await promoteExtra(promote[2], actor) };
  if (path === "admin/size-guides" && method === "GET") return { status: 200, data: { guides: await rows("SELECT id, code, version, name, published, is_current FROM size_guide ORDER BY code, version") } };
  if (path === "admin/size-guides" && method === "POST") return { status: 201, data: { guide: await saveSizeGuide(await jsonBody(req)) } };
  const guidePublish = path.match(/^admin\/size-guides\/([^/]+)\/publish$/);
  if (guidePublish && method === "POST") return { status: 200, data: { guide: await publishGuide(guidePublish[1]) } };
  const productGuide = path.match(/^(?:admin\/)?products\/([^/]+)\/size-guide$/);
  if (productGuide && method === "GET") return { status: 200, data: await productSizeGuide(productGuide[1]) };
  if (productGuide && method === "POST") return { status: 200, data: await linkSizeGuide(productGuide[1], await jsonBody(req)) };
  if (path === "admin/promotions" && method === "GET") return { status: 200, data: { rules: await rows("SELECT * FROM promotion_rule ORDER BY created_at DESC") } };
  if (path === "admin/promotions" && method === "POST") return { status: 201, data: { rule: await saveRule(await jsonBody(req)) } };
  const promotion = path.match(/^admin\/promotions\/([^/]+)$/);
  if (promotion && method === "POST") return { status: 200, data: { rule: await saveRule(await jsonBody(req), promotion[1]) } };
  const promotionRun = path.match(/^admin\/promotions\/([^/]+)\/run$/);
  if (promotionRun && method === "POST") return { status: 200, data: await runRule(promotionRun[1], await jsonBody(req), actor) };
  if (path === "promotions/preview" && method === "POST") {
    const body = await jsonBody(req);
    const pool = await database();
    const client = await pool.connect();
    try {
      const priced = await priceCoupon(client, { code: body.code, phone: String(body.phone ?? ""), email: body.email ?? null, itemsAmount: Number(body.itemsAmount ?? 0), lineIds: body.lineIds ?? [], payMethod: String(body.payMethod ?? "online") });
      return { status: 200, data: priced };
    } finally { client.release(); }
  }
  if (path === "admin/finance/summary" && method === "GET") return { status: 200, data: await financeSummary(params) };
  if (path === "admin/finance/series" && method === "GET") return { status: 200, data: await financeSeries(params) };
  if (path === "admin/finance/aging" && method === "GET") return { status: 200, data: await aging(params.get("supplierId") ?? undefined) };
  const statement = path.match(/^admin\/finance\/suppliers\/([^/]+)\/statement$/);
  if (statement && method === "GET") return { status: 200, data: await supplierStatement(statement[1]) };
  const settlement = path.match(/^admin\/finance\/suppliers\/([^/]+)\/settlements$/);
  if (settlement && method === "POST") return { status: 201, data: await createSettlement(settlement[1], actor) };
  const settlementStatus = path.match(/^admin\/finance\/settlements\/([^/]+)\/(reviewed|approved|paid|exception)$/);
  if (settlementStatus && method === "POST") return { status: 200, data: await transitionSettlement(settlementStatus[1], settlementStatus[2], actor) };
  if (path === "admin/finance/adjustments" && method === "POST") return { status: 201, data: await createAdjustment(await jsonBody(req), actor) };
  if (path === "admin/finance/allocations" && method === "POST") return { status: 201, data: await saveAllocation(await jsonBody(req)) };
  if (path === "admin/finance/periods" && method === "POST") {
    const body = await jsonBody(req);
    const [period] = await rows<any>("INSERT INTO accounting_period (id, name, starts_on, ends_on, status) VALUES ($1,$2,$3,$4,$5) RETURNING *", [makeId("per"), String(body.name), body.startsOn, body.endsOn, body.status ?? "open"]);
    return { status: 201, data: { period } };
  }
  const closePeriod = path.match(/^admin\/finance\/periods\/([^/]+)\/(closed|locked)$/);
  if (closePeriod && method === "POST") {
    requireAdmin(actor);
    const [period] = await rows<any>("UPDATE accounting_period SET status=$2, closed_at=now(), closed_by=$3 WHERE id=$1 RETURNING *", [closePeriod[1], closePeriod[2], actor?.sub]);
    return { status: 200, data: { period } };
  }
  if (path === "admin/finance/journal" && method === "POST") {
    const body = await jsonBody(req);
    const admin = requireAdmin(actor);
    const id = await transaction((client) => postJournal(client, {
      memo: String(body.memo ?? "ثبت دستی"),
      sourceType: String(body.sourceType ?? "manual"),
      sourceId: String(body.sourceId ?? makeId("src")),
      occurredAt: body.occurredAt,
      actorId: admin.sub,
      lines: body.lines ?? [],
    }));
    return { status: 201, data: { id } };
  }
  const report = path.match(/^admin\/finance\/reports\/(sales|shipping|settlements|ledger)$/);
  if (report && method === "GET") {
    const exported = await reportExport(report[1], params);
    if (params.get("format") && params.get("format") !== "json") {
      return new Response(exported.body, { status: 200, headers: { "content-type": exported.type } });
    }
    return { status: 200, data: JSON.parse(exported.body as string) };
  }
  fail(404, "NOT_FOUND");
}
