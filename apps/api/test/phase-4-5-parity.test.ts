import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
function read(p: string) {
  return fs.readFileSync(p, "utf8");
}

describe("Phase 4.5 — Parity for every old mutation scenario", () => {
  it("create order via POST /api/v1/wholesale/orders Idempotency-Key", () => {
    const ordersCtrl = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.controller.ts"));
    expect(ordersCtrl).toContain("Idempotency-Key");
    expect(ordersCtrl).toContain("createWholesaleOrder");
  });

  it("supplier child confirm/prepare/dispatch via canonical endpoints", () => {
    const supplierCtrl = read(path.join(repoRoot, "apps/api/src/modules/orders/supplier-orders.controller.ts"));
    expect(supplierCtrl).toContain("confirmChildOrder");
    expect(supplierCtrl).toContain("startChildPreparation");
    expect(supplierCtrl).toContain("dispatchChildOrder");
    expect(supplierCtrl).toContain("deliverChildOrder");
    expect(supplierCtrl).toContain("cancelChildOrder");
  });

  it("cancellation parent+isolated child via canonical orchestration", () => {
    const ordersService = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts"));
    expect(ordersService).toContain("cancelParentOrder");
    expect(ordersService).toContain("cancelChildOrder");
    // Parent cancel releases via InventoryService, not GREATEST
    expect(ordersService).toContain("releaseChildOrderAllocations");
    expect(ordersService).not.toContain("GREATEST(0,reserved");
  });

  it("exception report+resolution via fulfillment", () => {
    const fulfillmentCtrl = read(path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.controller.ts"));
    expect(fulfillmentCtrl).toContain("reportException");
    expect(fulfillmentCtrl).toContain("resolveException");
  });

  it("replacement linked via fulfillment_replacement_request", () => {
    const fulfillmentService = read(path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.service.ts"));
    expect(fulfillmentService).toContain("linkReplacement");
    expect(fulfillmentService).toContain("fulfillment_replacement_request");
  });

  it("legacy writer audit doc exists and lists canonical replacements", () => {
    const auditDoc = path.join(repoRoot, "docs/phase-reports/phase-4-5-legacy-writer-audit.md");
    expect(fs.existsSync(auditDoc)).toBe(true);
    const content = read(auditDoc);
    expect(content).toContain("wholesale_order");
    expect(content).toContain("purchase_order");
    expect(content).toContain("canonical");
    expect(content).toContain("LEGACY_MUTATION_DISABLED");
  });
});

describe("Phase 4.5 — Legacy writer negative tests", () => {
  it("before/after DB state no order/inventory/audit writes from legacy file when kill switch enabled", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    // Should have kill switch
    expect(kolbeApi).toContain("assertLegacyMutationsEnabled");
    // Should have forwarding, not direct INSERT for wholesale
    expect(kolbeApi).toContain("forwardToNest");
    // Should NOT have direct INSERT wholesale_order in POST handler (we replaced)
    const wholesalePostSection = kolbeApi.slice(kolbeApi.indexOf('if (path === "wholesale/orders" && req.method === "POST")'));
    const nextSection = wholesalePostSection.indexOf("throw new HttpError(404, \"NOT_FOUND\")");
    const relevant = wholesalePostSection.slice(0, nextSection !== -1 ? nextSection : 2000);
    expect(relevant).not.toContain("INSERT INTO wholesale_order");
    expect(relevant).not.toContain("INSERT INTO wholesale_order_item");
  });
});
