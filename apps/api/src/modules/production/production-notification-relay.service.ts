import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { productionEvent } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { SuppliersService } from "../suppliers/suppliers.service";
import { NotificationDispatcherService } from "../notifications/notification-dispatcher.service";
import type { NotificationEventKey } from "@kolbe/database";

/**
 * Best-effort relay from Production's append-only fact log to the existing
 * Notifications owner. It never writes notification tables directly and never
 * runs inside a Production transaction, so a provider/template failure cannot
 * roll back a job, QC result, or recall.
 */
@Injectable()
export class ProductionNotificationRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductionNotificationRelayService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(NotificationDispatcherService) private readonly dispatcher: NotificationDispatcherService,
  ) {}

  onModuleInit(): void {
    // Production events are durable facts. Polling is deliberately bounded and
    // advisory; a worker can call relayPending directly without claiming a new
    // queue authority in this module.
    this.timer = setInterval(() => {
      void this.relayPending(50).catch((error) => {
        this.logger.warn(`Production notification relay failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 5000);
    const unref = (this.timer as unknown as { unref?: () => void }).unref;
    unref?.call(this.timer);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async relayPending(limit = 50): Promise<{ events: number; deliveries: number; failures: number }> {
    const boundedLimit = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 50, 1), 100);
    const events = await this.db.select().from(productionEvent).orderBy(desc(productionEvent.createdAt)).limit(boundedLimit);
    let deliveries = 0;
    let failures = 0;
    for (const event of events) {
      const result = await this.relayEvent(event.id);
      deliveries += result.deliveries;
      failures += result.failures;
    }
    return { events: events.length, deliveries, failures };
  }

  async relayEvent(eventId: string): Promise<{ deliveries: number; failures: number }> {
    const [event] = await this.db.select().from(productionEvent).where(eq(productionEvent.id, eventId)).limit(1);
    if (!event) return { deliveries: 0, failures: 0 };

    const members = await this.suppliers.listMembers(event.supplierId);
    let deliveries = 0;
    let failures = 0;
    const eventKey = notificationKey(event.eventType);
    for (const member of members) {
      try {
        const result = await this.dispatcher.dispatchDomainEvent({
          eventKey,
          sourceDomain: "production",
          sourceEntityType: event.sourceEntityType,
          sourceEntityId: event.sourceEntityId,
          sourceEventId: `${event.id}:${member.id}`,
          recipientType: "SUPPLIER_MEMBER",
          recipientId: member.id,
          category: "OPERATIONAL",
          channels: ["IN_APP"],
          payload: {
            ...(event.payload as Record<string, unknown>),
            productionEventId: event.id,
            productionEventType: event.eventType,
            productionEntityType: event.sourceEntityType,
            productionEntityId: event.sourceEntityId,
            productionJobId: event.jobId,
            supplierId: event.supplierId,
          },
          occurredAt: event.occurredAt,
        });
        if (result.success) deliveries += result.deliveryIds.length || 1;
        else failures += result.errors?.length || 1;
      } catch {
        // The dispatcher already isolates failures. Keep this final guard so a
        // malformed recipient or a future adapter cannot affect Production.
        failures += 1;
      }
    }
    return { deliveries, failures };
  }
}

function notificationKey(eventType: string): NotificationEventKey {
  switch (eventType) {
    case "JOB_CREATED": return "SUPPLIER_PRODUCTION_JOB_CREATED";
    case "RECALL_SUBMITTED":
    case "RECALL_ACTIVATED": return "SUPPLIER_PRODUCTION_RECALL_ACTION_REQUIRED";
    case "SAMPLE_SUBMITTED":
    case "SAMPLE_REVIEWED":
    case "INSPECTION_SUBMITTED":
    case "DEFECT_RECORDED":
    case "QUALITY_RELEASE_APPROVED": return "SUPPLIER_PRODUCTION_QUALITY_UPDATED";
    default: return "SUPPLIER_PRODUCTION_ACTION_REQUIRED";
  }
}
