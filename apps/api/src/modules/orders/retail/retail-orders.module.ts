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
import { SupportModule } from "../../support/support.module";
import { RetailCheckoutGuard } from "./retail-checkout.guard";
import { AdminRetailOpsController } from "./admin-retail-ops.controller";
import { RetailNotificationRelayService } from "./retail-notification-relay.service";
import { RetailOrdersController } from "./retail-orders.controller";
import { RetailOrdersRepository } from "./retail-orders.repository";
import { RetailOrdersService } from "./retail-orders.service";
import { RetailReturnsRepository } from "./retail-returns.repository";
import { RetailReturnsService } from "./retail-returns.service";

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
 * Phase 5.9-B adds Support the same way once more: every filed return opens
 * a support case in the same transaction. SupportModule is a leaf off
 * Database/Audit/Admin and never imports Retail back (verified by the
 * architecture-freeze acyclicity guard, like all edges above).
 */
@Module({
  imports: [DatabaseModule, AuditModule, OffersModule, PricingModule, PromotionsModule, InventoryModule, ComplianceModule, PaymentsModule, NotificationsModule, ShippingModule, SupportModule],
  controllers: [RetailOrdersController, AdminRetailOpsController],
  providers: [RetailOrdersService, RetailOrdersRepository, RetailCheckoutGuard, RetailNotificationRelayService, RetailReturnsService, RetailReturnsRepository],
  exports: [RetailOrdersService, RetailOrdersRepository, RetailNotificationRelayService, RetailReturnsService, RetailReturnsRepository],
})
export class RetailOrdersModule {}
