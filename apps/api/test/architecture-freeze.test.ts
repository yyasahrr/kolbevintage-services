import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODULES } from "../src/modules/registry";

const root = path.resolve(import.meta.dirname, "../src");

function sources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file)
      : entry.name.endsWith(".ts") && !/\.(spec|test|d)\.ts$/.test(entry.name) ? [file] : [];
  });
}

// Parse code, not comments: recognizes relative/barrel exports, dynamic imports,
// require calls and renamed imports. This is an architectural guard, not taint analysis.
function inspect(source: string) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const tokens: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      tokens.push(node.text);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, tokens };
}

const files = new Map(sources(root).map((file) => [file, inspect(fs.readFileSync(file, "utf8"))]));
const owner = (file: string) => path.relative(root, file).split(path.sep)[0] === "modules"
  ? path.relative(root, file).split(path.sep)[1] : undefined;
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const references = (tokens: string[], tables: string[]) => tables.filter((table) =>
  tokens.some((token) => new RegExp(`\\b(?:${table}|${camel(table)})\\b`).test(token)));

describe("Phase 3.10 architecture freeze", () => {
  it("registry dependencies have no cycles of any length", () => {
    const graph = new Map(MODULES.map((module) => [module.name, module.dependsOn]));
    function visit(name: string, stack: string[]) {
      expect(stack, `dependency cycle: ${[...stack, name].join(" -> ")}`).not.toContain(name);
      for (const next of graph.get(name) ?? []) visit(next, [...stack, name]);
    }
    for (const name of graph.keys()) visit(name, []);
  });

  it.each(["inventory", "catalog"])("%s has no Orders dependency or order-table access", (domain) => {
    const orderTables = MODULES.find((module) => module.name === "orders")!.tables;
    const registrySeen = new Set<string>();
    function visitRegistry(name: string) {
      if (registrySeen.has(name)) return;
      registrySeen.add(name);
      expect(name).not.toBe("orders");
      for (const next of MODULES.find((module) => module.name === name)?.dependsOn ?? []) visitRegistry(next);
    }
    visitRegistry(domain);
    const seen = new Set<string>();
    function visitFile(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      expect(owner(file), `Orders dependency through ${file}`).not.toBe("orders");
      const data = files.get(file);
      if (!data) return;
      expect(references(data.tokens, orderTables), `order table access in ${file}`).toEqual([]);
      for (const specifier of data.imports) {
        expect(specifier, `Orders import in ${file}`).not.toMatch(/(?:^|\/)orders(?:\/|$)/);
        if (!specifier.startsWith(".")) continue;
        const base = path.resolve(path.dirname(file), specifier);
        const resolved = [base, `${base}.ts`, path.join(base, "index.ts"), base.replace(/\.js$/, ".ts")].find((candidate) => files.has(candidate));
        if (resolved) visitFile(resolved);
      }
    }
    for (const file of files.keys()) if (owner(file) === domain) visitFile(file);
  });

  it.each([
    ["vip", "inventory"],
    ["suppliers", "offers"],
  ])("%s cannot directly access %s tables, even through the old READ_EXCEPTIONS", (domain, forbiddenOwner) => {
    let tables = MODULES.find((module) => module.name === forbiddenOwner)!.tables;
    // Phase 4.4 — command_idempotency is cross-cutting idempotency infrastructure, not inventory stock.
    // VIP revision workflow uses it for idempotent revision commands per spec.
    if (domain === "vip" && forbiddenOwner === "inventory") {
      tables = tables.filter((t) => t !== "command_idempotency");
    }
    for (const [file, data] of files) {
      if (owner(file) === domain) expect(references(data.tokens, tables), file).toEqual([]);
    }
  });

  it("scanner detects renamed table imports and literal SQL but ignores historical comments", () => {
    expect(references(inspect('import { inventoryReservation as hold } from "@kolbe/database"; db.insert(hold);').tokens, ["inventory_reservation"])).toEqual(["inventory_reservation"]);
    expect(references(inspect('client.query(`UPDATE product_variant_inventory SET reserved=1`);').tokens, ["product_variant_inventory"])).toEqual(["product_variant_inventory"]);
    expect(references(inspect('// inventory_reservation is not an owned table').tokens, ["inventory_reservation"])).toEqual([]);
    expect(inspect('export * from "../orders"; import("../orders/orders.service"); require("../orders");').imports).toHaveLength(3);
  });
});
