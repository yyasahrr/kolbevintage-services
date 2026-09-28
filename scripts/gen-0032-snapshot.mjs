#!/usr/bin/env node
/**
 * One-shot generator for the Phase 5.7 Checkpoint B snapshot (0032) + journal entry.
 *
 * Same hand-maintained v7 approach as `gen-0031-snapshot.mjs`: the snapshot is
 * derived from the previous one plus an explicit declaration of the delta
 * below. The declaration mirrors `packages/database/src/schema/tables.ts` and
 * migration 0032 exactly; the database test-suite (`clean-migration.test.ts`,
 * `state-constraints.test.ts`) verifies all three agree on a live database.
 *
 * Usage: node scripts/gen-0032-snapshot.mjs [--check]
 *   --check: verify the committed 0032 snapshot matches this declaration
 *            without writing anything.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const META = path.join(ROOT, "packages/database/migrations/meta");
const CHECK_MODE = process.argv.includes("--check");

const APPROVAL_REQUEST_TYPES = [
  "MEMBERSHIP_OVERRIDE", "MEMBERSHIP_PLAN_CHANGE", "PLAN_VERSION_PUBLISH",
  "BUSINESS_SETTING_CHANGE", "MEMBERSHIP_MANUAL_ACTIVATE", "MEMBERSHIP_TERMINATE",
  "PRODUCTION_RECALL", "PROMOTION_PUBLISH", "PROMOTION_PAUSE",
];

const TERMS_HASH_FORMAT = `"terms_hash" IS NULL OR "terms_hash" ~ '^[0-9a-f]{64}$'`;

function buildSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(META, "0031_snapshot.json"), "utf8"));
  const next = JSON.parse(JSON.stringify(prev));
  next.prevId = prev.id;
  next.id = crypto.randomUUID();

  // 1. Maker/checker type catalog gains the two promotion execution types.
  const approvalCheck = next.tables["public.approval_request"].checkConstraints["approval_request_type_allowed"];
  approvalCheck.value = `"request_type" IN (${APPROVAL_REQUEST_TYPES.map((a) => `'${a}'`).join(", ")})`;

  // 2. Redemption ledger gains the evaluation binding columns (+ format check).
  // Migration 0032 appends the columns, so they land after `created_at`.
  const redemption = next.tables["public.promotion_coupon_redemption"];
  redemption.columns["evaluation_version"] = { name: "evaluation_version", type: "text", primaryKey: false, notNull: false };
  redemption.columns["terms_hash"] = { name: "terms_hash", type: "text", primaryKey: false, notNull: false };
  redemption.checkConstraints["promotion_coupon_redemption_terms_hash_format"] = {
    name: "promotion_coupon_redemption_terms_hash_format",
    value: TERMS_HASH_FORMAT,
  };
  return next;
}

function buildJournal() {
  const journal = JSON.parse(fs.readFileSync(path.join(META, "_journal.json"), "utf8"));
  const last = journal.entries[journal.entries.length - 1];
  if (last.idx !== 31) throw new Error(`expected last journal idx 31, found ${last.idx}`);
  if (journal.entries.some((e) => e.idx === 32)) throw new Error("journal already has idx 32");
  journal.entries.push({
    idx: 32, version: "7", when: 1790300000000,
    tag: "0032_phase_5_7_promotions_checkpoint_b", breakpoints: true,
  });
  return journal;
}

const snapshotPath = path.join(META, "0032_snapshot.json");
const journalPath = path.join(META, "_journal.json");

if (CHECK_MODE) {
  const snapshot = buildSnapshot();
  const diskSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const diskJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  // The UUID is random per generation: compare everything except the id chain.
  const { id: _a, prevId: _b, ...rest } = snapshot;
  const { id: _c, prevId: _d, ...diskRest } = diskSnapshot;
  const sameSnapshot = JSON.stringify(rest) === JSON.stringify(diskRest);
  const expectedEntry = { idx: 32, version: "7", when: 1790300000000, tag: "0032_phase_5_7_promotions_checkpoint_b", breakpoints: true };
  const sameJournal = JSON.stringify(diskJournal.entries[diskJournal.entries.length - 1]) === JSON.stringify(expectedEntry);
  if (!sameSnapshot || !sameJournal) {
    console.error(`0032 snapshot/journal drift: snapshot=${sameSnapshot} journal=${sameJournal}`);
    process.exit(1);
  }
  console.log("0032 snapshot/journal match the declaration.");
} else {
  const snapshot = buildSnapshot();
  const journal = buildJournal();
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  console.log(`wrote ${snapshotPath} (${Object.keys(snapshot.tables).length} tables)`);
  console.log(`appended journal idx 32`);
}
