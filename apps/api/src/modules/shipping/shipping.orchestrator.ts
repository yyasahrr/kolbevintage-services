import { Injectable, Inject, Logger } from "@nestjs/common";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { OrdersService } from "../orders/orders.service";
import { InventoryService } from "../inventory/inventory.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { WholesaleFinanceOrchestrator } from "../finance/wholesale-finance.orchestrator";
import { ShippingProviderRegistry } from "./shipping-provider.registry";
import {
  ACTIVE_ALLOCATION_STATUSES,
  HANDED_OVER_STATUSES,
  ShippingDomainError,
  ShippingService,
  deterministicId,
  hashShippingRequest,
} from "./shipping.service";
import type { CarrierState, ShippingProvider } from "./shipping-provider.interface";

/**
 * Phase 4.7.1 (B4) — tableless ShippingOrchestrator.
 *
 * Owns NO tables. It coordinates the physical fulfillment flow across the
 * owning services, each of which is the single writer of its own tables:
 *   • OrdersService   — canonical child/parent facts + order state/history/events
 *   • ShippingService — shipping_quote / shipment / shipment_item / shipment_event
 *   • InventoryService — reservation consumption at handoff
 *   • WholesaleFinanceOrchestrator — the financial effect of a selected quote,
 *     and the read-only financial gate
 *   • ShippingProviderRegistry / adapters — external carriers (never under a lock)
 *
 * Every provider call sits BETWEEN transactions (TxA → provider → TxB, B1) and
 * is idempotent on identities persisted in TxA (B2/B3). Every order-side
 * effect is written by OrdersService inside the same transaction as the
 * shipping write — no best-effort catches (B15).
 */

export type ShippingActor = {
  userId: string | null;
  role: "supplier" | "admin" | "finance" | "system" | "vip" | "customer";
};

type ChildContext = Awaited<ReturnType<OrdersService["getChildOrderShippingContext"]>>;

const ORDER_ACTOR = (actor: ShippingActor): "supplier" | "admin" | "system" =>
  actor.role === "supplier" ? "supplier" : actor.role === "system" ? "system" : "admin";

function requireIdempotencyKey(key: string | undefined | null): string {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new ShippingDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required", 400);
  if (trimmed.length > 200) throw new ShippingDomainError("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key too long", 400);
  return trimmed;
}

@Injectable()
export class ShippingOrchestrator {
  private readonly logger = new Logger(ShippingOrchestrator.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(ShippingService) private readonly shippingService: ShippingService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(SuppliersService) private readonly suppliersService: SuppliersService,
    @Inject(WholesaleFinanceOrchestrator) private readonly financeOrchestrator: WholesaleFinanceOrchestrator,
    @Inject(ShippingProviderRegistry) private readonly providerRegistry: ShippingProviderRegistry,
  ) {}

  // ── authorization (B6) ────────────────────────────────────────────────
  /**
   * Resource-based supplier authorization: Claims.sub → ALL active memberships →
   * the target child's seller → its supplier → the matching membership.
   * Never "the first membership". Admin/finance bypass with their own role rules.
   */
  private async authorizeSeller(actor: ShippingActor, sellerId: string, tx: any, opts: { mutation: boolean }) {
    if (actor.role === "admin") return { via: "admin" as const };
    if (actor.role === "system") return { via: "system" as const };
    if (actor.role !== "supplier") throw new ShippingDomainError("SHIPMENT_ACCESS_DENIED", "Only suppliers or admins may operate shipments");
    if (!actor.userId) throw new ShippingDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "Supplier membership required");
    const memberships = await this.suppliersService.getUserMemberships(actor.userId, tx);
    if (!memberships || memberships.length === 0) {
      throw new ShippingDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "User has no supplier membership");
    }
    const eligibility = await this.suppliersService.getSellerEligibility(sellerId, tx);
    const supplierId = eligibility.supplier?.id;
    const membership = memberships.find((m: any) => m.supplierId === supplierId);
    if (!supplierId || !membership) {
      throw new ShippingDomainError("SHIPMENT_ACCESS_DENIED", "Shipment belongs to another supplier");
    }
    if (opts.mutation && !["owner", "sales", "warehouse"].includes(membership.role)) {
      throw new ShippingDomainError("ROLE_NOT_ALLOWED", `Supplier role ${membership.role} cannot operate shipments`);
    }
    return { via: "membership" as const, supplierId, memberRole: membership.role as string };
  }

  private resolveProvider(name?: string | null): ShippingProvider {
    return this.providerRegistry.resolve(name || undefined);
  }

  private orderedByItem(ctx: ChildContext) {
    const map = new Map<string, ChildContext["items"][number]>();
    for (const item of ctx.items) map.set(item.wholesaleOrderItemId, item);
    return map;
  }

  // ── quotes (TxA → provider → TxB) ─────────────────────────────────────
  async createQuote(input: { actor: ShippingActor; childOrderId: string; serviceLevel?: string; providerName?: string; idempotencyKey: string | undefined }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const serviceLevel = (input.serviceLevel || "standard").toLowerCase();
    const provider = this.resolveProvider(input.providerName);
    const scope = { scopeType: "purchase_order", scopeId: input.childOrderId, commandType: "shipping.quote_create", idempotencyKey };
    const requestHash = hashShippingRequest({ childOrderId: input.childOrderId, serviceLevel, provider: provider.name });
    const quoteId = deterministicId("sq", "quote", input.childOrderId, provider.name, idempotencyKey);

    // TxA — auth + validation + persistent command state. No provider I/O.
    const txA = await this.db.transaction(async (tx: any) => {
      const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: input.childOrderId, executor: tx });
      await this.authorizeSeller(input.actor, ctx.child.sellerId, tx, { mutation: true });
      if (["cancelled", "delivered"].includes(ctx.child.status)) {
        throw new ShippingDomainError("CHILD_ORDER_NOT_SHIPPABLE", `Child order ${ctx.child.id} is ${ctx.child.status}`);
      }
      const claim = await this.shippingService.claimCommand(tx, { ...scope, requestHash });
      if (claim.state === "completed") {
        const quote = await this.shippingService.getQuoteById(claim.resourceId || quoteId, tx);
        return { ctx, replayed: true as const, quote };
      }
      return { ctx, replayed: false as const, quote: null };
    });
    if (txA.replayed) return { quote: txA.quote, replayed: true };

    // Provider — outside any transaction; idempotent on the command key.
    let providerResult;
    try {
      providerResult = await provider.getQuote({
        childOrderId: input.childOrderId,
        sellerId: txA.ctx.child.sellerId,
        wholesaleOrderId: txA.ctx.parent.id,
        serviceLevel,
        currency: txA.ctx.parent.currency,
        idempotencyKey: `quote:${input.childOrderId}:${idempotencyKey}`,
      });
    } catch (e: any) {
      await this.db.transaction(async (tx: any) => this.shippingService.failCommand(tx, scope));
      throw new ShippingDomainError("PROVIDER_ERROR", `Quote provider ${provider.name} failed: ${e?.message || e}`);
    }

    // TxB — immutable quote + command completion + order event.
    return this.db.transaction(async (tx: any) => {
      const { quote, created } = await this.shippingService.persistQuote({
        quoteId,
        childOrderId: input.childOrderId,
        provider: provider.name,
        serviceLevel,
        providerResult,
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        executor: tx,
      });
      if (created) {
        await this.ordersService.recordShippingQuoteCreated({
          childOrderId: input.childOrderId,
          quoteId,
          provider: provider.name,
          amount: providerResult.amount.toString(),
          actorId: input.actor.userId,
          actorRole: ORDER_ACTOR(input.actor),
          executor: tx,
        });
      }
      await this.shippingService.completeCommand(tx, scope, quoteId, { quoteId, quoteReference: quote.quoteReference });
      return { quote, replayed: false, notQuoted: BigInt(quote.amount ?? 0) === 0n };
    });
  }

  /** Admin selects a quote; the fee becomes a proforma supersede via Finance (D2/D3). One transaction, no provider I/O. */
  async selectQuote(input: { actor: ShippingActor; quoteId: string; idempotencyKey: string | undefined }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    if (!["admin", "finance"].includes(input.actor.role)) throw new ShippingDomainError("ROLE_NOT_ALLOWED", "Only admin/finance may select shipping quotes");
    const scope = { scopeType: "shipping_quote", scopeId: input.quoteId, commandType: "shipping.quote_select", idempotencyKey };
    return this.db.transaction(async (tx: any) => {
      const claim = await this.shippingService.claimCommand(tx, { ...scope, requestHash: hashShippingRequest({ quoteId: input.quoteId, action: "select" }) });
      if (claim.state === "completed") return { replayed: true, quote: await this.shippingService.getQuoteById(input.quoteId, tx), fee: claim.payload?.fee ?? null };
      const { quote } = await this.shippingService.selectQuote({ quoteId: input.quoteId, actorId: input.actor.userId, actorRole: input.actor.role, executor: tx });
      const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: quote.childOrderId, executor: tx, lock: true });
      const fee = await this.financeOrchestrator.applyShippingFeeForChild({
        wholesaleOrderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        quoteId: input.quoteId,
        shippingAmount: (quote.amount ?? 0n).toString(),
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        idempotencyKey,
        executor: tx,
      });
      const feeSummary = { superseded: fee.superseded, reason: fee.reason, shippingDelta: (fee as any).shippingDelta ?? "0", currentPayable: fee.summary.currentPayable, refundObligation: (fee.summary as any).refundObligation ?? "0" };
      await this.shippingService.completeCommand(tx, scope, input.quoteId, { quoteId: input.quoteId, fee: feeSummary });
      return { replayed: false, quote, fee: feeSummary };
    });
  }

  // ── shipments (TxA → provider → TxB) ──────────────────────────────────
  async createShipment(input: {
    actor: ShippingActor;
    childOrderId: string;
    items: Array<{ wholesaleOrderItemId: string; pieceQuantity: number }>;
    providerName?: string;
    quoteId?: string;
    idempotencyKey: string | undefined;
    /** Client-supplied claims that are VERIFIED against the server truth, never trusted (B7/B8/B9). */
    claimedWholesaleOrderId?: string;
    claimedSellerId?: string;
    claimedShippingResponsibility?: string;
    claimedAddressSnapshot?: unknown;
  }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    if (!Array.isArray(input.items) || input.items.length === 0) throw new ShippingDomainError("SHIPMENT_ITEMS_REQUIRED", "At least one shipment item is required", 400);
    if (input.claimedAddressSnapshot !== undefined && input.claimedAddressSnapshot !== null) {
      throw new ShippingDomainError("SHIPMENT_ADDRESS_NOT_ALLOWED", "The shipping address is the buyer's immutable order snapshot and cannot be supplied", 400);
    }
    const provider = this.resolveProvider(input.providerName);
    const normalizedItems = input.items
      .map((i) => ({ wholesaleOrderItemId: String(i.wholesaleOrderItemId), pieceQuantity: Number(i.pieceQuantity) }))
      .sort((a, b) => a.wholesaleOrderItemId.localeCompare(b.wholesaleOrderItemId));
    const scope = { scopeType: "purchase_order", scopeId: input.childOrderId, commandType: "shipping.shipment_create", idempotencyKey };
    const requestHash = hashShippingRequest({ childOrderId: input.childOrderId, items: normalizedItems, provider: provider.name, quoteId: input.quoteId || null });
    const shipmentId = deterministicId("shp", "shipment", input.childOrderId, idempotencyKey);

    // TxA — lock child, authorize, verify claims, gate, quantities, reservations, persist pending shipment.
    const txA = await this.db.transaction(async (tx: any) => {
      const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: input.childOrderId, executor: tx, lock: true });
      await this.authorizeSeller(input.actor, ctx.child.sellerId, tx, { mutation: true });
      if (input.claimedWholesaleOrderId && input.claimedWholesaleOrderId !== ctx.parent.id) {
        throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", "Child order does not belong to the given wholesale order");
      }
      if (input.claimedSellerId && input.claimedSellerId !== ctx.child.sellerId) {
        throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", "Child order does not belong to the given seller");
      }
      if (input.claimedShippingResponsibility && input.claimedShippingResponsibility !== ctx.child.shippingResponsibility) {
        throw new ShippingDomainError("SHIPMENT_RESPONSIBILITY_MISMATCH", `Shipping responsibility is ${ctx.child.shippingResponsibility} (server-derived)`);
      }

      const claim = await this.shippingService.claimCommand(tx, { ...scope, requestHash });
      if (claim.state === "completed") {
        const existing = await this.shippingService.getShipmentById(claim.resourceId || shipmentId, tx);
        return { kind: "completed" as const, ctx, shipment: existing.shipment, items: existing.items };
      }
      if (claim.state === "pending" && claim.resourceId) {
        // Crash between TxA and TxB — resume with the SAME shipment (B2).
        const existing = await this.shippingService.getShipmentById(claim.resourceId, tx);
        return { kind: "resume" as const, ctx, shipment: existing.shipment, items: existing.items };
      }

      // B10 — financial gate + operational state.
      if (!ctx.parent.financiallyReleased) {
        throw new ShippingDomainError("FINANCIAL_GATE_BLOCKED", `Order ${ctx.parent.id} is ${ctx.parent.status}: no financial release, shipment not allowed`);
      }
      const gate = await this.financeOrchestrator.getFinancialGateStatus(ctx.parent.id, tx);
      if (!gate.released) {
        throw new ShippingDomainError("FINANCIAL_GATE_BLOCKED", `Order ${ctx.parent.id} has no trusted financial release`);
      }
      if (ctx.child.status !== "preparing") {
        throw new ShippingDomainError("CHILD_ORDER_NOT_SHIPPABLE", `Shipments require child status preparing (current: ${ctx.child.status})`);
      }

      // B11 — quantity allocation under the child row lock.
      const ordered = this.orderedByItem(ctx);
      const allocated = await this.shippingService.getAllocatedQuantitiesForChild(ctx.child.id, tx, ACTIVE_ALLOCATION_STATUSES);
      const seen = new Set<string>();
      const resolvedItems: Array<{ wholesaleOrderItemId: string; purchaseOrderItemId: string | null; variantId: string | null; pieceQuantity: number; orderedPieceQuantity: number }> = [];
      for (const item of normalizedItems) {
        if (seen.has(item.wholesaleOrderItemId)) throw new ShippingDomainError("SHIPMENT_ITEM_DUPLICATE", `Item ${item.wholesaleOrderItemId} listed twice`, 400);
        seen.add(item.wholesaleOrderItemId);
        if (!Number.isSafeInteger(item.pieceQuantity) || item.pieceQuantity <= 0) throw new ShippingDomainError("INVALID_QUANTITY", "pieceQuantity must be a positive integer", 400);
        const orderedItem = ordered.get(item.wholesaleOrderItemId);
        if (!orderedItem) throw new ShippingDomainError("SHIPMENT_ITEM_NOT_IN_ORDER", `Item ${item.wholesaleOrderItemId} is not part of child order ${ctx.child.id}`, 400);
        const already = allocated.get(item.wholesaleOrderItemId) || 0;
        if (already + item.pieceQuantity > orderedItem.pieceQuantity) {
          throw new ShippingDomainError(
            "SHIPMENT_QUANTITY_EXCEEDED",
            `Item ${item.wholesaleOrderItemId}: ordered ${orderedItem.pieceQuantity}, already allocated ${already}, requested ${item.pieceQuantity}`,
          );
        }
        resolvedItems.push({
          wholesaleOrderItemId: item.wholesaleOrderItemId,
          purchaseOrderItemId: orderedItem.purchaseOrderItemId,
          variantId: orderedItem.variantId,
          pieceQuantity: item.pieceQuantity,
          orderedPieceQuantity: orderedItem.pieceQuantity,
        });
      }

      // C1/C2 — the shipment claims a portion of the ORDER reservation; no new reservation.
      const reservations = await this.inventoryService.getReservationsForOrderItems({
        orderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        sellerId: ctx.child.sellerId,
        orderItemIds: resolvedItems.map((i) => i.wholesaleOrderItemId),
        executor: tx,
      });
      for (const item of resolvedItems) {
        const rows = reservations.filter((r: { orderItemId: string; status: string }) => r.orderItemId === item.wholesaleOrderItemId && r.status === "active");
        if (rows.length === 0) throw new ShippingDomainError("RESERVATION_NOT_AVAILABLE", `No active inventory reservation for item ${item.wholesaleOrderItemId}`);
        const already = allocated.get(item.wholesaleOrderItemId) || 0;
        for (const r of rows) {
          const perPiece = r.quantity / item.orderedPieceQuantity;
          const needed = perPiece * (already + item.pieceQuantity);
          if (!Number.isInteger(perPiece) || needed > r.quantity) {
            throw new ShippingDomainError("RESERVATION_NOT_AVAILABLE", `Reservation ${r.id} cannot back ${already + item.pieceQuantity} pieces of item ${item.wholesaleOrderItemId}`);
          }
        }
      }

      let quoteSnapshot: Record<string, unknown> = {};
      if (input.quoteId) {
        const quote = await this.shippingService.getQuoteById(input.quoteId, tx);
        if (quote.childOrderId !== ctx.child.id) throw new ShippingDomainError("QUOTE_MISMATCH", "Quote belongs to another child order", 409);
        if (quote.status === "expired" || quote.status === "voided") throw new ShippingDomainError("QUOTE_EXPIRED", `Quote ${quote.id} is ${quote.status}`);
        quoteSnapshot = { quoteId: quote.id, quoteReference: quote.quoteReference, amount: (quote.amount ?? 0n).toString(), currency: quote.currency, provider: quote.provider, serviceLevel: quote.serviceLevel, status: quote.status };
      }

      const created = await this.shippingService.createPendingShipment({
        shipmentId,
        wholesaleOrderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        sellerId: ctx.child.sellerId,
        provider: provider.name,
        shippingResponsibility: ctx.child.shippingResponsibility,
        addressSnapshot: ctx.parent.shippingAddressSnapshot,
        quoteSnapshot,
        items: resolvedItems.map((i) => ({ wholesaleOrderItemId: i.wholesaleOrderItemId, purchaseOrderItemId: i.purchaseOrderItemId, variantId: i.variantId, pieceQuantity: i.pieceQuantity })),
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        executor: tx,
      });
      await this.shippingService.attachCommandResource(tx, scope, shipmentId);
      await this.ordersService.recordShippingShipmentCreated({
        orderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        shipmentId,
        provider: provider.name,
        actorId: input.actor.userId,
        actorRole: ORDER_ACTOR(input.actor),
        executor: tx,
      });
      return { kind: "created" as const, ctx, shipment: created.shipment, items: created.items };
    });

    if (txA.kind === "completed") return { shipment: txA.shipment, items: txA.items, replayed: true };
    if (txA.shipment.status !== "pending") {
      // Resume after a crash that already finished TxB: just close the command.
      await this.db.transaction(async (tx: any) => this.shippingService.completeCommand(tx, scope, txA.shipment.id, { shipmentId: txA.shipment.id }));
      return { shipment: txA.shipment, items: txA.items, replayed: true };
    }

    return this.finalizePendingShipment({ shipment: txA.shipment, items: txA.items, ctx: txA.ctx, provider, actor: input.actor, scope });
  }

  /**
   * Provider call (no lock) + TxB. Shared by the create path and by
   * reconciliation, which is how an external shipment that was accepted right
   * before a crash gets attached instead of duplicated (B2/B18).
   */
  private async finalizePendingShipment(input: {
    shipment: any;
    items: any[];
    ctx: ChildContext;
    provider: ShippingProvider;
    actor: ShippingActor;
    scope?: { scopeType: string; scopeId: string; commandType: string; idempotencyKey: string };
  }) {
    const { shipment, provider } = input;
    let providerResult;
    try {
      providerResult = await provider.createShipment({
        shipmentId: shipment.id,
        shipmentCode: shipment.shipmentCode,
        wholesaleOrderId: shipment.wholesaleOrderId,
        childOrderId: shipment.childOrderId,
        sellerId: shipment.sellerId,
        shippingResponsibility: shipment.shippingResponsibility,
        addressSnapshot: shipment.addressSnapshot || {},
        quoteSnapshot: shipment.quoteSnapshot || {},
        items: input.items.map((i: any) => ({ wholesaleOrderItemId: i.wholesaleOrderItemId, variantId: i.variantId, pieceQuantity: i.pieceQuantity })),
        idempotencyKey: shipment.id,
      });
    } catch (e: any) {
      // B14 pre-handoff failure: the command stays retryable; the shipment stays pending for reconciliation.
      if (input.scope) await this.db.transaction(async (tx: any) => this.shippingService.failCommand(tx, input.scope!));
      throw new ShippingDomainError("PROVIDER_ERROR", `Shipping provider ${provider.name} failed: ${e?.message || e}`);
    }

    return this.db.transaction(async (tx: any) => {
      const locked = await this.shippingService.lockShipment(shipment.id, tx);
      let updated = locked;
      if (locked.status === "pending") {
        updated = await this.shippingService.transitionShipment({
          shipmentId: shipment.id,
          from: "pending",
          to: "ready",
          patch: { externalReference: providerResult.externalReference, trackingCode: providerResult.trackingCode, trackingUrl: providerResult.trackingUrl },
          actorId: input.actor.userId,
          actorRole: input.actor.role,
          reason: providerResult.replayed ? "provider_replayed" : "provider_accepted",
          executor: tx,
        });
        await this.ordersService.recordShipmentStatusEvent({
          childOrderId: shipment.childOrderId,
          shipmentId: shipment.id,
          eventType: "shipping.shipment_ready",
          actorId: input.actor.userId,
          actorRole: ORDER_ACTOR(input.actor),
          payload: { provider: provider.name, externalReferencePresent: Boolean(providerResult.externalReference), trackingCodePresent: Boolean(providerResult.trackingCode) },
          executor: tx,
        });
      }
      if (input.scope) await this.shippingService.completeCommand(tx, input.scope, shipment.id, { shipmentId: shipment.id, shipmentCode: shipment.shipmentCode });
      return { shipment: updated, items: input.items, replayed: false, providerReplayed: Boolean(providerResult.replayed) };
    });
  }

  /** Supplier hands the parcel over: exactly-once inventory consumption + shipment state + order projection in ONE transaction (C4/C5). */
  async handoff(input: { actor: ShippingActor; shipmentId: string; trackingCode?: string; trackingUrl?: string; idempotencyKey: string | undefined }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const scope = { scopeType: "shipment", scopeId: input.shipmentId, commandType: "shipping.shipment_handoff", idempotencyKey };
    return this.db.transaction(async (tx: any) => {
      const shipment = await this.shippingService.lockShipment(input.shipmentId, tx);
      // Lock order: child row first (same order as createShipment) — then we already hold the shipment row.
      const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: shipment.childOrderId, executor: tx, lock: true });
      await this.authorizeSeller(input.actor, shipment.sellerId, tx, { mutation: true });
      const claim = await this.shippingService.claimCommand(tx, { ...scope, requestHash: hashShippingRequest({ shipmentId: input.shipmentId, action: "handoff" }) });
      if (claim.state === "completed") return { shipment, replayed: true, consumed: claim.payload?.consumed ?? null };
      if (shipment.status !== "ready") {
        throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Handoff requires status ready (current: ${shipment.status})`);
      }
      const trackingCode = input.trackingCode || shipment.trackingCode || null;
      if (!trackingCode) throw new ShippingDomainError("TRACKING_CODE_REQUIRED", "A tracking code is required to hand a shipment over", 400);
      if (!ctx.parent.financiallyReleased) {
        throw new ShippingDomainError("FINANCIAL_GATE_BLOCKED", `Order ${ctx.parent.id} is ${ctx.parent.status}: handoff not allowed`);
      }

      const items = await this.shippingService.getShipmentItems(input.shipmentId, tx);
      const ordered = this.orderedByItem(ctx);
      const consumed = await this.inventoryService.consumeShipmentAllocation({
        orderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        sellerId: ctx.child.sellerId,
        shipmentId: input.shipmentId,
        lines: items.map((i: any) => ({
          orderItemId: i.wholesaleOrderItemId,
          orderedPieceQuantity: ordered.get(i.wholesaleOrderItemId)?.pieceQuantity ?? 0,
          pieceQuantity: i.pieceQuantity,
        })),
        requester: { userId: input.actor.userId || "system", role: input.actor.role, sellerId: ctx.child.sellerId },
        executor: tx,
      });

      const updated = await this.shippingService.transitionShipment({
        shipmentId: input.shipmentId,
        from: "ready",
        to: "handed_over",
        patch: { trackingCode, trackingUrl: input.trackingUrl || shipment.trackingUrl || null },
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        executor: tx,
      });

      const handedOver = await this.shippingService.getAllocatedQuantitiesForChild(ctx.child.id, tx, HANDED_OVER_STATUSES);
      const fullyShipped = ctx.items.every((item) => (handedOver.get(item.wholesaleOrderItemId) || 0) >= item.pieceQuantity);
      const orderResult = await this.ordersService.recordShipmentHandedOver({
        orderId: ctx.parent.id,
        childOrderId: ctx.child.id,
        shipmentId: input.shipmentId,
        trackingCode,
        fullyShipped,
        actorId: input.actor.userId,
        actorRole: ORDER_ACTOR(input.actor),
        idempotencyKey,
        executor: tx,
      });
      const payload = { shipmentId: input.shipmentId, consumed: consumed.consumed, fullyShipped, childTransitioned: orderResult.transitioned };
      await this.shippingService.completeCommand(tx, scope, input.shipmentId, payload);
      return { shipment: updated, replayed: false, consumed: consumed.consumed, fullyShipped, childTransitioned: orderResult.transitioned };
    });
  }

  /** Pre-handoff cancel: frees only this shipment's allocation (C8); order reservation untouched. */
  async cancelShipment(input: { actor: ShippingActor; shipmentId: string; reason?: string; idempotencyKey: string | undefined }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const scope = { scopeType: "shipment", scopeId: input.shipmentId, commandType: "shipping.shipment_cancel", idempotencyKey };
    const result = await this.db.transaction(async (tx: any) => {
      const shipment = await this.shippingService.lockShipment(input.shipmentId, tx);
      await this.authorizeSeller(input.actor, shipment.sellerId, tx, { mutation: true });
      const claim = await this.shippingService.claimCommand(tx, { ...scope, requestHash: hashShippingRequest({ shipmentId: input.shipmentId, action: "cancel" }) });
      if (claim.state === "completed") return { shipment, replayed: true, provider: null as ShippingProvider | null };
      if (!["pending", "ready"].includes(shipment.status)) {
        throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Shipment ${shipment.status} cannot be cancelled after handoff`);
      }
      const updated = await this.shippingService.transitionShipment({
        shipmentId: input.shipmentId,
        from: shipment.status,
        to: "cancelled",
        actorId: input.actor.userId,
        actorRole: input.actor.role,
        reason: input.reason,
        executor: tx,
      });
      await this.ordersService.recordShipmentStatusEvent({
        childOrderId: shipment.childOrderId,
        shipmentId: input.shipmentId,
        eventType: "shipping.shipment_cancelled",
        actorId: input.actor.userId,
        actorRole: ORDER_ACTOR(input.actor),
        payload: { reason: input.reason || null, previousStatus: shipment.status },
        executor: tx,
      });
      await this.shippingService.completeCommand(tx, scope, input.shipmentId, { shipmentId: input.shipmentId, cancelled: true });
      const provider = shipment.externalReference ? this.resolveProvider(shipment.provider) : null;
      return { shipment: updated, replayed: false, provider };
    });
    // External cancel AFTER commit (no lock held). A failure is durable + reconcilable, never silent.
    if (!result.replayed && result.provider) {
      try {
        const ext = await result.provider.cancelShipment({ shipmentId: input.shipmentId, externalReference: result.shipment.externalReference, reason: input.reason });
        if (!ext.success) {
          await this.shippingService.persistShipmentEvent({ shipmentId: input.shipmentId, provider: result.provider.name, externalEventId: `cancel:${input.shipmentId}`, eventType: "shipment.cancelled", safeMetadata: { reason: ext.failureReason || "provider_cancel_rejected", trigger: "cancel" } });
        }
      } catch (e: any) {
        this.logger.warn(`provider cancel for ${input.shipmentId} failed: ${e?.message || e}`);
        await this.shippingService.persistShipmentEvent({ shipmentId: input.shipmentId, provider: result.provider.name, externalEventId: `cancel:${input.shipmentId}`, eventType: "shipment.cancelled", safeMetadata: { reason: "provider_cancel_error", trigger: "cancel" } });
      }
    }
    return { shipment: result.shipment, replayed: result.replayed };
  }

  /** Delivery changes fulfillment state only — inventory delta 0 (C7). */
  async markDelivered(input: { actor: ShippingActor; shipmentId: string; idempotencyKey: string | undefined; trigger?: string }) {
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    if (!["admin", "system", "finance"].includes(input.actor.role)) throw new ShippingDomainError("ROLE_NOT_ALLOWED", "Only admin or the carrier channel may mark delivery");
    return this.db.transaction(async (tx: any) => this.applyDeliveredInTx(tx, { ...input, idempotencyKey }));
  }

  private async applyDeliveredInTx(tx: any, input: { actor: ShippingActor; shipmentId: string; idempotencyKey: string; trigger?: string }) {
    const shipment = await this.shippingService.lockShipment(input.shipmentId, tx);
    const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: shipment.childOrderId, executor: tx, lock: true });
    if (shipment.status === "delivered") return { shipment, replayed: true, fullyDelivered: null as boolean | null };
    if (!["handed_over", "in_transit"].includes(shipment.status)) {
      throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Delivery requires handed_over/in_transit (current: ${shipment.status})`);
    }
    const updated = await this.shippingService.transitionShipment({
      shipmentId: input.shipmentId,
      from: shipment.status,
      to: "delivered",
      actorId: input.actor.userId,
      actorRole: input.actor.role,
      reason: input.trigger || "manual",
      executor: tx,
    });
    const delivered = await this.shippingService.getAllocatedQuantitiesForChild(ctx.child.id, tx, ["delivered"]);
    const fullyDelivered = ctx.items.every((item) => (delivered.get(item.wholesaleOrderItemId) || 0) >= item.pieceQuantity);
    const orderResult = await this.ordersService.recordShipmentDelivered({
      orderId: ctx.parent.id,
      childOrderId: ctx.child.id,
      shipmentId: input.shipmentId,
      fullyDelivered,
      actorId: input.actor.userId,
      actorRole: ORDER_ACTOR(input.actor),
      idempotencyKey: input.idempotencyKey,
      executor: tx,
    });
    return { shipment: updated, replayed: false, fullyDelivered, childTransitioned: orderResult.transitioned };
  }

  async updateTracking(input: { actor: ShippingActor; shipmentId: string; trackingCode?: string; trackingUrl?: string; idempotencyKey: string | undefined }) {
    requireIdempotencyKey(input.idempotencyKey);
    return this.db.transaction(async (tx: any) => {
      const shipment = await this.shippingService.lockShipment(input.shipmentId, tx);
      await this.authorizeSeller(input.actor, shipment.sellerId, tx, { mutation: true });
      if (["delivered", "cancelled", "failed"].includes(shipment.status)) {
        throw new ShippingDomainError("INVALID_SHIPMENT_TRANSITION", `Tracking of a ${shipment.status} shipment is immutable`);
      }
      const updated = await this.shippingService.updateTracking({ shipmentId: input.shipmentId, trackingCode: input.trackingCode ?? null, trackingUrl: input.trackingUrl ?? null, executor: tx });
      return { shipment: updated };
    });
  }

  // ── carrier events: webhook inbox + reconciliation (B16–B18) ──────────
  private eventTypeFor(state: CarrierState): string {
    switch (state) {
      case "created": return "shipment.created";
      case "in_transit": return "shipment.in_transit";
      case "delivered": return "shipment.delivered";
      case "failed": return "shipment.failed";
      case "cancelled": return "shipment.cancelled";
      default: return "unknown";
    }
  }

  async ingestWebhook(input: { provider: string; request: { headers: Record<string, string | string[] | undefined>; body: unknown } }) {
    const adapter = this.resolveProvider(input.provider);
    if (!adapter.supportsWebhooks || !adapter.parseWebhook) {
      throw new ShippingDomainError("PROVIDER_NOT_ALLOWED", `Shipping provider ${adapter.name} has no webhook channel`);
    }
    const normalized = adapter.parseWebhook(input.request);
    if (!normalized) throw new ShippingDomainError("WEBHOOK_SIGNATURE_INVALID", "Webhook authentication failed");
    const shipment = await this.shippingService.findShipmentByProviderReference({ provider: adapter.name, externalReference: normalized.externalReference, trackingCode: normalized.trackingCode });
    const persisted = await this.shippingService.persistShipmentEvent({
      shipmentId: shipment?.id ?? null,
      provider: adapter.name,
      externalEventId: normalized.externalEventId,
      eventType: this.eventTypeFor(normalized.reportedState),
      safeMetadata: { ...normalized.safeMetadata, trigger: "webhook" },
    });
    if (persisted.duplicate && ["processed", "ignored"].includes(persisted.status)) {
      return { duplicate: true, outcome: { eventId: persisted.id, status: persisted.status as string, reason: "already_final" } };
    }
    const outcome = await this.processShipmentEvent(persisted.id);
    return { duplicate: persisted.duplicate, outcome };
  }

  /** claim → provider tracking (no lock) → canonical transition + order projection + processed, in one transaction. */
  async processShipmentEvent(eventId: string): Promise<{ eventId: string; status: string; reason?: string; shipmentId?: string | null }> {
    const claim = await this.shippingService.claimShipmentEvent(eventId);
    if (!claim.claimed) return { eventId, status: claim.status, reason: claim.status === "processing" ? "claimed_by_another_worker" : "already_final" };
    const event = await this.shippingService.getShipmentEventById(eventId);
    if (!event) return { eventId, status: "failed", reason: "SHIPMENT_EVENT_NOT_FOUND" };
    const finish = (status: "processed" | "ignored" | "failed", reason?: string, shipmentId?: string | null, tx?: any) =>
      this.shippingService.finishShipmentEvent({ eventId, status, failureReason: reason ?? null, shipmentId: shipmentId ?? null, executor: tx }).then(() => ({ eventId, status, reason, shipmentId: shipmentId ?? null }));

    try {
      const meta = (event.safeMetadata || {}) as Record<string, any>;
      const shipment = event.shipmentId
        ? (await this.shippingService.getShipmentById(event.shipmentId)).shipment
        : await this.shippingService.findShipmentByProviderReference({ provider: event.provider, externalReference: meta.externalReference ?? null, trackingCode: meta.trackingCode ?? null });
      if (!shipment) return finish("ignored", "unmapped_reference");
      if (shipment.provider !== event.provider) return finish("ignored", "provider_mismatch", shipment.id);
      const adapter = this.resolveProvider(event.provider);

      // Provider is the source of truth for the state — queried with NO lock held.
      const tracking = await adapter.getTracking({ shipmentId: shipment.id, externalReference: shipment.externalReference, trackingCode: shipment.trackingCode });
      if (tracking.externalReference && shipment.externalReference && tracking.externalReference !== shipment.externalReference) {
        return finish("failed", "PROVIDER_REFERENCE_MISMATCH", shipment.id);
      }
      return await this.applyCarrierState({ shipmentId: shipment.id, state: tracking.state, eventId, finish });
    } catch (e: any) {
      const reason = e?.code ? `${e.code}: ${e.message}` : String(e?.message || e);
      this.logger.warn(`shipment event ${eventId} failed: ${reason}`);
      return finish("failed", reason.slice(0, 500));
    }
  }

  private async applyCarrierState(input: {
    shipmentId: string;
    state: CarrierState;
    eventId: string | null;
    finish: (status: "processed" | "ignored" | "failed", reason?: string, shipmentId?: string | null, tx?: any) => Promise<any>;
  }) {
    const system: ShippingActor = { userId: null, role: "system" };
    return this.db.transaction(async (tx: any) => {
      const shipment = await this.shippingService.lockShipment(input.shipmentId, tx);
      const { state } = input;
      if (state === "unknown" || state === "created") return input.finish("ignored", `carrier_state_${state}`, shipment.id, tx);
      if (["delivered", "cancelled", "failed"].includes(shipment.status)) return input.finish("processed", `already_${shipment.status}`, shipment.id, tx);
      if (["pending", "ready"].includes(shipment.status)) {
        if (state === "cancelled") {
          await this.shippingService.transitionShipment({ shipmentId: shipment.id, from: shipment.status, to: "cancelled", actorId: null, actorRole: "system", reason: "carrier_cancelled", executor: tx });
          await this.ordersService.recordShipmentStatusEvent({ childOrderId: shipment.childOrderId, shipmentId: shipment.id, eventType: "shipping.shipment_cancelled", actorId: null, actorRole: "system", payload: { reason: "carrier_cancelled" }, executor: tx });
          return input.finish("processed", "carrier_cancelled", shipment.id, tx);
        }
        // Goods cannot be in transit before the supplier recorded the handoff (inventory!). Keep the fact, wait for handoff.
        return input.finish("ignored", "handoff_not_recorded", shipment.id, tx);
      }
      // handed_over / in_transit
      if (state === "in_transit") {
        if (shipment.status === "handed_over") {
          await this.shippingService.transitionShipment({ shipmentId: shipment.id, from: "handed_over", to: "in_transit", actorId: null, actorRole: "system", reason: "carrier_in_transit", executor: tx });
          await this.ordersService.recordShipmentStatusEvent({ childOrderId: shipment.childOrderId, shipmentId: shipment.id, eventType: "shipping.shipment_in_transit", actorId: null, actorRole: "system", executor: tx });
        }
        return input.finish("processed", undefined, shipment.id, tx);
      }
      if (state === "delivered") {
        await this.applyDeliveredInTx(tx, { actor: system, shipmentId: shipment.id, idempotencyKey: `carrier:${input.eventId || "reconcile"}:${shipment.id}`, trigger: "carrier" });
        return input.finish("processed", undefined, shipment.id, tx);
      }
      if (state === "failed" || state === "cancelled") {
        // B14 post-handoff failure: explicit, recoverable operational exception — never a silent success.
        await this.shippingService.transitionShipment({ shipmentId: shipment.id, from: shipment.status, to: "failed", patch: { failureReason: `carrier_${state}` }, actorId: null, actorRole: "system", reason: `carrier_${state}`, executor: tx });
        await this.ordersService.recordShipmentStatusEvent({ childOrderId: shipment.childOrderId, shipmentId: shipment.id, eventType: "shipping.shipment_failed", actorId: null, actorRole: "system", payload: { reason: `carrier_${state}`, postHandoff: true }, executor: tx });
        return input.finish("processed", `carrier_${state}`, shipment.id, tx);
      }
      return input.finish("ignored", `carrier_state_${state}`, shipment.id, tx);
    });
  }

  /**
   * B18 — reconciliation: re-drives failed/received events, reclaims stale
   * processing rows, finishes shipments whose TxB never ran (same idempotency
   * identity → provider returns the existing external shipment) and pulls the
   * carrier state of in-flight shipments. Provider I/O never runs under a lock.
   */
  async reconcile(input: { provider?: string; limit?: number; staleProcessingMinutes?: number; pendingOlderThanSeconds?: number } = {}) {
    const limit = Math.max(1, Math.min(200, input.limit ?? 50));
    const providers = input.provider ? [this.resolveProvider(input.provider)] : this.providerRegistry.list().filter((n) => this.providerRegistry.isEnabled(n)).map((n) => this.resolveProvider(n));
    const summary = { reclaimed: 0, events: [] as any[], shipments: [] as any[] };
    summary.reclaimed = await this.shippingService.reclaimStaleProcessingEvents(input.staleProcessingMinutes ?? 15);
    for (const provider of providers) {
      const events = await this.shippingService.findUnresolvedShipmentEvents({ provider: provider.name, limit });
      for (const ev of events) summary.events.push(await this.processShipmentEvent(ev.id));
      if (provider.name === "manual") continue; // manual tracking is never authoritative
      const shipments = await this.shippingService.findShipmentsNeedingReconciliation({ provider: provider.name, limit, pendingOlderThanSeconds: input.pendingOlderThanSeconds ?? 60 });
      for (const shipment of shipments) {
        try {
          if (shipment.status === "pending") {
            const items = await this.shippingService.getShipmentItems(shipment.id);
            const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: shipment.childOrderId });
            const result = await this.finalizePendingShipment({ shipment, items, ctx, provider, actor: { userId: null, role: "system" } });
            summary.shipments.push({ shipmentId: shipment.id, action: "finalized", status: result.shipment.status, providerReplayed: result.providerReplayed });
            continue;
          }
          const tracking = await provider.getTracking({ shipmentId: shipment.id, externalReference: shipment.externalReference, trackingCode: shipment.trackingCode });
          const outcome = await this.applyCarrierState({
            shipmentId: shipment.id,
            state: tracking.state,
            eventId: null,
            finish: async (status, reason, shipmentId) => ({ eventId: null, status, reason, shipmentId }),
          });
          summary.shipments.push({ shipmentId: shipment.id, action: "tracked", carrierState: tracking.state, ...outcome });
        } catch (e: any) {
          summary.shipments.push({ shipmentId: shipment.id, action: "failed", reason: String(e?.message || e).slice(0, 300) });
        }
      }
    }
    return summary;
  }

  // ── read models ───────────────────────────────────────────────────────
  /** B19 — buyer-safe tracking: real tracking code/url, no provider secrets, no raw payloads, no address echo. */
  private toBuyerView(s: any, items?: any[]) {
    return {
      id: s.id,
      shipmentCode: s.shipmentCode,
      childOrderId: s.childOrderId,
      sellerId: s.sellerId,
      status: s.status,
      provider: s.provider,
      carrierDisplayName: s.provider === "manual" ? "ارسال توسط فروشنده" : String(s.provider).toUpperCase(),
      shippingResponsibility: s.shippingResponsibility,
      trackingCode: s.trackingCode || null,
      trackingUrl: s.trackingUrl || null,
      handedOverAt: s.handedOverAt || null,
      shippedAt: s.shippedAt || null,
      deliveredAt: s.deliveredAt || null,
      cancelledAt: s.cancelledAt || null,
      createdAt: s.createdAt,
      items: (items || []).map((it: any) => ({ wholesaleOrderItemId: it.wholesaleOrderItemId, variantId: it.variantId || null, pieceQuantity: it.pieceQuantity })),
    };
  }

  async getBuyerShipments(input: { orderId: string; buyerUserId: string }) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: input.orderId, buyerUserId: input.buyerUserId });
    const shipments = await this.shippingService.listShipmentsForOrder(input.orderId);
    const out = [];
    for (const s of shipments) out.push(this.toBuyerView(s, await this.shippingService.getShipmentItems(s.id)));
    return { shipments: out };
  }

  async getBuyerShipment(input: { orderId: string; shipmentId: string; buyerUserId: string }) {
    await this.ordersService.getWholesaleOrderDetailForBuyer({ orderId: input.orderId, buyerUserId: input.buyerUserId });
    const { shipment, items } = await this.shippingService.getShipmentById(input.shipmentId);
    if (shipment.wholesaleOrderId !== input.orderId) throw new ShippingDomainError("SHIPMENT_ORDER_MISMATCH", "Shipment does not belong to this order");
    return { shipment: this.toBuyerView(shipment, items) };
  }

  async getShipmentForActor(input: { actor: ShippingActor; shipmentId: string }) {
    const { shipment, items } = await this.shippingService.getShipmentById(input.shipmentId);
    await this.authorizeSeller(input.actor, shipment.sellerId, undefined, { mutation: false });
    const events = await this.shippingService.listShipmentEvents(input.shipmentId);
    return { shipment, items, events: events.map((e: any) => ({ id: e.id, eventType: e.eventType, status: e.status, receivedAt: e.receivedAt, processedAt: e.processedAt, failureReason: e.failureReason })) };
  }

  async listShipmentsForChildForActor(input: { actor: ShippingActor; childOrderId: string }) {
    const ctx = await this.ordersService.getChildOrderShippingContext({ childOrderId: input.childOrderId });
    await this.authorizeSeller(input.actor, ctx.child.sellerId, undefined, { mutation: false });
    return { shipments: await this.shippingService.listShipmentsForChild(input.childOrderId), quotes: await this.shippingService.listQuotesForChild(input.childOrderId) };
  }

  async listShipmentsForOrderForAdmin(input: { actor: ShippingActor; wholesaleOrderId?: string; childOrderId?: string }) {
    if (!["admin", "finance"].includes(input.actor.role)) throw new ShippingDomainError("ROLE_NOT_ALLOWED", "Admin only");
    if (input.wholesaleOrderId) return { shipments: await this.shippingService.listShipmentsForOrder(input.wholesaleOrderId) };
    if (input.childOrderId) return { shipments: await this.shippingService.listShipmentsForChild(input.childOrderId) };
    return { shipments: [] };
  }
}
