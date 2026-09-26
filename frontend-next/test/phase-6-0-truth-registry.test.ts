import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKEND_OWNERS,
  COMPATIBILITY_ROUTE_SUMMARY,
  DESIGN_CHANGE_POLICIES,
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

  /**
   * CONTROLLED DESIGN EVOLUTION replaces the retired Hard Design Freeze.
   * The registry no longer claims that every surface is frozen; it claims that
   * every surface has been *deliberately classified*, and that the two things
   * which must never be traded for design freedom - backend truth and the
   * declared UI state contract - still hold everywhere.
   */
  it("gives every surface a deliberate design-change policy and a UI state contract", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      expect(DESIGN_CHANGE_POLICIES, entry.id).toContain(entry.designChangePolicy);
      expect(entry.uiStates.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("requires written justification for every RESTRUCTURE decision", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      if (entry.designChangePolicy !== "RESTRUCTURE") continue;
      const rationale = (entry.designChangeRationale ?? "").trim();
      // A rationale that does not name the workflow being blocked is bureaucracy, not governance.
      expect(rationale.length, `${entry.id} rationale`).toBeGreaterThan(120);
    }
  });

  it("keeps the retired hard freeze out of the executable registry", () => {
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      expect("visualFreeze" in entry, `${entry.id} still carries visualFreeze`).toBe(false);
    }
  });

  /**
   * Controlled design evolution may change composition; it may never launder
   * unresolved business truth. Where the browser still holds business truth the
   * registry must say so explicitly and must schedule the cutover - the design
   * policy is not an escape hatch from that record.
   */
  it("tracks every surface whose business truth is still held in the browser", () => {
    const browserHeld = ["LOCAL_STORAGE", "STATIC_FIXTURE", "HARDCODED_RUNTIME", "MIXED", "UNKNOWN"];
    const debt = FRONTEND_TRUTH_REGISTRY.filter((entry) => entry.businessTruth && browserHeld.includes(entry.classification));
    expect(debt.length).toBeGreaterThan(0); // the record must not be silently emptied
    for (const entry of debt) {
      expect(entry.classification, `${entry.id} must be classified, never UNKNOWN`).not.toBe("UNKNOWN");
      expect(entry.cutoverPhase, `${entry.id} browser-held truth needs a scheduled cutover`).toBeTruthy();
    }
  });

  it("never grants a RESTRUCTURE policy to a surface whose backend truth is still unresolved", () => {
    // Redesigning a screen is only worthwhile once its data ownership is real;
    // otherwise the redesign is theatre over a fake workflow.
    const unresolved = ["LOCAL_STORAGE", "STATIC_FIXTURE", "HARDCODED_RUNTIME", "UNKNOWN"];
    for (const entry of FRONTEND_TRUTH_REGISTRY) {
      if (entry.designChangePolicy !== "RESTRUCTURE") continue;
      expect(unresolved, `${entry.id} is RESTRUCTURE but its truth is unresolved`).not.toContain(entry.classification);
    }
  });
});
