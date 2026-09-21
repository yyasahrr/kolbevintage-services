import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService } from "./support-sla.service";
import { SupportOperationsService } from "./support-operations.service";
import { SupportActionService } from "./support-action.service";
import { CustomerSupportController } from "./customer-support.controller";
import { VipSupportController } from "./vip-support.controller";
import { SupplierSupportController } from "./supplier-support.controller";
import { AdminSupportController } from "./admin-support.controller";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule],
  controllers: [
    CustomerSupportController,
    VipSupportController,
    SupplierSupportController,
    AdminSupportController,
  ],
  providers: [
    SupportCaseService,
    SupportConversationService,
    SupportSlaService,
    SupportOperationsService,
    SupportActionService,
  ],
  exports: [
    SupportCaseService,
    SupportConversationService,
    SupportSlaService,
    SupportOperationsService,
    SupportActionService,
  ],
})
export class SupportModule {}
