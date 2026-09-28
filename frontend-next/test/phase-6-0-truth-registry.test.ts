import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKEND_OWNERS,
  COMPATIBILITY_ROUTE_SUMMARY,
  FRONTEND_TRUTH_REGISTRY,
} from "../truth-registry";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const replacementRequired = new Set(["LOCAL_STORAGE", "STATIC_FIXTURE", "HARDCODED_RUNTIME"]);

describe("Phase 6.0 frontend truth registry", () => {
  it("uses unique IDs and closes every unknown", () => {
    const ids = FRONTEND_TRUTH_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(FRONTEND_TRUTH_REGISTRY.filter((entry) => entry.classification === "UNKNOWN")).toEqual([]);
  });

  it("maps every business feature to a real owner, contract and checkpoint", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.businessTruth)) {
      expect(BACKEND_OWNERS, entry.id).toContain(entry.canonicalBackendOwner);
      expect(entry.canonicalApiContracts.length, entry.id).toBeGreaterThan(0);
      expect(entry.cutoverPhase, entry.id).toMatch(/^6\.[1-7]$/);
    }
  });

  it("gives every browser/static/hardcoded business source a replacement", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.businessTruth && replacementRequired.has(item.classification))) {
      expect(entry.preservationPolicy, entry.id).toBe("REPLACE_WITH_CORRECT_IMPLEMENTATION");
      expect(entry.canonicalApiContracts.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("documents decomposition for every mixed source", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.classification === "MIXED")) {
      expect(entry.decomposition?.length, entry.id).toBeGreaterThan(20);
    }
  });

  it("requires evidence for destructive deletion and currently deletes nothing", () => {
    const deletions = FRONTEND_TRUTH_REGISTRY.filter((entry) => entry.preservationPolicy === "DELETE_PROVEN_DUPLICATE");
    for (const entry of deletions) expect(entry.duplicateEvidence?.length, entry.id).toBeGreaterThan(20);
    expect(deletions).toEqual([]);
  });

  it("preserves supplier/manufacturer and retail/wholesale distinctions", () => {
    expect(FRONTEND_TRUTH_REGISTRY.find((entry) => entry.id === "supplier-production-qc")?.notes).toContain("Supplier and Manufacturer are not synonyms");
    expect(FRONTEND_TRUTH_REGISTRY.filter((entry) => entry.channelOwnership === "RETAIL_KOLBE").length).toBeGreaterThan(0);
    expect(FRONTEND_TRUTH_REGISTRY.filter((entry) => entry.channelOwnership === "WHOLESALE_KOLBE_AND_SUPPLIERS").length).toBeGreaterThan(0);
  });

  it("maps Admin mutations to granular permissions", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.portal === "ADMIN" || item.portal === "CMS_EDITOR")) {
      for (const api of entry.canonicalApiContracts.filter((item) => item.method !== "GET" && item.path !== "/api/v1/auth/login")) {
        expect(api.permission, `${entry.id} ${api.method} ${api.path}`).toBeTruthy();
      }
    }
  });

  it("declares safe money semantics for every monetary feature", () => {
    const monetary = FRONTEND_TRUTH_REGISTRY.filter((entry) => /price|pricing|finance|settlement|refund|checkout|order|promotion|payout|withdraw/i.test(`${entry.id} ${entry.feature}`));
    expect(monetary.length).toBeGreaterThan(0);
    for (const entry of monetary) expect(entry.moneySemantics, entry.id).toBe("DECIMAL_STRING_FROM_API_FORMAT_ONLY_NO_FLOAT_AUTHORITY");
  });

  it("maps compatibility routes to canonical targets and keeps deprecated routes non-authoritative", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.compatibilityRoutes.length > 0)) {
      expect(entry.canonicalApiContracts.length, entry.id).toBeGreaterThan(0);
      expect(entry.classification, entry.id).not.toBe("DEPRECATED");
    }
    expect(COMPATIBILITY_ROUTE_SUMMARY).toMatchObject({ total: 47, NEXT_PROXY_TO_NEST: 42, LEGACY_READ: 0, LEGACY_WRITE: 0, MISSING_CANONICAL_SEAM: 0, DEPRECATED: 2, STATIC_MOCK: 3 });
  });

  it("never marks browser business identity authoritative", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY.filter((item) => item.businessTruth)) {
      expect(["SERVER_SESSION", "NOT_APPLICABLE"], entry.id).toContain(entry.identityAuthority);
    }
  });

  it("represents every major page module", () => {
    const pages = fs.readdirSync(path.join(frontendRoot, "storefront", "pages"))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `storefront/pages/${name}`);
    const represented = new Set(FRONTEND_TRUTH_REGISTRY.flatMap((entry) => entry.sourceFiles));
    for (const page of pages) expect(represented, page).toContain(page);
  });

  it("uses real current test files or explicit planned test IDs", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      expect(entry.parityTests.length, entry.id).toBeGreaterThan(0);
      for (const reference of entry.parityTests) {
        expect(reference.startsWith("planned:") || fs.existsSync(path.join(frontendRoot, reference)), `${entry.id}: ${reference}`).toBe(true);
      }
    }
  });

  it("freezes visuals and defines UI state contracts for every feature", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      expect(entry.visualFreeze, entry.id).toBe(true);
      expect(entry.uiStates.length, entry.id).toBeGreaterThan(0);
    }
  });
});
