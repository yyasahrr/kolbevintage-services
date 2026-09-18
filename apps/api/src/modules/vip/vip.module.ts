import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { VipService } from "./vip.service";
import { VipController } from "./vip.controller";
import { WholesaleRequestsController } from "./wholesale-requests.controller";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { SupplierTeamModule } from "../supplier-team/supplier-team.module";

@Module({
  imports: [DatabaseModule, AuditModule, SuppliersModule, SupplierTeamModule],
  controllers: [VipController, WholesaleRequestsController],
  providers: [VipService],
  exports: [VipService],
})
export class VipModule {}
