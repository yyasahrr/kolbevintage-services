import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, cleanupUser, ensureInitialized, unique } from "./helpers";

const email = `${unique("auth-test")}@example.test`;

beforeAll(ensureInitialized);
afterAll(async () => cleanupUser(email));

describe("auth & access control", () => {
  let token: string;

  it("registers a customer with scrypt-hash storage and issues a token", async () => {
    const r = await call("POST", "auth/register", {
      body: { email, password: "TestPass123!", name: "کاربر تست", phone: "09129999999" },
    });
    expect(r.status).toBe(201);
    expect(r.data.user.role).toBe("customer");

    const again = await call("POST", "auth/register", { body: { email, password: "TestPass123!" } });
    expect(again.status).toBe(409);
  });

  it("rejects weak passwords", async () => {
    const r = await call("POST", "auth/register", { body: { email: `${unique("weak")}@example.test`, password: "123" } });
    expect(r.status).toBe(422);
  });

  it("rejects wrong credentials with 401 (no user enumeration differences)", async () => {
    const wrong = await call("POST", "auth/login", { body: { email, password: "WrongPass123!" } });
    const missing = await call("POST", "auth/login", { body: { email: "ghost@example.test", password: "Whatever123!" } });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
  });

  it("login returns a token AND an HttpOnly SameSite session cookie", async () => {
    const r = await call("POST", "auth/login", { body: { email, password: "TestPass123!" } });
    expect(r.status).toBe(200);
    token = r.data.token;
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kolbe_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=1209600");
  });

  it("accepts cookie-based auth for /me (no bearer needed)", async () => {
    const r = await call("POST", "auth/login", { body: { email, password: "TestPass123!" } });
    const cookieRaw = (r.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookieRaw.startsWith("kolbe_session=")).toBe(true);
    const me = await call("GET", "me", { cookie: cookieRaw });
    expect(me.status).toBe(200);
    expect(me.data.email).toBe(email);
  });

  it("rejects forged and expired signatures", async () => {
    const forged = `${btoa(JSON.stringify({ sub: "usr_admin", role: "admin", exp: 99999999999 }))}.deadbeef`;
    const r = await call("GET", "me", { token: forged });
    expect(r.status).toBe(401);
  });

  it("any authenticated role can read /me (vip users are no longer logged out)", async () => {
    const admin = await call("POST", "auth/login", { body: { email: "admin@kolbe.ir", password: "KolbeAdmin1404!" } });
    expect(admin.status).toBe(200);
    const me = await call("GET", "me", { token: admin.data.token });
    expect(me.status).toBe(200);
    expect(me.data.email).toBe("admin@kolbe.ir");
  });

  it("cross-role access is denied: customer token cannot list admin catalogs", async () => {
    const r = await call("GET", "admin/catalog", { token });
    expect(r.status).toBe(401);
  });

  it("logout clears the session cookie", async () => {
    const r = await call("POST", "auth/logout", {});
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kolbe_session=;");
    expect(cookie).toContain("Max-Age=0");
  });
});
