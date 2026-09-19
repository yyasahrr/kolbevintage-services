import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PaymentsRepository } from "./payments.repository";
import { ManualTransferProvider } from "./manual-transfer.provider";
import { FakePaymentProvider } from "./providers/fake-payment.provider";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentProviderEventService } from "./payment-provider-event.service";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    PaymentsService,
    PaymentsRepository,
    ManualTransferProvider,
    FakePaymentProvider,
    PaymentProviderRegistry,
    PaymentProviderEventService,
  ],
  exports: [
    PaymentsService,
    PaymentsRepository,
    ManualTransferProvider,
    FakePaymentProvider,
    PaymentProviderRegistry,
    PaymentProviderEventService,
  ],
})
export class PaymentsModule {}
