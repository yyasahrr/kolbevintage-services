import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SuppliersService } from "./suppliers.service";
import { SuppliersController } from "./suppliers.controller";
import { AuditModule } from "../audit/audit.module";
import { SupplierApprovalOrchestrator } from "../../orchestration/supplier-approval.orchestrator";
import { AdminRbacModule } from "../admin/admin-rbac.module";

@Module({
  imports: [DatabaseModule, AuditModule, AdminRbacModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierApprovalOrchestrator],
  exports: [SuppliersService],
})
export class SuppliersModule {}
