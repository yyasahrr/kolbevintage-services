#!/usr/bin/env node
/**
 * Append-only snapshot/journal generator for Phase 5.11 reconciliation 0046.
 * It mirrors the SQL and Drizzle schema: optional request identity columns and
 * a partial per-customer/per-order idempotency unique index.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages", "database", "migrations", "meta");
const snapshotPath = path.join(META, "0046_snapshot.json");
const journalPath = path.join(META, "_journal.json");
const CHECK = process.argv.includes("--check");
const TAG = "0046_phase_5_11_return_filing_idempotency";
const WHEN = 1791523200000;

function index(name, columns, isUnique, where) {
  return {
    name,
    columns: columns.map((expression) => ({ expression, isExpression: false, asc: true, nulls: "last" })),
    isUnique,
    where,
    concurrently: false,
    method: "btree",
    with: {},
  };
}

function buildSnapshot() {
  const previous = JSON.parse(fs.readFileSync(path.join(META, "0045_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(previous));
  next.prevId = previous.id;
  next.id = crypto.randomUUID();
  const request = next.tables["public.retail_return_request"];
  request.columns.idempotency_key = { name: "idempotency_key", type: "text", primaryKey: false, notNull: false };
  request.columns.creation_request_hash = { name: "creation_request_hash", type: "text", primaryKey: false, notNull: false };
  request.indexes.retail_return_request_customer_order_idempotency_unique = index(
    "retail_return_request_customer_order_idempotency_unique",
    ["customer_id", "order_id", "idempotency_key"],
    true,
    `"retail_return_request"."idempotency_key" IS NOT NULL`,
  );
  return next;
}

function buildJournal(snapshotId) {
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const entries = journal.entries.filter((entry) => entry.tag !== TAG);
  entries.push({ idx: 46, version: "7", when: WHEN, tag: TAG, breakpoints: true });
  return { ...journal, entries, _snapshotId: snapshotId };
}

if (CHECK) {
  const disk = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (disk.prevId !== JSON.parse(fs.readFileSync(path.join(META, "0045_snapshot.json"), "utf8")).id || last?.tag !== TAG || last?.idx !== 46) {
    throw new Error("0046 snapshot/journal drift");
  }
  console.log("0046 snapshot/journal chain is present.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal(snapshot.id);
  delete journal._snapshotId;
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log("wrote 0046 snapshot and journal entry");
}
