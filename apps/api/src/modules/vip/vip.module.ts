import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { VipService } from "./vip.service";
import { WholesalePlanService } from "./wholesale-plan.service";
import { WholesaleMembershipService } from "./wholesale-membership.service";
import { EntitlementResolver } from "./entitlement.resolver";
import { VipController } from "./vip.controller";
import { WholesaleRequestsController } from "./wholesale-requests.controller";
import { AdminWholesalePlansController } from "./admin-wholesale-plans.controller";
import { AdminWholesaleMembershipsController } from "./admin-wholesale-memberships.controller";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { SupplierTeamModule } from "../supplier-team/supplier-team.module";

@Module({
  imports: [DatabaseModule, AuditModule, SuppliersModule, SupplierTeamModule],
  controllers: [
    VipController,
    WholesaleRequestsController,
    AdminWholesalePlansController,
    AdminWholesaleMembershipsController,
  ],
  providers: [
    VipService,
    WholesalePlanService,
    WholesaleMembershipService,
    EntitlementResolver,
  ],
  exports: [
    VipService,
    WholesalePlanService,
    WholesaleMembershipService,
    EntitlementResolver,
  ],
})
export class VipModule {}
