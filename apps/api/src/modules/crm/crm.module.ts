import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { CrmContactService } from "./crm-contact.service";
import { CrmTagService } from "./crm-tag.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmTaskService } from "./crm-task.service";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    CrmContactService,
    CrmTagService,
    CrmActivityService,
    CrmTaskService,
  ],
  exports: [
    CrmContactService,
    CrmTagService,
    CrmActivityService,
    CrmTaskService,
  ],
})
export class CrmModule {}
