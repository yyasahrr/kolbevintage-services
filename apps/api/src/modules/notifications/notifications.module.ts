import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { NotificationTemplateService } from "./notification-template.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import { NotificationEventService } from "./notification-event.service";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule],
  controllers: [],
  providers: [
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationEventService,
  ],
  exports: [
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationEventService,
  ],
})
export class NotificationsModule {}
