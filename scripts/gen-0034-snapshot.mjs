#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.8 Checkpoint B snapshot (0034) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0033-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0034 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * IN-list CHECKs are extended by splicing the declared new values into the
 * previous snapshot's lists, so the delta cannot drift from its own base.
 *
 * Usage: node scripts/gen-0034-snapshot.mjs [--check]
 *   --check: verify the committed 0034 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

// ── Declared delta (mirrors migration 0034 + schema) ──────────────────────
const NEW_PAYMENT_STATUSES = ["paid"];
const NEW_NOTIFICATION_KEYS = ["RETAIL_ORDER_CREATED", "RETAIL_ORDER_PAID", "RETAIL_ORDER_CANCELLED"];
const NEW_ORDER_EVENT_TYPES = ["retail_order.paid", "retail_order.cancelled"];
const SINGLE_SIDE_CHECK = '("wholesale_order_id" IS NULL) <> ("retail_order_id" IS NULL)';

function extendInList(value, additions) {
  const trimmed = value.trim();
  if (!trimmed.endsWith(")")) throw new Error(`not an IN-list: ${trimmed.slice(0, 80)}`);
  return `${trimmed.slice(0, -1)}, ${additions.map((v) => `'${v}'`).join(", ")})`;
}

function indexEntry(name, columns, isUnique = false, where = undefined) {
  const entry = {
    name,
    columns: columns.map((expression) => ({ expression, isExpression: false, asc: true, nulls: "last" })),
    isUnique,
    concurrently: false,
    method: "btree",
    with: {},
  };
  if (where !== undefined) {
    // Key order matches drizzle-kit output: where sits between isUnique and concurrently.
    return { name: entry.name, columns: entry.columns, isUnique: entry.isUnique, where, concurrently: false, method: "btree", with: {} };
  }
  return entry;
}

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0033_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. payment carries retail payments: nullable retail link, nullable
  // wholesale link, exactly-one-side CHECK, FK, retail indexes.
  const pay = next.tables["public.payment"];
  pay.columns["wholesale_order_id"] = { name: "wholesale_order_id", type: "text", primaryKey: false, notNull: false };
  pay.columns["retail_order_id"] = { name: "retail_order_id", type: "text", primaryKey: false, notNull: false };
  pay.checkConstraints["payment_single_order_side"] = { name: "payment_single_order_side", value: SINGLE_SIDE_CHECK };
  pay.indexes["payment_retail_order_idempotency_unique"] = indexEntry(
    "payment_retail_order_idempotency_unique",
    ["retail_order_id", "idempotency_key"],
    true,
    '"payment"."idempotency_key" IS NOT NULL',
  );
  pay.indexes["payment_retail_order_created"] = indexEntry("payment_retail_order_created", ["retail_order_id", "created_at"]);
  pay.foreignKeys["payment_retail_order_fk"] = {
    name: "payment_retail_order_fk",
    tableFrom: "payment",
    tableTo: "retail_order",
    columnsFrom: ["retail_order_id"],
    columnsTo: ["id"],
    onDelete: "restrict",
    onUpdate: "no action",
  };

  // 2. retail paid status.
  const order = next.tables["public.retail_order"];
  const payStatus = order.checkConstraints["retail_order_payment_status_allowed"];
  payStatus.value = extendInList(payStatus.value, NEW_PAYMENT_STATUSES);

  // 3. retail relay event keys.
  const notif = next.tables["public.notification_event"];
  const keyAllowed = notif.checkConstraints["notification_event_key_allowed"];
  keyAllowed.value = extendInList(keyAllowed.value, NEW_NOTIFICATION_KEYS);

  // 4. retail paid/cancelled facts.
  const outbox = next.tables["public.order_event"];
  const typeAllowed = outbox.checkConstraints["order_event_event_type_allowed"];
  typeAllowed.value = extendInList(typeAllowed.value, NEW_ORDER_EVENT_TYPES);

  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 33) throw new Error(`expected last journal idx 33, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 34)) throw new Error("journal already has idx 34");
  journal.entries.push({
    idx: 34, version: "7", when: 1790400000000,
    tag: "0034_phase_5_8_b_retail_payment_inventory", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0034_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 34, version: "7", when: 1790400000000, tag: "0034_phase_5_8_b_retail_payment_inventory", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0034 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0034 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 34`);
}
