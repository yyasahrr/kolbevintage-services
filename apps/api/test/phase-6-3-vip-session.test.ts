/**
 * Phase 6.3-B — VIP membership is server-authoritative on the session.
 *
 * `GET /auth/me` must expose a normalized VIP context (none / pending / active)
 * derived from the canonical `wholesale_account` + `vip_subscription` tables,
 * with no commercial totals or admin/internal fields. The browser must not be
 * able to infer active VIP from cache; this suite pins the server contract.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountUser, vipPlan, vipSubscription, wholesaleAccount } from "@kolbe/database";
import { bootHarness, makeId, type Harness } from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_6_3_vip_session_test";

let h: Harness;
let ids: { customer: string; pending: string; active: string; catalogOnly: string };

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  const now = new Date();
  const yearOut = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  const planId = makeId("plan");
  await h.db.insert(vipPlan).values({
    id: planId, name: "VIP", slug: `vip-std-${planId}`, price: 0n, durationDays: 365,
    features: {}, limits: {}, status: "active",
  });

  const mkUser = async (prefix: string) => {
    const id = makeId(prefix);
    await h.db.insert(accountUser).values({
      id, email: `${prefix}-${id}@vip.test`, passwordHash: "x", salt: "y",
      role: "customer", displayName: prefix, status: "active",
    });
    return id;
  };

  const customer = await mkUser("cust");
  const pending = await mkUser("pend");
  const active = await mkUser("act");
  const catalogOnly = await mkUser("cat");

  await h.db.insert(wholesaleAccount).values({
    id: makeId("wsa_p"), userId: pending, memberName: "متقاضی", storeName: "فروشگاه متقاضی",
    phone: "09120000000", city: "تهران", planName: "وی‌آی‌پی", status: "pending",
  });
  await h.db.insert(wholesaleAccount).values({
    id: makeId("wsa_a"), userId: active, memberName: "کاربر VIP", storeName: "فروشگاه VIP",
    phone: "09120000000", city: "تهران", planName: "وی‌آی‌پی", status: "approved",
    activatedAt: now, expiresAt: yearOut,
  });
  // Approved account with NO active subscription → catalog-eligible but NOT RFQ-entitled.
  await h.db.insert(wholesaleAccount).values({
    id: makeId("wsa_c"), userId: catalogOnly, memberName: "عضو کاتالوگ", storeName: "فروشگاه کاتالوگ",
    phone: "09120000000", city: "تهران", planName: "وی‌آی‌پی", status: "approved",
    activatedAt: now, expiresAt: yearOut,
  });
  await h.db.insert(vipSubscription).values({
    id: makeId("sub_a"), userId: active, planId, status: "active", startedAt: now, expiresAt: yearOut,
  });

  ids = { customer, pending, active, catalogOnly };
});

afterAll(async () => {
  await h?.close();
});

const me = (userId?: string) => {
  const req = request(h.app.getHttpServer()).get("/api/v1/auth/me");
  if (userId) req.set("Cookie", `kolbe_session=${h.issueToken(userId, "customer")}`);
  return req;
};

describe("Phase 6.3-B — VIP membership context on /auth/me", () => {
  it("anonymous request is rejected (401) — no membership leaked", async () => {
    const res = await me();
    expect(res.status).toBe(401);
  });

  it("ordinary customer → vip.status 'none', no account", async () => {
    const res = await me(ids.customer);
    expect(res.status).toBe(200);
    expect(res.body.vip.status).toBe("none");
    expect(res.body.vip.accountId).toBeNull();
  });

  it("pending applicant → vip.status 'pending' with account id", async () => {
    const res = await me(ids.pending);
    expect(res.status).toBe(200);
    expect(res.body.vip.status).toBe("pending");
    expect(typeof res.body.vip.accountId).toBe("string");
  });

  it("active VIP → vip.status 'active' with expiry", async () => {
    const res = await me(ids.active);
    expect(res.status).toBe(200);
    expect(res.body.vip.status).toBe("active");
    expect(typeof res.body.vip.expiresAt).toBe("string");
  });

  it("exposes only the normalized allow-list (no commercial/admin fields)", async () => {
    const res = await me(ids.active);
    expect(Object.keys(res.body.vip).sort()).toEqual(
      ["accountId", "entitlements", "expiresAt", "memberName", "planName", "status", "storeName"],
    );
  });

  it("fully entitled VIP → catalog + rfq + orders", async () => {
    const res = await me(ids.active);
    expect(res.body.vip.status).toBe("active");
    expect(res.body.vip.entitlements).toEqual({ catalog: true, rfq: true, orders: true });
  });

  it("approved account WITHOUT subscription → catalog yes, RFQ NO (membership ≠ capability)", async () => {
    const res = await me(ids.catalogOnly);
    expect(res.body.vip.status).toBe("active"); // membership is active…
    expect(res.body.vip.entitlements.catalog).toBe(true);
    expect(res.body.vip.entitlements.rfq).toBe(false); // …but RFQ is not granted by membership alone
    expect(res.body.vip.entitlements.orders).toBe(true);
  });

  it("non-members get no entitlements", async () => {
    for (const id of [ids.customer, ids.pending]) {
      const res = await me(id);
      expect(res.body.vip.entitlements).toEqual({ catalog: false, rfq: false, orders: false });
    }
  });
});
