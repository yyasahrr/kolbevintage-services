import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { RetailDashboardService } from "./retail-dashboard.service";

/**
 * Phase 5.11-B — retail payment/shipping exception queues over HTTP.
 *
 * Actionable buckets of real stored states (payments awaiting
 * evidence/verification or failed; active or failed shipments) with
 * provider/manual truth on every row — no synthetic stalled or
 * reconciliation flags, no gateway states fabricated. Gated on
 * `retail:finance:view`; limit/offset paging follows the
 * control-tower queue precedent.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRetailExceptionsController {
  constructor(@Inject(RetailDashboardService) private readonly dashboard: RetailDashboardService) {}

  @RequireAdminPermission("retail:finance:view")
  @Get("exceptions")
  async getExceptions(@Query("limit") limit?: string, @Query("offset") offset?: string) {
    return toApiJson(await this.dashboard.getExceptions({ limit, offset }));
  }
}
