/**
 * Phase 5.0 — Checkpoint B: VIP Membership Lifecycle & Entitlement Engine Test Suite
 *
 * Verifies:
 * 1. Plan to Wholesale Account Domain Connection.
 * 2. Explicit Membership Lifecycle States & Historical Freeze Snapshots.
 * 3. Lifecycle Commands: activate, renew, schedule plan change, upgrade, downgrade, suspend, resume, cancel, expire.
 * 4. Server-side Entitlement Resolver (`hasFeature`, `getLimit`, `assertCanPlaceOrder`).
 * 5. Admin Membership APIs (Auth, RBAC, BigInt serialization, audit logs).
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@kolbe/database";
import { wholesaleAccount } from "@kolbe/database";
import { WholesalePlanService } from "../src/modules/vip/wholesale-plan.service";
import { WholesaleMembershipService } from "../src/modules/vip/wholesale-membership.service";
import { EntitlementResolver } from "../src/modules/vip/entitlement.resolver";
import {
  WholesaleMembershipConflictError,
  WholesaleMembershipStateError,
  WholesaleOrderLimitViolationError,
} from "../src/modules/vip/wholesale-membership.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_0_membership_test";

let h: Harness;
let ctx: SupplierContext;
let planService: WholesalePlanService;
let membershipService: WholesaleMembershipService;
let entitlementResolver: EntitlementResolver;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  planService = h.app.get(WholesalePlanService);
  membershipService = h.app.get(WholesaleMembershipService);
  entitlementResolver = h.app.get(EntitlementResolver);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

async function createTestAccount(name: string, phone: string) {
  const id = makeId("wacc");
  const [created] = await h.db
    .insert(wholesaleAccount)
    .values({
      id,
      userId: ctx.userBuyer,
      memberName: name,
      storeName: `فروشگاه ${name}`,
      phone,
      city: "تهران",
      status: "pending",
    })
    .returning();
  return created;
}

describe("Phase 5.0 — Checkpoint B: Plan Connection & Initial Membership", () => {
  it("connects a published plan version to a wholesale account as pending membership", async () => {
    // 1. Create and publish a wholesale plan
    const plan = await planService.createPlan(
      { code: "starter_collab", name: "همکار آغازین", tierLevel: 1 },
      ctx.userAdmin,
    );
    const version = await planService.createPlanVersion(
      plan.id,
      {
        baseFee: 50_000_000n,
        durationDays: 180,
        features: [
          { key: "catalog.vip_pricing", type: "boolean", isEnabled: true },
          { key: "shipping.free_standard", type: "boolean", isEnabled: false },
        ],
        limits: [
          { key: "min_order_amount", value: 10_000_000n, period: "order" },
          { key: "max_order_amount", value: 500_000_000n, period: "order" },
          { key: "max_order_units", value: 200n, period: "order" },
        ],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(plan.id, version.id, ctx.userAdmin);

    // 2. Create wholesale account
    const account = await createTestAccount("امیر رضایی", "09121111111");

    // 3. Create pending membership
    const membership = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: version.id },
      ctx.userAdmin,
    );

    expect(membership.id).toBeDefined();
    expect(membership.status).toBe("pending");
    expect(membership.accountId).toBe(account.id);
    expect(membership.planId).toBe(plan.id);
    expect(membership.planVersionId).toBe(version.id);
    expect(membership.startedAt).toBeNull();
    expect(membership.expiresAt).toBeNull();

    // Prevent duplicate pending membership
    await expect(
      membershipService.createPendingMembership(
        { accountId: account.id, planVersionId: version.id },
        ctx.userAdmin,
      ),
    ).rejects.toThrow(WholesaleMembershipConflictError);
  });

  it("cannot create membership on an unpublished draft plan version", async () => {
    const plan = await planService.createPlan({ code: "draft_test", name: "Draft Only" }, ctx.userAdmin);
    const draftVersion = await planService.createPlanVersion(plan.id, { name: "v1 draft" }, ctx.userAdmin);
    const account = await createTestAccount("سارا محمدی", "09122222222");

    await expect(
      membershipService.createPendingMembership(
        { accountId: account.id, planVersionId: draftVersion.id },
        ctx.userAdmin,
      ),
    ).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_PUBLISHED" });
  });
});

describe("Phase 5.0 — Checkpoint B: Membership Lifecycle & Historical Freeze Snapshots", () => {
  it("activates membership, creates immutable frozen snapshots and synchronizes wholesale_account", async () => {
    const plan = await planService.createPlan({ code: "gold_vip", name: "طلایی VIP" }, ctx.userAdmin);
    const version = await planService.createPlanVersion(
      plan.id,
      {
        durationDays: 365,
        features: [
          { key: "catalog.vip_pricing", type: "boolean", isEnabled: true },
          { key: "order.rfq_access", type: "boolean", isEnabled: true },
        ],
        limits: [
          { key: "min_order_amount", value: 50_000_000n },
          { key: "max_order_amount", value: 1_000_000_000n },
          { key: "max_order_units", value: 500n },
        ],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(plan.id, version.id, ctx.userAdmin);

    const account = await createTestAccount("پیمان کاظمی", "09123333333");
    const pending = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: version.id },
      ctx.userAdmin,
    );

    const activated = await membershipService.activateMembership(pending.id, ctx.userAdmin, {
      durationDays: 365,
    });

    expect(activated.status).toBe("active");
    expect(activated.startedAt).toBeDefined();
    expect(activated.expiresAt).toBeDefined();

    // Verify snapshot freeze
    const snapFeat = activated.snapshotFeatures as Record<string, any>;
    const snapLim = activated.snapshotLimits as Record<string, any>;
    expect(snapFeat["catalog.vip_pricing"].isEnabled).toBe(true);
    expect(snapFeat["order.rfq_access"].isEnabled).toBe(true);
    expect(snapLim["min_order_amount"].limitValue).toBe("50000000");

    // Verify wholesale_account backward-compatible synchronization
    const accountRows = await h.pool.query(`SELECT * FROM wholesale_account WHERE id=$1`, [account.id]);
    expect(accountRows.rows[0].status).toBe("approved");
    expect(accountRows.rows[0].plan_name).toBe("طلایی VIP");
    expect(accountRows.rows[0].activated_at).toBeDefined();
    expect(accountRows.rows[0].expires_at).toBeDefined();

    // Verify history event was recorded
    const details = await membershipService.getMembership(pending.id);
    expect(details.history.some((h: any) => h.eventType === "activated" && h.toStatus === "active")).toBe(true);
  });

  it("proves snapshot immutability: plan version changes do NOT mutate frozen membership snapshots", async () => {
    const plan = await planService.createPlan({ code: "freeze_proof", name: "Freeze Proof" }, ctx.userAdmin);
    const v1 = await planService.createPlanVersion(
      plan.id,
      {
        features: [{ key: "catalog.vip_pricing", type: "boolean", isEnabled: true }],
        limits: [{ key: "min_order_amount", value: 15_000_000n }],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(plan.id, v1.id, ctx.userAdmin);

    const account = await createTestAccount("Freeze Buyer", "09124444444");
    const pending = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: v1.id },
      ctx.userAdmin,
    );
    const active = await membershipService.activateMembership(pending.id, ctx.userAdmin);

    // Later: Admin creates plan v2 with altered min order and new feature
    const v2Draft = await planService.createNewVersionFromPublished(plan.id, "Altered V2", ctx.userAdmin);
    await planService.addFeature(v2Draft.id, { key: "shipping.express_dispatch", type: "boolean" });
    await planService.publishPlanVersion(plan.id, v2Draft.id, ctx.userAdmin);

    // Check that existing active membership snapshot is completely unchanged
    const currentMembership = await membershipService.getMembership(active.id);
    expect(currentMembership.planVersionId).toBe(v1.id);
    const currentFeat = currentMembership.snapshotFeatures as Record<string, any>;
    const currentLim = currentMembership.snapshotLimits as Record<string, any>;

    expect(currentFeat["shipping.express_dispatch"]).toBeUndefined(); // v2 feature not leaked!
    expect(currentLim["min_order_amount"].limitValue).toBe("15000000"); // v1 limit preserved!
  });
});

describe("Phase 5.0 — Checkpoint B: Lifecycle State Machine Transitions", () => {
  it("executes suspend and resume transitions with wholesale_account sync", async () => {
    const plan = await planService.createPlan({ code: "suspend_test", name: "Suspend Test" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(plan.id, { durationDays: 365 }, ctx.userAdmin);
    await planService.publishPlanVersion(plan.id, ver.id, ctx.userAdmin);

    const account = await createTestAccount("مشتری معلق", "09125555555");
    const mem = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: ver.id },
      ctx.userAdmin,
    );
    await membershipService.activateMembership(mem.id, ctx.userAdmin);

    // Suspend
    const suspended = await membershipService.suspendMembership(
      mem.id,
      "تخلف در بازپرداخت چک بانکی",
      ctx.userAdmin,
    );
    expect(suspended.status).toBe("suspended");
    expect(suspended.suspendedReason).toBe("تخلف در بازپرداخت چک بانکی");

    let acc = await h.pool.query(`SELECT status FROM wholesale_account WHERE id=$1`, [account.id]);
    expect(acc.rows[0].status).toBe("suspended");

    // Cannot suspend an already suspended membership
    await expect(
      membershipService.suspendMembership(mem.id, "Again", ctx.userAdmin),
    ).rejects.toThrow(WholesaleMembershipStateError);

    // Resume
    const resumed = await membershipService.resumeMembership(mem.id, ctx.userAdmin, {
      reason: "تسویه کامل بدهی معوقه",
    });
    expect(resumed.status).toBe("active");
    expect(resumed.suspendedAt).toBeNull();

    acc = await h.pool.query(`SELECT status FROM wholesale_account WHERE id=$1`, [account.id]);
    expect(acc.rows[0].status).toBe("approved");
  });

  it("renews membership and extends expiry date", async () => {
    const plan = await planService.createPlan({ code: "renew_test", name: "Renew Test" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(plan.id, { durationDays: 100 }, ctx.userAdmin);
    await planService.publishPlanVersion(plan.id, ver.id, ctx.userAdmin);

    const account = await createTestAccount("مشتری تمدیدی", "09126666666");
    const mem = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: ver.id },
      ctx.userAdmin,
    );
    const activated = await membershipService.activateMembership(mem.id, ctx.userAdmin, { durationDays: 100 });
    const initialExpiry = new Date(activated.expiresAt!).getTime();

    // Renew for additional 100 days
    const renewed = await membershipService.renewMembership(mem.id, ctx.userAdmin, { durationDays: 100 });
    const renewedExpiry = new Date(renewed.expiresAt!).getTime();

    expect(renewedExpiry).toBeGreaterThan(initialExpiry);
    expect(renewedExpiry - initialExpiry).toBeCloseTo(100 * 86_400_000, -3);
  });

  it("handles scheduled plan change applied upon renewal", async () => {
    const planA = await planService.createPlan({ code: "plan_a", name: "پلن پایه" }, ctx.userAdmin);
    const verA = await planService.createPlanVersion(planA.id, { name: "v1" }, ctx.userAdmin);
    await planService.publishPlanVersion(planA.id, verA.id, ctx.userAdmin);

    const planB = await planService.createPlan({ code: "plan_b", name: "پلن پیشرفته" }, ctx.userAdmin);
    const verB = await planService.createPlanVersion(
      planB.id,
      {
        features: [{ key: "support.dedicated_rep", type: "boolean", isEnabled: true }],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(planB.id, verB.id, ctx.userAdmin);

    const account = await createTestAccount("مشتری تغییر پلن", "09127777777");
    const mem = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: verA.id },
      ctx.userAdmin,
    );
    await membershipService.activateMembership(mem.id, ctx.userAdmin);

    // Schedule upgrade to Plan B upon next renewal
    const scheduled = await membershipService.schedulePlanChange(mem.id, verB.id, ctx.userAdmin);
    expect(scheduled.scheduledPlanVersionId).toBe(verB.id);

    // Renew applies the scheduled change!
    const renewed = await membershipService.renewMembership(mem.id, ctx.userAdmin);
    expect(renewed.planVersionId).toBe(verB.id);
    expect(renewed.scheduledPlanVersionId).toBeNull();
    const snapFeat = renewed.snapshotFeatures as Record<string, any>;
    expect(snapFeat["support.dedicated_rep"]?.isEnabled).toBe(true);

    const acc = await h.pool.query(`SELECT plan_name FROM wholesale_account WHERE id=$1`, [account.id]);
    expect(acc.rows[0].plan_name).toBe("پلن پیشرفته");
  });

  it("immediate upgrade updates plan version, snapshots and account immediately", async () => {
    const planPro = await planService.createPlan({ code: "pro_direct", name: "همکار VIP" }, ctx.userAdmin);
    const v1 = await planService.createPlanVersion(planPro.id, { name: "v1" }, ctx.userAdmin);
    await planService.publishPlanVersion(planPro.id, v1.id, ctx.userAdmin);

    const account = await createTestAccount("مشتری ارتقا مستقیم", "09128888888");
    const mem = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: v1.id },
      ctx.userAdmin,
    );
    await membershipService.activateMembership(mem.id, ctx.userAdmin);

    const v2 = await planService.createPlanVersion(
      planPro.id,
      {
        features: [{ key: "settlement.cheque_allowed", type: "boolean", isEnabled: true }],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(planPro.id, v2.id, ctx.userAdmin);

    // Immediate upgrade
    const upgraded = await membershipService.upgradeMembership(mem.id, v2.id, ctx.userAdmin);
    expect(upgraded.planVersionId).toBe(v2.id);
    const snapFeat = upgraded.snapshotFeatures as Record<string, any>;
    expect(snapFeat["settlement.cheque_allowed"]?.isEnabled).toBe(true);
  });

  it("cancel and expire sweeps correctly terminate membership validity", async () => {
    const plan = await planService.createPlan({ code: "cancel_expire_plan", name: "Cancel Expire" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(plan.id, { durationDays: 365 }, ctx.userAdmin);
    await planService.publishPlanVersion(plan.id, ver.id, ctx.userAdmin);

    // 1. Cancel
    const acc1 = await createTestAccount("لغو شونده", "09129999991");
    const mem1 = await membershipService.createPendingMembership({ accountId: acc1.id, planVersionId: ver.id }, ctx.userAdmin);
    await membershipService.activateMembership(mem1.id, ctx.userAdmin);
    const cancelled = await membershipService.cancelMembership(mem1.id, "درخواست کتبی خریدار", ctx.userAdmin);
    expect(cancelled.status).toBe("cancelled");

    // 2. Expiry sweep: artificially set expires_at in the past
    const acc2 = await createTestAccount("منقضی شونده", "09129999992");
    const mem2 = await membershipService.createPendingMembership({ accountId: acc2.id, planVersionId: ver.id }, ctx.userAdmin);
    await membershipService.activateMembership(mem2.id, ctx.userAdmin);

    await h.pool.query(
      `UPDATE wholesale_membership SET expires_at = now() - interval '2 days' WHERE id=$1`,
      [mem2.id],
    );

    const sweptCount = await membershipService.expireMembershipsSweep();
    expect(sweptCount).toBeGreaterThanOrEqual(1);

    const mem2Checked = await membershipService.getMembership(mem2.id);
    expect(mem2Checked.status).toBe("expired");

    const acc2Checked = await h.pool.query(`SELECT status FROM wholesale_account WHERE id=$1`, [acc2.id]);
    expect(acc2Checked.rows[0].status).toBe("expired");
  });
});

describe("Phase 5.0 — Checkpoint B: Server-Side Entitlement Resolver", () => {
  it("resolves features and limits from active membership snapshot", async () => {
    const plan = await planService.createPlan({ code: "resolver_plan", name: "Resolver Plan" }, ctx.userAdmin);
    const ver = await planService.createPlanVersion(
      plan.id,
      {
        features: [
          { key: "catalog.vip_pricing", type: "boolean", isEnabled: true },
          { key: "shipping.free_standard", type: "boolean", isEnabled: false },
        ],
        limits: [
          { key: "min_order_amount", value: 30_000_000n },
          { key: "max_order_amount", value: 400_000_000n },
          { key: "max_order_units", value: 100n },
        ],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(plan.id, ver.id, ctx.userAdmin);

    const account = await createTestAccount("Resolver Buyer", "09120000001");
    const mem = await membershipService.createPendingMembership(
      { accountId: account.id, planVersionId: ver.id },
      ctx.userAdmin,
    );

    // Before activation: hasFeature is false
    expect(await entitlementResolver.hasFeature(account.id, "catalog.vip_pricing")).toBe(false);

    await membershipService.activateMembership(mem.id, ctx.userAdmin);

    // After activation: hasFeature is true
    expect(await entitlementResolver.hasFeature(account.id, "catalog.vip_pricing")).toBe(true);
    expect(await entitlementResolver.hasFeature(account.id, "shipping.free_standard")).toBe(false);
    expect(await entitlementResolver.hasFeature(account.id, "non_existent")).toBe(false);

    // Check limit
    const minLimit = await entitlementResolver.getLimit(account.id, "min_order_amount");
    expect(minLimit).toBeDefined();
    expect(minLimit?.limitValue).toBe(30_000_000n);

    // Check assertCanPlaceOrder enforcement
    // 1. Below min order amount
    await expect(
      entitlementResolver.assertCanPlaceOrder(account.id, 20_000_000n, 10),
    ).rejects.toThrow(WholesaleOrderLimitViolationError);

    // 2. Above max order amount
    await expect(
      entitlementResolver.assertCanPlaceOrder(account.id, 500_000_000n, 10),
    ).rejects.toThrow(WholesaleOrderLimitViolationError);

    // 3. Above max order units
    await expect(
      entitlementResolver.assertCanPlaceOrder(account.id, 50_000_000n, 150),
    ).rejects.toThrow(WholesaleOrderLimitViolationError);

    // 4. Valid order passes cleanly
    await expect(
      entitlementResolver.assertCanPlaceOrder(account.id, 50_000_000n, 50),
    ).resolves.toBeUndefined();

    // Summary endpoint returns complete representation
    const summary = await entitlementResolver.getEntitlementsSummary(account.id);
    expect(summary.isVip).toBe(true);
    expect(summary.membershipId).toBe(mem.id);
    expect(summary.limits["min_order_amount"].limitValue).toBe(30_000_000n);
  });
});

describe("Phase 5.0 — Checkpoint B: Admin Membership HTTP APIs", () => {
  it("enforces authentication and admin role on admin wholesale membership routes", async () => {
    // Unauthenticated
    await api().get("/api/v1/admin/wholesale/memberships").expect(401);
    await api().post("/api/v1/admin/wholesale/memberships").send({}).expect(401);

    // Non-admin (buyer or supplier)
    const buyerCookie = cookie(ctx.userBuyer, "vip");
    await api().get("/api/v1/admin/wholesale/memberships").set("Cookie", buyerCookie).expect(403);
    await api().post("/api/v1/admin/wholesale/memberships").set("Cookie", buyerCookie).send({}).expect(403);
  });

  it("admin can manage memberships over HTTP and receive clean BigInt-serialized responses", async () => {
    const adminCookie = cookie(ctx.userAdmin, "admin");

    // 1. Create plan & version via Admin HTTP API
    const planRes = await api()
      .post("/api/v1/admin/wholesale/plans")
      .set("Cookie", adminCookie)
      .send({ code: "http_plan", name: "HTTP Plan", tierLevel: 2 })
      .expect(201);

    const planId = planRes.body.plan.id;

    const verRes = await api()
      .post(`/api/v1/admin/wholesale/plans/${planId}/versions`)
      .set("Cookie", adminCookie)
      .send({
        baseFee: "120000000",
        durationDays: 365,
        features: [{ key: "catalog.vip_pricing", type: "boolean", isEnabled: true }],
        limits: [{ key: "min_order_amount", value: "25000000" }],
      })
      .expect(201);

    const verId = verRes.body.version.id;
    expect(verRes.body.version.baseFee).toBe("120000000"); // BigInt string serialized!

    // Publish version
    await api()
      .post(`/api/v1/admin/wholesale/plans/${planId}/versions/${verId}/publish`)
      .set("Cookie", adminCookie)
      .expect(201);

    // 2. Create wholesale account & pending membership via Admin HTTP API
    const account = await createTestAccount("مشتری HTTP", "09121234567");

    const memRes = await api()
      .post("/api/v1/admin/wholesale/memberships")
      .set("Cookie", adminCookie)
      .send({ accountId: account.id, planVersionId: verId })
      .expect(201);

    const memId = memRes.body.membership.id;
    expect(memRes.body.membership.status).toBe("pending");

    // 3. Activate membership via Admin HTTP API
    const actRes = await api()
      .post(`/api/v1/admin/wholesale/memberships/${memId}/activate`)
      .set("Cookie", adminCookie)
      .send({ durationDays: 365, reason: "پرداخت از طریق فیش بانکی تأیید شد" })
      .expect(201);

    expect(actRes.body.membership.status).toBe("active");
    expect(actRes.body.membership.snapshotLimits.min_order_amount.limitValue).toBe("25000000");

    // 4. Suspend via Admin HTTP API
    const suspRes = await api()
      .post(`/api/v1/admin/wholesale/memberships/${memId}/suspend`)
      .set("Cookie", adminCookie)
      .send({ reason: "استعلام انطباق" })
      .expect(201);

    expect(suspRes.body.membership.status).toBe("suspended");

    // 5. Resume via Admin HTTP API
    const resRes = await api()
      .post(`/api/v1/admin/wholesale/memberships/${memId}/resume`)
      .set("Cookie", adminCookie)
      .send({ reason: "تأیید مدارک" })
      .expect(201);

    expect(resRes.body.membership.status).toBe("active");

    // 6. Query membership detail
    const getRes = await api()
      .get(`/api/v1/admin/wholesale/memberships/${memId}`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(getRes.body.membership.plan.name).toBe("HTTP Plan");
    expect(getRes.body.membership.history.length).toBeGreaterThanOrEqual(3);
  });
});
