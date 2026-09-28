import { forwardRef, Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AdminModule } from "../admin/admin.module";
import { NotificationEventService } from "./notification-event.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import { NotificationTemplateService } from "./notification-template.service";
import { InAppNotificationService } from "./in-app-notification.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import { NotificationReceiptService } from "./notification-receipt.service";
import { NotificationDispatcherService } from "./notification-dispatcher.service";
import { LegacyMessagingAdapter } from "./legacy-messaging.adapter";
import { FakeEmailProvider, FakeSmsProvider } from "./providers/test-providers";
import { AdminNotificationsController } from "./admin-notifications.controller";
import { NotificationWebhookController } from "./notification-webhook.controller";
import { RecipientNotificationsController } from "./recipient-notifications.controller";

@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => AdminModule)],
  controllers: [
    AdminNotificationsController,
    NotificationWebhookController,
    RecipientNotificationsController,
  ],
  providers: [
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationEventService,
    InAppNotificationService,
    NotificationDeliveryService,
    NotificationReceiptService,
    NotificationDispatcherService,
    LegacyMessagingAdapter,
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
    NotificationDispatcherService,
    LegacyMessagingAdapter,
    FakeSmsProvider,
    FakeEmailProvider,
  ],
})
export class NotificationsModule {}
