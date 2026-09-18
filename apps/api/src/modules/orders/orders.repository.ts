import { Injectable, Inject } from "@nestjs/common";
import { eq, and, desc } from "drizzle-orm";
import {
  wholesaleOrder,
  wholesaleOrderItem,
  purchaseOrder,
  purchaseOrderItem,
  orderStatusHistory,
  orderEvent,
  wholesaleOrderRequest,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
export type DbOrTx = KolbeDatabase | Tx;

@Injectable()
export class OrdersRepository {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  // ── Wholesale Order ──────────────────────────────────────────────────

  async findWholesaleOrderById(id: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    const [row] = await db.select().from(wholesaleOrder).where(eq(wholesaleOrder.id, id)).limit(1);
    return row || null;
  }

  async findWholesaleOrderByCode(code: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    const [row] = await db.select().from(wholesaleOrder).where(eq(wholesaleOrder.orderCode, code)).limit(1);
    return row || null;
  }

  async findWholesaleOrderByAccountAndIdempotency(
    accountId: string,
    idempotencyKey: string,
    executor?: DbOrTx,
  ) {
    const db = (executor as any) || this.db;
    const [row] = await db
      .select()
      .from(wholesaleOrder)
      .where(and(eq(wholesaleOrder.accountId, accountId), eq(wholesaleOrder.idempotencyKey, idempotencyKey)))
      .limit(1);
    return row || null;
  }

  async findWholesaleOrderByOriginatingRequest(requestId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    const [row] = await db
      .select()
      .from(wholesaleOrder)
      .where(eq(wholesaleOrder.originatingRequestId, requestId))
      .limit(1);
    return row || null;
  }

  async findOrderRequestLinksByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.orderId, orderId));
  }

  async findOrderRequestLinkByRequestId(requestId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    const [row] = await db.select().from(wholesaleOrderRequest).where(eq(wholesaleOrderRequest.requestId, requestId)).limit(1);
    return row || null;
  }

  // ── Wholesale Order Items ────────────────────────────────────────────

  async findItemsByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.orderId, orderId));
  }

  // ── Purchase Order (child) ───────────────────────────────────────────

  async findChildOrdersByWholesaleOrderId(wholesaleOrderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db.select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, wholesaleOrderId));
  }

  async findChildOrderById(id: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    const [row] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1);
    return row || null;
  }

  async findChildItemsByParentOrderId(parentOrderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    // Join via wholesale_order_item
    const items = await db.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.orderId, parentOrderId));
    const itemIds = items.map((it: any) => it.id);
    if (itemIds.length === 0) return [];
    // This is simplified — actual implementation would need to query purchase_order_item where wholesale_order_item_id in itemIds
    // For now, return all child items for child orders of this parent
    const children = await this.findChildOrdersByWholesaleOrderId(parentOrderId, executor);
    const childIds = children.map((c: any) => c.id);
    if (childIds.length === 0) return [];
    const allChildItems: any[] = [];
    for (const childId of childIds) {
      const childItems = await db.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, childId));
      allChildItems.push(...childItems);
    }
    return allChildItems;
  }

  // ── Status History ───────────────────────────────────────────────────

  async findHistoryByOrderId(orderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(orderStatusHistory.createdAt);
  }

  async findHistoryByChildOrderId(childOrderId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.childOrderId, childOrderId))
      .orderBy(orderStatusHistory.createdAt);
  }

  // ── Events ───────────────────────────────────────────────────────────

  async findEventsByAggregate(aggregateType: string, aggregateId: string, executor?: DbOrTx) {
    const db = (executor as any) || this.db;
    return db
      .select()
      .from(orderEvent)
      .where(and(eq(orderEvent.aggregateType, aggregateType), eq(orderEvent.aggregateId, aggregateId)))
      .orderBy(orderEvent.createdAt);
  }

  // ── Write helpers ────────────────────────────────────────────────────

  async insertOrderStatusHistory(
    input: typeof orderStatusHistory.$inferInsert,
    executor: DbOrTx,
  ) {
    const db = executor as any;
    const [row] = await db.insert(orderStatusHistory).values(input).returning();
    return row;
  }

  async insertOrderEvent(input: typeof orderEvent.$inferInsert, executor: DbOrTx) {
    const db = executor as any;
    const [row] = await db.insert(orderEvent).values(input).returning();
    return row;
  }
}
