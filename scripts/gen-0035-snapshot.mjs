#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.8 Checkpoint B follow-up snapshot (0035) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0034-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0035 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0035-snapshot.mjs [--check]
 *   --check: verify the committed 0035 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

// ── Declared delta (mirrors migration 0035 + schema) ──────────────────────
const ACTIVE_HOLD_WHERE = '"inventory_reservation"."allocation_id" IS NOT NULL AND "inventory_reservation"."status" = \'active\'';
const NEW_TEMPLATE_KEYS = ["RETAIL_ORDER_CREATED", "RETAIL_ORDER_PAID", "RETAIL_ORDER_CANCELLED"];

function extendInList(value, additions) {
  const trimmed = value.trim();
  if (!trimmed.endsWith(")")) throw new Error(`not an IN-list: ${trimmed.slice(0, 80)}`);
  return `${trimmed.slice(0, -1)}, ${additions.map((v) => `'${v}'`).join(", ")})`;
}

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0034_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. allocation uniqueness is scoped to the active hold; terminal rows are
  // history and must coexist (re-reserve after expiry).
  const res = next.tables["public.inventory_reservation"];
  const unique = res.indexes["inventory_reservation_allocation_unique"];
  if (!unique || unique.isUnique !== true) throw new Error("base snapshot lost inventory_reservation_allocation_unique");
  unique.where = ACTIVE_HOLD_WHERE;

  // 2. notification_template accepts the retail relay keys (twin of the
  // 0034 notification_event extension).
  const tpl = next.tables["public.notification_template"];
  const keyAllowed = tpl.checkConstraints["notification_template_event_key_allowed"];
  keyAllowed.value = extendInList(keyAllowed.value, NEW_TEMPLATE_KEYS);

  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 34) throw new Error(`expected last journal idx 34, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 35)) throw new Error("journal already has idx 35");
  journal.entries.push({
    idx: 35, version: "7", when: 1790486400000,
    tag: "0035_phase_5_8_b_hold_unique_template_keys", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0035_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 35, version: "7", when: 1790486400000, tag: "0035_phase_5_8_b_hold_unique_template_keys", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0035 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0035 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 35`);
}
