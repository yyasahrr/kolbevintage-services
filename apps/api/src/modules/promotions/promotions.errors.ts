import { DomainError } from "@kolbe/shared";

/**
 * Promotion domain errors. `code` is the stable client contract;
 * `message` is human-readable and may change.
 */
export class PromotionDomainError extends DomainError {
  constructor(code: string, message?: string, status = 422) {
    super(status, code, message ?? code);
    this.name = "PromotionDomainError";
  }
}

export class PromotionNotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(404, "PROMOTION_NOT_FOUND", `${entity}${id ? ` ${id}` : ""} not found`);
    this.name = "PromotionNotFoundError";
  }
}

export class PromotionConflictError extends DomainError {
  constructor(code: string, message?: string) {
    super(409, code, message ?? code);
    this.name = "PromotionConflictError";
  }
}

export const PromotionCodes = {
  INVALID_INPUT: "PROMOTION_INVALID_INPUT",
  INVALID_TRANSITION: "PROMOTION_INVALID_TRANSITION",
  TERMS_IMMUTABLE: "PROMOTION_TERMS_IMMUTABLE",
  TARGET_INVALID: "PROMOTION_TARGET_INVALID",
  BENEFIT_INVALID: "PROMOTION_BENEFIT_INVALID",
  MONEY_INVALID: "PROMOTION_MONEY_INVALID",
  MONEY_OUT_OF_RANGE: "PROMOTION_MONEY_OUT_OF_RANGE",
  REVISION_REQUIRED: "PROMOTION_REVISION_REQUIRED",
  REVISION_MISMATCH: "PROMOTION_REVISION_MISMATCH",
  COUPON_INVALID: "PROMOTION_COUPON_INVALID",
  COUPON_DUPLICATE: "PROMOTION_COUPON_DUPLICATE",
  COUPON_DISABLED: "PROMOTION_COUPON_DISABLED",
  COUPON_EXPIRED: "PROMOTION_COUPON_EXPIRED",
  COUPON_LIMIT_EXCEEDED: "PROMOTION_COUPON_LIMIT_EXCEEDED",
  USAGE_LIMIT_EXCEEDED: "PROMOTION_USAGE_LIMIT_EXCEEDED",
  CHANNEL_MISMATCH: "PROMOTION_CHANNEL_MISMATCH",
  NOT_ACTIVE: "PROMOTION_NOT_ACTIVE",
  APPROVAL_REQUIRED: "PROMOTION_APPROVAL_REQUIRED",
  APPROVAL_INVALID: "PROMOTION_APPROVAL_INVALID",
  SCHEDULE_INVALID: "PROMOTION_SCHEDULE_INVALID",
  EVALUATION_INVALID: "PROMOTION_EVALUATION_INVALID",
} as const;
