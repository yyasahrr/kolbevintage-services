/**
 * Phase 5.7 — Promotions pure commercial core.
 *
 * Everything in this file is deterministic and side-effect free: lifecycle
 * rules, input validators, integer money math, the stacking/eligibility
 * engine, and terms hashing. Services do I/O and auditing; they never embed
 * commercial math. No floats anywhere — money is `bigint` (IRR), percent is
 * integer basis points (15% = 1500).
 */

import { createHash, randomUUID } from "node:crypto";
import { DomainError, MAX_MONEY } from "@kolbe/shared";
import {
  CRM_STAGES,
  PROMOTION_BENEFIT_SCOPES,
  PROMOTION_BENEFIT_TYPES,
  PROMOTION_CHANNELS,
  PROMOTION_REVISION_STATUSES,
  PROMOTION_STACKING_POLICIES,
  PROMOTION_STATUSES,
  PROMOTION_TARGET_TYPES,
} from "@kolbe/database";
import { PROMOTION_EVALUATION_VERSION } from "./promotions.contract";

export class PromotionDomainError extends DomainError {
  constructor(code: string, message: string, status = 400) {
    super(status, code, message);
    this.name = "PromotionDomainError";
  }
}

export function makePromotionId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/* ── Lifecycle ────────────────────────────────────────────────────────── */

export const PROMOTION_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["DRAFT", "SCHEDULED", "ACTIVE", "ARCHIVED"],
  SCHEDULED: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["PAUSED", "ENDED"],
  PAUSED: ["ACTIVE", "ENDED"],
  ENDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const PROMOTION_REVISION_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

function assertStatusTransition(
  allowed: Record<string, readonly string[]>,
  from: string,
  to: string,
  code: string,
): void {
  const next = allowed[from];
  if (!next || !next.includes(to)) {
    throw new PromotionDomainError(code, `Illegal promotion transition ${from} -> ${to}`, 409);
  }
}

export function assertPromotionTransition(from: string, to: string): void {
  assertStatusTransition(PROMOTION_TRANSITIONS, from, to, "PROMOTION_TRANSITION_ILLEGAL");
}

export function assertRevisionTransition(from: string, to: string): void {
  assertStatusTransition(PROMOTION_REVISION_TRANSITIONS, from, to, "PROMOTION_REVISION_TRANSITION_ILLEGAL");
}

/* ── Validators (allowlisted, server-side) ─────────────────────────────── */

const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function assertLength(value: string, min: number, max: number, code: string, field: string): void {
  if (value.length < min || value.length > max) {
    throw new PromotionDomainError(code, `${field} must be ${min}..${max} characters`);
  }
}

function assertPattern(value: string, pattern: RegExp, code: string, field: string): void {
  if (!pattern.test(value)) {
    throw new PromotionDomainError(code, `${field} has an invalid format`);
  }
}

export function assertInList(value: string, list: readonly string[], code: string, field: string): void {
  if (!list.includes(value)) {
    throw new PromotionDomainError(code, `${field} '${value}' is not allowlisted`);
  }
}

export function parseChannel(value: unknown): "RETAIL" | "WHOLESALE" {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_CHANNEL_INVALID", "channel is required");
  assertInList(text, PROMOTION_CHANNELS, "PROMOTION_CHANNEL_INVALID", "channel");
  return text as "RETAIL" | "WHOLESALE";
}

export function parsePromotionStatus(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_STATUS_INVALID", "status is required");
  assertInList(text, PROMOTION_STATUSES, "PROMOTION_STATUS_INVALID", "status");
  return text;
}

export function parseRevisionStatus(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_REVISION_STATUS_INVALID", "revision status is required");
  assertInList(text, PROMOTION_REVISION_STATUSES, "PROMOTION_REVISION_STATUS_INVALID", "revision status");
  return text;
}

export function parseBenefitType(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_BENEFIT_INVALID", "benefit_type is required");
  assertInList(text, PROMOTION_BENEFIT_TYPES, "PROMOTION_BENEFIT_INVALID", "benefit_type");
  return text;
}

export function parseBenefitScope(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_BENEFIT_INVALID", "benefit_scope is required");
  assertInList(text, PROMOTION_BENEFIT_SCOPES, "PROMOTION_BENEFIT_INVALID", "benefit_scope");
  return text;
}

export function parseStackingPolicy(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_STACKING_INVALID", "stacking_policy is required");
  assertInList(text, PROMOTION_STACKING_POLICIES, "PROMOTION_STACKING_INVALID", "stacking_policy");
  return text;
}

export function parseTargetType(value: unknown): string {
  const text = asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "target_type is required");
  assertInList(text, PROMOTION_TARGET_TYPES, "PROMOTION_TARGET_INVALID", "target_type");
  return text;
}

/** BIGINT IRR from a decimal string, safe integer, or bigint. Rejects floats, signs, overflow. */
export function parseMoneyInput(value: unknown, field: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PromotionDomainError("PROMOTION_MONEY_INVALID", `${field} must be a non-negative integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!/^\d{1,19}$/.test(text)) {
      throw new PromotionDomainError("PROMOTION_MONEY_INVALID", `${field} must be a decimal integer string`);
    }
    parsed = BigInt(text);
  } else {
    throw new PromotionDomainError("PROMOTION_MONEY_INVALID", `${field} must be a decimal integer string`);
  }
  if (parsed > MAX_MONEY) {
    throw new PromotionDomainError("PROMOTION_MONEY_OVERFLOW", `${field} exceeds the maximum money value`);
  }
  return parsed;
}

export function parsePositiveInt(value: unknown, field: string, max: number, code = "PROMOTION_INPUT_INVALID"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{1,15}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new PromotionDomainError(code, `${field} must be an integer 1..${max}`);
  }
  return parsed;
}

export function parseNonNegativeInt(value: unknown, field: string, max: number, code = "PROMOTION_INPUT_INVALID"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d{1,15}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new PromotionDomainError(code, `${field} must be an integer 0..${max}`);
  }
  return parsed;
}

export function parseBasisPoints(value: unknown): number {
  return parsePositiveInt(value, "percent_bps", 10_000, "PROMOTION_BENEFIT_INVALID");
}

export function parsePriority(value: unknown): number {
  return parseNonNegativeInt(value, "priority", 1_000_000, "PROMOTION_INPUT_INVALID");
}

export function parseUsageLimit(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return parsePositiveInt(value, field, 1_000_000_000, "PROMOTION_LIMIT_INVALID");
}

/** Internal promotion key: canonical uppercase, strict — no silent normalization. */
export function parsePromotionCode(value: unknown): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_CODE_INVALID", "code is required");
  assertLength(text, 3, 64, "PROMOTION_CODE_INVALID", "code");
  assertPattern(text, /^[A-Z0-9][A-Z0-9_-]*$/, "PROMOTION_CODE_INVALID", "code");
  return text;
}

/** Coupon codes normalize (trim + uppercase); anything outside the coupon alphabet rejects. */
export function normalizeCouponCode(value: unknown): string {
  const text = asString(value)?.trim().toUpperCase();
  if (!text) throw new PromotionDomainError("PROMOTION_COUPON_INVALID", "coupon code is required");
  assertLength(text, 2, 64, "PROMOTION_COUPON_INVALID", "coupon code");
  assertPattern(text, /^[A-Z0-9][A-Z0-9_-]*$/, "PROMOTION_COUPON_INVALID", "coupon code");
  return text;
}

export function parseTitle(value: unknown, field = "title"): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", `${field} is required`);
  assertLength(text, 1, 160, "PROMOTION_INPUT_INVALID", field);
  return text;
}

export function parseOptionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = asString(value);
  if (text === null) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", `${field} must be text`);
  assertLength(text.trim(), 1, max, "PROMOTION_INPUT_INVALID", field);
  return text.trim();
}

export function parseActorRef(value: unknown, field: string): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_ACTOR_INVALID", `${field} is required`);
  assertLength(text, 1, 160, "PROMOTION_ACTOR_INVALID", field);
  // eslint-disable-next-line no-control-regex
  assertPattern(text, /^[^\u0000-\u001f\u007f]+$/, "PROMOTION_ACTOR_INVALID", field);
  return text;
}

export function parseReferenceId(value: unknown, field: string): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", `${field} is required`);
  assertLength(text, 1, 160, "PROMOTION_TARGET_INVALID", field);
  assertPattern(text, /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/, "PROMOTION_TARGET_INVALID", field);
  return text;
}

export function parseSegmentValue(value: unknown): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "CUSTOMER_SEGMENT value is required");
  const tagMatch = /^tag:[a-z0-9_]{1,80}$/.exec(text);
  if (tagMatch) return text;
  const stageMatch = /^stage:([A-Z_]{1,40})$/.exec(text);
  if (stageMatch && (CRM_STAGES as readonly string[]).includes(stageMatch[1])) return text;
  throw new PromotionDomainError(
    "PROMOTION_TARGET_INVALID",
    "CUSTOMER_SEGMENT value must be tag:<crm_tag_key> or stage:<CRM_STAGE>",
  );
}

export type ParsedTargetValue = {
  valueText: string | null;
  valueAmount: bigint | null;
  valueQuantity: number | null;
};

/**
 * Exactly one value column per target type (mirrors the database coherence
 * CHECK). Unknown shapes reject — there is no expression language.
 */
export function parseTargetValue(
  targetType: string,
  input: { valueText?: unknown; valueAmount?: unknown; valueQuantity?: unknown },
): ParsedTargetValue {
  const hasText = input.valueText !== null && input.valueText !== undefined && input.valueText !== "";
  const hasAmount = input.valueAmount !== null && input.valueAmount !== undefined && input.valueAmount !== "";
  const hasQuantity = input.valueQuantity !== null && input.valueQuantity !== undefined && input.valueQuantity !== "";
  if (targetType === "MIN_SUBTOTAL") {
    if (!hasAmount || hasText || hasQuantity) {
      throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "MIN_SUBTOTAL requires value_amount only");
    }
    const amount = parseMoneyInput(input.valueAmount, "value_amount");
    if (amount <= 0n) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "MIN_SUBTOTAL must be positive");
    return { valueText: null, valueAmount: amount, valueQuantity: null };
  }
  if (targetType === "MIN_QUANTITY") {
    if (!hasQuantity || hasText || hasAmount) {
      throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "MIN_QUANTITY requires value_quantity only");
    }
    return { valueText: null, valueAmount: null, valueQuantity: parsePositiveInt(input.valueQuantity, "value_quantity", 1_000_000_000, "PROMOTION_TARGET_INVALID") };
  }
  if (!hasText || hasAmount || hasQuantity) {
    throw new PromotionDomainError("PROMOTION_TARGET_INVALID", `${targetType} requires value_text only`);
  }
  const valueText = targetType === "CUSTOMER_SEGMENT"
    ? parseSegmentValue(input.valueText)
    : parseReferenceId(input.valueText, "value_text");
  return { valueText, valueAmount: null, valueQuantity: null };
}

export type ParsedBenefit = {
  benefitType: string;
  benefitScope: string;
  percentBps: number | null;
  amount: bigint | null;
};

/** Benefit/scope/value coherence (mirrors the database CHECK, stricter on zeros). */
export function parseBenefit(input: {
  benefitType: unknown;
  benefitScope: unknown;
  percentBps?: unknown;
  amount?: unknown;
}): ParsedBenefit {
  const benefitType = parseBenefitType(input.benefitType);
  const benefitScope = parseBenefitScope(input.benefitScope);
  const hasBps = input.percentBps !== null && input.percentBps !== undefined;
  const hasAmount = input.amount !== null && input.amount !== undefined;
  if (benefitType === "PERCENT_DISCOUNT") {
    if ((benefitScope !== "LINE" && benefitScope !== "ORDER") || !hasBps || hasAmount) {
      throw new PromotionDomainError(
        "PROMOTION_BENEFIT_INVALID",
        "PERCENT_DISCOUNT requires LINE|ORDER scope with percent_bps and no amount",
      );
    }
    return { benefitType, benefitScope, percentBps: parseBasisPoints(input.percentBps), amount: null };
  }
  if (benefitType === "FIXED_AMOUNT_DISCOUNT") {
    if (benefitScope !== "ORDER" || !hasAmount || hasBps) {
      throw new PromotionDomainError(
        "PROMOTION_BENEFIT_INVALID",
        "FIXED_AMOUNT_DISCOUNT requires ORDER scope with amount and no percent_bps",
      );
    }
    const amount = parseMoneyInput(input.amount, "amount");
    if (amount <= 0n) throw new PromotionDomainError("PROMOTION_BENEFIT_INVALID", "FIXED_AMOUNT_DISCOUNT amount must be positive");
    return { benefitType, benefitScope, percentBps: null, amount };
  }
  if (benefitScope !== "SHIPPING" || hasBps || hasAmount) {
    throw new PromotionDomainError(
      "PROMOTION_BENEFIT_INVALID",
      "FREE_SHIPPING requires SHIPPING scope with no percent_bps and no amount",
    );
  }
  return { benefitType, benefitScope, percentBps: null, amount: null };
}

export function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const text = value instanceof Date ? value.toISOString() : asString(value);
  if (!text) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", `${field} must be an ISO timestamp`);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new PromotionDomainError("PROMOTION_INPUT_INVALID", `${field} must be an ISO timestamp`);
  }
  return parsed;
}

export function assertWindowValid(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new PromotionDomainError("PROMOTION_WINDOW_INVALID", "ends_at must be after starts_at");
  }
}

export function parseIdempotencyKey(value: unknown): string {
  const text = asString(value)?.trim();
  if (!text) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", "idempotency_key is required");
  assertLength(text, 1, 128, "PROMOTION_INPUT_INVALID", "idempotency_key");
  assertPattern(text, /^[A-Za-z0-9_:.=-]+$/, "PROMOTION_INPUT_INVALID", "idempotency_key");
  return text;
}

export function parsePriceBasis(value: unknown): { kind: "SERVER_RESOLVED"; resolvedBy: string; reference: string | null } {
  if (!value || typeof value !== "object") {
    throw new PromotionDomainError("PROMOTION_PRICE_BASIS_REJECTED", "priceBasis with kind SERVER_RESOLVED is required");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "SERVER_RESOLVED") {
    throw new PromotionDomainError(
      "PROMOTION_PRICE_BASIS_REJECTED",
      "only server-resolved base prices are accepted; browser prices have no representation here",
    );
  }
  const resolvedBy = asString(record.resolvedBy)?.trim() ?? "";
  assertLength(resolvedBy, 1, 120, "PROMOTION_PRICE_BASIS_REJECTED", "priceBasis.resolvedBy");
  assertPattern(resolvedBy, /^[A-Za-z0-9_.-]+$/, "PROMOTION_PRICE_BASIS_REJECTED", "priceBasis.resolvedBy");
  return { kind: "SERVER_RESOLVED", resolvedBy, reference: parseOptionalText(record.reference, "priceBasis.reference", 256) };
}

/* ── Integer money math ───────────────────────────────────────────────── */

function assertBigintAmount(value: bigint, field: string): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_MONEY) {
    throw new PromotionDomainError("PROMOTION_MONEY_INVALID", `${field} out of range`);
  }
}

/** floor(base × bps / 10000). The ONLY percent operation in the engine. */
export function percentDiscountOf(base: bigint, bps: number): bigint {
  assertBigintAmount(base, "base");
  if (!Number.isSafeInteger(bps) || bps < 1 || bps > 10_000) {
    throw new PromotionDomainError("PROMOTION_BENEFIT_INVALID", "percent_bps must be 1..10000");
  }
  return (base * BigInt(bps)) / 10_000n;
}

export function clampDiscount(base: bigint, discount: bigint): bigint {
  assertBigintAmount(base, "base");
  if (typeof discount !== "bigint") throw new PromotionDomainError("PROMOTION_MONEY_INVALID", "discount must be bigint");
  if (discount < 0n) return 0n;
  return discount > base ? base : discount;
}

export type AllocationSlice = { lineId: string; base: bigint };

/**
 * Deterministic order-level allocation: proportional floor per line, then the
 * integer remainder (+1 each) to lines in ascending lineId order over lines
 * with a positive remaining base. Total never exceeds the sum of bases, and
 * no line is ever allocated more than its base.
 */
export function allocateAcrossLines(total: bigint, slices: AllocationSlice[]): Map<string, bigint> {
  assertBigintAmount(total, "total");
  const ordered = [...slices].sort((a, b) => (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0));
  const sum = ordered.reduce((acc, slice) => {
    assertBigintAmount(slice.base, `line ${slice.lineId} base`);
    return acc + slice.base;
  }, 0n);
  if (total > sum) {
    throw new PromotionDomainError("PROMOTION_ALLOCATION_INVALID", "discount exceeds the allocatable base");
  }
  const eligible = ordered.filter((slice) => slice.base > 0n);
  const result = new Map<string, bigint>(ordered.map((slice) => [slice.lineId, 0n]));
  if (eligible.length === 0 || total === 0n || sum === 0n) return result;
  let assigned = 0n;
  for (const slice of eligible) {
    const share = (total * slice.base) / sum;
    result.set(slice.lineId, share);
    assigned += share;
  }
  let remainder = total - assigned;
  let cursor = 0;
  while (remainder > 0n) {
    const slice = eligible[cursor % eligible.length];
    const current = result.get(slice.lineId) ?? 0n;
    if (current < slice.base) {
      result.set(slice.lineId, current + 1n);
      remainder -= 1n;
    }
    cursor += 1;
    // Total <= sum guarantees capacity; the guard is dead-code insurance.
    if (cursor > eligible.length * 4 + 8 && remainder > 0n) {
      throw new PromotionDomainError("PROMOTION_ALLOCATION_INVALID", "allocation remainder cannot be placed");
    }
  }
  return result;
}

/* ── Canonical hashing ────────────────────────────────────────────────── */

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`).join(",")}}}`;
}

export function hashTerms(payload: unknown): string {
  return createHash("sha256").update(canonicalStringify(payload)).digest("hex");
}

export type RevisionTermsInput = {
  benefitType: string;
  benefitScope: string;
  percentBps: number | null;
  amount: bigint | null;
  currency: string;
  stackingPolicy: string;
  priority: number;
  maxTotalUses: number | null;
  maxUsesPerActor: number | null;
  couponRequired: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type RevisionTargetInput = {
  targetType: string;
  valueText: string | null;
  valueAmount: bigint | null;
  valueQuantity: number | null;
};

/** Canonical terms hash: binds benefit, limits, window, and every target row. */
export function hashRevisionTerms(terms: RevisionTermsInput, targets: RevisionTargetInput[]): string {
  const ordered = [...targets]
    .map((target) => ({
      type: target.targetType,
      text: target.valueText,
      amount: target.valueAmount === null ? null : target.valueAmount.toString(),
      quantity: target.valueQuantity,
    }))
    .sort((a, b) => canonicalStringify(a).localeCompare(canonicalStringify(b)));
  return hashTerms({
    benefitType: terms.benefitType,
    benefitScope: terms.benefitScope,
    percentBps: terms.percentBps,
    amount: terms.amount === null ? null : terms.amount.toString(),
    currency: terms.currency,
    stackingPolicy: terms.stackingPolicy,
    priority: terms.priority,
    maxTotalUses: terms.maxTotalUses,
    maxUsesPerActor: terms.maxUsesPerActor,
    couponRequired: terms.couponRequired,
    startsAt: terms.startsAt ? terms.startsAt.toISOString() : null,
    endsAt: terms.endsAt ? terms.endsAt.toISOString() : null,
    targets: ordered,
  });
}

/* ── Pure evaluation engine ───────────────────────────────────────────── */

export const PROMOTION_REJECTION_REASONS = [
  "CHANNEL_MISMATCH",
  "PROMOTION_NOT_ACTIVE",
  "TERMS_WINDOW_INACTIVE",
  "COUPON_REQUIRED_MISSING",
  "STALE_COUPON_REVISION",
  "USAGE_LIMIT_EXHAUSTED",
  "ACTOR_USAGE_LIMIT_EXHAUSTED",
  "MIN_SUBTOTAL_NOT_MET",
  "MIN_QUANTITY_NOT_MET",
  "VIP_PLAN_MISMATCH",
  "VIP_ACCOUNT_MISMATCH",
  "SEGMENT_MISMATCH",
  "NO_MATCHING_LINES",
  "SHIPPING_CONTEXT_MISSING",
  "EXCLUSIVE_CONFLICT",
] as const;

export type EngineLine = {
  lineId: string;
  productId: string;
  categoryId: string | null;
  offerId: string | null;
  quantity: number;
  unitPrice: bigint;
  lineBase: bigint;
};

export type EngineActor = {
  kind: "RETAIL_CUSTOMER" | "WHOLESALE_ACCOUNT";
  userId: string;
  accountId: string | null;
  vipPlanId: string | null;
  hasActiveVip: boolean;
  segments: string[];
};

export type EngineTarget = {
  type: string;
  valueText: string | null;
  valueAmount: bigint | null;
  valueQuantity: number | null;
};

export type EngineCoupon = { couponId: string; code: string } | null;

export type EngineCandidate = {
  promotionId: string;
  code: string;
  channel: string;
  status: string;
  revisionId: string;
  revisionNumber: number;
  benefitType: string;
  benefitScope: string;
  percentBps: number | null;
  amount: bigint | null;
  stackingPolicy: string;
  priority: number;
  maxTotalUses: number | null;
  maxUsesPerActor: number | null;
  couponRequired: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  termsHash: string;
  targets: EngineTarget[];
  coupon: EngineCoupon;
  /** A code for this promotion was presented but binds an older revision. */
  couponStale: boolean;
  usageTotal: number;
  usageActor: number;
};

export type EngineRequest = {
  channel: "RETAIL" | "WHOLESALE";
  actor: EngineActor;
  lines: EngineLine[];
  shippingBase: bigint | null;
  candidates: EngineCandidate[];
  now: Date;
};

export type EngineApplied = {
  promotionId: string;
  promotionCode: string;
  revisionId: string;
  revisionNumber: number;
  couponId: string | null;
  benefitType: string;
  benefitScope: string;
  stackingPolicy: string;
  baseAmount: bigint;
  discountAmount: bigint;
  allocatedLines: Map<string, bigint>;
};

export type EngineRejected = {
  promotionId: string;
  revisionId: string | null;
  reason: string;
  detail?: Record<string, string>;
};

export type EngineResult = {
  baseSubtotal: bigint;
  totalQuantity: number;
  lineDiscounts: Map<string, bigint>;
  orderDiscount: bigint;
  shippingDiscount: bigint;
  totalDiscount: bigint;
  finalSubtotal: bigint;
  finalShipping: bigint | null;
  grandTotal: bigint;
  applied: EngineApplied[];
  rejected: EngineRejected[];
  termsHash: string;
};

const LINE_SCOPE_TYPES = new Set(["PRODUCT", "CATEGORY", "OFFER"]);

function lineMatchesTarget(line: EngineLine, target: EngineTarget): boolean {
  if (target.type === "PRODUCT") return line.productId === target.valueText;
  if (target.type === "CATEGORY") return line.categoryId !== null && line.categoryId === target.valueText;
  if (target.type === "OFFER") return line.offerId !== null && line.offerId === target.valueText;
  return false;
}

function checkCandidate(request: EngineRequest, candidate: EngineCandidate, subtotal: bigint, totalQuantity: number): EngineRejected | null {
  const reject = (reason: string, detail?: Record<string, string>): EngineRejected => ({
    promotionId: candidate.promotionId,
    revisionId: candidate.revisionId,
    reason,
    ...(detail ? { detail } : {}),
  });
  if (candidate.channel !== request.channel) return reject("CHANNEL_MISMATCH");
  if (candidate.status !== "ACTIVE") return reject("PROMOTION_NOT_ACTIVE");
  const nowMs = request.now.getTime();
  if (candidate.startsAt && candidate.startsAt.getTime() > nowMs) return reject("TERMS_WINDOW_INACTIVE");
  if (candidate.endsAt && candidate.endsAt.getTime() <= nowMs) return reject("TERMS_WINDOW_INACTIVE");
  if (candidate.couponRequired && !candidate.coupon) {
    return reject(candidate.couponStale ? "STALE_COUPON_REVISION" : "COUPON_REQUIRED_MISSING");
  }
  if (candidate.maxTotalUses !== null && candidate.usageTotal >= candidate.maxTotalUses) return reject("USAGE_LIMIT_EXHAUSTED");
  if (candidate.maxUsesPerActor !== null && candidate.usageActor >= candidate.maxUsesPerActor) return reject("ACTOR_USAGE_LIMIT_EXHAUSTED");
  for (const target of candidate.targets) {
    if (target.type === "MIN_SUBTOTAL" && target.valueAmount !== null && subtotal < target.valueAmount) {
      return reject("MIN_SUBTOTAL_NOT_MET");
    }
    if (target.type === "MIN_QUANTITY" && target.valueQuantity !== null && totalQuantity < target.valueQuantity) {
      return reject("MIN_QUANTITY_NOT_MET");
    }
    if (target.type === "VIP_PLAN" && (!request.actor.hasActiveVip || request.actor.vipPlanId !== target.valueText)) {
      return reject("VIP_PLAN_MISMATCH");
    }
    if (target.type === "VIP_ACCOUNT" && request.actor.accountId !== target.valueText) {
      return reject("VIP_ACCOUNT_MISMATCH");
    }
    if (target.type === "CUSTOMER_SEGMENT" && !request.actor.segments.includes(target.valueText ?? "")) {
      return reject("SEGMENT_MISMATCH");
    }
  }
  const lineTargets = candidate.targets.filter((target) => LINE_SCOPE_TYPES.has(target.type));
  if (lineTargets.length > 0) {
    const matched = request.lines.filter((line) => lineTargets.every((target) => lineMatchesTarget(line, target)));
    if (matched.length === 0) return reject("NO_MATCHING_LINES");
  }
  if (candidate.benefitType === "FREE_SHIPPING" && request.shippingBase === null) {
    return reject("SHIPPING_CONTEXT_MISSING");
  }
  return null;
}

function matchingLines(request: EngineRequest, candidate: EngineCandidate): EngineLine[] {
  const lineTargets = candidate.targets.filter((target) => LINE_SCOPE_TYPES.has(target.type));
  if (lineTargets.length === 0) return [...request.lines];
  return request.lines.filter((line) => lineTargets.every((target) => lineMatchesTarget(line, target)));
}

function assertEngineInput(request: EngineRequest): void {
  if (!Array.isArray(request.lines) || request.lines.length === 0) {
    throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "at least one line is required");
  }
  if (request.lines.length > 200) {
    throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "too many lines (max 200)");
  }
  const seen = new Set<string>();
  for (const line of request.lines) {
    if (typeof line.lineId !== "string" || line.lineId.length === 0 || line.lineId.length > 128) {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "lineId 1..128 chars is required");
    }
    if (seen.has(line.lineId)) throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `duplicate lineId ${line.lineId}`);
    seen.add(line.lineId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1_000_000_000) {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `line ${line.lineId} quantity out of range`);
    }
    assertBigintAmount(line.unitPrice, `line ${line.lineId} unitPrice`);
    assertBigintAmount(line.lineBase, `line ${line.lineId} lineBase`);
    if (line.lineBase !== line.unitPrice * BigInt(line.quantity)) {
      throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", `line ${line.lineId} base is inconsistent with unit price`);
    }
  }
  if (request.shippingBase !== null) assertBigintAmount(request.shippingBase, "shippingBase");
  if (!(request.now instanceof Date) || Number.isNaN(request.now.getTime())) {
    throw new PromotionDomainError("PROMOTION_EVALUATION_INVALID", "now must be a valid Date");
  }
}

/**
 * Deterministic commercial evaluation. Read-only by construction (no I/O
 * parameters exist). Stacking rule: eligible candidates sort by
 * (priority ASC, promotionId ASC); if any eligible candidate is EXCLUSIVE,
 * exactly the first one applies and every other is rejected with
 * EXCLUSIVE_CONFLICT — priority decides, never "biggest discount".
 * Otherwise all eligible STACKABLE candidates apply in order, each percent
 * computed on the remaining base.
 */
export function evaluatePromotionSet(request: EngineRequest): EngineResult {
  assertEngineInput(request);
  const baseSubtotal = request.lines.reduce((acc, line) => acc + line.lineBase, 0n);
  if (baseSubtotal > MAX_MONEY) throw new PromotionDomainError("PROMOTION_MONEY_OVERFLOW", "subtotal exceeds the maximum money value");
  const totalQuantity = request.lines.reduce((acc, line) => acc + line.quantity, 0);

  const eligible: EngineCandidate[] = [];
  const rejected: EngineRejected[] = [];
  const ordered = [...request.candidates].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0,
  );
  for (const candidate of ordered) {
    const verdict = checkCandidate(request, candidate, baseSubtotal, totalQuantity);
    if (verdict) rejected.push(verdict);
    else eligible.push(candidate);
  }

  const exclusives = eligible.filter((candidate) => candidate.stackingPolicy === "EXCLUSIVE");
  let toApply: EngineCandidate[];
  if (exclusives.length > 0) {
    const winner = exclusives[0];
    toApply = [winner];
    for (const candidate of eligible) {
      if (candidate.promotionId !== winner.promotionId || candidate.revisionId !== winner.revisionId) {
        rejected.push({ promotionId: candidate.promotionId, revisionId: candidate.revisionId, reason: "EXCLUSIVE_CONFLICT" });
      }
    }
  } else {
    toApply = eligible;
  }
  // Deterministic output order: applied in application order, rejected in candidate order.
  rejected.sort((a, b) => (a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0));

  const remaining = new Map<string, bigint>(request.lines.map((line) => [line.lineId, line.lineBase]));
  const lineDiscounts = new Map<string, bigint>(request.lines.map((line) => [line.lineId, 0n]));
  let orderDiscount = 0n;
  let shippingDiscount = 0n;
  const applied: EngineApplied[] = [];

  // `remaining` tracks what is left to discount on each line (shared by every
  // scope). Attribution is disjoint by design: LINE-scope promos accumulate
  // into `lineDiscounts`, ORDER-scope promos into their own `allocatedLines`
  // plus the `orderDiscount` memo — never both — so totals cannot double
  // count. `deduct` moves remaining without attributing; `consume` also
  // attributes to the line-scope bucket.
  const deduct = (lineId: string, discount: bigint): bigint => {
    const left = remaining.get(lineId) ?? 0n;
    const taken = clampDiscount(left, discount);
    remaining.set(lineId, left - taken);
    return taken;
  };
  const consume = (lineId: string, discount: bigint): void => {
    const taken = deduct(lineId, discount);
    lineDiscounts.set(lineId, (lineDiscounts.get(lineId) ?? 0n) + taken);
  };

  for (const candidate of toApply) {
    const lines = matchingLines(request, candidate);
    const allocated = new Map<string, bigint>();
    if (candidate.benefitType === "PERCENT_DISCOUNT" && candidate.percentBps !== null) {
      if (candidate.benefitScope === "LINE") {
        let promoDiscount = 0n;
        for (const line of lines) {
          const discount = percentDiscountOf(remaining.get(line.lineId) ?? 0n, candidate.percentBps);
          consume(line.lineId, discount);
          allocated.set(line.lineId, discount);
          promoDiscount += discount;
        }
        applied.push({ ...appliedOf(candidate), baseAmount: lines.reduce((acc, line) => acc + (remaining.get(line.lineId) ?? 0n) + (allocated.get(line.lineId) ?? 0n), 0n), discountAmount: promoDiscount, allocatedLines: allocated });
      } else {
        const base = lines.reduce((acc, line) => acc + (remaining.get(line.lineId) ?? 0n), 0n);
        const discount = percentDiscountOf(base, candidate.percentBps);
        const shares = allocateAcrossLines(discount, lines.map((line) => ({ lineId: line.lineId, base: remaining.get(line.lineId) ?? 0n })));
        for (const [lineId, share] of shares) {
          allocated.set(lineId, deduct(lineId, share));
        }
        orderDiscount += discount;
        applied.push({ ...appliedOf(candidate), baseAmount: base, discountAmount: discount, allocatedLines: allocated });
      }
    } else if (candidate.benefitType === "FIXED_AMOUNT_DISCOUNT" && candidate.amount !== null) {
      const base = lines.reduce((acc, line) => acc + (remaining.get(line.lineId) ?? 0n), 0n);
      const discount = clampDiscount(base, candidate.amount);
      const shares = allocateAcrossLines(discount, lines.map((line) => ({ lineId: line.lineId, base: remaining.get(line.lineId) ?? 0n })));
      for (const [lineId, share] of shares) {
        allocated.set(lineId, deduct(lineId, share));
      }
      orderDiscount += discount;
      applied.push({ ...appliedOf(candidate), baseAmount: base, discountAmount: discount, allocatedLines: allocated });
    } else if (candidate.benefitType === "FREE_SHIPPING") {
      const base = request.shippingBase ?? 0n;
      const discount = clampDiscount(base, base - shippingDiscount);
      shippingDiscount += discount;
      applied.push({ ...appliedOf(candidate), baseAmount: base, discountAmount: discount, allocatedLines: allocated });
    } else {
      throw new PromotionDomainError("PROMOTION_BENEFIT_INVALID", `candidate ${candidate.promotionId} has an incoherent benefit`);
    }
  }

  const lineTotal = [...lineDiscounts.values()].reduce((acc, value) => acc + value, 0n);
  const totalDiscount = lineTotal + orderDiscount + shippingDiscount;
  const finalSubtotal = baseSubtotal - lineTotal - orderDiscount;
  const finalShipping = request.shippingBase === null ? null : request.shippingBase - shippingDiscount;
  const grandTotal = finalSubtotal + (finalShipping ?? 0n);
  if (finalSubtotal < 0n || totalDiscount < 0n || (finalShipping !== null && finalShipping < 0n)) {
    throw new PromotionDomainError("PROMOTION_ARITHMETIC_INVALID", "evaluation produced a negative amount");
  }

  const termsHash = hashTerms({
    v: PROMOTION_EVALUATION_VERSION,
    channel: request.channel,
    baseSubtotal: baseSubtotal.toString(),
    shippingBase: request.shippingBase?.toString() ?? null,
    lines: request.lines.map((line) => ({ id: line.lineId, base: line.lineBase.toString() })),
    applied: applied.map((entry) => ({
      promotionId: entry.promotionId,
      revisionId: entry.revisionId,
      couponId: entry.couponId,
      benefitType: entry.benefitType,
      benefitScope: entry.benefitScope,
      baseAmount: entry.baseAmount.toString(),
      discountAmount: entry.discountAmount.toString(),
      allocatedLines: Object.fromEntries([...entry.allocatedLines.entries()].map(([key, value]) => [key, value.toString()])),
    })),
    totals: {
      orderDiscount: orderDiscount.toString(),
      shippingDiscount: shippingDiscount.toString(),
      totalDiscount: totalDiscount.toString(),
      finalSubtotal: finalSubtotal.toString(),
    },
  });

  return {
    baseSubtotal, totalQuantity, lineDiscounts, orderDiscount, shippingDiscount,
    totalDiscount, finalSubtotal, finalShipping, grandTotal, applied, rejected, termsHash,
  };
}

function appliedOf(candidate: EngineCandidate): Omit<EngineApplied, "baseAmount" | "discountAmount" | "allocatedLines"> {
  return {
    promotionId: candidate.promotionId,
    promotionCode: candidate.code,
    revisionId: candidate.revisionId,
    revisionNumber: candidate.revisionNumber,
    couponId: candidate.coupon?.couponId ?? null,
    benefitType: candidate.benefitType,
    benefitScope: candidate.benefitScope,
    stackingPolicy: candidate.stackingPolicy,
  };
}
