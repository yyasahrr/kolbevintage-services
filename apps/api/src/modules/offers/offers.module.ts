import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OffersService } from "./offers.service";
import { OffersController } from "./offers.controller";
import { SupplierOfferComplianceController } from "./supplier-offer-compliance.controller";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";

@Module({
  imports: [DatabaseModule, SuppliersModule, ComplianceModule],
  controllers: [OffersController, SupplierOfferComplianceController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
