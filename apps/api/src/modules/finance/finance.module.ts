import { Module, forwardRef } from "@nestjs/common";
import { WholesaleFinanceOrchestrator } from "./wholesale-finance.orchestrator";
import { PaymentsModule } from "../payments/payments.module";
import { OrdersModule } from "../orders/orders.module";
import { ShippingModule } from "../shipping/shipping.module";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { SupplierTeamModule } from "../supplier-team/supplier-team.module";
import { WholesaleFinanceController } from "./wholesale-finance.controller";
import { AdminFinanceController } from "./admin-finance.controller";
import { SupplierFinanceController } from "./supplier-finance.controller";

@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => PaymentsModule), OrdersModule, forwardRef(() => ShippingModule), SuppliersModule, SupplierTeamModule],
  controllers: [WholesaleFinanceController, AdminFinanceController, SupplierFinanceController],
  providers: [WholesaleFinanceOrchestrator],
  exports: [WholesaleFinanceOrchestrator],
})
export class FinanceModule {}
