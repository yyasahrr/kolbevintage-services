import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import {
  inAppNotification,
  notificationDelivery,
  notificationDeliveryAttempt,
  notificationEvent,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationRecipientType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  NotificationDeliveryNotFoundError,
  NotificationProviderUnavailableError,
  NotificationRecipientNotFoundError,
  NotificationTemplateNotFoundError,
} from "./notifications.errors";
import { NotificationEventService } from "./notification-event.service";
import { NotificationPreferenceService } from "./notification-preference.service";
import { NotificationTemplateService } from "./notification-template.service";
import { InAppNotificationService } from "./in-app-notification.service";
import {
  EmailProvider,
  SmsProvider,
} from "./notification-provider.interface";
import { FakeEmailProvider, FakeSmsProvider } from "./providers/test-providers";

export function maskDestination(dest: string): string {
  if (!dest) return "***";
  if (dest.includes("@")) {
    const [local, domain] = dest.split("@");
    const maskedLocal =
      local.length <= 2 ? `${local[0] ?? "*"}***` : `${local.slice(0, 2)}***${local.slice(-1)}`;
    return `${maskedLocal}@${domain}`;
  }
  const digits = dest.replace(/\D/g, "");
  if (digits.length >= 7) {
    return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
  }
  return "***";
}

export function hashDestination(dest: string): string {
  return crypto.createHash("sha256").update(dest.trim().toLowerCase()).digest("hex");
}

export interface EnqueueDeliveryInput {
  eventId: string;
  recipientType: NotificationRecipientType;
  recipientId: string;
  channel: NotificationChannel;
  category: NotificationCategory;
  scheduledAt?: Date;
  maxAttempts?: number;
}

@Injectable()
export class NotificationDeliveryService {
  private smsProvider: SmsProvider;
  private emailProvider: EmailProvider;

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationEventService) private readonly eventService: NotificationEventService,
    @Inject(NotificationPreferenceService) private readonly preferenceService: NotificationPreferenceService,
    @Inject(NotificationTemplateService) private readonly templateService: NotificationTemplateService,
    @Inject(InAppNotificationService) private readonly inAppService: InAppNotificationService,
    @Inject(FakeSmsProvider) fakeSms: FakeSmsProvider,
    @Inject(FakeEmailProvider) fakeEmail: FakeEmailProvider,
  ) {
    this.smsProvider = fakeSms;
    this.emailProvider = fakeEmail;
  }

  public setSmsProvider(provider: SmsProvider) {
    this.smsProvider = provider;
  }

  public setEmailProvider(provider: EmailProvider) {
    this.emailProvider = provider;
  }

  public getSmsProvider(): SmsProvider {
    return this.smsProvider;
  }

  public getEmailProvider(): EmailProvider {
    return this.emailProvider;
  }

  /**
   * Enqueue a notification delivery from an authoritative notification event.
   */
  public async enqueueDelivery(input: EnqueueDeliveryInput) {
    const event = await this.eventService.getEvent(input.eventId);
    if (!event) {
      throw new NotificationDeliveryNotFoundError(`Event '${input.eventId}' not found.`);
    }

    const deliveryId = `ndel_${crypto.randomUUID()}`;
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${event.id}:${input.recipientType}:${input.recipientId}:${input.channel}`)
      .digest("hex");

    // Check if delivery already exists with this idempotency key
    const [existing] = await this.db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      return existing;
    }

    // Check recipient preferences & marketing consent
    const allowedCheck = await this.preferenceService.isDeliveryAllowed({
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      category: input.category,
      eventKey: event.eventKey,
      channel: input.channel,
      now: input.scheduledAt ?? new Date(),
    });

    if (!allowedCheck.allowed) {
      const [suppressed] = await this.db
        .insert(notificationDelivery)
        .values({
          id: deliveryId,
          eventId: event.id,
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          channel: input.channel,
          renderedBody: "[SUPPRESSED BY PREFERENCE OR POLICY]",
          destinationMasked: "***",
          status: "SUPPRESSED",
          idempotencyKey,
          failureCategory: "PREFERENCE_SUPPRESSED",
          failureDetail: allowedCheck.reason ?? "Delivery suppressed by preference policy",
        })
        .returning();

      return suppressed;
    }

    // Resolve authoritative recipient destination
    const destination = await this.eventService.resolveRecipient(
      input.recipientType,
      input.recipientId,
    );

    let rawDestination = "";
    if (input.channel === "SMS") {
      rawDestination = destination.phone ?? "";
      if (!rawDestination) {
        throw new NotificationRecipientNotFoundError(
          input.recipientType,
          `${input.recipientId} (missing phone number for SMS)`,
        );
      }
    } else if (input.channel === "EMAIL") {
      rawDestination = destination.email ?? "";
      if (!rawDestination) {
        throw new NotificationRecipientNotFoundError(
          input.recipientType,
          `${input.recipientId} (missing email address for EMAIL)`,
        );
      }
    } else if (input.channel === "IN_APP") {
      rawDestination = destination.userId ?? input.recipientId;
    }

    const maskedDestination = maskDestination(rawDestination);
    const destHash = hashDestination(rawDestination);

    // Resolve template
    const templateMatch = await this.templateService.getActivePublishedVersion(
      event.eventKey,
      input.channel,
    );

    if (!templateMatch) {
      throw new NotificationTemplateNotFoundError(
        `Active published template for event '${event.eventKey}' on channel '${input.channel}' was not found.`,
      );
    }

    // Render template
    const payload = (event.payload as Record<string, unknown>) ?? {};
    const variables: Record<string, unknown> = {
      ...payload,
      customer_name: destination.displayName ?? "مشتری گرامی",
    };

    const rendered = this.templateService.render(
      templateMatch.version.subject,
      templateMatch.version.body,
      variables,
      input.channel,
    );

    // For IN_APP: immediately deliver to in_app_notification inbox
    if (input.channel === "IN_APP") {
      return await this.db.transaction(async (tx) => {
        const [del] = await tx
          .insert(notificationDelivery)
          .values({
            id: deliveryId,
            eventId: event.id,
            recipientType: input.recipientType,
            recipientId: input.recipientId,
            channel: input.channel,
            templateVersionId: templateMatch.version.id,
            renderedSubject: rendered.subject ?? null,
            renderedBody: rendered.body,
            destinationMasked: maskedDestination,
            destinationHash: destHash,
            status: "DELIVERED",
            deliveredAt: new Date(),
            idempotencyKey,
          })
          .returning();

        await tx.insert(notificationDeliveryAttempt).values({
          id: `ndat_${crypto.randomUUID()}`,
          deliveryId: del.id,
          attemptNumber: 1,
          providerKey: "in_app_internal",
          startedAt: new Date(),
          finishedAt: new Date(),
          status: "SUCCESS",
          externalMessageId: del.id,
        });

        await tx.insert(inAppNotification).values({
          id: `notif_${crypto.randomUUID()}`,
          recipientType: input.recipientType,
          recipientId: input.recipientId,
          deliveryId: del.id,
          eventId: event.id,
          title: rendered.subject ?? templateMatch.template.name,
          body: rendered.body,
          relatedEntityType: event.sourceEntityType,
          relatedEntityId: event.sourceEntityId,
        });

        return del;
      });
    }

    // For SMS & EMAIL: store in outbox as PENDING
    const [created] = await this.db
      .insert(notificationDelivery)
      .values({
        id: deliveryId,
        eventId: event.id,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        channel: input.channel,
        templateVersionId: templateMatch.version.id,
        renderedSubject: rendered.subject ?? null,
        renderedBody: rendered.body,
        destinationMasked: maskedDestination,
        destinationHash: destHash,
        status: "PENDING",
        scheduledAt: input.scheduledAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
        idempotencyKey,
      })
      .returning();

    return created;
  }

  /**
   * Process a single delivery outbox record.
   * Internal execution with bounded retries and immutable attempts.
   */
  public async processDelivery(deliveryId: string) {
    const [delivery] = await this.db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.id, deliveryId))
      .limit(1);

    if (!delivery) {
      throw new NotificationDeliveryNotFoundError(deliveryId);
    }

    if (
      delivery.status === "SENT" ||
      delivery.status === "DELIVERED" ||
      delivery.status === "CANCELLED" ||
      delivery.status === "SUPPRESSED"
    ) {
      return delivery;
    }

    // Mark as PROCESSING
    await this.db
      .update(notificationDelivery)
      .set({
        status: "PROCESSING",
        firstAttemptAt: delivery.firstAttemptAt ?? new Date(),
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(notificationDelivery.id, deliveryId));

    // Resolve raw destination from authoritative server-side record
    const recipient = await this.eventService.resolveRecipient(
      delivery.recipientType as NotificationRecipientType,
      delivery.recipientId,
    );

    const startedAt = new Date();
    const attemptNumber = delivery.attemptCount + 1;
    let providerKey = "unknown";

    try {
      if (delivery.channel === "SMS") {
        providerKey = this.smsProvider.providerKey;
        const res = await this.smsProvider.send({
          to: recipient.phone ?? "",
          body: delivery.renderedBody,
          idempotencyKey: delivery.idempotencyKey,
          metadata: { deliveryId: delivery.id },
        });

        const finishedAt = new Date();

        if (res.success) {
          // Record success attempt
          await this.db.insert(notificationDeliveryAttempt).values({
            id: `ndat_${crypto.randomUUID()}`,
            deliveryId: delivery.id,
            attemptNumber,
            providerKey,
            startedAt,
            finishedAt,
            status: "SUCCESS",
            externalMessageId: res.externalMessageId ?? null,
          });

          const [updated] = await this.db
            .update(notificationDelivery)
            .set({
              status: "SENT",
              providerKey,
              providerMessageId: res.externalMessageId ?? null,
              attemptCount: attemptNumber,
              updatedAt: new Date(),
            })
            .where(eq(notificationDelivery.id, delivery.id))
            .returning();

          return updated;
        } else {
          // Failure handling
          const isRetryable = res.isRetryable ?? false;
          const attemptStatus = isRetryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR";

          await this.db.insert(notificationDeliveryAttempt).values({
            id: `ndat_${crypto.randomUUID()}`,
            deliveryId: delivery.id,
            attemptNumber,
            providerKey,
            startedAt,
            finishedAt,
            status: attemptStatus,
            errorCategory: res.errorCategory ?? "UNKNOWN_ERROR",
            errorDetail: res.errorDetail ?? null,
            retryAfterSeconds: res.retryAfterSeconds ?? null,
          });

          if (isRetryable && attemptNumber < delivery.maxAttempts) {
            const backoffMs =
              (res.retryAfterSeconds ? res.retryAfterSeconds * 1000 : Math.pow(2, attemptNumber) * 1000);
            const nextRetryAt = new Date(Date.now() + backoffMs);

            const [updated] = await this.db
              .update(notificationDelivery)
              .set({
                status: "FAILED_RETRYABLE",
                attemptCount: attemptNumber,
                nextRetryAt,
                failureCategory: res.errorCategory ?? "RETRYABLE_ERROR",
                failureDetail: res.errorDetail ?? null,
                updatedAt: new Date(),
              })
              .where(eq(notificationDelivery.id, delivery.id))
              .returning();

            return updated;
          } else {
            const [updated] = await this.db
              .update(notificationDelivery)
              .set({
                status: "FAILED_PERMANENT",
                attemptCount: attemptNumber,
                failedAt: new Date(),
                failureCategory: res.errorCategory ?? "PERMANENT_ERROR",
                failureDetail: res.errorDetail ?? null,
                updatedAt: new Date(),
              })
              .where(eq(notificationDelivery.id, delivery.id))
              .returning();

            return updated;
          }
        }
      } else if (delivery.channel === "EMAIL") {
        providerKey = this.emailProvider.providerKey;
        const res = await this.emailProvider.send({
          to: recipient.email ?? "",
          subject: delivery.renderedSubject ?? "Kolbe Notification",
          body: delivery.renderedBody,
          idempotencyKey: delivery.idempotencyKey,
          metadata: { deliveryId: delivery.id },
        });

        const finishedAt = new Date();

        if (res.success) {
          await this.db.insert(notificationDeliveryAttempt).values({
            id: `ndat_${crypto.randomUUID()}`,
            deliveryId: delivery.id,
            attemptNumber,
            providerKey,
            startedAt,
            finishedAt,
            status: "SUCCESS",
            externalMessageId: res.externalMessageId ?? null,
          });

          const [updated] = await this.db
            .update(notificationDelivery)
            .set({
              status: "SENT",
              providerKey,
              providerMessageId: res.externalMessageId ?? null,
              attemptCount: attemptNumber,
              updatedAt: new Date(),
            })
            .where(eq(notificationDelivery.id, delivery.id))
            .returning();

          return updated;
        } else {
          const isRetryable = res.isRetryable ?? false;
          const attemptStatus = isRetryable ? "RETRYABLE_ERROR" : "PERMANENT_ERROR";

          await this.db.insert(notificationDeliveryAttempt).values({
            id: `ndat_${crypto.randomUUID()}`,
            deliveryId: delivery.id,
            attemptNumber,
            providerKey,
            startedAt,
            finishedAt,
            status: attemptStatus,
            errorCategory: res.errorCategory ?? "UNKNOWN_ERROR",
            errorDetail: res.errorDetail ?? null,
            retryAfterSeconds: res.retryAfterSeconds ?? null,
          });

          if (isRetryable && attemptNumber < delivery.maxAttempts) {
            const backoffMs =
              (res.retryAfterSeconds ? res.retryAfterSeconds * 1000 : Math.pow(2, attemptNumber) * 1000);
            const nextRetryAt = new Date(Date.now() + backoffMs);

            const [updated] = await this.db
              .update(notificationDelivery)
              .set({
                status: "FAILED_RETRYABLE",
                attemptCount: attemptNumber,
                nextRetryAt,
                failureCategory: res.errorCategory ?? "RETRYABLE_ERROR",
                failureDetail: res.errorDetail ?? null,
                updatedAt: new Date(),
              })
              .where(eq(notificationDelivery.id, delivery.id))
              .returning();

            return updated;
          } else {
            const [updated] = await this.db
              .update(notificationDelivery)
              .set({
                status: "FAILED_PERMANENT",
                attemptCount: attemptNumber,
                failedAt: new Date(),
                failureCategory: res.errorCategory ?? "PERMANENT_ERROR",
                failureDetail: res.errorDetail ?? null,
                updatedAt: new Date(),
              })
              .where(eq(notificationDelivery.id, delivery.id))
              .returning();

            return updated;
          }
        }
      } else {
        throw new NotificationProviderUnavailableError(delivery.channel, "Unsupported channel");
      }
    } catch (err) {
      const finishedAt = new Date();
      const errorMessage = err instanceof Error ? err.message : String(err);

      await this.db.insert(notificationDeliveryAttempt).values({
        id: `ndat_${crypto.randomUUID()}`,
        deliveryId: delivery.id,
        attemptNumber,
        providerKey,
        startedAt,
        finishedAt,
        status: "RETRYABLE_ERROR",
        errorCategory: "EXCEPTION",
        errorDetail: errorMessage,
      });

      const nextRetryAt = new Date(Date.now() + Math.pow(2, attemptNumber) * 1000);
      const [updated] = await this.db
        .update(notificationDelivery)
        .set({
          status: attemptNumber < delivery.maxAttempts ? "FAILED_RETRYABLE" : "FAILED_PERMANENT",
          attemptCount: attemptNumber,
          nextRetryAt,
          failureCategory: "EXCEPTION",
          failureDetail: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(notificationDelivery.id, delivery.id))
        .returning();

      return updated;
    }
  }

  /**
   * Process all pending or retryable deliveries currently due in the outbox.
   */
  public async processOutboxBatch(batchSize = 20) {
    const now = new Date();

    // Query due deliveries
    const due = await this.db
      .select({ id: notificationDelivery.id })
      .from(notificationDelivery)
      .where(
        and(
          lte(notificationDelivery.scheduledAt, now),
          or(
            eq(notificationDelivery.status, "PENDING"),
            and(
              eq(notificationDelivery.status, "FAILED_RETRYABLE"),
              lte(notificationDelivery.nextRetryAt, now),
            ),
          ),
        ),
      )
      .orderBy(asc(notificationDelivery.scheduledAt))
      .limit(batchSize);

    const processed = [];
    for (const item of due) {
      const res = await this.processDelivery(item.id);
      processed.push(res);
    }

    return processed;
  }

  /**
   * Admin action: retry an eligible failed delivery.
   */
  public async retryDelivery(deliveryId: string, adminUserId: string) {
    const [delivery] = await this.db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.id, deliveryId))
      .limit(1);

    if (!delivery) {
      throw new NotificationDeliveryNotFoundError(deliveryId);
    }

    if (
      delivery.status !== "FAILED_RETRYABLE" &&
      delivery.status !== "FAILED_PERMANENT"
    ) {
      throw new Error(`Only failed deliveries can be retried (current status: ${delivery.status})`);
    }

    const [updated] = await this.db
      .update(notificationDelivery)
      .set({
        status: "PENDING",
        nextRetryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(notificationDelivery.id, deliveryId))
      .returning();

    await this.audit.record({
      action: "notification_delivery.retried",
      actorId: adminUserId,
      actorRole: "admin",
      entityId: deliveryId,
      entityType: "notification_delivery",
      metadata: { previousStatus: delivery.status },
    });

    return updated;
  }

  /**
   * Admin action: cancel a pending or retryable delivery.
   */
  public async cancelDelivery(deliveryId: string, adminUserId: string) {
    const [delivery] = await this.db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.id, deliveryId))
      .limit(1);

    if (!delivery) {
      throw new NotificationDeliveryNotFoundError(deliveryId);
    }

    if (delivery.status === "SENT" || delivery.status === "DELIVERED") {
      throw new Error(`Cannot cancel a delivery with status '${delivery.status}'.`);
    }

    const [updated] = await this.db
      .update(notificationDelivery)
      .set({
        status: "CANCELLED",
        updatedAt: new Date(),
      })
      .where(eq(notificationDelivery.id, deliveryId))
      .returning();

    await this.audit.record({
      action: "notification_delivery.cancelled",
      actorId: adminUserId,
      actorRole: "admin",
      entityId: deliveryId,
      entityType: "notification_delivery",
      metadata: { previousStatus: delivery.status },
    });

    return updated;
  }

  /**
   * Retrieve delivery by ID with its delivery attempts.
   */
  public async getDeliveryWithAttempts(deliveryId: string) {
    const [del] = await this.db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.id, deliveryId))
      .limit(1);

    if (!del) {
      throw new NotificationDeliveryNotFoundError(deliveryId);
    }

    const attempts = await this.db
      .select()
      .from(notificationDeliveryAttempt)
      .where(eq(notificationDeliveryAttempt.deliveryId, deliveryId))
      .orderBy(asc(notificationDeliveryAttempt.attemptNumber));

    return {
      ...del,
      attempts,
    };
  }

  /**
   * List deliveries with filtering.
   */
  public async listDeliveries(filters?: {
    status?: NotificationDeliveryStatus;
    channel?: NotificationChannel;
    recipientId?: string;
    eventId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(filters?.limit ?? 20, 1), 100);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const conditions = [];
    if (filters?.status) conditions.push(eq(notificationDelivery.status, filters.status));
    if (filters?.channel) conditions.push(eq(notificationDelivery.channel, filters.channel));
    if (filters?.recipientId) conditions.push(eq(notificationDelivery.recipientId, filters.recipientId));
    if (filters?.eventId) conditions.push(eq(notificationDelivery.eventId, filters.eventId));

    const rows = await this.db
      .select()
      .from(notificationDelivery)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(notificationDelivery.createdAt))
      .limit(limit)
      .offset(offset);

    return rows;
  }
}
