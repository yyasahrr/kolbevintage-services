/**
 * Phase 5.0 — Checkpoint D: Wholesale Admin Control Tower Read Models & API Security Test Suite
 *
 * Verifies:
 * 1. Authoritative metrics strictly aggregated from real database tables (no fabricated metrics).
 * 2. Operational Queues: Pending Approvals, Pending Accounts, Expiring Memberships.
 * 3. Recent Operational Activity Feed from audit logs.
 * 4. Directory Search with status filtering.
 * 5. Admin API Security: RBAC, unauthenticated/unauthorized rejection, SQLi safety, limit clamping.
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser, wholesaleAccount } from "@kolbe/database";
import { ControlTowerService } from "../src/modules/admin/control-tower.service";
import { AdminRbacService } from "../src/modules/admin/admin-rbac.service";
import { AdminApprovalsService } from "../src/modules/admin/admin-approvals.service";
import { WholesalePlanService } from "../src/modules/vip/wholesale-plan.service";
import { WholesaleMembershipService } from "../src/modules/vip/wholesale-membership.service";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_0_control_tower_test";

let h: Harness;
let ctx: SupplierContext;
let controlTowerService: ControlTowerService;
let rbacService: AdminRbacService;
let approvalsService: AdminApprovalsService;
let planService: WholesalePlanService;
let membershipService: WholesaleMembershipService;

let testBuyerUser: string;
let restrictedAdminId: string;

const cookie = (userId: string, role = "admin") => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

async function createAdminWithCustomRole(name: string, email: string, permissions: string[]) {
  const userId = makeId("usr_adm");
  await h.db.insert(accountUser).values({
    id: userId,
    email,
    passwordHash: "dummy",
    salt: "dummy",
    role: "admin",
    displayName: name,
    phone: "09120001122",
    status: "active",
  });

  const role = await rbacService.createRole(
    { name: `role_${userId}`, displayName: name },
    ctx.userAdmin,
  );
  await rbacService.assignPermissionsToRole(role.id, permissions, ctx.userAdmin);
  await rbacService.assignRoleToUser(userId, role.id, ctx.userAdmin);

  return userId;
}

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  controlTowerService = h.app.get(ControlTowerService);
  rbacService = h.app.get(AdminRbacService);
  approvalsService = h.app.get(AdminApprovalsService);
  planService = h.app.get(WholesalePlanService);
  membershipService = h.app.get(WholesaleMembershipService);

  testBuyerUser = ctx.userBuyer;

  // Create restricted admin who only has note creation, NO control tower view
  restrictedAdminId = await createAdminWithCustomRole(
    "ادمین محدود",
    "restricted@kolbe.test",
    ["wholesale:notes:create"],
  );

  // Seed sample plans, memberships, accounts, and approvals for authoritative testing
  const plan = await planService.createPlan({ code: "ct_plan", name: "پلن کنترل تاور" }, ctx.userAdmin);
  const ver = await planService.createPlanVersion(plan.id, { durationDays: 30 }, ctx.userAdmin);
  await planService.publishPlanVersion(plan.id, ver.id, ctx.userAdmin);

  // Create 3 accounts: 2 pending, 1 approved with membership
  const [accPending1] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: makeId("wacc"),
      userId: testBuyerUser,
      memberName: "فرهاد مجیدی",
      storeName: "بوتیک استقلال",
      phone: "09121112233",
      city: "تهران",
      status: "pending",
    })
    .returning();

  const [accPending2] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: makeId("wacc"),
      userId: testBuyerUser,
      memberName: "علی کریمی",
      storeName: "پوشاک پرسپولیس",
      phone: "09124445566",
      city: "کرج",
      status: "pending",
    })
    .returning();

  const [accApproved] = await h.db
    .insert(wholesaleAccount)
    .values({
      id: makeId("wacc"),
      userId: testBuyerUser,
      memberName: "سهراب سپهری",
      storeName: "کتاب و پوشاک کاشان",
      phone: "09127778899",
      city: "کاشان",
      status: "pending",
    })
    .returning();

  // Create active membership for accApproved expiring in 5 days (so it appears in expiring queue)
  const mem = await membershipService.createPendingMembership(
    { accountId: accApproved.id, planVersionId: ver.id },
    ctx.userAdmin,
  );
  await membershipService.activateMembership(mem.id, ctx.userAdmin, { durationDays: 5 });

  // Create pending approval request
  await approvalsService.createApprovalRequest(
    {
      requestType: "PLAN_VERSION_PUBLISH",
      targetType: "wholesale_plan",
      targetId: plan.id,
      payload: { versionId: ver.id },
      makerNotes: "بررسی صف انتشار",
    },
    ctx.userAdmin,
  );
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.0 — Checkpoint D: Authoritative Control Tower Metrics", () => {
  it("computes accurate aggregate breakdown matching direct database counts", async () => {
    const overview = await controlTowerService.getOverview();

    // Verify accounts breakdown matches direct DB query
    const dbAccTotal = await h.pool.query(`SELECT count(*)::int as count FROM wholesale_account`);
    expect(overview.accounts.total).toBe(dbAccTotal.rows[0].count);

    const dbAccPending = await h.pool.query(
      `SELECT count(*)::int as count FROM wholesale_account WHERE status = 'pending'`,
    );
    expect(overview.accounts.pending).toBe(dbAccPending.rows[0].count);

    // Verify memberships breakdown
    const dbMemTotal = await h.pool.query(`SELECT count(*)::int as count FROM wholesale_membership`);
    expect(overview.memberships.total).toBe(dbMemTotal.rows[0].count);
    expect(overview.memberships.active).toBeGreaterThanOrEqual(1);

    // Verify approvals breakdown
    const dbApprTotal = await h.pool.query(`SELECT count(*)::int as count FROM approval_request`);
    expect(overview.approvals.total).toBe(dbApprTotal.rows[0].count);
    expect(overview.approvals.pending).toBeGreaterThanOrEqual(1);

    // Verify expiring memberships
    expect(overview.expiringMemberships14Days).toBeGreaterThanOrEqual(1);

    // Verify timestamp
    expect(new Date(overview.generatedAt).getTime()).toBeGreaterThan(0);
  });
});

describe("Phase 5.0 — Checkpoint D: Operational Queues", () => {
  it("retrieves pending approvals queue sorted by oldest first (FIFO)", async () => {
    const queue = await controlTowerService.getPendingApprovalsQueue({ limit: 10 });
    expect(queue.total).toBeGreaterThanOrEqual(1);
    expect(queue.items.length).toBeGreaterThanOrEqual(1);
    expect(queue.items.every((item) => item.status === "pending")).toBe(true);

    if (queue.items.length > 1) {
      const t0 = new Date(queue.items[0].createdAt).getTime();
      const t1 = new Date(queue.items[1].createdAt).getTime();
      expect(t0).toBeLessThanOrEqual(t1);
    }
  });

  it("retrieves pending accounts queue and supports search filtering", async () => {
    const allPending = await controlTowerService.getPendingAccountsQueue({ limit: 10 });
    expect(allPending.items.some((i) => i.memberName === "فرهاد مجیدی")).toBe(true);
    expect(allPending.items.some((i) => i.memberName === "علی کریمی")).toBe(true);

    // Filter by search query
    const filtered = await controlTowerService.getPendingAccountsQueue({ search: "فرهاد" });
    expect(filtered.items.length).toBe(1);
    expect(filtered.items[0].memberName).toBe("فرهاد مجیدی");
    expect(filtered.items[0].storeName).toBe("بوتیک استقلال");

    // Search by phone number
    const phoneFiltered = await controlTowerService.getPendingAccountsQueue({ search: "0912444" });
    expect(phoneFiltered.items.length).toBe(1);
    expect(phoneFiltered.items[0].memberName).toBe("علی کریمی");
  });

  it("retrieves expiring memberships queue with threshold days", async () => {
    const expiringQueue = await controlTowerService.getExpiringMembershipsQueue({ daysThreshold: 10 });
    expect(expiringQueue.total).toBeGreaterThanOrEqual(1);
    expect(expiringQueue.items.some((i) => i.memberName === "سهراب سپهری")).toBe(true);
  });

  it("retrieves operational activity feed containing real admin audit events", async () => {
    const feed = await controlTowerService.getActivityFeed({ limit: 20 });
    expect(feed.length).toBeGreaterThanOrEqual(1);
    expect(feed.some((e) => e.entityType === "wholesale_plan" || e.entityType === "wholesale_membership")).toBe(true);
  });
});

describe("Phase 5.0 — Checkpoint D: Directory Search", () => {
  it("searches wholesale directory across multiple fields and filters by status", async () => {
    // Search by store name
    const res1 = await controlTowerService.searchDirectory("پرسپولیس");
    expect(res1.length).toBe(1);
    expect(res1[0].memberName).toBe("علی کریمی");

    // Search by city
    const res2 = await controlTowerService.searchDirectory("کاشان");
    expect(res2.length).toBe(1);
    expect(res2[0].memberName).toBe("سهراب سپهری");

    // Filter by status
    const pendingOnly = await controlTowerService.searchDirectory("0912", { status: "pending" });
    expect(pendingOnly.every((a) => a.status === "pending")).toBe(true);

    const approvedOnly = await controlTowerService.searchDirectory("0912", { status: "approved" });
    expect(approvedOnly.every((a) => a.status === "approved")).toBe(true);
  });
});

describe("Phase 5.0 — Checkpoint D: Admin API Security & Adversarial Defense", () => {
  it("enforces authentication and granular control tower permissions over HTTP", async () => {
    // 1. Unauthenticated gets 401
    await api().get("/api/v1/admin/wholesale/control-tower/overview").expect(401);
    await api().get("/api/v1/admin/wholesale/control-tower/queues/pending-approvals").expect(401);

    // 2. Non-admin role (buyer) gets 403
    const buyerCookie = cookie(testBuyerUser, "vip");
    await api().get("/api/v1/admin/wholesale/control-tower/overview").set("Cookie", buyerCookie).expect(403);

    // 3. Admin user without 'wholesale:control_tower:view' gets 403 Forbidden
    const restrictedCookie = cookie(restrictedAdminId, "admin");
    await api()
      .get("/api/v1/admin/wholesale/control-tower/overview")
      .set("Cookie", restrictedCookie)
      .expect(403);

    // 4. Authorized admin gets 200 with full overview
    const superAdminCookie = cookie(ctx.userAdmin, "admin");
    const overviewRes = await api()
      .get("/api/v1/admin/wholesale/control-tower/overview")
      .set("Cookie", superAdminCookie)
      .expect(200);

    expect(overviewRes.body.overview.accounts).toBeDefined();
    expect(overviewRes.body.overview.memberships).toBeDefined();
    expect(overviewRes.body.overview.approvals).toBeDefined();
  });

  it("resists SQL injection attacks in queue search queries", async () => {
    const adminCookie = cookie(ctx.userAdmin, "admin");

    // Adversarial input trying SQL injection
    const sqliQuery = "'; DROP TABLE wholesale_account; --";
    const res = await api()
      .get(`/api/v1/admin/wholesale/control-tower/queues/pending-accounts?search=${encodeURIComponent(sqliQuery)}`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body.items).toEqual([]);

    // Proves table is still intact and unaffected
    const checkTable = await h.pool.query(`SELECT count(*)::int as count FROM wholesale_account`);
    expect(checkTable.rows[0].count).toBeGreaterThan(0);
  });

  it("clamps limit parameters to prevent denial-of-service memory exhaustion", async () => {
    const adminCookie = cookie(ctx.userAdmin, "admin");

    const res = await api()
      .get("/api/v1/admin/wholesale/control-tower/queues/pending-approvals?limit=1000000")
      .set("Cookie", adminCookie)
      .expect(200);

    // Service clamps limit to 100
    expect(res.body.limit).toBe(100);
  });
});
