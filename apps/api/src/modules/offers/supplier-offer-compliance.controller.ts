import { Body, Controller, Get, Inject, Param, Post, Put } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { OffersService } from "./offers.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { ProductComplianceService } from "../compliance/product-compliance.service";
import { ForbiddenError, NotFoundError } from "@kolbe/shared";

/**
 * Phase 4.7.5 — supplier product-provenance routes, hosted by the OFFERS owner.
 *
 * The offer is the supplier's relationship to a product, so ownership is proven
 * here (offer.sellerId ∈ the caller's memberships — never "first membership
 * wins") and passed to Compliance as a verified fact. Compliance itself never
 * reads offer tables, which keeps Catalog → Compliance and Offers → Compliance
 * acyclic.
 */
@Controller("supplier/offers")
export class SupplierOfferComplianceController {
  constructor(
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(ProductComplianceService) private readonly productCompliance: ProductComplianceService,
  ) {}

  private async resolveOwnedOffer(claims: Claims, offerId: string) {
    const offer = await this.offers.getOfferById(offerId);
    if (!offer) throw new NotFoundError("پیشنهاد فروش یافت نشد");
    const memberships = await this.suppliers.getUserMemberships(claims.sub);
    const membership = memberships.find((m: any) => m.sellerId === offer.sellerId && ["owner", "sales", "finance"].includes(m.role));
    if (!membership) throw new ForbiddenError("OFFER_ACCESS_DENIED", "این پیشنهاد فروش به تأمین‌کنندهٔ شما تعلق ندارد");
    return { offer, actor: { userId: claims.sub, role: "supplier" as const } };
  }

  @Get(":offerId/compliance")
  @Roles("supplier")
  async getRecord(@CurrentUser() claims: Claims, @Param("offerId") offerId: string) {
    const { offer, actor } = await this.resolveOwnedOffer(claims, offerId);
    return toApiJson({ productId: offer.productId, record: await this.productCompliance.getRecord(actor, offer.productId) });
  }

  @Put(":offerId/compliance")
  @Roles("supplier")
  async declare(@CurrentUser() claims: Claims, @Param("offerId") offerId: string, @Body() body: Record<string, unknown>) {
    const { offer, actor } = await this.resolveOwnedOffer(claims, offerId);
    return toApiJson({ record: await this.productCompliance.declare(actor, { productId: offer.productId, sellerId: offer.sellerId }, body ?? {}) });
  }

  @Get(":offerId/compliance/documents")
  @Roles("supplier")
  async documents(@CurrentUser() claims: Claims, @Param("offerId") offerId: string) {
    const { offer, actor } = await this.resolveOwnedOffer(claims, offerId);
    return toApiJson({ documents: await this.productCompliance.listDocuments(actor, offer.productId) });
  }

  @Post(":offerId/compliance/documents")
  @Roles("supplier")
  async upload(@CurrentUser() claims: Claims, @Param("offerId") offerId: string, @Body() body: { documentType: string; mimeType: string; contentBase64: string; originalFilename?: string }) {
    const { offer, actor } = await this.resolveOwnedOffer(claims, offerId);
    return toApiJson({ document: await this.productCompliance.uploadDocument(actor, offer.productId, body ?? ({} as any)) });
  }
}
