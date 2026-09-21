#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.7 snapshot (0031) + journal entry.
 *
 * drizzle-kit 0.31 can no longer read this repo's hand-maintained v7
 * snapshots ("data is malformed"), so — like the previous phases — the
 * snapshot is derived from the previous one plus an explicit declaration of
 * the new tables below. The declaration mirrors
 * `packages/database/src/schema/tables.ts` and migration 0031 exactly; the
 * database test-suite (`clean-migration.test.ts`, `state-constraints.test.ts`)
 * verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0031-snapshot.mjs [--check]
 *   --check: verify the committed 0031 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const col = (name, type, { pk = false, notNull = false, def = undefined } = {}) => {
  const entry = { name, type, primaryKey: pk, notNull };
  if (def !== undefined) entry.default = def;
  return [name, entry];
};
const NN = { notNull: true };
const NOW = { notNull: true, def: "now()" };
const T = "text";
const BI = "bigint";
const INT = "integer";
const BOOL = "boolean";
const TS = "timestamp with time zone";

const idx = (name, columns, { unique = false, where = undefined } = {}) => ({
  name,
  columns: columns.map((expression) => ({ expression, isExpression: false, asc: true, nulls: "last" })),
  isUnique: unique,
  ...(where ? { where } : {}),
  concurrently: false,
  method: "btree",
  with: {},
});
const fk = (name, tableFrom, columnsFrom, tableTo, columnsTo = ["id"]) => ({
  name, tableFrom, tableTo, columnsFrom, columnsTo, onDelete: "restrict", onUpdate: "no action",
});
const ck = (name, value) => ({ name, value });
const table = (name, columns, { indexes = [], foreignKeys = [], checkConstraints = [] } = {}) => [
  `public.${name}`,
  {
    name, schema: "", columns: Object.fromEntries(columns),
    indexes: Object.fromEntries(indexes.map((i) => [i.name, i])),
    foreignKeys: Object.fromEntries(foreignKeys.map((f) => [f.name, f])),
    compositePrimaryKeys: {}, uniqueConstraints: {}, policies: {},
    checkConstraints: Object.fromEntries(checkConstraints.map((c) => [c.name, c])),
    isRLSEnabled: false,
  },
];

const MAX = "1000000000000000";

const NEW_TABLES = [
  table("promotion", [
    col("id", T, { pk: true }),
    col("code", T, NN),
    col("title", T, NN),
    col("description", T),
    col("channel", T, NN),
    col("status", T, { notNull: true, def: "'DRAFT'" }),
    col("current_published_revision_id", T),
    col("created_by", T),
    col("created_at", TS, NOW),
    col("updated_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_code_unique", ["code"], { unique: true }),
      idx("promotion_status_channel_idx", ["status", "channel"]),
    ],
    checkConstraints: [
      ck("promotion_channel_allowed", `"channel" IN ('RETAIL', 'WHOLESALE')`),
      ck("promotion_status_allowed", `"status" IN ('DRAFT', 'IN_REVIEW', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED')`),
    ],
  }),
  table("promotion_revision", [
    col("id", T, { pk: true }),
    col("promotion_id", T, NN),
    col("revision_number", INT, NN),
    col("status", T, { notNull: true, def: "'DRAFT'" }),
    col("benefit_type", T, NN),
    col("benefit_scope", T, NN),
    col("percent_bps", INT),
    col("amount", BI),
    col("currency", T, { notNull: true, def: "'IRR'" }),
    col("stacking_policy", T, NN),
    col("priority", INT, { notNull: true, def: 100 }),
    col("max_total_uses", INT),
    col("max_uses_per_actor", INT),
    col("coupon_required", BOOL, { notNull: true, def: false }),
    col("starts_at", TS),
    col("ends_at", TS),
    col("terms_hash", T, NN),
    col("published_at", TS),
    col("published_by", T),
    col("superseded_at", TS),
    col("created_by", T),
    col("created_at", TS, NOW),
    col("updated_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_revision_promotion_number_unique", ["promotion_id", "revision_number"], { unique: true }),
      idx("promotion_revision_promotion_status_idx", ["promotion_id", "status"]),
    ],
    foreignKeys: [fk("promotion_revision_promotion_fk", "promotion_revision", ["promotion_id"], "promotion")],
    checkConstraints: [
      ck("promotion_revision_status_allowed", `"status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')`),
      ck("promotion_revision_benefit_type_allowed", `"benefit_type" IN ('PERCENT_DISCOUNT', 'FIXED_AMOUNT_DISCOUNT', 'FREE_SHIPPING')`),
      ck("promotion_revision_benefit_scope_allowed", `"benefit_scope" IN ('ORDER', 'LINE', 'SHIPPING')`),
      ck("promotion_revision_currency_allowed", `"currency" IN ('IRR')`),
      ck("promotion_revision_stacking_allowed", `"stacking_policy" IN ('EXCLUSIVE', 'STACKABLE')`),
      ck("promotion_revision_number_positive", `"revision_number" > 0`),
      ck("promotion_revision_priority_non_negative", `"priority" >= 0`),
      ck("promotion_revision_amount_range", `"amount" >= 0 AND "amount" <= ${MAX}`),
      ck("promotion_revision_bps_range", `"percent_bps" IS NULL OR ("percent_bps" >= 1 AND "percent_bps" <= 10000)`),
      ck("promotion_revision_max_total_uses_positive", `"max_total_uses" IS NULL OR "max_total_uses" > 0`),
      ck("promotion_revision_max_uses_per_actor_positive", `"max_uses_per_actor" IS NULL OR "max_uses_per_actor" > 0`),
      ck("promotion_revision_window_valid", `"ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"`),
      ck("promotion_revision_benefit_coherent", `("benefit_type" = 'PERCENT_DISCOUNT' AND "benefit_scope" IN ('LINE', 'ORDER') AND "percent_bps" IS NOT NULL AND "amount" IS NULL) OR ("benefit_type" = 'FIXED_AMOUNT_DISCOUNT' AND "benefit_scope" = 'ORDER' AND "amount" IS NOT NULL AND "percent_bps" IS NULL) OR ("benefit_type" = 'FREE_SHIPPING' AND "benefit_scope" = 'SHIPPING' AND "percent_bps" IS NULL AND "amount" IS NULL)`),
    ],
  }),
  table("promotion_target", [
    col("id", T, { pk: true }),
    col("revision_id", T, NN),
    col("target_type", T, NN),
    col("value_text", T),
    col("value_amount", BI),
    col("value_quantity", INT),
    col("created_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_target_revision_value_unique", ["revision_id", "target_type", "value_text"], { unique: true, where: `"value_text" IS NOT NULL` }),
      idx("promotion_target_revision_threshold_unique", ["revision_id", "target_type"], { unique: true, where: `"value_text" IS NULL` }),
      idx("promotion_target_revision_idx", ["revision_id"]),
    ],
    foreignKeys: [fk("promotion_target_revision_fk", "promotion_target", ["revision_id"], "promotion_revision")],
    checkConstraints: [
      ck("promotion_target_type_allowed", `"target_type" IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT', 'MIN_SUBTOTAL', 'MIN_QUANTITY')`),
      ck("promotion_target_value_amount_range", `"value_amount" >= 0 AND "value_amount" <= ${MAX}`),
      ck("promotion_target_value_quantity_positive", `"value_quantity" IS NULL OR "value_quantity" > 0`),
      ck("promotion_target_value_coherent", `("target_type" IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT') AND "value_text" IS NOT NULL AND "value_amount" IS NULL AND "value_quantity" IS NULL) OR ("target_type" = 'MIN_SUBTOTAL' AND "value_amount" IS NOT NULL AND "value_text" IS NULL AND "value_quantity" IS NULL) OR ("target_type" = 'MIN_QUANTITY' AND "value_quantity" IS NOT NULL AND "value_text" IS NULL AND "value_amount" IS NULL)`),
    ],
  }),
  table("promotion_coupon", [
    col("id", T, { pk: true }),
    col("promotion_id", T, NN),
    col("revision_id", T, NN),
    col("code", T, NN),
    col("code_normalized", T, NN),
    col("enabled", BOOL, { notNull: true, def: true }),
    col("starts_at", TS),
    col("ends_at", TS),
    col("usage_limit", INT, NN),
    col("used_count", INT, { notNull: true, def: 0 }),
    col("per_actor_limit", INT),
    col("created_by", T),
    col("created_at", TS, NOW),
    col("updated_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_coupon_code_normalized_unique", ["code_normalized"], { unique: true }),
      idx("promotion_coupon_promotion_idx", ["promotion_id"]),
      idx("promotion_coupon_revision_idx", ["revision_id"]),
      idx("promotion_coupon_enabled_idx", ["enabled"]),
    ],
    foreignKeys: [
      fk("promotion_coupon_promotion_fk", "promotion_coupon", ["promotion_id"], "promotion"),
      fk("promotion_coupon_revision_fk", "promotion_coupon", ["revision_id"], "promotion_revision"),
    ],
    checkConstraints: [
      ck("promotion_coupon_usage_limit_positive", `"usage_limit" > 0`),
      ck("promotion_coupon_used_count_non_negative", `"used_count" >= 0`),
      ck("promotion_coupon_used_within_limit", `"used_count" <= "usage_limit"`),
      ck("promotion_coupon_per_actor_limit_positive", `"per_actor_limit" IS NULL OR "per_actor_limit" > 0`),
      ck("promotion_coupon_window_valid", `"ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"`),
    ],
  }),
  table("promotion_coupon_redemption", [
    col("id", T, { pk: true }),
    col("coupon_id", T),
    col("promotion_id", T, NN),
    col("revision_id", T, NN),
    col("actor_type", T, NN),
    col("actor_ref", T, NN),
    col("base_amount", BI, NN),
    col("discount_amount", BI, NN),
    col("order_reference", T),
    col("idempotency_key", T, NN),
    col("created_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_coupon_redemption_idempotency_unique", ["idempotency_key"], { unique: true }),
      idx("promotion_coupon_redemption_coupon_order_unique", ["coupon_id", "order_reference"], { unique: true, where: `"coupon_id" IS NOT NULL AND "order_reference" IS NOT NULL` }),
      idx("promotion_coupon_redemption_auto_order_unique", ["revision_id", "order_reference"], { unique: true, where: `"coupon_id" IS NULL AND "order_reference" IS NOT NULL` }),
      idx("promotion_coupon_redemption_coupon_created_idx", ["coupon_id", "created_at"]),
      idx("promotion_coupon_redemption_promotion_created_idx", ["promotion_id", "created_at"]),
      idx("promotion_coupon_redemption_actor_idx", ["actor_type", "actor_ref"]),
    ],
    foreignKeys: [
      fk("promotion_coupon_redemption_coupon_fk", "promotion_coupon_redemption", ["coupon_id"], "promotion_coupon"),
      fk("promotion_coupon_redemption_promotion_fk", "promotion_coupon_redemption", ["promotion_id"], "promotion"),
      fk("promotion_coupon_redemption_revision_fk", "promotion_coupon_redemption", ["revision_id"], "promotion_revision"),
    ],
    checkConstraints: [
      ck("promotion_coupon_redemption_actor_type_allowed", `"actor_type" IN ('RETAIL_CUSTOMER', 'WHOLESALE_ACCOUNT')`),
      ck("promotion_coupon_redemption_base_amount_range", `"base_amount" >= 0 AND "base_amount" <= ${MAX}`),
      ck("promotion_coupon_redemption_discount_amount_range", `"discount_amount" >= 0 AND "discount_amount" <= ${MAX}`),
      ck("promotion_coupon_redemption_discount_within_base", `"discount_amount" <= "base_amount"`),
    ],
  }),
  table("promotion_usage", [
    col("id", T, { pk: true }),
    col("promotion_id", T, NN),
    col("revision_id", T, NN),
    col("coupon_id", T),
    col("actor_type", T, NN),
    col("actor_ref", T, NN),
    col("uses", INT, { notNull: true, def: 0 }),
    col("created_at", TS, NOW),
    col("updated_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_usage_coupon_actor_unique", ["revision_id", "coupon_id", "actor_type", "actor_ref"], { unique: true, where: `"coupon_id" IS NOT NULL` }),
      idx("promotion_usage_promotion_actor_unique", ["revision_id", "actor_type", "actor_ref"], { unique: true, where: `"coupon_id" IS NULL` }),
      idx("promotion_usage_promotion_idx", ["promotion_id"]),
    ],
    foreignKeys: [
      fk("promotion_usage_promotion_fk", "promotion_usage", ["promotion_id"], "promotion"),
      fk("promotion_usage_revision_fk", "promotion_usage", ["revision_id"], "promotion_revision"),
      fk("promotion_usage_coupon_fk", "promotion_usage", ["coupon_id"], "promotion_coupon"),
    ],
    checkConstraints: [
      ck("promotion_usage_actor_type_allowed", `"actor_type" IN ('RETAIL_CUSTOMER', 'WHOLESALE_ACCOUNT')`),
      ck("promotion_usage_uses_non_negative", `"uses" >= 0`),
    ],
  }),
  table("promotion_schedule", [
    col("id", T, { pk: true }),
    col("promotion_id", T, NN),
    col("revision_id", T, NN),
    col("action", T, NN),
    col("run_at", TS, NN),
    col("status", T, { notNull: true, def: "'SCHEDULED'" }),
    col("claimed_by", T),
    col("claimed_at", TS),
    col("attempts", INT, { notNull: true, def: 0 }),
    col("last_error", T),
    col("idempotency_key", T, NN),
    col("created_by", T),
    col("created_at", TS, NOW),
    col("updated_at", TS, NOW),
  ], {
    indexes: [
      idx("promotion_schedule_idempotency_unique", ["idempotency_key"], { unique: true }),
      idx("promotion_schedule_status_run_idx", ["status", "run_at"]),
      idx("promotion_schedule_promotion_idx", ["promotion_id"]),
    ],
    foreignKeys: [
      fk("promotion_schedule_promotion_fk", "promotion_schedule", ["promotion_id"], "promotion"),
      fk("promotion_schedule_revision_fk", "promotion_schedule", ["revision_id"], "promotion_revision"),
    ],
    checkConstraints: [
      ck("promotion_schedule_action_allowed", `"action" IN ('ACTIVATE', 'END')`),
      ck("promotion_schedule_status_allowed", `"status" IN ('SCHEDULED', 'CLAIMED', 'DONE', 'CANCELLED', 'FAILED')`),
      ck("promotion_schedule_attempts_non_negative", `"attempts" >= 0`),
    ],
  }),
];

/** Full ordered RBAC action list — must equal ADMIN_PERMISSION_ACTIONS. */
const ADMIN_ACTIONS = [
  "wholesale:plan:view", "wholesale:plan:manage", "wholesale:membership:view",
  "wholesale:membership:manage", "wholesale:membership:override", "wholesale:approval:view",
  "wholesale:approval:create", "wholesale:approval:decide", "wholesale:settings:view",
  "wholesale:settings:manage", "wholesale:notes:view", "wholesale:notes:create",
  "wholesale:control_tower:view", "crm:customer:view", "crm:customer:manage",
  "crm:stage:manage", "crm:assign:manage", "crm:activity:create", "crm:task:manage",
  "crm:tag:manage", "crm:export", "crm:sensitive:view", "support:case:view",
  "support:case:reply", "support:case:assign", "support:case:priority",
  "support:case:resolve", "support:internal_note:create", "support:attachment:view",
  "support:sla:manage", "support:report:view", "support:sensitive:view",
  "notification:template:view", "notification:template:manage", "notification:outbox:view",
  "notification:outbox:retry", "notification:provider:view", "notification:preference:manage",
  "notification:report:view", "cms:content:view", "cms:content:create", "cms:content:edit",
  "cms:content:publish", "cms:content:archive", "cms:navigation:manage", "cms:media:manage",
  "cms:seo:manage", "cms:blog:manage", "analytics:dashboard:view", "analytics:report:view",
  "analytics:report:manage", "analytics:export", "analytics:reconciliation:view",
  "production:jobs:view", "production:config:view", "production:config:manage",
  "production:quality:review", "production:release:decide", "production:recall:approve",
  "promotion:view", "promotion:create", "promotion:edit", "promotion:publish",
  "promotion:pause", "promotion:coupon:manage",
];

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0030_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();
  const adminCheck = next.tables["public.admin_role_permission"].checkConstraints["admin_role_permission_action_allowed"];
  adminCheck.value = `"action" IN (${ADMIN_ACTIONS.map((a) => `'${a}'`).join(", ")})`;
  for (const [key, value] of NEW_TABLES) {
    if (next.tables[key]) throw new Error(`table already in snapshot: ${key}`);
    next.tables[key] = value;
  }
  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 30) throw new Error(`expected last journal idx 30, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 31)) throw new Error("journal already has idx 31");
  journal.entries.push({
    idx: 31, version: "7", when: 1790250000000,
    tag: "0031_phase_5_7_promotions_commercial_engine", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0031_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 31, version: "7", when: 1790250000000, tag: "0031_phase_5_7_promotions_commercial_engine", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0031 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0031 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 31`);
}
