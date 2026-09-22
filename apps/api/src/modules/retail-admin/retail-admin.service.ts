import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  productRating,
  productVariantInventory,
  refund,
  retailOrder,
  retailReturnRequest,
  shipment,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AdminRbacService } from "../admin/admin-rbac.service";
import { AuthService } from "../auth/auth.service";
import { CatalogService } from "../catalog/catalog.service";
import { InventoryService } from "../inventory/inventory.service";
import { OffersService } from "../offers/offers.service";
import { RetailOrdersService } from "../orders/retail/retail-orders.service";
import { RetailReturnsService } from "../orders/retail/retail-returns.service";
import { PaymentsService } from "../payments/payments.service";
import { RatingsService } from "../ratings/ratings.service";
import { ShippingService } from "../shipping/shipping.service";

/**
 * Phase 5.11-A — Retail Admin & Operations control plane (orchestrator).
 *
 * Authority model (see docs/architecture/phase-5-11-retail-admin-operations.md):
 *  - This module OWNS NO TABLES. Every read below goes through an
 *    owner-domain service seam (orders/retail, payments, shipping,
 *    inventory, ratings, catalog, auth) or a bounded read-only aggregate
 *    over canonical rows for the control tower (same pattern as the
 *    wholesale control tower). No Admin copy tables exist or may be
 *    created here.
 *  - Writes (checkpoint B onward) are delegated to owner commands only —
 *    this module never UPDATEs an owner row directly.
 *  - Authorization: the controller layer enforces `@Roles("admin")` +
 *    `@RequireAdminPermission("retail:*")` (AdminPermissionGuard, fail
 *    closed on unknown/missing permissions). The actor is ALWAYS taken
 *    from the verified session claims (sub + role) — never from the body,
 *    query, or headers.
 *  - Responses are safe projections with BIGINT money as strings; the
 *    controller runs them through `toApiJson` so no BigInt/Date leaks.
 */
export interface RetailAdminPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface RetailAdminOverview {
  generatedAt: string;
  kolbeSellerId: string;
  orders: {
    byStatus: Record<string, number>;
    total: number;
    /** placed orders awaiting staff confirmation (the actionable queue). */
    requiringAction: number;
  };
  payments: {
    unpaid: number;
    pending_cod: number;
    paid: number;
    total: number;
  };
  /** retail-side shipments in `failed` state (operational exceptions). */
  shippingExceptions: number;
  /** returns in REQUESTED/APPROVED (still open for the warehouse). */
  pendingReturns: number;
  /** retail refunds in requested/approved/processing. */
  pendingRefunds: number;
  /** KOLBE-seller variants with zero available stock (on_hand - reserved <= 0). */
  criticalStockVariants: number;
  reviewsAwaitingModeration: number;
  /**
   * Last-N-day facts, computed per currency (no cross-currency blending —
   * each currency is its own fact).
   */
  period: {
    days7: { ordersCreated: number; paidGmvByCurrency: Record<string, string> };
    days30: { ordersCreated: number; paidGmvByCurrency: Record<string, string> };
  };
}

@Injectable()
export class RetailAdminService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AdminRbacService) private readonly rbac: AdminRbacService,
    @Inject(RetailOrdersService) private readonly retailOrders: RetailOrdersService,
    @Inject(RetailReturnsService) private readonly retailReturns: RetailReturnsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(RatingsService) private readonly ratings: RatingsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OffersService) private readonly offers: OffersService,
  ) {}

  // ── helpers ──────────────────────────────────────────────────────────────

  private static clampLimit(raw: unknown): number {
    const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 20;
    return Math.min(Math.max(n, 1), 100);
  }

  private static text(raw: unknown, max = 254): string | null {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    return raw.trim().slice(0, max);
  }

  private static isoDate(raw: unknown): Date | null {
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** KOLBE seller id (idempotent read; bootstraps the row only if absent). */
  private async kolbeSellerId(): Promise<string> {
    return this.offers.ensureSeller(null, "KOLBE");
  }

  /** Admin viewer for owner read seams (identity from session claims only). */
  private viewer(actorId: string) {
    return { userId: actorId, role: "admin" as const };
  }

  // ── A6: control tower overview (direct read-only aggregates) ────────────

  async getOverview(): Promise<RetailAdminOverview> {
    const kolbe = await this.kolbeSellerId();
    const db = this.db as any;

    const [statusRows, paymentRows, exceptionRows, returnRows, refundRows, stockRows, ratingRows, d7, d30] =
      await Promise.all([
        db
          .select({ status: retailOrder.orderStatus, count: sql<number>`count(*)::int` })
          .from(retailOrder)
          .groupBy(retailOrder.orderStatus),
        db
          .select({ status: retailOrder.paymentStatus, count: sql<number>`count(*)::int` })
          .from(retailOrder)
          .groupBy(retailOrder.paymentStatus),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(shipment)
          .where(and(sql`${shipment.retailOrderId} IS NOT NULL`, eq(shipment.status, "failed"))),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(retailReturnRequest)
          .where(inArray(retailReturnRequest.status, ["REQUESTED", "APPROVED"])),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(refund)
          .where(and(sql`${refund.retailOrderId} IS NOT NULL`, inArray(refund.status, ["requested", "approved", "processing"]))),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(productVariantInventory)
          .where(
            and(
              eq(productVariantInventory.sellerId, kolbe),
              sql`${productVariantInventory.onHand} - ${productVariantInventory.reserved} <= 0`,
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(productRating)
          .where(eq(productRating.status, "flagged")),
        this.periodFacts(7, kolbe),
        this.periodFacts(30, kolbe),
      ]);

    const byStatus: Record<string, number> = {};
    let orderTotal = 0;
    for (const row of statusRows as Array<{ status: string; count: number }>) {
      byStatus[row.status] = Number(row.count);
      orderTotal += Number(row.count);
    }
    const payments: RetailAdminOverview["payments"] = { unpaid: 0, pending_cod: 0, paid: 0, total: 0 };
    for (const row of paymentRows as Array<{ status: string; count: number }>) {
      if (row.status in payments) payments[row.status as keyof typeof payments] = Number(row.count);
      payments.total += Number(row.count);
    }

    return {
      generatedAt: new Date().toISOString(),
      kolbeSellerId: kolbe,
      orders: {
        byStatus,
        total: orderTotal,
        requiringAction: byStatus["placed"] ?? 0,
      },
      payments,
      shippingExceptions: Number((exceptionRows as any[])[0]?.count ?? 0),
      pendingReturns: Number((returnRows as any[])[0]?.count ?? 0),
      pendingRefunds: Number((refundRows as any[])[0]?.count ?? 0),
      criticalStockVariants: Number((stockRows as any[])[0]?.count ?? 0),
      reviewsAwaitingModeration: Number((ratingRows as any[])[0]?.count ?? 0),
      period: { days7: d7, days30: d30 },
    };
  }

  /** Created orders + paid GMV (per currency) over the last N days. */
  private async periodFacts(
    days: number,
    _kolbe: string,
  ): Promise<RetailAdminOverview["period"]["days7"]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const db = this.db as any;
    const rows = (await db
      .select({
        currency: retailOrder.currency,
        ordersCreated: sql<number>`count(*)::int`,
        paidGmv: sql`COALESCE(SUM(${retailOrder.totalAmount}) FILTER (WHERE ${retailOrder.paymentStatus} = 'paid'), 0)`,
      })
      .from(retailOrder)
      .where(gte(retailOrder.createdAt, since))
      .groupBy(retailOrder.currency)) as Array<{
      currency: string;
      ordersCreated: number;
      paidGmv: bigint;
    }>;
    let ordersCreated = 0;
    const paidGmvByCurrency: Record<string, string> = {};
    for (const row of rows) {
      ordersCreated += Number(row.ordersCreated);
      paidGmvByCurrency[row.currency] = BigInt(row.paidGmv).toString();
    }
    return { ordersCreated, paidGmvByCurrency };
  }

  // ── A: order operational views ───────────────────────────────────────────

  async listOrders(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const result = await this.retailOrders.adminListRetailOrders({
      status: RetailAdminService.text(query.status, 32),
      paymentStatus: RetailAdminService.text(query.paymentStatus, 32),
      customerId: RetailAdminService.text(query.customerId, 64),
      customerPhone: RetailAdminService.text(query.customerPhone, 32),
      orderCode: RetailAdminService.text(query.orderCode, 64),
      shipmentStatus: RetailAdminService.text(query.shipmentStatus, 32),
      dateFrom: RetailAdminService.isoDate(query.dateFrom),
      dateTo: RetailAdminService.isoDate(query.dateTo),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: RetailAdminService.text(query.cursor, 512),
    });
    // Annotate each order with its LATEST retail shipment status (owner
    // seam: ShippingService — the one authoritative lateral fact the ops
    // list needs without per-order fan-out).
    const orderIds = result.orders.map((o) => o.id as string);
    const latest = await this.shipping.latestRetailShipmentStatusesByOrderIds(orderIds);
    return {
      items: result.orders.map((o) => ({ ...o, latestShipmentStatus: latest.get(o.id as string) ?? null })),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  /** Order detail + its parcels (owner seams: orders/retail + shipping). */
  async getOrderDetail(actorId: string, orderId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(orderId, 64);
    if (!id) throw new Error("orderId is required");
    const order = await this.retailOrders.getRetailOrder(this.viewer(actorId), id);
    const shipping = await this.retailOrders.getRetailShipment(this.viewer(actorId), id);
    return { ...order, shipments: shipping.shipments };
  }

  /** Order timeline = the canonical order-event history (owner seam). */
  async getOrderTimeline(actorId: string, orderId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(orderId, 64);
    if (!id) throw new Error("orderId is required");
    const order = await this.retailOrders.getRetailOrder(this.viewer(actorId), id);
    return { orderId: order.id, orderCode: order.orderCode, status: order.status, timeline: order.history };
  }

  // ── A: payment views (read-only; reconciliation is a B command) ─────────

  async listPayments(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const rows = await this.payments.listRetailPaymentsForAdmin({
      retailOrderId: RetailAdminService.text(query.retailOrderId, 64),
      status: RetailAdminService.text(query.status, 32),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: this.parseCursor(query.cursor),
    });
    return this.page(rows, RetailAdminService.clampLimit(query.limit));
  }

  async getPaymentDetail(actorId: string, paymentId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(paymentId, 64);
    if (!id) throw new Error("paymentId is required");
    return this.payments.getRetailPaymentById(id);
  }

  // ── A: shipment views (owner: shipping) ──────────────────────────────────

  async listShipments(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const rows = await this.shipping.listRetailShipmentsForAdmin({
      retailOrderId: RetailAdminService.text(query.retailOrderId, 64),
      status: RetailAdminService.text(query.status, 32),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: this.parseCursor(query.cursor),
    });
    return this.page(rows, RetailAdminService.clampLimit(query.limit));
  }

  async getShipmentDetail(actorId: string, shipmentId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(shipmentId, 64);
    if (!id) throw new Error("shipmentId is required");
    const { shipment, items } = await this.shipping.getRetailShipmentById(id);
    const row = shipment as any;
    return {
      id: row.id,
      shipmentCode: row.shipmentCode,
      retailOrderId: row.retailOrderId,
      provider: row.provider,
      status: row.status,
      trackingCode: row.trackingCode ?? null,
      trackingUrl: row.trackingUrl ?? null,
      externalReference: row.externalReference ?? null,
      quoteSnapshot: row.quoteSnapshot ?? null,
      failureReason: row.failureReason ?? null,
      handedOverAt: row.handedOverAt ? new Date(row.handedOverAt).toISOString() : null,
      shippedAt: row.shippedAt ? new Date(row.shippedAt).toISOString() : null,
      deliveredAt: row.deliveredAt ? new Date(row.deliveredAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      items: (items as any[]).map((item) => ({
        id: item.id,
        retailOrderItemId: item.retailOrderItemId,
        quantity: item.quantity,
      })),
    };
  }

  // ── A: return views (owner: orders/retail) ───────────────────────────────

  async listReturns(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const result = await this.retailReturns.listRetailReturnsForAdmin({
      status: RetailAdminService.text(query.status, 32),
      orderId: RetailAdminService.text(query.orderId, 64),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: RetailAdminService.text(query.cursor, 512),
    });
    return { items: result.returns, nextCursor: result.nextCursor, hasMore: result.hasMore };
  }

  async getReturnDetail(actorId: string, returnId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(returnId, 64);
    if (!id) throw new Error("returnId is required");
    return this.retailReturns.getRetailReturn(this.viewer(actorId), id);
  }

  // ── A: refund views (owner: payments; refund lifecycle commands are B) ──

  async listRefunds(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const rows = await this.payments.listRetailRefundsForAdmin({
      retailOrderId: RetailAdminService.text(query.retailOrderId, 64),
      status: RetailAdminService.text(query.status, 32),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: this.parseCursor(query.cursor),
    });
    return this.page(rows, RetailAdminService.clampLimit(query.limit));
  }

  async getRefundDetail(actorId: string, refundId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(refundId, 64);
    if (!id) throw new Error("refundId is required");
    return this.payments.getRetailRefundById(id);
  }

  // ── A: customer views (owner: auth — safe projection only) ──────────────

  async listCustomers(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const rows = await this.auth.listAccountsForAdmin({
      search: RetailAdminService.text(query.search, 80),
      // The retail admin surface is customer-scoped by default; staff may
      // explicitly query another role (the projection stays safe regardless).
      role: RetailAdminService.text(query.role, 32) ?? "customer",
      status: RetailAdminService.text(query.status, 32),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: this.parseCursor(query.cursor),
    });
    return this.page(rows, RetailAdminService.clampLimit(query.limit));
  }

  async getCustomerDetail(actorId: string, userId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(userId, 64);
    if (!id) throw new Error("userId is required");
    // Owner seam: safe projection only (id/email/displayName/phone/
    // role/status). password hash, salt, TOTP secret and session material
    // are structurally absent from that seam.
    return this.auth.getCustomerProfile(id);
  }

  // ── A: review moderation queue (owner: ratings) ──────────────────────────

  async listReviews(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const result = await this.ratings.listReviewsForModeration({
      productId: RetailAdminService.text(query.productId, 64),
      status: RetailAdminService.text(query.status, 32),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: RetailAdminService.text(query.cursor, 512),
    });
    return { items: result.reviews, nextCursor: result.nextCursor, hasMore: result.nextCursor !== null };
  }

  // ── A: product operational views (owner: catalog) ────────────────────────

  async listProducts(actorId: string, query: Record<string, unknown>): Promise<RetailAdminPage<Record<string, unknown>>> {
    const rows = await this.catalog.listProductsForAdmin({
      status: RetailAdminService.text(query.status, 32),
      search: RetailAdminService.text(query.search, 80),
      limit: RetailAdminService.clampLimit(query.limit),
      cursor: this.parseCursor(query.cursor),
    });
    return this.page(rows, RetailAdminService.clampLimit(query.limit));
  }

  /**
   * Product ops view: lifecycle (catalog) + variants + KOLBE retail offer
   * (offers) + per-variant KOLBE stock (inventory) + review aggregate
   * (ratings). One read model composed from owner seams — no copied data.
   */
  async getProductDetail(actorId: string, productId: string): Promise<Record<string, unknown>> {
    const id = RetailAdminService.text(productId, 64);
    if (!id) throw new Error("productId is required");
    const product = await this.catalog.getProductById(id);
    if (!product) throw new Error("product not found");
    const kolbe = await this.kolbeSellerId();
    const [variants, offers, summary] = await Promise.all([
      this.catalog.listActiveVariantsForProduct(id),
      this.offers.listOffersForProduct(id),
      this.ratings.getSummary(id),
    ]);
    const variantRows = variants as any[];
    const stock = new Map<string, Record<string, unknown> | null>();
    for (const variant of variantRows) {
      try {
        const row = await this.inventory.getVariantInventory(variant.id, kolbe, {
          userId: actorId,
          role: "admin",
        });
        stock.set(variant.id, {
          variantId: variant.id,
          onHand: BigInt((row as any).onHand).toString(),
          reserved: BigInt((row as any).reserved).toString(),
          available: BigInt((row as any).available ?? (BigInt((row as any).onHand) - BigInt((row as any).reserved))).toString(),
        });
      } catch {
        // No stock row for this variant/variant-seller pair: honest null.
        stock.set(variant.id, null);
      }
    }
    const kolbeOffers = (offers as any[])
      .filter((offer) => offer.sellerId === kolbe)
      .map((offer) => ({
        offerId: offer.id,
        status: offer.status,
        retailPrice: offer.retailPrice != null ? BigInt(offer.retailPrice).toString() : null,
        wholesalePrice: offer.wholesalePrice != null ? BigInt(offer.wholesalePrice).toString() : null,
        currency: offer.currency ?? null,
        validFrom: offer.validFrom ? new Date(offer.validFrom).toISOString() : null,
        validUntil: offer.validUntil ? new Date(offer.validUntil).toISOString() : null,
      }));
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      ownerType: product.ownerType,
      isKolbeExclusive: product.isKolbeExclusive,
      status: product.status,
      salesCount: product.salesCount,
      createdAt: new Date(product.createdAt).toISOString(),
      updatedAt: new Date(product.updatedAt).toISOString(),
      variants: variantRows.map((variant) => ({
        variantId: variant.id,
        sku: variant.sku,
        attributes: variant.attributes ?? {},
        status: variant.status,
        stock: stock.get(variant.id) ?? null,
      })),
      kolbeOffers,
      reviews: { average: summary.average, count: summary.count },
    };
  }

  // ── A: inventory low stock (owner: inventory, KOLBE-seller scoped) ───────

  async listLowStock(actorId: string, query: Record<string, unknown>): Promise<Record<string, unknown>> {
    const kolbe = await this.kolbeSellerId();
    const minRaw = typeof query.minAvailable === "string" ? Number.parseInt(query.minAvailable, 10) : NaN;
    const limit = RetailAdminService.clampLimit(query.limit);
    const rows = await this.inventory.listLowStockForAdmin({
      sellerId: kolbe,
      minAvailable: Number.isFinite(minRaw) ? minRaw : 0,
      limit: Math.min(limit, 1000),
    });
    const variants = await this.catalog.findVariantsByIds(rows.map((row) => row.variantId as string));
    return {
      sellerId: kolbe,
      // C4 (checkpoint C) replaces the 0/`minAvailable` cutoff with the
      // authoritative per-variant threshold; until then the list is an
      // availability-based view.
      thresholdMode: "availability",
      truncated: rows.length > limit,
      items: rows.slice(0, limit).map((row) => {
        const variant = variants.get(row.variantId as string);
        return {
          ...row,
          productId: variant?.productId ?? null,
          sku: variant?.sku ?? null,
          attributes: variant?.attributes ?? null,
        };
      }),
    };
  }

  // ── pagination helpers ───────────────────────────────────────────────────

  /**
   * One wire format across the whole admin/retail namespace:
   * base64url(JSON([createdAtISO-or-key, id])). Owner seams that decode
   * their own cursor (retail orders / returns / reviews) receive the raw
   * string; the "raw pair" seams (payments / shipments / products /
   * customers) receive the decoded [key, id] pair.
   */
  private parseCursor(raw: unknown): [string, string] | null {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === "") return null;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "string" &&
        typeof parsed[1] === "string" &&
        parsed[0] !== "" &&
        parsed[1] !== ""
      ) {
        return [parsed[0], parsed[1]];
      }
    } catch {
      /* malformed cursor: raw-pair seams treat it as "first page" */
    }
    return null;
  }

  private encodeCursor(createdAtIso: string, id: string): string {
    return Buffer.from(JSON.stringify([createdAtIso, id]), "utf8").toString("base64url");
  }

  /** Turn an owner-seam "limit+1" result set into a page envelope. */
  private page(rows: Array<Record<string, unknown>>, limit: number): RetailAdminPage<Record<string, unknown>> {
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = items[items.length - 1];
      const createdAt = last.createdAt ? new Date(last.createdAt as string).toISOString() : "";
      nextCursor = this.encodeCursor(createdAt, String(last.id));
    }
    return { items, nextCursor, hasMore };
  }
}
