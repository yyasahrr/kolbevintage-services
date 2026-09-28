import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import type { AnalyticsRangeInput } from "./analytics.contract";
import { AnalyticsReconciliationService } from "./analytics-reconciliation.service";
import { AnalyticsScopeService } from "./analytics-scope.service";
import type { AnalyticsQuery } from "./analytics.controller";

function rangeFromQuery(query: AnalyticsQuery): AnalyticsRangeInput {
  return {
    preset: query.preset?.toUpperCase() as AnalyticsRangeInput["preset"],
    startUtc: query.startUtc,
    endUtc: query.endUtc,
    startDate: query.startDate,
    endDate: query.endDate,
    timezone: query.timezone,
    comparison: query.comparison?.toUpperCase() as AnalyticsRangeInput["comparison"],
  };
}

@Controller("admin/analytics/reconciliation")
@UseGuards(AdminPermissionGuard)
@Roles("admin")
export class AdminAnalyticsReconciliationController {
  constructor(
    @Inject(AnalyticsReconciliationService) private readonly reconciliation: AnalyticsReconciliationService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get()
  @RequireAdminPermission("analytics:reconciliation:view")
  async run(@Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveAdmin(query.scope, query.scopeId);
    return toApiJson(await this.reconciliation.run(scope, rangeFromQuery(query)));
  }
}

@Controller("supplier/analytics/reconciliation")
@Roles("supplier")
export class SupplierAnalyticsReconciliationController {
  constructor(
    @Inject(AnalyticsReconciliationService) private readonly reconciliation: AnalyticsReconciliationService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get()
  async run(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveSupplier(claims.sub, query.scope, query.scopeId);
    return toApiJson(await this.reconciliation.run(scope, rangeFromQuery(query)));
  }
}

@Controller("vip/analytics/reconciliation")
@Roles("vip")
export class VipAnalyticsReconciliationController {
  constructor(
    @Inject(AnalyticsReconciliationService) private readonly reconciliation: AnalyticsReconciliationService,
    @Inject(AnalyticsScopeService) private readonly scopes: AnalyticsScopeService,
  ) {}

  @Get()
  async run(@CurrentUser() claims: Claims, @Query() query: AnalyticsQuery) {
    const scope = await this.scopes.resolveVip(claims.sub, query.scope, query.scopeId);
    return toApiJson(await this.reconciliation.run(scope, rangeFromQuery(query)));
  }
}
