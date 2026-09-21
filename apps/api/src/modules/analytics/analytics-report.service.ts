import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  analyticsReportRun,
  analyticsSavedReport,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import {
  ANALYTICS_MAX_METRICS_PER_RUN,
  isAnalyticsComparison,
  isAnalyticsDatePreset,
  isAnalyticsDimension,
  parseMetricKeys,
  resolveAnalyticsRange,
  type AnalyticsDefinition,
  type AnalyticsDimension,
  type AnalyticsReportResult,
  type AnalyticsScope,
  type AnalyticsDatePreset,
  type AnalyticsComparison,
} from "./analytics.contract";
import { getMetricDefinition } from "./analytics-metrics";
import { AnalyticsForbiddenError, AnalyticsReportNotFoundError, AnalyticsValidationError } from "./analytics.errors";
import { AnalyticsQueryService } from "./analytics-query.service";

export type AnalyticsOwnerScope = {
  scope: AnalyticsScope;
  scopeId: string | null;
};

type StoredSavedReport = {
  id: string;
  name: string;
  reportType: string;
  scope: AnalyticsScope;
  scopeId: string | null;
  definition: AnalyticsDefinition;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AnalyticsReportService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AnalyticsQueryService) private readonly queries: AnalyticsQueryService,
  ) {}

  async createSavedReport(
    ownerId: string,
    scope: AnalyticsOwnerScope,
    name: unknown,
    input: unknown,
    reportType: unknown = "SAVED_REPORT",
  ): Promise<StoredSavedReport> {
    const normalizedName = this.normalizeName(name);
    const normalizedType = reportType === "METRIC_SET" || reportType === "SAVED_REPORT" ? reportType : "SAVED_REPORT";
    const definition = this.normalizeDefinition(input, scope);
    const id = this.id("analytics_report");
    const [row] = await this.db.insert(analyticsSavedReport).values({
      id,
      name: normalizedName,
      reportType: normalizedType,
      scope: scope.scope,
      scopeId: scope.scopeId,
      definition: definition as unknown as Record<string, unknown>,
      ownerId,
    }).returning();
    if (!row) throw new Error("Analytics saved report could not be created");
    return this.mapSavedReport(row);
  }

  async listSavedReports(ownerId: string, scope: AnalyticsOwnerScope, includeAllOwned = false): Promise<StoredSavedReport[]> {
    const rows = await this.db
      .select()
      .from(analyticsSavedReport)
      .where(and(eq(analyticsSavedReport.ownerId, ownerId), eq(analyticsSavedReport.scope, scope.scope)))
      .orderBy(desc(analyticsSavedReport.updatedAt));
    return rows
      .filter((row) => includeAllOwned || this.matchesScope(row.scope as AnalyticsScope, row.scopeId, scope))
      .map((row) => this.mapSavedReport(row));
  }

  async getSavedReport(id: string, ownerId: string, scope: AnalyticsOwnerScope, includeAllOwned = false): Promise<StoredSavedReport> {
    const [row] = await this.db.select().from(analyticsSavedReport).where(eq(analyticsSavedReport.id, id)).limit(1);
    if (!row) throw new AnalyticsReportNotFoundError(id);
    if (row.ownerId !== ownerId && !includeAllOwned) throw new AnalyticsForbiddenError("The saved report is not owned by this session");
    if (!this.matchesScope(row.scope as AnalyticsScope, row.scopeId, scope)) {
      throw new AnalyticsForbiddenError("The saved report is outside the authorized analytics scope");
    }
    return this.mapSavedReport(row);
  }

  async deleteSavedReport(id: string, ownerId: string, scope: AnalyticsOwnerScope, includeAllOwned = false): Promise<void> {
    const report = await this.getSavedReport(id, ownerId, scope, includeAllOwned);
    await this.db.delete(analyticsSavedReport).where(eq(analyticsSavedReport.id, report.id));
  }

  async runSavedReport(
    id: string,
    requestedBy: string,
    scope: AnalyticsOwnerScope,
    includeAllOwned = false,
  ): Promise<AnalyticsReportResult> {
    const report = await this.getSavedReport(id, requestedBy, scope, includeAllOwned);
    const runId = this.id("analytics_run");
    await this.db.insert(analyticsReportRun).values({
      id: runId,
      reportType: report.reportType,
      scope: report.scope,
      scopeId: report.scopeId,
      definition: report.definition as unknown as Record<string, unknown>,
      status: "QUEUED",
      sourceMode: "AUTHORITATIVE_LIVE",
      requestedBy,
    });
    await this.db.update(analyticsReportRun).set({ status: "RUNNING", startedAt: new Date(), updatedAt: new Date() }).where(
      and(eq(analyticsReportRun.id, runId), eq(analyticsReportRun.status, "QUEUED")),
    );

    try {
      const result = await this.queries.run(report.definition, runId);
      await this.db.update(analyticsReportRun).set({
        status: "COMPLETED",
        sourceMode: "AUTHORITATIVE_LIVE",
        dataAsOf: new Date(result.freshness.dataAsOf),
        result: result as unknown as Record<string, unknown>,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(analyticsReportRun.id, runId), eq(analyticsReportRun.status, "RUNNING")));
      return result;
    } catch (error) {
      await this.db.update(analyticsReportRun).set({
        status: "FAILED",
        errorCode: error instanceof Error ? error.name : "ANALYTICS_RUN_FAILED",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(analyticsReportRun.id, runId), eq(analyticsReportRun.status, "RUNNING")));
      throw error;
    }
  }

  async getRun(id: string, requestedBy: string, scope: AnalyticsOwnerScope, includeAllOwned = false) {
    const [row] = await this.db.select().from(analyticsReportRun).where(eq(analyticsReportRun.id, id)).limit(1);
    if (!row) throw new AnalyticsReportNotFoundError(id);
    if (row.requestedBy !== requestedBy && !includeAllOwned) throw new AnalyticsForbiddenError("The report run is not owned by this session");
    if (!this.matchesScope(row.scope as AnalyticsScope, row.scopeId, scope)) throw new AnalyticsForbiddenError("The report run is outside the authorized analytics scope");
    return row;
  }

  normalizeDefinition(input: unknown, scope: AnalyticsOwnerScope): AnalyticsDefinition {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AnalyticsValidationError("A report definition object is required");
    const raw = input as Record<string, unknown>;
    const allowed = new Set(["metricKeys", "range", "dimensions"]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) throw new AnalyticsValidationError("Report definitions may contain only metricKeys, range, and dimensions");
    const metricKeys = parseMetricKeys(raw.metricKeys);
    if (metricKeys.length === 0 || metricKeys.length > ANALYTICS_MAX_METRICS_PER_RUN) throw new AnalyticsValidationError(`A report must contain 1-${ANALYTICS_MAX_METRICS_PER_RUN} metrics`);
    for (const key of metricKeys) {
      const metric = getMetricDefinition(key);
      if (!metric) throw new AnalyticsValidationError(`Unknown analytics metric '${key}'`);
      if (!metric.supportedScopes.includes(scope.scope)) throw new AnalyticsValidationError(`Metric '${key}' is not defined for scope '${scope.scope}'`);
    }

    const rawRange = raw.range && typeof raw.range === "object" && !Array.isArray(raw.range) ? raw.range as Record<string, unknown> : {};
    const allowedRange = new Set(["preset", "startUtc", "endUtc", "startDate", "endDate", "timezone", "comparison"]);
    if (Object.keys(rawRange).some((key) => !allowedRange.has(key))) throw new AnalyticsValidationError("Report range contains an unsupported field");
    const preset = typeof rawRange.preset === "string" ? rawRange.preset.toUpperCase() : undefined;
    const comparison = typeof rawRange.comparison === "string" ? rawRange.comparison.toUpperCase() : undefined;
    if (preset && !isAnalyticsDatePreset(preset)) throw new AnalyticsValidationError(`Unsupported date preset '${String(rawRange.preset)}'`);
    if (comparison && !isAnalyticsComparison(comparison)) throw new AnalyticsValidationError(`Unsupported comparison '${String(rawRange.comparison)}'`);
    const dimensions = raw.dimensions === undefined ? undefined : Array.isArray(raw.dimensions) ? raw.dimensions : [];
    if (dimensions?.some((item) => !isAnalyticsDimension(item))) throw new AnalyticsValidationError("Report dimensions are not allowlisted");
    const definition: AnalyticsDefinition = {
      metricKeys,
      scope: scope.scope,
      scopeId: scope.scopeId,
      dimensions: dimensions as AnalyticsDimension[] | undefined,
      range: {
        preset: preset as AnalyticsDatePreset | undefined,
        startUtc: typeof rawRange.startUtc === "string" ? rawRange.startUtc : undefined,
        endUtc: typeof rawRange.endUtc === "string" ? rawRange.endUtc : undefined,
        startDate: typeof rawRange.startDate === "string" ? rawRange.startDate : undefined,
        endDate: typeof rawRange.endDate === "string" ? rawRange.endDate : undefined,
        timezone: typeof rawRange.timezone === "string" ? rawRange.timezone : undefined,
        comparison: comparison as AnalyticsComparison | undefined,
      },
    };
    try {
      resolveAnalyticsRange(definition.range);
    } catch (error) {
      throw new AnalyticsValidationError(error instanceof Error ? error.message : "Invalid report date range");
    }
    return definition;
  }

  private normalizeName(value: unknown): string {
    if (typeof value !== "string") throw new AnalyticsValidationError("Report name is required");
    const name = value.trim();
    if (!name || name.length > 120) throw new AnalyticsValidationError("Report name must be 1-120 characters");
    return name;
  }

  private matchesScope(reportScope: AnalyticsScope, reportScopeId: string | null, scope: AnalyticsOwnerScope): boolean {
    return reportScope === scope.scope && (reportScope === "SUPPLIER" || reportScope === "VIP_ACCOUNT" ? reportScopeId === scope.scopeId : reportScopeId === null);
  }

  private mapSavedReport(row: typeof analyticsSavedReport.$inferSelect): StoredSavedReport {
    return {
      id: row.id,
      name: row.name,
      reportType: row.reportType,
      scope: row.scope as AnalyticsScope,
      scopeId: row.scopeId,
      definition: row.definition as AnalyticsDefinition,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private id(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
