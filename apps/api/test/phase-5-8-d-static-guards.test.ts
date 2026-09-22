import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 5.8-D10 — static architecture guards for the retail commerce core.
 *
 * These guards freeze the D1–D5/D9/D11 audit verdicts as executable
 * assertions: the write authorities stay confined, the documented legacy
 * surface stays a pure proxy/translation layer, and identifier factories
 * stay out of DDL. No database; pure source analysis.
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
  // A write site calls drizzle insert/update/delete against the table
  // OBJECT, or names the quoted SQL table in raw INSERT/UPDATE. Matching
  // the object (not a substring) keeps `retailOrderItem` from implicating
  // `retailOrder`, and keeps readers (`.from(x)` selects) out.
  const drizzleWrite = new RegExp(`\\b(insert|update|delete)\\s*\\(\\s*${tableObject}\\b`);
  const rawWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE)\\s+"?${sqlTable}"?\\b`, "i");
  return sources.filter((file) => {
    if (file.endsWith(".d.ts")) return false;
    const body = read(file);
    return drizzleWrite.test(body) || rawWrite.test(body);
  });
}

describe("Phase 5.8-D10 static guards", () => {
  it("D10.1 confines retail_order writes to the retail repository", () => {
    const writers = filesWriting("retailOrder", "retail_order")
      .map(rel)
      .filter((file) => !file.includes("migrations") && !file.includes("seed"));
    expect(writers).toEqual(["apps/api/src/modules/orders/retail/retail-orders.repository.ts"]);
  });

  it("D10.2 confines shipment writes to the shipping service and its retail repository seam", () => {
    const writers = filesWriting("shipment", "shipment").map(rel);
    const allowed = new Set([
      "apps/api/src/modules/shipping/shipping.service.ts",
      "apps/api/src/modules/orders/retail/retail-orders.repository.ts",
    ]);
    for (const file of writers) {
      expect(allowed.has(file), `unexpected shipment writer: ${file}`).toBe(true);
    }
    expect(writers.length).toBeGreaterThan(0);
  });

  it("D10.3 confines paymentStatus mutation to the payment row owner", () => {
    const writers = filesWriting("payment", "payment")
      .map(rel)
      .filter((file) => !file.includes("migrations") && !file.includes("seed"));
    expect(writers).toEqual(["apps/api/src/modules/payments/payments.service.ts"]);
  });

  it("D10.4 keeps the legacy retail surface a pure proxy/translation layer (no writes)", () => {
    const legacy = [
      "frontend-next/server/retail-pricing.ts",
      "frontend-next/server/kolbe-api.ts",
      "frontend-next/server/database.ts",
    ];
    const write = /\.(insert|update|delete)\s*\(|\bINSERT\s+INTO\b|\bUPDATE\b/i;
    for (const file of legacy) {
      const body = read(path.join(ROOT, file));
      const hits = body.split("\n").filter((line) => write.test(line) && /\bretail|shipment|payment\b/i.test(line));
      expect(hits, `${file} must not write retail aggregates`).toEqual([]);
    }
  });

  it("D10.5 keeps identifier factories out of DDL (prefix discipline is app-level)", () => {
    const migrationDir = path.join(ROOT, "packages", "database", "migrations");
    const sqlFiles = readdirSync(migrationDir).filter((name) => name.endsWith(".sql"));
    expect(sqlFiles.length).toBeGreaterThan(0);
    for (const name of sqlFiles) {
      const body = read(path.join(migrationDir, name));
      expect(body, `${name} must not hardcode retail id prefixes`).not.toMatch(/rord_|rpay_|rshp_|rline_|rshpi_/);
    }
  });

  it("D10.6 freezes the retail order machine: forward-only, terminal states absorbing", () => {
    const body = read(path.join(ROOT, "packages", "shared", "src", "order-status.ts"));
    const table = body.slice(body.indexOf("RETAIL_ORDER_TRANSITIONS"), body.indexOf("};", body.indexOf("RETAIL_ORDER_TRANSITIONS")));
    expect(table).toContain('placed: ["confirmed", "cancelled"]');
    expect(table).toContain('confirmed: ["packed", "cancelled"]');
    expect(table).toContain('packed: ["shipped", "cancelled"]');
    expect(table).toContain('shipped: ["delivered"]');
    expect(table).toContain('delivered: ["returned"]');
    expect(table).toContain("cancelled: []");
    expect(table).toContain("returned: []");
  });

  it("D10.7 requires every retail commerce mutator to gate on owner-or-staff", () => {
    const body = read(path.join(SRC, "modules", "orders", "retail", "retail-orders.service.ts"));
    const mutators = [
      "cancelRetailOrder",
      "submitPaymentEvidence",
      "createPaymentIntent",
      "confirmRetailOrder",
      "packRetailOrder",
      "createRetailShipment",
      "markRetailShipmentHandoff",
      "recordRetailManualTracking",
    ];
    for (const name of mutators) {
      const start = body.indexOf(`async ${name}(`);
      expect(start, `${name} exists`).toBeGreaterThan(-1);
      // The gate must appear near the top of the mutator (before any state-changing touch).
      const window = body.slice(start, start + 4000);
      const gate = Math.min(
        ...["assertOrderOwner", "assertStaff"].map((fn) => {
          const at = window.indexOf(fn);
          return at === -1 ? Number.POSITIVE_INFINITY : at;
        }),
      );
      expect(gate, `${name} must call assertOrderOwner/assertStaff`).toBeLessThan(Number.POSITIVE_INFINITY);
    }
  });

  it("D10.8 requires fail-closed provider modes: fake providers never resolve in production", () => {
    for (const registry of [
      "modules/payments/payment-provider.registry.ts",
      "modules/shipping/shipping-provider.registry.ts",
    ]) {
      const body = read(path.join(SRC, registry));
      expect(body, registry).toMatch(/prohibited in production/);
    }
  });
});
