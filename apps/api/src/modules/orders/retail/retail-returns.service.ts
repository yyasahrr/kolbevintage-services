import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  RETAIL_INSPECTION_DECISIONS,
  RETAIL_RETURN_REASONS,
  RETAIL_RETURN_STATUSES,
  RETAIL_RETURN_TRANSITIONS,
} from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../../database/database.module";
import { AuditService } from "../../audit/audit.service";
import { InventoryService } from "../../inventory/inventory.service";
import { OffersService } from "../../offers/offers.service";
import { ShippingService } from "../../shipping/shipping.service";
import { SupportCaseService } from "../../support/support-case.service";
import { SupportSlaService } from "../../support/support-sla.service";
import { RetailOrdersRepository } from "./retail-orders.repository";
import { RetailOrdersService } from "./retail-orders.service";
import { RetailDomainError, type RetailReturnLineInput, type RetailReturnView } from "./retail-orders.contract";
import { RetailReturnsRepository } from "./retail-returns.repository";

function makeReturnId(): string {
  return `rret_${randomUUID().replaceAll("-", "")}`;
}

function makeReturnItemId(): string {
  return `rri_${randomUUID().replaceAll("-", "")}`;
}

function makeReturnEventId(): string {
  return `rrv_${randomUUID().replaceAll("-", "")}`;
}

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const iso = (value: unknown): string | null => (value ? new Date(value as any).toISOString() : null);

function parseReturnIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new RetailDomainError("RETAIL_IDEMPOTENCY_KEY_INVALID", "Idempotency-Key is malformed");
  }
  return key;
}

function returnRequestHash(reason: string, note: string | null, lines: RetailReturnLineInput[]): string {
  const canonical = JSON.stringify({
    reason,
    note,
    lines: [...lines]
      .map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity }))
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Phase 5.9-B — retail returns orchestration (orders-owned, retail slice).
 *
 * Customers file/withdraw through the customer-account façade; staff drive
 * the APPROVED → … → RESTOCKED/REJECTED graph through the service seam
 * (no Admin HTTP in this phase). Every filed return opens a RETURN-category
 * support case in the SAME transaction; the SLA snapshot follows post-commit
 * (enrichment must not fail or duplicate the commercial fact).
 */
@Injectable()
export class RetailReturnsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(RetailReturnsRepository) private readonly repo: RetailReturnsRepository,
    @Inject(RetailOrdersRepository) private readonly orders: RetailOrdersRepository,
    @Inject(RetailOrdersService) private readonly retailOrders: RetailOrdersService,
    @Inject(ShippingService) private readonly shipping: ShippingService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(SupportCaseService) private readonly cases: SupportCaseService,
    @Inject(SupportSlaService) private readonly sla: SupportSlaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * File a return against a DELIVERED order. Gates: ownership, delivered
   * state, in-order lines, and per-line
   * requested ≤ delivered − active-requested.
   */
  async fileRetailReturn(
    actor: { actorId: string | null; actorRole: string },
    orderId: string,
    input: { lines?: unknown; reason?: unknown; note?: unknown; idempotencyKey?: unknown },
  ): Promise<RetailReturnView & { replayed: boolean }> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new RetailDomainError("RETAIL_ORDER_NOT_FOUND", "retail order not found");
    this.assertReturnOwner(order, actor);
    this.assertDeliveredForReturn(order);
    const lines = this.parseLines(input.lines);
    const reason = typeof input.reason === "string" ? input.reason : "";
    if (!(RETAIL_RETURN_REASONS as readonly string[]).includes(reason)) {
      throw new RetailDomainError("RETAIL_RETURN_REASON_INVALID", `return reason must be one of ${RETAIL_RETURN_REASONS.join(", ")}`);
    }
    const note = text(input.note, 512).replace(/[<>]/g, "") || null;
    const idempotencyKey = parseReturnIdempotencyKey(input.idempotencyKey);
    const requestHash = returnRequestHash(reason, note, lines);
    // A committed replay must win before returnability preflight: the first
    // filing intentionally encumbers the units, so evaluating quantity first
    // would turn an otherwise identical retry into a false over-return.
    if (idempotencyKey) {
      const existing = await this.repo.findByCustomerOrderIdempotencyKey(actor.actorId!, orderId, idempotencyKey);
      if (existing) {
        if (existing.creationRequestHash !== requestHash) {
          throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different return request");
        }
        return { ...(await this.presentReturn(undefined, existing.id)), replayed: true };
      }
    }

    const orderItems = (await this.orders.findItemsByOrderId(orderId)) as any[];
    const lineOf = new Map(orderItems.map((line) => [line.id, line]));
    for (const line of lines) {
      // Same code for foreign ids and malformed ids: no cross-order oracle.
      if (!lineOf.has(line.orderItemId)) {
        throw new RetailDomainError("RETAIL_RETURN_LINE_INVALID", `line ${line.orderItemId} is not part of this order`);
      }
    }
    const delivered = await this.deliveredQuantities(orderId, undefined);
    const encumbered = await this.encumberedQuantities(orderId, undefined);
    for (const line of lines) {
      const returnable = (delivered.get(line.orderItemId) ?? 0) - (encumbered.get(line.orderItemId) ?? 0);
      if (line.quantity > returnable) {
        throw new RetailDomainError(
          "RETAIL_RETURN_QUANTITY_EXCEEDED",
          `line ${line.orderItemId}: requested ${line.quantity} but only ${Math.max(returnable, 0)} delivered-and-unreturned`,
        );
      }
    }

    const filed = await this.db.transaction(async (tx) => {
      // Serialize concurrent filings on one order: the loser blocks here,
      // then sees the winner's rows in the re-read below.
      await this.orders.advisoryLock(`return:${orderId}`, tx);
      if (idempotencyKey) {
        const existing = await this.repo.findByCustomerOrderIdempotencyKey(actor.actorId!, orderId, idempotencyKey, tx);
        if (existing) {
          if (existing.creationRequestHash !== requestHash) {
            throw new RetailDomainError("RETAIL_IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different return request");
          }
          return { id: existing.id, supportCaseId: existing.supportCaseId, replayed: true };
        }
      }
      const reDelivered = await this.deliveredQuantities(orderId, tx);
      const reEncumbered = await this.encumberedQuantities(orderId, tx);
      for (const line of lines) {
        const returnable = (reDelivered.get(line.orderItemId) ?? 0) - (reEncumbered.get(line.orderItemId) ?? 0);
        if (line.quantity > returnable) {
          throw new RetailDomainError(
            "RETAIL_RETURN_QUANTITY_EXCEEDED",
            `line ${line.orderItemId}: requested ${line.quantity} but only ${Math.max(returnable, 0)} delivered-and-unreturned`,
          );
        }
      }
      const supportCase = await this.cases.createCase(
        {
          requesterType: "RETAIL_CUSTOMER",
          requesterUserId: (order as any).customerId,
          category: "RETURN",
          subject: `Return request for order ${(order as any).orderCode}`,
          priority: "NORMAL",
          source: "PORTAL",
          initialMessage: note ?? `Return filed (${reason}).`,
          relations: [
            { relationType: "ORDER", targetId: (order as any).id, metadata: { order_code: (order as any).orderCode } },
            ...lines.map((line) => ({
              relationType: "ORDER_ITEM" as const,
              targetId: (order as any).id,
              itemId: line.orderItemId,
              quantity: line.quantity,
            })),
          ],
        },
        tx,
      );
      const id = makeReturnId();
      await this.repo.insertRequest(
        {
          id,
          orderId: (order as any).id,
          customerId: (order as any).customerId,
          status: "REQUESTED",
          reason,
          note,
          idempotencyKey,
          creationRequestHash: idempotencyKey ? requestHash : null,
          supportCaseId: supportCase.id,
          version: 0,
        },
        tx,
      );
      await this.repo.insertItems(
        lines.map((line) => ({ id: makeReturnItemId(), returnId: id, orderItemId: line.orderItemId, quantity: line.quantity })),
        tx,
      );
      await this.repo.insertEvent(
        {
          id: makeReturnEventId(),
          returnId: id,
          fromStatus: null,
          toStatus: "REQUESTED",
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          reason,
          metadata: { lines: lines.length, support_case_id: supportCase.id },
          returnVersion: 0,
          idempotencyKey: null,
        },
        tx,
      );
      await this.audit.record(
        {
          actorId: actor.actorId ?? "system",
          actorRole: actor.actorRole,
          action: "retail_return.filed",
          entityType: "retail_return_request",
          entityId: id,
          after: { order_id: (order as any).id, reason, lines: lines.length, support_case_id: supportCase.id },
        },
        tx,
      );
      return { id, supportCaseId: supportCase.id, replayed: false };
    });

    if (filed.replayed) {
      return { ...(await this.presentReturn(undefined, filed.id)), replayed: true };
    }

    // Post-commit enrichment: an SLA failure must neither fail the filing
    // the client already paid for conceptually, nor (on retry) duplicate
    // the return. The deferral itself is audited.
    try {
      await this.sla.applySlaToCase(filed.supportCaseId);
    } catch (error) {
      await this.audit.record({
        actorId: "system",
        actorRole: "system",
        action: "retail_return.sla_deferred",
        entityType: "retail_return_request",
        entityId: filed.id,
        metadata: { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
      });
    }
    return { ...(await this.presentReturn(undefined, filed.id)), replayed: false };
  }

  /** Customer return list page (own returns only). Keyset, newest first. */
  async listCustomerRetailReturns(
    customerId: string,
    input: { limit?: unknown; cursor?: unknown },
  ): Promise<{ returns: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? input.limit : 20;
    if (limit < 1 || limit > 100) {
      throw new RetailDomainError("RETAIL_CUSTOMER_LIMIT_INVALID", "history limit must be between 1 and 100");
    }
    const cursor = input.cursor === undefined || input.cursor === null ? null : this.decodeCursor(input.cursor);
    const rows = (await this.repo.listByCustomerId(customerId, limit, cursor)) as any[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const items = (await this.repo.findItemsByReturnIds(page.map((row) => row.id))) as any[];
    const countOf = new Map<string, number>();
    for (const item of items) countOf.set(item.returnId, (countOf.get(item.returnId) ?? 0) + 1);
    return {
      returns: page.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        status: row.status,
        reason: row.reason,
        lineCount: countOf.get(row.id) ?? 0,
        supportCaseId: row.supportCaseId,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      nextCursor: rows.length > limit && last ? this.encodeCursor(new Date(last.createdAt).toISOString(), last.id) : null,
    };
  }

  /** Return detail (owner or admin). Lines enriched with order-line facts. */
  async getRetailReturn(viewer: { userId: string; role: string }, returnId: string): Promise<RetailReturnView> {
    const request = await this.repo.findRequestById(returnId);
    if (!request) throw new RetailDomainError("RETAIL_RETURN_NOT_FOUND", "retail return not found");
    if (viewer.role !== "admin" && (request as any).customerId !== viewer.userId) {
      throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", "this return belongs to another customer");
    }
    return this.presentReturn(undefined, (request as any).id);
  }

  /**
   * Customer withdrawal (owner only — staff express refusal as REJECTED
   * with a reason, which is more honest than a silent withdrawal).
   */
  async withdrawRetailReturn(
    actor: { actorId: string | null; actorRole: string },
    returnId: string,
  ): Promise<RetailReturnView> {
    this.assertReturnCustomer(actor);
    return this.db.transaction(async (tx) => {
      const request = await this.repo.findRequestByIdForUpdate(returnId, tx);
      if (!request) throw new RetailDomainError("RETAIL_RETURN_NOT_FOUND", "retail return not found");
      if ((request as any).customerId !== actor.actorId) {
        throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", "this return belongs to another customer");
      }
      if ((request as any).status !== "REQUESTED" && (request as any).status !== "APPROVED") {
        throw new RetailDomainError(
          "RETAIL_RETURN_TRANSITION_INVALID",
          `return cannot be withdrawn from ${(request as any).status}`,
        );
      }
      await this.applyTransition(tx, request as any, "WITHDRAWN", actor, { reason: "customer_withdrawn" });
      return this.presentReturn(tx, (request as any).id);
    });
  }

  /**
   * Staff transition seam (service-level only — no Admin HTTP in this
   * phase). RECEIVED stamps arrival; INSPECTED requires a decision;
   * RESTOCKED requires RESTOCKABLE and restocks exactly once, then moves
   * the order delivered → returned (skipped when a sibling already did).
   */
  /** Phase 5.11-C — staff return queue (slim rows, keyset page). */
  async listRetailReturnsForStaff(
    actor: { actorId: string | null; actorRole: string },
    input: { status?: string; limit?: number; cursor?: { createdAt: string; id: string } | null },
  ): Promise<{ returns: Array<Record<string, unknown>>; nextCursor: { createdAt: string; id: string } | null; hasMore: boolean }> {
    this.assertStaff(actor);
    const limit = Math.min(Math.max(Number.isSafeInteger(input.limit) ? (input.limit as number) : 20, 1), 100);
    const cursor: [string, string] | null = input.cursor ? [input.cursor.createdAt, input.cursor.id] : null;
    const rows = (await this.repo.listForStaff(input.status, limit, cursor)) as any[];
    const page = rows.slice(0, limit);
    const returns = page.map((request) => ({
      id: request.id,
      orderId: request.orderId,
      customerId: request.customerId,
      status: request.status,
      reason: request.reason,
      inspectionDecision: request.inspectionDecision ?? null,
      version: request.version,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }));
    const last = page[page.length - 1] as any;
    const hasMore = rows.length > limit;
    return { returns, nextCursor: hasMore && last ? { createdAt: new Date(last.createdAt).toISOString(), id: last.id } : null, hasMore };
  }

  async transitionRetailReturn(
    returnId: string,
    toStatus: unknown,
    staff: { actorId: string | null; actorRole: string; reason?: string; inspectionDecision?: unknown },
  ): Promise<RetailReturnView> {
    this.assertStaff(staff);
    const to = typeof toStatus === "string" ? toStatus : "";
    if (!(RETAIL_RETURN_STATUSES as readonly string[]).includes(to)) {
      throw new RetailDomainError("RETAIL_RETURN_TRANSITION_INVALID", "unknown retail return status");
    }
    if (to === "WITHDRAWN") {
      throw new RetailDomainError("RETAIL_RETURN_TRANSITION_INVALID", "WITHDRAWN is customer-only; staff reject with a reason");
    }
    return this.db.transaction(async (tx) => {
      const request = (await this.repo.findRequestByIdForUpdate(returnId, tx)) as any;
      if (!request) throw new RetailDomainError("RETAIL_RETURN_NOT_FOUND", "retail return not found");
      const allowed = (RETAIL_RETURN_TRANSITIONS as Record<string, readonly string[]>)[request.status] ?? [];
      if (!allowed.includes(to)) {
        throw new RetailDomainError("RETAIL_RETURN_TRANSITION_INVALID", `transition ${request.status} -> ${to} is not allowed`);
      }
      if (to === "REJECTED") {
        const reason = text(staff.reason, 512).replace(/[<>]/g, "");
        if (!reason) {
          throw new RetailDomainError("RETAIL_RETURN_REJECT_REASON_REQUIRED", "rejecting a return requires a reason");
        }
        await this.applyTransition(tx, request, to, staff, { reason });
      } else if (to === "INSPECTED") {
        const decision = typeof staff.inspectionDecision === "string" ? staff.inspectionDecision : "";
        if (!(RETAIL_INSPECTION_DECISIONS as readonly string[]).includes(decision)) {
          throw new RetailDomainError(
            "RETAIL_RETURN_INSPECTION_REQUIRED",
            `inspection requires a decision: ${RETAIL_INSPECTION_DECISIONS.join(", ")}`,
          );
        }
        await this.applyTransition(tx, request, to, staff, {
          reason: text(staff.reason, 512).replace(/[<>]/g, "") || null,
          inspectedAt: new Date(),
          inspectionDecision: decision,
        });
      } else if (to === "RESTOCKED") {
        if (request.inspectionDecision !== "RESTOCKABLE") {
          throw new RetailDomainError(
            "RETAIL_RETURN_NOT_RESTOCKABLE",
            "only returns inspected RESTOCKABLE may restock; reject the rest with a reason",
          );
        }
        await this.restockReturn(tx, request, staff);
        await this.applyTransition(tx, request, to, staff, { reason: text(staff.reason, 512).replace(/[<>]/g, "") || null });
        await this.markOrderReturned(tx, request, staff);
      } else {
        await this.applyTransition(tx, request, to, staff, {
          reason: text(staff.reason, 512).replace(/[<>]/g, "") || null,
          receivedAt: to === "RECEIVED" ? new Date() : undefined,
        });
      }
      return this.presentReturn(tx, request.id);
    });
  }

  private async applyTransition(
    tx: any,
    request: any,
    to: string,
    actor: { actorId: string | null; actorRole: string },
    extra: { reason?: string | null; receivedAt?: Date; inspectedAt?: Date; inspectionDecision?: string },
  ): Promise<void> {
    const patch: Record<string, unknown> = { status: to };
    if (extra.receivedAt !== undefined) patch.receivedAt = extra.receivedAt;
    if (extra.inspectedAt !== undefined) patch.inspectedAt = extra.inspectedAt;
    if (extra.inspectionDecision !== undefined) patch.inspectionDecision = extra.inspectionDecision;
    const updated = await this.repo.updateRequestVersioned(request.id, request.version, patch as any, tx);
    if (!updated) {
      throw new RetailDomainError("RETAIL_RETURN_TRANSITION_INVALID", "return changed concurrently; reload and retry");
    }
    await this.repo.insertEvent(
      {
        id: makeReturnEventId(),
        returnId: request.id,
        fromStatus: request.status,
        toStatus: to,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        reason: extra.reason ?? null,
        metadata: {},
        returnVersion: (updated as any).version,
        idempotencyKey: null,
      },
      tx,
    );
    await this.audit.record(
      {
        actorId: actor.actorId ?? "system",
        actorRole: actor.actorRole,
        action: "retail_return.status_changed",
        entityType: "retail_return_request",
        entityId: request.id,
        before: { status: request.status },
        after: { status: to },
      },
      tx,
    );
  }

  /** Restock each line through the Inventory owner, exactly once. */
  private async restockReturn(tx: any, request: any, staff: { actorId: string | null; actorRole: string }): Promise<void> {
    const kolbeSellerId = await this.offers.ensureSeller(null, "KOLBE");
    const items = (await this.repo.findItemsByReturnId(request.id, tx)) as any[];
    const orderItems = (await this.orders.findItemsByOrderId(request.orderId, tx)) as any[];
    const lineOf = new Map(orderItems.map((line) => [line.id, line]));
    const requester = { userId: "system", role: "system", principalType: "system" as const };
    for (const item of items) {
      const line = lineOf.get(item.orderItemId) as any;
      if (!line?.variantId) {
        throw new RetailDomainError("RETAIL_VARIANT_MISMATCH", `return line ${item.orderItemId} has no variant to restock`);
      }
      await this.inventory.upsertVariantInventory({
        variantId: line.variantId,
        sellerId: kolbeSellerId,
        onHandDelta: item.quantity,
        reason: `retail return restock -> ${request.id}`,
        requester,
        idempotencyKey: `${request.id}:restock:${item.id}`,
        executor: tx,
      });
    }
  }

  private async markOrderReturned(tx: any, request: any, staff: { actorId: string | null; actorRole: string }): Promise<void> {
    const order = (await this.orders.findById(request.orderId, tx)) as any;
    if (!order || order.orderStatus === "returned") return; // Sibling return already moved it.
    if (order.orderStatus !== "delivered") {
      throw new RetailDomainError(
        "RETAIL_RETURN_TRANSITION_INVALID",
        `cannot complete a return while its order is ${order.orderStatus}`,
      );
    }
    await this.retailOrders.transitionOrder(request.orderId, "returned", { actorId: staff.actorId, actorRole: staff.actorRole, reason: `return_completed:${request.id}` }, tx);
  }

  /** Σ pieceQuantity per order line over DELIVERED shipments only. */
  private async deliveredQuantities(orderId: string, executor: any): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    const shipments = (await this.shipping.listRetailShipments(orderId, executor)) as any[];
    for (const row of shipments) {
      if (row.status !== "delivered") continue;
      const full = await this.shipping.getRetailShipmentById(row.id, executor);
      for (const item of (full.items as any[]) ?? []) {
        if (!item.retailOrderItemId) continue;
        totals.set(item.retailOrderItemId, (totals.get(item.retailOrderItemId) ?? 0) + Number(item.pieceQuantity ?? 0));
      }
    }
    return totals;
  }

  /** Σ requested quantity per order line over non-closed returns. */
  private async encumberedQuantities(orderId: string, executor: any): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    const active = (await this.repo.findActiveByOrderId(orderId, executor)) as any[];
    const items = (await this.repo.findItemsByReturnIds(active.map((row) => row.id), executor)) as any[];
    for (const item of items) {
      totals.set(item.orderItemId, (totals.get(item.orderItemId) ?? 0) + Number(item.quantity ?? 0));
    }
    return totals;
  }

  private parseLines(input: unknown): RetailReturnLineInput[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new RetailDomainError("RETAIL_RETURN_LINES_REQUIRED", "a return must name at least one order line");
    }
    if (input.length > 50) {
      throw new RetailDomainError("RETAIL_RETURN_LINES_REQUIRED", "a return covers at most 50 lines");
    }
    const seen = new Set<string>();
    return (input as unknown[]).map((raw) => {
      const record = (raw ?? {}) as Record<string, unknown>;
      const orderItemId = typeof record.orderItemId === "string" ? record.orderItemId.trim().slice(0, 80) : "";
      const quantity = record.quantity;
      if (!orderItemId) throw new RetailDomainError("RETAIL_RETURN_LINE_INVALID", "each return line needs an order item id");
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
        throw new RetailDomainError("RETAIL_RETURN_QUANTITY_INVALID", `line ${orderItemId}: quantity must be a positive integer`);
      }
      if (seen.has(orderItemId)) {
        throw new RetailDomainError("RETAIL_RETURN_LINE_INVALID", `line ${orderItemId} is listed twice; merge into one row`);
      }
      seen.add(orderItemId);
      return { orderItemId, quantity };
    });
  }

  private assertDeliveredForReturn(order: any): void {
    const status = order.orderStatus as string;
    // `returned` means "has a completed return", not "fully returned":
    // sibling filings for still-unreturned units are welcome (the
    // per-line math below is the guard, not the coarse order status).
    if (status === "delivered" || status === "returned") return;
    if (status === "placed" || status === "confirmed" || status === "packed") {
      throw new RetailDomainError("RETAIL_RETURN_ORDER_NOT_DELIVERED", `order is ${status}; cancel it instead of filing a return`);
    }
    if (status === "shipped") {
      throw new RetailDomainError("RETAIL_RETURN_ORDER_NOT_DELIVERED", "order is still in transit; file a return once it is delivered");
    }
    throw new RetailDomainError("RETAIL_RETURN_ORDER_NOT_DELIVERED", `order is ${status}; it cannot take a return`); // cancelled and kin
  }

  /** Same owner-or-staff rule as every other retail action. */
  private assertReturnOwner(order: { customerId: string | null }, actor: { actorId: string | null; actorRole: string }) {
    if (actor.actorRole === "customer" || actor.actorRole === "vip") {
      if (!actor.actorId || !order.customerId || actor.actorId !== order.customerId) {
        throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", "this order belongs to another customer");
      }
      return;
    }
    if (actor.actorRole === "admin" || actor.actorRole === "system") return;
    throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", `role ${actor.actorRole} cannot drive retail return actions`);
  }

  /** Withdrawal pre-check: buyer role + identity (row ownership follows in-tx). */
  private assertReturnCustomer(actor: { actorId: string | null; actorRole: string }) {
    if ((actor.actorRole !== "customer" && actor.actorRole !== "vip") || !actor.actorId) {
      throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", "only the owning customer can withdraw a return");
    }
  }

  private assertStaff(actor: { actorId: string | null; actorRole: string }) {
    if (actor.actorRole === "admin" || actor.actorRole === "system") return;
    throw new RetailDomainError("RETAIL_RETURN_FORBIDDEN", `role ${actor.actorRole} cannot drive retail return actions`);
  }

  private encodeCursor(createdAt: string, id: string): string {
    return Buffer.from(JSON.stringify([createdAt, id])).toString("base64url");
  }

  private decodeCursor(cursor: unknown): [string, string] {
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "string" &&
        typeof parsed[1] === "string" &&
        Number.isFinite(Date.parse(parsed[0])) &&
        parsed[1].length > 0
      ) {
        return [new Date(parsed[0]).toISOString(), parsed[1]];
      }
    } catch {
      // fall through to the domain error below
    }
    throw new RetailDomainError("RETAIL_CUSTOMER_CURSOR_INVALID", "history cursor is malformed");
  }

  private async presentReturn(executor: any, returnId: string): Promise<RetailReturnView> {
    const request = (await this.repo.findRequestById(returnId, executor)) as any;
    if (!request) throw new RetailDomainError("RETAIL_RETURN_NOT_FOUND", "retail return not found");
    const order = (await this.orders.findById(request.orderId, executor)) as any;
    const items = (await this.repo.findItemsByReturnId(returnId, executor)) as any[];
    const orderItems = (await this.orders.findItemsByOrderId(request.orderId, executor)) as any[];
    const lineOf = new Map(orderItems.map((line) => [line.id, line]));
    const events = (await this.repo.findEventsByReturnId(returnId, executor)) as any[];
    return {
      id: request.id,
      orderId: request.orderId,
      orderCode: order?.orderCode ?? "",
      status: request.status,
      reason: request.reason,
      note: request.note,
      supportCaseId: request.supportCaseId,
      receivedAt: iso(request.receivedAt),
      inspectedAt: iso(request.inspectedAt),
      inspectionDecision: request.inspectionDecision,
      version: request.version,
      items: items.map((item) => {
        const line = lineOf.get(item.orderItemId) as any;
        return {
          id: item.id,
          orderItemId: item.orderItemId,
          sku: line?.sku ?? null,
          productName: line?.productName ?? null,
          quantity: item.quantity,
        };
      }),
      history: events.map((event) => ({
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actorRole: event.actorRole,
        reason: event.reason,
        returnVersion: event.returnVersion,
        createdAt: new Date(event.createdAt).toISOString(),
      })),
      createdAt: new Date(request.createdAt).toISOString(),
      updatedAt: new Date(request.updatedAt).toISOString(),
    };
  }
}
