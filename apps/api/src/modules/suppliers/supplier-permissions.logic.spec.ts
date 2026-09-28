import { describe, it, expect } from "vitest";
import { checkSupplierPermission, assertSupplierMemberRoleAllowed } from "./supplier-permissions.logic";

describe("مجوزهای تأمین‌کننده — قابل تنظیم توسط ادمین", () => {
  const configs = [
    { action: "create_product" as const, requiresApproval: true },
    { action: "change_images" as const, requiresApproval: true },
    { action: "change_description" as const, requiresApproval: false },
    { action: "add_variant" as const, requiresApproval: true },
    { action: "change_category" as const, requiresApproval: true },
    { action: "change_price" as const, requiresApproval: false },
  ];

  it("create_product نیاز به تأیید دارد", () => {
    const result = checkSupplierPermission({ action: "create_product", supplierId: "sup_1" }, configs);
    expect(result.requiresApproval).toBe(true);
  });

  it("change_category نیاز به تأیید دارد", () => {
    const result = checkSupplierPermission({ action: "change_category", supplierId: "sup_1" }, configs);
    expect(result.requiresApproval).toBe(true);
  });

  it("change_price نیاز به تأیید ندارد (ممکن است)", () => {
    const result = checkSupplierPermission({ action: "change_price", supplierId: "sup_1" }, configs);
    expect(result.requiresApproval).toBe(false);
  });
});

describe("نقش‌های شرکت تأمین‌کننده", () => {
  it("owner همهٔ دسترسی‌ها", () => {
    expect(() => assertSupplierMemberRoleAllowed("owner", "create_product")).not.toThrow();
    expect(() => assertSupplierMemberRoleAllowed("owner", "change_price")).not.toThrow();
  });

  it("sales فقط قیمت و توضیح", () => {
    expect(() => assertSupplierMemberRoleAllowed("sales", "change_price")).not.toThrow();
    expect(() => assertSupplierMemberRoleAllowed("sales", "create_product")).toThrow();
  });

  it("warehouse فقط واریانت و تصویر", () => {
    expect(() => assertSupplierMemberRoleAllowed("warehouse", "add_variant")).not.toThrow();
    expect(() => assertSupplierMemberRoleAllowed("warehouse", "change_price")).toThrow();
  });

  it("finance فقط قیمت", () => {
    expect(() => assertSupplierMemberRoleAllowed("finance", "change_price")).not.toThrow();
    expect(() => assertSupplierMemberRoleAllowed("finance", "add_variant")).toThrow();
  });
});
