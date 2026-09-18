import { Controller, Get, Post, Body, Param } from "@nestjs/common";
import { OffersService } from "./offers.service";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";

@Controller("offers")
export class OffersController {
  constructor(private readonly offers: OffersService) {}

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
