import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OffersService } from "./offers.service";
import { OffersController } from "./offers.controller";
import { SupplierOfferComplianceController } from "./supplier-offer-compliance.controller";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { CatalogModule } from "../catalog/catalog.module";
import { AuditModule } from "../audit/audit.module";
// Phase 5.13-A: granular admin RBAC guard only — see catalog.module.ts.
import { AdminRbacModule } from "../admin/admin-rbac.module";

@Module({
  imports: [DatabaseModule, SuppliersModule, ComplianceModule, CatalogModule, AuditModule, AdminRbacModule],
  controllers: [OffersController, SupplierOfferComplianceController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
