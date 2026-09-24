import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OffersService } from "./offers.service";
import { OffersController } from "./offers.controller";
import { SupplierOfferComplianceController } from "./supplier-offer-compliance.controller";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { CatalogModule } from "../catalog/catalog.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, SuppliersModule, ComplianceModule, CatalogModule, AuditModule],
  controllers: [OffersController, SupplierOfferComplianceController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
