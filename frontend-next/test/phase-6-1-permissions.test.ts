/**
 * تست‌های مدلِ دسترسی/قابلیت (فاز ۶.۱-F).
 *
 * سه قاعدهٔ سخت اینجا آزموده می‌شود:
 *  1. admin به‌معنای دسترسیِ نامحدود در فرانت‌اند نیست؛
 *  2. supplier به‌معنای manufacturer نیست؛
 *  3. خروجی فقط UX است (نمایش/فعال بودن)، نه جایگزینِ مجوزدهیِ سرور.
 */

import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_CAPABILITIES,
  canUseProduction,
  controlState,
  createCapabilitySet,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasRole,
  isActionable,
  permissionMatches,
  supplierHasCapability,
} from "../shared/permissions/capabilities";
import { isSessionRole, normalizeServerRole, SESSION_ROLES } from "../shared/session/roles";

describe("Phase 6.1-F permission and capability foundation", () => {
  it("knows the server role vocabulary and rejects silent fallbacks", () => {
    expect(SESSION_ROLES).toEqual(["customer", "vip", "supplier", "admin", "finance"]);
    expect(isSessionRole("admin")).toBe(true);
    expect(isSessionRole("owner")).toBe(false);
    expect(normalizeServerRole("owner")).toBe("unknown");
    expect(normalizeServerRole("supplier")).toBe("supplier");
  });

  it("grants nothing to an anonymous session", () => {
    expect(hasPermission(ANONYMOUS_CAPABILITIES, "anything")).toBe(false);
    expect(controlState(ANONYMOUS_CAPABILITIES, { permission: "crm:view" })).toBe("hidden");
  });

  it("does not treat the admin role as unrestricted frontend authority", () => {
    const admin = createCapabilitySet({ roles: ["admin"] });
    expect(hasRole(admin, "admin")).toBe(true);
    expect(hasPermission(admin, "crm:view")).toBe(false);
    expect(controlState(admin, { permission: "crm:view" })).toBe("hidden");
  });

  it("derives visibility from permissions, not from role names", () => {
    const operator = createCapabilitySet({ roles: ["finance"], permissions: ["crm:view", "crm:manage"] });
    expect(controlState(operator, { permission: "crm:manage" })).toBe("visible");
    expect(controlState(operator, { permission: "crm:delete" })).toBe("hidden");
    expect(controlState(operator, { permission: "crm:delete", hideWhenDenied: false })).toBe("disabled");
    expect(isActionable("disabled")).toBe(false);
    expect(isActionable("visible")).toBe(true);
  });

  it("supports group wildcards without prefix confusion", () => {
    const set = createCapabilitySet({ permissions: ["crm:*"] });
    expect(hasPermission(set, "crm:view")).toBe(true);
    expect(hasPermission(set, "crm")).toBe(false);
    expect(permissionMatches("crm:*", "crm:manage")).toBe(true);
    expect(permissionMatches("*", "anything")).toBe(true);
    expect(hasAllPermissions(set, ["crm:view", "crm:manage"])).toBe(true);
    expect(hasAnyPermission(set, ["orders:view", "crm:view"])).toBe(true);
    expect(hasAllPermissions(set, ["crm:view", "orders:view"])).toBe(false);
  });

  it("requires an explicit capability for production, never the supplier role alone", () => {
    const plainSupplier = createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1" });
    expect(canUseProduction(plainSupplier)).toBe(false);
    expect(supplierHasCapability(plainSupplier, "production")).toBe(false);

    const manufacturer = createCapabilitySet({ roles: ["supplier"], supplierId: "sup_1", supplierCapabilities: ["production"] });
    expect(canUseProduction(manufacturer)).toBe(true);
    expect(supplierHasCapability(manufacturer, "manufacturing")).toBe(false);
  });

  it("does not grant supplier capabilities without a server-confirmed supplier", () => {
    const orphan = createCapabilitySet({ supplierCapabilities: ["production"] });
    expect(supplierHasCapability(orphan, "production")).toBe(false);
    expect(canUseProduction(orphan)).toBe(false);
  });

  it("combines multiple requirements conjunctively", () => {
    const set = createCapabilitySet({ roles: ["admin"], permissions: ["orders:view"] });
    expect(controlState(set, { permission: "orders:view", role: "admin" })).toBe("visible");
    expect(controlState(set, { permission: "orders:manage", role: "admin" })).toBe("hidden");
    expect(controlState(set, { anyPermission: ["orders:view", "orders:manage"], allPermissions: ["orders:view"] })).toBe("visible");
  });

  it("defaults to visible only when the UI declares no requirement", () => {
    expect(controlState(ANONYMOUS_CAPABILITIES)).toBe("visible");
  });
});
