import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../../database/database.module";
import { AuditModule } from "../../audit/audit.module";
import { ComplianceModule } from "../../compliance/compliance.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { OffersModule } from "../../offers/offers.module";
import { PricingModule } from "../../pricing/pricing.module";
import { PromotionsModule } from "../../promotions/promotions.module";
import { RetailCheckoutGuard } from "./retail-checkout.guard";
import { RetailOrdersController } from "./retail-orders.controller";
import { RetailOrdersRepository } from "./retail-orders.repository";
import { RetailOrdersService } from "./retail-orders.service";

/**
 * Phase 5.8 — bounded Retail submodule under Orders (A1).
 *
 * Orders remains the registry owner of both Retail and Wholesale order
 * aggregates, but Retail wires as its own module: the wholesale
 * OrdersModule sits inside the ShippingModule import loop
 * (Orders -> Promotions -> Recovery -> Shipping -> Orders), and Retail
 * must not join that cycle. Depending on Promotions/Compliance here keeps
 * the graph acyclic while code ownership stays under `orders/retail/`.
 */
@Module({
  imports: [DatabaseModule, AuditModule, OffersModule, PricingModule, PromotionsModule, InventoryModule, ComplianceModule],
  controllers: [RetailOrdersController],
  providers: [RetailOrdersService, RetailOrdersRepository, RetailCheckoutGuard],
  exports: [RetailOrdersService, RetailOrdersRepository],
})
export class RetailOrdersModule {}
