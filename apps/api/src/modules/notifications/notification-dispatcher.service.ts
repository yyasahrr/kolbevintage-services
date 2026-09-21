import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEventKey,
  type NotificationRecipientType,
} from "@kolbe/database";
import { NotificationEventService } from "./notification-event.service";
import { NotificationDeliveryService } from "./notification-delivery.service";

export interface DomainNotificationEventInput {
  eventKey: NotificationEventKey;
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceEventId: string;
  recipientType: NotificationRecipientType;
  recipientId: string;
  category: NotificationCategory;
  channels: NotificationChannel[];
  payload: Record<string, unknown>;
  occurredAt?: Date;
  scheduledAt?: Date;
}

export interface DomainNotificationDispatchResult {
  success: boolean;
  eventId?: string;
  deliveryIds: string[];
  errors?: string[];
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    @Inject(NotificationEventService) private readonly eventService: NotificationEventService,
    @Inject(NotificationDeliveryService) private readonly deliveryService: NotificationDeliveryService,
  ) {}

  /**
   * Safely dispatch a domain event to the notifications module.
   *
   * CRITICAL INVARIANT:
   * Notification delivery failure MUST NEVER roll back or corrupt the caller's business transaction.
   * All exceptions are caught, logged, and returned gracefully.
   */
  public async dispatchDomainEvent(
    input: DomainNotificationEventInput,
  ): Promise<DomainNotificationDispatchResult> {
    const deliveryIds: string[] = [];
    const errors: string[] = [];

    try {
      // 1. Capture event in notification_event table
      const captured = await this.eventService.captureEvent({
        eventKey: input.eventKey,
        sourceDomain: input.sourceDomain,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        sourceEventId: input.sourceEventId,
        recipientScope: input.recipientType,
        recipientId: input.recipientId,
        occurredAt: input.occurredAt,
        payload: input.payload,
      });

      const eventId = captured.event.id;

      // 2. Enqueue delivery across requested channels
      for (const channel of input.channels) {
        try {
          const delivery = await this.deliveryService.enqueueDelivery({
            eventId,
            recipientType: input.recipientType,
            recipientId: input.recipientId,
            channel,
            category: input.category,
            scheduledAt: input.scheduledAt,
          });

          deliveryIds.push(delivery.id);
        } catch (chanErr) {
          const errStr = chanErr instanceof Error ? chanErr.message : String(chanErr);
          this.logger.warn(
            `Failed to enqueue notification delivery for channel ${channel} on event ${input.eventKey}: ${errStr}`,
          );
          errors.push(`[${channel}] ${errStr}`);
        }
      }

      return {
        success: errors.length === 0,
        eventId,
        deliveryIds,
        errors: errors.length ? errors : undefined,
      };
    } catch (topErr) {
      const errStr = topErr instanceof Error ? topErr.message : String(topErr);
      this.logger.error(
        `Critical: Notification dispatch failed for ${input.eventKey} (source: ${input.sourceDomain}/${input.sourceEntityId}): ${errStr}`,
      );

      return {
        success: false,
        deliveryIds,
        errors: [errStr],
      };
    }
  }
}
