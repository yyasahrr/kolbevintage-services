#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.9 Checkpoint A snapshot (0037) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0033-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0037 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0037-snapshot.mjs [--check]
 *   --check: verify the committed 0037 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const SINGLE_DEFAULT_WHERE = '"customer_address"."is_default" AND "customer_address"."archived_at" IS NULL';

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

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0036_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. retail_order carries the guest-capability hash columns (hash at rest only).
  const order = next.tables["public.retail_order"];
  if (!order) throw new Error("base snapshot lost public.retail_order");
  order.columns["guest_capability_hash"] = { name: "guest_capability_hash", type: "text", primaryKey: false, notNull: false };
  order.columns["guest_capability_issued_at"] = { name: "guest_capability_issued_at", type: "timestamp with time zone", primaryKey: false, notNull: false };
  order.columns["guest_capability_revoked_at"] = { name: "guest_capability_revoked_at", type: "timestamp with time zone", primaryKey: false, notNull: false };

  // 2. New first-class saved-address table (customer-account owned).
  next.tables["public.customer_address"] = {
    name: "customer_address",
    schema: "public",
    columns: {
      id: { name: "id", type: "text", primaryKey: true, notNull: true },
      user_id: { name: "user_id", type: "text", primaryKey: false, notNull: true },
      label: { name: "label", type: "text", primaryKey: false, notNull: false },
      recipient_name: { name: "recipient_name", type: "text", primaryKey: false, notNull: true },
      recipient_phone: { name: "recipient_phone", type: "text", primaryKey: false, notNull: true },
      province: { name: "province", type: "text", primaryKey: false, notNull: true },
      city: { name: "city", type: "text", primaryKey: false, notNull: true },
      address_line: { name: "address_line", type: "text", primaryKey: false, notNull: true },
      plaque: { name: "plaque", type: "text", primaryKey: false, notNull: false },
      unit: { name: "unit", type: "text", primaryKey: false, notNull: false },
      postal_code: { name: "postal_code", type: "text", primaryKey: false, notNull: true },
      is_default: { name: "is_default", type: "boolean", primaryKey: false, notNull: true, default: false },
      archived_at: { name: "archived_at", type: "timestamp with time zone", primaryKey: false, notNull: false },
      created_at: { name: "created_at", type: "timestamp with time zone", primaryKey: false, notNull: true, default: "now()" },
      updated_at: { name: "updated_at", type: "timestamp with time zone", primaryKey: false, notNull: true, default: "now()" },
      version: { name: "version", type: "integer", primaryKey: false, notNull: true, default: 0 },
    },
    indexes: {
      customer_address_single_default: indexEntry("customer_address_single_default", ["user_id"], true, SINGLE_DEFAULT_WHERE),
      customer_address_user_created: indexEntry("customer_address_user_created", ["user_id", "created_at"]),
    },
    foreignKeys: {
      customer_address_user_fk: {
        name: "customer_address_user_fk",
        tableFrom: "customer_address",
        tableTo: "account_user",
        columnsFrom: ["user_id"],
        columnsTo: ["id"],
        onDelete: "restrict",
        onUpdate: "no action",
      },
    },
    compositePrimaryKeys: {},
    uniqueConstraints: {},
    policies: {},
    checkConstraints: {
      customer_address_version_non_negative: {
        name: "customer_address_version_non_negative",
        value: `"version" >= 0`,
      },
    },
    isRLSEnabled: false,
  };

  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 36) throw new Error(`expected last journal idx 36, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 37)) throw new Error("journal already has idx 37");
  journal.entries.push({
    idx: 37, version: "7", when: 1790745600000,
    tag: "0037_phase_5_9_a_customer_account", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0037_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 37, version: "7", when: 1790745600000, tag: "0037_phase_5_9_a_customer_account", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0037 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0037 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 37`);
}
