import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../../database/database.module";
import { AuditModule } from "../../audit/audit.module";
import { ComplianceModule } from "../../compliance/compliance.module";
import { InventoryModule } from "../../inventory/inventory.module";
import { NotificationsModule } from "../../notifications/notifications.module";
import { OffersModule } from "../../offers/offers.module";
import { PaymentsModule } from "../../payments/payments.module";
import { PricingModule } from "../../pricing/pricing.module";
import { PromotionsModule } from "../../promotions/promotions.module";
import { ShippingModule } from "../../shipping/shipping.module";
import { RetailCheckoutGuard } from "./retail-checkout.guard";
import { RetailNotificationRelayService } from "./retail-notification-relay.service";
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
 * Phase 5.8-B adds Payments/Notifications the same way (both are leaves off
 * Database/Audit/Admin — neither imports Orders back). Phase 5.8-C adds
 * Shipping the same way again: Retail consumes ShippingService plus the
 * provider registry, Shipping never imports Retail back (delivery fans out
 * inside Retail orchestration, never inside ShippingService).
 */
@Module({
  imports: [DatabaseModule, AuditModule, OffersModule, PricingModule, PromotionsModule, InventoryModule, ComplianceModule, PaymentsModule, NotificationsModule, ShippingModule],
  controllers: [RetailOrdersController],
  providers: [RetailOrdersService, RetailOrdersRepository, RetailCheckoutGuard, RetailNotificationRelayService],
  exports: [RetailOrdersService, RetailOrdersRepository, RetailNotificationRelayService],
})
export class RetailOrdersModule {}
