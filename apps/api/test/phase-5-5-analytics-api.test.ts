import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser, supplier, supplierMember } from "@kolbe/database";
import { makeId, bootHarness, type Harness } from "./helpers/phase-4-7-1.harness";

describe("Phase 5.5 — analytics API surface", () => {
  let harness: Harness;
  let adminId: string;
  let supplierUserId: string;
  let supplierId: string;
  let supplierToken: string;
  let adminToken: string;

  beforeAll(async () => {
    harness = await bootHarness("phase55_d_api_test");
    adminId = makeId("analytics_admin");
    supplierUserId = makeId("analytics_supplier_user");
    supplierId = makeId("analytics_supplier");
    await harness.db.insert(accountUser).values([
      { id: adminId, email: `${adminId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "admin" },
      { id: supplierUserId, email: `${supplierUserId}@kolbe.test`, passwordHash: "hash", salt: "salt", role: "supplier" },
    ]);
    await harness.db.insert(supplier).values({ id: supplierId, legalName: "API Supplier Legal", displayName: "API Supplier", status: "approved" });
    await harness.db.insert(supplierMember).values({ id: makeId("analytics_member"), supplierId, userId: supplierUserId, title: "Owner", role: "owner" });
    adminToken = harness.issueToken(adminId, "admin");
    supplierToken = harness.issueToken(supplierUserId, "supplier");
  }, 180_000);

  afterAll(async () => {
    await harness.close();
  });

  it("serves live admin analytics through the versioned API and preserves integer strings", async () => {
    await request(harness.app.getHttpServer()).get("/api/v1/admin/analytics/overview?preset=TODAY&timezone=UTC").expect(401);
    const response = await request(harness.app.getHttpServer())
      .get("/api/v1/admin/analytics/overview?preset=TODAY&timezone=UTC&metrics=retail.orders_count,retail.ordered_gmv")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body.scope).toBe("PLATFORM");
    expect(response.body.freshness.sourceMode).toBe("AUTHORITATIVE_LIVE");
    expect(response.body.metrics[0].value).toBe("0");
    expect(response.body.metrics[1].value).toBe("0");
  });

  it("derives supplier scope server-side and denies a cross-supplier query", async () => {
    const response = await request(harness.app.getHttpServer())
      .get("/api/v1/supplier/analytics/orders?preset=TODAY&timezone=UTC")
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(200);
    expect(response.body.scope).toBe("SUPPLIER");
    expect(response.body.scopeId).toBe(supplierId);

    await request(harness.app.getHttpServer())
      .get("/api/v1/supplier/analytics/orders?scope=SUPPLIER&scopeId=other_supplier&preset=TODAY")
      .set("Authorization", `Bearer ${supplierToken}`)
      .expect(403);
  });
});
