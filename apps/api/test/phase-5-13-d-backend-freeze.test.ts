import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODULES, UNASSIGNED_TABLES, validateRegistry } from "../src/modules/registry";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [absolute] : [];
  });
}

function mutatedTables(source: string): string[] {
  const ast = ts.createSourceFile("authority-scan.ts", source, ts.ScriptTarget.Latest, true);
  const tables: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const match of node.text.matchAll(/\b(?:INSERT\s+INTO|UPDATE(?!\s+SET\b)|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi)) {
        tables.push(match[1].toLowerCase());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return tables;
}

describe("Phase 5.13-D final backend authority freeze", () => {
  it("keeps every registered table under one unambiguous owner", () => {
    expect(validateRegistry()).toEqual([]);
    expect(UNASSIGNED_TABLES).toEqual([]);
    const tables = MODULES.flatMap((module) => module.tables);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("keeps the route inventory free of legacy business authority", () => {
    const inventory = JSON.parse(read("docs/architecture/phase-5-12-route-inventory.json"));
    expect(inventory.summary).toMatchObject({
      total: 47,
      LEGACY_READ: 0,
      LEGACY_WRITE: 0,
      MISSING_CANONICAL_SEAM: 0,
      REMOVE_LATER: 0,
    });
    expect(inventory.routes.filter((route: { status: string }) => route.status === "NEXT_PROXY_TO_NEST")).toHaveLength(42);
  });

  it("allows only the classified demo-seed and telemetry SQL writers at the Next edge", () => {
    const serverRoot = path.join(root, "frontend-next", "server");
    const mutations = walk(serverRoot).flatMap((file) =>
      mutatedTables(fs.readFileSync(file, "utf8")).map((table) => ({ file: path.relative(root, file).replaceAll("\\", "/"), table })),
    );
    const byFile = Map.groupBy(mutations, (entry) => entry.file);

    expect([...byFile.keys()].sort()).toEqual([
      "frontend-next/server/database.ts",
      "frontend-next/server/kolbe-api.ts",
    ]);
    expect(new Set(byFile.get("frontend-next/server/database.ts")?.map((entry) => entry.table))).toEqual(new Set([
      "account_user", "supplier", "supplier_member", "wholesale_account", "seller",
      "product", "product_variant", "seller_offer", "product_variant_inventory",
    ]));
    expect(new Set(byFile.get("frontend-next/server/kolbe-api.ts")?.map((entry) => entry.table))).toEqual(new Set(["system_log"]));

    const database = read("frontend-next/server/database.ts");
    expect(database).toContain('if (env.NODE_ENV === "production") return { enabled: false');
    expect(database).toContain('if (env.KOLBE_SEED_DEMO_DATA !== "true") return { enabled: false');
  });

  it("keeps browser bundles free of PostgreSQL and direct SQL writers", () => {
    for (const relative of ["frontend-next/storefront", "frontend-kolbe/src"]) {
      for (const file of walk(path.join(root, relative))) {
        const source = fs.readFileSync(file, "utf8");
        expect(source, path.relative(root, file)).not.toMatch(/(?:from|require\s*\()\s*["']pg["']/);
        expect(mutatedTables(source), path.relative(root, file)).toEqual([]);
      }
    }
  });
});
