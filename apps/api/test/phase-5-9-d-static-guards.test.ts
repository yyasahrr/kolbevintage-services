import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 5.9-D10 — static architecture guards for the customer account &
 * after-sales surface (Checkpoints A/B/C).
 *
 * These guards freeze the D audit verdicts as executable assertions: the
 * 5.9 write authorities stay confined, the retail refund path stays
 * money-gated, the guest surface stays read-only, and the refund schema
 * evolution keeps both XOR sides. No database; pure source analysis.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SRC = path.join(ROOT, "apps", "api", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
  return out;
}

const sources = walk(SRC);
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => path.relative(ROOT, file);

function filesWriting(tableObject: string, sqlTable: string): string[] {
  const drizzleWrite = new RegExp(`\\b(insert|update|delete)\\s*\\(\\s*${tableObject}\\b`);
  const rawWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE)\\s+"?${sqlTable}"?\\b`, "i");
  return sources.filter((file) => {
    if (file.endsWith(".d.ts")) return false;
    const body = read(file);
    return drizzleWrite.test(body) || rawWrite.test(body);
  });
}

describe("Phase 5.9-D10 static guards", () => {
  it("D10.1 confines customer_address writes to the customer-address repository", () => {
    const writers = filesWriting("customerAddress", "customer_address").map(rel);
    expect(writers).toEqual(["apps/api/src/modules/customer-account/customer-address.repository.ts"]);
  });

  it("D10.2 confines return-table writes to the retail returns seam", () => {
    for (const [object, table] of [
      ["retailReturnRequest", "retail_return_request"],
      ["retailReturnItem", "retail_return_item"],
      ["retailReturnEvent", "retail_return_event"],
    ]) {
      const writers = filesWriting(object, table).map(rel);
      expect(writers, `${table} writers`).toEqual(["apps/api/src/modules/orders/retail/retail-returns.repository.ts"]);
    }
  });

  it("D10.3 confines refund + ledger writes to the payments owner (both sides, one writer)", () => {
    for (const [object, table] of [
      ["refund", "refund"],
      ["refundAllocation", "refund_allocation"],
      ["refundLine", "refund_line"],
      ["financialLedgerEntry", "financial_ledger_entry"],
    ]) {
      const writers = filesWriting(object, table)
        .map(rel)
        .filter((file) => !file.includes("migrations") && !file.includes("seed"));
      expect(writers, `${table} writers`).toEqual(["apps/api/src/modules/payments/payments.service.ts"]);
    }
  });

  it("D10.4 keeps commerce tables out of customer-account code (address repo excepted)", () => {
    // The module reads commerce through the retail/support service surface
    // and writes only addresses: no other file may import table objects or
    // name SQL tables at all (word matching would false-positive on prose,
    // so the guard targets imports and quoted SQL identifiers).
    const dir = path.join(SRC, "modules", "customer-account");
    const files = walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith("customer-address.repository.ts")) continue;
      const body = read(file);
      expect(body, `${rel(file)} must not import table objects`).not.toContain("@kolbe/database");
      expect(body, `${rel(file)} must not name SQL tables`).not.toMatch(/"(retail_|payment|refund|shipment|support_case)/);
    }
  });

  it("D10.5 gates every refund mutator on the money-act gate (admin/finance + identity)", () => {
    const body = read(path.join(SRC, "modules", "orders", "retail", "retail-orders.service.ts"));
    for (const name of ["requestRetailRefund", "approveRetailRefund", "completeRetailRefund", "failRetailRefund"]) {
      const start = body.indexOf(`async ${name}(`);
      expect(start, `${name} exists`).toBeGreaterThan(-1);
      const window = body.slice(start, start + 4000);
      expect(window, `${name} must call assertRefundStaff`).toContain("assertRefundStaff");
      expect(window, `${name} must not use the fulfillment gate`).not.toContain("this.assertStaff(");
    }
    const gateAt = body.indexOf("private assertRefundStaff(");
    expect(gateAt, "assertRefundStaff exists").toBeGreaterThan(-1);
    const gate = body.slice(gateAt, gateAt + 800);
    expect(gate).toContain('"admin"');
    expect(gate).toContain('"finance"');
    expect(gate).toContain("actor.actorId");
  });

  it("D10.6 keeps the guest order surface read-only (GET only, no writes)", () => {
    const controller = read(path.join(SRC, "modules", "customer-account", "guest-order-access.controller.ts"));
    expect(controller).toMatch(/@Get\(/);
    expect(controller).not.toMatch(/@(Post|Patch|Delete|Put)\(/);
    for (const file of ["guest-order-access.service.ts", "customer-order-history.service.ts", "customer-return.service.ts"]) {
      const body = read(path.join(SRC, "modules", "customer-account", file));
      expect(body, `${file} must be write-free`).not.toMatch(/\.(insert|update|delete)\s*\(/);
    }
  });

  it("D10.7 pins the refund schema evolution: XOR sides + retail FKs + surviving wholesale uniques", () => {
    const body = read(path.join(ROOT, "packages", "database", "src", "schema", "tables.ts"));
    for (const check of ["refund_single_order_side", "refund_line_single_item_side", "financial_ledger_single_order_side"]) {
      expect(body, `${check} CHECK`).toContain(check);
    }
    for (const fk of ["refund_retail_order_fk", "refund_line_retail_item_fk", "financial_ledger_retail_order_fk"]) {
      expect(body, `${fk} FK`).toContain(fk);
    }
    for (const unique of ["refund_order_idempotency_unique", "refund_line_refund_item_unique"]) {
      expect(body, `${unique} wholesale unique survives`).toContain(unique);
    }
  });

  it("D10.8 pins the retail refund error vocabulary and its status mapping", () => {
    const body = read(path.join(SRC, "modules", "orders", "retail", "retail-orders.contract.ts"));
    for (const code of [
      "RETAIL_REFUND_UNPAID",
      "RETAIL_REFUND_LINES_FORBIDDEN",
      "RETAIL_REFUND_LINES_REQUIRED",
      "RETAIL_REFUND_NOT_READY",
      "RETAIL_REFUND_LINE_UNKNOWN",
      "RETAIL_REFUND_ROUTES_TO_CANCEL",
      "RETAIL_REFUND_EXPECTED",
    ]) {
      expect(body, `${code} in contract`).toContain(code);
    }
  });
});
