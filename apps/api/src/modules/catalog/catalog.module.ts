import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { CatalogService } from "./catalog.service";
import { CatalogController } from "./catalog.controller";
import { ComplianceModule } from "../compliance/compliance.module";
// Phase 5.13-A: the granular admin RBAC guard, not the whole admin graph —
// importing AdminModule here would give `catalog` a transitive Orders
// dependency (AdminModule → VipModule → wholesale_order_request), which the
// Phase 3.10 architecture freeze forbids.
import { AdminRbacModule } from "../admin/admin-rbac.module";

@Module({
  imports: [DatabaseModule, ComplianceModule, AdminRbacModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
