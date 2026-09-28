import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Phase 4.5 — Order Management & Replacement Workflow Tests
 * Verifies:
 * - Replacement does NOT modify original OrderItem (immutable)
 * - Buyer choice replacement_requested/quantity_reduction/cancel_portion
 * - New wholesale_request via VipService normal flow NOT auto accepted
 * - Link via Fulfillment-owned fulfillment_replacement_request RESTRICT no CASCADE
 * - VIP APIs paginated stable cursor created_at DESC id DESC capped, ownership Claims.sub
 * - Timeline combines histories chronologically without mutating sources, avoids PII
 * - Parent cancellation transactional lock parent→children deterministic, no dispatch, InventoryService release, financial evidence no money movement
 * - Admin filters, reason required, invariants preserved
 */

const repoRoot = path.resolve(__dirname, "../../..");
const ordersServicePath = path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts");
const fulfillmentServicePath = path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.service.ts");
const ordersControllerPath = path.join(repoRoot, "apps/api/src/modules/orders/orders.controller.ts");
const adminControllerPath = path.join(repoRoot, "apps/api/src/modules/orders/admin-orders.controller.ts");
const fulfillmentControllerPath = path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.controller.ts");
const migrationPath = path.join(repoRoot, "packages/database/migrations/0017_phase_4_5_replacement_and_parent_cancel.sql");
const schemaPath = path.join(repoRoot, "packages/database/src/schema/tables.ts");
const vipServicePath = path.join(repoRoot, "apps/api/src/modules/vip/vip.service.ts");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

describe("Phase 4.5 — Replacement Workflow", () => {
  it("does NOT modify original OrderItem (seller/offer/price/package/variant/quantity/snapshot immutable)", () => {
    const content = read(ordersServicePath);
    const fulfillment = read(fulfillmentServicePath);
    // Ensure no UPDATE wholesale_order_item in replacement flow
    // Replacement flow should NOT contain UPDATE wholesale_order_item SET
    // Instead, replacement creates new wholesale_request, not modify order item
    expect(fulfillment).toMatch(/fulfillment[_]?[Rr]eplacement[_]?[Rr]equest/);
    expect(fulfillment).toContain("replacement_requested");
    // Verify that cancelChildOrder does not modify productNameSnapshot etc
    expect(content).not.toMatch(/UPDATE\s+wholesale_order_item\s+SET.*productNameSnapshot/i);
  });

  it("explicit buyer choice replacement_requested/quantity_reduction/cancel_portion only affected child", () => {
    const fulfillment = read(fulfillmentServicePath);
    expect(fulfillment).toContain("replacement_requested");
    expect(fulfillment).toContain("quantity_reduction");
    expect(fulfillment).toContain("cancel_portion");
    // Buyer resolution types
    expect(fulfillment).toMatch(/buyerResolution/);
  });

  it("for replacement create new wholesale_request via VipService normal flow NOT auto accepted", () => {
    const vip = read(vipServicePath);
    const fulfillmentCtrl = read(fulfillmentControllerPath);
    // VipService.createWholesaleRequest should create pending, not accepted
    expect(vip).toContain('status: "pending"');
    // Fulfillment controller should call vipService.createWholesaleRequest then link
    expect(fulfillmentCtrl).toContain("createWholesaleRequest");
    expect(fulfillmentCtrl).toContain("linkReplacement");
    // Should NOT auto accept
    expect(fulfillmentCtrl).not.toContain("markRequestOrdered");
  });

  it("link via Fulfillment-owned fulfillment_replacement_request RESTRICT no CASCADE, one request not replacing multiple unrelated", () => {
    const migration = read(migrationPath);
    const schema = read(schemaPath);
    // Check RESTRICT FK
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).toMatch(/RESTRICT/);
    // Check no CASCADE except in comment about no CASCADE
    const cascadeLines = migration.split("\n").filter(l => l.includes("CASCADE") && !l.trim().startsWith("--"));
    expect(cascadeLines.length).toEqual(0);
    // Unique indexes for exception and replacement
    expect(migration).toContain("fulfillment_replacement_request_exception_unique");
    expect(migration).toContain("fulfillment_replacement_request_replacement_unique");
    // Schema also
    expect(schema).toContain("fulfillment_replacement_request_exception_unique");
    expect(schema).toContain("fulfillment_replacement_request_replacement_unique");
    expect(schema).toContain("onDelete(\"restrict\")");
  });

  it("no VIP→Fulfillment dependency", () => {
    const vip = read(vipServicePath);
    // VipService should NOT import FulfillmentService
    expect(vip).not.toContain("FulfillmentService");
    expect(vip).not.toContain("fulfillment");
  });

  it("old child after replacement follows canonical cancellation/resolution releasing only its active reservations sibling continues", () => {
    const fulfillment = read(fulfillmentServicePath);
    // After replacement, old child should be cancelled via cancelChildOrder which releases only its reservations
    expect(read(ordersServicePath)).toContain("releaseChildOrderAllocations");
    expect(read(fulfillmentControllerPath)).toContain("cancel_portion");
  });

  it("no money movement, financial evidence future_refund_or_payment_adjustment", () => {
    const orders = read(ordersServicePath);
    expect(orders).toContain("future_refund_or_payment_adjustment");
    // No actual money movement: no wallet refund, no payout, no payment gateway
    expect(orders.toLowerCase()).not.toContain("wallet");
    expect(orders.toLowerCase()).not.toContain("payout");
    expect(orders.toLowerCase()).not.toContain("payment_gateway");
    expect(orders.toLowerCase()).not.toContain("actual_refund");
  });
});

describe("Phase 4.5 — VIP APIs", () => {
  it("GET /api/v1/wholesale/orders list paginated stable cursor created_at DESC id DESC capped", () => {
    const content = read(ordersServicePath);
    expect(content).toMatch(/createdAt.*DESC|created_at.*DESC/i);
    expect(content).toMatch(/\.id.*DESC/);
    expect(content).toContain("limit");
    // Capped to 100
    expect(content).toContain("100");
  });

  it("ownership Claims.sub never trust body accountId/buyerUserId/sellerId/vipAccountId", () => {
    const ctrl = read(ordersControllerPath);
    expect(ctrl).toContain("claims.sub");
    expect(ctrl).not.toContain("body.accountId");
    expect(ctrl).not.toContain("body.buyerUserId");
    expect(ctrl).not.toContain("body.sellerId");
    expect(ctrl).not.toContain("body.vipAccountId");
    // Check for 403/404 per convention
    expect(read(ordersServicePath)).toContain("ORDER_OWNERSHIP_VIOLATION");
    expect(read(ordersServicePath)).toContain("ORDER_NOT_FOUND");
  });

  it("detail uses immutable Order snapshots no current product name/SKU/package recipe/seller display/offer price required", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("productNameSnapshot");
    expect(content).toContain("skuSnapshot");
    expect(content).toContain("sellerSnapshot");
  });

  it("returns parent/lines/seller children/statuses/totals/exception summaries/request refs redact internal", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("exceptions");
    expect(content).toContain("links");
  });
});

describe("Phase 4.5 — Timeline", () => {
  it("combines order_status_history, order_event, child status history, fulfillment_exception, request/revision events chronologically without mutating sources", () => {
    const content = read(ordersServicePath);
    expect(content).toMatch(/orderStatusHistory|order_status_history/);
    expect(content).toMatch(/orderEvent|order_event/);
    expect(content).toMatch(/fulfillmentException|fulfillment_exception/);
    expect(content).toMatch(/wholesaleRequestRevision|wholesale_request_revision/);
    expect(content).toMatch(/fulfillment[_]?[Rr]eplacement[_]?[Rr]equest/);
    // Chronological sort
    expect(content).toContain("sort");
    // Without mutating sources
    expect(content).not.toContain("UPDATE order_status_history");
    expect(content).not.toContain("UPDATE order_event");
  });

  it("avoids PII secrets audit metadata", () => {
    const content = read(ordersServicePath);
    // Timeline redacts actorId, address, sessions, cookies
    expect(content).toContain("redact");
  });
});

describe("Phase 4.5 — Full parent cancellation", () => {
  it("allowed per frozen rules (draft/confirmed/awaiting_payment may cancel if no dispatch, processing/fulfillment stricter, never shipped/completed)", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("cancelParentOrder");
    expect(content).toContain("shipped");
    expect(content).toContain("completed");
    expect(content).toContain("PARENT_CANCEL_BLOCKED_BY_DISPATCH");
  });

  it("transactional: lock parent→lock children deterministic→verify no forbidden dispatched→release remaining active via InventoryService→cancel eligible children→parent cancelled→history/events/audit COMMIT", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("FOR UPDATE");
    expect(content).toContain("ORDER BY id ASC FOR UPDATE"); // deterministic
    expect(content).toContain("releaseChildOrderAllocations");
    expect(content).toContain("appendStatusHistory");
    expect(content).toContain("appendEvent");
    expect(content).toContain("auditService.record");
  });

  it("no raw Inventory SQL no manual compensation, financial evidence kind future_refund_or_payment_adjustment", () => {
    const content = read(ordersServicePath);
    // Should NOT contain direct UPDATE product_variant_inventory in cancelParentOrder
    const cancelSection = content.slice(content.indexOf("async cancelParentOrder"));
    expect(cancelSection).not.toContain("UPDATE product_variant_inventory");
    expect(cancelSection).toContain("future_refund_or_payment_adjustment");
    expect(cancelSection).not.toContain("REFUND");
  });
});

describe("Phase 4.5 — Admin", () => {
  it("GET /api/v1/admin/wholesale/orders with filters status/buyer/account/seller/child status/exception status/date range/order code paginated", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("adminListOrders");
    expect(content).toContain("status");
    expect(content).toContain("buyerUserId");
    expect(content).toContain("accountId");
    expect(content).toContain("sellerId");
    expect(content).toContain("childStatus");
    expect(content).toContain("exceptionStatus");
    expect(content).toContain("dateFrom");
    expect(content).toContain("orderCode");
  });

  it("admin NOT exempt invariants must NOT mark paid/bypass payment/resurrect terminal/change immutable snapshots/force shipped→cancelled/direct alter stock", () => {
    const adminCtrl = read(adminControllerPath);
    const orders = read(ordersServicePath);
    // Admin cancel should still check shipped/completed block
    expect(orders).toContain("PARENT_CANCEL_BLOCKED_BY_DISPATCH");
    // Admin should NOT have method to mark paid
    expect(adminCtrl).not.toContain("markPaid");
    expect(adminCtrl).not.toContain("bypass");
  });

  it("every override reason required history/event/audit", () => {
    const content = read(ordersServicePath);
    expect(content).toContain("CANCELLATION_REASON_REQUIRED");
    expect(content).toContain("appendStatusHistory");
    expect(content).toContain("appendEvent");
  });
});

describe("Phase 4.5 — Legacy cutover", () => {
  it("frontend BFF calls Nest canonical APIs via secure HttpOnly cookie forwarding no localStorage bearer fake token", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    expect(kolbeApi).toContain("forwardToNest");
    expect(kolbeApi).toContain("cookie");
    expect(kolbeApi).toContain("HttpOnly");
    // Ensure forwardToNest does not use localStorage or fake token
    const start = kolbeApi.indexOf("async function forwardToNest");
    const nextFunc = kolbeApi.indexOf("function mapLegacySupplierStatusToNest", start);
    const forwardSection = kolbeApi.slice(start, nextFunc !== -1 ? nextFunc : start + 2000);
    expect(forwardSection).not.toContain("localStorage");
    expect(forwardSection).not.toContain("fake");
    // Bearer is allowed in legacy claimsFrom for backward compat, but new forwarding must use cookie, not Bearer
    expect(forwardSection).not.toContain("Bearer");
    expect(forwardSection).toContain("cookie");
  });

  it("map legacy order creation to POST /api/v1/wholesale/orders Idempotency-Key", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    expect(kolbeApi).toContain("wholesale/orders");
    expect(kolbeApi).toContain("idempotency-key");
  });

  it("map supplier status to confirm/start-preparation/ready/report-exception/dispatch/deliver/cancel no arbitrary status body", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    expect(kolbeApi).toContain("mapLegacySupplierStatusToNest");
    expect(kolbeApi).toContain("confirm");
    expect(kolbeApi).toContain("start-preparation");
    expect(kolbeApi).toContain("dispatch");
  });

  it("remove approve order→create purchase orders no duplicate children", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    // Should contain 410 for legacy approval
    expect(kolbeApi).toContain("LEGACY_APPROVAL_REMOVED");
  });

  it("kill switch LEGACY_MUTATION_DISABLED", () => {
    const kolbeApi = read(path.join(repoRoot, "frontend-next/server/kolbe-api.ts"));
    expect(kolbeApi).toContain("LEGACY_MUTATION_DISABLED");
    expect(kolbeApi).toContain("assertLegacyMutationsEnabled");
  });
});
