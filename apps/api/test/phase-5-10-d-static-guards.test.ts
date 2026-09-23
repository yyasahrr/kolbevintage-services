import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Phase 5.10-D10 — static architecture guards for search/discovery/
 * ratings (Checkpoints A/B/C).
 *
 * These guards freeze the D audit verdicts as executable assertions:
 * review writes stay in ratings/, verification reads stay read-only,
 * catalog aggregates stay read-only, no import edge joins the two
 * modules, every mutator stays gated, dormant decisions (supplier/
 * transaction ratings, search_rank) stay dormant, and the schema
 * keeps its shape. No database; pure source analysis.
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

describe("Phase 5.10-D10 static guards", () => {
  it("D10.1 confines product_rating writes to the ratings service", () => {
    const writers = filesWriting("productRating", "product_rating").map(rel);
    expect(writers).toEqual(["apps/api/src/modules/ratings/ratings.service.ts"]);
  });

  it("D10.2 keeps ratings/ order-table access read-only (no order writes)", () => {
    const dir = path.join(SRC, "modules", "ratings");
    const bodies = walk(dir).map(read).join("\n");
    for (const table of ["retail_order", "retail_order_item", "wholesale_order", "wholesale_order_item"]) {
      expect(bodies).toMatch(new RegExp(`\\b(FROM|JOIN)\\s+"?${table}"?\\b`, "i")); // verification reads exist
      expect(bodies).not.toMatch(new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+"?${table}"?\\b`, "i"));
    }
    expect(bodies).not.toMatch(/\.(insert|update|delete)\(\s*(retailOrder|retailOrderItem|wholesaleOrder|wholesaleOrderItem)\b/);
  });

  it("D10.3 keeps catalog/ product_rating access read-only (aggregates, no writes)", () => {
    const service = read(path.join(SRC, "modules", "catalog", "catalog.service.ts"));
    expect(service).toMatch(/FROM "product_rating"/); // summary + rated CTE exist
    expect(service).not.toMatch(/\b(INSERT\s+INTO|UPDATE)\s+"?product_rating"?\b/i);
    expect(service).not.toMatch(/\.(insert|update|delete)\(\s*productRating\b/);
  });

  it("D10.4 pins the absent catalog↔ratings import edge (freeze-test load-bearing)", () => {
    const catalogBodies = walk(path.join(SRC, "modules", "catalog")).map(read).join("\n");
    const ratingsBodies = walk(path.join(SRC, "modules", "ratings")).map(read).join("\n");
    expect(catalogBodies).not.toMatch(/from\s+"[^"]*modules\/ratings\//);
    expect(ratingsBodies).not.toMatch(/from\s+"[^"]*modules\/catalog\//);
  });

  it("D10.5 gates every ratings mutator at the service seam", () => {
    const service = read(path.join(SRC, "modules", "ratings", "ratings.service.ts"));
    for (const [method, gate] of [["fileReview", "assertRater"], ["updateReview", "assertRater"], ["flagReview", "assertRater"], ["setReviewVisibility", "assertAdmin"]] as const) {
      const start = service.indexOf(`async ${method}(`);
      expect(start, method).toBeGreaterThan(-1);
      const body = service.slice(start, service.indexOf("\n  async ", start + 1) === -1 ? undefined : service.indexOf("\n  async ", start + 1));
      expect(body, `${method} calls ${gate}`).toContain(`this.${gate}(actor)`);
    }
  });

  it("D10.6 pins Roles on review mutators and Public on review reads", () => {
    const controller = read(path.join(SRC, "modules", "ratings", "ratings.controller.ts"));
    const mutators = ["fileReview", "updateReview", "flagReview", "hideReview", "showReview"];
    for (const method of mutators) {
      const at = controller.indexOf(`async ${method}(`);
      expect(at, method).toBeGreaterThan(-1);
      const decorators = controller.slice(Math.max(0, at - 400), at);
      expect(decorators, `${method} has @Roles`).toMatch(/@Roles\("customer", "vip"\)|@Roles\("admin"\)/);
    }
    for (const method of ["listReviews", "getSummary"]) {
      const at = controller.indexOf(`async ${method}(`);
      expect(at, method).toBeGreaterThan(-1);
      expect(controller.slice(Math.max(0, at - 400), at), `${method} is @Public`).toContain("@Public()");
    }
  });

  it("D10.7 keeps the deferred surfaces dormant: supplier/transaction ratings and search_rank", () => {
    // The dormant rating tables are named only in the ownership
    // registry (schema + boundary-test mentions live outside src/).
    const namers = sources
      .filter((file) => /supplier_rating|supplierRating|transaction_rating|transactionRating/.test(read(file)))
      .map(rel)
      .sort();
    expect(namers).toEqual(["apps/api/src/modules/registry.ts"]);
    // search_rank: referenced only in comments (the deliberate
    // non-use note) — never read or written as signal.
    const codeOf = (file: string) =>
      read(file)
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
    const rankUsers = sources.filter((file) => /search_rank|searchRank/.test(codeOf(file))).map(rel);
    expect(rankUsers).toEqual([]);
  });

  it("D10.8 pins the schema shape: 198 tables, journal idx 43 (5.11-C: 0043 adds staff queue indexes only)", () => {
    const journal = JSON.parse(readFileSync(path.join(ROOT, "packages", "database", "migrations", "meta", "_journal.json"), "utf8"));
    expect(journal.entries).toHaveLength(44);
    expect(journal.entries[journal.entries.length - 1]).toMatchObject({ idx: 43, tag: "0043_phase_5_11_c_staff_queues" });
    const snapshot = JSON.parse(readFileSync(path.join(ROOT, "packages", "database", "migrations", "meta", "0043_snapshot.json"), "utf8"));
    expect(Object.keys(snapshot.tables)).toHaveLength(198);
  });
});
