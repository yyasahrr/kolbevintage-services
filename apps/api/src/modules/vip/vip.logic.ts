/**
 * منطق VIP — پلن و اشتراک و درخواست عمده
 */

import { CatalogDomainError } from "../catalog/catalog.logic";

export type VipPlan = {
  id: string;
  name: string;
  slug: string;
  price: bigint;
  durationDays: number;
  features: Record<string, any>;
  limits: Record<string, any>;
  status: "active" | "archived";
};

export type VipSubscription = {
  id: string;
  userId: string;
  planId: string;
  status: "pending" | "active" | "expired" | "suspended";
  startedAt?: Date | null;
  expiresAt?: Date | null;
};

export type WholesaleRequest = {
  id: string;
  productId: string;
  offerId: string;
  vipAccountId: string;
  quantity: number;
  status: "pending" | "supplier_review" | "accepted" | "rejected" | "ordered";
};

export function isVipSubscriptionActive(sub: VipSubscription): boolean {
  if (sub.status !== "active") return false;
  if (!sub.expiresAt) return true;
  return new Date(sub.expiresAt).getTime() > Date.now();
}

export function assertVipAccess(
  subscription: VipSubscription | null,
  requiredFeature?: string,
  plan?: VipPlan,
): void {
  if (!subscription) {
    throw new CatalogDomainError("VIP_REQUIRED", "برای دسترسی عمده، اشتراک VIP لازم است");
  }
  if (!isVipSubscriptionActive(subscription)) {
    throw new CatalogDomainError("VIP_EXPIRED", "اشتراک VIP شما منقضی شده است");
  }
  if (requiredFeature && plan) {
    const hasFeature = plan.features?.[requiredFeature] === true || plan.features?.[requiredFeature] != null;
    if (!hasFeature) {
      throw new CatalogDomainError(
        "VIP_FEATURE_NOT_INCLUDED",
        `پلن فعلی شما ویژگی ${requiredFeature} را ندارد`,
      );
    }
  }
}

export function validateWholesaleRequestQuantity(
  quantity: number,
  moq: number,
  available?: number,
): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new CatalogDomainError("INVALID_QUANTITY", "تعداد باید عدد صحیح مثبت باشد");
  }
  if (quantity < moq) {
    throw new CatalogDomainError("QUANTITY_BELOW_MOQ", `تعداد درخواستی کمتر از حداقل ${moq} است`);
  }
  // Stock availability is NOT checked at request creation — inventory rechecks at order creation under locks
  // per inventory-contract: supplier acceptance is evidence, not guarantee
  if (available != null && quantity > available) {
    throw new CatalogDomainError("INSUFFICIENT_STOCK", "موجودی کافی نیست");
  }
}

/**
 * جریان درخواست عمده:
 * VIP selects → Request → Supplier availability → Accept/Reject with reason → Order
 */
export function transitionWholesaleRequest(
  current: WholesaleRequest["status"],
  next: WholesaleRequest["status"],
  actorRole: "vip" | "supplier" | "admin",
  rejectionReason?: string,
): void {
  const allowed: Record<string, Array<{ to: WholesaleRequest["status"]; roles: Array<typeof actorRole> }>> = {
    pending: [{ to: "supplier_review", roles: ["vip", "admin"] }],
    supplier_review: [
      { to: "accepted", roles: ["supplier", "admin"] },
      { to: "rejected", roles: ["supplier", "admin"] },
    ],
    accepted: [{ to: "ordered", roles: ["vip", "admin"] }],
    rejected: [],
    ordered: [],
  };

  const transitions = allowed[current] || [];
  const found = transitions.find((t) => t.to === next && t.roles.includes(actorRole));
  if (!found) {
    throw new CatalogDomainError(
      "INVALID_REQUEST_TRANSITION",
      `انتقال درخواست از ${current} به ${next} با نقش ${actorRole} مجاز نیست`,
    );
  }

  if (next === "rejected" && !rejectionReason) {
    throw new CatalogDomainError("REJECTION_REASON_REQUIRED", "برای رد درخواست، دلیل لازم است");
  }
}
