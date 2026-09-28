import { describe, expect, it } from "vitest";
import {
  ANALYTICS_METRICS,
  ANALYTICS_METRIC_REGISTRY,
} from "../src/modules/analytics/analytics-metrics";
import {
  ratioValue,
  resolveAnalyticsRange,
  zonedMidnightUtc,
} from "../src/modules/analytics/analytics.contract";

describe("Phase 5.5 — metric registry and reporting foundation", () => {
  it("has a version-controlled semantic definition for every registered key", () => {
    expect(ANALYTICS_METRICS.length).toBeGreaterThanOrEqual(35);
    for (const metric of ANALYTICS_METRICS) {
      expect(ANALYTICS_METRIC_REGISTRY.get(metric.key)).toBe(metric);
      expect(metric.key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
      expect(metric.sourceTables.length).toBeGreaterThan(0);
      expect(metric.timestampBasis.length).toBeGreaterThan(0);
      expect(metric.amountBasis.length).toBeGreaterThan(0);
      expect(metric.refundTreatment.length).toBeGreaterThan(0);
      expect(metric.cancellationTreatment.length).toBeGreaterThan(0);
      expect(metric.freshness).toContain("LIVE");
    }
  });

  it("preserves exact ratio inputs and derives integer basis points", () => {
    expect(ratioValue(37n, 100n)).toEqual({
      kind: "ratio",
      numerator: "37",
      denominator: "100",
      basisPoints: "3700",
    });
    expect(ratioValue(1n, 3n).basisPoints).toBe("3333");
  });

  it("resolves Tehran calendar boundaries to UTC deterministically", () => {
    const range = resolveAnalyticsRange({
      preset: "CUSTOM",
      startDate: "2026-03-21",
      endDate: "2026-03-21",
      timezone: "Asia/Tehran",
    });
    expect(range.startUtc.toISOString()).toBe("2026-03-20T20:30:00.000Z");
    expect(range.endUtc.toISOString()).toBe("2026-03-21T20:30:00.000Z");
    expect(zonedMidnightUtc("2026-03-21", "Asia/Tehran").toISOString()).toBe("2026-03-20T20:30:00.000Z");
  });

  it("does not accept implicit local-time custom instants", () => {
    expect(() => resolveAnalyticsRange({
      preset: "CUSTOM",
      startUtc: "2026-01-01T00:00:00",
      endUtc: "2026-01-02T00:00:00Z",
      timezone: "UTC",
    })).toThrow(/UTC/);
  });
});
