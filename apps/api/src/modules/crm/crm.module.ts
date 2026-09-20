import { Module, forwardRef } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { CrmContactService } from "./crm-contact.service";
import { CrmTagService } from "./crm-tag.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmTaskService } from "./crm-task.service";
import { Customer360Service } from "./customer-360.service";
import { AdminCrmController } from "./admin-crm.controller";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    forwardRef(() => AdminModule),
  ],
  controllers: [AdminCrmController],
  providers: [
    CrmContactService,
    CrmTagService,
    CrmActivityService,
    CrmTaskService,
    Customer360Service,
  ],
  exports: [
    CrmContactService,
    CrmTagService,
    CrmActivityService,
    CrmTaskService,
    Customer360Service,
  ],
})
export class CrmModule {}
