import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { OrdersModule } from "../orders/orders.module";
import { PaymentsModule } from "../payments/payments.module";
import { VipModule } from "../vip/vip.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";
import { InvoicingService } from "./invoicing.service";
import { InvoicingAdminController, InvoicingReadController } from "./invoicing.controller";
import { TaxInvoiceProviderRegistry } from "./tax-invoice-provider.registry";
import { FakeTaxInvoiceProvider } from "./providers/fake-tax-invoice.provider";

/**
 * Phase 4.7.5 — Proforma ≠ Commercial Invoice ≠ Fiscal document.
 * Reads order/payment facts through owner services; owns only invoicing tables.
 */
@Module({
  imports: [DatabaseModule, AuditModule, OrdersModule, PaymentsModule, VipModule, SuppliersModule, ComplianceModule],
  controllers: [InvoicingAdminController, InvoicingReadController],
  providers: [FakeTaxInvoiceProvider, TaxInvoiceProviderRegistry, InvoicingService],
  exports: [InvoicingService, TaxInvoiceProviderRegistry, FakeTaxInvoiceProvider],
})
export class InvoicingModule {}
