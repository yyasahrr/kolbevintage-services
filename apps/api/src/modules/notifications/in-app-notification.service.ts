import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  inAppNotification,
  type NotificationRecipientType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import crypto from "node:crypto";

export interface CreateInAppNotificationInput {
  recipientType: NotificationRecipientType;
  recipientId: string;
  title: string;
  body: string;
  deliveryId?: string | null;
  eventId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  actionUrl?: string | null;
}

export interface ListInAppOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class InAppNotificationService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  /**
   * Create an in-app notification record.
   */
  public async createNotification(input: CreateInAppNotificationInput) {
    const id = `notif_${crypto.randomUUID()}`;
    const [created] = await this.db
      .insert(inAppNotification)
      .values({
        id,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        deliveryId: input.deliveryId ?? null,
        eventId: input.eventId ?? null,
        title: input.title,
        body: input.body,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        actionUrl: input.actionUrl ?? null,
      })
      .returning();

    return created;
  }

  /**
   * List in-app notifications for authenticated recipient.
   * Cross-user IDOR is prevented by strict server-side scoping.
   */
  public async listNotifications(
    recipientType: NotificationRecipientType,
    recipientId: string,
    options?: ListInAppOptions,
  ) {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);

    const conditions = [
      eq(inAppNotification.recipientType, recipientType),
      eq(inAppNotification.recipientId, recipientId),
      isNull(inAppNotification.archivedAt),
    ];

    if (options?.unreadOnly) {
      conditions.push(isNull(inAppNotification.readAt));
    }

    const rows = await this.db
      .select()
      .from(inAppNotification)
      .where(and(...conditions))
      .orderBy(desc(inAppNotification.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  /**
   * Factual count of unread notifications for recipient.
   */
  public async getUnreadCount(
    recipientType: NotificationRecipientType,
    recipientId: string,
  ): Promise<number> {
    const [res] = await this.db
      .select({ count: sql<string>`count(*)::text` })
      .from(inAppNotification)
      .where(
        and(
          eq(inAppNotification.recipientType, recipientType),
          eq(inAppNotification.recipientId, recipientId),
          isNull(inAppNotification.readAt),
          isNull(inAppNotification.archivedAt),
        ),
      );

    return Number(res?.count ?? 0);
  }

  /**
   * Mark a single notification as read.
   * Strictly scoped to authenticated recipient (returns null if not owned).
   */
  public async markRead(
    notificationId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
  ) {
    const [updated] = await this.db
      .update(inAppNotification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(inAppNotification.id, notificationId),
          eq(inAppNotification.recipientType, recipientType),
          eq(inAppNotification.recipientId, recipientId),
          isNull(inAppNotification.readAt),
        ),
      )
      .returning();

    return updated ?? null;
  }

  /**
   * Mark all notifications as read for recipient.
   */
  public async markAllRead(
    recipientType: NotificationRecipientType,
    recipientId: string,
  ): Promise<number> {
    const updated = await this.db
      .update(inAppNotification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(inAppNotification.recipientType, recipientType),
          eq(inAppNotification.recipientId, recipientId),
          isNull(inAppNotification.readAt),
        ),
      )
      .returning({ id: inAppNotification.id });

    return updated.length;
  }

  /**
   * Archive a notification.
   */
  public async archive(
    notificationId: string,
    recipientType: NotificationRecipientType,
    recipientId: string,
  ) {
    const [archived] = await this.db
      .update(inAppNotification)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(inAppNotification.id, notificationId),
          eq(inAppNotification.recipientType, recipientType),
          eq(inAppNotification.recipientId, recipientId),
        ),
      )
      .returning();

    return archived ?? null;
  }
}
