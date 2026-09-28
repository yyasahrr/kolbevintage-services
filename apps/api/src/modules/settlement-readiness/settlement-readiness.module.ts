import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentsModule } from "../payments/payments.module";
import { ShippingModule } from "../shipping/shipping.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { InvoicingModule } from "../invoicing/invoicing.module";
import { SettlementReadinessService } from "./settlement-readiness.service";
import { SettlementReadinessController } from "./settlement-readiness.controller";

/**
 * Phase 4.7.6 — read-only settlement-readiness module. Owns NO tables; depends on the owner modules
 * of the facts it reads; nothing depends on it (no cycle). It is NOT the Phase 4.8 settlement module.
 */
@Module({
  imports: [DatabaseModule, OrdersModule, PaymentsModule, ShippingModule, ComplianceModule, InvoicingModule],
  controllers: [SettlementReadinessController],
  providers: [SettlementReadinessService],
  exports: [SettlementReadinessService],
})
export class SettlementReadinessModule {}
