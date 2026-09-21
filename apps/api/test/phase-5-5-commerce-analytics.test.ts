import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-query.service";
import { bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.5 — commerce, marketplace and financial analytics", () => {
  let harness: Harness;
  let analytics: AnalyticsQueryService;

  beforeAll(async () => {
    harness = await bootHarness("phase55_b_analytics_test", { httpPrefix: false });
    analytics = harness.app.get(AnalyticsQueryService);
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it("returns factual zeroes for an empty platform period without synthetic KPIs", async () => {
    const result = await analytics.run({
      scope: "PLATFORM",
      scopeId: null,
      metricKeys: [
        "platform.accounts_count",
        "retail.orders_count",
        "retail.ordered_gmv",
        "wholesale.orders_count",
        "wholesale.ordered_gmv",
        "marketplace.child_orders_count",
        "supplier.child_orders_count",
        "supplier.delivered_shipments_count",
        "vip.active_memberships_count",
        "inventory.available_units",
        "payments.confirmed_amount",
        "refunds.amount",
        "settlement.pending_amount",
        "settlement.commission_earned",
        "crm.contacts_count",
        "support.open_cases_count",
        "notifications.sent_count",
        "notifications.delivered_count",
        "notifications.delivery_success_rate",
      ],
      range: { preset: "LAST_30_DAYS", timezone: "UTC" },
    });

    expect(result.freshness.sourceMode).toBe("AUTHORITATIVE_LIVE");
    expect(result.freshness.snapshot).toBe(false);
    expect(result.metrics).toHaveLength(19);
    for (const metric of result.metrics) {
      if (typeof metric.value === "string") expect(metric.value).toBe("0");
      else {
        expect(metric.value.numerator).toBe("0");
        expect(metric.value.denominator).toBe("0");
      }
    }
  });

  it("executes supplier and VIP queries with explicit server-shaped scopes", async () => {
    const supplier = await analytics.run({
      scope: "SUPPLIER",
      scopeId: "supplier_that_has_no_rows",
      metricKeys: [
        "supplier.child_orders_count",
        "supplier.order_units",
        "supplier.delivered_shipments_count",
        "inventory.available_units",
        "settlement.available_amount",
      ],
      range: { preset: "LAST_7_DAYS", timezone: "Asia/Tehran" },
    });
    expect(supplier.scope).toBe("SUPPLIER");
    expect(supplier.scopeId).toBe("supplier_that_has_no_rows");
    expect(supplier.metrics.every((metric) => metric.value === "0")).toBe(true);

    const vip = await analytics.run({
      scope: "VIP_ACCOUNT",
      scopeId: "vip_account_that_has_no_rows",
      metricKeys: ["vip.orders_count", "vip.ordered_gmv", "wholesale.units_ordered"],
      range: { preset: "LAST_7_DAYS", timezone: "UTC" },
    });
    expect(vip.scope).toBe("VIP_ACCOUNT");
    expect(vip.metrics.every((metric) => metric.value === "0")).toBe(true);
  });

  it("rejects an unsupported metric/scope combination instead of silently broadening it", async () => {
    await expect(analytics.run({
      scope: "SUPPLIER",
      scopeId: "supplier_a",
      metricKeys: ["payments.confirmed_amount"],
      range: { preset: "TODAY", timezone: "UTC" },
    })).rejects.toThrow(/not defined for scope/);
  });
});
