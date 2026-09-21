import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser } from "@kolbe/database";
import { AnalyticsExportService } from "../src/modules/analytics/analytics-export.service";
import { AnalyticsReportService } from "../src/modules/analytics/analytics-report.service";
import { makeId, bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.5 — validated reports and bounded exports", () => {
  let harness: Harness;
  let reports: AnalyticsReportService;
  let exportsService: AnalyticsExportService;
  let ownerId: string;
  let otherOwnerId: string;

  beforeAll(async () => {
    harness = await bootHarness("phase55_c_reports_test", { httpPrefix: false });
    reports = harness.app.get(AnalyticsReportService);
    exportsService = harness.app.get(AnalyticsExportService);
    ownerId = makeId("analytics_owner");
    otherOwnerId = makeId("analytics_other");
    await harness.db.insert(accountUser).values([
      { id: ownerId, email: `${ownerId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "admin" },
      { id: otherOwnerId, email: `${otherOwnerId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "admin" },
    ]);
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it("persists an allowlisted definition, creates a live run, and exports it durably", async () => {
    const saved = await reports.createSavedReport(ownerId, { scope: "PLATFORM", scopeId: null }, "Empty platform report", {
      metricKeys: ["retail.orders_count", "payments.confirmed_amount", "notifications.delivery_success_rate"],
      range: { preset: "LAST_7_DAYS", timezone: "UTC", comparison: "PREVIOUS_PERIOD" },
      dimensions: ["day"],
    });
    expect(saved.definition.scope).toBe("PLATFORM");
    expect(saved.definition.scopeId).toBeNull();
    expect(saved.definition.metricKeys).toHaveLength(3);

    const run = await reports.runSavedReport(saved.id, ownerId, { scope: "PLATFORM", scopeId: null });
    expect(run.reportRunId).toBeTruthy();
    expect(run.freshness.sourceMode).toBe("AUTHORITATIVE_LIVE");

    const job = await exportsService.requestExport(ownerId, { scope: "PLATFORM", scopeId: null }, {
      reportRunId: run.reportRunId!,
      rowLimit: 2,
      page: 1,
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.rowCount).toBe(2);
    expect(job.outputText).toContain("metric_key");
    expect(job.outputText).toContain("retail.orders_count");
    expect(job.outputText).toContain("# page=1");
    expect(await exportsService.downloadExport(job.id, ownerId, { scope: "PLATFORM", scopeId: null })).toBe(job.outputText);
  });

  it("rejects arbitrary executable report fields, unsafe limits, and cross-owner reads", async () => {
    await expect(reports.createSavedReport(ownerId, { scope: "PLATFORM", scopeId: null }, "bad", {
      metricKeys: ["retail.orders_count"],
      query: "SELECT * FROM account_user",
    })).rejects.toThrow(/only metricKeys, range, and dimensions/);

    await expect(exportsService.requestExport(ownerId, { scope: "PLATFORM", scopeId: null }, {
      reportRunId: "missing",
      rowLimit: 10001,
    })).rejects.toThrow(/between 1 and 10000/);

    const saved = await reports.createSavedReport(ownerId, { scope: "PLATFORM", scopeId: null }, "owner-only", {
      metricKeys: ["retail.orders_count"],
      range: { preset: "TODAY", timezone: "UTC" },
    });
    await expect(reports.getSavedReport(saved.id, otherOwnerId, { scope: "PLATFORM", scopeId: null })).rejects.toThrow(/not owned/);
  });

  it("neutralizes formula-leading CSV values and control characters", () => {
    const escapeCsv = (exportsService as unknown as { escapeCsv: (value: string) => string }).escapeCsv.bind(exportsService);
    expect(escapeCsv("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsv("-100\t\r")).toBe("'-100  ");
    expect(escapeCsv("a,b")).toBe('"a,b"');
  });
});
