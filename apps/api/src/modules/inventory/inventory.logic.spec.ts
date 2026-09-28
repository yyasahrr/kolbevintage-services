import { describe, it, expect } from "vitest";
import {
  calculateAvailable,
  assertSupplierOwnsInventory,
  assertInventoryCanReserve,
  transitionReservation,
  isReservationExpired,
  createLedgerEntry,
  calculatePackageAvailability,
} from "./inventory.logic";

describe("موجودی — مالکیت تأمین‌کننده", () => {
  it("تأمین‌کننده فقط موجودی خودش را می‌بیند", () => {
    expect(() => assertSupplierOwnsInventory("seller_a", "seller_b", "supplier")).toThrow("فقط متعلق به تأمین‌کننده");
  });
  it("تأمین‌کننده می‌تواند موجودی خودش را ببیند", () => {
    expect(() => assertSupplierOwnsInventory("seller_a", "seller_a", "supplier")).not.toThrow();
  });
  it("ادمین می‌تواند همه را ببیند", () => {
    expect(() => assertSupplierOwnsInventory("seller_a", "seller_b", "admin")).not.toThrow();
  });
  it("کلبه مالک موجودی تأمین‌کننده نمی‌شود", () => {
    // Kolbe (KOLBE seller) should not be allowed to own supplier inventory? Actually Kolbe can have its own inventory
    // But supplier inventory ownership violation only for supplier role
    expect(() => assertSupplierOwnsInventory("seller_kolbe", "seller_supplier", "supplier")).toThrow();
  });
});

describe("موجودی در سطح واریانت", () => {
  it("محاسبهٔ در دسترس", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    expect(calculateAvailable(inv)).toBe(80);
  });
  it("رزرو بیشتر از در دسترس رد می‌شود", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 10, reserved: 5, status: "active" as const };
    expect(() => assertInventoryCanReserve(inv, 10)).toThrow("کافی نیست");
  });
  it("موجودی غیرفعال قابل رزرو نیست", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 0, status: "archived" as const };
    expect(() => assertInventoryCanReserve(inv, 1)).toThrow("فعال نیست");
  });
  it("رزرو معتبر", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    expect(() => assertInventoryCanReserve(inv, 10)).not.toThrow();
  });
});

describe("رزرو — چرخهٔ حیات", () => {
  it("pending → active با supplier", () => {
    expect(() => transitionReservation("pending", "active", "supplier")).not.toThrow();
  });
  it("pending → cancelled با vip", () => {
    expect(() => transitionReservation("pending", "cancelled", "vip")).not.toThrow();
  });
  it("active → confirmed با supplier", () => {
    expect(() => transitionReservation("active", "confirmed", "supplier")).not.toThrow();
  });
  it("active → released با vip", () => {
    expect(() => transitionReservation("active", "released", "vip")).not.toThrow();
  });
  it("active → expired فقط system", () => {
    expect(() => transitionReservation("active", "expired", "system")).not.toThrow();
    expect(() => transitionReservation("active", "expired", "supplier")).toThrow();
  });
  it("released دیگر قابل انتقال نیست", () => {
    expect(() => transitionReservation("released", "active", "admin")).toThrow();
  });
  it("انقضا تشخیص داده می‌شود", () => {
    const res = { id: "res_1", variantId: "var_1", sellerId: "seller_1", quantity: 10, status: "active" as const, expiresAt: new Date(Date.now() - 1000) };
    expect(isReservationExpired(res)).toBe(true);
    const res2 = { ...res, expiresAt: new Date(Date.now() + 10000) };
    expect(isReservationExpired(res2)).toBe(false);
  });
});

describe("دفتر کل موجودی", () => {
  it("INCREASE", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    const entry = createLedgerEntry(inv, "INCREASE", 50, "restock");
    expect(entry.afterOnHand).toBe(150);
    expect(entry.beforeOnHand).toBe(100);
  });
  it("DECREASE", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    const entry = createLedgerEntry(inv, "DECREASE", -10, "external sale");
    expect(entry.afterOnHand).toBe(90);
  });
  it("RESERVE", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    const entry = createLedgerEntry(inv, "RESERVE", 10, "reservation");
    expect(entry.afterReserved).toBe(30);
  });
  it("RELEASE", () => {
    const inv = { id: "inv_1", variantId: "var_1", sellerId: "seller_1", onHand: 100, reserved: 20, status: "active" as const };
    const entry = createLedgerEntry(inv, "RELEASE", -10, "release");
    expect(entry.afterReserved).toBe(10);
  });
});

describe("بستهٔ عمده — موجودی", () => {
  it("حداقل موجودی در بین واریانت‌ها", () => {
    const items = [
      { variantId: "var_s", requiredQty: 2, available: 10 },
      { variantId: "var_m", requiredQty: 2, available: 6 },
      { variantId: "var_l", requiredQty: 2, available: 4 },
    ];
    // S: 10/2=5, M:6/2=3, L:4/2=2 → min 2 packages
    expect(calculatePackageAvailability(items)).toBe(2);
  });
  it("اگر یک واریانت 0 باشد، کل بسته 0", () => {
    const items = [
      { variantId: "var_s", requiredQty: 2, available: 0 },
      { variantId: "var_m", requiredQty: 2, available: 10 },
    ];
    expect(calculatePackageAvailability(items)).toBe(0);
  });
});
