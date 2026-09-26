import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 5.11-D10 — static guards over the ops console (no DB).
 *
 * The D audit verdicts as executable pins: the controller is a
 * forwarding shell (no DB, no throws, admin-only), queues live
 * with their owners, and the schema shape holds (199 tables,
 * journal idx 46, including the 0046 return-filing replay identity).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CONTROLLER = path.join(ROOT, "apps", "api", "src", "modules", "orders", "retail", "admin-retail-ops.controller.ts");

const codeOf = (file: string) => readFileSync(file, "utf8");

describe("Phase 5.11-D10 static guards", () => {
  it("D10.1 keeps the ops controller free of direct database access", () => {
    const code = codeOf(CONTROLLER);
    expect(code).not.toMatch(/KOLBE_DB|KolbeDatabase/);
    expect(code).not.toMatch(/@kolbe\/database/);
    expect(code).not.toMatch(/\.(insert|update|delete)\(/);
    expect(code).not.toMatch(/\.transaction\(/);
  });

  it("D10.2 gates every ops route behind admin with no public escape", () => {
    const code = codeOf(CONTROLLER);
    expect(code).toMatch(/@Controller\("admin\/retail"\)/);
    expect(code).toMatch(/@Roles\("admin"\)/);
    expect(code).not.toMatch(/@Public\(\)/);
    expect(code).not.toMatch(/@Roles\("customer"|@Roles\("vip"|@Roles\("supplier"|@Roles\("finance"/);
  });

  it("D10.3 forbids new error vocabulary in the controller (seams own codes)", () => {
    const code = codeOf(CONTROLLER);
    expect(code).not.toMatch(/throw new/);
    expect(code).not.toMatch(/DomainError/);
  });

  it("D10.4 confines the refund queue reader to payments (retail never reads refund rows)", () => {
    const payments = codeOf(path.join(ROOT, "apps", "api", "src", "modules", "payments", "payments.service.ts"));
    expect(payments).toMatch(/async listRetailRefundsForStaff/);
    for (const file of ["retail-orders.service.ts", "retail-orders.repository.ts", "retail-returns.service.ts", "retail-returns.repository.ts"]) {
      const code = codeOf(path.join(ROOT, "apps", "api", "src", "modules", "orders", "retail", file));
      expect(code).not.toMatch(/from\(refund\)/);
    }
  });

  it("D10.5 pins version ordering on the timeline reader", () => {
    const repo = codeOf(path.join(ROOT, "apps", "api", "src", "modules", "orders", "retail", "retail-orders.repository.ts"));
    expect(repo).toMatch(/findEventsByOrderId[\s\S]{0,400}?orderBy\(asc\(retailOrderEvent\.orderVersion\)\)/);
  });

  it("D10.6 pins strict ISO cursors with degradation (the D hardening)", () => {
    const code = codeOf(CONTROLLER);
    expect(code).toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}T/);
    expect(code).toMatch(/let cursor[\s\S]{0,160}\| null = null/);
    expect(code).toMatch(/fall through to the next decoding/);
  });

  it("D10.7 pins the schema shape: 199 tables, journal idx 47", () => {
    const journal = JSON.parse(readFileSync(path.join(ROOT, "packages", "database", "migrations", "meta", "_journal.json"), "utf8"));
    expect(journal.entries).toHaveLength(48);
    expect(journal.entries[journal.entries.length - 1]).toMatchObject({ idx: 47, tag: "0047_supplier_product_attributes" });
    const snapshot = JSON.parse(readFileSync(path.join(ROOT, "packages", "database", "migrations", "meta", "0047_snapshot.json"), "utf8"));
    expect(Object.keys(snapshot.tables)).toHaveLength(199);
  });

  it("D10.8 pins the four 0043 queue indexes in the snapshot", () => {
    const snapshot = JSON.parse(readFileSync(path.join(ROOT, "packages", "database", "migrations", "meta", "0043_snapshot.json"), "utf8"));
    const orderIdx = snapshot.tables["public.retail_order"].indexes;
    expect(Object.keys(orderIdx)).toEqual(expect.arrayContaining(["retail_order_status_created", "retail_order_payment_created"]));
    const returnIdx = snapshot.tables["public.retail_return_request"].indexes;
    expect(Object.keys(returnIdx)).toContain("retail_return_request_status_created");
    const refundIdx = snapshot.tables["public.refund"].indexes["refund_retail_status_created"];
    expect(refundIdx).toBeTruthy();
    expect(refundIdx.where).toMatch(/retail_order_id.*IS NOT NULL/);
  });
});
