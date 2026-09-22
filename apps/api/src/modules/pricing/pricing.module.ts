import { Module } from "@nestjs/common";
import { PricingService } from "./pricing.service";
import { RetailPricingService } from "./retail-pricing.service";
import { DatabaseModule } from "../../database/database.module";
import { CatalogModule } from "../catalog/catalog.module";
import { OffersModule } from "../offers/offers.module";

@Module({
  imports: [DatabaseModule, CatalogModule, OffersModule],
  providers: [PricingService, RetailPricingService],
  exports: [PricingService, RetailPricingService],
})
export class PricingModule {}
