/**
 * Promotions pure core — deterministic, side-effect free.
 *
 * Everything in this file is a pure function over explicit inputs: lifecycle
 * maps, input validation, integer money math, largest-remainder allocation,
 * and the commercial evaluation engine. No database, no clock, no random.
 * (`now` is an explicit parameter so evaluation is reproducible.)
 */

import { createHash } from "node:crypto";
import {
  PROMOTION_BENEFIT_SCOPES,
  PROMOTION_BENEFIT_TYPES,
  PROMOTION_CHANNELS,
  PROMOTION_COUPON_STATUSES,
  PROMOTION_EVALUATION_VERSION,
  PROMOTION_REVISION_STATUSES,
  PROMOTION_SCHEDULE_ACTIONS,
  PROMOTION_SCHEDULE_STATUSES,
  PROMOTION_STACKING_POLICIES,
  PROMOTION_STATUSES,
  PROMOTION_TARGET_TYPES,
  MAX_MONEY_RIAL,
} from "@kolbe/database";
import { PromotionCodes, PromotionDomainError } from "./promotions.errors";

export const EVALUATION_VERSION = PROMOTION_EVALUATION_VERSION;
export const BPS_PER_100_PERCENT = 10_000;
export const MAX_EVALUATION_LINES = 200;
export const MAX_COUPON_CODES_PER_REQUEST = 10;

/* ── lifecycle ─────────────────────────────────────────────────────────── */

export const PROMOTION_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["IN_REVIEW", "ACTIVE", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "SCHEDULED", "ACTIVE", "ARCHIVED"],
  SCHEDULED: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const PROMOTION_REVISION_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["IN_REVIEW", "PUBLISHED", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["SUPERSEDED"],
  SUPERSEDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function assertPromotionTransition(from: string, to: string): void {
  if (!(PROMOTION_STATUSES as readonly string[]).includes(from)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `Unknown promotion status ${from}`);
  }
  if (!(PROMOTION_STATUSES as readonly string[]).includes(to)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `Unknown promotion status ${to}`);
  }
  if (!PROMOTION_TRANSITIONS[from].includes(to)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Illegal promotion transition ${from} → ${to}`);
  }
}

export function assertRevisionTransition(from: string, to: string): void {
  if (!(PROMOTION_REVISION_STATUSES as readonly string[]).includes(from)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `Unknown revision status ${from}`);
  }
  if (!(PROMOTION_REVISION_STATUSES as readonly string[]).includes(to)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `Unknown revision status ${to}`);
  }
  if (!PROMOTION_REVISION_TRANSITIONS[from].includes(to)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Illegal revision transition ${from} → ${to}`);
  }
}

/* ── scalar validation ─────────────────────────────────────────────────── */

const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROMOTION_KEY_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,63}$/;
const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,180}$/;

export function requireText(value: unknown, field: string, maxLength = 256): string {
  if (typeof value !== "string") throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} is required`);
  if (trimmed.length > maxLength) throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} exceeds ${maxLength} chars`);
  return trimmed;
}

export function optionalText(value: unknown, field: string, maxLength = 512): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requireText(value, field, maxLength);
}

export function assertReferenceId(value: string, field: string): string {
  if (!REFERENCE_ID_PATTERN.test(value)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} has an invalid reference shape`);
  }
  return value;
}

export function assertPromotionKey(value: unknown): string {
  const key = requireText(value, "promotionKey", 64).toUpperCase();
  if (!PROMOTION_KEY_PATTERN.test(key)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "promotionKey has an invalid shape");
  }
  return key;
}

export function assertChannel(value: unknown): "RETAIL" | "WHOLESALE" {
  if (value !== "RETAIL" && value !== "WHOLESALE") {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "channel must be RETAIL or WHOLESALE");
  }
  return value;
}

export function assertOneOf(value: unknown, allowed: readonly string[], field: string): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} must be one of ${allowed.join(", ")}`);
  }
  return value;
}

export function requireSafeInteger(value: unknown, field: string, min: number, max: number): number {
  const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} must be an integer in [${min}, ${max}]`);
  }
  return num;
}

/**
 * Strict money parsing. Accepts bigint, integer numbers, and decimal-integer
 * strings. Rejects floats, NaN, scientific notation, currency symbols, and
 * anything outside [0, MAX_MONEY_RIAL]. Browser floats can never survive this.
 */
export function parseMoneyInput(value: unknown, field: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new PromotionDomainError(PromotionCodes.MONEY_INVALID, `${field} must be an integer amount, not a float`);
    }
    parsed = BigInt(value);
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new PromotionDomainError(PromotionCodes.MONEY_INVALID, `${field} must be a decimal integer string`);
    }
    parsed = BigInt(trimmed);
  } else {
    throw new PromotionDomainError(PromotionCodes.MONEY_INVALID, `${field} must be a bigint, integer, or decimal string`);
  }
  if (parsed < 0n || parsed > MAX_MONEY_RIAL) {
    throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, `${field} is outside the allowed money range`);
  }
  return parsed;
}

export function assertMoneySum(values: bigint[], field: string): bigint {
  let total = 0n;
  for (const value of values) {
    total += value;
    if (total > MAX_MONEY_RIAL) {
      throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, `${field} exceeds the allowed money range`);
    }
  }
  return total;
}

/** Normalize a coupon code: trim + uppercase. Empty/invalid shapes rejected. */
export function normalizeCouponCode(value: unknown): string {
  const raw = requireText(value, "couponCode", 64).toUpperCase();
  if (!COUPON_CODE_PATTERN.test(raw)) {
    throw new PromotionDomainError(PromotionCodes.COUPON_INVALID, "couponCode has an invalid shape");
  }
  return raw;
}

export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "idempotencyKey has an invalid shape");
  }
  return value;
}

export function parseDateInput(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, `${field} is not a valid date`);
  }
  return date;
}

export function makePromotionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

/* ── target / benefit authoring validation ──────────────────────────────── */

export type TargetInput = {
  targetType: string;
  referenceId?: string | null;
  minSubtotal?: unknown;
  minQuantity?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

export type NormalizedTarget = {
  targetType: string;
  referenceId: string | null;
  minSubtotal: bigint | null;
  minQuantity: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

const REFERENCE_TARGET_TYPES = ["CHANNEL", "PRODUCT", "CATEGORY", "OFFER", "VIP_PLAN", "VIP_ACCOUNT", "CUSTOMER_SEGMENT"] as const;

export function normalizeTargetInput(input: TargetInput): NormalizedTarget {
  if (!input || typeof input !== "object") {
    throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "target must be an object");
  }
  const targetType = assertOneOf(input.targetType, PROMOTION_TARGET_TYPES as unknown as string[], "targetType");
  if (targetType === "MIN_SUBTOTAL") {
    if (input.minSubtotal === null || input.minSubtotal === undefined || input.minSubtotal === "") {
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "MIN_SUBTOTAL requires minSubtotal");
    }
    return {
      targetType,
      referenceId: null,
      minSubtotal: parseMoneyInput(input.minSubtotal, "minSubtotal"),
      minQuantity: null,
      startsAt: null,
      endsAt: null,
    };
  }
  if (targetType === "MIN_QUANTITY") {
    if (input.minQuantity === null || input.minQuantity === undefined || input.minQuantity === "") {
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "MIN_QUANTITY requires minQuantity");
    }
    return {
      targetType,
      referenceId: null,
      minSubtotal: null,
      minQuantity: requireSafeInteger(input.minQuantity, "minQuantity", 1, 1_000_000),
      startsAt: null,
      endsAt: null,
    };
  }
  if (targetType === "DATE_WINDOW") {
    const startsAt = parseDateInput(input.startsAt, "startsAt");
    const endsAt = parseDateInput(input.endsAt, "endsAt");
    if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "DATE_WINDOW requires startsAt < endsAt");
    }
    return { targetType, referenceId: null, minSubtotal: null, minQuantity: null, startsAt, endsAt };
  }
  if ((REFERENCE_TARGET_TYPES as readonly string[]).includes(targetType)) {
    if (input.referenceId === null || input.referenceId === undefined || input.referenceId === "") {
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, `${targetType} requires referenceId`);
    }
    const referenceId = assertReferenceId(requireText(input.referenceId, "referenceId", 128), "referenceId");
    if (targetType === "CHANNEL" && referenceId !== "RETAIL" && referenceId !== "WHOLESALE") {
      throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "CHANNEL reference must be RETAIL or WHOLESALE");
    }
    return { targetType, referenceId, minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null };
  }
  throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, `Unsupported target type ${targetType}`);
}

export type BenefitInput = {
  benefitType: string;
  scope: string;
  percentBps?: unknown;
  amount?: unknown;
};

export type NormalizedBenefit = {
  benefitType: string;
  scope: string;
  percentBps: number | null;
  amount: bigint | null;
};

export function normalizeBenefitInput(input: BenefitInput): NormalizedBenefit {
  if (!input || typeof input !== "object") {
    throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "benefit must be an object");
  }
  const benefitType = assertOneOf(input.benefitType, PROMOTION_BENEFIT_TYPES as unknown as string[], "benefitType");
  const scope = assertOneOf(input.scope, PROMOTION_BENEFIT_SCOPES as unknown as string[], "scope");
  if (benefitType === "PERCENT_DISCOUNT") {
    if (scope !== "LINE" && scope !== "ORDER") {
      throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "PERCENT_DISCOUNT requires LINE or ORDER scope");
    }
    if (input.percentBps === null || input.percentBps === undefined || input.percentBps === "") {
      throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "PERCENT_DISCOUNT requires percentBps");
    }
    return { benefitType, scope, percentBps: requireSafeInteger(input.percentBps, "percentBps", 1, BPS_PER_100_PERCENT), amount: null };
  }
  if (benefitType === "FIXED_AMOUNT_DISCOUNT") {
    if (scope !== "ORDER") {
      throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "FIXED_AMOUNT_DISCOUNT requires ORDER scope");
    }
    if (input.amount === null || input.amount === undefined || input.amount === "") {
      throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "FIXED_AMOUNT_DISCOUNT requires amount");
    }
    const amount = parseMoneyInput(input.amount, "amount");
    if (amount <= 0n) throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "FIXED_AMOUNT_DISCOUNT amount must be positive");
    return { benefitType, scope, percentBps: null, amount };
  }
  if (scope !== "SHIPPING") {
    throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "FREE_SHIPPING requires SHIPPING scope");
  }
  return { benefitType, scope, percentBps: null, amount: null };
}

/* ── hashing ───────────────────────────────────────────────────────────── */

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "Cannot hash value of unsupported type");
}

export function sha256Hex(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

/** Terms hash: canonical fingerprint of one revision's commercial terms. */
export function hashPromotionTerms(input: {
  stackingPolicy: string;
  priority: number;
  couponRequired: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  targets: NormalizedTarget[];
  benefits: NormalizedBenefit[];
}): string {
  const targets = [...input.targets]
    .map((target) => ({
      t: target.targetType,
      r: target.referenceId,
      s: target.minSubtotal,
      q: target.minQuantity,
      a: target.startsAt,
      b: target.endsAt,
    }))
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)));
  const benefits = [...input.benefits]
    .map((benefit) => ({ t: benefit.benefitType, s: benefit.scope, p: benefit.percentBps, a: benefit.amount }))
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)));
  return sha256Hex(
    canonicalStringify({
      v: EVALUATION_VERSION,
      stacking: input.stackingPolicy,
      priority: input.priority,
      couponRequired: input.couponRequired,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      limitTotal: input.usageLimitTotal,
      limitCustomer: input.usageLimitPerCustomer,
      targets,
      benefits,
    }),
  );
}

/* ── integer money math ────────────────────────────────────────────────── */

/** floor(amount × bps / 10000). bps must be an integer in 1..10000. */
export function percentOf(amount: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 1 || bps > BPS_PER_100_PERCENT) {
    throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "percentBps must be an integer in [1, 10000]");
  }
  if (amount < 0n || amount > MAX_MONEY_RIAL) {
    throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, "percent base is outside the allowed money range");
  }
  return (amount * BigInt(bps)) / BigInt(BPS_PER_100_PERCENT);
}

/**
 * Largest-remainder apportionment of `total` across `weights`.
 *
 * - Deterministic: ties and remainders resolve by ascending `order` keys.
 * - Exact: the parts always sum to `total` (no penny is created or lost).
 * - Safe: zero-weight entries get zero; no part exceeds its weight when
 *   `total <= Σ weights` (the only way the engine calls it).
 */
export function allocateProportionally(total: bigint, weights: bigint[], order: string[]): bigint[] {
  if (weights.length !== order.length) {
    throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "allocation weights and order must align");
  }
  const parts = weights.map(() => 0n);
  if (total <= 0n) return parts;
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightSum <= 0n) return parts;
  if (total > weightSum) {
    throw new PromotionDomainError(PromotionCodes.MONEY_INVALID, "allocation total exceeds the allocatable base");
  }
  const remainders: Array<{ index: number; remainder: bigint }> = [];
  let allocated = 0n;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = weights[index];
    if (weight <= 0n) continue;
    const share = (weight * total) / weightSum;
    parts[index] = share;
    allocated += share;
    remainders.push({ index, remainder: (weight * total) % weightSum });
  }
  let leftover = total - allocated;
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return order[a.index] < order[b.index] ? -1 : order[a.index] > order[b.index] ? 1 : 0;
  });
  for (const entry of remainders) {
    if (leftover <= 0n) break;
    if (parts[entry.index] >= weights[entry.index]) continue;
    parts[entry.index] += 1n;
    leftover -= 1n;
  }
  return parts;
}

/* ── evaluation core ───────────────────────────────────────────────────── */

export type EvaluationLine = {
  lineId: string;
  productId: string;
  categoryId: string | null;
  offerId: string | null;
  quantity: number;
  unitPrice: bigint;
  lineTotal: bigint;
};

export type EvaluationTarget = {
  type: string;
  referenceId: string | null;
  minSubtotal: bigint | null;
  minQuantity: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type EvaluationBenefit = {
  id: string;
  benefitType: string;
  scope: string;
  percentBps: number | null;
  amount: bigint | null;
};

export type EvaluationCoupon = {
  id: string;
  codeNormalized: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  revisionId: string | null;
};

export type EvaluationCandidate = {
  promotionId: string;
  promotionKey: string;
  channel: string;
  status: string;
  revisionId: string;
  revisionStatus: string;
  stackingPolicy: string;
  priority: number;
  couponRequired: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  termsHash: string;
  targets: EvaluationTarget[];
  benefits: EvaluationBenefit[];
  coupons: EvaluationCoupon[];
};

export type EvaluationUsageSnapshot = {
  /** revisionId → committed applications across both ledgers. */
  revisionUses: Map<string, number>;
  /** `${promotionId}‖${customerKey}` → committed applications by this customer. */
  customerUses: Map<string, number>;
  /** couponId → committed redemptions. */
  couponUses: Map<string, number>;
  /** `${couponId}‖${customerKey}` → committed redemptions by this customer. */
  couponCustomerUses: Map<string, number>;
};

export type EvaluationInput = {
  channel: string;
  customerKey: string;
  vipPlanId: string | null;
  vipAccountId: string | null;
  vipActive: boolean;
  segments: string[];
  lines: EvaluationLine[];
  shippingTotal: bigint;
  /** Already-normalized coupon codes presented with the request. */
  couponCodes: string[];
  now: Date;
  candidates: EvaluationCandidate[];
  usage: EvaluationUsageSnapshot;
};

export type AppliedPromotion = {
  promotionId: string;
  promotionKey: string;
  revisionId: string;
  couponId: string | null;
  baseAmount: bigint;
  discountAmount: bigint;
  finalAmount: bigint;
  evaluationHash: string;
};

export type RejectedPromotion = {
  promotionId: string;
  promotionKey: string;
  revisionId: string | null;
  reason: string;
};

export type EvaluationResult = {
  evaluationVersion: string;
  baseSubtotal: bigint;
  baseShipping: bigint;
  lineDiscounts: Array<{ lineId: string; discount: bigint }>;
  orderDiscount: bigint;
  shippingDiscount: bigint;
  totalDiscount: bigint;
  finalSubtotal: bigint;
  finalShipping: bigint;
  finalTotal: bigint;
  appliedPromotions: AppliedPromotion[];
  rejectedPromotions: RejectedPromotion[];
  termsHash: string;
};

export const RejectionReasons = {
  CHANNEL_MISMATCH: "CHANNEL_MISMATCH",
  NOT_ACTIVE: "NOT_ACTIVE",
  STALE_REVISION: "STALE_REVISION",
  WINDOW_EXPIRED: "WINDOW_EXPIRED",
  DATE_WINDOW_UNMET: "DATE_WINDOW_UNMET",
  COUPON_REQUIRED: "COUPON_REQUIRED",
  COUPON_DISABLED: "COUPON_DISABLED",
  COUPON_EXPIRED: "COUPON_EXPIRED",
  COUPON_LIMIT_EXCEEDED: "COUPON_LIMIT_EXCEEDED",
  COUPON_CUSTOMER_LIMIT_EXCEEDED: "COUPON_CUSTOMER_LIMIT_EXCEEDED",
  TARGET_MISMATCH: "TARGET_MISMATCH",
  NO_ELIGIBLE_LINES: "NO_ELIGIBLE_LINES",
  MIN_SUBTOTAL_UNMET: "MIN_SUBTOTAL_UNMET",
  MIN_QUANTITY_UNMET: "MIN_QUANTITY_UNMET",
  USAGE_LIMIT_EXCEEDED: "USAGE_LIMIT_EXCEEDED",
  PER_CUSTOMER_LIMIT_EXCEEDED: "PER_CUSTOMER_LIMIT_EXCEEDED",
  ZERO_DISCOUNT: "ZERO_DISCOUNT",
  EXCLUSIVE_CONFLICT: "EXCLUSIVE_CONFLICT",
} as const;

const LINE_SCOPED_TARGETS = ["PRODUCT", "CATEGORY", "OFFER"] as const;

function withinWindow(now: Date, startsAt: Date | null, endsAt: Date | null): boolean {
  const time = now.getTime();
  if (startsAt && time < startsAt.getTime()) return false;
  if (endsAt && time >= endsAt.getTime()) return false;
  return true;
}

function lineMatchesTarget(line: EvaluationLine, target: EvaluationTarget): boolean {
  if (target.type === "PRODUCT") return line.productId === target.referenceId;
  if (target.type === "CATEGORY") return line.categoryId !== null && line.categoryId === target.referenceId;
  if (target.type === "OFFER") return line.offerId !== null && line.offerId === target.referenceId;
  return true;
}

type CandidateMatch =
  | { applicable: false; reason: string }
  | {
      applicable: true;
      couponId: string | null;
      lineParts: Map<string, bigint>;
      shippingCovered: boolean;
    };

function matchCandidate(
  candidate: EvaluationCandidate,
  input: EvaluationInput,
  baseSubtotal: bigint,
  totalQuantity: number,
): CandidateMatch {
  if (candidate.status !== "ACTIVE") return { applicable: false, reason: RejectionReasons.NOT_ACTIVE };
  if (candidate.channel !== input.channel) return { applicable: false, reason: RejectionReasons.CHANNEL_MISMATCH };
  if (candidate.revisionStatus !== "PUBLISHED") return { applicable: false, reason: RejectionReasons.STALE_REVISION };
  if (!withinWindow(input.now, candidate.startsAt, candidate.endsAt)) {
    return { applicable: false, reason: RejectionReasons.WINDOW_EXPIRED };
  }
  if (candidate.usageLimitTotal !== null && (input.usage.revisionUses.get(candidate.revisionId) ?? 0) >= candidate.usageLimitTotal) {
    return { applicable: false, reason: RejectionReasons.USAGE_LIMIT_EXCEEDED };
  }
  const customerScope = `${candidate.promotionId}‖${input.customerKey}`;
  if (
    candidate.usageLimitPerCustomer !== null &&
    (input.usage.customerUses.get(customerScope) ?? 0) >= candidate.usageLimitPerCustomer
  ) {
    return { applicable: false, reason: RejectionReasons.PER_CUSTOMER_LIMIT_EXCEEDED };
  }

  // Coupon gating. Codes are matched per-candidate so a code minted for one
  // promotion can never unlock another.
  let couponId: string | null = null;
  if (candidate.couponRequired) {
    const presented = candidate.coupons.find((coupon) => input.couponCodes.includes(coupon.codeNormalized));
    if (!presented) return { applicable: false, reason: RejectionReasons.COUPON_REQUIRED };
    if (presented.status !== "ENABLED") return { applicable: false, reason: RejectionReasons.COUPON_DISABLED };
    if (!withinWindow(input.now, presented.startsAt, presented.endsAt)) {
      return { applicable: false, reason: RejectionReasons.COUPON_EXPIRED };
    }
    if (presented.revisionId !== null && presented.revisionId !== candidate.revisionId) {
      return { applicable: false, reason: RejectionReasons.STALE_REVISION };
    }
    if (presented.usageLimit !== null && (input.usage.couponUses.get(presented.id) ?? 0) >= presented.usageLimit) {
      return { applicable: false, reason: RejectionReasons.COUPON_LIMIT_EXCEEDED };
    }
    const couponScope = `${presented.id}‖${input.customerKey}`;
    if (
      presented.perCustomerLimit !== null &&
      (input.usage.couponCustomerUses.get(couponScope) ?? 0) >= presented.perCustomerLimit
    ) {
      return { applicable: false, reason: RejectionReasons.COUPON_CUSTOMER_LIMIT_EXCEEDED };
    }
    couponId = presented.id;
  }

  // Order-scoped targets gate the whole promotion.
  for (const target of candidate.targets) {
    switch (target.type) {
      case "CHANNEL":
        if (target.referenceId !== input.channel) return { applicable: false, reason: RejectionReasons.CHANNEL_MISMATCH };
        break;
      case "VIP_PLAN":
        if (!input.vipActive || input.vipPlanId !== target.referenceId) {
          return { applicable: false, reason: RejectionReasons.TARGET_MISMATCH };
        }
        break;
      case "VIP_ACCOUNT":
        if (!input.vipActive || input.vipAccountId !== target.referenceId) {
          return { applicable: false, reason: RejectionReasons.TARGET_MISMATCH };
        }
        break;
      case "CUSTOMER_SEGMENT":
        if (!input.segments.includes(target.referenceId ?? "")) {
          return { applicable: false, reason: RejectionReasons.TARGET_MISMATCH };
        }
        break;
      case "MIN_SUBTOTAL":
        if (target.minSubtotal === null || baseSubtotal < target.minSubtotal) {
          return { applicable: false, reason: RejectionReasons.MIN_SUBTOTAL_UNMET };
        }
        break;
      case "MIN_QUANTITY":
        if (target.minQuantity === null || totalQuantity < target.minQuantity) {
          return { applicable: false, reason: RejectionReasons.MIN_QUANTITY_UNMET };
        }
        break;
      case "DATE_WINDOW":
        if (!withinWindow(input.now, target.startsAt, target.endsAt)) {
          return { applicable: false, reason: RejectionReasons.DATE_WINDOW_UNMET };
        }
        break;
      case "PRODUCT":
      case "CATEGORY":
      case "OFFER":
        break; // line-scoped; handled below.
      default:
        return { applicable: false, reason: RejectionReasons.TARGET_MISMATCH };
    }
  }

  // Line-scoped targets select the discountable lines (AND semantics).
  const lineTargets = candidate.targets.filter((target) =>
    (LINE_SCOPED_TARGETS as readonly string[]).includes(target.type),
  );
  const eligible = input.lines.filter((line) => lineTargets.every((target) => lineMatchesTarget(line, target)));
  if (eligible.length === 0) return { applicable: false, reason: RejectionReasons.NO_ELIGIBLE_LINES };

  const lineParts = new Map<string, bigint>();
  for (const line of input.lines) lineParts.set(line.lineId, 0n);
  let shippingCovered = false;

  for (const benefit of candidate.benefits) {
    if (benefit.benefitType === "PERCENT_DISCOUNT" && benefit.scope === "LINE" && benefit.percentBps !== null) {
      for (const line of eligible) {
        lineParts.set(line.lineId, (lineParts.get(line.lineId) ?? 0n) + percentOf(line.lineTotal, benefit.percentBps));
      }
    } else if (benefit.benefitType === "PERCENT_DISCOUNT" && benefit.scope === "ORDER" && benefit.percentBps !== null) {
      const base = eligible.reduce((sum, line) => sum + line.lineTotal, 0n);
      const parts = allocateProportionally(
        percentOf(base, benefit.percentBps),
        eligible.map((line) => line.lineTotal),
        eligible.map((line) => line.lineId),
      );
      eligible.forEach((line, index) => {
        lineParts.set(line.lineId, (lineParts.get(line.lineId) ?? 0n) + parts[index]);
      });
    } else if (benefit.benefitType === "FIXED_AMOUNT_DISCOUNT" && benefit.scope === "ORDER" && benefit.amount !== null) {
      const base = eligible.reduce((sum, line) => sum + line.lineTotal, 0n);
      const total = benefit.amount > base ? base : benefit.amount;
      const parts = allocateProportionally(
        total,
        eligible.map((line) => line.lineTotal),
        eligible.map((line) => line.lineId),
      );
      eligible.forEach((line, index) => {
        lineParts.set(line.lineId, (lineParts.get(line.lineId) ?? 0n) + parts[index]);
      });
    } else if (benefit.benefitType === "FREE_SHIPPING" && benefit.scope === "SHIPPING") {
      shippingCovered = true;
    } else {
      return { applicable: false, reason: RejectionReasons.TARGET_MISMATCH };
    }
  }

  // Cap every line part at its line total so a revision with several
  // benefits can never drive a line negative.
  for (const line of input.lines) {
    const part = lineParts.get(line.lineId) ?? 0n;
    if (part > line.lineTotal) lineParts.set(line.lineId, line.lineTotal);
  }
  const lineTotal = [...lineParts.values()].reduce((sum, part) => sum + part, 0n);
  if (lineTotal <= 0n && !shippingCovered) return { applicable: false, reason: RejectionReasons.ZERO_DISCOUNT };
  if (lineTotal <= 0n && shippingCovered && input.shippingTotal <= 0n) {
    return { applicable: false, reason: RejectionReasons.ZERO_DISCOUNT };
  }
  return { applicable: true, couponId, lineParts, shippingCovered };
}

/**
 * Deterministic commercial evaluation. Same committed rows + same input ⇒
 * byte-identical output. Read-only by construction (pure function).
 */
export function evaluatePromotionTerms(input: EvaluationInput): EvaluationResult {
  assertOneOf(input.channel, PROMOTION_CHANNELS as unknown as string[], "channel");
  if (!input.customerKey || typeof input.customerKey !== "string") {
    throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "customerKey is required");
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "now must be a valid Date");
  }
  if (input.lines.length > MAX_EVALUATION_LINES) {
    throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `at most ${MAX_EVALUATION_LINES} lines per evaluation`);
  }
  if (input.couponCodes.length > MAX_COUPON_CODES_PER_REQUEST) {
    throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, "too many coupon codes");
  }
  const seenLines = new Set<string>();
  for (const line of input.lines) {
    if (seenLines.has(line.lineId)) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `duplicate lineId ${line.lineId}`);
    }
    seenLines.add(line.lineId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `line ${line.lineId} has an invalid quantity`);
    }
    if (line.unitPrice < 0n || line.unitPrice > MAX_MONEY_RIAL || line.lineTotal < 0n || line.lineTotal > MAX_MONEY_RIAL) {
      throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, `line ${line.lineId} carries an out-of-range amount`);
    }
    if (line.lineTotal !== line.unitPrice * BigInt(line.quantity)) {
      throw new PromotionDomainError(PromotionCodes.EVALUATION_INVALID, `line ${line.lineId} total is inconsistent with its unit price`);
    }
  }
  if (input.shippingTotal < 0n || input.shippingTotal > MAX_MONEY_RIAL) {
    throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, "shippingTotal is outside the allowed money range");
  }

  const baseSubtotal = assertMoneySum(
    input.lines.map((line) => line.lineTotal),
    "baseSubtotal",
  );
  const baseTotal = baseSubtotal + input.shippingTotal;
  if (baseTotal > MAX_MONEY_RIAL) {
    throw new PromotionDomainError(PromotionCodes.MONEY_OUT_OF_RANGE, "order base exceeds the allowed money range");
  }
  const totalQuantity = input.lines.reduce((sum, line) => sum + line.quantity, 0);

  // Total deterministic order: priority ascending, promotion id ascending.
  const ordered = [...input.candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0;
  });

  const matches = ordered.map((candidate) => ({ candidate, match: matchCandidate(candidate, input, baseSubtotal, totalQuantity) }));
  const rejected: RejectedPromotion[] = [];
  for (const { candidate, match } of matches) {
    if (!match.applicable) {
      rejected.push({
        promotionId: candidate.promotionId,
        promotionKey: candidate.promotionKey,
        revisionId: candidate.revisionId,
        reason: match.reason,
      });
    }
  }
  let applicable = matches.filter((entry): entry is { candidate: EvaluationCandidate; match: Extract<CandidateMatch, { applicable: true }> } => entry.match.applicable);

  // Exclusivity: the first applicable EXCLUSIVE wins alone; everything else
  // is rejected with EXCLUSIVE_CONFLICT (never "best discount" guessing).
  const exclusiveWinner = applicable.find((entry) => entry.candidate.stackingPolicy === "EXCLUSIVE");
  if (exclusiveWinner) {
    for (const entry of applicable) {
      if (entry !== exclusiveWinner) {
        rejected.push({
          promotionId: entry.candidate.promotionId,
          promotionKey: entry.candidate.promotionKey,
          revisionId: entry.candidate.revisionId,
          reason: RejectionReasons.EXCLUSIVE_CONFLICT,
        });
      }
    }
    applicable = [exclusiveWinner];
  }

  // Combine stackables: each was computed on base totals; sum per line and
  // cap at the line total so the result is order-independent.
  const combined = new Map<string, bigint>();
  for (const line of input.lines) combined.set(line.lineId, 0n);
  for (const entry of applicable) {
    for (const [lineId, part] of entry.match.lineParts) {
      combined.set(lineId, (combined.get(lineId) ?? 0n) + part);
    }
  }
  for (const line of input.lines) {
    const sum = combined.get(line.lineId) ?? 0n;
    if (sum > line.lineTotal) combined.set(line.lineId, line.lineTotal);
  }

  const shippingCovered = applicable.some((entry) => entry.match.shippingCovered);
  const shippingDiscount = shippingCovered ? input.shippingTotal : 0n;

  const lineDiscounts = input.lines.map((line) => ({ lineId: line.lineId, discount: combined.get(line.lineId) ?? 0n }));
  const orderDiscount = lineDiscounts.reduce((sum, entry) => sum + entry.discount, 0n);
  const totalDiscount = orderDiscount + shippingDiscount;
  const finalSubtotal = baseSubtotal - orderDiscount;
  const finalShipping = input.shippingTotal - shippingDiscount;

  // Attribution: each line's combined value goes to the earliest applied
  // promotion (in deterministic order) that claimed that line, and shipping
  // coverage goes to the first covering promotion — so Σ attribution ==
  // totals exactly, with no double counting.
  const attributedLine = new Map<string, bigint>();
  for (const entry of applicable) attributedLine.set(entry.candidate.promotionId, 0n);
  for (const line of input.lines) {
    let rest = combined.get(line.lineId) ?? 0n;
    if (rest <= 0n) continue;
    for (const entry of applicable) {
      if (rest <= 0n) break;
      const claimed = entry.match.lineParts.get(line.lineId) ?? 0n;
      if (claimed <= 0n) continue;
      const take = claimed >= rest ? rest : claimed;
      attributedLine.set(entry.candidate.promotionId, (attributedLine.get(entry.candidate.promotionId) ?? 0n) + take);
      rest -= take;
    }
  }
  const shippingRecipient = applicable.find((entry) => entry.match.shippingCovered)?.candidate.promotionId ?? null;

  const applied: AppliedPromotion[] = applicable.map((entry) => {
    const shippingShare = entry.candidate.promotionId === shippingRecipient ? shippingDiscount : 0n;
    const discountAmount = (attributedLine.get(entry.candidate.promotionId) ?? 0n) + shippingShare;
    const finalAmount = baseTotal - discountAmount;
    return {
      promotionId: entry.candidate.promotionId,
      promotionKey: entry.candidate.promotionKey,
      revisionId: entry.candidate.revisionId,
      couponId: entry.match.couponId,
      baseAmount: baseTotal,
      discountAmount,
      finalAmount,
      evaluationHash: sha256Hex(
        canonicalStringify({
          v: EVALUATION_VERSION,
          channel: input.channel,
          customer: input.customerKey,
          promotion: entry.candidate.promotionId,
          revision: entry.candidate.revisionId,
          terms: entry.candidate.termsHash,
          coupon: entry.match.couponId,
          base: baseTotal,
          discount: discountAmount,
          final: finalAmount,
        }),
      ),
    };
  });

  const termsHash = sha256Hex(
    canonicalStringify({
      v: EVALUATION_VERSION,
      channel: input.channel,
      customer: input.customerKey,
      lines: input.lines.map((line) => ({ id: line.lineId, total: line.lineTotal })),
      shipping: input.shippingTotal,
      applied: applied.map((entry) => ({
        p: entry.promotionId,
        r: entry.revisionId,
        c: entry.couponId,
        d: entry.discountAmount,
      })),
    }),
  );

  return {
    evaluationVersion: EVALUATION_VERSION,
    baseSubtotal,
    baseShipping: input.shippingTotal,
    lineDiscounts,
    orderDiscount,
    shippingDiscount,
    totalDiscount,
    finalSubtotal,
    finalShipping,
    finalTotal: finalSubtotal + finalShipping,
    appliedPromotions: applied,
    rejectedPromotions: rejected,
    termsHash,
  };
}

export function assertScheduleAction(value: unknown): string {
  return assertOneOf(value, PROMOTION_SCHEDULE_ACTIONS as unknown as string[], "action");
}

export function assertScheduleStatus(value: unknown): string {
  return assertOneOf(value, PROMOTION_SCHEDULE_STATUSES as unknown as string[], "status");
}

export function assertStackingPolicy(value: unknown): string {
  return assertOneOf(value, PROMOTION_STACKING_POLICIES as unknown as string[], "stackingPolicy");
}

export function assertCouponStatus(value: unknown): string {
  return assertOneOf(value, PROMOTION_COUPON_STATUSES as unknown as string[], "status");
}
