import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  assertPromotionTransition,
  assertRevisionTransition,
  evaluatePromotionTerms,
  hashPromotionTerms,
  normalizeBenefitInput,
  normalizeCouponCode,
  normalizeTargetInput,
  parseMoneyInput,
  percentOf,
  RejectionReasons,
  type EvaluationCandidate,
  type EvaluationInput,
  type EvaluationUsageSnapshot,
} from "./promotions.logic";
import { PromotionDomainError } from "./promotions.errors";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function emptyUsage(): EvaluationUsageSnapshot {
  return { revisionUses: new Map(), customerUses: new Map(), couponUses: new Map(), couponCustomerUses: new Map() };
}

function candidate(overrides: Partial<EvaluationCandidate> = {}): EvaluationCandidate {
  return {
    promotionId: "promo_1",
    promotionKey: "TEST.1",
    channel: "RETAIL",
    status: "ACTIVE",
    revisionId: "rev_1",
    revisionStatus: "PUBLISHED",
    stackingPolicy: "STACKABLE",
    priority: 100,
    couponRequired: false,
    startsAt: null,
    endsAt: null,
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
    termsHash: "t".repeat(64),
    targets: [],
    benefits: [{ id: "b1", benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1500, amount: null }],
    coupons: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    channel: "RETAIL",
    customerKey: "user:u1",
    vipPlanId: null,
    vipAccountId: null,
    vipActive: false,
    segments: [],
    lines: [
      { lineId: "l1", productId: "p1", categoryId: "c1", offerId: null, quantity: 2, unitPrice: 5000n, lineTotal: 10000n },
      { lineId: "l2", productId: "p2", categoryId: "c2", offerId: null, quantity: 1, unitPrice: 3000n, lineTotal: 3000n },
    ],
    shippingTotal: 500n,
    couponCodes: [],
    now: NOW,
    candidates: [candidate()],
    usage: emptyUsage(),
    ...overrides,
  };
}

describe("Phase 5.7 — promotion pure core", () => {
  it("computes percent discounts with integer basis points (no floats)", () => {
    expect(percentOf(10000n, 1500)).toBe(1500n);
    expect(percentOf(333n, 1000)).toBe(33n); // floor, never rounded up
    expect(percentOf(10000n, 10000)).toBe(10000n);
    expect(() => percentOf(10000n, 0)).toThrow(PromotionDomainError);
    expect(() => percentOf(10000n, 10001)).toThrow(PromotionDomainError);
    expect(() => percentOf(10000n, 12.5)).toThrow(PromotionDomainError);
  });

  it("rejects malformed, float, and overflowing money at the boundary", () => {
    expect(parseMoneyInput("1500", "f")).toBe(1500n);
    expect(parseMoneyInput(1500, "f")).toBe(1500n);
    expect(parseMoneyInput(1500n, "f")).toBe(1500n);
    expect(() => parseMoneyInput(15.5, "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput("15.5", "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput("1e6", "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput("0x10", "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput("-5", "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput("1000000000000001", "f")).toThrow(PromotionDomainError);
    expect(() => parseMoneyInput(Number.NaN, "f")).toThrow(PromotionDomainError);
  });

  it("apportions order discounts with exact largest-remainder sums", () => {
    // 100 across equal weights → 34/33/33 by line order (deterministic).
    expect(allocateProportionally(100n, [100n, 100n, 100n], ["a", "b", "c"])).toEqual([34n, 33n, 33n]);
    const parts = allocateProportionally(999n, [5000n, 3000n, 2000n], ["x", "y", "z"]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(999n);
    expect(allocateProportionally(0n, [5n], ["a"])).toEqual([0n]);
    expect(allocateProportionally(7n, [0n, 10n], ["a", "b"])).toEqual([0n, 7n]);
    expect(() => allocateProportionally(11n, [10n], ["a"])).toThrow(PromotionDomainError);
  });

  it("normalizes coupon codes and rejects invalid shapes", () => {
    expect(normalizeCouponCode("  kolbe-10 ")).toBe("KOLBE-10");
    expect(() => normalizeCouponCode("")).toThrow(PromotionDomainError);
    expect(() => normalizeCouponCode("A")).toThrow(PromotionDomainError);
    expect(() => normalizeCouponCode("DELETE FROM x")).toThrow(PromotionDomainError);
    expect(() => normalizeCouponCode("a".repeat(65))).toThrow(PromotionDomainError);
  });

  it("validates normalized targets and benefits (allowlist only)", () => {
    expect(normalizeTargetInput({ targetType: "PRODUCT", referenceId: "p1" }).referenceId).toBe("p1");
    expect(() => normalizeTargetInput({ targetType: "SQL", referenceId: "x" })).toThrow(PromotionDomainError);
    expect(() => normalizeTargetInput({ targetType: "PRODUCT", referenceId: "1; DELETE FROM promotion" })).toThrow(PromotionDomainError);
    expect(() => normalizeTargetInput({ targetType: "MIN_SUBTOTAL" })).toThrow(PromotionDomainError);
    expect(() => normalizeTargetInput({ targetType: "CHANNEL", referenceId: "SMS" })).toThrow(PromotionDomainError);
    expect(normalizeBenefitInput({ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1500 }).percentBps).toBe(1500);
    expect(() => normalizeBenefitInput({ benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "LINE", amount: 100 })).toThrow(PromotionDomainError);
    expect(() => normalizeBenefitInput({ benefitType: "FREE_SHIPPING", scope: "ORDER" })).toThrow(PromotionDomainError);
    expect(() => normalizeBenefitInput({ benefitType: "CASHBACK", scope: "ORDER" })).toThrow(PromotionDomainError);
  });

  it("enforces explicit lifecycle maps (no arbitrary status update)", () => {
    assertPromotionTransition("DRAFT", "ACTIVE");
    assertPromotionTransition("ACTIVE", "PAUSED");
    expect(() => assertPromotionTransition("ACTIVE", "DRAFT")).toThrow(PromotionDomainError);
    expect(() => assertPromotionTransition("ENDED", "ACTIVE")).toThrow(PromotionDomainError);
    expect(() => assertPromotionTransition("ARCHIVED", "DRAFT")).toThrow(PromotionDomainError);
    assertRevisionTransition("DRAFT", "PUBLISHED");
    expect(() => assertRevisionTransition("PUBLISHED", "DRAFT")).toThrow(PromotionDomainError);
    expect(() => assertRevisionTransition("SUPERSEDED", "PUBLISHED")).toThrow(PromotionDomainError);
  });

  it("hashes terms deterministically regardless of authoring order", () => {
    const a = hashPromotionTerms({
      stackingPolicy: "STACKABLE",
      priority: 100,
      couponRequired: false,
      startsAt: null,
      endsAt: null,
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      targets: [
        { targetType: "PRODUCT", referenceId: "p2", minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null },
        { targetType: "PRODUCT", referenceId: "p1", minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null },
      ],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1500, amount: null }],
    });
    const b = hashPromotionTerms({
      stackingPolicy: "STACKABLE",
      priority: 100,
      couponRequired: false,
      startsAt: null,
      endsAt: null,
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      targets: [
        { targetType: "PRODUCT", referenceId: "p1", minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null },
        { targetType: "PRODUCT", referenceId: "p2", minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null },
      ],
      benefits: [{ benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 1500, amount: null }],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evaluates a line percent deterministically with exact totals", () => {
    const first = evaluatePromotionTerms(baseInput());
    const second = evaluatePromotionTerms(baseInput());
    expect(first).toEqual(second);
    expect(first.baseSubtotal).toBe(13000n);
    expect(first.lineDiscounts).toEqual([
      { lineId: "l1", discount: 1500n },
      { lineId: "l2", discount: 450n },
    ]);
    expect(first.orderDiscount).toBe(1950n);
    expect(first.totalDiscount).toBe(1950n);
    expect(first.finalSubtotal).toBe(11050n);
    expect(first.appliedPromotions).toHaveLength(1);
    expect(first.appliedPromotions[0].discountAmount).toBe(1950n);
    expect(first.appliedPromotions[0].baseAmount).toBe(13500n);
    expect(first.appliedPromotions[0].finalAmount).toBe(11550n);
  });

  it("scopes PRODUCT targets to matching lines only", () => {
    const result = evaluatePromotionTerms(
      baseInput({
        candidates: [
          candidate({
            targets: [{ type: "PRODUCT", referenceId: "p2", minSubtotal: null, minQuantity: null, startsAt: null, endsAt: null }],
          }),
        ],
      }),
    );
    expect(result.lineDiscounts).toEqual([
      { lineId: "l1", discount: 0n },
      { lineId: "l2", discount: 450n },
    ]);
  });

  it("caps fixed order discounts at the eligible subtotal (never negative)", () => {
    const result = evaluatePromotionTerms(
      baseInput({
        candidates: [
          candidate({
            benefits: [{ id: "b1", benefitType: "FIXED_AMOUNT_DISCOUNT", scope: "ORDER", percentBps: null, amount: 999999n }],
          }),
        ],
      }),
    );
    expect(result.orderDiscount).toBe(13000n);
    expect(result.finalSubtotal).toBe(0n);
    expect(result.lineDiscounts.reduce((a, b) => a + b.discount, 0n)).toBe(13000n);
  });

  it("applies one exclusive winner alone and rejects the rest deterministically", () => {
    const stackable = candidate({ promotionId: "promo_a", promotionKey: "A", priority: 10 });
    const exclusiveLow = candidate({ promotionId: "promo_b", promotionKey: "B", priority: 50, stackingPolicy: "EXCLUSIVE" });
    const exclusiveHigh = candidate({ promotionId: "promo_c", promotionKey: "C", priority: 60, stackingPolicy: "EXCLUSIVE" });
    const result = evaluatePromotionTerms(baseInput({ candidates: [exclusiveHigh, stackable, exclusiveLow] }));
    expect(result.appliedPromotions.map((entry) => entry.promotionId)).toEqual(["promo_b"]);
    expect(result.rejectedPromotions).toHaveLength(2);
    expect(result.rejectedPromotions.every((entry) => entry.reason === RejectionReasons.EXCLUSIVE_CONFLICT)).toBe(true);
  });

  it("stacks independent promotions order-free with per-line caps", () => {
    const full = candidate({
      promotionId: "promo_full",
      promotionKey: "FULL",
      priority: 1,
      benefits: [{ id: "b1", benefitType: "PERCENT_DISCOUNT", scope: "LINE", percentBps: 10000, amount: null }],
    });
    const half = candidate({ promotionId: "promo_half", promotionKey: "HALF", priority: 2 });
    const forward = evaluatePromotionTerms(baseInput({ candidates: [full, half] }));
    const backward = evaluatePromotionTerms(baseInput({ candidates: [half, full] }));
    expect(forward.orderDiscount).toBe(13000n);
    // Attribution order follows (priority, id) regardless of input order.
    expect(forward.appliedPromotions.map((entry) => entry.promotionId)).toEqual(backward.appliedPromotions.map((entry) => entry.promotionId));
    expect(forward.appliedPromotions.reduce((a, b) => a + b.discountAmount, 0n)).toBe(forward.totalDiscount);
  });

  it("attributes free shipping once even when several promotions cover it", () => {
    const ship = (id: string): EvaluationCandidate =>
      candidate({
        promotionId: id,
        promotionKey: id,
        benefits: [{ id: `b-${id}`, benefitType: "FREE_SHIPPING", scope: "SHIPPING", percentBps: null, amount: null }],
        targets: [],
      });
    const result = evaluatePromotionTerms(baseInput({ candidates: [ship("promo_s1"), ship("promo_s2")] }));
    expect(result.shippingDiscount).toBe(500n);
    expect(result.finalShipping).toBe(0n);
    expect(result.appliedPromotions.reduce((a, b) => a + b.discountAmount, 0n)).toBe(result.totalDiscount);
    expect(result.appliedPromotions.filter((entry) => entry.discountAmount === 500n)).toHaveLength(1);
  });

  it("rejects channel mismatches, expired windows, and unmet minimums with reasons", () => {
    const mismatched = evaluatePromotionTerms(baseInput({ channel: "WHOLESALE" }));
    expect(mismatched.appliedPromotions).toHaveLength(0);
    expect(mismatched.rejectedPromotions[0].reason).toBe(RejectionReasons.CHANNEL_MISMATCH);

    const expired = evaluatePromotionTerms(
      baseInput({ candidates: [candidate({ startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-02-01T00:00:00Z") })] }),
    );
    expect(expired.rejectedPromotions[0].reason).toBe(RejectionReasons.WINDOW_EXPIRED);

    const minSubtotal = evaluatePromotionTerms(
      baseInput({
        candidates: [
          candidate({ targets: [{ type: "MIN_SUBTOTAL", referenceId: null, minSubtotal: 999999n, minQuantity: null, startsAt: null, endsAt: null }] }),
        ],
      }),
    );
    expect(minSubtotal.rejectedPromotions[0].reason).toBe(RejectionReasons.MIN_SUBTOTAL_UNMET);
  });

  it("gates coupon-required promotions on a valid presented code", () => {
    const gated = candidate({
      couponRequired: true,
      coupons: [
        { id: "cp1", codeNormalized: "SAVE10", status: "ENABLED", startsAt: null, endsAt: null, usageLimit: null, perCustomerLimit: null, revisionId: null },
      ],
    });
    const missing = evaluatePromotionTerms(baseInput({ candidates: [gated] }));
    expect(missing.rejectedPromotions[0].reason).toBe(RejectionReasons.COUPON_REQUIRED);
    const wrongPromo = evaluatePromotionTerms(baseInput({ candidates: [gated], couponCodes: ["OTHER"] }));
    expect(wrongPromo.rejectedPromotions[0].reason).toBe(RejectionReasons.COUPON_REQUIRED);
    const ok = evaluatePromotionTerms(baseInput({ candidates: [gated], couponCodes: ["SAVE10"] }));
    expect(ok.appliedPromotions[0].couponId).toBe("cp1");
    const disabled = evaluatePromotionTerms(
      baseInput({ candidates: [candidate({ couponRequired: true, coupons: [{ ...gated.coupons[0], status: "DISABLED" }] })], couponCodes: ["SAVE10"] }),
    );
    expect(disabled.rejectedPromotions[0].reason).toBe(RejectionReasons.COUPON_DISABLED);
  });

  it("rejects inconsistent line totals and duplicate lines", () => {
    expect(() =>
      evaluatePromotionTerms(
        baseInput({ lines: [{ lineId: "l1", productId: "p1", categoryId: null, offerId: null, quantity: 2, unitPrice: 5000n, lineTotal: 9999n }] }),
      ),
    ).toThrow(PromotionDomainError);
    expect(() =>
      evaluatePromotionTerms(
        baseInput({
          lines: [
            { lineId: "l1", productId: "p1", categoryId: null, offerId: null, quantity: 1, unitPrice: 5n, lineTotal: 5n },
            { lineId: "l1", productId: "p2", categoryId: null, offerId: null, quantity: 1, unitPrice: 5n, lineTotal: 5n },
          ],
        }),
      ),
    ).toThrow(PromotionDomainError);
  });
});
