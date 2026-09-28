import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ShippingModule } from "../shipping/shipping.module";
import { PaymentsModule } from "../payments/payments.module";
import { SettlementModule } from "../settlement/settlement.module";
import { JobLockService } from "./job-lock.service";
import { RecoveryService } from "./recovery.service";
import { RecoveryScheduler } from "./recovery.scheduler";
import { RecoveryController } from "./recovery.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    InventoryModule,
    ShippingModule,
    PaymentsModule,
    SettlementModule,
  ],
  controllers: [RecoveryController],
  providers: [JobLockService, RecoveryService, RecoveryScheduler],
  exports: [JobLockService, RecoveryService, RecoveryScheduler],
})
export class RecoveryModule {}
