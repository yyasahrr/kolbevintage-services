#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.9 Checkpoint C snapshot (0039) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0038-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0039 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * The C delta is ALTER-only (zero new tables): `refund`, `refund_line`, and
 * `financial_ledger_entry` each grow a nullable retail side while the
 * wholesale side becomes nullable behind a boolean-XOR CHECK, and
 * `order_event` gains the two retail refund facts.
 *
 * Usage: node scripts/gen-0039-snapshot.mjs [--check]
 *   --check: verify the committed 0039 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const IDX = 39;
const TAG = "0039_phase_5_9_c_retail_refunds";
const WHEN = 1790918400000;

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

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0038_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. refund: retail order side + nullable wholesale side behind XOR.
  const refund = next.tables["public.refund"];
  refund.columns.wholesale_order_id.notNull = false;
  refund.columns.retail_order_id = { name: "retail_order_id", type: "text", primaryKey: false, notNull: false };
  refund.checkConstraints.refund_single_order_side = {
    name: "refund_single_order_side",
    value: `("wholesale_order_id" IS NULL) <> ("retail_order_id" IS NULL)`,
  };
  refund.indexes.refund_retail_order_idempotency_unique = indexEntry(
    "refund_retail_order_idempotency_unique",
    ["retail_order_id", "idempotency_key"],
    true,
    `"refund"."idempotency_key" IS NOT NULL`,
  );
  refund.indexes.refund_retail_order_created = indexEntry("refund_retail_order_created", ["retail_order_id", "created_at"]);
  refund.foreignKeys.refund_retail_order_fk = fkEntry(
    "refund_retail_order_fk",
    "refund",
    "retail_order",
    ["retail_order_id"],
    ["id"],
  );

  // 2. refund_line: retail item side + nullable wholesale side behind XOR.
  const line = next.tables["public.refund_line"];
  line.columns.wholesale_order_item_id.notNull = false;
  line.columns.retail_order_item_id = { name: "retail_order_item_id", type: "text", primaryKey: false, notNull: false };
  line.checkConstraints.refund_line_single_item_side = {
    name: "refund_line_single_item_side",
    value: `("wholesale_order_item_id" IS NULL) <> ("retail_order_item_id" IS NULL)`,
  };
  line.indexes.refund_line_refund_retail_item_unique = indexEntry(
    "refund_line_refund_retail_item_unique",
    ["refund_id", "retail_order_item_id"],
    true,
    `"refund_line"."retail_order_item_id" IS NOT NULL`,
  );
  line.indexes.refund_line_retail_item = indexEntry("refund_line_retail_item", ["retail_order_item_id"]);
  line.foreignKeys.refund_line_retail_item_fk = fkEntry(
    "refund_line_retail_item_fk",
    "refund_line",
    "retail_order_item",
    ["retail_order_item_id"],
    ["id"],
  );

  // 3. financial_ledger_entry: retail order side + nullable wholesale side behind XOR.
  const ledger = next.tables["public.financial_ledger_entry"];
  ledger.columns.order_id.notNull = false;
  ledger.columns.retail_order_id = { name: "retail_order_id", type: "text", primaryKey: false, notNull: false };
  ledger.checkConstraints.financial_ledger_single_order_side = {
    name: "financial_ledger_single_order_side",
    value: `("order_id" IS NULL) <> ("retail_order_id" IS NULL)`,
  };
  ledger.indexes.financial_ledger_retail_order_created = indexEntry(
    "financial_ledger_retail_order_created",
    ["retail_order_id", "created_at"],
  );
  ledger.foreignKeys.financial_ledger_retail_order_fk = fkEntry(
    "financial_ledger_retail_order_fk",
    "financial_ledger_entry",
    "retail_order",
    ["retail_order_id"],
    ["id"],
  );

  // 4. order_event: retail refund facts appended to the event-type CHECK.
  const orderEvent = next.tables["public.order_event"];
  const check = orderEvent.checkConstraints.order_event_event_type_allowed;
  const suffix = `'retail_order.shipment_delivered')`;
  if (!check.value.endsWith(suffix)) throw new Error("unexpected order_event event_type CHECK tail");
  check.value = `${check.value.slice(0, -suffix.length)}'retail_order.shipment_delivered', 'retail_order.refund_requested', 'retail_order.refund_completed')`;

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

const snapshotPath = path.join(META, "0039_snapshot.json");
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
    console.error(`0039 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0039 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx ${IDX}`);
}
