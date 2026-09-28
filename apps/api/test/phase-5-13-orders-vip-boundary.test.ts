import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const modules = path.resolve(import.meta.dirname, "../src/modules");

describe("Phase 5.13-A Orders/VIP ownership boundary", () => {
  it("keeps Orders-owned request linkage out of VIP", () => {
    const source = fs.readFileSync(path.join(modules, "vip/vip.service.ts"), "utf8");

    expect(source).not.toMatch(/\bwholesaleOrderRequest\b/);
    expect(source).not.toMatch(/\bwholesale_order_request\b/);
  });

  it("verifies the Orders-owned link before requesting the VIP state transition", () => {
    const source = fs.readFileSync(path.join(modules, "orders/orders.service.ts"), "utf8");
    const linkLookup = source.indexOf("this.repository.findOrderRequestLinkByRequestId(req.id, tx)");
    const markOrdered = source.indexOf("this.vipService.markRequestOrdered(req.id, req.version, tx)");

    expect(linkLookup).toBeGreaterThanOrEqual(0);
    expect(markOrdered).toBeGreaterThan(linkLookup);
  });
});
