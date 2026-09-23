import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { CustomerOperatorViewService } from "./customer-operator-view.service";

/**
 * Phase 5.11-A — retail customer operator view over admin HTTP.
 *
 * Thin forwarding shell over `CustomerOperatorViewService`: one
 * customer page (safe identity + order/return/refund relations +
 * support headers) per call, gated on `retail:customer:view`.
 */
@Controller("admin/retail")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRetailCustomersController {
  constructor(@Inject(CustomerOperatorViewService) private readonly view: CustomerOperatorViewService) {}

  @RequireAdminPermission("retail:customer:view")
  @Get("customers/:id")
  async getCustomer(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("ordersCursor") ordersCursor?: string,
    @Query("returnsCursor") returnsCursor?: string,
  ) {
    return toApiJson(
      await this.view.getRetailCustomerForStaff({ actorId: claims.sub, actorRole: claims.role }, id, {
        limit,
        ordersCursor,
        returnsCursor,
      }),
    );
  }
}
