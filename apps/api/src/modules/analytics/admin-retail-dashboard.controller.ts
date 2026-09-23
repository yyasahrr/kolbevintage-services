import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { RetailDashboardService } from "./retail-dashboard.service";
import type { AnalyticsRangeInput } from "./analytics.contract";

/**
 * Phase 5.11-B — retail operations dashboard over admin HTTP.
 *
 * Thin shell over `RetailDashboardService`: canonical sales metrics
 * plus live operational queues and a recent-exception sample, gated
 * on `retail:dashboard:view`. Range params pass through to the
 * analytics engine untouched (presets, CUSTOM instants/dates,
 * timezone, comparison); invalid ranges refuse with
 * `ANALYTICS_INVALID_REQUEST`.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRetailDashboardController {
  constructor(@Inject(RetailDashboardService) private readonly dashboard: RetailDashboardService) {}

  @RequireAdminPermission("retail:dashboard:view")
  @Get("dashboard")
  async getDashboard(
    @Query("preset") preset?: string,
    @Query("timezone") timezone?: string,
    @Query("startUtc") startUtc?: string,
    @Query("endUtc") endUtc?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("comparison") comparison?: string,
  ) {
    const range = { preset, timezone, startUtc, endUtc, startDate, endDate, comparison } as AnalyticsRangeInput;
    return toApiJson(await this.dashboard.getDashboard(range));
  }
}
