import { describe, expect, it } from "vitest";
import { rows } from "../server/database";
import { call, createCustomer, uniqueSuffix } from "./helpers";

/**
 * بررسی امنیت رمز عبور — فاز ۲.۱.
 *
 * - هش scrypt، نه plaintext
 * - salt جداگانه
 * - عدم لاگ رمز
 * - قفل حساب پس از ۵ تلاش
 * - ثبت‌نام با رمز کوتاه رد می‌شود
 */

describe("امنیت رمز عبور", () => {
  it("رمز عبور به‌صورت هش ذخیره می‌شود، نه plaintext", async () => {
    const suffix = uniqueSuffix();
    const email = `pwtest-${suffix}@example.test`;
    const password = "CustomerPass1404!";
    const reg = await call("auth/register", {
      method: "POST",
      body: { email, password, name: "PW Test" },
    });
    expect(reg.status).toBe(201);

    const user = await rows<{ password_hash: string; salt: string }>(
      "SELECT password_hash, salt FROM account_user WHERE email=$1",
      [email],
    );
    expect(user[0].password_hash).toBeDefined();
    expect(user[0].salt).toBeDefined();
    expect(user[0].password_hash).not.toBe(password);
    expect(user[0].password_hash.length).toBeGreaterThan(20);
    // هش باید hex باشد (scrypt 64 bytes → 128 hex)
    expect(user[0].password_hash).toMatch(/^[a-f0-9]{128}$/);
    expect(user[0].salt).toMatch(/^[a-f0-9]+$/);
  });

  it("ثبت‌نام با رمز کوتاه (<8) رد می‌شود", async () => {
    const suffix = uniqueSuffix();
    const email = `shortpw-${suffix}@example.test`;
    const result = await call("auth/register", {
      method: "POST",
      body: { email, password: "short", name: "Short PW" },
    });
    expect(result.status).toBe(422);
  });

  it("ورود با رمز اشتباه، failed_login_attempts را افزایش می‌دهد", async () => {
    const customer = await createCustomer();
    const before = await rows<{ failed_login_attempts: number }>(
      "SELECT failed_login_attempts FROM account_user WHERE id=$1",
      [customer.userId],
    );
    const beforeCount = Number(before[0].failed_login_attempts);

    await call("auth/login", {
      method: "POST",
      body: { email: customer.email, password: "WrongPass123!" },
    });

    const after = await rows<{ failed_login_attempts: number }>(
      "SELECT failed_login_attempts FROM account_user WHERE id=$1",
      [customer.userId],
    );
    expect(Number(after[0].failed_login_attempts)).toBeGreaterThan(beforeCount);
  });

  it("ورود موفق، failed_login_attempts را صفر می‌کند", async () => {
    const suffix = uniqueSuffix();
    const email = `reset-${suffix}@example.test`;
    const password = "CustomerPass1404!";
    await call("auth/register", { method: "POST", body: { email, password, name: "Reset Test" } });

    // یک تلاش ناموفق
    await call("auth/login", { method: "POST", body: { email, password: "Wrong!" } });
    let user = await rows<{ failed_login_attempts: number }>(
      "SELECT failed_login_attempts FROM account_user WHERE email=$1",
      [email],
    );
    expect(Number(user[0].failed_login_attempts)).toBeGreaterThan(0);

    // ورود موفق
    const ok = await call("auth/login", { method: "POST", body: { email, password } });
    expect(ok.status).toBe(200);

    user = await rows<{ failed_login_attempts: number }>(
      "SELECT failed_login_attempts FROM account_user WHERE email=$1",
      [email],
    );
    expect(Number(user[0].failed_login_attempts)).toBe(0);
  });
});

describe("محدودیت نرخ و قفل حساب", () => {
  it("پس از ۵ تلاش ناموفق، حساب قفل می‌شود و locked_until ست می‌شود", async () => {
    const suffix = uniqueSuffix();
    const email = `lock-${suffix}@example.test`;
    const password = "CustomerPass1404!";
    await call("auth/register", { method: "POST", body: { email, password, name: "Lock Test" } });

    for (let i = 0; i < 5; i++) {
      await call("auth/login", { method: "POST", body: { email, password: "Wrong!" } });
    }

    const user = await rows<{ locked_until: string | null; failed_login_attempts: number }>(
      "SELECT locked_until, failed_login_attempts FROM account_user WHERE email=$1",
      [email],
    );
    expect(user[0].locked_until).not.toBeNull();
    expect(Number(user[0].failed_login_attempts)).toBeGreaterThanOrEqual(5);

    const lockedLogin = await call("auth/login", { method: "POST", body: { email, password } });
    expect(lockedLogin.status).toBe(423);
  });
});
