import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersRepository } from "./orders.repository";
import { OrdersController } from "./orders.controller";
import { AuditModule } from "../audit/audit.module";
import { VipModule } from "../vip/vip.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PricingModule } from "../pricing/pricing.module";
import { CatalogModule } from "../catalog/catalog.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { OffersModule } from "../offers/offers.module";

@Module({
  imports: [AuditModule, VipModule, InventoryModule, PricingModule, CatalogModule, SuppliersModule, OffersModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
