import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { SupportCaseService } from "./support-case.service";
import { SupportConversationService } from "./support-conversation.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [SupportCaseService, SupportConversationService],
  exports: [SupportCaseService, SupportConversationService],
})
export class SupportModule {}
