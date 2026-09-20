import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { CrmContactService } from "./crm-contact.service";
import { CrmTagService } from "./crm-tag.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [CrmContactService, CrmTagService],
  exports: [CrmContactService, CrmTagService],
})
export class CrmModule {}
