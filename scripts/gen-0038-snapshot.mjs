#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.9 Checkpoint B snapshot (0038) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0037-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0038 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0038-snapshot.mjs [--check]
 *   --check: verify the committed 0038 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const IDX = 38;
const TAG = "0038_phase_5_9_b_retail_returns";
const WHEN = 1790832000000;

function indexEntry(name, columns, isUnique = false, where = null) {
  const entry = {
    name,
    columns: columns.map((expression) => ({ expression, isExpression: false, asc: true, nulls: "last" })),
    isUnique,
    concurrently: false,
    method: "btree",
    with: {},
  };
  if (where) {
    // Key order mirrors drizzle-kit: `where` sits between `isUnique` and `concurrently`.
    return { name: entry.name, columns: entry.columns, isUnique: entry.isUnique, where, concurrently: false, method: "btree", with: {} };
  }
  return entry;
}

function fkEntry(name, tableFrom, tableTo, columnsFrom, columnsTo) {
  return { name, tableFrom, tableTo, columnsFrom, columnsTo, onDelete: "restrict", onUpdate: "no action" };
}

function tz(name, notNull, withDefault = false) {
  const col = { name, type: "timestamp with time zone", primaryKey: false, notNull };
  if (withDefault) col.default = "now()";
  return col;
}

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0037_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. Return request header (orders-owned, retail slice).
  next.tables["public.retail_return_request"] = {
    name: "retail_return_request",
    schema: "public",
    columns: {
      id: { name: "id", type: "text", primaryKey: true, notNull: true },
      order_id: { name: "order_id", type: "text", primaryKey: false, notNull: true },
      customer_id: { name: "customer_id", type: "text", primaryKey: false, notNull: true },
      status: { name: "status", type: "text", primaryKey: false, notNull: true },
      reason: { name: "reason", type: "text", primaryKey: false, notNull: true },
      note: { name: "note", type: "text", primaryKey: false, notNull: false },
      support_case_id: { name: "support_case_id", type: "text", primaryKey: false, notNull: false },
      received_at: tz("received_at", false),
      inspected_at: tz("inspected_at", false),
      inspection_decision: { name: "inspection_decision", type: "text", primaryKey: false, notNull: false },
      version: { name: "version", type: "integer", primaryKey: false, notNull: true, default: 0 },
      created_at: tz("created_at", true, true),
      updated_at: tz("updated_at", true, true),
    },
    indexes: {
      retail_return_request_order_created: indexEntry("retail_return_request_order_created", ["order_id", "created_at"]),
      retail_return_request_customer_created: indexEntry("retail_return_request_customer_created", ["customer_id", "created_at"]),
      retail_return_request_support_case: indexEntry("retail_return_request_support_case", ["support_case_id"]),
    },
    foreignKeys: {
      retail_return_request_order_fk: fkEntry("retail_return_request_order_fk", "retail_return_request", "retail_order", ["order_id"], ["id"]),
      retail_return_request_customer_fk: fkEntry("retail_return_request_customer_fk", "retail_return_request", "account_user", ["customer_id"], ["id"]),
    },
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {
      retail_return_request_status_allowed: {
        name: "retail_return_request_status_allowed",
        value: `"status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')`,
      },
      retail_return_request_reason_allowed: {
        name: "retail_return_request_reason_allowed",
        value: `"reason" IN ('DAMAGED', 'WRONG_ITEM', 'SIZE_FIT', 'QUALITY_ISSUE', 'CHANGED_MIND', 'OTHER')`,
      },
      retail_return_request_inspection_allowed: {
        name: "retail_return_request_inspection_allowed",
        value: `"inspection_decision" IS NULL OR "inspection_decision" IN ('RESTOCKABLE', 'DAMAGED', 'INCOMPLETE', 'NOT_AS_DESCRIBED')`,
      },
      retail_return_request_version_non_negative: {
        name: "retail_return_request_version_non_negative",
        value: `"version" >= 0`,
      },
    },
    isRLSEnabled: false,
  };

  // 2. Returned lines (one row per order line per request).
  next.tables["public.retail_return_item"] = {
    name: "retail_return_item",
    schema: "public",
    columns: {
      id: { name: "id", type: "text", primaryKey: true, notNull: true },
      return_id: { name: "return_id", type: "text", primaryKey: false, notNull: true },
      order_item_id: { name: "order_item_id", type: "text", primaryKey: false, notNull: true },
      quantity: { name: "quantity", type: "integer", primaryKey: false, notNull: true },
      created_at: tz("created_at", true, true),
    },
    indexes: {
      retail_return_item_return: indexEntry("retail_return_item_return", ["return_id"]),
      retail_return_item_return_line_unique: indexEntry("retail_return_item_return_line_unique", ["return_id", "order_item_id"], true),
    },
    foreignKeys: {
      retail_return_item_return_fk: fkEntry("retail_return_item_return_fk", "retail_return_item", "retail_return_request", ["return_id"], ["id"]),
      retail_return_item_order_item_fk: fkEntry("retail_return_item_order_item_fk", "retail_return_item", "retail_order_item", ["order_item_id"], ["id"]),
    },
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {
      retail_return_item_quantity_positive: {
        name: "retail_return_item_quantity_positive",
        value: `"quantity" > 0`,
      },
    },
    isRLSEnabled: false,
  };

  // 3. Append-only transition history.
  next.tables["public.retail_return_event"] = {
    name: "retail_return_event",
    schema: "public",
    columns: {
      id: { name: "id", type: "text", primaryKey: true, notNull: true },
      return_id: { name: "return_id", type: "text", primaryKey: false, notNull: true },
      from_status: { name: "from_status", type: "text", primaryKey: false, notNull: false },
      to_status: { name: "to_status", type: "text", primaryKey: false, notNull: true },
      actor_id: { name: "actor_id", type: "text", primaryKey: false, notNull: false },
      actor_role: { name: "actor_role", type: "text", primaryKey: false, notNull: false },
      reason: { name: "reason", type: "text", primaryKey: false, notNull: false },
      metadata: { name: "metadata", type: "jsonb", primaryKey: false, notNull: true, default: "'{}'::jsonb" },
      return_version: { name: "return_version", type: "integer", primaryKey: false, notNull: true, default: 0 },
      idempotency_key: { name: "idempotency_key", type: "text", primaryKey: false, notNull: false },
      created_at: tz("created_at", true, true),
    },
    indexes: {
      retail_return_event_return_created: indexEntry("retail_return_event_return_created", ["return_id", "created_at"]),
      retail_return_event_return_version_unique: indexEntry("retail_return_event_return_version_unique", ["return_id", "return_version"], true),
    },
    foreignKeys: {
      retail_return_event_return_fk: fkEntry("retail_return_event_return_fk", "retail_return_event", "retail_return_request", ["return_id"], ["id"]),
      retail_return_event_actor_fk: fkEntry("retail_return_event_actor_fk", "retail_return_event", "account_user", ["actor_id"], ["id"]),
    },
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {
      retail_return_event_from_status_allowed: {
        name: "retail_return_event_from_status_allowed",
        value: `"from_status" IS NULL OR "from_status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')`,
      },
      retail_return_event_to_status_allowed: {
        name: "retail_return_event_to_status_allowed",
        value: `"to_status" IN ('REQUESTED', 'APPROVED', 'RECEIVED', 'INSPECTED', 'RESTOCKED', 'REJECTED', 'WITHDRAWN')`,
      },
      retail_return_event_return_version_non_negative: {
        name: "retail_return_event_return_version_non_negative",
        value: `"return_version" >= 0`,
      },
    },
    isRLSEnabled: false,
  };

  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== IDX - 1) throw new Error(`expected last journal idx ${IDX - 1}, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === IDX)) throw new Error(`journal already has idx ${IDX}`);
  journal.entries.push({ idx: IDX, version: "7", when: WHEN, tag: TAG, breakpoints: true });
  return journal;
}

const snapshotPath = path.join(META, "0038_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: IDX, version: "7", when: WHEN, tag: TAG, breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0038 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0038 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx ${IDX}`);
}
