import { Inject, Injectable } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service";
import { OffersService } from "../offers/offers.service";
import { VipService } from "../vip/vip.service";
import { WholesalePlanService } from "../vip/wholesale-plan.service";
import { CrmContactService } from "../crm/crm-contact.service";
import { PromotionCodes, PromotionDomainError } from "./promotions.errors";
import type { NormalizedTarget } from "./promotions.logic";

/**
 * Authoring-time eligibility validation.
 *
 * Every reference carried by a promotion target is verified against its
 * owning domain when the revision is authored (fail fast for operators).
 * Match-time revalidation happens separately in PromotionFactsService, so a
 * reference that is deleted or suspended after authoring fails closed at
 * evaluation instead of crashing it.
 */
@Injectable()
export class PromotionEligibilityService {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(VipService) private readonly vip: VipService,
    @Inject(WholesalePlanService) private readonly plans: WholesalePlanService,
    @Inject(CrmContactService) private readonly crmContacts: CrmContactService,
  ) {}

  async assertReferencesExist(targets: NormalizedTarget[], channel: string): Promise<void> {
    for (const target of targets) {
      switch (target.targetType) {
        case "CHANNEL":
          if (target.referenceId !== channel) {
            throw new PromotionDomainError(
              PromotionCodes.CHANNEL_MISMATCH,
              `CHANNEL target ${target.referenceId} does not match the promotion channel ${channel}`,
            );
          }
          break;
        case "PRODUCT":
          await this.exists(
            () => this.catalog.getOrderEligibleProduct(target.referenceId as string),
            `PRODUCT target ${target.referenceId} is unknown or ineligible`,
          );
          break;
        case "CATEGORY":
          await this.exists(
            () => this.catalog.getCategoryById(target.referenceId as string),
            `CATEGORY target ${target.referenceId} is unknown`,
          );
          break;
        case "OFFER":
          await this.exists(
            () => this.offers.getOfferEligibility(target.referenceId as string),
            `OFFER target ${target.referenceId} is unknown or ineligible`,
          );
          break;
        case "VIP_PLAN":
          await this.exists(
            () => this.plans.getPlan(target.referenceId as string),
            `VIP_PLAN target ${target.referenceId} is unknown`,
          );
          break;
        case "VIP_ACCOUNT":
          await this.exists(
            () => this.vip.getWholesaleAccountForOrder(target.referenceId as string),
            `VIP_ACCOUNT target ${target.referenceId} is unknown`,
          );
          break;
        case "CUSTOMER_SEGMENT": {
          const ok = await this.crmContacts.segmentKeyExists(target.referenceId as string);
          if (!ok) {
            throw new PromotionDomainError(
              PromotionCodes.TARGET_INVALID,
              `CUSTOMER_SEGMENT target ${target.referenceId} is unknown or inactive`,
            );
          }
          break;
        }
        case "MIN_SUBTOTAL":
        case "MIN_QUANTITY":
        case "DATE_WINDOW":
          break; // scalar targets carry no foreign reference.
        default:
          throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, `Unsupported target type ${target.targetType}`);
      }
    }
  }

  private async exists(check: () => Promise<unknown>, message: string): Promise<void> {
    try {
      const row = await check();
      if (!row) throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, message);
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, message);
    }
  }
}
