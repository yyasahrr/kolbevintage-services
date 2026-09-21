/**
 * Phase 5.7 — commercial evaluation entrypoint (read-only).
 *
 * Resolves owner-verified facts, runs the deterministic pure engine, and maps
 * the result onto the JSON contract (decimal-string money). This service
 * performs no writes of any kind: no orders, inventory, payments, settlement,
 * or usage rows. Recording usage is the separate, explicit
 * `PromotionUsageService.recordRedemption` call.
 */

import { Inject, Injectable } from "@nestjs/common";
import {
  PROMOTION_EVALUATION_VERSION,
  type EvaluatePromotionsInput,
  type EvaluatePromotionsResult,
} from "./promotions.contract";
import { PromotionEligibilityService } from "./promotion-eligibility.service";
import { evaluatePromotionSet } from "./promotions.logic";

const moneyEntries = (map: Map<string, bigint>): Record<string, string> =>
  Object.fromEntries([...map.entries()].map(([key, value]) => [key, value.toString()]));

@Injectable()
export class PromotionEvaluationService {
  constructor(
    @Inject(PromotionEligibilityService) private readonly eligibility: PromotionEligibilityService,
  ) {}

  async evaluate(input: EvaluatePromotionsInput): Promise<EvaluatePromotionsResult> {
    const resolved = await this.eligibility.resolveEvaluationRequest(input);
    const result = evaluatePromotionSet(resolved.engine);
    return {
      evaluationVersion: PROMOTION_EVALUATION_VERSION,
      channel: resolved.engine.channel,
      baseSubtotal: result.baseSubtotal.toString(),
      lineDiscounts: moneyEntries(result.lineDiscounts),
      orderDiscount: result.orderDiscount.toString(),
      shippingDiscount: result.shippingDiscount.toString(),
      totalDiscount: result.totalDiscount.toString(),
      finalSubtotal: result.finalSubtotal.toString(),
      finalShipping: result.finalShipping === null ? null : result.finalShipping.toString(),
      grandTotal: result.grandTotal.toString(),
      appliedPromotions: result.applied.map((entry) => ({
        promotionId: entry.promotionId,
        promotionCode: entry.promotionCode,
        revisionId: entry.revisionId,
        revisionNumber: entry.revisionNumber,
        couponId: entry.couponId,
        benefitType: entry.benefitType,
        benefitScope: entry.benefitScope,
        stackingPolicy: entry.stackingPolicy,
        baseAmount: entry.baseAmount.toString(),
        discountAmount: entry.discountAmount.toString(),
        allocatedLines: moneyEntries(entry.allocatedLines),
      })),
      rejectedPromotions: result.rejected.map((entry) => ({
        promotionId: entry.promotionId,
        revisionId: entry.revisionId,
        reason: entry.reason,
        ...(entry.detail ? { detail: entry.detail } : {}),
      })),
      unmatchedCouponCodes: resolved.unmatchedCouponCodes,
      priceAuthority: resolved.priceAuthority,
      priceBasis: resolved.priceBasis,
      termsHash: result.termsHash,
    };
  }
}
