import { Module, forwardRef } from "@nestjs/common";
import { SettlementService } from "./settlement.service";
import { FakePayoutProvider } from "./providers/fake-payout.provider";
import { ManualPayoutProvider } from "./providers/manual-payout.provider";
import { PayoutProviderRegistry } from "./payout-provider.registry";
import { SupplierFinancialAccountController } from "./supplier-financial-account.controller";
import { AdminSettlementController } from "./admin-settlement.controller";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentsModule } from "../payments/payments.module";
import { ShippingModule } from "../shipping/shipping.module";
import { InvoicingModule } from "../invoicing/invoicing.module";
import { DatabaseModule } from "../../database/database.module";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    SuppliersModule,
    forwardRef(() => ComplianceModule),
    OrdersModule,
    PaymentsModule,
    ShippingModule,
    InvoicingModule,
  ],
  controllers: [
    SupplierFinancialAccountController,
    AdminSettlementController,
  ],
  providers: [
    FakePayoutProvider,
    ManualPayoutProvider,
    PayoutProviderRegistry,
    SettlementService,
  ],
  exports: [
    SettlementService,
    FakePayoutProvider,
    ManualPayoutProvider,
    PayoutProviderRegistry,
  ],
})
export class SettlementModule {}
