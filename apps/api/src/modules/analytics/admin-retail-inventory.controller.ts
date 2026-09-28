import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { RetailDashboardService } from "./retail-dashboard.service";

/**
 * Phase 5.11-B — KOLBE retail inventory operator view over admin HTTP.
 *
 * KOLBE-held stock only (supplier-held rows never appear), exact
 * on-hand/reserved/sellable quantities with the zero-stock fact —
 * no low-stock bands (no authoritative threshold exists), gated on
 * `retail:inventory:view`.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRetailInventoryController {
  constructor(@Inject(RetailDashboardService) private readonly dashboard: RetailDashboardService) {}

  @RequireAdminPermission("retail:inventory:view")
  @Get("inventory")
  async listInventory(
    @Query("productId") productId?: string,
    @Query("stockoutOnly") stockoutOnly?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return toApiJson(await this.dashboard.listInventory({ productId, stockoutOnly, limit, cursor }));
  }
}
