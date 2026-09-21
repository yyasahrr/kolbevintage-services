import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationEventService } from "./notification-event.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import { NotificationTemplateService } from "./notification-template.service";
import { InAppNotificationService } from "./in-app-notification.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationReceiptService } from "./notification-receipt.service";
import { FakeEmailProvider, FakeSmsProvider } from "./providers/test-providers";

@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationEventService,
    InAppNotificationService,
    NotificationDeliveryService,
    NotificationReceiptService,
    FakeSmsProvider,
    FakeEmailProvider,
  ],
  exports: [
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationEventService,
    InAppNotificationService,
    NotificationDeliveryService,
    NotificationReceiptService,
    FakeSmsProvider,
    FakeEmailProvider,
  ],
})
export class NotificationsModule {}
