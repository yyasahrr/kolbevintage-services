import { Body, Controller, Get, Headers, Param, Post, Query, Inject } from "@nestjs/common";
import { OrdersService } from "./orders.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import type { Claims } from "../../common/session";
import { CatalogDomainError } from "../catalog/catalog.logic";
import { DomainError } from "@kolbe/shared";
import { SuppliersService } from "../suppliers/suppliers.service";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { eq, and } from "drizzle-orm";
import { purchaseOrder, seller, supplierMember } from "@kolbe/database";

@Controller("supplier/orders")
export class SupplierOrdersController {
  constructor(
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(SuppliersService) private readonly suppliersService: SuppliersService,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {}

  private async assertSupplierOwnership(userId: string, childOrderId: string, requiredRoles?: string[]) {
    const [child] = await (this.db as any)
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, childOrderId))
      .limit(1);
    // Phase 4.7.6 — ownership failures are HTTP 404/403 (DomainError), never a 500 that hides the boundary.
    if (!child) throw new DomainError(404, "ORDER_NOT_FOUND", "Child order not found");

    const [sellerRow] = await (this.db as any).select().from(seller).where(eq(seller.id, child.sellerId)).limit(1);
    if (!sellerRow) throw new DomainError(404, "SELLER_NOT_FOUND", "Seller not found");
    if (!sellerRow.supplierId) {
      throw new DomainError(403, "SELLER_MISMATCH", "Child belongs to KOLBE, not supplier");
    }
    const [member] = await (this.db as any)
      .select()
      .from(supplierMember)
      .where(and(eq(supplierMember.supplierId, sellerRow.supplierId), eq(supplierMember.userId, userId)))
      .limit(1);
    if (!member) {
      throw new DomainError(403, "SUPPLIER_OWNERSHIP_VIOLATION", "Not member of supplier");
    }
    if (requiredRoles && !requiredRoles.includes(member.role)) {
      throw new DomainError(403, "ROLE_NOT_ALLOWED", `Role ${member.role} not allowed, requires ${requiredRoles.join(",")}`);
    }
    return { child, sellerRow, member };
  }

  @Get()
  @Roles("supplier", "admin")
  async listSupplierOrders(@CurrentUser() claims: Claims, @Query("sellerId") sellerId?: string) {
    if (claims.role === "admin") {
      if (!sellerId) throw new CatalogDomainError("SELLER_ID_REQUIRED", "sellerId required for admin");
      const orders = await (this.db as any)
        .select()
        .from(purchaseOrder)
        .where(eq(purchaseOrder.sellerId, sellerId))
        .limit(100);
      return { children: orders };
    }

    // Supplier user: resolve all sellers they belong to via supplierMember -> seller
    const members = await (this.db as any)
      .select()
      .from(supplierMember)
      .where(eq(supplierMember.userId, claims.sub));
    const supplierIds = members.map((m: any) => m.supplierId);
    if (supplierIds.length === 0) return { children: [] };

    const sellers = await (this.db as any).select().from(seller).where(eq(seller.supplierId, supplierIds[0])).limit(20);
    // For simplicity, collect all sellers for user's supplier
    const allSellerIds = sellers.map((s: any) => s.id);
    if (allSellerIds.length === 0) return { children: [] };

    const orders = await (this.db as any)
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.sellerId, allSellerIds[0]))
      .limit(100);
    return { children: orders };
  }

  @Get(":id")
  @Roles("supplier", "admin")
  async getChildOrder(@CurrentUser() claims: Claims, @Param("id") id: string) {
    if (claims.role === "admin") {
      const data = await (this.db as any).select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1);
      if (!data[0]) throw new DomainError(404, "ORDER_NOT_FOUND", "Child not found");
      return toApiJson({ child: data[0] });
    }
    const { child } = await this.assertSupplierOwnership(claims.sub, id);
    // Phase 4.7.6 — BigInt money columns must be emitted as decimal strings (this path returned 500 before).
    return toApiJson({ child });
  }

  @Post(":id/confirm")
  @Roles("supplier", "admin")
  async confirmChild(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { expectedVersion?: number },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");

    let supplierRole: any = undefined;
    if (claims.role !== "admin") {
      const { member } = await this.assertSupplierOwnership(claims.sub, id, ["owner", "sales"]);
      supplierRole = member.role;
    }

    const result = await this.ordersService.confirmChildOrder({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      supplierRole,
      expectedVersion: body?.expectedVersion,
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }

  @Post(":id/start-preparation")
  @Roles("supplier", "admin")
  async startPreparation(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { expectedVersion?: number },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    let supplierRole: any = undefined;
    if (claims.role !== "admin") {
      const { member } = await this.assertSupplierOwnership(claims.sub, id, ["owner", "sales", "warehouse"]);
      if (member.role === "finance") throw new CatalogDomainError("ROLE_NOT_ALLOWED", "finance cannot start preparation");
      supplierRole = member.role;
    }
    const result = await this.ordersService.startChildPreparation({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      supplierRole,
      expectedVersion: body?.expectedVersion,
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }

  @Post(":id/ready")
  @Roles("supplier", "admin")
  async markReady(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    let supplierRole: any = undefined;
    if (claims.role !== "admin") {
      const { member } = await this.assertSupplierOwnership(claims.sub, id, ["owner", "warehouse"]);
      supplierRole = member.role;
    }
    const result = await this.ordersService.markChildReady({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      supplierRole,
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }

  @Post(":id/dispatch")
  @Roles("supplier", "admin")
  async dispatchChild(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { trackingCode?: string },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (claims.role !== "admin") {
      await this.assertSupplierOwnership(claims.sub, id, ["owner", "warehouse", "sales"]);
    }
    const result = await this.ordersService.dispatchChildOrder({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      trackingCode: body?.trackingCode,
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }

  @Post(":id/deliver")
  @Roles("supplier", "admin")
  async deliverChild(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (claims.role !== "admin") {
      await this.assertSupplierOwnership(claims.sub, id);
    }
    const result = await this.ordersService.deliverChildOrder({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }

  @Post(":id/cancel")
  @Roles("supplier", "admin")
  async cancelChild(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idem1: string,
    @Headers("Idempotency-Key") idem2: string,
    @Body() body: { reason?: string },
  ) {
    const idempotencyKey = idem1 || idem2;
    if (!idempotencyKey) throw new CatalogDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
    if (claims.role !== "admin") {
      await this.assertSupplierOwnership(claims.sub, id, ["owner", "sales"]);
    }
    const result = await this.ordersService.cancelChildOrder({
      childOrderId: id,
      actorUserId: claims.sub,
      actorRole: claims.role === "admin" ? "admin" : "supplier",
      reason: body?.reason,
      idempotencyKey,
    });
    return toApiJson({ child: result.child, replayed: result.replayed });
  }
}
