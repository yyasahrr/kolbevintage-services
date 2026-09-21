import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { analyticsExportJob, analyticsReportRun } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import {
  ANALYTICS_EXPORT_TTL_SECONDS,
  ANALYTICS_MAX_EXPORT_ROWS,
  type AnalyticsMetricResult,
} from "./analytics.contract";
import type { AnalyticsOwnerScope } from "./analytics-report.service";
import { AnalyticsForbiddenError, AnalyticsExportNotFoundError, AnalyticsValidationError } from "./analytics.errors";
import { AnalyticsReportService } from "./analytics-report.service";

export type AnalyticsExportRequest = {
  reportRunId: string;
  rowLimit?: unknown;
  page?: unknown;
};

@Injectable()
export class AnalyticsExportService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AnalyticsReportService) private readonly reports: AnalyticsReportService,
  ) {}

  async requestExport(
    requestedBy: string,
    scope: AnalyticsOwnerScope,
    request: AnalyticsExportRequest,
    includeAllOwned = false,
  ) {
    const reportRunId = typeof request.reportRunId === "string" ? request.reportRunId : "";
    if (!reportRunId) throw new AnalyticsValidationError("reportRunId is required");
    const rowLimit = this.rowLimit(request.rowLimit);
    const page = this.page(request.page);
    const run = await this.reports.getRun(reportRunId, requestedBy, scope, includeAllOwned);
    if (run.status !== "COMPLETED" || !run.result) throw new AnalyticsValidationError("Only a completed live report run can be exported");
    const result = run.result as unknown as { metrics?: AnalyticsMetricResult[] };
    const metrics = Array.isArray(result.metrics) ? result.metrics : [];
    const offset = (page - 1) * rowLimit;
    const selected = metrics.slice(offset, offset + rowLimit);
    const jobId = this.id("analytics_export");
    const expiresAt = new Date(Date.now() + ANALYTICS_EXPORT_TTL_SECONDS * 1000);
    const [job] = await this.db.insert(analyticsExportJob).values({
      id: jobId,
      reportRunId,
      format: "CSV",
      status: "QUEUED",
      rowLimit,
      fileName: `analytics-${reportRunId}-${page}.csv`,
      requestedBy,
      expiresAt,
    }).returning();
    if (!job) throw new Error("Analytics export job could not be created");

    await this.processClaimedJob(job.id, metrics, offset, rowLimit, page);
    return this.getExport(job.id, requestedBy, scope, includeAllOwned);
  }

  async getExport(id: string, requestedBy: string, scope: AnalyticsOwnerScope, includeAllOwned = false) {
    const job = await this.findJob(id);
    await this.assertJobAccess(job, requestedBy, scope, includeAllOwned);
    if (job.status !== "EXPIRED" && job.expiresAt <= new Date()) {
      await this.db.update(analyticsExportJob).set({ status: "EXPIRED", updatedAt: new Date() }).where(
        and(eq(analyticsExportJob.id, id), lt(analyticsExportJob.expiresAt, new Date())),
      );
      return { ...(await this.findJob(id)), outputText: null };
    }
    return job;
  }

  async downloadExport(id: string, requestedBy: string, scope: AnalyticsOwnerScope, includeAllOwned = false): Promise<string> {
    const job = await this.getExport(id, requestedBy, scope, includeAllOwned);
    if (job.status === "EXPIRED") throw new AnalyticsExportNotFoundError(id);
    if (job.status !== "COMPLETED" || !job.outputText) throw new AnalyticsValidationError("Analytics export is not complete");
    return job.outputText;
  }

  private async processClaimedJob(id: string, metrics: AnalyticsMetricResult[], offset: number, rowLimit: number, page: number): Promise<void> {
    const [claimed] = await this.db.update(analyticsExportJob).set({ status: "PROCESSING", startedAt: new Date(), updatedAt: new Date() }).where(
      and(eq(analyticsExportJob.id, id), eq(analyticsExportJob.status, "QUEUED")),
    ).returning();
    if (!claimed) return;
    try {
      const selected = metrics.slice(offset, offset + rowLimit);
      const csv = this.toCsv(selected, page, offset);
      await this.db.update(analyticsExportJob).set({
        status: "COMPLETED",
        rowCount: selected.length,
        outputText: csv,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(analyticsExportJob.id, id), eq(analyticsExportJob.status, "PROCESSING")));
    } catch (error) {
      await this.db.update(analyticsExportJob).set({
        status: "FAILED",
        failureReason: error instanceof Error ? error.message.slice(0, 500) : "ANALYTICS_EXPORT_FAILED",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(analyticsExportJob.id, id), eq(analyticsExportJob.status, "PROCESSING")));
      throw error;
    }
  }

  private async assertJobAccess(job: typeof analyticsExportJob.$inferSelect, requestedBy: string, scope: AnalyticsOwnerScope, includeAllOwned: boolean): Promise<void> {
    if (job.requestedBy !== requestedBy && !includeAllOwned) throw new AnalyticsForbiddenError("The analytics export is not owned by this session");
    const run = await this.reports.getRun(job.reportRunId, requestedBy, scope, includeAllOwned);
    if (run.scope !== scope.scope || ((scope.scope === "SUPPLIER" || scope.scope === "VIP_ACCOUNT") && run.scopeId !== scope.scopeId)) {
      throw new AnalyticsForbiddenError("The analytics export is outside the authorized scope");
    }
  }

  private async findJob(id: string) {
    const [job] = await this.db.select().from(analyticsExportJob).where(eq(analyticsExportJob.id, id)).limit(1);
    if (!job) throw new AnalyticsExportNotFoundError(id);
    return job;
  }

  private rowLimit(value: unknown): number {
    if (value === undefined || value === null || value === "") return ANALYTICS_MAX_EXPORT_ROWS;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > ANALYTICS_MAX_EXPORT_ROWS) throw new AnalyticsValidationError(`Export rowLimit must be an integer between 1 and ${ANALYTICS_MAX_EXPORT_ROWS}`);
    return parsed;
  }

  private page(value: unknown): number {
    if (value === undefined || value === null || value === "") return 1;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1_000_000) throw new AnalyticsValidationError("Export page must be a positive integer");
    return parsed;
  }

  private toCsv(metrics: AnalyticsMetricResult[], page: number, offset: number): string {
    const headers = ["row", "metric_key", "label", "unit", "value", "comparison_mode", "comparison_value", "range_start_utc", "range_end_utc"];
    const rows = metrics.map((metric, index) => [
      String(offset + index + 1),
      metric.key,
      metric.label,
      metric.unit,
      this.valueForCsv(metric.value),
      metric.comparison.mode,
      metric.comparison.value === null ? "" : this.valueForCsv(metric.comparison.value),
      metric.range.startUtc,
      metric.range.endUtc,
    ]);
    return [headers, ...rows].map((row) => row.map((value) => this.escapeCsv(value)).join(",")).join("\n") + `\n# page=${page}\n`;
  }

  private valueForCsv(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const ratio = value as { numerator?: string; denominator?: string; basisPoints?: string };
      return `numerator=${ratio.numerator ?? "0"};denominator=${ratio.denominator ?? "0"};basis_points=${ratio.basisPoints ?? "0"}`;
    }
    return String(value ?? "");
  }

  private escapeCsv(value: string): string {
    const normalized = value.replace(/[\t\r]/g, " ");
    const safe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  private id(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
