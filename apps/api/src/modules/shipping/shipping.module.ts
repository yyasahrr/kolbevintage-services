import { Module } from "@nestjs/common";
import { ShippingService } from "./shipping.service";
import { ShippingOrchestrator } from "./shipping.orchestrator";
import { ManualShippingProvider } from "./providers/manual-shipping.provider";
import { FakeShippingProvider } from "./providers/fake-shipping.provider";
import { ShippingProviderRegistry } from "./shipping-provider.registry";
import { ShippingBuyerController } from "./shipping-buyer.controller";
import { ShippingSupplierController } from "./shipping-supplier.controller";
import { ShippingAdminController, ShippingProviderWebhookController } from "./shipping-admin.controller";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { InventoryModule } from "../inventory/inventory.module";
import { OrdersModule } from "../orders/orders.module";
import { FinanceModule } from "../finance/finance.module";

/**
 * Phase 4.7.1 — Shipping depends on Finance (fee of a selected quote, financial
 * gate); Finance no longer depends on Shipping (B4). The dependency graph is a
 * DAG again, so no forward reference between the two modules is needed.
 */
@Module({
  imports: [DatabaseModule, AuditModule, SuppliersModule, InventoryModule, OrdersModule, FinanceModule],
  controllers: [ShippingBuyerController, ShippingSupplierController, ShippingAdminController, ShippingProviderWebhookController],
  providers: [ShippingService, ShippingOrchestrator, ManualShippingProvider, FakeShippingProvider, ShippingProviderRegistry],
  exports: [ShippingService, ShippingOrchestrator, ShippingProviderRegistry],
})
export class ShippingModule {}
