import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PaymentsRepository } from "./payments.repository";
import { ManualTransferProvider } from "./manual-transfer.provider";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [PaymentsService, PaymentsRepository, ManualTransferProvider],
  exports: [PaymentsService, PaymentsRepository, ManualTransferProvider],
})
export class PaymentsModule {}
