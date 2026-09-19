import { Module, forwardRef } from "@nestjs/common";
import { ShippingService } from "./shipping.service";
import { ManualShippingProvider } from "./providers/manual-shipping.provider";
import { FakeShippingProvider } from "./providers/fake-shipping.provider";
import { ShippingProviderRegistry } from "./shipping-provider.registry";
import { ShippingBuyerController } from "./shipping-buyer.controller";
import { ShippingSupplierController } from "./shipping-supplier.controller";
import { ShippingAdminController } from "./shipping-admin.controller";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { InventoryModule } from "../inventory/inventory.module";
import { OrdersModule } from "../orders/orders.module";
import { FinanceModule } from "../finance/finance.module";

@Module({
  imports: [DatabaseModule, AuditModule, SuppliersModule, InventoryModule, OrdersModule, forwardRef(() => FinanceModule)],
  controllers: [ShippingBuyerController, ShippingSupplierController, ShippingAdminController],
  providers: [ShippingService, ManualShippingProvider, FakeShippingProvider, ShippingProviderRegistry],
  exports: [ShippingService, ManualShippingProvider, FakeShippingProvider, ShippingProviderRegistry],
})
export class ShippingModule {}
