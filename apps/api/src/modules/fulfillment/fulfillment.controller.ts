import { Body, Controller, Get, Headers, Param, Post, Inject } from "@nestjs/common";
import { FulfillmentService } from "./fulfillment.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CatalogDomainError } from "../catalog/catalog.logic";
import { OrdersService } from "../orders/orders.service";
import { VipService } from "../vip/vip.service";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { eq, and } from "drizzle-orm";
import { purchaseOrder, seller, supplierMember } from "@kolbe/database";

@Controller()
export class FulfillmentController {
  constructor(
    @Inject(FulfillmentService) private readonly fulfillmentService: FulfillmentService,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(VipService) private readonly vipService: VipService,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {}

  private async assertSupplierOwnership(userId: string, childOrderId: string) {
    const [child] = await (this.db as any).select().from(purchaseOrder).where(eq(purchaseOrder.id, childOrderId)).limit(1);
    if (!child) throw new CatalogDomainError("ORDER_NOT_FOUND", "Child not found");
    const [sellerRow] = await (this.db as any).select().from(seller).where(eq(seller.id, child.sellerId)).limit(1);
    if (!sellerRow?.supplierId) throw new CatalogDomainError("SELLER_MISMATCH", "Child not supplier");
    const [member] = await (this.db as any)
      .select()
      .from(supplierMember)
      .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, userId)))
      .limit(1);
    if (!member) throw new CatalogDomainError("SUPPLIER_OWNERSHIP_VIOLATION", "Not member");
    if (!["owner", "sales"].includes(member.role)) throw new CatalogDomainError("ROLE_NOT_ALLOWED", `Role ${member.role} cannot report`);
    return { child, sellerRow, member };
  }

  @Post("supplier/orders/:id/report-exception")
  @Roles("supplier", "admin")
  async reportException(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body()
    body: {
      type: "cannot_fulfill" | "partial_shortage" | "package_unavailable" | "operational_failure";
      reasonCode?: string;
      reason: string;
      affectedOrderItemIds?: string[];
      expectedChildVersion?: number;
    },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (!body?.reason) throw new CatalogDomainError("REJECTION_REASON_REQUIRED", "Reason required");

    let sellerId: string;
    if (claims.role === "admin") {
      if (!body) throw new CatalogDomainError("SELLER_ID_REQUIRED", "Admin must still provide child context");
      const [child] = await (this.db as any).select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1);
      if (!child) throw new CatalogDomainError("ORDER_NOT_FOUND", "Child not found");
      sellerId = child.sellerId;
    } else {
      const { sellerRow } = await this.assertSupplierOwnership(claims.sub, id);
      sellerId = sellerRow.id;
    }

    const result = await this.fulfillmentService.reportException({
      childOrderId: id,
      sellerId,
      type: body.type,
      reasonCode: body.reasonCode,
      reason: body.reason,
      affectedOrderItemIds: body.affectedOrderItemIds,
      reportedByUserId: claims.sub,
      idempotencyKey,
      expectedChildVersion: body.expectedChildVersion,
    });

    return { exception: result.exception, replayed: result.replayed };
  }

  @Post("wholesale/orders/:orderId/exceptions/:exceptionId/resolve")
  @Roles("vip", "customer", "admin")
  async resolveException(
    @CurrentUser() claims: Claims,
    @Param("orderId") orderId: string,
    @Param("exceptionId") exceptionId: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { buyerResolution: "replacement_requested" | "quantity_reduction" | "cancel_portion"; reason?: string },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    const result = await this.fulfillmentService.resolveException({
      exceptionId,
      buyerUserId: claims.sub,
      buyerResolution: body.buyerResolution,
      idempotencyKey,
      reason: body.reason,
    });

    // If buyer chooses cancel_portion, we should cancel only that child with financialImpact evidence
    if (body.buyerResolution === "cancel_portion") {
      const exc = result.exception as any;
      const childOrderId = exc.childOrderId || exc.child_order_id;
      const affectedAmount = exc.affectedAmount || exc.affected_amount || 0;
      const currency = exc.currency || "IRR";
      const financialImpact = {
        kind: "future_refund_or_payment_adjustment",
        amount: BigInt(affectedAmount),
        currency,
        childOrderId,
      };

      try {
        await this.ordersService.cancelChildOrder({
          childOrderId,
          actorUserId: claims.sub,
          actorRole: claims.role === "admin" ? "admin" : "buyer",
          reason: body.reason || `Buyer resolved exception ${exceptionId} as cancel_portion`,
          idempotencyKey: `${idempotencyKey}:cancel_child`,
          financialImpact,
        });
      } catch (e) {
        // If child already cancelled or dispatched, propagate? For now ignore if already cancelled
        if ((e as any).code !== "INVALID_STATUS_TRANSITION") throw e;
      }
    }

    return { exception: result.exception, replayed: result.replayed };
  }

  @Get("supplier/orders/:id/exceptions")
  @Roles("supplier", "admin")
  async listExceptionsForChild(@Param("id") id: string) {
    const exceptions = await this.fulfillmentService.listExceptionsByChild(id);
    return { exceptions };
  }

  @Get("wholesale/orders/:orderId/exceptions")
  @Roles("vip", "customer", "admin", "supplier")
  async listExceptionsForParent(@Param("orderId") orderId: string) {
    const children = await (this.db as any).select().from(purchaseOrder).where(eq(purchaseOrder.wholesaleOrderId, orderId));
    const all: any[] = [];
    for (const child of children) {
      const ex = await this.fulfillmentService.listExceptionsByChild(child.id);
      all.push(...ex);
    }
    return { exceptions: all };
  }

  @Post("wholesale/orders/:orderId/exceptions/:exceptionId/replacement")
  @Roles("vip", "customer", "admin")
  async createReplacement(
    @CurrentUser() claims: Claims,
    @Param("orderId") orderId: string,
    @Param("exceptionId") exceptionId: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body()
    body: {
      offerId?: string;
      productId?: string;
      variantId?: string;
      packageId?: string;
      quantity: number;
      reason?: string;
    },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    // Verify buyer owns parent order
    const parent = await this.ordersService.getWholesaleOrderById(orderId);
    if (!parent) throw new CatalogDomainError("ORDER_NOT_FOUND", "Parent not found");
    if ((parent as any).buyerUserId !== claims.sub && (parent as any).buyer_user_id !== claims.sub) {
      if (claims.role !== "admin") throw new CatalogDomainError("ORDER_OWNERSHIP_VIOLATION", "Not owner");
    }

    // Ensure exception belongs to this order
    const exc = await this.fulfillmentService.getExceptionById(exceptionId);
    if (!exc) throw new CatalogDomainError("EXCEPTION_NOT_FOUND", "Exception not found");
    const excWholesaleId = (exc as any).wholesaleOrderId || (exc as any).wholesale_order_id;
    if (excWholesaleId !== orderId) throw new CatalogDomainError("EXCEPTION_ORDER_MISMATCH", "Exception not linked to order");

    // Create new wholesale_request via VipService normal flow NOT auto accepted
    const createResult = await this.vipService.createWholesaleRequest({
      productId: body.productId || (exc as any).productId || "unknown",
      offerId: body.offerId || "unknown",
      variantId: body.variantId,
      packageId: body.packageId,
      quantity: body.quantity,
      userId: claims.sub,
    } as any);

    const replacementRequestId = (createResult as any).request?.id || (createResult as any).id;

    // Link via Fulfillment-owned fulfillment_replacement_request
    const linkResult = await this.fulfillmentService.linkReplacement({
      exceptionId,
      replacementRequestId,
      createdByUserId: claims.sub,
      idempotencyKey: `${idempotencyKey}:link`,
    });

    return { replacementRequest: createResult, link: linkResult.link, replayed: linkResult.replayed };
  }
}
