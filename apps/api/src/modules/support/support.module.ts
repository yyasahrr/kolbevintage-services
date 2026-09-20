import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";
import { SupportSlaService } from "./support-sla.service";
import { SupportOperationsService } from "./support-operations.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    SupportCaseService,
    SupportConversationService,
    SupportSlaService,
    SupportOperationsService,
  ],
  exports: [
    SupportCaseService,
    SupportConversationService,
    SupportSlaService,
    SupportOperationsService,
  ],
})
export class SupportModule {}
