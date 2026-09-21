import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser, supplier, supplierMember, wholesaleAccount } from "@kolbe/database";
import { AnalyticsScopeService } from "../src/modules/analytics/analytics-scope.service";
import { makeId, bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.5 — analytics scope security", () => {
  let harness: Harness;
  let scopes: AnalyticsScopeService;
  let supplierUserId: string;
  let supplierId: string;
  let vipUserId: string;
  let vipAccountId: string;

  beforeAll(async () => {
    harness = await bootHarness("phase55_d_security_test", { httpPrefix: false });
    scopes = harness.app.get(AnalyticsScopeService);
    supplierUserId = makeId("supplier_user");
    supplierId = makeId("supplier");
    vipUserId = makeId("vip_user");
    vipAccountId = makeId("vip_account");
    await harness.db.insert(accountUser).values([
      { id: supplierUserId, email: `${supplierUserId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "supplier" },
      { id: vipUserId, email: `${vipUserId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "vip" },
    ]);
    await harness.db.insert(supplier).values({ id: supplierId, legalName: "Supplier Legal", displayName: "Supplier", status: "approved" });
    await harness.db.insert(supplierMember).values({ id: makeId("member"), supplierId, userId: supplierUserId, title: "Owner", role: "owner" });
    await harness.db.insert(wholesaleAccount).values({ id: vipAccountId, userId: vipUserId, memberName: "VIP", storeName: "VIP Store", phone: "09120000000", city: "Tehran", status: "approved" });
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it("derives supplier and VIP identifiers from server ownership", async () => {
    await expect(scopes.resolveSupplier(supplierUserId, "SUPPLIER", "another_supplier")).rejects.toThrow(/not owned/);
    await expect(scopes.resolveSupplier(supplierUserId, "PLATFORM", null)).rejects.toThrow(/only SUPPLIER/);
    await expect(scopes.resolveVip(vipUserId, "VIP_ACCOUNT", "another_account")).rejects.toThrow(/not owned/);
    await expect(scopes.resolveVip(vipUserId, "WHOLESALE", null)).rejects.toThrow(/only VIP_ACCOUNT/);

    await expect(scopes.resolveSupplier(supplierUserId, undefined, null)).resolves.toEqual({ scope: "SUPPLIER", scopeId: supplierId });
    await expect(scopes.resolveVip(vipUserId, undefined, null)).resolves.toEqual({ scope: "VIP_ACCOUNT", scopeId: vipAccountId });
  });

  it("allows only concrete admin tenant scopes that exist", async () => {
    await expect(scopes.resolveAdmin("SUPPLIER", supplierId)).resolves.toEqual({ scope: "SUPPLIER", scopeId: supplierId });
    await expect(scopes.resolveAdmin("VIP_ACCOUNT", vipAccountId)).resolves.toEqual({ scope: "VIP_ACCOUNT", scopeId: vipAccountId });
    await expect(scopes.resolveAdmin("SUPPLIER", "missing_supplier")).rejects.toThrow(/does not exist/);
    await expect(scopes.resolveAdmin("PLATFORM", "unexpected_id")).rejects.toThrow(/cannot carry scopeId/);
  });
});
