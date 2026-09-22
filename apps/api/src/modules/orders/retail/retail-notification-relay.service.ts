import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { orderEvent, retailOrder, type NotificationEventKey } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";
import { NotificationDispatcherService } from "../../notifications/notification-dispatcher.service";

/**
 * Best-effort relay from Retail's cross-aggregate fact log (`order_event`
 * rows with aggregate `retail_order`) to the Notifications owner.
 *
 * Mirrors `ProductionNotificationRelayService`: it never writes
 * notification tables directly and never runs inside a Retail transaction,
 * so a provider/template failure cannot roll back an order, a payment, or
 * a stock movement. Unknown fact types are SKIPPED (never mis-mapped to a
 * customer-facing key), and guest orders are skipped (no phone-scope
 * recipient type exists; IN_APP needs an account holder).
 */
@Injectable()
export class RetailNotificationRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetailNotificationRelayService.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(NotificationDispatcherService) private readonly dispatcher: NotificationDispatcherService,
  ) {}

  onModuleInit(): void {
    // Facts are durable; polling is bounded and advisory. Tests and workers
    // call relayPending/relayEvent directly.
    this.timer = setInterval(() => {
      void this.relayPending(50).catch((error) => {
        this.logger.warn(`Retail notification relay failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 5000);
    const unref = (this.timer as unknown as { unref?: () => void }).unref;
    unref?.call(this.timer);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async relayPending(limit = 50): Promise<{ events: number; deliveries: number; failures: number; skipped: number }> {
    const boundedLimit = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 50, 1), 100);
    const events = await this.db
      .select()
      .from(orderEvent)
      .where(eq(orderEvent.aggregateType, "retail_order"))
      .orderBy(desc(orderEvent.createdAt))
      .limit(boundedLimit);
    let deliveries = 0;
    let failures = 0;
    let skipped = 0;
    for (const event of events) {
      const result = await this.relayEvent(event.id);
      deliveries += result.deliveries;
      failures += result.failures;
      skipped += result.skipped;
    }
    return { events: events.length, deliveries, failures, skipped };
  }

  async relayEvent(eventId: string): Promise<{ deliveries: number; failures: number; skipped: number }> {
    const [event] = await this.db.select().from(orderEvent).where(eq(orderEvent.id, eventId)).limit(1);
    if (!event || event.aggregateType !== "retail_order") return { deliveries: 0, failures: 0, skipped: 0 };
    const eventKey = notificationKey(event.eventType);
    if (!eventKey) {
      this.logger.warn(`Retail relay skips unknown fact type ${event.eventType} (${event.id})`);
      return { deliveries: 0, failures: 0, skipped: 1 };
    }
    const [order] = await this.db.select().from(retailOrder).where(eq(retailOrder.id, event.aggregateId)).limit(1);
    if (!order || !order.customerId) return { deliveries: 0, failures: 0, skipped: 1 };
    try {
      const result = await this.dispatcher.dispatchDomainEvent({
        eventKey,
        sourceDomain: "retail",
        sourceEntityType: "retail_order",
        sourceEntityId: order.id,
        sourceEventId: event.id,
        recipientType: "ACCOUNT_USER",
        recipientId: order.customerId,
        category: "TRANSACTIONAL",
        channels: ["IN_APP"],
        payload: {
          orderCode: order.orderCode,
          orderStatus: order.orderStatus,
          paymentStatus: order.paymentStatus,
          currency: order.currency ?? "IRR",
          totals: {
            items: BigInt(order.itemsTotal).toString(),
            shipping: BigInt(order.shippingPrice).toString(),
            grand: BigInt(order.totalAmount).toString(),
          },
          paymentId: ((event.payload as Record<string, unknown> | null)?.payment_id as string | undefined) ?? null,
          retailEventId: event.id,
          retailEventType: event.eventType,
        },
        occurredAt: event.createdAt,
      });
      if (result.success) return { deliveries: result.deliveryIds.length || 1, failures: 0, skipped: 0 };
      return { deliveries: 0, failures: result.errors?.length || 1, skipped: 0 };
    } catch {
      // The dispatcher already isolates failures. Keep this final guard so a
      // malformed recipient or a future adapter cannot affect Retail.
      return { deliveries: 0, failures: 1, skipped: 0 };
    }
  }
}

function notificationKey(eventType: string): NotificationEventKey | null {
  switch (eventType) {
    case "retail_order.created":
      return "RETAIL_ORDER_CREATED";
    case "retail_order.paid":
      return "RETAIL_ORDER_PAID";
    case "retail_order.cancelled":
      return "RETAIL_ORDER_CANCELLED";
    default:
      return null;
  }
}
