import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { NotificationTemplateService } from "./notification-template.service";
import { NotificationDeliveryService } from "./notification-delivery.service";
import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationEventKey,
} from "@kolbe/database";

export interface CreateTemplateDto {
  templateKey: string;
  name: string;
  eventKey: NotificationEventKey;
  channel: NotificationChannel;
  category?: NotificationCategory;
  locale?: string;
  initialVersion: {
    subject?: string;
    body: string;
    variablesSchema?: string[];
  };
}

export interface CreateDraftVersionDto {
  subject?: string;
  body: string;
  variablesSchema?: string[];
}

export interface PublishVersionDto {
  version: number;
}

@Controller("admin/notifications")
@UseGuards(AdminPermissionGuard)
@Roles("admin")
export class AdminNotificationsController {
  constructor(
    @Inject(NotificationTemplateService) private readonly templateService: NotificationTemplateService,
    @Inject(NotificationDeliveryService) private readonly deliveryService: NotificationDeliveryService,
  ) {}

  // --------------------------------------------------------------------------
  // Templates
  // --------------------------------------------------------------------------
  @Get("templates")
  @RequireAdminPermission("notification:template:view")
  async listTemplates(
    @Query("channel") channel?: NotificationChannel,
    @Query("eventKey") eventKey?: NotificationEventKey,
  ) {
    const templates = await this.templateService.listTemplates({ channel, eventKey });
    return toApiJson(templates);
  }

  @Post("templates")
  @RequireAdminPermission("notification:template:manage")
  async createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: Claims) {
    const created = await this.templateService.createTemplate({
      ...dto,
      adminUserId: user.sub,
    });
    return toApiJson(created);
  }

  @Get("templates/:id")
  @RequireAdminPermission("notification:template:view")
  async getTemplate(@Param("id") id: string) {
    const details = await this.templateService.getTemplate(id);
    return toApiJson(details);
  }

  @Post("templates/:id/versions")
  @RequireAdminPermission("notification:template:manage")
  async createDraftVersion(
    @Param("id") templateId: string,
    @Body() dto: CreateDraftVersionDto,
    @CurrentUser() user: Claims,
  ) {
    const draft = await this.templateService.createDraftVersion(templateId, {
      ...dto,
      adminUserId: user.sub,
    });
    return toApiJson(draft);
  }

  @Post("templates/:id/publish")
  @RequireAdminPermission("notification:template:manage")
  async publishVersion(
    @Param("id") templateId: string,
    @Body() dto: PublishVersionDto,
    @CurrentUser() user: Claims,
  ) {
    const published = await this.templateService.publishVersion(
      templateId,
      dto.version,
      user.sub,
    );
    return toApiJson(published);
  }

  // --------------------------------------------------------------------------
  // Deliveries & Outbox
  // --------------------------------------------------------------------------
  @Get("deliveries")
  @RequireAdminPermission("notification:outbox:view")
  async listDeliveries(
    @Query("status") status?: NotificationDeliveryStatus,
    @Query("channel") channel?: NotificationChannel,
    @Query("recipientId") recipientId?: string,
    @Query("eventId") eventId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const rows = await this.deliveryService.listDeliveries({
      status,
      channel,
      recipientId,
      eventId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toApiJson(rows);
  }

  @Get("deliveries/:id")
  @RequireAdminPermission("notification:outbox:view")
  async getDelivery(@Param("id") id: string) {
    const details = await this.deliveryService.getDeliveryWithAttempts(id);
    return toApiJson(details);
  }

  @Post("deliveries/:id/retry")
  @RequireAdminPermission("notification:outbox:retry")
  async retryDelivery(@Param("id") id: string, @CurrentUser() user: Claims) {
    const retried = await this.deliveryService.retryDelivery(id, user.sub);
    return toApiJson(retried);
  }

  @Post("deliveries/:id/cancel")
  @RequireAdminPermission("notification:outbox:retry")
  async cancelDelivery(@Param("id") id: string, @CurrentUser() user: Claims) {
    const cancelled = await this.deliveryService.cancelDelivery(id, user.sub);
    return toApiJson(cancelled);
  }

  // --------------------------------------------------------------------------
  // Providers & Safe Status (Zero Secrets Exposed!)
  // --------------------------------------------------------------------------
  @Get("providers")
  @RequireAdminPermission("notification:provider:view")
  async listProviders() {
    // Return sanitized provider summary without exposing any API keys or webhook secrets
    const sms = this.deliveryService.getSmsProvider();
    const email = this.deliveryService.getEmailProvider();

    const providers = [
      {
        providerKey: sms.providerKey,
        channel: "SMS",
        status: "ACTIVE",
        hasWebhookVerification: typeof sms.verifyWebhookSignature === "function",
      },
      {
        providerKey: email.providerKey,
        channel: "EMAIL",
        status: "ACTIVE",
        hasWebhookVerification: typeof email.verifyWebhookSignature === "function",
      },
    ];

    return toApiJson(providers);
  }
}
