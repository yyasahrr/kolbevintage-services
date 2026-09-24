import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminPermissionGuard } from "./admin-rbac.guard";
import { AdminRbacService } from "./admin-rbac.service";

/** Narrow authorization boundary for domains that only need admin RBAC. */
@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [AdminRbacService, AdminPermissionGuard],
  exports: [AdminRbacService, AdminPermissionGuard],
})
export class AdminRbacModule {}
