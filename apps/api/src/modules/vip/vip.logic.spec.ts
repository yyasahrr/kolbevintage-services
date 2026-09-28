import { describe, it, expect } from "vitest";
import { isVipSubscriptionActive, assertVipAccess, validateWholesaleRequestQuantity, transitionWholesaleRequest } from "./vip.logic";

describe("VIP — اشتراک فعال", () => {
  it("اشتراک فعال تشخیص داده می‌شود", () => {
    const sub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_basic",
      status: "active" as const,
      expiresAt: new Date(Date.now() + 1000000),
    };
    expect(isVipSubscriptionActive(sub)).toBe(true);
  });

  it("اشتراک منقضی فعال نیست", () => {
    const sub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_basic",
      status: "active" as const,
      expiresAt: new Date(Date.now() - 1000000),
    };
    expect(isVipSubscriptionActive(sub)).toBe(false);
  });

  it("بدون اشتراک دسترسی عمده ندارد", () => {
    expect(() => assertVipAccess(null)).toThrow("اشتراک VIP لازم است");
  });

  it("اشتراک منقضی دسترسی ندارد", () => {
    const sub = {
      id: "sub_1",
      userId: "usr_1",
      planId: "plan_basic",
      status: "expired" as const,
      expiresAt: new Date(Date.now() - 1000),
    };
    expect(() => assertVipAccess(sub)).toThrow("منقضی");
  });
});

describe("درخواست عمده — کمیت", () => {
  it("کمتر از MOQ رد می‌شود", () => {
    expect(() => validateWholesaleRequestQuantity(1, 10, 100)).toThrow("کمتر از حداقل");
  });
  it("بیشتر از موجودی رد می‌شود", () => {
    expect(() => validateWholesaleRequestQuantity(200, 10, 100)).toThrow("موجودی کافی نیست");
  });
  it("معتبر", () => {
    expect(() => validateWholesaleRequestQuantity(10, 10, 100)).not.toThrow();
  });
});

describe("جریان درخواست عمده", () => {
  it("VIP → pending به supplier_review", () => {
    expect(() => transitionWholesaleRequest("pending", "supplier_review", "vip")).not.toThrow();
  });
  it("supplier می‌تواند accept کند", () => {
    expect(() => transitionWholesaleRequest("supplier_review", "accepted", "supplier")).not.toThrow();
  });
  it("رد بدون دلیل رد می‌شود", () => {
    expect(() => transitionWholesaleRequest("supplier_review", "rejected", "supplier")).toThrow("دلیل لازم است");
  });
  it("رد با دلیل قبول می‌شود", () => {
    expect(() => transitionWholesaleRequest("supplier_review", "rejected", "supplier", "موجودی نداریم")).not.toThrow();
  });
  it("VIP می‌تواند accepted را به ordered ببرد", () => {
    expect(() => transitionWholesaleRequest("accepted", "ordered", "vip")).not.toThrow();
  });
  it("انتقال نامعتبر رد می‌شود", () => {
    expect(() => transitionWholesaleRequest("pending", "accepted", "vip")).toThrow();
  });
});
