import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, call, cleanupUser, dbQuery, ensureInitialized, login, unique } from "./helpers";

/**
 * Regression suite for audit finding D2: VIP membership used to self-approve
 * instantly and elevate the account role. Access must only open through the
 * admin approval endpoint.
 */
const email = `${unique("vip-test")}@example.test`;
const password = "VipTest123!";

beforeAll(ensureInitialized);
afterAll(async () => cleanupUser(email));

describe("VIP membership approval workflow", () => {
  let customerToken = "";
  let adminToken = "";
  let accountId = "";

  it("new applications are recorded as pending — no instant activation", async () => {
    await call("POST", "auth/register", { body: { email, password, name: "تست VIP", phone: "09120000002" } });
    customerToken = await login(email, password);

    const r = await call("POST", "wholesale/apply", {
      token: customerToken,
      body: { storeName: "بوتیک تست", phone: "09120000002", city: "تهران", planName: "وی‌آی‌پی", paymentReference: "VIP-TEST-1" },
    });
    expect(r.status).toBe(201);
    expect(r.data.status).toBe("pending");
    accountId = r.data.account.id;

    const [account] = await dbQuery<any>("SELECT * FROM wholesale_account WHERE id=$1", [accountId]);
    expect(account.status).toBe("pending");
    expect(account.activated_at).toBeNull();
    const [user] = await dbQuery<any>("SELECT role FROM account_user WHERE email=$1", [email]);
    expect(user.role).toBe("customer"); // no self-elevation
  });

  it("unapproved members cannot browse the wholesale order surface", async () => {
    const orders = await call("GET", "wholesale/orders", { token: customerToken });
    expect(orders.status).toBe(403);
    expect(orders.data.error).toBe("VIP_ACCOUNT_INACTIVE");
  });

  it("re-applying while pending updates details but stays pending (single row)", async () => {
    const r = await call("POST", "wholesale/apply", {
      token: customerToken,
      body: { storeName: "بوتیک تست ۲", phone: "09120000002", city: "اصفهان", planName: "حرفه‌ای", paymentReference: "VIP-TEST-2" },
    });
    expect(r.data.status).toBe("pending");
    expect(r.data.account.store_name).toBe("بوتیک تست ۲");
    const rows = await dbQuery("SELECT id FROM wholesale_account WHERE user_id=$1", [
      (await dbQuery<any>("SELECT id FROM account_user WHERE email=$1", [email]))[0].id,
    ]);
    expect(rows.length).toBe(1);
  });

  it("rejecting non-allowlisted account statuses", async () => {
    adminToken = await login(ADMIN.email, ADMIN.password);
    const r = await call("POST", `admin/accounts/${accountId}/status`, {
      token: adminToken,
      body: { status: "superuser" },
    });
    expect(r.status).toBe(422);
    expect(r.data.error).toBe("INVALID_STATUS");
  });

  it("admin approval activates access and sets a default 365-day expiry", async () => {
    const approve = await call("POST", `admin/accounts/${accountId}/status`, {
      token: adminToken,
      body: { status: "approved" },
    });
    expect(approve.status).toBe(200);

    const [account] = await dbQuery<any>("SELECT * FROM wholesale_account WHERE id=$1", [accountId]);
    expect(account.status).toBe("approved");
    expect(account.activated_at).not.toBeNull();
    expect(new Date(account.expires_at).getTime()).toBeGreaterThan(Date.now() + 364 * 86400_000);

    const [user] = await dbQuery<any>("SELECT role FROM account_user WHERE email=$1", [email]);
    expect(user.role).toBe("vip");
  });

  it("approved members can use the wholesale API; re-apply is a no-op echo", async () => {
    const orders = await call("GET", "wholesale/orders", { token: customerToken });
    expect(orders.status).toBe(200);

    const again = await call("POST", "wholesale/apply", {
      token: customerToken,
      body: { storeName: "بوتیک تست ۲", phone: "09120000002", city: "اصفهان", planName: "حرفه‌ای", paymentReference: "VIP-TEST-3" },
    });
    expect(again.status).toBe(200);
    expect(again.data.status).toBe("approved");
  });
});
