/**
 * Phase 5.7 — owner-domain facts adapter.
 *
 * Promotions reads Catalog/Offers/VIP/CRM authority exclusively through this
 * provider (owner services only — never their tables). Missing or ineligible
 * references resolve to `null` so evaluation fails closed; identity mismatch
 * (cross-account spoofing) is an invariant violation and throws.
 */

import { Inject, Injectable } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service";
import { CrmContactService } from "../crm/crm-contact.service";
import { CrmTagService } from "../crm/crm-tag.service";
import { OffersService } from "../offers/offers.service";
import type { PricingUnit, SaleUnit } from "../pricing/pricing.logic";
import { PricingService } from "../pricing/pricing.service";
import { VipService } from "../vip/vip.service";
import { WholesaleMembershipService } from "../vip/wholesale-membership.service";
import { WholesalePlanService } from "../vip/wholesale-plan.service";
import {
  type OfferFacts,
  type PackageFacts,
  type PricingTierFacts,
  type ProductFacts,
  type PromotionFactsProvider,
  type SegmentFacts,
  type VipFacts,
  type WholesaleLineBase,
  type WholesaleLineBaseInput,
} from "./promotions.contract";
import { PromotionDomainError } from "./promotions.logic";

/** Owner "not found / not eligible" errors map to null (fail closed). */
function isMissingOrIneligible(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string") {
    if (code === "NOT_FOUND") return true;
    if (
      code === "OFFER_NOT_ELIGIBLE" ||
      code === "PRODUCT_NOT_ELIGIBLE" ||
      code === "VARIANT_PRODUCT_MISMATCH" ||
      code === "PACKAGE_OFFER_MISMATCH"
    ) {
      return true;
    }
  }
  const status = (error as { status?: unknown })?.status;
  if (status === 404) return true;
  const name = (error as { name?: unknown })?.name;
  return typeof name === "string" && /NotFound/.test(name);
}

@Injectable()
export class PromotionOwnerFactsProvider implements PromotionFactsProvider {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(VipService) private readonly vip: VipService,
    @Inject(WholesaleMembershipService) private readonly memberships: WholesaleMembershipService,
    @Inject(WholesalePlanService) private readonly plans: WholesalePlanService,
    @Inject(CrmContactService) private readonly contacts: CrmContactService,
    @Inject(CrmTagService) private readonly tags: CrmTagService,
  ) {}

  async getProductFacts(productId: string): Promise<ProductFacts | null> {
    try {
      const product = await this.catalog.getOrderEligibleProduct(productId);
      return {
        productId: product.id,
        categoryId: product.categoryId ?? null,
        status: product.status,
        ownerType: product.ownerType,
      };
    } catch (error) {
      if (isMissingOrIneligible(error)) return null;
      throw error;
    }
  }

  async assertRetailProduct(productId: string): Promise<ProductFacts> {
    try {
      const product = await this.catalog.assertRetailIsolation(productId);
      if (product.status === "archived") {
        throw new PromotionDomainError("PROMOTION_PRODUCT_INELIGIBLE", `Product ${productId} is archived`, 422);
      }
      return {
        productId: product.id,
        categoryId: product.categoryId ?? null,
        status: product.status,
        ownerType: product.ownerType,
      };
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      const code = (error as { code?: unknown })?.code;
      if (code === "RETAIL_ONLY_KOLBE") {
        throw new PromotionDomainError(
          "PROMOTION_RETAIL_ISOLATION_VIOLATION",
          "Retail promotions apply to Kolbe products only",
          422,
        );
      }
      if (isMissingOrIneligible(error)) {
        throw new PromotionDomainError("PROMOTION_PRODUCT_UNKNOWN", `Product ${productId} is unknown`, 422);
      }
      throw error;
    }
  }

  async getOfferFacts(offerId: string): Promise<OfferFacts | null> {
    try {
      const offer = await this.offers.getOfferEligibility(offerId);
      return { offerId: offer.id, productId: offer.productId, sellerId: offer.sellerId, status: offer.status };
    } catch (error) {
      if (isMissingOrIneligible(error)) return null;
      throw error;
    }
  }

  async listPricingTiers(offerId: string): Promise<PricingTierFacts[]> {
    const tiers = await this.offers.listPricingTiersForResolution(offerId);
    return tiers.map((tier) => ({
      id: tier.id,
      offerId: tier.offerId,
      minQuantity: tier.minQuantity,
      maxQuantity: tier.maxQuantity ?? null,
      unitPrice: tier.unitPrice as bigint,
      currency: tier.currency,
      moqUnit: tier.moqUnit,
      pricingUnit: tier.pricingUnit,
    }));
  }

  async getPackageFacts(packageId: string, offerId: string): Promise<PackageFacts | null> {
    try {
      const resolved = await this.offers.getPackageForOrder(packageId, offerId);
      const pkg = resolved.package as unknown as Record<string, unknown>;
      return {
        id: String(pkg.id),
        offerId: String(pkg.offerId),
        packageType: String(pkg.packageType ?? pkg.package_type ?? ""),
        name: String(pkg.name ?? ""),
        totalPieces: Number(pkg.totalPieces ?? 0),
        composition: (resolved.composition ?? []).map((item: { variantId: string; quantity: number }) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      };
    } catch (error) {
      if (isMissingOrIneligible(error)) return null;
      throw error;
    }
  }

  /**
   * Authoritative wholesale base price, re-derived through PricingService.
   * Any mismatch with the caller-supplied unit price fails closed upstream.
   */
  async resolveWholesaleLineBase(input: WholesaleLineBaseInput): Promise<WholesaleLineBase> {
    const [offer, tiers] = await Promise.all([
      this.offers.getOfferEligibility(input.offerId),
      this.offers.listPricingTiersForResolution(input.offerId),
    ]);
    let packageFacts: PackageFacts | null = null;
    if (input.packageId) {
      packageFacts = await this.getPackageFacts(input.packageId, input.offerId);
      if (!packageFacts) {
        throw new PromotionDomainError("PROMOTION_PACKAGE_UNKNOWN", `Package ${input.packageId} is unknown for this offer`, 422);
      }
    }
    try {
      const resolved = this.pricing.resolvePrice({
        offer: {
          id: offer.id,
          productId: offer.productId,
          sellerId: offer.sellerId,
          wholesalePrice: offer.wholesalePrice as bigint,
          currency: offer.currency,
          moq: offer.moq,
          moqUnit: offer.moqUnit as SaleUnit,
          pricingUnit: offer.pricingUnit as PricingUnit,
        },
        variantId: input.variantId ?? null,
        packageId: input.packageId ?? null,
        package: packageFacts
          ? {
              id: packageFacts.id,
              offerId: packageFacts.offerId,
              packageType: packageFacts.packageType,
              name: packageFacts.name,
              totalPieces: packageFacts.totalPieces,
              composition: packageFacts.composition,
            }
          : null,
        quantity: input.quantity,
        pricingTiers: tiers.map((tier) => ({
          id: tier.id,
          offerId: tier.offerId,
          minQuantity: tier.minQuantity,
          maxQuantity: tier.maxQuantity ?? null,
          unitPrice: tier.unitPrice as bigint,
          currency: tier.currency,
          moqUnit: tier.moqUnit as SaleUnit,
          pricingUnit: tier.pricingUnit as PricingUnit,
        })),
      });
      return {
        unitPrice: resolved.unitPrice,
        lineTotal: resolved.lineTotal,
        pricingUnit: resolved.pricingUnit,
        pricingTierId: resolved.pricingTierId,
      };
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      const name = (error as { name?: unknown })?.name;
      if (name === "PricingValidationError" || name === "TierSelectionError") {
        throw new PromotionDomainError("PROMOTION_PRICE_RESOLUTION_FAILED", `Authoritative base price cannot be resolved: ${(error as Error).message}`, 422);
      }
      throw error;
    }
  }

  async getVipFacts(accountId: string, userId: string): Promise<VipFacts | null> {
    let account: { id: string; userId: string; status: string };
    try {
      account = await this.vip.getWholesaleAccountForOrder(accountId);
    } catch (error) {
      if (isMissingOrIneligible(error)) return null;
      throw error;
    }
    // Cross-account targeting cannot be spoofed: the caller user must own the account.
    if (account.userId !== userId) {
      throw new PromotionDomainError("PROMOTION_VIP_IDENTITY_MISMATCH", "Wholesale account does not belong to the caller", 403);
    }
    const membership = await this.memberships.getActiveMembershipForAccount(accountId);
    if (!membership) return null;
    const plan = (membership as { plan?: { id?: string; code?: string | null } | null }).plan ?? null;
    return {
      accountId: account.id,
      userId: account.userId,
      accountStatus: account.status,
      membershipId: membership.id,
      planId: membership.planId,
      planCode: plan?.code ?? null,
      membershipStatus: membership.status,
    };
  }

  async vipPlanExists(planId: string): Promise<boolean> {
    try {
      await this.plans.getPlan(planId);
      return true;
    } catch (error) {
      if (isMissingOrIneligible(error)) return false;
      throw error;
    }
  }

  async wholesaleAccountExists(accountId: string): Promise<boolean> {
    try {
      await this.vip.getWholesaleAccountForOrder(accountId);
      return true;
    } catch (error) {
      if (isMissingOrIneligible(error)) return false;
      throw error;
    }
  }

  async getSegmentFacts(ref: { userId: string; linkType: "account_user" | "wholesale_account" }): Promise<SegmentFacts> {
    const contact = await this.contacts.getContactByUserId(ref.userId, ref.linkType);
    if (!contact) return { contactId: null, stage: null, tagKeys: [] };
    return { contactId: contact.contactId, stage: contact.stage ?? null, tagKeys: contact.tagKeys ?? [] };
  }

  async tagExists(tagKey: string): Promise<boolean> {
    const tag = await this.tags.getTag(tagKey);
    return !!tag && tag.isActive !== false;
  }
}
