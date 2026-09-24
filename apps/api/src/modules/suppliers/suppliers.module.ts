import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { SuppliersService } from "./suppliers.service";
import { SuppliersController } from "./suppliers.controller";
import { AuditModule } from "../audit/audit.module";
import { SupplierApprovalOrchestrator } from "../../orchestration/supplier-approval.orchestrator";
// Phase 5.13-A: only the granular admin RBAC guard is needed here. Importing
// AdminModule would make `suppliers` (and every module that reaches it, e.g.
// compliance → catalog) transitively depend on the VIP/Orders graph.
import { AdminRbacModule } from "../admin/admin-rbac.module";

@Module({
  imports: [DatabaseModule, AuditModule, AdminRbacModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierApprovalOrchestrator],
  exports: [SuppliersService],
})
export class SuppliersModule {}
