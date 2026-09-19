import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Phase 4.6 — Single-Writer Finance Guard
 * Frontend Next must not direct-write proforma/payment/allocation/refund/financial_ledger/order_financial_release
 */

const FINANCE_PROTECTED = [
  "wholesale_proforma",
  "wholesale_proforma_line",
  "payment",
  "payment_allocation",
  "order_financial_release",
  "financial_ledger_entry",
  "refund",
];

function scanFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "dist" || e.name === ".git") continue;
      files.push(...scanFiles(full));
    } else {
      if (full.endsWith(".ts") || full.endsWith(".tsx") || full.endsWith(".js")) files.push(full);
    }
  }
  return files;
}

function containsMutation(content: string, table: string): boolean {
  const patterns = [
    new RegExp(`INSERT\\s+INTO\\s+[\"']?${table}[\"']?`, "i"),
    new RegExp(`UPDATE\\s+[\"']?${table}[\"']?\\s+SET`, "i"),
    new RegExp(`DELETE\\s+FROM\\s+[\"']?${table}[\"']?`, "i"),
  ];
  return patterns.some((re) => re.test(content));
}

describe("Phase 4.6 — Single-Writer Finance Guard", () => {
  it("Frontend Next must not direct-write finance tables", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const scanRoots = [
      path.join(repoRoot, "frontend-next/server"),
      path.join(repoRoot, "frontend-next/app"),
      path.join(repoRoot, "frontend-next/storefront/lib"),
      path.join(repoRoot, "frontend-next/supplier-src"),
    ];

    const violations: string[] = [];

    for (const root of scanRoots) {
      const files = scanFiles(root);
      for (const file of files) {
        if (file.includes(".test.") || file.includes(".spec.")) continue;
        // Allow adapter and phase reports
        if (file.includes("phase-4-5-adapter") || file.includes("phase-reports")) continue;
        const content = fs.readFileSync(file, "utf8");
        for (const table of FINANCE_PROTECTED) {
          if (containsMutation(content, table)) {
            const lines = content.split("\n").filter((l) => {
              const t = l.trim();
              if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
              return containsMutation(l, table);
            });
            if (lines.length > 0) {
              violations.push(`${path.relative(repoRoot, file)} mutates ${table}: ${lines[0].trim().slice(0, 200)}`);
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      console.error("Finance single-writer violations:\n" + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });

  it("No in-memory idempotency for finance", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const paymentsServicePath = path.join(repoRoot, "apps/api/src/modules/payments/payments.service.ts");
    const content = fs.readFileSync(paymentsServicePath, "utf8");
    // Should use command_idempotency table via Drizzle (commandIdempotency)
    expect(content.includes("command_idempotency") || content.includes("commandIdempotency")).toBe(true);
    expect(content).toContain("idempotencyKey");
    // Ensure no idempotency Map pattern like idempotencyCache or inMemory
    expect(content.toLowerCase()).not.toContain("in-memory");
    expect(content.toLowerCase()).not.toContain("inmemory");
  });

  it("No network call while DB locks held", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const paymentsServicePath = path.join(repoRoot, "apps/api/src/modules/payments/payments.service.ts");
    const content = fs.readFileSync(paymentsServicePath, "utf8");
    // Should NOT contain fetch, axios, http.get while locks held
    // We check that file does not contain fetch/axios in same function as FOR UPDATE
    // Simple heuristic: no fetch/axios in file
    expect(content).not.toContain("fetch(");
    expect(content).not.toContain("axios.");
    // Manual provider should say no network
    const manualProviderPath = path.join(repoRoot, "apps/api/src/modules/payments/manual-transfer.provider.ts");
    const manualContent = fs.readFileSync(manualProviderPath, "utf8");
    expect(manualContent).toContain("no network");
  });
});
