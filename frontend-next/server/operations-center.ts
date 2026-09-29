import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { decideRetailPrice } from "./commerce-discovery";
import { database, makeId, passwordRecord, rows, transaction } from "./database";
import { ensurePlatformSchema } from "./platform-360";

type Json = Record<string, any>;
type Actor = { sub: string; role: string; sv?: number } | null;

export class OpsCenterError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

export const AUTOMATION_EVENTS = [
  "order.created", "order.paid", "order.shipped", "order.delivered", "product.created", "product.submitted", "product.rejected",
  "customer.created", "customer.updated", "membership.activated", "membership.expiring", "membership.expired",
  "ticket.created", "invoice.issued", "shipment.tracking.updated", "shipment.updated", "review.created", "cart.abandoned",
  "recommendation.shown", "recommendation.clicked", "recommendation.added_to_cart", "recommendation.purchased",
  "coupon.issued", "payment.completed", "refund.completed", "supplier.payable.created",
  "settlement.created", "settlement.approved", "settlement.paid",
  "withdrawal.requested", "withdrawal.paid", "adjustment.created",
] as const;

export const RECOMMENDATION_SLOTS = [
  "home.hero_recommendations", "home.for_you", "product.similar", "product.complete_the_look",
  "cart.you_may_like", "checkout.last_minute", "account.for_you",
] as const;

const SCHEMA = `
ALTER TABLE retail_product ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE supplier_product ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE supplier_variant ADD COLUMN IF NOT EXISTS weight_grams integer;
ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS shipping_snapshot jsonb NOT NULL DEFAULT '{}';
ALTER TABLE retail_order ADD COLUMN IF NOT EXISTS shipping_weight_grams integer;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS family_name text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE account_user ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS status text;
UPDATE product_review SET status='approved' WHERE status IS NULL;
ALTER TABLE product_review ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS verified_purchase boolean NOT NULL DEFAULT false;
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]';
ALTER TABLE product_review ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS shipping_method (
  id text PRIMARY KEY, label text NOT NULL, eta text, active boolean NOT NULL DEFAULT true,
  requires_weight boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shipping_rule (
  id text PRIMARY KEY, method_id text NOT NULL, rule_type text NOT NULL, priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS automation_outbox (
  id text PRIMARY KEY, event_id text NOT NULL, event_type text NOT NULL, endpoint_id text NOT NULL DEFAULT '', envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text,
  next_retry_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS automation_outbox_event_endpoint ON automation_outbox(event_id, endpoint_id);
CREATE TABLE IF NOT EXISTS automation_nonce (
  id text PRIMARY KEY, signature text NOT NULL UNIQUE, seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shipment (
  id text PRIMARY KEY, order_code text, order_id text, tracking_code text, customer_name text, phone text,
  carrier text, origin text, destination text, status text NOT NULL DEFAULT 'created', last_location text,
  shipped_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shipment_event (
  id text PRIMARY KEY, shipment_id text NOT NULL, status text NOT NULL, location text, occurred_at timestamptz NOT NULL,
  source text NOT NULL, raw_reference text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracking_import (
  id text PRIMARY KEY, source text NOT NULL, confidence numeric, status text NOT NULL, order_code text, tracking_code text,
  payload jsonb NOT NULL DEFAULT '{}', shipment_id text, review_note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_notification (
  id text PRIMARY KEY, user_id text, phone text, channel text NOT NULL, title text NOT NULL, body text NOT NULL,
  status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_note (
  id text PRIMARY KEY, user_id text NOT NULL, author_id text, body text NOT NULL, visibility text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz
);
CREATE TABLE IF NOT EXISTS customer_audit (
  id text PRIMARY KEY, user_id text NOT NULL, actor_id text, field text NOT NULL, old_value text, new_value text,
  reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contact_challenge (
  id text PRIMARY KEY, user_id text NOT NULL, channel text NOT NULL, target text NOT NULL, code_hash text NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_security (
  user_id text PRIMARY KEY, totp_secret text, totp_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_session (
  id text PRIMARY KEY, user_id text NOT NULL, user_agent text, ip text, epoch integer NOT NULL DEFAULT 0,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_history (
  id text PRIMARY KEY, user_id text, email text, success boolean NOT NULL, ip text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_segment (
  id text PRIMARY KEY, name text NOT NULL, definition jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_label (
  user_id text NOT NULL, code text NOT NULL, reason text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
CREATE TABLE IF NOT EXISTS recommendation_slot (
  code text PRIMARY KEY, strategy text NOT NULL, config jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS customer_address (
  id text PRIMARY KEY, user_id text NOT NULL, label text, province text, city text, address text,
  plaque text, unit text, postal text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recommendation_event (
  id text PRIMARY KEY, slot text NOT NULL, strategy text NOT NULL, product_id text, user_id text, name text NOT NULL,
  amount bigint, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE recommendation_event ADD COLUMN IF NOT EXISTS amount bigint;
CREATE TABLE IF NOT EXISTS review_moderation (
  id text PRIMARY KEY, review_id text NOT NULL, actor_id text, status text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

let ready: Promise<void> | null = null;

export async function ensureOperationsSchema(client?: PoolClient) {
  const apply = async (db: PoolClient) => {
    await db.query(SCHEMA);
    const methods = [
      ["post", "پست عادی", "۵ تا ۷ روز کاری"],
      ["pishtaz", "پست پیشتاز", "۲ تا ۳ روز کاری"],
      ["tipax", "تیپاکس", "۱ تا ۲ روز کاری"],
    ];
    for (const [id, label, eta] of methods) {
      await db.query(
        `INSERT INTO shipping_method (id, label, eta) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [id, label, eta],
      );
    }
    const flats = [["post", 59000], ["pishtaz", 89000], ["tipax", 145000]] as const;
    for (const [method, amount] of flats) {
      await db.query(
        `INSERT INTO shipping_rule (id, method_id, rule_type, priority, config)
         SELECT $1, $2, 'flat_rate', 100, $3::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM shipping_rule WHERE method_id=$2 AND rule_type='flat_rate')`,
        [`ship_flat_${method}`, method, JSON.stringify({ amount })],
      );
      await db.query(
        `INSERT INTO shipping_rule (id, method_id, rule_type, priority, config)
         SELECT $1, $2, 'free_shipping', 10, '{"payMethods":["cod"]}'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM shipping_rule WHERE method_id=$2 AND rule_type='free_shipping' AND priority=10)`,
        [`ship_cod_${method}`, method],
      );
      await db.query(
        `INSERT INTO shipping_rule (id, method_id, rule_type, priority, config)
         SELECT $1, $2, 'free_shipping', 20, '{"minOrderValue":3000000}'::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM shipping_rule WHERE method_id=$2 AND rule_type='free_shipping' AND priority=20)`,
        [`ship_free_${method}`, method],
      );
    }
    for (const [code, strategy] of [
      ["home.hero_recommendations", "trending"],
      ["home.for_you", "personalized"],
      ["product.similar", "similar"],
      ["product.complete_the_look", "rule"],
      ["cart.you_may_like", "popular"],
      ["checkout.last_minute", "popular"],
      ["account.for_you", "personalized"],
    ] as const) {
      await db.query(
        `INSERT INTO recommendation_slot (code, strategy) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
        [code, strategy],
      );
    }
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

export function isOperationsPath(path: string) {
  return path === "shipping/quote" || path === "shipping/methods" || path.startsWith("admin/shipping")
    || path.startsWith("admin/automation") || path === "automation/tracking" || path.startsWith("admin/shipments")
    || path.startsWith("admin/tracking") || path.startsWith("admin/people") || path.startsWith("admin/segments")
    || path.startsWith("admin/reviews") || path.startsWith("admin/recommendations") || path.startsWith("account/")
    || path === "recommendations" || path === "recommendations/events" || path === "reviews" || path === "automation/events"
    || /^products\/[^/]+\/reviews$/.test(path);
}

function bandAmount(bands: Array<{ minGrams: number; maxGrams: number; amount: number }>, grams: number) {
  const band = bands.find((item) => grams >= Number(item.minGrams) && grams < Number(item.maxGrams));
  return band ? Number(band.amount) : null;
}

function ruleMatches(rule: any, input: { payMethod: string; orderValue: number; city: string; weight: number | null }) {
  const config = rule.config ?? {};
  if (rule.rule_type === "flat_rate") return Number.isFinite(Number(config.amount));
  if (rule.rule_type === "free_shipping") {
    if (config.payMethods && !config.payMethods.includes(input.payMethod)) return false;
    if (config.minOrderValue != null && input.orderValue < Number(config.minOrderValue)) return false;
    if (config.cities && !config.cities.includes(input.city)) return false;
    return true;
  }
  if (rule.rule_type === "weight_based") return input.weight != null && bandAmount(config.bands ?? [], input.weight) != null;
  if (rule.rule_type === "order_value") {
    const min = Number(config.min ?? 0);
    const max = config.max == null ? Infinity : Number(config.max);
    return input.orderValue >= min && input.orderValue < max && Number.isFinite(Number(config.amount));
  }
  if (rule.rule_type === "destination") return Boolean(input.city) && (config.cities ?? []).includes(input.city) && Number.isFinite(Number(config.amount));
  if (rule.rule_type === "carrier_api") return config.connected === true && Number.isFinite(Number(config.amount));
  if (rule.rule_type === "composite") {
    const needs = [config.bands ? "weight" : null, config.cities ? "city" : null, config.minOrderValue != null ? "value" : null].filter(Boolean);
    if (needs.length < 2) return false;
    if (config.bands && (input.weight == null || bandAmount(config.bands, input.weight) == null)) return false;
    if (config.cities && !config.cities.includes(input.city)) return false;
    if (config.minOrderValue != null && input.orderValue < Number(config.minOrderValue)) return false;
    return true;
  }
  return false;
}

function rulePrice(rule: any, weight: number | null) {
  const config = rule.config ?? {};
  if (rule.rule_type === "free_shipping") return 0;
  if (rule.rule_type === "weight_based" || rule.rule_type === "composite") {
    const band = weight == null ? null : bandAmount(config.bands ?? [], weight);
    return (band ?? Number(config.amount ?? 0)) + Number(config.citySurcharge ?? 0);
  }
  return Number(config.amount ?? 0);
}

function specificity(rule: any) {
  if (rule.rule_type === "free_shipping") return 6;
  if (rule.rule_type === "composite") return 5;
  if (rule.rule_type === "weight_based") return 3;
  if (rule.rule_type === "destination" || rule.rule_type === "order_value") return 2;
  if (rule.rule_type === "carrier_api") return 2;
  return 1;
}

async function lineWeight(client: PoolClient, line: { id: string; color?: string | null; size?: string | null }) {
  const variant = (await client.query(
    `SELECT weight_grams FROM supplier_variant
     WHERE product_id=$1 AND weight_grams IS NOT NULL AND ($2::text IS NULL OR color=$2) AND ($3::text IS NULL OR size=$3)
     ORDER BY weight_grams DESC LIMIT 1`,
    [line.id, line.color || null, line.size || null],
  )).rows[0];
  if (variant?.weight_grams != null) return Number(variant.weight_grams);
  const product = (await client.query("SELECT weight_grams FROM retail_product WHERE id=$1", [line.id])).rows[0];
  if (product?.weight_grams != null) return Number(product.weight_grams);
  const parent = (await client.query("SELECT weight_grams FROM supplier_product WHERE id=$1", [line.id])).rows[0];
  return parent?.weight_grams == null ? null : Number(parent.weight_grams);
}

export async function quoteShipping(client: PoolClient, input: {
  method?: string; payMethod?: string; orderValue: number; city?: string;
  lines: Array<{ id: string; qty: number; color?: string | null; size?: string | null }>;
}) {
  const requested = String(input.method || "post");
  const known = (await client.query("SELECT id FROM shipping_method WHERE id=$1 AND active", [requested])).rows[0];
  const method = known ? requested : "post";
  const payMethod = String(input.payMethod || "gateway");
  const city = String(input.city || "");
  const weights = [];
  for (const line of input.lines) {
    const weight = await lineWeight(client, line);
    weights.push(weight == null ? null : weight * line.qty);
  }
  const weightKnown = weights.every((item) => item != null);
  const weight = weightKnown ? weights.reduce((sum, item) => sum + Number(item), 0) : null;
  const methodRow = (await client.query("SELECT * FROM shipping_method WHERE id=$1", [method])).rows[0];
  if (methodRow?.requires_weight && weight == null) throw new OpsCenterError(422, "WEIGHT_REQUIRED");
  const rules = (await client.query("SELECT * FROM shipping_rule WHERE method_id=$1 AND active ORDER BY priority, id", [method])).rows;
  const context = { payMethod, orderValue: input.orderValue, city, weight };
  const matched = rules.filter((rule) => ruleMatches(rule, context));
  const chosen = matched.sort((a, b) => specificity(b) - specificity(a) || a.priority - b.priority)[0];
  const amount = chosen ? rulePrice(chosen, weight) : 59000;
  const freeRule = rules.find((rule) => rule.rule_type === "free_shipping" && rule.config?.minOrderValue != null);
  return {
    method,
    amount,
    freeThreshold: freeRule ? Number(freeRule.config.minOrderValue) : null,
    weightGrams: weight,
    ruleId: chosen?.id ?? "legacy_flat",
    ruleType: chosen?.rule_type ?? "flat_rate",
    ignoredClientAmount: true,
    snapshot: { method, amount, weightGrams: weight, ruleId: chosen?.id ?? null, ruleType: chosen?.rule_type ?? "flat_rate", payMethod, city, orderValue: input.orderValue },
  };
}

export async function enqueueOutbox(event: { eventId: string; eventType: string; entityType: string; entityId: string; data: Json; occurredAt?: string }) {
  try {
    await ensureOperationsSchema();
  } catch {
    return;
  }
  const envelope = {
    event: event.eventType,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    entityId: event.entityId,
    entity: { type: event.entityType, id: event.entityId },
    data: event.data,
    schemaVersion: 1,
  };
  const endpoints = await rows<any>("SELECT id FROM integration_endpoint WHERE active AND $1 = ANY(events)", [event.eventType]);
  const targets = endpoints.length ? endpoints : [{ id: "" }];
  for (const endpoint of targets) {
    await rows(
      `INSERT INTO automation_outbox (id, event_id, event_type, endpoint_id, envelope, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (event_id, endpoint_id) DO NOTHING`,
      [makeId("aout"), event.eventId, event.eventType, endpoint.id || "", JSON.stringify(envelope), endpoint.id ? "pending" : "stored"],
    );
  }
  if (endpoints.length) setTimeout(() => { void drainOutbox(); }, 15);
}

let drainChain: Promise<unknown> = Promise.resolve();
export function drainOutbox(limit = 20) {
  const run = drainChain.then(() => drainOutboxNow(limit));
  drainChain = run.then(() => undefined, () => undefined);
  return run;
}

async function drainOutboxNow(limit = 20) {
    await ensureOperationsSchema();
    const jobs = await rows<any>(
      `SELECT o.*, e.url, e.secret FROM automation_outbox o
       LEFT JOIN integration_endpoint e ON e.id=o.endpoint_id
       WHERE o.status IN ('pending','failed') AND o.attempts < 5 AND o.next_retry_at <= now() AND o.endpoint_id <> ''
       ORDER BY o.created_at LIMIT $1`,
      [limit],
    );
    let delivered = 0;
    for (const job of jobs) {
      if (!job.secret || !job.url) {
        await rows("UPDATE automation_outbox SET status='failed', attempts=attempts+1, last_error='ENDPOINT_MISSING' WHERE id=$1", [job.id]);
        continue;
      }
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify(job.envelope);
      try {
        const signature = createHmac("sha256", job.secret).update(`${timestamp}.${body}`).digest("hex");
        const response = await fetch(job.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kolbe-signature": signature,
            "x-kolbe-timestamp": timestamp,
            "x-kolbe-event-id": job.event_id,
            "idempotency-key": `${job.endpoint_id}:${job.event_id}`,
          },
          body,
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await rows("UPDATE automation_outbox SET status='delivered', delivered_at=now(), last_error=NULL WHERE id=$1", [job.id]);
        await rows(
          "INSERT INTO integration_delivery (id, endpoint_id, event_id, event_name, status, detail) VALUES ($1,$2,$3,$4,'delivered','outbox')",
          [makeId("idel"), job.endpoint_id, job.event_id, job.event_type],
        );
        delivered += 1;
      } catch (error) {
        const attempts = Number(job.attempts) + 1;
        const wait = Math.min(3600, 15 * 2 ** attempts);
        await rows(
          "UPDATE automation_outbox SET status='failed', attempts=$2, last_error=$3, next_retry_at=now() + ($4 || ' seconds')::interval WHERE id=$1",
          [job.id, attempts, error instanceof Error ? error.message : "DELIVERY_FAILED", String(wait)],
        );
      }
    }
    return { drained: jobs.length, delivered };
}

export function signAutomationBody(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function verifyInbound(req: NextRequest, raw: string) {
  const timestamp = req.headers.get("x-kolbe-timestamp") || "";
  const signature = req.headers.get("x-kolbe-signature") || "";
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !signature || !Number.isFinite(skew) || skew > 300) throw new OpsCenterError(401, "SIGNATURE_EXPIRED");
  const endpoints = await rows<any>("SELECT id, secret FROM integration_endpoint WHERE active AND kind='n8n'");
  const match = endpoints.find((endpoint) => {
    const expected = signAutomationBody(endpoint.secret, timestamp, raw);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!match) throw new OpsCenterError(401, "INVALID_SIGNATURE");
  const seen = await rows(
    "INSERT INTO automation_nonce (id, signature) VALUES ($1,$2) ON CONFLICT (signature) DO NOTHING RETURNING id",
    [makeId("anon"), signature],
  );
  if (!seen.length) throw new OpsCenterError(409, "REPLAY");
  return match;
}

const SHIPMENT_STATUSES = [
  "handed_to_carrier", "tracking_recorded", "hub_in", "hub_out", "destination_city", "out_for_delivery", "delivered",
];

async function notifyShipment(shipment: any, status: string) {
  const title = "وضعیت مرسوله";
  const body = status === "handed_to_carrier"
    ? `سفارش شما تحویل شرکت حمل شد. کد رهگیری: ${shipment.tracking_code || "—"}`
    : `وضعیت مرسوله ${shipment.tracking_code || shipment.order_code || ""} به‌روز شد.`;
  await rows(
    "INSERT INTO customer_notification (id, phone, channel, title, body, status) VALUES ($1,$2,'sms',$3,$4,'queued')",
    [makeId("cnot"), shipment.phone, title, body],
  );
  const { emitEvent } = await import("./platform-360");
  await emitEvent("shipment.updated", "shipment", shipment.id, { orderCode: shipment.order_code, trackingCode: shipment.tracking_code, status });
  await emitEvent("shipment.tracking.updated", "shipment", shipment.id, { orderCode: shipment.order_code, trackingCode: shipment.tracking_code, status });
  if (status === "handed_to_carrier" || status === "tracking_recorded") {
    await emitEvent("order.shipped", "order", shipment.order_code, { trackingCode: shipment.tracking_code, status });
  }
}

async function applyTracking(input: Json, source: string) {
  const order = (await rows<any>("SELECT * FROM retail_order WHERE order_code=$1", [input.orderCode]))[0];
  if (!order) return { status: "failed" as const, reason: "ORDER_NOT_FOUND" };
  const id = makeId("ship");
  const existing = (await rows<any>("SELECT * FROM shipment WHERE order_code=$1 ORDER BY created_at DESC LIMIT 1", [order.order_code]))[0];
  const shipmentId = existing?.id ?? id;
  if (!existing) {
    await rows(
      `INSERT INTO shipment (id, order_code, order_id, tracking_code, customer_name, phone, carrier, origin, destination, status, shipped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [shipmentId, order.order_code, order.id, input.trackingCode || null, order.customer_name, order.phone, input.carrier || null, input.origin || "انبار کلبه", input.destination || order.address?.city || null, input.status || "tracking_recorded"],
    );
  } else {
    await rows(
      "UPDATE shipment SET tracking_code=COALESCE($2, tracking_code), status=$3, last_location=$4, carrier=COALESCE($5, carrier), updated_at=now() WHERE id=$1",
      [shipmentId, input.trackingCode || null, input.status || existing.status, input.location || null, input.carrier || null],
    );
  }
  await rows(
    "INSERT INTO shipment_event (id, shipment_id, status, location, occurred_at, source, raw_reference) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [makeId("shev"), shipmentId, input.status || "tracking_recorded", input.location || null, input.occurredAt || new Date().toISOString(), source, input.rawReference || null],
  );
  const shipment = (await rows<any>("SELECT * FROM shipment WHERE id=$1", [shipmentId]))[0];
  await notifyShipment(shipment, input.status || "tracking_recorded");
  return { status: "confirmed" as const, shipmentId };
}

function hashCode(code: string) {
  return createHmac("sha256", "kolbe-contact").update(code).digest("hex");
}

function passwordMatches(password: string, salt: string, hash: string) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function currentTotp(secret: string) {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export function verifyTotp(secret: string, token: string) {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 30000);
  for (let drift = -1; drift <= 1; drift += 1) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter + drift));
    const hmac = createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    if (String(code).padStart(6, "0") === token) return true;
  }
  return false;
}

async function requireAdmin(actor: Actor) {
  if (!actor || actor.role !== "admin") throw new OpsCenterError(401, "UNAUTHORIZED");
  return actor;
}

async function requireUser(actor: Actor) {
  if (!actor) throw new OpsCenterError(401, "UNAUTHORIZED");
  return actor;
}

async function customerOrders(user: any) {
  return rows<any>(
    `SELECT order_code, total_amount, pay_method, payment_status, lines, created_at, address FROM retail_order
     WHERE phone=$1 OR ($2::text IS NOT NULL AND email=$2) ORDER BY created_at DESC`,
    [user.phone, user.email],
  );
}

function behaviorFrom(orders: any[]) {
  const totals = orders.map((order) => Number(order.total_amount));
  const dates = orders.map((order) => new Date(order.created_at).getTime()).sort((a, b) => a - b);
  const gaps = dates.slice(1).map((date, index) => Math.round((date - dates[index]) / 86400_000));
  const categories = new Map<string, number>();
  const colors = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const order of orders) {
    const lines = Array.isArray(order.lines) ? order.lines : [];
    for (const line of lines) {
      if (line.category) categories.set(line.category, (categories.get(line.category) ?? 0) + line.qty);
      if (line.colour) colors.set(line.colour, (colors.get(line.colour) ?? 0) + line.qty);
      if (line.size) sizes.set(line.size, (sizes.get(line.size) ?? 0) + line.qty);
    }
  }
  const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count }));
  return {
    orderCount: orders.length,
    totalValue: totals.reduce((sum, value) => sum + value, 0),
    averageOrder: orders.length ? Math.round(totals.reduce((sum, value) => sum + value, 0) / orders.length) : 0,
    maxOrder: totals.length ? Math.max(...totals) : 0,
    lastPurchaseAt: orders[0]?.created_at ?? null,
    purchaseGapDays: gaps,
    favoriteCategories: top(categories),
    favoriteColors: top(colors),
    favoriteSizes: top(sizes),
    cancelled: orders.filter((order) => order.payment_status === "cancelled").length,
    failedPayments: orders.filter((order) => String(order.payment_status).includes("failed")).length,
    installmentOrders: orders.filter((order) => order.pay_method === "installment").length,
    discountedOrders: orders.filter((order) => (order.lines ?? []).some((line: any) => Number(line.priceSnapshot?.discount ?? 0) > 0)).length,
  };
}

export async function evaluateCustomerLabels(userId: string) {
  const user = (await rows<any>("SELECT * FROM account_user WHERE id=$1", [userId]))[0];
  if (!user) return [];
  const orders = await customerOrders(user);
  const stats = behaviorFrom(orders);
  const daysSince = stats.lastPurchaseAt ? (Date.now() - new Date(stats.lastPurchaseAt).getTime()) / 86400_000 : null;
  const labels: Array<[string, string]> = [];
  if (stats.orderCount <= 1) labels.push(["new_customer", "کمتر از دو سفارش"]);
  if (stats.orderCount >= 2) labels.push(["repeat_buyer", "بیش از یک خرید"]);
  if (stats.orderCount >= 3 && daysSince != null && daysSince < 60) labels.push(["loyal", "خرید تکراری اخیر"]);
  if (user.role === "vip") labels.push(["vip", "نقش وی‌آی‌پی"]);
  if (stats.totalValue >= 10_000_000) labels.push(["high_spender", "ارزش خرید بالای ده میلیون"]);
  if (daysSince != null && daysSince > 90 && stats.orderCount > 0) labels.push(["low_activity", "بیش از ۹۰ روز بدون خرید"]);
  if (daysSince != null && daysSince >= 60 && daysSince <= 120) labels.push(["churn_risk", "فاصله خرید رو به افزایش"]);
  if (daysSince != null && daysSince > 180) labels.push(["churned", "بیش از ۱۸۰ روز بدون خرید"]);
  if (stats.installmentOrders > 0) labels.push(["installment_buyer", "حداقل یک سفارش اقساطی"]);
  if (stats.failedPayments > 0) labels.push(["failed_payment", "پرداخت ناموفق ثبت شده"]);
  const purchasedText = orders.flatMap((order) => order.lines ?? []).map((line: any) => `${line.name ?? ""} ${line.category ?? ""}`).join(" ");
  if (/کفش/.test(purchasedText)) labels.push(["shoe_interest", "خرید واقعی در دسته کفش"]);
  if (/پالتو|بافت|شال|زمستان/.test(purchasedText)) labels.push(["winter_interest", "خرید واقعی پوشاک زمستانی"]);
  if (stats.discountedOrders > 0) labels.push(["discount_driven", "حداقل یک سفارش با تخفیف ثبت‌شده"]);
  const returns = await rows("SELECT id FROM ledger_entry WHERE party_type='buyer' AND party_id=$1 AND kind IN ('refund','return')", [userId]);
  if (returns.length >= 2) labels.push(["high_returns", "بیش از یک سند برگشت واقعی"]);
  const wholesale = (await rows("SELECT id FROM wholesale_account WHERE user_id=$1", [userId]))[0];
  if (wholesale) labels.push(["wholesale_buyer", "حساب عمده دارد"]);
  await rows("DELETE FROM customer_label WHERE user_id=$1", [userId]);
  for (const [code, reason] of labels) {
    await rows("INSERT INTO customer_label (user_id, code, reason) VALUES ($1,$2,$3)", [userId, code, reason]);
  }
  return labels.map(([code, reason]) => ({ code, reason }));
}

function segmentMatch(profile: any, definition: any) {
  const checks = Array.isArray(definition?.all) ? definition.all : [];
  return checks.every((check: any) => {
    const value = profile[check.field];
    if (check.op === "=") return value === check.value;
    if (check.op === ">") return Number(value) > Number(check.value);
    if (check.op === "<") return Number(value) < Number(check.value);
    if (check.op === "includes") return Array.isArray(value) && value.some((item) => item.name === check.value || item === check.value);
    return false;
  });
}

async function canonicalProducts() {
  const products = await rows<any>("SELECT id, name, price, sale_price, category, weight_grams, active, created_at FROM retail_product WHERE active AND owner_type='kolbe' AND retail_enabled");
  const blocked = new Set((await rows<any>(
    `SELECT p.id FROM supplier_product p
     JOIN supplier_variant v ON v.product_id=p.id
     JOIN inventory_balance b ON b.variant_id=v.id
     GROUP BY p.id
     HAVING SUM(b.on_hand - b.reserved) <= 0`,
  )).map((row) => row.id));
  return products.filter((product) => !blocked.has(product.id)).map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.sale_price ?? product.price),
    basePrice: Number(product.price),
    category: product.category,
    createdAt: product.created_at,
    priceSource: "server",
    inStock: true,
  }));
}

function seasonBoost(name: string, category: string) {
  const month = new Date().getMonth();
  const winter = month === 11 || month <= 1;
  const summer = month >= 5 && month <= 7;
  const text = `${name} ${category}`;
  if (winter && /پالتو|کت|بافت|شال/.test(text)) return 3;
  if (summer && /کتان|پولو|پیراهن/.test(text)) return 2;
  return 0;
}

async function customerSignals(userId: string) {
  const user = (await rows<any>("SELECT phone, email FROM account_user WHERE id=$1", [userId]))[0];
  const orders = user ? await customerOrders(user) : [];
  const categories = new Set<string>();
  const colors = new Set<string>();
  for (const order of orders) for (const line of order.lines ?? []) {
    if (line.category) categories.add(line.category);
    if (line.colour) colors.add(line.colour);
  }
  const viewedRows = await rows<any>(
    `SELECT COALESCE(payload->>'productId', subject_id) AS subject_id FROM domain_event
     WHERE name='product.viewed' AND (payload->>'userId'=$1 OR subject_id=$1)
     UNION SELECT payload->>'productId' FROM commerce_signal WHERE user_id=$1 AND name='product.viewed'`,
    [userId],
  );
  const viewed = new Set(viewedRows.map((row) => row.subject_id).filter(Boolean));
  const favorites = new Set((await rows<any>(
    `SELECT f.product_id FROM buyer_favorite f JOIN wholesale_account a ON a.id=f.account_id WHERE a.user_id=$1`,
    [userId],
  )).map((row) => row.product_id));
  const searches = (await rows<any>("SELECT payload->>'query' AS query FROM commerce_signal WHERE user_id=$1 AND name='search' AND payload->>'query' IS NOT NULL", [userId]))
    .map((row) => String(row.query));
  for (const id of viewed) {
    const product = (await rows<any>("SELECT category FROM retail_product WHERE id=$1", [id]))[0];
    if (product?.category) categories.add(product.category);
  }
  return { categories, colors, viewed, favorites, searches };
}

export async function attributeRecommendationPurchase(phone: string | null, email: string | null, lines: Array<{ id: string; qty: number; price: number }>) {
  const user = (await rows<any>("SELECT id FROM account_user WHERE ($1::text IS NOT NULL AND phone=$1) OR ($2::text IS NOT NULL AND email=$2) LIMIT 1", [phone, email]))[0];
  if (!user) return;
  for (const line of lines) {
    const prior = (await rows<any>(
      `SELECT slot, strategy FROM recommendation_event
       WHERE user_id=$1 AND product_id=$2 AND name IN ('recommendation.shown','recommendation.clicked')
         AND created_at > now() - interval '14 days'
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, line.id],
    ))[0];
    if (!prior) continue;
    await rows(
      "INSERT INTO recommendation_event (id, slot, strategy, product_id, user_id, name, amount) VALUES ($1,$2,$3,$4,$5,'recommendation.purchased',$6)",
      [makeId("revt"), prior.slot, prior.strategy, line.id, user.id, Number(line.price) * Number(line.qty)],
    );
  }
}

export async function recommend(slot: string, actor: Actor, productId?: string) {
  const configured = (await rows<any>("SELECT * FROM recommendation_slot WHERE code=$1", [slot]))[0];
  const strategy = configured?.strategy || "popular";
  let products = await canonicalProducts();
  const sales = await rows<any>("SELECT line->>'id' AS id, SUM((line->>'qty')::int)::int AS qty FROM retail_order, LATERAL jsonb_array_elements(lines) line GROUP BY line->>'id'");
  const sold = new Map(sales.map((row) => [row.id, Number(row.qty)]));

  const signals = actor ? await customerSignals(actor.sub) : { categories: new Set<string>(), colors: new Set<string>(), viewed: new Set<string>(), favorites: new Set<string>(), searches: [] as string[] };
  let usedStrategy = actor || strategy !== "personalized" ? strategy : "popular";
  if (strategy === "personalized" && actor && signals.categories.size + signals.viewed.size + signals.favorites.size === 0) usedStrategy = "popular";
  if (usedStrategy === "personalized" && actor) {
    products = products
      .map((product) => ({
        ...product,
        score: (signals.categories.has(product.category) ? 2 : 0)
          + (signals.favorites.has(product.id) ? 3 : 0)
          + ([...signals.colors].some((color) => product.name.includes(color)) ? 1 : 0)
          + (signals.searches.some((term) => term && product.name.includes(term)) ? 2 : 0)
          + seasonBoost(product.name, product.category),
      }))
      .sort((a, b) => b.score - a.score);
  } else if (strategy === "similar" && productId) {
    const current = products.find((product) => product.id === productId);
    products = products.filter((product) => product.id !== productId && (!current || product.category === current.category));
  } else if (strategy === "new") {
    products = [...products].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (usedStrategy === "popular" || strategy === "trending" || usedStrategy === "trending") {
    products = [...products].sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (strategy === "collaborative" && productId) {
    const together = await rows<any>(
      `SELECT line->>'id' AS id, COUNT(*)::int AS qty FROM retail_order o, LATERAL jsonb_array_elements(o.lines) line
       WHERE o.lines @> $1::jsonb AND line->>'id' <> $2 GROUP BY line->>'id' ORDER BY qty DESC`,
      [JSON.stringify([{ id: productId }]), productId],
    );
    const rank = new Map(together.map((row, index) => [row.id, together.length - index]));
    products = products.filter((product) => rank.has(product.id)).sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
  } else if (strategy === "seasonal") {
    products = products.map((product) => ({ ...product, score: seasonBoost(product.name, product.category) })).sort((a, b) => b.score - a.score);
  } else if (strategy === "manual") {
    const ids = new Set<string>(configured?.config?.productIds ?? []);
    products = products.filter((product) => ids.has(product.id));
  } else if (strategy === "rule") {
    const ids = new Set<string>(configured?.config?.productIds ?? []);
    const category = configured?.config?.category;
    if (ids.size) products = products.filter((product) => ids.has(product.id));
    else if (productId) {
      const current = products.find((product) => product.id === productId);
      products = products.filter((product) => product.id !== productId && (!current || product.category === current.category));
    } else if (category) products = products.filter((product) => product.category === category);
  }
  const chosen = products.slice(0, 8);
  const priced = [];
  for (const product of chosen) {
    const decision = await transaction((client) => decideRetailPrice(client, product.id, "gateway"));
    if (!decision.ok) continue;
    priced.push({ ...product, price: decision.price, priceSource: "pricing_engine", snapshot: decision.snapshot });
    await rows(
      "INSERT INTO recommendation_event (id, slot, strategy, product_id, user_id, name) VALUES ($1,$2,$3,$4,$5,'recommendation.shown')",
      [makeId("revt"), slot, usedStrategy, product.id, actor?.sub ?? null],
    );
  }
  return { slot, strategy: usedStrategy, anonymous: !actor, products: priced, priceSource: "pricing_engine", weather: null };
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
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

export async function handleOperationsRequest(req: NextRequest, path: string, actor: Actor) {
  try {
    await ensureOperationsSchema();
    await transaction((client) => ensurePlatformSchema(client));
    const method = req.method;
    const url = new URL(req.url);
    if (path === "shipping/methods" && method === "GET") {
      return response({ methods: await rows("SELECT id, label, eta, active, requires_weight FROM shipping_method WHERE active ORDER BY id") });
    }
    if (path === "shipping/quote" && method === "POST") {
      const body = await jsonBody(req);
      const quoted = await transaction((client) => quoteShipping(client, {
        method: body.method || body.shippingId,
        payMethod: body.payMethod,
        orderValue: Number(body.orderValue ?? 0),
        city: body.city,
        lines: Array.isArray(body.lines) ? body.lines.map((line: any) => ({ id: String(line.id), qty: Number(line.qty || 1), color: line.colour || line.color || null, size: line.size || null })) : [],
      }));
      return response(quoted);
    }
    if (path === "admin/shipping/rules" && method === "GET") {
      await requireAdmin(actor);
      return response({ methods: await rows("SELECT * FROM shipping_method ORDER BY id"), rules: await rows("SELECT * FROM shipping_rule ORDER BY method_id, priority") });
    }
    if (path === "admin/shipping/rules" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const allowed = new Set(["flat_rate", "weight_based", "free_shipping", "order_value", "destination", "carrier_api", "composite"]);
      if (!allowed.has(body.ruleType) || !body.methodId) throw new OpsCenterError(422, "INVALID_RULE");
      if (body.ruleType === "carrier_api" && body.config?.connected !== true) throw new OpsCenterError(422, "CARRIER_NOT_CONNECTED");
      const id = makeId("srule");
      await rows(
        "INSERT INTO shipping_rule (id, method_id, rule_type, priority, config) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [id, body.methodId, body.ruleType, Number(body.priority ?? 50), JSON.stringify(body.config ?? {})],
      );
      if (body.requiresWeight != null) await rows("UPDATE shipping_method SET requires_weight=$2 WHERE id=$1", [body.methodId, Boolean(body.requiresWeight)]);
      return response({ id }, 201);
    }
    if (path === "admin/shipping/weights" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const grams = Math.round(Number(body.grams));
      if (!Number.isFinite(grams) || grams < 0) throw new OpsCenterError(422, "INVALID_WEIGHT");
      if (body.variantId) await rows("UPDATE supplier_variant SET weight_grams=$2 WHERE id=$1", [body.variantId, grams]);
      if (body.productId) {
        await rows("UPDATE retail_product SET weight_grams=$2, updated_at=now() WHERE id=$1", [body.productId, grams]);
        await rows("UPDATE supplier_product SET weight_grams=$2, updated_at=now() WHERE id=$1", [body.productId, grams]);
      }
      return response({ saved: true, grams });
    }
    if (path === "admin/automation" && method === "GET") {
      await requireAdmin(actor);
      const endpoints = await rows<any>("SELECT id, name, kind, url, events, active, created_at FROM integration_endpoint ORDER BY created_at DESC");
      const runs = await rows("SELECT id, event_type, status, attempts, last_error, created_at, delivered_at FROM automation_outbox ORDER BY created_at DESC LIMIT 40");
      return response({
        connection: { connected: endpoints.some((item) => item.active), endpoints: endpoints.length },
        webhooks: endpoints,
        events: AUTOMATION_EVENTS,
        workflows: await rows("SELECT id, name, event_name, action, active FROM crm_automation ORDER BY created_at DESC"),
        runs,
        succeeded: runs.filter((run: any) => run.status === "delivered" || run.status === "stored").length,
        failed: runs.filter((run: any) => run.status === "failed").length,
        warning: "رمز اتصال فقط در مرکز یکپارچه‌سازی ذخیره می‌شود و به فرانت برنمی‌گردد.",
      });
    }
    if (path === "admin/automation/drain" && method === "POST") {
      await requireAdmin(actor);
      return response(await drainOutbox());
    }
    const retry = path.match(/^admin\/automation\/([^/]+)\/retry$/);
    if (retry && method === "POST") {
      await requireAdmin(actor);
      await rows("UPDATE automation_outbox SET status='pending', next_retry_at=now() WHERE id=$1", [retry[1]]);
      return response(await drainOutbox());
    }
    if (path === "automation/events" && method === "POST") {
      const raw = await req.text();
      await verifyInbound(req, raw);
      const body = JSON.parse(raw) as Json;
      if (!AUTOMATION_EVENTS.includes(body.eventType) || !body.entityId) throw new OpsCenterError(422, "INVALID_EVENT");
      const { emitEvent } = await import("./platform-360");
      await emitEvent(body.eventType, String(body.entityType || "customer"), String(body.entityId), body.data ?? {});
      return response({ accepted: true }, 202);
    }
    if (path === "automation/tracking" && method === "POST") {
      const raw = await req.text();
      await verifyInbound(req, raw);
      const body = JSON.parse(raw) as Json;
      const confidence = body.confidence == null ? 0 : Number(body.confidence);
      if (!body.orderCode || !body.trackingCode) throw new OpsCenterError(422, "INVALID_INPUT");
      if (!(confidence >= 0.8)) {
        const id = makeId("timp");
        await rows(
          "INSERT INTO tracking_import (id, source, confidence, status, order_code, tracking_code, payload) VALUES ($1,$2,$3,'review',$4,$5,$6::jsonb)",
          [id, body.source || "n8n", confidence, body.orderCode, body.trackingCode, JSON.stringify(body)],
        );
        return response({ id, status: "review" }, 202);
      }
      const applied = await applyTracking(body, body.source || "n8n");
      const id = makeId("timp");
      await rows(
        "INSERT INTO tracking_import (id, source, confidence, status, order_code, tracking_code, payload, shipment_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
        [id, body.source || "n8n", confidence, applied.status, body.orderCode, body.trackingCode, JSON.stringify(body), applied.shipmentId ?? null],
      );
      return response({ id, ...applied }, applied.status === "confirmed" ? 201 : 422);
    }
    if (path === "admin/shipments" && method === "GET") {
      await requireAdmin(actor);
      return response({ shipments: await rows("SELECT * FROM shipment ORDER BY updated_at DESC LIMIT 100") });
    }
    if (path === "admin/shipments" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const applied = await applyTracking({ ...body, confidence: 1, status: body.status || "handed_to_carrier" }, "admin");
      return response(applied, 201);
    }
    const shipmentEvents = path.match(/^admin\/shipments\/([^/]+)\/events$/);
    if (shipmentEvents && method === "GET") {
      await requireAdmin(actor);
      return response({ events: await rows("SELECT * FROM shipment_event WHERE shipment_id=$1 ORDER BY occurred_at", [shipmentEvents[1]]) });
    }
    if (path === "admin/tracking/imports" && method === "GET") {
      await requireAdmin(actor);
      return response({ imports: await rows("SELECT * FROM tracking_import ORDER BY created_at DESC LIMIT 100") });
    }
    const reviewImport = path.match(/^admin\/tracking\/imports\/([^/]+)\/review$/);
    if (reviewImport && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const item = (await rows<any>("SELECT * FROM tracking_import WHERE id=$1", [reviewImport[1]]))[0];
      if (!item) throw new OpsCenterError(404, "NOT_FOUND");
      if (body.decision === "confirm") {
        const applied = await applyTracking(item.payload, "admin_review");
        await rows("UPDATE tracking_import SET status=$2, shipment_id=$3, review_note=$4 WHERE id=$1", [item.id, applied.status, applied.shipmentId ?? null, body.note || null]);
        return response(applied);
      }
      await rows("UPDATE tracking_import SET status='failed', review_note=$2 WHERE id=$1", [item.id, body.note || "رد شد"]);
      return response({ status: "failed" });
    }
    if (path === "admin/people" && method === "GET") {
      await requireAdmin(actor);
      return response({ people: await rows("SELECT id, email, display_name, family_name, phone, city, role, created_at, last_login_at FROM account_user ORDER BY created_at DESC LIMIT 100") });
    }
    const person = path.match(/^admin\/people\/([^/]+)$/);
    if (person && method === "GET") {
      await requireAdmin(actor);
      const user = (await rows<any>("SELECT id, email, display_name, family_name, phone, city, address, birth_date, gender, role, created_at, last_login_at FROM account_user WHERE id=$1", [person[1]]))[0];
      if (!user) throw new OpsCenterError(404, "NOT_FOUND");
      const orders = await customerOrders(user);
      const labels = await evaluateCustomerLabels(user.id);
      const reviews = await rows("SELECT id, product_id, rating, title, body, status, verified_purchase, created_at FROM product_review WHERE user_id=$1 ORDER BY created_at DESC", [user.id]);
      const plan = (await rows<any>("SELECT plan_name, status FROM wholesale_account WHERE user_id=$1", [user.id]))[0];
      const coupons = await rows("SELECT body, created_at FROM crm_note WHERE subject_type='customer' AND subject_id=$1 AND kind='coupon'", [user.id]);
      const returns = await rows("SELECT id, amount, memo, occurred_at FROM ledger_entry WHERE party_type='buyer' AND party_id=$1 AND kind IN ('refund','return')", [user.id]);
      const behavior = { ...behaviorFrom(orders), coupons: coupons.length, returns: returns.length };
      return response({
        profile: { ...user, plan: plan?.plan_name ?? null, vip: user.role === "vip" || plan?.status === "approved" },
        behavior,
        labels,
        orders,
        addresses: await rows("SELECT * FROM customer_address WHERE user_id=$1 ORDER BY created_at", [user.id]),
        notes: await rows("SELECT id, author_id, body, visibility, created_at, edited_at FROM customer_note WHERE user_id=$1 AND visibility='internal' ORDER BY created_at DESC", [user.id]),
        audits: await rows("SELECT field, old_value, new_value, actor_id, reason, created_at FROM customer_audit WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [user.id]),
        reviews,
        returns,
        timeline: await rows(
          `SELECT created_at, 'login' AS kind, email AS label FROM login_history WHERE user_id=$1
           UNION ALL SELECT created_at, 'note', body FROM customer_note WHERE user_id=$1
           UNION ALL SELECT created_at, 'order', order_code FROM retail_order WHERE phone=$2 OR email=$3
           UNION ALL SELECT created_at, name, subject_id FROM domain_event WHERE subject_id=$1
           UNION ALL SELECT created_at, 'review', product_id FROM product_review WHERE user_id=$1
           UNION ALL SELECT created_at, 'sms', title FROM customer_notification WHERE phone=$2
           ORDER BY created_at DESC LIMIT 80`,
          [user.id, user.phone, user.email],
        ),
      });
    }
    const noteEdit = path.match(/^admin\/people\/([^/]+)\/notes\/([^/]+)$/);
    if (noteEdit && method === "POST") {
      const admin = await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!body.body?.trim()) throw new OpsCenterError(422, "INVALID_INPUT");
      const updated = await rows(
        "UPDATE customer_note SET body=$3, edited_at=now() WHERE id=$1 AND user_id=$2 AND visibility='internal' RETURNING id",
        [noteEdit[2], noteEdit[1], body.body.trim()],
      );
      if (!updated.length) throw new OpsCenterError(404, "NOT_FOUND");
      await rows("INSERT INTO customer_audit (id, user_id, actor_id, field, new_value, reason) VALUES ($1,$2,$3,'note',$4,'ویرایش یادداشت')", [makeId("caud"), noteEdit[1], admin.sub, body.body.trim()]);
      return response({ updated: true });
    }
    const note = path.match(/^admin\/people\/([^/]+)\/notes$/);
    if (note && method === "POST") {
      const admin = await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!body.body?.trim()) throw new OpsCenterError(422, "INVALID_INPUT");
      const id = makeId("cnote");
      await rows(
        "INSERT INTO customer_note (id, user_id, author_id, body, visibility) VALUES ($1,$2,$3,$4,'internal')",
        [id, note[1], admin.sub, body.body.trim()],
      );
      return response({ id, visibility: "internal" }, 201);
    }
    const profile = path.match(/^admin\/people\/([^/]+)\/profile$/);
    if (profile && method === "POST") {
      const admin = await requireAdmin(actor);
      const body = await jsonBody(req);
      if (body.email || body.phone) throw new OpsCenterError(422, "VERIFICATION_REQUIRED");
      const current = (await rows<any>("SELECT * FROM account_user WHERE id=$1", [profile[1]]))[0];
      if (!current) throw new OpsCenterError(404, "NOT_FOUND");
      const fields = ["display_name", "family_name", "birth_date", "city", "address", "gender"] as const;
      for (const field of fields) {
        if (body[field] == null || body[field] === current[field]) continue;
        await rows("UPDATE account_user SET " + field + "=$2, updated_at=now() WHERE id=$1", [current.id, body[field]]);
        await rows(
          "INSERT INTO customer_audit (id, user_id, actor_id, field, old_value, new_value, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [makeId("caud"), current.id, admin.sub, field, current[field] == null ? null : String(current[field]), String(body[field]), body.reason || "اصلاح پرونده"],
        );
      }
      const { emitEvent } = await import("./platform-360");
      await emitEvent("customer.updated", "customer", current.id, { actor: admin.sub });
      return response({ updated: true });
    }
    if (path === "admin/segments" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      const id = makeId("seg");
      await rows("INSERT INTO crm_segment (id, name, definition) VALUES ($1,$2,$3::jsonb)", [id, body.name, JSON.stringify(body.definition ?? { all: [] })]);
      return response({ id }, 201);
    }
    if (path === "admin/segments" && method === "GET") {
      await requireAdmin(actor);
      const segments = await rows<any>("SELECT * FROM crm_segment WHERE active");
      const people = await rows<any>("SELECT id, city, role, phone, email FROM account_user");
      const evaluated = [];
      for (const segment of segments) {
        const members = [];
        for (const person of people) {
          const orders = await customerOrders(person);
          const stats = behaviorFrom(orders);
          const profile = { city: person.city, orderCount: stats.orderCount, daysSincePurchase: stats.lastPurchaseAt ? Math.round((Date.now() - new Date(stats.lastPurchaseAt).getTime()) / 86400_000) : 9999, vip: person.role === "vip", categories: stats.favoriteCategories };
          if (segmentMatch(profile, segment.definition)) members.push(person.id);
        }
        evaluated.push({ id: segment.id, name: segment.name, members });
      }
      return response({ segments: evaluated });
    }
    if (path === "account/orders" && method === "GET") {
      const actorUser = await requireUser(actor);
      const user = (await rows<any>("SELECT phone, email FROM account_user WHERE id=$1", [actorUser.sub]))[0];
      return response({ orders: user ? await customerOrders(user) : [] });
    }
    if (path === "account/addresses" && method === "GET") {
      const actorUser = await requireUser(actor);
      return response({ addresses: await rows("SELECT * FROM customer_address WHERE user_id=$1 ORDER BY created_at", [actorUser.sub]) });
    }
    if (path === "account/addresses" && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      if (!body.address?.trim() || !body.city?.trim()) throw new OpsCenterError(422, "INVALID_INPUT");
      const id = makeId("addr");
      await rows(
        "INSERT INTO customer_address (id, user_id, label, province, city, address, plaque, unit, postal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, actorUser.sub, body.label || "آدرس", body.province || null, body.city.trim(), body.address.trim(), body.plaque || null, body.unit || null, body.postal || null],
      );
      return response({ id }, 201);
    }
    const addressDelete = path.match(/^account\/addresses\/([^/]+)$/);
    if (addressDelete && method === "DELETE") {
      const actorUser = await requireUser(actor);
      await rows("DELETE FROM customer_address WHERE id=$1 AND user_id=$2", [addressDelete[1], actorUser.sub]);
      return response({ deleted: true });
    }
    if (path === "account/profile" && method === "GET") {
      const user = await requireUser(actor);
      return response((await rows("SELECT id, email, display_name, family_name, phone, city, address, birth_date, gender FROM account_user WHERE id=$1", [user.sub]))[0] ?? null);
    }
    if (path === "account/profile" && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      if (body.email || body.phone) throw new OpsCenterError(422, "VERIFICATION_REQUIRED");
      await rows(
        "UPDATE account_user SET display_name=COALESCE($2, display_name), family_name=COALESCE($3, family_name), birth_date=COALESCE($4, birth_date), city=COALESCE($5, city), address=COALESCE($6, address), gender=COALESCE($7, gender), updated_at=now() WHERE id=$1",
        [actorUser.sub, body.name ?? null, body.familyName ?? null, body.birthDate ?? null, body.city ?? null, body.address ?? null, body.gender ?? null],
      );
      return response({ updated: true });
    }
    if ((path === "account/profile/email" || path === "account/profile/phone") && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      const channel = path.endsWith("email") ? "email" : "phone";
      const target = String(body[channel] ?? "").trim();
      if (!target) throw new OpsCenterError(422, "INVALID_INPUT");
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await rows(
        "INSERT INTO contact_challenge (id, user_id, channel, target, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '10 minutes')",
        [makeId("cch"), actorUser.sub, channel, target, hashCode(code)],
      );
      const expose = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
      return response({ sent: true, queued: true, ...(expose ? { code } : {}) });
    }
    if ((path === "account/profile/email/confirm" || path === "account/profile/phone/confirm") && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      const channel = path.includes("email") ? "email" : "phone";
      const challenge = (await rows<any>("SELECT * FROM contact_challenge WHERE user_id=$1 AND channel=$2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1", [actorUser.sub, channel]))[0];
      if (!challenge || challenge.code_hash !== hashCode(String(body.code ?? ""))) throw new OpsCenterError(422, "INVALID_OTP");
      try {
        await rows(`UPDATE account_user SET ${channel}=$2, updated_at=now() WHERE id=$1`, [actorUser.sub, challenge.target]);
      } catch (error: any) {
        if (error?.code === "23505") throw new OpsCenterError(409, "CONTACT_EXISTS");
        throw error;
      }
      await rows("UPDATE contact_challenge SET used_at=now() WHERE id=$1", [challenge.id]);
      await rows("INSERT INTO customer_audit (id, user_id, actor_id, field, new_value, reason) VALUES ($1,$2,$3,$4,$5,'تأیید کاربر')", [makeId("caud"), actorUser.sub, actorUser.sub, channel, challenge.target]);
      const { emitEvent } = await import("./platform-360");
      await emitEvent("customer.updated", "customer", actorUser.sub, { field: channel });
      return response({ updated: true });
    }
    if (path === "account/security" && method === "GET") {
      const actorUser = await requireUser(actor);
      const security = (await rows<any>("SELECT totp_enabled FROM user_security WHERE user_id=$1", [actorUser.sub]))[0];
      return response({
        totpEnabled: Boolean(security?.totp_enabled),
        methods: ["otp", "authenticator"],
        sessions: await rows("SELECT id, user_agent, ip, created_at, revoked_at FROM user_session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10", [actorUser.sub]),
        history: await rows("SELECT success, ip, user_agent, created_at FROM login_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10", [actorUser.sub]),
      });
    }
    if (path === "account/security/password" && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      const user = (await rows<any>("SELECT salt, password_hash FROM account_user WHERE id=$1", [actorUser.sub]))[0];
      if (!user || !passwordMatches(String(body.currentPassword ?? ""), user.salt, user.password_hash)) throw new OpsCenterError(422, "INVALID_CREDENTIALS");
      if (String(body.password ?? "").length < 8) throw new OpsCenterError(422, "WEAK_PASSWORD");
      const secret = passwordRecord(String(body.password));
      await rows("UPDATE account_user SET password_hash=$2, salt=$3, updated_at=now() WHERE id=$1", [actorUser.sub, secret.passwordHash, secret.salt]);
      return response({ updated: true });
    }
    if (path === "account/security/sessions/revoke" && method === "POST") {
      const actorUser = await requireUser(actor);
      await rows("UPDATE account_user SET session_epoch=session_epoch+1, updated_at=now() WHERE id=$1", [actorUser.sub]);
      await rows("UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [actorUser.sub]);
      return response({ revoked: true });
    }
    if (path === "account/security/totp" && method === "POST") {
      const actorUser = await requireUser(actor);
      const secret = randomBytes(20).toString("base64url").replace(/[^A-Z2-7]/gi, "A").slice(0, 16).toUpperCase();
      await rows(
        `INSERT INTO user_security (user_id, totp_secret, totp_enabled) VALUES ($1,$2,false)
         ON CONFLICT (user_id) DO UPDATE SET totp_secret=EXCLUDED.totp_secret, totp_enabled=false, updated_at=now()`,
        [actorUser.sub, secret],
      );
      return response({ secret, otpauth: `otpauth://totp/Kolbe:${actorUser.sub}?secret=${secret}&issuer=Kolbe` });
    }
    if (path === "account/security/totp/confirm" && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      const security = (await rows<any>("SELECT totp_secret FROM user_security WHERE user_id=$1", [actorUser.sub]))[0];
      if (!security || !verifyTotp(security.totp_secret, String(body.code ?? ""))) throw new OpsCenterError(422, "INVALID_OTP");
      await rows("UPDATE user_security SET totp_enabled=true, updated_at=now() WHERE user_id=$1", [actorUser.sub]);
      return response({ enabled: true });
    }
    if (path === "reviews" && method === "POST") {
      const actorUser = await requireUser(actor);
      const body = await jsonBody(req);
      const rating = Math.round(Number(body.rating));
      if (rating < 1 || rating > 5 || !body.productId) throw new OpsCenterError(422, "INVALID_REVIEW");
      const user = (await rows<any>("SELECT phone, email FROM account_user WHERE id=$1", [actorUser.sub]))[0];
      const purchased = (await rows<any>(
        `SELECT payment_status, lines FROM retail_order WHERE phone=$1 OR email=$2`,
        [user.phone, user.email],
      )).some((order) => (order.lines ?? []).some((line: any) => line.id === body.productId) && ["paid", "pending_cod"].includes(order.payment_status));
      const id = makeId("rev");
      await rows(
        `INSERT INTO product_review (id, product_id, user_id, rating, title, body, images, verified_purchase, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending')`,
        [id, body.productId, actorUser.sub, rating, body.title || null, body.comment || body.body || "", JSON.stringify(body.images ?? []), purchased],
      );
      const { emitEvent } = await import("./platform-360");
      await emitEvent("review.created", "customer", actorUser.sub, { reviewId: id, productId: body.productId, rating });
      return response({ id, verifiedPurchase: purchased, status: "pending" }, 201);
    }
    const productReviews = path.match(/^products\/([^/]+)\/reviews$/);
    if (productReviews && method === "GET") {
      const list = await rows<any>("SELECT rating FROM product_review WHERE product_id=$1 AND status='approved'", [productReviews[1]]);
      const distribution = [1, 2, 3, 4, 5].map((star) => ({ star, count: list.filter((item) => Number(item.rating) === star).length }));
      const count = list.length;
      return response({
        average: count ? list.reduce((sum, item) => sum + Number(item.rating), 0) / count : null,
        count,
        distribution,
        reviews: await rows("SELECT id, rating, title, body, verified_purchase, created_at FROM product_review WHERE product_id=$1 AND status='approved' ORDER BY created_at DESC", [productReviews[1]]),
      });
    }
    if (path === "admin/reviews/analytics" && method === "GET") {
      await requireAdmin(actor);
      const productId = url.searchParams.get("productId");
      const list = await rows<any>(
        productId
          ? "SELECT rating, body FROM product_review WHERE status='approved' AND product_id=$1"
          : "SELECT rating, body FROM product_review WHERE status='approved'",
        productId ? [productId] : [],
      );
      const distribution = [1, 2, 3, 4, 5].map((star) => ({ star, count: list.filter((item) => Number(item.rating) === star).length }));
      return response({
        average: list.length ? list.reduce((sum, item) => sum + Number(item.rating), 0) / list.length : null,
        count: list.length,
        distribution,
        topicsAvailable: false,
      });
    }
    if (path === "admin/reviews" && method === "GET") {
      await requireAdmin(actor);
      return response({ reviews: await rows("SELECT * FROM product_review ORDER BY created_at DESC LIMIT 100") });
    }
    const moderate = path.match(/^admin\/reviews\/([^/]+)\/moderate$/);
    if (moderate && method === "POST") {
      const admin = await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!["approved", "rejected", "hidden"].includes(body.status)) throw new OpsCenterError(422, "INVALID_STATUS");
      if (body.rating != null) throw new OpsCenterError(422, "RATING_IMMUTABLE");
      await rows("UPDATE product_review SET status=$2, updated_at=now() WHERE id=$1", [moderate[1], body.status]);
      await rows("INSERT INTO review_moderation (id, review_id, actor_id, status, reason) VALUES ($1,$2,$3,$4,$5)", [makeId("rmod"), moderate[1], admin.sub, body.status, body.reason || null]);
      return response({ status: body.status });
    }
    if (path === "recommendations" && method === "GET") {
      const slot = url.searchParams.get("slot") || "home.for_you";
      if (!RECOMMENDATION_SLOTS.includes(slot as typeof RECOMMENDATION_SLOTS[number])) throw new OpsCenterError(422, "INVALID_SLOT");
      return response(await recommend(slot, actor, url.searchParams.get("productId") || undefined));
    }
    if (path === "recommendations/events" && method === "POST") {
      const body = await jsonBody(req);
      const allowed = new Set(["recommendation.shown", "recommendation.clicked", "recommendation.added_to_cart", "recommendation.purchased"]);
      if (!allowed.has(body.name)) throw new OpsCenterError(422, "INVALID_EVENT");
      await rows(
        "INSERT INTO recommendation_event (id, slot, strategy, product_id, user_id, name) VALUES ($1,$2,$3,$4,$5,$6)",
        [makeId("revt"), body.slot, body.strategy || "unknown", body.productId || null, actor?.sub ?? null, body.name],
      );
      return response({ recorded: true }, 202);
    }
    if (path === "admin/recommendations/slots" && method === "POST") {
      await requireAdmin(actor);
      const body = await jsonBody(req);
      if (!RECOMMENDATION_SLOTS.includes(body.code)) throw new OpsCenterError(422, "INVALID_SLOT");
      await rows(
        "UPDATE recommendation_slot SET strategy=$2, config=$3::jsonb, active=COALESCE($4, active) WHERE code=$1",
        [body.code, body.strategy || "manual", JSON.stringify(body.config ?? {}), body.active ?? null],
      );
      return response({ updated: true });
    }
    if (path === "admin/recommendations" && method === "GET") {
      await requireAdmin(actor);
      const events = await rows<any>("SELECT slot, strategy, name, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::bigint AS revenue FROM recommendation_event GROUP BY slot, strategy, name");
      const grouped = new Map<string, any>();
      for (const event of events) {
        const key = `${event.slot}:${event.strategy}`;
        const row = grouped.get(key) ?? { slot: event.slot, strategy: event.strategy, impressions: 0, clicks: 0, addToCart: 0, purchased: 0, revenue: 0 };
        if (event.name === "recommendation.shown") row.impressions += event.count;
        if (event.name === "recommendation.clicked") row.clicks += event.count;
        if (event.name === "recommendation.added_to_cart") row.addToCart += event.count;
        if (event.name === "recommendation.purchased") { row.purchased += event.count; row.revenue += Number(event.revenue); }
        grouped.set(key, row);
      }
      const analytics = [...grouped.values()].map((row) => ({ ...row, ctr: row.impressions ? row.clicks / row.impressions : null, conversion: row.clicks ? row.purchased / row.clicks : null }));
      return response({ slots: await rows("SELECT * FROM recommendation_slot"), events, analytics });
    }
    throw new OpsCenterError(404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof OpsCenterError) return response({ error: error.message }, error.status);
    console.error("operations error", error);
    return response({ error: "INTERNAL_ERROR" }, 500);
  }
}

export async function sessionEpoch(userId: string) {
  await ensureOperationsSchema();
  return Number((await rows<any>("SELECT session_epoch FROM account_user WHERE id=$1", [userId]))[0]?.session_epoch ?? 0);
}

export async function recordLogin(userId: string | null, email: string, success: boolean, req: NextRequest) {
  try {
    await ensureOperationsSchema();
    await rows(
      "INSERT INTO login_history (id, user_id, email, success, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)",
      [makeId("lgn"), userId, email, success, req.headers.get("x-forwarded-for"), req.headers.get("user-agent")],
    );
    if (success && userId) await rows("UPDATE account_user SET last_login_at=now() WHERE id=$1", [userId]);
  } catch {
    /* history must not block login */
  }
}
