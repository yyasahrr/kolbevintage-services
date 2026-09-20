import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { wholesaleMembership } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { WholesaleOrderLimitViolationError } from "./wholesale-membership.errors";

export type LimitEntitlement = {
  limitValue: bigint;
  period: string;
  isEnforced: boolean;
};

export type EntitlementsSummary = {
  isVip: boolean;
  membershipId: string | null;
  status: string | null;
  planId: string | null;
  planVersionId: string | null;
  expiresAt: string | null;
  features: Record<string, { isEnabled: boolean; featureType: string; configValue?: any }>;
  limits: Record<string, LimitEntitlement>;
};

@Injectable()
export class EntitlementResolver {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  private async getActiveMembership(accountId: string) {
    const [membership] = await this.db
      .select()
      .from(wholesaleMembership)
      .where(
        and(
          eq(wholesaleMembership.accountId, accountId),
          eq(wholesaleMembership.status, "active"),
        ),
      )
      .limit(1);

    if (!membership) return null;

    // Check expiration
    if (membership.expiresAt && new Date(membership.expiresAt) < new Date()) {
      return null;
    }

    return membership;
  }

  async hasFeature(accountId: string, featureKey: string): Promise<boolean> {
    const membership = await this.getActiveMembership(accountId);
    if (!membership) return false;

    const snapshot = (membership.snapshotFeatures as Record<string, any>) || {};
    const feature = snapshot[featureKey];
    if (!feature) return false;

    return feature.isEnabled === true;
  }

  async getLimit(accountId: string, limitKey: string): Promise<LimitEntitlement | null> {
    const membership = await this.getActiveMembership(accountId);
    if (!membership) return null;

    const snapshot = (membership.snapshotLimits as Record<string, any>) || {};
    const limit = snapshot[limitKey];
    if (!limit) return null;

    return {
      limitValue: BigInt(limit.limitValue ?? 0),
      period: limit.period || "order",
      isEnforced: limit.isEnforced !== false,
    };
  }

  async assertCanPlaceOrder(accountId: string, orderTotal: bigint, totalUnits: number): Promise<void> {
    const membership = await this.getActiveMembership(accountId);
    if (!membership) return; // Non-membership orders might have defaults or are handled separately

    const snapshot = (membership.snapshotLimits as Record<string, any>) || {};

    // Check min_order_amount
    const minOrder = snapshot["min_order_amount"];
    if (minOrder && minOrder.isEnforced !== false) {
      const minVal = BigInt(minOrder.limitValue ?? 0);
      if (minVal > 0n && orderTotal < minVal) {
        throw new WholesaleOrderLimitViolationError(
          "MIN_ORDER_AMOUNT_NOT_MET",
          `مبلغ سفارش (${orderTotal.toString()} ریال) کمتر از حداقل مجاز پلن عضویت (${minVal.toString()} ریال) است.`,
          { orderTotal: orderTotal.toString(), minOrderAmount: minVal.toString() },
        );
      }
    }

    // Check max_order_amount
    const maxOrder = snapshot["max_order_amount"];
    if (maxOrder && maxOrder.isEnforced !== false) {
      const maxVal = BigInt(maxOrder.limitValue ?? 0);
      if (maxVal > 0n && orderTotal > maxVal) {
        throw new WholesaleOrderLimitViolationError(
          "MAX_ORDER_AMOUNT_EXCEEDED",
          `مبلغ سفارش (${orderTotal.toString()} ریال) بیشتر از حداکثر سقف مجاز پلن (${maxVal.toString()} ریال) است.`,
          { orderTotal: orderTotal.toString(), maxOrderAmount: maxVal.toString() },
        );
      }
    }

    // Check max_order_units
    const maxUnits = snapshot["max_order_units"];
    if (maxUnits && maxUnits.isEnforced !== false) {
      const maxVal = Number(maxUnits.limitValue ?? 0);
      if (maxVal > 0 && totalUnits > maxVal) {
        throw new WholesaleOrderLimitViolationError(
          "MAX_ORDER_UNITS_EXCEEDED",
          `تعداد اقلام سفارش (${totalUnits} عدد) فراتر از سقف واحد مجاز در هر سفارش (${maxVal} عدد) است.`,
          { totalUnits, maxOrderUnits: maxVal },
        );
      }
    }
  }

  async getEntitlementsSummary(accountId: string): Promise<EntitlementsSummary> {
    const membership = await this.getActiveMembership(accountId);
    if (!membership) {
      return {
        isVip: false,
        membershipId: null,
        status: null,
        planId: null,
        planVersionId: null,
        expiresAt: null,
        features: {},
        limits: {},
      };
    }

    const rawLimits = (membership.snapshotLimits as Record<string, any>) || {};
    const parsedLimits: Record<string, LimitEntitlement> = {};
    for (const [k, v] of Object.entries(rawLimits)) {
      parsedLimits[k] = {
        limitValue: BigInt(v.limitValue ?? 0),
        period: v.period || "order",
        isEnforced: v.isEnforced !== false,
      };
    }

    return {
      isVip: true,
      membershipId: membership.id,
      status: membership.status,
      planId: membership.planId,
      planVersionId: membership.planVersionId,
      expiresAt: membership.expiresAt ? new Date(membership.expiresAt).toISOString() : null,
      features: (membership.snapshotFeatures as Record<string, any>) || {},
      limits: parsedLimits,
    };
  }
}
