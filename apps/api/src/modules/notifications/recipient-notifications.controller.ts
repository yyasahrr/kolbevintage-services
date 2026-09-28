import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { InAppNotificationService } from "./in-app-notification.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationRecipientType,
} from "@kolbe/database";

export interface UpdatePreferenceDto {
  channel: NotificationChannel;
  category: NotificationCategory;
  eventKey?: string;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

@Controller("notifications")
@Roles("customer", "vip", "supplier", "admin")
export class RecipientNotificationsController {
  constructor(
    @Inject(InAppNotificationService)
    private readonly inAppService: InAppNotificationService,
    @Inject(NotificationPreferenceService)
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  private resolveRecipientType(claims: Claims): NotificationRecipientType {
    if (claims.role === "admin") return "ADMIN_USER";
    if (claims.role === "supplier") return "SUPPLIER_MEMBER";
    if (claims.role === "vip") return "VIP_ACCOUNT_MEMBER";
    return "ACCOUNT_USER";
  }

  // --------------------------------------------------------------------------
  // In-App Inbox (Strictly scoped to authenticated user)
  // --------------------------------------------------------------------------
  @Get("inbox")
  async listInbox(
    @CurrentUser() user: Claims,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const recipientType = this.resolveRecipientType(user);
    const notifications = await this.inAppService.listNotifications(
      recipientType,
      user.sub,
      {
        unreadOnly: unreadOnly === "true",
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      },
    );
    return toApiJson(notifications);
  }

  @Get("unread-count")
  async getUnreadCount(@CurrentUser() user: Claims) {
    const recipientType = this.resolveRecipientType(user);
    const count = await this.inAppService.getUnreadCount(recipientType, user.sub);
    return toApiJson({ unreadCount: count });
  }

  @Patch(":id/read")
  async markAsRead(@Param("id") id: string, @CurrentUser() user: Claims) {
    const recipientType = this.resolveRecipientType(user);
    const updated = await this.inAppService.markRead(id, recipientType, user.sub);
    return toApiJson(updated);
  }

  @Post("mark-all-read")
  async markAllRead(@CurrentUser() user: Claims) {
    const recipientType = this.resolveRecipientType(user);
    const count = await this.inAppService.markAllRead(recipientType, user.sub);
    return toApiJson({ markedCount: count });
  }

  @Delete(":id")
  async archiveNotification(@Param("id") id: string, @CurrentUser() user: Claims) {
    const recipientType = this.resolveRecipientType(user);
    const archived = await this.inAppService.archive(id, recipientType, user.sub);
    return toApiJson(archived);
  }

  // --------------------------------------------------------------------------
  // Recipient Preferences
  // --------------------------------------------------------------------------
  @Get("preferences")
  async getPreferences(@CurrentUser() user: Claims) {
    const recipientType = this.resolveRecipientType(user);
    const prefs = await this.preferenceService.getPreferences(recipientType, user.sub);
    return toApiJson(prefs);
  }

  @Put("preferences")
  async setPreference(
    @Body() dto: UpdatePreferenceDto,
    @CurrentUser() user: Claims,
  ) {
    const recipientType = this.resolveRecipientType(user);
    const updated = await this.preferenceService.updatePreferences(
      recipientType,
      user.sub,
      [
        {
          channel: dto.channel,
          category: dto.category,
          eventKey: dto.eventKey,
          enabled: dto.enabled,
          quietHoursStart: dto.quietHoursStart,
          quietHoursEnd: dto.quietHoursEnd,
        },
      ],
      user.sub,
    );

    return toApiJson(updated);
  }
}
