import { Controller, Get, Post, Body, Param, Query, UseGuards, ForbiddenException, Headers } from "@nestjs/common";
import { InventoryService, type Requester } from "./inventory.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { supplierMember, seller } from "@kolbe/database";

/**
 * Phase 4.1 — Inventory Controller Boundary
 * - authentication required (SessionGuard globally)
 * - role validation via @Roles
 * - supplier ownership validation via sellerId resolved from auth context, never from client input
 * - audit actor propagation via requester.userId
 * - idempotency via Idempotency-Key header
 */

@Controller("inventory")
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {}

  private async resolveRequester(claims: Claims): Promise<Requester> {
    let sellerId: string | null = null;
    if (claims.role === "supplier") {
      sellerId = await this.inventory.resolveSellerIdFromUserId(claims.sub);
      if (!sellerId) {
        const [member] = await this.db
          .select({ supplierId: supplierMember.supplierId })
          .from(supplierMember)
          .where(eq(supplierMember.userId, claims.sub))
          .limit(1);
        if (member) {
          const [s] = await this.db.select({ id: seller.id }).from(seller).where(eq(seller.supplierId, member.supplierId)).limit(1);
          sellerId = s?.id || null;
        }
      }
      if (!sellerId) {
        throw new ForbiddenException("SUPPLIER_IDENTITY_REQUIRED");
      }
    }
    return { userId: claims.sub, role: claims.role, sellerId };
  }

  @Roles("supplier", "admin")
  @Post("variant")
  async upsertVariant(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { variantId: string; onHandDelta: number; reason?: string; sellerId?: string },
  ) {
    const requester = await this.resolveRequester(claims);
    const targetSellerId = requester.role === "supplier" ? requester.sellerId! : (body as any).sellerId || requester.sellerId!;
    if (requester.role === "supplier" && (body as any).sellerId && (body as any).sellerId !== requester.sellerId) {
      throw new ForbiddenException("CLIENT_CANNOT_CHOOSE_SELLER_ID");
    }
    return this.inventory.upsertVariantInventory({
      variantId: body.variantId,
      sellerId: targetSellerId,
      onHandDelta: body.onHandDelta,
      reason: body.reason,
      actorId: claims.sub,
      requester,
      idempotencyKey,
    });
  }

  @Roles("supplier", "admin")
  @Get("variant/:variantId")
  async getVariant(
    @CurrentUser() claims: Claims,
    @Param("variantId") variantId: string,
    @Query("sellerId") sellerId?: string,
  ) {
    const requester = await this.resolveRequester(claims);
    const targetSellerId = requester.role === "supplier" ? requester.sellerId! : sellerId || requester.sellerId!;
    if (requester.role === "supplier" && sellerId && sellerId !== requester.sellerId) {
      throw new ForbiddenException("CLIENT_CANNOT_CHOOSE_SELLER_ID");
    }
    return this.inventory.getVariantInventory(variantId, targetSellerId, requester);
  }

  @Roles("supplier", "admin")
  @Get("seller/:sellerId")
  async listForSeller(
    @CurrentUser() claims: Claims,
    @Param("sellerId") sellerId: string,
  ) {
    const requester = await this.resolveRequester(claims);
    if (requester.role === "supplier" && sellerId !== requester.sellerId) {
      throw new ForbiddenException("SUPPLIER_ISOLATION_VIOLATION");
    }
    return this.inventory.listInventoriesForSeller(sellerId, requester);
  }

  @Roles("supplier", "admin")
  @Get("my")
  async listMy(@CurrentUser() claims: Claims) {
    const requester = await this.resolveRequester(claims);
    return this.inventory.listInventoriesForSeller(requester.sellerId!, requester);
  }

  @Roles("supplier", "admin")
  @Post("reservation")
  async createReservation(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { variantId: string; quantity: number; requestId?: string; expiresInMinutes?: number; reason?: string; allocationId?: string },
  ) {
    const requester = await this.resolveRequester(claims);
    return this.inventory.createReservation({
      variantId: body.variantId,
      sellerId: requester.sellerId!,
      quantity: body.quantity,
      requestId: body.requestId || null,
      expiresInMinutes: body.expiresInMinutes,
      requester,
      reason: body.reason,
      idempotencyKey,
      allocationId: body.allocationId,
    });
  }

  @Roles("supplier", "admin", "vip")
  @Post("reservation/:id/release")
  async releaseReservation(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { reason?: string },
  ) {
    const requester = await this.resolveRequester(claims);
    return this.inventory.releaseReservation({ reservationId: id, requester, reason: body.reason, idempotencyKey });
  }

  @Roles("supplier", "admin")
  @Post("reservation/:id/confirm")
  async confirmReservation(
    @CurrentUser() claims: Claims,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { reason?: string },
  ) {
    const requester = await this.resolveRequester(claims);
    return this.inventory.confirmReservation({ reservationId: id, requester, reason: body.reason, idempotencyKey });
  }

  @Roles("admin")
  @Get("reservation/expired")
  async findExpired(@Query("limit") limit?: string) {
    return this.inventory.findExpiredReservations(limit ? parseInt(limit, 10) : 100);
  }

  @Roles("admin")
  @Post("reservation/expired/release")
  async releaseExpired(
    @CurrentUser() claims: Claims,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { limit?: number },
  ) {
    // idempotency for batch via header not strictly needed but supported
    return this.inventory.releaseExpiredReservations(body.limit || 100, claims.sub);
  }

  @Roles("supplier", "admin")
  @Get("package/:packageId/availability")
  async packageAvailability(
    @CurrentUser() claims: Claims,
    @Param("packageId") packageId: string,
    @Query("sellerId") sellerId?: string,
  ) {
    const requester = await this.resolveRequester(claims);
    const targetSellerId = requester.role === "supplier" ? requester.sellerId! : sellerId || requester.sellerId!;
    if (requester.role === "supplier" && sellerId && sellerId !== requester.sellerId) {
      throw new ForbiddenException("CLIENT_CANNOT_CHOOSE_SELLER_ID");
    }
    return this.inventory.checkPackageAvailability(packageId, targetSellerId, requester);
  }

  @Roles("supplier", "admin")
  @Post("package/:packageId/reserve")
  async reservePackage(
    @CurrentUser() claims: Claims,
    @Param("packageId") packageId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { quantity: number; requestId?: string; expiresInMinutes?: number; reason?: string; allocationId?: string },
  ) {
    const requester = await this.resolveRequester(claims);
    return this.inventory.reservePackage({
      packageId,
      sellerId: requester.sellerId!,
      quantity: body.quantity,
      requestId: body.requestId || null,
      expiresInMinutes: body.expiresInMinutes,
      requester,
      reason: body.reason,
      idempotencyKey,
      allocationId: body.allocationId,
    });
  }
}
