import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import {
  ADMIN_PERMISSION_KEY,
  AdminPermissionGuard,
} from "../src/modules/admin/admin-rbac.guard";

const ROOT = path.resolve(__dirname, "../../..");
const source = (relative: string) => fs.readFileSync(path.join(ROOT, "apps/api/src/modules", relative), "utf8");

describe("Phase 5.13 authorization and tenant-isolation adversarial guards", () => {
  it("denies an authenticated admin whose assigned roles lack the required permission", async () => {
    const reflector = new Reflector();
    const handler = () => undefined;
    Reflect.defineMetadata(ADMIN_PERMISSION_KEY, "retail:catalog:manage", handler);
    const rbac = { assertPermission: vi.fn().mockRejectedValue(new Error("ADMIN_PERMISSION_DENIED")) };
    const guard = new AdminPermissionGuard(reflector, rbac as any);
    const context = {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => ({ claims: { sub: "restricted_admin" } }) }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toThrow("ADMIN_PERMISSION_DENIED");
    expect(rbac.assertPermission).toHaveBeenCalledWith("restricted_admin", "retail:catalog:manage");
  });

  it("keeps every Phase 5.12 compat admin writer behind a cataloged permission", () => {
    const expectations: Array<[string, string]> = [
      ["analytics/operational-log.controller.ts", "analytics:report:manage"],
      ["cms/cms-compat.controller.ts", "cms:content:edit"],
      ["suppliers/suppliers.controller.ts", "wholesale:approval:decide"],
      ["vip/vip.controller.ts", "wholesale:membership:manage"],
      ["offers/offers.controller.ts", "wholesale:approval:create"],
      ["offers/offers.controller.ts", "retail:catalog:manage"],
      ["catalog/catalog.controller.ts", "retail:catalog:manage"],
    ];

    for (const [file, permission] of expectations) {
      const code = source(file);
      expect(code, `${file} must resolve AdminPermissionGuard`).toContain("AdminPermissionGuard");
      expect(code, `${file} must require ${permission}`).toContain(`@RequireAdminPermission("${permission}")`);
    }
  });

  it("closes the supplier-member IDOR and unauthorized supplier-creation surfaces", () => {
    const code = source("suppliers/suppliers.controller.ts");
    const create = code.slice(code.indexOf("  @Post()"), code.indexOf("  @Get(\":id/members\")"));
    const members = code.slice(code.indexOf("  @Get(\":id/members\")"));

    expect(create).toContain('@Roles("admin")');
    expect(create).toContain('@RequireAdminPermission("wholesale:membership:manage")');
    expect(members).toContain('@Roles("admin")');
    expect(members).toContain('@RequireAdminPermission("wholesale:membership:view")');
  });
});
