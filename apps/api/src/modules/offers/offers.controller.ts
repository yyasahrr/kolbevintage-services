import { Controller, Get, Post, Body, Param, HttpCode, Inject, UseGuards } from "@nestjs/common";
import { OffersService } from "./offers.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";

@Controller("offers")
export class OffersController {
  constructor(@Inject(OffersService) private readonly offers: OffersService) {}

  @Post()
  @Roles("admin", "supplier")
  async createOffer(
    @CurrentUser() claims: Claims,
    @Body() body: {
      productId: string;
      variantId?: string;
      sku: string;
      wholesalePrice: string;
      retailPrice?: string;
      moq: number;
      moqUnit: "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET";
      packageType?: "SIZE_RUN" | "FIXED_QUANTITY" | "COLOR_MIX" | "CUSTOM_BUNDLE";
    },
  ) {
    const actor = await this.offers.resolveActorSeller({ id: claims.sub, role: claims.role as any });

    return this.offers.createOffer({
      productId: body.productId,
      sellerId: actor.sellerId,
      sellerType: actor.sellerType,
      variantId: body.variantId || null,
      sku: body.sku,
      wholesalePrice: BigInt(body.wholesalePrice),
      retailPrice: body.retailPrice ? BigInt(body.retailPrice) : null,
      moq: body.moq,
      moqUnit: body.moqUnit,
      packageType: body.packageType || null,
    });
  }

  @Post("compat/rfqs/:id/quote")
  @Roles("supplier")
  async legacyQuote(@Param("id") id: string, @CurrentUser() claims: Claims, @Body() body: any) {
    return this.offers.submitLegacyQuote(id, claims.sub, body);
  }

  @Post("compat/rfqs")
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("wholesale:approval:create")
  async legacyRfq(@CurrentUser() claims: Claims, @Body() body: any) { return this.offers.createLegacyRfq(body, claims.sub); }

  @Post("compat/bulk-price")
  @HttpCode(200)
  @Roles("admin")
  @UseGuards(AdminPermissionGuard)
  @RequireAdminPermission("retail:catalog:manage")
  async legacyBulkPrice(@CurrentUser() claims: Claims, @Body() body: any) { return this.offers.bulkPrice(body, claims.sub); }

  @Get("product/:productId")
  async listForProduct(@Param("productId") productId: string) {
    return this.offers.listOffersForProduct(productId);
  }

  @Post("packages")
  @Roles("admin", "supplier")
  async createPackage(
    @CurrentUser() claims: Claims,
    @Body() body: {
      offerId: string;
      packageType: "SIZE_RUN" | "FIXED_QUANTITY" | "COLOR_MIX" | "CUSTOM_BUNDLE";
      name: string;
      description?: string;
      items: Array<{ variantId: string; quantity: number }>;
    },
  ) {
    const actor = await this.offers.resolveActorSeller({ id: claims.sub, role: claims.role as any });
    return this.offers.createWholesalePackage({ ...body, actorSellerId: actor.sellerId, actorRole: claims.role as any });
  }

  @Post("pricing-tiers")
  @Roles("admin", "supplier")
  async createPricingTier(
    @CurrentUser() claims: Claims,
    @Body() body: { offerId: string; minQuantity: number; maxQuantity?: number; unitPrice: string; moqUnit?: "PIECE" | "PACKAGE" | "SERIES" | "BOX" | "CARTON" | "SET" },
  ) {
    const actor = await this.offers.resolveActorSeller({ id: claims.sub, role: claims.role as any });
    return this.offers.createPricingTier({ ...body, unitPrice: BigInt(body.unitPrice), actorSellerId: actor.sellerId, actorRole: claims.role as any });
  }
}
