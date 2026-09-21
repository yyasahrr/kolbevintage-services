import { Inject, Injectable } from "@nestjs/common";
import { CatalogService } from "../catalog/catalog.service";
import { OffersService } from "../offers/offers.service";
import { VipService } from "../vip/vip.service";
import { WholesaleMembershipService } from "../vip/wholesale-membership.service";
import { CrmContactService } from "../crm/crm-contact.service";
import type { PromotionFactSource, ResolvedActorFacts, ResolvedLineFacts } from "./promotions.contract";
import { PromotionCodes, PromotionDomainError } from "./promotions.errors";
import { assertReferenceId, MAX_EVALUATION_LINES, parseMoneyInput, requireSafeInteger, requireText } from "./promotions.logic";

/**
 * Owner-domain fact adapter (PromotionFactSource).
 *
 * Every identity that reaches a promotion decision is re-resolved here
 * through the owning domain's public service surface. Browser-supplied
 * category ids, segment lists, plan ids, and totals never reach the
 * evaluation core: this service either resolves them or rejects them.
 */
@Injectable()
export class PromotionFactsService implements PromotionFactSource {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(VipService) private readonly vip: VipService,
    @Inject(WholesaleMembershipService) private readonly memberships: WholesaleMembershipService,
    @Inject(CrmContactService) private readonly crmContacts: CrmContactService,
  ) {}

  async resolveLineFacts(
    lines: Array<{
      lineId: string;
      productId: string;
      offerId?: string | null;
      quantity: unknown;
      unitPrice: unknown;
      lineTotal: unknown;
    }>,
  ): Promise<ResolvedLineFacts[]> {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "at least one line is required");
    }
    if (lines.length > MAX_EVALUATION_LINES) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `at most ${MAX_EVALUATION_LINES} lines per evaluation`);
    }
    const seen = new Set<string>();
    const resolved: ResolvedLineFacts[] = [];
    for (const line of lines) {
      const lineId = requireText(line?.lineId, "lineId", 128);
      if (seen.has(lineId)) {
        throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `duplicate lineId ${lineId}`);
      }
      seen.add(lineId);
      const productId = assertReferenceId(requireText(line?.productId, "productId", 128), "productId");
      const offerId = line?.offerId === null || line?.offerId === undefined || line?.offerId === ""
        ? null
        : assertReferenceId(requireText(line.offerId, "offerId", 128), "offerId");
      const quantity = requireSafeInteger(line?.quantity, "quantity", 1, 1_000_000);
      const unitPrice = parseMoneyInput(line?.unitPrice, "unitPrice");
      const lineTotal = parseMoneyInput(line?.lineTotal, "lineTotal");
      if (lineTotal !== unitPrice * BigInt(quantity)) {
        throw new PromotionDomainError(
          PromotionCodes.EVALUATION_INVALID,
          `line ${lineId} total is inconsistent with its unit price`,
        );
      }

      let product: { categoryId?: string | null } | null = null;
      try {
        product = await this.catalog.getOrderEligibleProduct(productId);
      } catch {
        product = null;
      }
      if (!product) {
        throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `line ${lineId} references an ineligible product`);
      }
      if (offerId) {
        let offer: { productId?: string | null } | null = null;
        try {
          offer = await this.offers.getOfferEligibility(offerId);
        } catch {
          offer = null;
        }
        if (!offer) {
          throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `line ${lineId} references an ineligible offer`);
        }
        if (offer.productId !== productId) {
          throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `line ${lineId} offer does not belong to its product`);
        }
      }
      resolved.push({
        lineId,
        productId,
        categoryId: product.categoryId ?? null,
        offerId,
        quantity,
        unitPrice,
        lineTotal,
      });
    }
    return resolved;
  }

  async resolveActorFacts(actor: { userId: string; vipAccountId?: string | null }): Promise<ResolvedActorFacts> {
    const userId = requireText(actor?.userId, "userId", 128);
    const assertedAccount = actor?.vipAccountId === null || actor?.vipAccountId === undefined || actor?.vipAccountId === ""
      ? null
      : requireText(actor.vipAccountId, "vipAccountId", 128);

    let vipAccountId: string | null = null;
    let vipPlanId: string | null = null;
    let vipActive = false;
    if (assertedAccount) {
      let account: { id: string; userId: string; status: string } | null = null;
      try {
        account = await this.vip.getWholesaleAccountForOrder(assertedAccount);
      } catch {
        account = null;
      }
      if (!account) {
        throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "unknown wholesale account");
      }
      // Cross-account spoofing: the asserted account must belong to the actor.
      if (account.userId !== userId) {
        throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "wholesale account does not belong to the actor");
      }
      const membership = await this.memberships.getActiveMembershipForAccount(assertedAccount);
      vipAccountId = account.id;
      vipPlanId = membership?.planId ?? null;
      vipActive = account.status === "approved" && membership !== null;
    }

    const segments = await this.crmContacts.getSegmentKeysForUser(userId);
    return {
      customerKey: vipAccountId ? `account:${vipAccountId}` : `user:${userId}`,
      vipAccountId,
      vipPlanId,
      vipActive,
      segments,
    };
  }
}
