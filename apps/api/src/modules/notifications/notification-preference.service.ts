import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  consentEvent,
  notificationPreference,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationRecipientType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  NotificationMarketingConsentRequiredError,
  NotificationPreferenceForbiddenError,
} from "./notifications.errors";
import crypto from "node:crypto";

export interface PreferenceItemInput {
  category: NotificationCategory;
  channel: NotificationChannel;
  eventKey?: string;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

@Injectable()
export class NotificationPreferenceService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Get all preferences for a given recipient.
   */
  public async getPreferences(
    recipientType: NotificationRecipientType,
    recipientId: string,
  ) {
    return this.db
      .select()
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.recipientType, recipientType),
          eq(notificationPreference.recipientId, recipientId),
        ),
      );
  }

  /**
   * Set or update preferences for a recipient.
   * Enforces that SECURITY notifications cannot be disabled.
   */
  public async updatePreferences(
    recipientType: NotificationRecipientType,
    recipientId: string,
    items: PreferenceItemInput[],
    actorId?: string,
  ) {
    for (const item of items) {
      if (item.category === "SECURITY" && !item.enabled) {
        throw new NotificationPreferenceForbiddenError(
          "Mandatory security notifications cannot be disabled by user preference.",
        );
      }
    }

    const updated = await this.db.transaction(async (tx) => {
      const results = [];
      for (const item of items) {
        const eventKey = item.eventKey ?? "*";
        const id = `nprf_${crypto.randomUUID()}`;

        const [saved] = await tx
          .insert(notificationPreference)
          .values({
            id,
            recipientType,
            recipientId,
            category: item.category,
            eventKey,
            channel: item.channel,
            enabled: item.enabled,
            quietHoursStart: item.quietHoursStart ?? null,
            quietHoursEnd: item.quietHoursEnd ?? null,
          })
          .onConflictDoUpdate({
            target: [
              notificationPreference.recipientType,
              notificationPreference.recipientId,
              notificationPreference.category,
              notificationPreference.eventKey,
              notificationPreference.channel,
            ],
            set: {
              enabled: item.enabled,
              quietHoursStart: item.quietHoursStart ?? null,
              quietHoursEnd: item.quietHoursEnd ?? null,
              updatedAt: new Date(),
            },
          })
          .returning();

        results.push(saved);
      }
      return results;
    });

    if (actorId) {
      await this.audit.record({
        action: "notification_preference.updated",
        actorId,
        actorRole: "user",
        entityId: recipientId,
        entityType: "notification_preference",
        metadata: {
          recipientType,
          itemsCount: items.length,
        },
      });
    }

    return updated;
  }

  /**
   * Check if a recipient has authoritative compliance consent for marketing on the requested channel.
   */
  public async hasMarketingConsent(userId: string, channel: NotificationChannel): Promise<boolean> {
    const purpose =
      channel === "EMAIL"
        ? "MARKETING_EMAIL"
        : channel === "SMS"
          ? "MARKETING_SMS"
          : "MARKETING_PUSH";

    const rows = await this.db
      .select({
        eventType: consentEvent.eventType,
      })
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.userId, userId),
          eq(consentEvent.purpose, purpose),
        ),
      )
      .orderBy(desc(consentEvent.occurredAt))
      .limit(1);

    if (!rows.length) {
      return false; // Default opt-in MUST be false!
    }

    return rows[0].eventType === "granted";
  }

  /**
   * Verify if current time is within quiet hours.
   */
  public isWithinQuietHours(
    start: string | null | undefined,
    end: string | null | undefined,
    now = new Date(),
  ): boolean {
    if (!start || !end) return false;

    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return false;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight (e.g. 22:00 to 08:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  /**
   * Determine whether a notification should be delivered to a recipient
   * via a specific channel for an event category.
   */
  public async isDeliveryAllowed(params: {
    recipientType: NotificationRecipientType;
    recipientId: string;
    category: NotificationCategory;
    eventKey: string;
    channel: NotificationChannel;
    now?: Date;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const { recipientType, recipientId, category, eventKey, channel, now = new Date() } = params;

    // 1. Mandatory SECURITY notifications are always delivered
    if (category === "SECURITY") {
      return { allowed: true };
    }

    // 2. MARKETING notifications require authoritative Compliance consent
    if (category === "MARKETING") {
      const consented = await this.hasMarketingConsent(recipientId, channel);
      if (!consented) {
        return {
          allowed: false,
          reason: `Recipient lacks active marketing compliance consent for ${channel}.`,
        };
      }
    }

    // 3. Check specific event preference first, then category preference
    const prefs = await this.db
      .select()
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.recipientType, recipientType),
          eq(notificationPreference.recipientId, recipientId),
          eq(notificationPreference.category, category),
          eq(notificationPreference.channel, channel),
        ),
      );

    const specificPref = prefs.find((p) => p.eventKey === eventKey);
    const categoryPref = prefs.find((p) => p.eventKey === "*");

    const effectivePref = specificPref ?? categoryPref;

    if (effectivePref) {
      if (!effectivePref.enabled) {
        return {
          allowed: false,
          reason: `Recipient disabled ${channel} notifications for ${category}.`,
        };
      }

      // Check quiet hours
      if (this.isWithinQuietHours(effectivePref.quietHoursStart, effectivePref.quietHoursEnd, now)) {
        return {
          allowed: false,
          reason: `Current time is within recipient quiet hours (${effectivePref.quietHoursStart} - ${effectivePref.quietHoursEnd}).`,
        };
      }
    }

    return { allowed: true };
  }
}
