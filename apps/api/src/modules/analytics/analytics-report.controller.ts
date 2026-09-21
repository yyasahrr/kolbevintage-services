import { Body, Controller, Delete, Get, Header, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { AnalyticsExportService, type AnalyticsExportRequest } from "./analytics-export.service";
import { AnalyticsReportService } from "./analytics-report.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import type { AnalyticsQuery } from "./analytics.controller";

export type SavedReportBody = {
  name?: unknown;
  reportType?: unknown;
  definition?: unknown;
  scope?: string;
  scopeId?: string;
};

function actorId(claims: Claims): string {
  return claims.sub;
}

@Controller("admin/analytics/reports")
@UseGuards(AdminPermissionGuard)
@Roles("admin")
export class AdminAnalyticsReportController {
  constructor(
    @Inject(AnalyticsReportService) private readonly reports: AnalyticsReportService,
    @Inject(AnalyticsExportService) private readonly exports: AnalyticsExportService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Post()
  @RequireAdminPermission("analytics:report:manage")
  async create(@CurrentUser() claims: Claims, @Body() body: SavedReportBody) {
    const scope = await this.scopes.resolveAdmin(body.scope, body.scopeId);
    return toApiJson(await this.reports.createSavedReport(actorId(claims), scope, body.name, body.definition, body.reportType));
  }

  @Get()
  @RequireAdminPermission("analytics:report:view")
  async list(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return toApiJson(await this.reports.listSavedReports(actorId(claims), scope, true));
  }

  @Get(":id")
  @RequireAdminPermission("analytics:report:view")
  async get(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return toApiJson(await this.reports.getSavedReport(id, actorId(claims), scope, true));
  }

  @Delete(":id")
  @RequireAdminPermission("analytics:report:manage")
  async remove(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    await this.reports.deleteSavedReport(id, actorId(claims), scope, true);
    return { deleted: true, id };
  }

  @Post(":id/run")
  @RequireAdminPermission("analytics:report:view")
  async run(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return toApiJson(await this.reports.runSavedReport(id, actorId(claims), scope, true));
  }

  @Post("exports")
  @RequireAdminPermission("analytics:export")
  async export(@CurrentUser() claims: Claims, @Body() body: AnalyticsExportRequest & { scope?: string; scopeId?: string }) {
    const scope = await this.scopes.resolveAdmin(body.scope, body.scopeId);
    return toApiJson(await this.exports.requestExport(actorId(claims), scope, body, true));
  }

  @Get("exports/:id")
  @RequireAdminPermission("analytics:export")
  async exportStatus(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return toApiJson(await this.exports.getExport(id, actorId(claims), scope, true));
  }

  @Get("exports/:id/download")
  @RequireAdminPermission("analytics:export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=analytics-export.csv")
  async download(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return this.exports.downloadExport(id, actorId(claims), scope, true);
  }
}

@Controller("supplier/analytics/reports")
@Roles("supplier")
export class SupplierAnalyticsReportController {
  constructor(
    @Inject(AnalyticsReportService) private readonly reports: AnalyticsReportService,
    @Inject(AnalyticsExportService) private readonly exports: AnalyticsExportService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Post()
  async create(@CurrentUser() claims: Claims, @Body() body: SavedReportBody) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), body.scope, body.scopeId);
    return toApiJson(await this.reports.createSavedReport(actorId(claims), scope, body.name, body.definition, body.reportType));
  }

  @Get()
  async list(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.listSavedReports(actorId(claims), scope));
  }

  @Get(":id")
  async get(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.getSavedReport(id, actorId(claims), scope));
  }

  @Delete(":id")
  async remove(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    await this.reports.deleteSavedReport(id, actorId(claims), scope);
    return { deleted: true, id };
  }

  @Post(":id/run")
  async run(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.runSavedReport(id, actorId(claims), scope));
  }

  @Post("exports")
  async export(@CurrentUser() claims: Claims, @Body() body: AnalyticsExportRequest & { scope?: string; scopeId?: string }) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), body.scope, body.scopeId);
    return toApiJson(await this.exports.requestExport(actorId(claims), scope, body));
  }

  @Get("exports/:id")
  async exportStatus(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.exports.getExport(id, actorId(claims), scope));
  }

  @Get("exports/:id/download")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=analytics-export.csv")
  async download(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(actorId(claims), query.scope, query.scopeId);
    return this.exports.downloadExport(id, actorId(claims), scope);
  }
}

@Controller("vip/analytics/reports")
@Roles("vip")
export class VipAnalyticsReportController {
  constructor(
    @Inject(AnalyticsReportService) private readonly reports: AnalyticsReportService,
    @Inject(AnalyticsExportService) private readonly exports: AnalyticsExportService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Post()
  async create(@CurrentUser() claims: Claims, @Body() body: SavedReportBody) {
    const scope = await this.scopes.resolveVip(actorId(claims), body.scope, body.scopeId);
    return toApiJson(await this.reports.createSavedReport(actorId(claims), scope, body.name, body.definition, body.reportType));
  }

  @Get()
  async list(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.listSavedReports(actorId(claims), scope));
  }

  @Get(":id")
  async get(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.getSavedReport(id, actorId(claims), scope));
  }

  @Delete(":id")
  async remove(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    await this.reports.deleteSavedReport(id, actorId(claims), scope);
    return { deleted: true, id };
  }

  @Post(":id/run")
  async run(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.reports.runSavedReport(id, actorId(claims), scope));
  }

  @Post("exports")
  async export(@CurrentUser() claims: Claims, @Body() body: AnalyticsExportRequest & { scope?: string; scopeId?: string }) {
    const scope = await this.scopes.resolveVip(actorId(claims), body.scope, body.scopeId);
    return toApiJson(await this.exports.requestExport(actorId(claims), scope, body));
  }

  @Get("exports/:id")
  async exportStatus(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    return toApiJson(await this.exports.getExport(id, actorId(claims), scope));
  }

  @Get("exports/:id/download")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", "attachment; filename=analytics-export.csv")
  async download(@CurrentUser() claims: Claims, @Param("id") id: string, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(actorId(claims), query.scope, query.scopeId);
    return this.exports.downloadExport(id, actorId(claims), scope);
  }
}
