import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalyticsReconciliationService } from "../src/modules/analytics/analytics-reconciliation.service";
import { bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.5 — authoritative reconciliation and read-only controls", () => {
  let harness: Harness;
  let service: AnalyticsReconciliationService;

  beforeAll(async () => {
    harness = await bootHarness("phase55_d_reconciliation_test", { httpPrefix: false });
    service = harness.app.get(AnalyticsReconciliationService);
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it("reconciles all authoritative domains without writing business facts", async () => {
    const before = await harness.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM wholesale_order");
    const result = await service.run({ scope: "PLATFORM", scopeId: null }, { preset: "LAST_30_DAYS", timezone: "UTC" });
    const after = await harness.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM wholesale_order");

    expect(result.readOnly).toBe(true);
    expect(result.checks).toHaveLength(9);
    expect(result.checks.map((check) => check.sourceDomain)).toEqual([
      "Orders / Marketplace",
      "Payments / Refunds",
      "Shipping",
      "Inventory",
      "Settlement",
      "CRM",
      "Support",
      "Notifications",
      "VIP",
    ]);
    expect(result.checks.every((check) => check.status === "PASS" || check.status === "NOT_APPLICABLE")).toBe(true);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("keeps supplier and VIP reconciliation scopes explicit", async () => {
    const supplier = await service.run({ scope: "SUPPLIER", scopeId: "supplier_scope" }, { preset: "TODAY", timezone: "Asia/Tehran" });
    expect(supplier.scope).toBe("SUPPLIER");
    expect(supplier.checks.find((check) => check.key === "inventory.invariants")?.status).toBe("PASS");
    expect(supplier.checks.find((check) => check.key === "crm.authoritative_rows")?.status).toBe("NOT_APPLICABLE");

    const vip = await service.run({ scope: "VIP_ACCOUNT", scopeId: "vip_scope" }, { preset: "TODAY", timezone: "UTC" });
    expect(vip.scope).toBe("VIP_ACCOUNT");
    expect(vip.checks.find((check) => check.key === "vip.membership_orders")?.status).toBe("PASS");
    expect(vip.checks.find((check) => check.key === "inventory.invariants")?.status).toBe("NOT_APPLICABLE");
  });
});
