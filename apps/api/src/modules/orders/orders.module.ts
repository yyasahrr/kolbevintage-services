import { Module } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { OrdersRepository } from "./orders.repository";
import { OrdersController } from "./orders.controller";
import { SupplierOrdersController } from "./supplier-orders.controller";
import { AdminWholesaleOrdersController } from "./admin-orders.controller";
import { AuditModule } from "../audit/audit.module";
import { VipModule } from "../vip/vip.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PricingModule } from "../pricing/pricing.module";
import { CatalogModule } from "../catalog/catalog.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { OffersModule } from "../offers/offers.module";
import { DatabaseModule } from "../../database/database.module";

@Module({
  imports: [AuditModule, VipModule, InventoryModule, PricingModule, CatalogModule, SuppliersModule, OffersModule, DatabaseModule],
  controllers: [OrdersController, SupplierOrdersController, AdminWholesaleOrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
