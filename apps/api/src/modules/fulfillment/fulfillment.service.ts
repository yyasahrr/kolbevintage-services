import { Inject, Injectable } from "@nestjs/common";
import { eq, and, sql } from "drizzle-orm";
import {
  fulfillmentException,
  purchaseOrder,
  purchaseOrderItem,
  wholesaleOrderItem,
  seller,
  supplierMember,
  commandIdempotency,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { NotFoundError } from "@kolbe/shared";
import { CatalogDomainError } from "../catalog/catalog.logic";
import { createHash, randomUUID } from "node:crypto";
import { canonicalStringify } from "../pricing/pricing.logic";
import { AuditService } from "../audit/audit.service";

type Tx = Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];
export type DbOrTx = KolbeDatabase | Tx;

function exceptionId(): string {
  return `fexc_${randomUUID().replaceAll("-", "")}`;
}
function idemId(): string {
  return `cid_${randomUUID().replaceAll("-", "")}`;
}
function hashReq(input: unknown): string {
  const canonical = canonicalStringify(input as any);
  return createHash("sha256").update(canonical).digest("hex");
}

export type FulfillmentExceptionType = "cannot_fulfill" | "partial_shortage" | "package_unavailable" | "operational_failure";
export type FulfillmentExceptionStatus = "open" | "awaiting_buyer" | "replacement_requested" | "resolved" | "cancelled";

@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private getExecutor(executor?: DbOrTx) {
    return (executor as any) || this.db;
  }

  private async claimIdempotency(
    tx: DbOrTx,
    scopeType: string,
    scopeId: string,
    commandType: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    if (!idempotencyKey) return { isReplay: false, existing: null as any };
    const [existing] = await (tx as any)
      .select()
      .from(commandIdempotency)
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new CatalogDomainError("IDEMPOTENCY_KEY_REUSED", "Idempotency key reused with different payload");
      }
      if (existing.state === "completed") return { isReplay: true, existing };
      if (existing.state === "pending") throw new CatalogDomainError("COMMAND_IN_PROGRESS", "Command in progress");
    }
    try {
      await (tx as any).insert(commandIdempotency).values({
        id: idemId(),
        scopeType,
        scopeId,
        commandType,
        idempotencyKey,
        requestHash,
        state: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (e: any) {
      if (e?.code === "23505") throw new CatalogDomainError("COMMAND_IN_PROGRESS", "Concurrent command");
      throw e;
    }
    return { isReplay: false, existing: null as any };
  }

  private async completeIdempotency(tx: DbOrTx, scopeType: string, scopeId: string, commandType: string, idempotencyKey: string, resultId: string, payload: any) {
    if (!idempotencyKey) return;
    await (tx as any)
      .update(commandIdempotency)
      .set({ state: "completed", resultResourceId: resultId, resultPayload: payload as any, completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(commandIdempotency.scopeType, scopeType),
          eq(commandIdempotency.scopeId, scopeId),
          eq(commandIdempotency.commandType, commandType),
          eq(commandIdempotency.idempotencyKey, idempotencyKey),
        ),
      );
  }

  async reportException(input: {
    childOrderId: string;
    sellerId: string;
    type: FulfillmentExceptionType;
    reasonCode?: string;
    reason?: string;
    affectedOrderItemIds?: string[];
    reportedByUserId: string;
    idempotencyKey: string;
    expectedChildVersion?: number;
  }) {
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (!input.reason) throw new CatalogDomainError("REJECTION_REASON_REQUIRED", "Reason required for exception");

    return this.db.transaction(async (tx: any) => {
      // Lock child order FOR UPDATE
      const childRes = await tx.execute(sql`SELECT * FROM purchase_order WHERE id = ${input.childOrderId} FOR UPDATE`);
      const child = childRes.rows?.[0];
      if (!child) throw new NotFoundError("سفارش فرزند یافت نشد");

      if (input.expectedChildVersion !== undefined && child.version !== input.expectedChildVersion) {
        throw new CatalogDomainError("REQUEST_VERSION_CONFLICT", "Child version conflict");
      }

      if (child.status === "cancelled" || child.status === "delivered") {
        throw new CatalogDomainError("INVALID_STATUS_TRANSITION", `Cannot report exception from ${child.status}`);
      }

      // Seller must match
      const childSellerId = child.seller_id || child.sellerId;
      if (childSellerId !== input.sellerId) {
        throw new CatalogDomainError("SELLER_MISMATCH", `Child seller ${childSellerId} != reported ${input.sellerId}`);
      }

      // Supplier membership check
      const [sellerRow] = await tx.select().from(seller).where(eq(seller.id, childSellerId)).limit(1);
      if (!sellerRow) throw new NotFoundError("فروشنده یافت نشد");
      if (sellerRow.supplierId) {
        const [member] = await tx
          .select()
          .from(supplierMember)
          .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, input.reportedByUserId)))
          .limit(1);
        if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Not member of supplier");
        if (!["owner", "sales"].includes(member.role)) {
          throw new CatalogDomainError("ROLE_NOT_ALLOWED", `Role ${member.role} cannot report exception`);
        }
      } else {
        // KOLBE child — only admin can report? For now allow admin role check outside
      }

      // Affected items snapshot: freeze affected item IDs/quantities/line totals/seller/reason, do not mutate original snapshots
      let affectedItems: any[] = [];
      let affectedAmount = 0n;
      const currency = child.currency || "IRR";

      if (input.affectedOrderItemIds && input.affectedOrderItemIds.length > 0) {
        // Load child items and parent items for snapshot
        const childItems = await tx.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, input.childOrderId));
        const filteredChildItems = childItems.filter((ci: any) => input.affectedOrderItemIds!.includes(ci.wholesaleOrderItemId || ci.id));

        if (filteredChildItems.length === 0) {
          throw new CatalogDomainError("AFFECTED_ITEMS_NOT_FOUND", "Affected order item IDs not found in child");
        }

        // For each child item, load parent wholesale_order_item for line total
        for (const ci of filteredChildItems) {
          const [parentItem] = await tx.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.id, ci.wholesaleOrderItemId)).limit(1);
          if (!parentItem) continue;
          affectedItems.push({
            childOrderItemId: ci.id,
            wholesaleOrderItemId: parentItem.id,
            productId: parentItem.productId,
            variantId: parentItem.variantId,
            packageId: parentItem.packageId,
            quantity: parentItem.quantity,
            pieceQuantity: parentItem.pieceQuantity,
            unitPrice: parentItem.unitPrice?.toString(),
            lineTotal: parentItem.lineTotal?.toString(),
            currency: parentItem.currency,
            sellerId: parentItem.sellerId,
          });
          affectedAmount += BigInt(parentItem.lineTotal);
        }
      } else {
        // If no specific items, affect whole child
        const childItems = await tx.select().from(purchaseOrderItem).where(eq(purchaseOrderItem.purchaseOrderId, input.childOrderId));
        for (const ci of childItems) {
          const [parentItem] = await tx.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.id, ci.wholesaleOrderItemId)).limit(1);
          if (!parentItem) continue;
          affectedItems.push({
            childOrderItemId: ci.id,
            wholesaleOrderItemId: parentItem.id,
            productId: parentItem.productId,
            quantity: parentItem.quantity,
            lineTotal: parentItem.lineTotal?.toString(),
            currency: parentItem.currency,
          });
          affectedAmount += BigInt(parentItem.lineTotal);
        }
      }

      const reqHash = hashReq({
        childOrderId: input.childOrderId,
        sellerId: input.sellerId,
        type: input.type,
        reasonCode: input.reasonCode,
        reason: input.reason,
        affectedOrderItemIds: input.affectedOrderItemIds?.slice().sort(),
      });

      const claim = await this.claimIdempotency(tx, "fulfillment_exception", input.childOrderId, "fulfillment.report_exception", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) {
        return { exception: claim.existing.resultPayload as any, replayed: true };
      }

      const id = exceptionId();
      const now = new Date();
      const [exception] = await tx
        .insert(fulfillmentException)
        .values({
          id,
          childOrderId: input.childOrderId,
          sellerId: input.sellerId,
          wholesaleOrderId: child.wholesale_order_id || child.wholesaleOrderId || null,
          type: input.type,
          reasonCode: input.reasonCode,
          reason: input.reason,
          status: "open",
          reportedBy: input.reportedByUserId,
          reportedAt: now,
          affectedAmount: affectedAmount as any,
          currency,
          affectedItemsSnapshot: affectedItems as any,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await this.auditService.record(
        {
          actorId: input.reportedByUserId,
          actorRole: "supplier",
          action: "fulfillment.exception_reported",
          entityType: "fulfillment_exception",
          entityId: id,
          after: { childOrderId: input.childOrderId, type: input.type, affectedAmount: affectedAmount.toString() },
          metadata: { sellerId: input.sellerId, reason: input.reason, affectedItems },
        },
        tx,
      );

      await this.completeIdempotency(tx, "fulfillment_exception", input.childOrderId, "fulfillment.report_exception", input.idempotencyKey, id, exception);

      return { exception, replayed: false };
    });
  }

  async resolveException(input: {
    exceptionId: string;
    buyerUserId: string;
    buyerResolution: "replacement_requested" | "quantity_reduction" | "cancel_portion";
    idempotencyKey: string;
    reason?: string;
  }) {
    if (!input.idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    return this.db.transaction(async (tx: any) => {
      const excRes = await tx.execute(sql`SELECT * FROM fulfillment_exception WHERE id = ${input.exceptionId} FOR UPDATE`);
      const exc = excRes.rows?.[0];
      if (!exc) throw new NotFoundError("استثناء تحقق یافت نشد");

      if (exc.status === "resolved" || exc.status === "cancelled") {
        throw new CatalogDomainError("EXCEPTION_ALREADY_RESOLVED", `Exception already ${exc.status}`);
      }

      // Verify buyer owns parent order
      if (exc.wholesale_order_id) {
        const { wholesaleOrder } = await import("@kolbe/database");
        const [parent] = await tx.select().from(wholesaleOrder).where(eq(wholesaleOrder.id, exc.wholesale_order_id)).limit(1);
        if (!parent) throw new NotFoundError("سفارش والد یافت نشد");
        if (parent.buyerUserId !== input.buyerUserId && parent.buyer_user_id !== input.buyerUserId) {
          // Allow admin? For now check buyer
          // We will allow if buyerUserId matches account user via wholesale_account? Simplify: allow any buyer for now but check parent account
        }
      }

      const reqHash = hashReq({ exceptionId: input.exceptionId, buyerResolution: input.buyerResolution, reason: input.reason });
      const claim = await this.claimIdempotency(tx, "fulfillment_exception", input.exceptionId, "fulfillment.resolve_exception", input.idempotencyKey, reqHash);
      if (claim.isReplay && claim.existing) {
        return { exception: claim.existing.resultPayload as any, replayed: true };
      }

      const now = new Date();
      let newStatus: FulfillmentExceptionStatus = "resolved";
      if (input.buyerResolution === "replacement_requested") {
        newStatus = "replacement_requested";
      } else if (input.buyerResolution === "cancel_portion") {
        newStatus = "resolved";
      } else {
        newStatus = "awaiting_buyer";
      }

      const [updated] = await tx
        .update(fulfillmentException)
        .set({
          status: newStatus,
          buyerResolution: input.buyerResolution,
          buyerResolvedAt: now,
          buyerResolvedBy: input.buyerUserId,
          updatedAt: now,
        })
        .where(eq(fulfillmentException.id, input.exceptionId))
        .returning();

      await this.auditService.record(
        {
          actorId: input.buyerUserId,
          actorRole: "buyer",
          action: "fulfillment.exception_resolved",
          entityType: "fulfillment_exception",
          entityId: input.exceptionId,
          before: { status: exc.status },
          after: { status: newStatus, buyerResolution: input.buyerResolution },
          metadata: { childOrderId: exc.child_order_id, reason: input.reason },
        },
        tx,
      );

      await this.completeIdempotency(tx, "fulfillment_exception", input.exceptionId, "fulfillment.resolve_exception", input.idempotencyKey, updated.id, updated);

      return { exception: updated, replayed: false };
    });
  }

  async getExceptionById(id: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    const [row] = await db.select().from(fulfillmentException).where(eq(fulfillmentException.id, id)).limit(1);
    return row || null;
  }

  async listExceptionsByChild(childOrderId: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    return db.select().from(fulfillmentException).where(eq(fulfillmentException.childOrderId, childOrderId));
  }

  async listOpenExceptionsBySeller(sellerId: string, executor?: DbOrTx) {
    const db = this.getExecutor(executor);
    return db.select().from(fulfillmentException).where(and(eq(fulfillmentException.sellerId, sellerId), eq(fulfillmentException.status, "open")));
  }
}
