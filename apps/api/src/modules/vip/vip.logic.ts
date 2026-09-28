/**
 * منطق VIP — پلن و اشتراک و درخواست عمده Phase 4.4
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

export type WholesaleRequestStatus =
  | "pending"
  | "supplier_review"
  | "revision_requested"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "expired"
  | "ordered";

export type WholesaleRequest = {
  id: string;
  productId: string;
  offerId: string;
  vipAccountId: string;
  quantity: number;
  status: WholesaleRequestStatus;
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
  if (available != null && quantity > available) {
    throw new CatalogDomainError("INSUFFICIENT_STOCK", "موجودی کافی نیست");
  }
}

/**
 * جریان درخواست عمده Phase 4.4:
 * pending → supplier_review → revision_requested → supplier_review → accepted → ordered
 * pending/supplier_review/revision_requested/accepted → cancelled (buyer/admin)
 * supplier_review/revision_requested → rejected (supplier/admin)
 * pending/supplier_review/revision_requested/accepted → expired (system)
 * Terminal: rejected, cancelled, expired, ordered
 */
export function transitionWholesaleRequest(
  current: WholesaleRequestStatus,
  next: WholesaleRequestStatus,
  actorRole: "vip" | "supplier" | "admin" | "system",
  rejectionReason?: string,
): void {
  const allowed: Record<
    WholesaleRequestStatus,
    Array<{ to: WholesaleRequestStatus; roles: Array<"vip" | "supplier" | "admin" | "system"> }>
  > = {
    pending: [
      { to: "supplier_review", roles: ["vip", "admin"] },
      { to: "cancelled", roles: ["vip", "admin"] },
      { to: "expired", roles: ["system"] },
    ],
    supplier_review: [
      { to: "revision_requested", roles: ["supplier", "admin"] },
      { to: "accepted", roles: ["supplier", "admin"] },
      { to: "rejected", roles: ["supplier", "admin"] },
      { to: "cancelled", roles: ["vip", "admin"] },
      { to: "expired", roles: ["system"] },
    ],
    revision_requested: [
      { to: "supplier_review", roles: ["vip", "admin"] },
      { to: "rejected", roles: ["supplier", "admin"] },
      { to: "cancelled", roles: ["vip", "admin"] },
      { to: "expired", roles: ["system"] },
    ],
    accepted: [
      { to: "ordered", roles: ["vip", "admin", "system"] },
      { to: "cancelled", roles: ["vip", "admin"] },
      { to: "expired", roles: ["system"] },
    ],
    rejected: [],
    cancelled: [],
    expired: [],
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

export function isTerminalRequestStatus(status: WholesaleRequestStatus): boolean {
  return ["rejected", "cancelled", "expired", "ordered"].includes(status);
}
