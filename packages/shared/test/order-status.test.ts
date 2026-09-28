import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  CHILD_ORDER_TRANSITIONS,
  childOrderTransitionRequirements,
  isTerminal,
  PAYMENT_TRANSITIONS,
  RETAIL_ORDER_TRANSITIONS,
  SETTLEMENT_TRANSITIONS,
  SHIPMENT_TRANSITIONS,
  STATE_MACHINES,
  TransitionError,
  WHOLESALE_ORDER_TRANSITIONS,
  WITHDRAWAL_TRANSITIONS,
} from "../src/order-status";

/**
 * قاعدهٔ A14: «Do not directly overwrite state-machine statuses.
 * All critical transitions must be validated server-side.»
 */
describe("ماشین‌های حالت", () => {
  it("گذار مجاز را می‌پذیرد", () => {
    expect(canTransition(CHILD_ORDER_TRANSITIONS, "pending", "confirmed")).toBe(true);
    expect(canTransition(RETAIL_ORDER_TRANSITIONS, "placed", "confirmed")).toBe(true);
    expect(canTransition(PAYMENT_TRANSITIONS, "authorized", "captured")).toBe(true);
  });

  it("گذار غیرمجاز را رد می‌کند", () => {
    expect(canTransition(CHILD_ORDER_TRANSITIONS, "pending", "delivered")).toBe(false);
    expect(canTransition(RETAIL_ORDER_TRANSITIONS, "placed", "shipped")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "refunded", "captured")).toBe(false);
    expect(() => assertTransition("child_order", CHILD_ORDER_TRANSITIONS, "delivered", "pending")).toThrowError(
      TransitionError,
    );
  });

  it("پرش از مراحل ممکن نیست — زنجیره باید گام‌به‌گام طی شود", () => {
    const chain = ["pending", "confirmed", "preparing", "shipped", "delivered"] as const;
    for (let i = 0; i < chain.length - 1; i += 1) {
      expect(canTransition(CHILD_ORDER_TRANSITIONS, chain[i], chain[i + 1])).toBe(true);
    }
    // هر پرش بیش از یک گام رد می‌شود.
    expect(canTransition(CHILD_ORDER_TRANSITIONS, "pending", "preparing")).toBe(false);
    expect(canTransition(CHILD_ORDER_TRANSITIONS, "confirmed", "shipped")).toBe(false);
  });

  it("وضعیت‌های پایانی هیچ گذاری ندارند", () => {
    expect(isTerminal(CHILD_ORDER_TRANSITIONS, "delivered")).toBe(true);
    expect(isTerminal(CHILD_ORDER_TRANSITIONS, "cancelled")).toBe(true);
    expect(isTerminal(RETAIL_ORDER_TRANSITIONS, "returned")).toBe(true);
    expect(isTerminal(CHILD_ORDER_TRANSITIONS, "preparing")).toBe(false);
    expect(isTerminal(WITHDRAWAL_TRANSITIONS, "paid")).toBe(true);
  });

  it("ارسال بدون کد رهگیری مجاز نیست", () => {
    expect(childOrderTransitionRequirements("shipped", { trackingCode: "" })).toContain(
      "TRACKING_CODE_REQUIRED",
    );
    expect(childOrderTransitionRequirements("shipped", { trackingCode: "IR123456789" })).toHaveLength(0);
    expect(childOrderTransitionRequirements("preparing", {})).toHaveLength(0);
  });

  it("همهٔ ماشین‌ها فقط به وضعیت‌های اعلام‌شده اشاره می‌کنند (سازگاری جدول گذار)", () => {
    for (const [name, table] of Object.entries(STATE_MACHINES)) {
      const statuses = new Set(Object.keys(table));
      for (const [from, targets] of Object.entries(table)) {
        expect(statuses.has(from), `${name}: وضعیت مبدأ ${from} در جدول نیست`).toBe(true);
        for (const to of targets as readonly string[]) {
          expect(statuses.has(to), `${name}: وضعیت مقصد ناشناخته ${to} از ${from}`).toBe(true);
        }
      }
    }
  });

  it("پول قابل بازگشت نیست پس از بازپرداخت کامل", () => {
    expect(canTransition(PAYMENT_TRANSITIONS, "refunded", "partially_refunded")).toBe(false);
    expect(canTransition(PAYMENT_TRANSITIONS, "partially_refunded", "refunded")).toBe(true);
  });

  it("محموله مسیرهای مستقل تحقق را پشتیبانی می‌کند", () => {
    expect(canTransition(SHIPMENT_TRANSITIONS, "pending", "label_created")).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, "in_transit", "delivered")).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, "delivered", "returned")).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, "delivered", "in_transit")).toBe(false);
  });

  it("تسویه و برداشت مسیر تأیید مالی دارند", () => {
    expect(canTransition(SETTLEMENT_TRANSITIONS, "pending_approval", "approved")).toBe(true);
    expect(canTransition(SETTLEMENT_TRANSITIONS, "paid", "draft")).toBe(false);
    expect(canTransition(WITHDRAWAL_TRANSITIONS, "requested", "processing")).toBe(false);
    expect(canTransition(WITHDRAWAL_TRANSITIONS, "approved", "processing")).toBe(true);
  });

  it("سفارش عمده پس از لغو یا تحقق بسته می‌شود", () => {
    expect(isTerminal(WHOLESALE_ORDER_TRANSITIONS, "fulfilled")).toBe(true);
    expect(isTerminal(WHOLESALE_ORDER_TRANSITIONS, "cancelled")).toBe(true);
  });
});
