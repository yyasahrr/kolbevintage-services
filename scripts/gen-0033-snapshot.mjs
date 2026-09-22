#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.8 Checkpoint A snapshot (0033) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0032-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0033 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0033-snapshot.mjs [--check]
 *   --check: verify the committed 0033 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const MAX_MONEY = "1000000000000000";
const RETAIL_STATUSES = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"];
const RETAIL_ACTOR_ROLES = ["customer", "guest", "admin", "system"];

const ORDER_EVENT_TYPES_58 = [
  "order.created",
  "order.confirmed",
  "order.payment_gated",
  "order.processing_started",
  "order.fulfillment_started",
  "order.shipped",
  "order.completed",
  "order.cancelled",
  "order.parent_cancelled",
  "child.created",
  "child.confirmed",
  "child.preparing",
  "child.ready",
  "child.shipped",
  "child.delivered",
  "child.cancelled",
  "child.exception_opened",
  "child.exception_resolved",
  "child.replacement_requested",
  "request.converted",
  "request.revision_requested",
  "request.revision_accepted",
  "request.rejected",
  "request.cancelled",
  "request.expired",
  "request.replacement_created",
  "fulfillment.replacement_linked",
  "fulfillment.replacement_requested",
  "inventory.reserved",
  "inventory.released",
  "inventory.consumed",
  "proforma.issued",
  "proforma.superseded",
  "proforma.voided",
  "payment.evidence_submitted",
  "payment.verified",
  "payment.failed",
  "payment.allocated",
  "payment.overpaid",
  "financial.release_created",
  "refund.requested",
  "refund.approved",
  "refund.completed",
  "refund.failed",
  "refund.cancelled",
  "payment.provider_intent_created",
  "payment.provider_callback_received",
  "payment.provider_webhook_received",
  "payment.provider_verified",
  "payment.reconciled",
  "shipping.quote_created",
  "shipping.quote_selected",
  "shipping.quote_expired",
  "shipping.shipment_created",
  "shipping.shipment_ready",
  "shipping.shipment_handed_over",
  "shipping.shipment_in_transit",
  "shipping.shipment_delivered",
  "shipping.shipment_cancelled",
  "shipping.shipment_failed",
  "retail_order.created",
];
const ORDER_AGGREGATE_TYPES_58 = ["wholesale_order", "purchase_order", "retail_order"];

const moneyRange = (column) => `"${column}" >= 0 AND "${column}" <= ${MAX_MONEY}`;
const inList = (column, values) => `"${column}" IN (${values.map((v) => `'${v}'`).join(", ")})`;

function indexEntry(name, columns, isUnique = false) {
  return {
    name,
    columns: columns.map((expression) => ({ expression, isExpression: false, asc: true, nulls: "last" })),
    isUnique,
    concurrently: false,
    method: "btree",
    with: {},
  };
}

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0032_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. retail_order gains the canonical commerce columns (+ equation checks).
  // Migration 0033 appends the columns, so they land after `updated_at`.
  const order = next.tables["public.retail_order"];
  order.columns["promotion_discount_total"] = { name: "promotion_discount_total", type: "bigint", primaryKey: false, notNull: true, default: "0" };
  order.columns["legal_snapshot_id"] = { name: "legal_snapshot_id", type: "text", primaryKey: false, notNull: false };
  order.columns["creation_request_hash"] = { name: "creation_request_hash", type: "text", primaryKey: false, notNull: false };
  order.columns["version"] = { name: "version", type: "integer", primaryKey: false, notNull: true, default: 0 };
  order.checkConstraints["retail_order_promotion_discount_total_range"] = {
    name: "retail_order_promotion_discount_total_range",
    value: moneyRange("promotion_discount_total"),
  };
  order.checkConstraints["retail_order_promo_discount_within_items"] = {
    name: "retail_order_promo_discount_within_items",
    value: `"promotion_discount_total" <= "items_total"`,
  };
  order.checkConstraints["retail_order_totals_equation"] = {
    name: "retail_order_totals_equation",
    value: `"total_amount" = "items_total" - "promotion_discount_total" + "shipping_price"`,
  };
  order.checkConstraints["retail_order_version_non_negative"] = {
    name: "retail_order_version_non_negative",
    value: `"version" >= 0`,
  };

  // 2. retail_order_item gains variant + base/discount split (+ equation checks).
  const item = next.tables["public.retail_order_item"];
  item.columns["variant_id"] = { name: "variant_id", type: "text", primaryKey: false, notNull: false };
  item.columns["base_line_total"] = { name: "base_line_total", type: "bigint", primaryKey: false, notNull: true, default: "0" };
  item.columns["promotion_discount"] = { name: "promotion_discount", type: "bigint", primaryKey: false, notNull: true, default: "0" };
  item.checkConstraints["retail_order_item_base_line_total_range"] = {
    name: "retail_order_item_base_line_total_range",
    value: moneyRange("base_line_total"),
  };
  item.checkConstraints["retail_order_item_promotion_discount_amount_range"] = {
    name: "retail_order_item_promotion_discount_amount_range",
    value: moneyRange("promotion_discount"),
  };
  item.checkConstraints["retail_order_item_promo_within_base"] = {
    name: "retail_order_item_promo_within_base",
    value: `"promotion_discount" <= "base_line_total"`,
  };
  item.checkConstraints["retail_order_item_line_equation"] = {
    name: "retail_order_item_line_equation",
    value: `"line_total" = "base_line_total" - "promotion_discount"`,
  };
  item.checkConstraints["retail_order_item_base_equation"] = {
    name: "retail_order_item_base_equation",
    value: `"base_line_total" = "unit_price" * "quantity"`,
  };
  item.foreignKeys["retail_order_item_variant_fk"] = {
    name: "retail_order_item_variant_fk",
    tableFrom: "retail_order_item",
    tableTo: "product_variant",
    columnsFrom: ["variant_id"],
    columnsTo: ["id"],
    onDelete: "restrict",
    onUpdate: "no action",
  };

  // 3. New append-only status history table (generalizes order_status_history).
  next.tables["public.retail_order_event"] = {
    name: "retail_order_event",
    schema: "public",
    columns: {
      id: { name: "id", type: "text", primaryKey: true, notNull: true },
      order_id: { name: "order_id", type: "text", primaryKey: false, notNull: true },
      from_status: { name: "from_status", type: "text", primaryKey: false, notNull: false },
      to_status: { name: "to_status", type: "text", primaryKey: false, notNull: true },
      actor_id: { name: "actor_id", type: "text", primaryKey: false, notNull: false },
      actor_role: { name: "actor_role", type: "text", primaryKey: false, notNull: false },
      reason: { name: "reason", type: "text", primaryKey: false, notNull: false },
      metadata: { name: "metadata", type: "jsonb", primaryKey: false, notNull: true, default: "'{}'::jsonb" },
      order_version: { name: "order_version", type: "integer", primaryKey: false, notNull: true, default: 0 },
      idempotency_key: { name: "idempotency_key", type: "text", primaryKey: false, notNull: false },
      created_at: { name: "created_at", type: "timestamp with time zone", primaryKey: false, notNull: true, default: "now()" },
    },
    indexes: {
      retail_order_event_order_created: indexEntry("retail_order_event_order_created", ["order_id", "created_at"]),
      retail_order_event_order_version_unique: indexEntry("retail_order_event_order_version_unique", ["order_id", "order_version"], true),
    },
    foreignKeys: {
      retail_order_event_order_fk: {
        name: "retail_order_event_order_fk",
        tableFrom: "retail_order_event",
        tableTo: "retail_order",
        columnsFrom: ["order_id"],
        columnsTo: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
      retail_order_event_actor_fk: {
        name: "retail_order_event_actor_fk",
        tableFrom: "retail_order_event",
        tableTo: "account_user",
        columnsFrom: ["actor_id"],
        columnsTo: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
    },
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {
      retail_order_event_from_status_allowed: {
        name: "retail_order_event_from_status_allowed",
        value: `"from_status" IS NULL OR ${inList("from_status", RETAIL_STATUSES)}`,
      },
      retail_order_event_to_status_allowed: {
        name: "retail_order_event_to_status_allowed",
        value: inList("to_status", RETAIL_STATUSES),
      },
      retail_order_event_actor_role_allowed: {
        name: "retail_order_event_actor_role_allowed",
        value: inList("actor_role", RETAIL_ACTOR_ROLES),
      },
      retail_order_event_order_version_non_negative: {
        name: "retail_order_event_order_version_non_negative",
        value: `"order_version" >= 0`,
      },
    },
    isRLSEnabled: false,
  };
  // 4. order_event carries the `retail_order.created` cross-aggregate fact.
  const outbox = next.tables["public.order_event"];
  outbox.checkConstraints["order_event_aggregate_type_allowed"] = {
    name: "order_event_aggregate_type_allowed",
    value: inList("aggregate_type", ORDER_AGGREGATE_TYPES_58),
  };
  outbox.checkConstraints["order_event_event_type_allowed"] = {
    name: "order_event_event_type_allowed",
    value: inList("event_type", ORDER_EVENT_TYPES_58),
  };
  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 32) throw new Error(`expected last journal idx 32, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 33)) throw new Error("journal already has idx 33");
  journal.entries.push({
    idx: 33, version: "7", when: 1790350000000,
    tag: "0033_phase_5_8_retail_commerce_core", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0033_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 33, version: "7", when: 1790350000000, tag: "0033_phase_5_8_retail_commerce_core", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0033 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0033 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 33`);
}
