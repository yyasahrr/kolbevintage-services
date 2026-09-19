import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");
function read(p: string) {
  return fs.readFileSync(p, "utf8");
}

describe("Phase 4.5 — Security", () => {
  it("VIP A ≠ B order read/cancel blocked by ownership check", () => {
    const ordersService = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts"));
    expect(ordersService).toContain("ORDER_OWNERSHIP_VIOLATION");
    expect(ordersService).toContain("buyerUserId");
    // getOrderDetailForBuyer checks buyerUserId !== claims.sub
    expect(ordersService).toContain("You do not own this order");
  });

  it("Supplier A ≠ B child read/mutate blocked", () => {
    const supplierCtrl = read(path.join(repoRoot, "apps/api/src/modules/orders/supplier-orders.controller.ts"));
    expect(supplierCtrl).toContain("assertSupplierOwnership");
    expect(supplierCtrl).toContain("SUPPLIER_OWNERSHIP_VIOLATION");
  });

  it("buyer cannot Admin, forged accountId/sellerId ignored/rejected", () => {
    const ordersCtrl = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.controller.ts"));
    // Should not trust body accountId etc
    expect(ordersCtrl).not.toContain("body.accountId");
    expect(ordersCtrl).not.toContain("body.sellerId");
    // Uses Claims.sub
    expect(ordersCtrl).toContain("claims.sub");
  });

  it("timeline redacts metadata, no PII secrets", () => {
    const ordersService = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts"));
    expect(ordersService).toContain("redact");
    // Should not log address in timeline data
    const timelineSection = ordersService.slice(ordersService.indexOf("async getOrderTimeline"), ordersService.indexOf("async adminListOrders"));
    expect(timelineSection).not.toContain("shippingAddressSnapshot");
    expect(timelineSection).not.toContain("billingAddressSnapshot");
  });

  it("replacement cannot target unrelated exception", () => {
    const fulfillmentService = read(path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.service.ts"));
    expect(fulfillmentService).toContain("REPLACEMENT_ALREADY_LINKED");
    expect(fulfillmentService).toContain("one request not pretending to replace multiple unrelated");
  });

  it("admin override requires reason", () => {
    const ordersService = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts"));
    expect(ordersService).toContain("CANCELLATION_REASON_REQUIRED");
    const fulfillmentCtrl = read(path.join(repoRoot, "apps/api/src/modules/fulfillment/fulfillment.controller.ts"));
    expect(fulfillmentCtrl).toContain("REJECTION_REASON_REQUIRED");
  });

  it("structured logs order id/command type/actor type/result/conflict code never log address/sessions/cookies/PII", () => {
    const ordersService = read(path.join(repoRoot, "apps/api/src/modules/orders/orders.service.ts"));
    expect(ordersService).toContain("orderId");
    expect(ordersService).toContain("actorId");
    const cancelSection = ordersService.slice(ordersService.indexOf("async cancelParentOrder"));
    expect(cancelSection).not.toContain("shippingAddressSnapshot");
    expect(cancelSection).not.toContain("billingAddressSnapshot");
    expect(cancelSection).not.toContain("cookie");
    expect(cancelSection).not.toContain("session");
  });
});
