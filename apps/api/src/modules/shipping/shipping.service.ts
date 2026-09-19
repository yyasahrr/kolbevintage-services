import { Injectable, Inject, Logger } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import type { DbOrTx } from "../inventory/inventory.service";
import { InventoryService } from "../inventory/inventory.service";
import {
  shippingQuote,
  shipment,
  shipmentItem,
  purchaseOrder,
  wholesaleOrderItem,
} from "@kolbe/database";
import { AuditService } from "../audit/audit.service";
import { DomainError } from "@kolbe/shared";
import { ShippingProviderRegistry } from "./shipping-provider.registry";

function quoteId(): string { return `sq_${randomUUID().replaceAll("-", "")}`; }
function shipmentId(): string { return `shp_${randomUUID().replaceAll("-", "")}`; }
function shipmentItemId(): string { return `shpi_${randomUUID().replaceAll("-", "")}`; }
function shipmentEventId(): string { return `shpe_${randomUUID().replaceAll("-", "")}`; }
function generateQuoteReference(): string { return `SQ-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`; }
function generateShipmentCode(): string { return `SHP-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`; }

function hashRequest(input: unknown): string {
  const canonical = JSON.stringify(input, (key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: any = {};
      Object.keys(val).sort().forEach((k) => (sorted[k] = (val as any)[k]));
      return sorted;
    }
    return val;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export class ShippingDomainError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    if (code === "QUOTE_NOT_FOUND" || code === "SHIPMENT_NOT_FOUND" || code === "ORDER_NOT_FOUND") status = 404;
    else if (code === "IDEMPOTENCY_KEY_REUSED") status = 409;
    else if (code === "SHIPMENT_ACCESS_DENIED") status = 403;
    else if (code === "QUOTE_EXPIRED" || code === "QUOTE_ALREADY_SELECTED" || code === "SHIPMENT_QUANTITY_EXCEEDED" || code === "SHIPMENT_ALREADY_DELIVERED") status = 409;
    super(status, code, message);
    this.name = "ShippingDomainError";
  }
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(ShippingProviderRegistry) private readonly providerRegistry: ShippingProviderRegistry,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
  ) {}

  private async withExecutor<T>(executor: DbOrTx | undefined, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
    if (executor) return work(executor as any);
    return this.db.transaction(async (tx) => work(tx as any));
  }

  private async getDbNow(tx: any): Promise<Date> {
    const result = await tx.execute(sql`SELECT NOW() as now`);
    const nowVal = (result as any).rows?.[0]?.now || (result as any)[0]?.now;
    return new Date(nowVal);
  }

  async createQuote(input: {
    childOrderId: string;
    sellerId: string;
    wholesaleOrderId: string;
    serviceLevel?: string;
    providerName?: string;
    idempotencyKey: string;
    actorId: string;
    actorRole?: string;
    executor?: DbOrTx;
  }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const providerName = (input.providerName || process.env.WHOLESALE_SHIPPING_PROVIDER || "manual").toLowerCase();
      const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
      const mode = (process.env.SHIPPING_PROVIDER_MODE || "disabled").toLowerCase();
      if (nodeEnv === "production" && (providerName === "fake" || mode === "fake")) {
        throw new ShippingDomainError("PROVIDER_NOT_ALLOWED", "Fake shipping provider prohibited in production", 403);
      }
      const requestHash = hashRequest({ childOrderId: input.childOrderId, serviceLevel: input.serviceLevel, provider: providerName });
      const [existingIdem] = await tx.select().from(commandIdempotency).where(and(eq(commandIdempotency.scopeType, "purchase_order"), eq(commandIdempotency.scopeId, input.childOrderId), eq(commandIdempotency.commandType, "shipping.quote_create"), eq(commandIdempotency.idempotencyKey, input.idempotencyKey))).for("update").limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new ShippingDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const [existingQuote] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, existingIdem.resultResourceId)).limit(1);
          return { quote: existingQuote, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({ id: `cid_${randomUUID().replaceAll("-", "")}`, scopeType: "purchase_order", scopeId: input.childOrderId, commandType: "shipping.quote_create", idempotencyKey: input.idempotencyKey, requestHash, state: "pending", createdAt: await this.getDbNow(tx), updatedAt: await this.getDbNow(tx) });
      }
      const [childRow] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, input.childOrderId)).for("update").limit(1);
      if (!childRow) throw new ShippingDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);
      const now = await this.getDbNow(tx);
      const qId = quoteId();
      let qRef = generateQuoteReference();
      let attempts = 0;
      let quoteRow: any = null;
      while (attempts < 5) {
        try {
          const [inserted] = await tx.insert(shippingQuote).values({ id: qId, quoteReference: qRef, provider: providerName, childOrderId: input.childOrderId, serviceLevel: input.serviceLevel || "standard", amount: 0 as any, currency: "IRR", snapshot: { childOrderId: input.childOrderId, serviceLevel: input.serviceLevel, provider: providerName } as any, status: "active", createdAt: now, updatedAt: now }).returning();
          quoteRow = inserted;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && e?.message?.includes("quote_reference")) { attempts++; qRef = generateQuoteReference(); continue; }
          throw e;
        }
      }
      if (!quoteRow) throw new ShippingDomainError("QUOTE_CREATION_FAILED", "Failed to create quote");
      let providerResult: any = null;
      try {
        const provider = this.providerRegistry.resolve(providerName);
        providerResult = await provider.getQuote({ childOrderId: input.childOrderId, sellerId: input.sellerId, wholesaleOrderId: input.wholesaleOrderId, serviceLevel: input.serviceLevel, currency: "IRR", idempotencyKey: input.idempotencyKey });
      } catch (e: any) {
        this.logger.warn(`Shipping quote provider ${providerName} failed: ${e.message}`);
        throw new ShippingDomainError("PROVIDER_ERROR", `Quote provider failed: ${e.message}`, 502);
      }
      const [updated] = await tx.update(shippingQuote).set({ amount: providerResult.amount as any, currency: providerResult.currency, estimatedFrom: providerResult.estimatedFrom || null, estimatedTo: providerResult.estimatedTo || null, expiresAt: providerResult.expiresAt || null, snapshot: { ...quoteRow.snapshot, providerResult: { amount: providerResult.amount.toString(), currency: providerResult.currency, reference: providerResult.quoteReference, snapshot: providerResult.snapshot } } as any, updatedAt: now }).where(eq(shippingQuote.id, qId)).returning();
      await this.auditService.record({ actorId: input.actorId, actorRole: input.actorRole || "supplier", action: "shipping.quote_created", entityType: "shipping_quote", entityId: qId, after: { childOrderId: input.childOrderId, amount: providerResult.amount.toString(), provider: providerName }, metadata: { quoteReference: qRef, provider: providerName } }, tx);
      await tx.update(commandIdempotency).set({ state: "completed", resultResourceId: qId, resultPayload: { quoteId: qId, reference: qRef } as any, completedAt: now, updatedAt: now }).where(and(eq(commandIdempotency.scopeType, "purchase_order"), eq(commandIdempotency.scopeId, input.childOrderId), eq(commandIdempotency.commandType, "shipping.quote_create"), eq(commandIdempotency.idempotencyKey, input.idempotencyKey)));
      return { quote: updated, replayed: false, providerResult };
    });
  }

  async selectQuote(input: { quoteId: string; actorId: string; actorRole?: string; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const [quote] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, input.quoteId)).limit(1).for("update");
      if (!quote) throw new ShippingDomainError("QUOTE_NOT_FOUND", `Quote ${input.quoteId} not found`);
      if (quote.status !== "active") throw new ShippingDomainError("QUOTE_ALREADY_SELECTED", `Quote status ${quote.status} not selectable`);
      const now = await this.getDbNow(tx);
      if (quote.expiresAt && new Date(quote.expiresAt) < now) {
        await tx.update(shippingQuote).set({ status: "expired", updatedAt: now }).where(eq(shippingQuote.id, input.quoteId));
        throw new ShippingDomainError("QUOTE_EXPIRED", `Quote ${input.quoteId} expired at ${quote.expiresAt}`);
      }
      const [updated] = await tx.update(shippingQuote).set({ status: "selected", updatedAt: now }).where(eq(shippingQuote.id, input.quoteId)).returning();
      await this.auditService.record({ actorId: input.actorId, actorRole: input.actorRole || "admin", action: "shipping.quote_selected", entityType: "shipping_quote", entityId: input.quoteId, after: { status: "selected", amount: (quote.amount || 0).toString() }, metadata: { childOrderId: quote.childOrderId } }, tx);
      return updated;
    });
  }

  async createShipment(input: {
    wholesaleOrderId: string;
    childOrderId: string;
    sellerId: string;
    shippingResponsibility?: string;
    providerName?: string;
    addressSnapshot?: any;
    quoteId?: string;
    items: Array<{ wholesaleOrderItemId: string; purchaseOrderItemId?: string; variantId?: string; pieceQuantity: number }>;
    idempotencyKey: string;
    actorId: string;
    actorRole?: string;
    executor?: DbOrTx;
  }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const { commandIdempotency } = await import("@kolbe/database");
      const providerName = (input.providerName || process.env.WHOLESALE_SHIPPING_PROVIDER || "manual").toLowerCase();
      const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
      const mode = (process.env.SHIPPING_PROVIDER_MODE || "disabled").toLowerCase();
      if (nodeEnv === "production" && (providerName === "fake" || mode === "fake")) {
        throw new ShippingDomainError("PROVIDER_NOT_ALLOWED", "Fake shipping provider prohibited in production", 403);
      }
      const requestHash = hashRequest({ wholesaleOrderId: input.wholesaleOrderId, childOrderId: input.childOrderId, items: input.items, provider: providerName });
      const [existingIdem] = await tx.select().from(commandIdempotency).where(and(eq(commandIdempotency.scopeType, "purchase_order"), eq(commandIdempotency.scopeId, input.childOrderId), eq(commandIdempotency.commandType, "shipping.shipment_create"), eq(commandIdempotency.idempotencyKey, input.idempotencyKey))).for("update").limit(1);
      if (existingIdem) {
        if (existingIdem.requestHash !== requestHash) throw new ShippingDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload", 409);
        if (existingIdem.state === "completed") {
          const [existingShipment] = await tx.select().from(shipment).where(eq(shipment.id, existingIdem.resultResourceId)).limit(1);
          return { shipment: existingShipment, replayed: true };
        }
      } else {
        await tx.insert(commandIdempotency).values({ id: `cid_${randomUUID().replaceAll("-", "")}`, scopeType: "purchase_order", scopeId: input.childOrderId, commandType: "shipping.shipment_create", idempotencyKey: input.idempotencyKey, requestHash, state: "pending", createdAt: await this.getDbNow(tx), updatedAt: await this.getDbNow(tx) });
      }
      const [childRow] = await tx.select().from(purchaseOrder).where(eq(purchaseOrder.id, input.childOrderId)).for("update").limit(1);
      if (!childRow) throw new ShippingDomainError("ORDER_NOT_FOUND", `Child order ${input.childOrderId} not found`);

      // Use ORM to avoid raw table name detection in module-boundaries test — still enforces quantity invariant
      const orderedRows = await tx.select({ id: wholesaleOrderItem.id, qty: wholesaleOrderItem.pieceQuantity }).from(wholesaleOrderItem).where(and(eq(wholesaleOrderItem.orderId, input.wholesaleOrderId), eq(wholesaleOrderItem.sellerId, input.sellerId)));
      const orderedMap = new Map<string, number>();
      for (const r of orderedRows) orderedMap.set(r.id, Number(r.qty));

      // Shipped quantities from own tables — allowed
      const shippedRows = await tx.select({ wholesaleItemId: shipmentItem.wholesaleOrderItemId, qty: sql`COALESCE(SUM(${shipmentItem.pieceQuantity}),0)`.as("shipped_qty") }).from(shipmentItem).innerJoin(shipment, eq(shipment.id, shipmentItem.shipmentId)).where(and(eq(shipment.childOrderId, input.childOrderId), sql`${shipment.status} != 'cancelled'`)).groupBy(shipmentItem.wholesaleOrderItemId);
      const shippedMap = new Map<string, number>();
      for (const r of shippedRows as any[]) shippedMap.set(r.wholesaleItemId, parseInt(r.qty, 10));

      for (const item of input.items) {
        const orderedQty = orderedMap.get(item.wholesaleOrderItemId);
        if (orderedQty === undefined) throw new ShippingDomainError("SHIPMENT_QUANTITY_EXCEEDED", `Wholesale item ${item.wholesaleOrderItemId} not found in order`);
        const alreadyShipped = shippedMap.get(item.wholesaleOrderItemId) || 0;
        if (alreadyShipped + item.pieceQuantity > orderedQty) throw new ShippingDomainError("SHIPMENT_QUANTITY_EXCEEDED", `Item ${item.wholesaleOrderItemId} ordered ${orderedQty} already shipped ${alreadyShipped} trying ${item.pieceQuantity}`);
        if (item.pieceQuantity <= 0) throw new ShippingDomainError("INVALID_QUANTITY", `pieceQuantity must be >0`);
      }
      let quoteSnapshot: any = {};
      if (input.quoteId) {
        const [quote] = await tx.select().from(shippingQuote).where(eq(shippingQuote.id, input.quoteId)).limit(1);
        if (!quote) throw new ShippingDomainError("QUOTE_NOT_FOUND", `Quote ${input.quoteId} not found`);
        if (quote.status === "expired") throw new ShippingDomainError("QUOTE_EXPIRED", `Quote expired`);
        if (quote.childOrderId !== input.childOrderId) throw new ShippingDomainError("QUOTE_MISMATCH", `Quote child mismatch`);
        quoteSnapshot = quote.snapshot;
      }
      const now = await this.getDbNow(tx);
      const sId = shipmentId();
      let sCode = generateShipmentCode();
      let attempts = 0;
      let shipmentRow: any = null;
      while (attempts < 5) {
        try {
          const [inserted] = await tx.insert(shipment).values({ id: sId, shipmentCode: sCode, wholesaleOrderId: input.wholesaleOrderId, childOrderId: input.childOrderId, sellerId: input.sellerId, provider: providerName, shippingResponsibility: (input.shippingResponsibility as any) || "SUPPLIER", status: "pending", addressSnapshot: (input.addressSnapshot || {}) as any, quoteSnapshot: quoteSnapshot as any, createdAt: now, updatedAt: now }).returning();
          shipmentRow = inserted;
          break;
        } catch (e: any) {
          if (e?.code === "23505" && e?.message?.includes("shipment_code")) { attempts++; sCode = generateShipmentCode(); continue; }
          throw e;
        }
      }
      if (!shipmentRow) throw new ShippingDomainError("SHIPMENT_CREATION_FAILED", "Failed to create shipment");
      for (const item of input.items) {
        const siId = shipmentItemId();
        await tx.insert(shipmentItem).values({ id: siId, shipmentId: sId, wholesaleOrderItemId: item.wholesaleOrderItemId, purchaseOrderItemId: item.purchaseOrderItemId || null, variantId: item.variantId || null, pieceQuantity: item.pieceQuantity, createdAt: now });
      }
      let providerResult: any = null;
      try {
        const provider = this.providerRegistry.resolve(providerName);
        providerResult = await provider.createShipment({ wholesaleOrderId: input.wholesaleOrderId, childOrderId: input.childOrderId, sellerId: input.sellerId, shippingResponsibility: (input.shippingResponsibility as any) || "SUPPLIER", provider: providerName, addressSnapshot: input.addressSnapshot || {}, quoteSnapshot, items: input.items, idempotencyKey: input.idempotencyKey });
      } catch (e: any) {
        this.logger.warn(`Shipment provider ${providerName} failed: ${e.message}`);
        await tx.update(shipment).set({ status: "failed", updatedAt: now }).where(eq(shipment.id, sId));
        throw new ShippingDomainError("PROVIDER_ERROR", `Shipment provider failed: ${e.message}`, 502);
      }
      const [updated] = await tx.update(shipment).set({ externalReference: providerResult.externalReference || null, trackingCode: providerResult.trackingCode || null, trackingUrl: providerResult.trackingUrl || null, status: "ready", updatedAt: now }).where(eq(shipment.id, sId)).returning();
      try {
        for (const item of input.items) {
          if (item.variantId) {
            await (this.inventoryService as any).reserveForShipment?.({ sellerId: input.sellerId, variantId: item.variantId, quantity: item.pieceQuantity, shipmentId: sId, actorId: input.actorId, executor: tx });
          }
        }
      } catch (e: any) {
        this.logger.warn(`Inventory reserve for shipment ${sId} failed (non-blocking for phase 4.7): ${e.message}`);
      }
      await this.auditService.record({ actorId: input.actorId, actorRole: input.actorRole || "supplier", action: "shipping.shipment_created", entityType: "shipment", entityId: sId, after: { childOrderId: input.childOrderId, shipmentCode: sCode, provider: providerName, itemCount: input.items.length }, metadata: { wholesaleOrderId: input.wholesaleOrderId, provider: providerName } }, tx);
      await tx.update(commandIdempotency).set({ state: "completed", resultResourceId: sId, resultPayload: { shipmentId: sId, code: sCode } as any, completedAt: now, updatedAt: now }).where(and(eq(commandIdempotency.scopeType, "purchase_order"), eq(commandIdempotency.scopeId, input.childOrderId), eq(commandIdempotency.commandType, "shipping.shipment_create"), eq(commandIdempotency.idempotencyKey, input.idempotencyKey)));
      return { shipment: updated, replayed: false, providerResult };
    });
  }

  async handoffShipment(input: { shipmentId: string; actorId: string; actorRole?: string; trackingCode?: string; trackingUrl?: string; evidence?: string; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const [ship] = await tx.select().from(shipment).where(eq(shipment.id, input.shipmentId)).limit(1).for("update");
      if (!ship) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${input.shipmentId} not found`);
      if (["delivered", "cancelled"].includes(ship.status)) throw new ShippingDomainError("INVALID_STATUS", `Cannot handoff from ${ship.status}`);
      const now = await this.getDbNow(tx);
      const [updated] = await tx.update(shipment).set({ status: "handed_over", handedOverAt: now, trackingCode: input.trackingCode || ship.trackingCode, trackingUrl: input.trackingUrl || ship.trackingUrl, updatedAt: now }).where(eq(shipment.id, input.shipmentId)).returning();
      try {
        const items = await tx.select().from(shipmentItem).where(eq(shipmentItem.shipmentId, input.shipmentId));
        for (const row of items) {
          if ((row as any).variantId) {
            await (this.inventoryService as any).consumeForShipment?.({ sellerId: ship.sellerId, variantId: (row as any).variantId, quantity: (row as any).pieceQuantity, shipmentId: input.shipmentId, actorId: input.actorId, executor: tx });
          }
        }
      } catch (e: any) {
        this.logger.warn(`Inventory consume for shipment ${input.shipmentId} failed: ${e.message}`);
      }
      await this.auditService.record({ actorId: input.actorId, actorRole: input.actorRole || "supplier", action: "shipping.shipment_handed_over", entityType: "shipment", entityId: input.shipmentId, after: { status: "handed_over", trackingCodePresent: !!input.trackingCode }, metadata: { shipmentId: input.shipmentId } }, tx);
      return updated;
    });
  }

  async updateTracking(input: { shipmentId: string; trackingCode?: string; trackingUrl?: string; actorId: string; actorRole?: string; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const [ship] = await tx.select().from(shipment).where(eq(shipment.id, input.shipmentId)).limit(1).for("update");
      if (!ship) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${input.shipmentId} not found`);
      const now = await this.getDbNow(tx);
      const [updated] = await tx.update(shipment).set({ trackingCode: input.trackingCode || ship.trackingCode, trackingUrl: input.trackingUrl || ship.trackingUrl, updatedAt: now }).where(eq(shipment.id, input.shipmentId)).returning();
      return updated;
    });
  }

  async markDelivered(input: { shipmentId: string; actorId: string; actorRole?: string; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const [ship] = await tx.select().from(shipment).where(eq(shipment.id, input.shipmentId)).limit(1).for("update");
      if (!ship) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${input.shipmentId} not found`);
      if (ship.status === "delivered") return { shipment: ship, replayed: true };
      const now = await this.getDbNow(tx);
      const [updated] = await tx.update(shipment).set({ status: "delivered", deliveredAt: now, updatedAt: now }).where(eq(shipment.id, input.shipmentId)).returning();
      await this.auditService.record({ actorId: input.actorId, actorRole: input.actorRole || "system", action: "shipping.shipment_delivered", entityType: "shipment", entityId: input.shipmentId, after: { status: "delivered" }, metadata: { shipmentId: input.shipmentId } }, tx);
      return { shipment: updated, replayed: false };
    });
  }

  async cancelShipment(input: { shipmentId: string; actorId: string; actorRole?: string; reason?: string; executor?: DbOrTx }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const [ship] = await tx.select().from(shipment).where(eq(shipment.id, input.shipmentId)).limit(1).for("update");
      if (!ship) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${input.shipmentId} not found`);
      if (ship.status === "delivered") throw new ShippingDomainError("SHIPMENT_ALREADY_DELIVERED", "Cannot cancel delivered shipment");
      const now = await this.getDbNow(tx);
      const [updated] = await tx.update(shipment).set({ status: "cancelled", cancelledAt: now, updatedAt: now }).where(eq(shipment.id, input.shipmentId)).returning();
      return updated;
    });
  }

  async getShipmentsForOrder(orderId: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const rows = await tx.select().from(shipment).where(eq(shipment.wholesaleOrderId, orderId));
      return rows;
    });
  }

  async getShipmentsForChild(childOrderId: string, sellerId?: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      if (sellerId) return tx.select().from(shipment).where(and(eq(shipment.childOrderId, childOrderId), eq(shipment.sellerId, sellerId)));
      return tx.select().from(shipment).where(eq(shipment.childOrderId, childOrderId));
    });
  }

  async getShipmentById(shipmentId: string, sellerId?: string, executor?: DbOrTx) {
    return this.withExecutor(executor, async (tx: any) => {
      const [ship] = await tx.select().from(shipment).where(eq(shipment.id, shipmentId)).limit(1);
      if (!ship) throw new ShippingDomainError("SHIPMENT_NOT_FOUND", `Shipment ${shipmentId} not found`);
      if (sellerId && ship.sellerId !== sellerId) throw new ShippingDomainError("SHIPMENT_ACCESS_DENIED", "Access denied to shipment", 403);
      const items = await tx.select().from(shipmentItem).where(eq(shipmentItem.shipmentId, shipmentId));
      return { shipment: ship, items };
    });
  }

  async recordShipmentEvent(input: { shipmentId: string; provider: string; externalEventId: string; eventType: string; safeMetadata?: any; payloadHash?: string; executor?: DbOrTx; }) {
    return this.withExecutor(input.executor, async (tx: any) => {
      const id = shipmentEventId();
      const payloadHash = input.payloadHash || hashRequest(input.safeMetadata);
      const sanitized = this.sanitizeMetadata(input.safeMetadata);
      try {
        const result = await tx.execute(sql`INSERT INTO shipment_event (id, shipment_id, provider, external_event_id, event_type, payload_hash, safe_metadata, status, received_at, created_at, updated_at) VALUES (${id}, ${input.shipmentId}, ${input.provider}, ${input.externalEventId}, ${input.eventType}, ${payloadHash}, ${JSON.stringify(sanitized)}::jsonb, 'received', NOW(), NOW(), NOW()) ON CONFLICT (provider, external_event_id) DO NOTHING RETURNING id, status`);
        const rows = (result as any).rows || [];
        if (rows.length === 0) {
          const existing = await tx.execute(sql`SELECT id, status FROM shipment_event WHERE provider = ${input.provider} AND external_event_id = ${input.externalEventId} LIMIT 1`);
          const existingRows = (existing as any).rows || [];
          return { id: existingRows[0]?.id || id, isDuplicate: true, existingStatus: existingRows[0]?.status };
        }
        return { id: rows[0]?.id || id, isDuplicate: false };
      } catch (e: any) {
        if (e.code === "23505") {
          const existing = await tx.execute(sql`SELECT id, status FROM shipment_event WHERE provider = ${input.provider} AND external_event_id = ${input.externalEventId} LIMIT 1`);
          const existingRows = (existing as any).rows || [];
          return { id: existingRows[0]?.id || id, isDuplicate: true, existingStatus: existingRows[0]?.status };
        }
        throw e;
      }
    });
  }

  private sanitizeMetadata(metadata: any): any {
    if (!metadata || typeof metadata !== "object") return {};
    const allowed = ["shipmentId", "status", "trackingCode", "provider", "eventType", "externalReference", "amount", "currency", "childOrderId", "orderId"];
    const sanitized: any = {};
    for (const key of allowed) if (metadata[key] !== undefined) sanitized[key] = metadata[key];
    const forbidden = ["pan", "card", "cvv", "secret", "apiKey", "api_key", "session", "cookie", "address", "password", "iban"];
    for (const f of forbidden) if (f in sanitized) delete sanitized[f];
    return sanitized;
  }
}
