import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  payment,
  product,
  productRating,
  productVariant,
  productVariantInventory,
  refund,
  retailOrder,
  retailReturnRequest,
  seller,
  shipment,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AnalyticsQueryService } from "./analytics-query.service";
import { AnalyticsValidationError } from "./analytics.errors";
import type { AnalyticsRangeInput } from "./analytics.contract";

/**
 * Phase 5.11-B — retail operations read model (read-only composition).
 *
 * Money and order counts come from the analytics engine with canonical
 * 5.5 semantics (the five `retail.*` metrics; no dashboard-local math),
 * operational queues aggregate owner tables read-only (control-tower
 * precedent — this service writes nothing), and date windows are the
 * analytics presets resolved inside `run()` (bad ranges refuse with
 * `ANALYTICS_INVALID_REQUEST`, no new vocabulary).
 *
 * Honesty notes, all pinned by the B suite: empty data yields zeros;
 * inventory is KOLBE-held stock only (`seller.type = 'KOLBE'` —
 * supplier-held rows never appear); low-stock bands are NOT computed
 * (no authoritative per-product threshold exists — only exact
 * quantities plus the zero-stock fact); exception buckets are real
 * stored states, never synthetic "stalled/reconciliation" flags.
 */
@Injectable()
export class RetailDashboardService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AnalyticsQueryService) private readonly analytics: AnalyticsQueryService,
  ) {}

  private clampLimit(limit: unknown, fallback: number): number {
    const parsed = typeof limit === "string" && limit !== "" ? Number(limit) : (limit as number);
    if (!Number.isSafeInteger(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), 100);
  }

  private clampOffset(offset: unknown): number {
    const parsed = typeof offset === "string" && offset !== "" ? Number(offset) : (offset as number);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
    return parsed;
  }

  private decodeCursor(cursor: unknown): { createdAt: string; id: string } | null {
    if (cursor === undefined || cursor === null || cursor === "") return null;
    try {
      if (typeof cursor !== "string") throw new Error("shape");
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
      if (
        !parsed ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.id !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/.test(parsed.createdAt)
      ) {
        throw new Error("shape");
      }
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new AnalyticsValidationError("Retail inventory cursor is malformed");
    }
  }

  private async kolbeSellerId(): Promise<string | null> {
    const [row] = await this.db.select({ id: seller.id }).from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    return row?.id ?? null;
  }

  async getDashboard(range: AnalyticsRangeInput = {}): Promise<Record<string, unknown>> {
    const sales = await this.analytics.run(
      {
        metricKeys: ["retail.orders_count", "retail.units_ordered", "retail.ordered_gmv", "retail.paid_orders_count", "retail.order_status_count"],
        scope: "RETAIL",
        range,
      },
      undefined,
    );
    const byKey = new Map(sales.metrics.map((m) => [m.key, m]));
    const statusBreakdown: Record<string, string> = {};
    for (const item of byKey.get("retail.order_status_count")?.breakdown ?? []) {
      statusBreakdown[item.key] = String(item.value);
    }

    const awaitingPayment = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(retailOrder)
      .where(and(inArray(retailOrder.paymentStatus, ["unpaid", "pending_cod"]), sql`${retailOrder.orderStatus} <> 'cancelled'`));
    const fulfillmentBacklog = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(retailOrder)
      .where(and(eq(retailOrder.paymentStatus, "paid"), inArray(retailOrder.orderStatus, ["confirmed", "packed"])));
    const shipmentBacklog = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(shipment)
      .where(and(isNotNull(shipment.retailOrderId), inArray(shipment.status, ["pending", "ready", "handed_over", "in_transit"])));
    const returnRows = await this.db
      .select({ status: retailReturnRequest.status, count: sql<number>`count(*)::int` })
      .from(retailReturnRequest)
      .groupBy(retailReturnRequest.status);
    const refundRows = await this.db
      .select({ status: refund.status, count: sql<number>`count(*)::int` })
      .from(refund)
      .where(isNotNull(refund.retailOrderId))
      .groupBy(refund.status);
    const flaggedRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(productRating)
      .where(eq(productRating.status, "flagged"));
    const kolbeId = await this.kolbeSellerId();
    const inventoryTracked = kolbeId
      ? (
          await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(productVariantInventory)
            .where(eq(productVariantInventory.sellerId, kolbeId))
        )[0]?.count ?? 0
      : 0;
    const inventoryStockout = kolbeId
      ? (
          await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(productVariantInventory)
            .where(and(eq(productVariantInventory.sellerId, kolbeId), sql`"on_hand" - "reserved" <= 0`))
        )[0]?.count ?? 0
      : 0;

    const returnsByStatus: Record<string, number> = {};
    for (const row of returnRows) returnsByStatus[row.status] = Number(row.count);
    const refundsByStatus: Record<string, number> = {};
    for (const row of refundRows) refundsByStatus[row.status] = Number(row.count);
    const exceptions = await this.getExceptions({ limit: 10 });
    void 0;

    return {
      range: sales.range,
      timezone: sales.timezone,
      sales: {
        ordersCount: String(byKey.get("retail.orders_count")?.value ?? "0"),
        unitsOrdered: String(byKey.get("retail.units_ordered")?.value ?? "0"),
        orderedGmv: String(byKey.get("retail.ordered_gmv")?.value ?? "0"),
        paidOrdersCount: String(byKey.get("retail.paid_orders_count")?.value ?? "0"),
        orderStatusCount: statusBreakdown,
      },
      operations: {
        awaitingPayment: Number(awaitingPayment[0]?.count ?? 0),
        fulfillmentBacklog: Number(fulfillmentBacklog[0]?.count ?? 0),
        shipmentBacklog: Number(shipmentBacklog[0]?.count ?? 0),
        returnsByStatus,
        refundsByStatus,
        flaggedReviews: Number(flaggedRows[0]?.count ?? 0),
        inventory: { tracked: Number(inventoryTracked), stockout: Number(inventoryStockout) },
      },
      exceptions: await this.getExceptions({ limit: 10 }),
      generatedAt: new Date().toISOString(),
    };
  }

  async listInventory(query: { productId?: unknown; stockoutOnly?: unknown; limit?: unknown; cursor?: unknown } = {}): Promise<{
    rows: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = this.clampLimit(query.limit, 20);
    const cursor = this.decodeCursor(query.cursor);
    const kolbeId = await this.kolbeSellerId();
    if (!kolbeId) return { rows: [], nextCursor: null, hasMore: false };
    const conditions = [eq(productVariantInventory.sellerId, kolbeId)];
    if (typeof query.productId === "string" && query.productId !== "") {
      conditions.push(eq(product.id, query.productId));
    }
    if (query.stockoutOnly === true || query.stockoutOnly === "true") {
      conditions.push(sql`"product_variant_inventory"."on_hand" - "product_variant_inventory"."reserved" <= 0`);
    }
    if (cursor) {
      conditions.push(sql`("product_variant_inventory"."created_at", "product_variant_inventory"."id") < (${cursor.createdAt}::timestamptz, ${cursor.id})`);
    }
    const rows = (await this.db
      .select({
        id: productVariantInventory.id,
        variantId: productVariantInventory.variantId,
        sku: productVariant.sku,
        productId: product.id,
        productName: product.name,
        productStatus: product.status,
        onHand: productVariantInventory.onHand,
        reserved: productVariantInventory.reserved,
        status: productVariantInventory.status,
        createdAt: productVariantInventory.createdAt,
        updatedAt: productVariantInventory.updatedAt,
      })
      .from(productVariantInventory)
      .innerJoin(productVariant, eq(productVariant.id, productVariantInventory.variantId))
      .innerJoin(product, eq(product.id, productVariant.productId))
      .where(and(...conditions))
      .orderBy(desc(productVariantInventory.createdAt), desc(productVariantInventory.id))
      .limit(limit + 1)) as any[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as any;
    const hasMore = rows.length > limit;
    return {
      rows: page.map((r: any) => ({
        id: r.id,
        variantId: r.variantId,
        sku: r.sku,
        productId: r.productId,
        productName: r.productName,
        productStatus: r.productStatus,
        onHand: r.onHand,
        reserved: r.reserved,
        sellable: r.onHand - r.reserved,
        stockout: r.onHand - r.reserved <= 0,
        status: r.status,
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      })),
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })).toString("base64url")
          : null,
      hasMore,
    };
  }

  async getExceptions(query: { limit?: unknown; offset?: unknown } = {}): Promise<Record<string, unknown>> {
    const limit = this.clampLimit(query.limit, 20);
    const offset = this.clampOffset(query.offset);
    const paymentRows = (await this.db
      .select({
        id: payment.id,
        paymentReference: payment.paymentReference,
        retailOrderId: payment.retailOrderId,
        orderCode: retailOrder.orderCode,
        method: payment.method,
        provider: payment.provider,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        failureReason: payment.failureReason,
        submittedAt: payment.submittedAt,
        verifiedAt: payment.verifiedAt,
        createdAt: payment.createdAt,
      })
      .from(payment)
      .innerJoin(retailOrder, eq(retailOrder.id, payment.retailOrderId))
      .where(and(isNotNull(payment.retailOrderId), inArray(payment.status, ["pending", "evidence_submitted", "failed"])))
      .orderBy(desc(payment.createdAt), desc(payment.id))
      .limit(limit)
      .offset(offset)) as any[];
    const paymentCounts = await this.db
      .select({ status: payment.status, count: sql<number>`count(*)::int` })
      .from(payment)
      .where(and(isNotNull(payment.retailOrderId), inArray(payment.status, ["pending", "evidence_submitted", "failed"])))
      .groupBy(payment.status);
    const shipmentRows = (await this.db
      .select({
        id: shipment.id,
        shipmentCode: shipment.shipmentCode,
        retailOrderId: shipment.retailOrderId,
        orderCode: retailOrder.orderCode,
        provider: shipment.provider,
        status: shipment.status,
        trackingCode: shipment.trackingCode,
        failureReason: shipment.failureReason,
        handedOverAt: shipment.handedOverAt,
        shippedAt: shipment.shippedAt,
        createdAt: shipment.createdAt,
      })
      .from(shipment)
      .innerJoin(retailOrder, eq(retailOrder.id, shipment.retailOrderId))
      .where(and(isNotNull(shipment.retailOrderId), inArray(shipment.status, ["pending", "ready", "handed_over", "in_transit", "failed"])))
      .orderBy(asc(shipment.createdAt), asc(shipment.id))
      .limit(limit)
      .offset(offset)) as any[];
    const shipmentCounts = await this.db
      .select({ status: shipment.status, count: sql<number>`count(*)::int` })
      .from(shipment)
      .where(and(isNotNull(shipment.retailOrderId), inArray(shipment.status, ["pending", "ready", "handed_over", "in_transit", "failed"])))
      .groupBy(shipment.status);
    const counts = (rows: Array<{ status: string; count: number }>) => {
      const map: Record<string, number> = {};
      for (const row of rows) map[row.status] = Number(row.count);
      return map;
    };
    const iso = (value: unknown) => (value ? new Date(value as string | Date).toISOString() : null);
    return {
      payments: paymentRows.map((r: any) => ({
        id: r.id,
        paymentReference: r.paymentReference,
        retailOrderId: r.retailOrderId,
        orderCode: r.orderCode,
        method: r.method,
        provider: r.provider,
        status: r.status,
        amount: (r.amount ?? 0).toString(),
        currency: r.currency,
        failureReason: r.failureReason ?? null,
        submittedAt: iso(r.submittedAt),
        verifiedAt: iso(r.verifiedAt),
        createdAt: iso(r.createdAt),
      })),
      paymentCounts: counts(paymentCounts as any),
      shipments: shipmentRows.map((r: any) => ({
        id: r.id,
        shipmentCode: r.shipmentCode,
        retailOrderId: r.retailOrderId,
        orderCode: r.orderCode,
        provider: r.provider,
        status: r.status,
        trackingCode: r.trackingCode ?? null,
        failureReason: r.failureReason ?? null,
        handedOverAt: iso(r.handedOverAt),
        shippedAt: iso(r.shippedAt),
        createdAt: iso(r.createdAt),
      })),
      shipmentCounts: counts(shipmentCounts as any),
      limit,
      offset,
    };
  }
}
