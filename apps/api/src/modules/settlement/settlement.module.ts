import { Module, forwardRef } from "@nestjs/common";
import { SettlementService } from "./settlement.service";
import { AuditModule } from "../audit/audit.module";
import { SuppliersModule } from "../suppliers/suppliers.module";
import { ComplianceModule } from "../compliance/compliance.module";

@Module({
  imports: [
    AuditModule,
    SuppliersModule,
    forwardRef(() => ComplianceModule),
  ],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
