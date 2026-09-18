import fs from "node:fs";
import path from "node:path";
import { createHmac, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, corsHeadersFor } from "../server/kolbe-api";
import { call, createCustomer, login, uniqueSuffix } from "./helpers";
import { rows } from "../server/database";

/**
 * آزمون‌های فاز ۲ — انتقال مالکیت احراز هویت.
 *
 * قواعد هدف:
 *   A9  : هیچ توکنی در localStorage ذخیره نمی‌شود — فقط HttpOnly Cookie.
 *   D35 : بررسی Origin/CSRF برای درخواست‌های غیر-GET.
 *   D36 : CORS per-request با لیست سفید.
 *   D38 : مدل مجوز مبتنی بر نقش + token_version برای ابطال.
 *   Parity: توکن لگاسی و NestJS قابل تبادل.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function parseSetCookie(header: string | null) {
  if (!header) return null;
  const [pair, ...attributes] = header.split(";").map((p) => p.trim());
  const [name, ...value] = pair.split("=");
  return { name, value: value.join("="), attributes: attributes.map((a) => a.toLowerCase()) };
}

function decodePayload(token: string): any {
  const [payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("فاز ۲ — احراز هویت: نسخه‌سازی توکن و ابطال", () => {
  it("توکن جدید شامل tv (token_version) است", async () => {
    const customer = await createCustomer();
    const decoded = decodePayload(customer.token);
    expect(typeof decoded.tv).toBe("number");
    expect(decoded.tv).toBeGreaterThanOrEqual(0);
    expect(decoded.sub).toBe(customer.userId);
  });

  it("logout نسخهٔ توکن را افزایش می‌دهد و توکن قدیمی را باطل می‌کند", async () => {
    const customer = await createCustomer();
    const oldToken = customer.token;
    const oldDecoded = decodePayload(oldToken);

    // logout با توکن قدیمی
    const out = await call("auth/logout", { method: "POST", body: {}, token: oldToken });
    expect(out.status).toBe(200);

    // بررسی DB: token_version افزایش یافته
    const users = await rows<{ token_version: number }>(
      `SELECT token_version FROM account_user WHERE id=$1`,
      [customer.userId],
    );
    expect(users[0].token_version).toBeGreaterThan(oldDecoded.tv);

    // توکن قدیمی دیگر معتبر نیست — auth/me باید 401 بدهد
    const me = await call("auth/me", { token: oldToken });
    expect(me.status).toBe(401);

    // ورود دوباره توکن تازه با tv جدید می‌دهد
    const relogin = await call("auth/login", {
      method: "POST",
      body: { email: customer.email, password: customer.password },
    });
    expect(relogin.status).toBe(200);
    const newDecoded = decodePayload(relogin.body.token);
    expect(newDecoded.tv).toBe(users[0].token_version);
    expect(newDecoded.tv).not.toBe(oldDecoded.tv);
  });

  it("ورود موفق یک ردیف user_session با هش توکن می‌سازد و خروج آن را باطل می‌کند", async () => {
    const customer = await createCustomer();
    const tokenHash = createHash("sha256").update(customer.token).digest("hex");
    const sessions = await rows<{ token_hash: string; revoked_at: string | null }>(
      `SELECT token_hash, revoked_at FROM user_session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [customer.userId],
    );
    const found = sessions.find((s) => s.token_hash === tokenHash);
    expect(found).toBeDefined();
    expect(found!.revoked_at).toBeNull();

    await call("auth/logout", { method: "POST", body: {}, token: customer.token });

    const after = await rows<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM user_session WHERE token_hash=$1`,
      [tokenHash],
    );
    expect(after[0]?.revoked_at).not.toBeNull();
  });

  it("تلاش‌های ورود در login_attempt ثبت می‌شوند", async () => {
    const customer = await createCustomer();
    const before = await rows<{ count: string }>(
      `SELECT count(*) AS count FROM login_attempt WHERE email=$1`,
      [customer.email],
    );
    const beforeCount = Number(before[0].count);

    // ورود ناموفق
    await call("auth/login", { method: "POST", body: { email: customer.email, password: "WrongPass123!" } });

    const afterFail = await rows<{ count: string; success: boolean }>(
      `SELECT count(*) AS count FROM login_attempt WHERE email=$1`,
      [customer.email],
    );
    expect(Number(afterFail[0].count)).toBeGreaterThan(beforeCount);

    const last = await rows<{ success: boolean }>(
      `SELECT success FROM login_attempt WHERE email=$1 ORDER BY created_at DESC LIMIT 1`,
      [customer.email],
    );
    expect(last[0].success).toBe(false);

    // ورود موفق
    await call("auth/login", { method: "POST", body: { email: customer.email, password: customer.password } });
    const last2 = await rows<{ success: boolean }>(
      `SELECT success FROM login_attempt WHERE email=$1 ORDER BY created_at DESC LIMIT 1`,
      [customer.email],
    );
    expect(last2[0].success).toBe(true);
  });

  it("پس از ۵ تلاش ناموفق، حساب ۱۵ دقیقه قفل می‌شود (D38)", async () => {
    const suffix = uniqueSuffix();
    const email = `locktest-${suffix}@example.test`;
    const password = "CustomerPass1404!";
    const registered = await call("auth/register", {
      method: "POST",
      body: { email, password, name: "Lock Test", phone: "09120000000" },
    });
    expect(registered.status).toBe(201);

    for (let i = 0; i < 5; i++) {
      const attempt = await call("auth/login", {
        method: "POST",
        body: { email, password: "WrongPass123!" },
      });
      expect([401, 423]).toContain(attempt.status);
    }

    // ششمین تلاش حتی با رمز درست باید 423 بدهد
    const locked = await call("auth/login", {
      method: "POST",
      body: { email, password },
    });
    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe("ACCOUNT_LOCKED");

    const user = await rows<{ locked_until: string | null; failed_login_attempts: number }>(
      `SELECT locked_until, failed_login_attempts FROM account_user WHERE email=$1`,
      [email],
    );
    expect(user[0].locked_until).not.toBeNull();
    expect(user[0].failed_login_attempts).toBeGreaterThanOrEqual(5);
  });
});

describe("فاز ۲ — Origin/CSRF و CORS per-request (D35/D36)", () => {
  it("درخواست POST با Origin غیرمجاز ۴۰۳ FORBIDDEN_ORIGIN می‌دهد (وقتی لیست سفید تنظیم است)", async () => {
    const prev = process.env.KOLBE_ALLOWED_ORIGINS;
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.KOLBE_ALLOWED_ORIGINS = "https://kolbe.ir,https://www.kolbe.ir";
      process.env.NODE_ENV = "production";

      const customer = await createCustomer();
      const result = await call("auth/logout", {
        method: "POST",
        body: {},
        token: customer.token,
        headers: { origin: "https://evil.example" },
      });
      expect(result.status).toBe(403);
      expect(result.body.error).toBe("FORBIDDEN_ORIGIN");
    } finally {
      if (prev === undefined) delete process.env.KOLBE_ALLOWED_ORIGINS;
      else process.env.KOLBE_ALLOWED_ORIGINS = prev;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
    }
  });

  it("CORS per-request: مبدأ مجاز اکو می‌شود، نامجاز اکو نمی‌شود", () => {
    const prev = { ...process.env };
    try {
      delete process.env.KOLBE_ALLOWED_ORIGINS;
      process.env.NODE_ENV = "production";
      expect(corsHeadersFor("https://evil.example")["access-control-allow-origin"]).toBeUndefined();

      process.env.KOLBE_ALLOWED_ORIGINS = "https://kolbe.ir,https://www.kolbe.ir,https://*.kolbe.ir";
      expect(corsHeadersFor("https://kolbe.ir")["access-control-allow-origin"]).toBe("https://kolbe.ir");
      expect(corsHeadersFor("https://sub.kolbe.ir")["access-control-allow-origin"]).toBe("https://sub.kolbe.ir");
      expect(corsHeadersFor("https://evil.example")["access-control-allow-origin"]).toBeUndefined();

      // same-origin بدون Origin هدر نیازی به CORS ندارد
      expect(corsHeadersFor(null)["access-control-allow-origin"]).toBeUndefined();
    } finally {
      process.env = prev;
    }
  });

  it("کوکی HttpOnly با SameSite=Lax و Path=/ صادر می‌شود و Max-Age دارد", async () => {
    const customer = await createCustomer();
    const customerLogin = await call("auth/login", {
      method: "POST",
      body: { email: customer.email, password: customer.password },
    });
    const setCookie = customerLogin.headers.get("set-cookie");
    const cookie = parseSetCookie(setCookie);
    expect(cookie).not.toBeNull();
    expect(cookie!.name).toBe(SESSION_COOKIE);
    expect(cookie!.attributes).toContain("httponly");
    expect(cookie!.attributes).toContain("samesite=lax");
    expect(cookie!.attributes).toContain("path=/");
    expect(cookie!.attributes.some((a) => a.startsWith("max-age="))).toBe(true);
  });
});

describe("فاز ۲ — A9: هیچ توکنی در localStorage ذخیره نمی‌شود", () => {
  function walk(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".next") || entry.name.startsWith("dist")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full, exts));
      else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
    }
    return out;
  }

  it("storefront/lib/api.ts هیچ localStorage token ندارد (فقط HttpOnly)", () => {
    const apiPath = path.join(REPO_ROOT, "frontend-next", "storefront", "lib", "api.ts");
    const src = fs.readFileSync(apiPath, "utf8");
    // نباید هیچ setItem/getItem/removeItem برای توکن داشته باشد
    expect(src).not.toMatch(/localStorage\s*\.\s*setItem/);
    expect(src).not.toMatch(/localStorage\s*\.\s*getItem/);
    expect(src).not.toMatch(/localStorage\s*\.\s*removeItem/);
    expect(src).not.toMatch(/TOKEN_KEYS/);
    // کلیدهای توکن قدیمی نباید باشند — دقیق
    expect(src).not.toMatch(/["']kv_customer["']/);
    expect(src).not.toMatch(/["']kv_vip["']/);
    expect(src).not.toMatch(/["']kv_admin["']/);
    expect(src).not.toMatch(/["']kv_supplier["']/);
  });

  it("هیچ فایلی در storefront یا supplier-src توکن را در localStorage نمی‌نویسد (کلیدهای دقیق)", () => {
    const offenders: string[] = [];
    const roots = [
      path.join(REPO_ROOT, "frontend-next", "storefront"),
      path.join(REPO_ROOT, "frontend-next", "supplier-src"),
      path.join(REPO_ROOT, "frontend-next", "server"),
    ];
    // فقط کلیدهای دقیق توکن قدیمی را چک می‌کنیم، نه kv_admin_products و غیره
    const exactTokenKey = /["']kv_customer["']|["']kv_vip["']|["']kv_admin["']|["']kv_supplier["']/;
    const tokenLsPattern = /localStorage\s*\.\s*(setItem|getItem|removeItem)\s*\(\s*["']kv_(customer|vip|admin|supplier)["']/;
    for (const root of roots) {
      for (const file of walk(root, [".ts", ".tsx"])) {
        if (file.includes("test/")) continue;
        // api.ts قبلاً چک شد
        if (file.endsWith("storefront/lib/api.ts")) continue;
        const src = fs.readFileSync(file, "utf8");
        if (exactTokenKey.test(src) || tokenLsPattern.test(src)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} → localStorage token key`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("api.ts از credentials: include و cookie-only استفاده می‌کند", () => {
    const apiPath = path.join(REPO_ROOT, "frontend-next", "storefront", "lib", "api.ts");
    const src = fs.readFileSync(apiPath, "utf8");
    expect(src).toMatch(/credentials:\s*[\"']include[\"']/);
    // نباید Authorization: Bearer را از localStorage بخواند
    expect(src).not.toMatch(/Bearer.*localStorage/);
  });
});

describe("فاز ۲ — Parity: توکن لگاسی ↔ NestJS قابل تبادل", () => {
  it("توکن صادرشده توسط لگاسی توسط SessionVerifier نست قابل تأیید است و برعکس", async () => {
    const { SessionVerifier } = await import("../../apps/api/src/common/session");
    const secret = process.env.KOLBE_SESSION_SECRET!;
    const verifier = new SessionVerifier(secret);

    // توکن لگاسی از طریق login واقعی
    const customer = await createCustomer();
    const legacyToken = customer.token;
    const verified = verifier.verify(legacyToken);
    expect(verified).not.toBeNull();
    expect(verified!.sub).toBe(customer.userId);

    // توکن صادرشده توسط NestJS (با tv) توسط لگاسی قابل تأیید است
    // یک کاربر تازه می‌سازیم تا tv همگام باشد
    const fresh = await createCustomer();
    const freshNestToken = verifier.issue(fresh.userId, "customer", 0);
    const freshMe = await call("auth/me", { token: freshNestToken });
    expect(freshMe.status).toBe(200);
    // legacy me returns flat {id,email,...} not nested
    const body = freshMe.body as any;
    const userId = body.id ?? body.user?.id;
    expect(userId).toBe(fresh.userId);
  });

  it("امضای توکن با timingSafeEqual و راز مشترک سازگار است", async () => {
    const secret = process.env.KOLBE_SESSION_SECRET!;
    const payload = Buffer.from(JSON.stringify({ sub: "usr_x", role: "admin", exp: 4102444800, tv: 0 })).toString(
      "base64url",
    );
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const token = `${payload}.${signature}`;

    const decoded = decodePayload(token);
    expect(decoded.tv).toBe(0);

    const { SessionVerifier } = await import("../../apps/api/src/common/session");
    const verifier = new SessionVerifier(secret);
    const claims = verifier.verify(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("usr_x");
    // SessionVerifier returns tv (not tokenVersion)
    expect((claims as any).tv).toBe(0);
  });
});

describe("فاز ۲ — ثبت‌نام و ورود: اعتبارسنجی و امنیت", () => {
  it("ثبت‌نام، token_version=0 و failed_login_attempts=0 درج می‌کند", async () => {
    const suffix = uniqueSuffix();
    const email = `regtest-${suffix}@example.test`;
    const reg = await call("auth/register", {
      method: "POST",
      body: { email, password: "CustomerPass1404!", name: "Test", phone: "09120000000" },
    });
    expect(reg.status).toBe(201);
    const user = await rows<{ token_version: number; failed_login_attempts: number; status: string }>(
      `SELECT token_version, failed_login_attempts, status FROM account_user WHERE email=$1`,
      [email],
    );
    expect(user[0].token_version).toBe(0);
    expect(user[0].failed_login_attempts).toBe(0);
    expect(user[0].status).toBe("active");
  });


describe("فاز ۲ — TOTP دومرحله‌ای", () => {
  it("enroll → verify → login با TOTP → disable", async () => {
    const customer = await createCustomer();

    // enroll
    const enroll = await call("auth/totp/enroll", { method: "POST", body: {}, token: customer.token });
    expect(enroll.status).toBe(200);
    expect(typeof enroll.body.secret).toBe("string");
    expect(enroll.body.secret.length).toBeGreaterThan(10);
    expect(typeof enroll.body.otpauthUrl).toBe("string");
    expect(enroll.body.otpauthUrl).toContain("otpauth://totp/");

    // generate code using same algorithm as server (we replicate TOTP)
    const { createHmac } = await import("node:crypto");
    function base32Decode(input: string): Buffer {
      const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
      let bits = 0; let value = 0; const bytes: number[] = [];
      for (let i = 0; i < cleaned.length; i++) {
        const idx = BASE32_ALPHABET.indexOf(cleaned[i]); if (idx === -1) continue;
        value = (value << 5) | idx; bits += 5;
        if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
      }
      return Buffer.from(bytes);
    }
    function intToBuf(counter: number): Buffer {
      const buf = Buffer.alloc(8); buf.writeUInt32BE(0,0); buf.writeUInt32BE(counter,4); return buf;
    }
    function genCode(secret: string, step?: number): string {
      const s = step ?? Math.floor(Date.now()/1000/30);
      const key = base32Decode(secret);
      const counter = intToBuf(s);
      const hmac = createHmac("sha1", key).update(counter).digest();
      const offset = hmac[hmac.length-1] & 0x0f;
      const code = ((hmac[offset] & 0x7f)<<24)|((hmac[offset+1]&0xff)<<16)|((hmac[offset+2]&0xff)<<8)|(hmac[offset+3]&0xff);
      return (code % 1_000_000).toString().padStart(6,"0");
    }

    const code = genCode(enroll.body.secret);

    // verify
    const verify = await call("auth/totp/verify", { method: "POST", body: { code }, token: customer.token });
    expect(verify.status).toBe(200);
    expect(verify.body.enabled).toBe(true);

    // check DB
    const user = await rows<{ totp_enabled: boolean }>("SELECT totp_enabled FROM account_user WHERE id=$1", [customer.userId]);
    expect(user[0].totp_enabled).toBe(true);

    // login without TOTP should fail TOTP_REQUIRED
    const loginNoTotp = await call("auth/login", { method: "POST", body: { email: customer.email, password: customer.password } });
    expect(loginNoTotp.status).toBe(401);
    expect(loginNoTotp.body.error).toBe("TOTP_REQUIRED");

    // login with TOTP should succeed
    const loginWithTotp = await call("auth/login", {
      method: "POST",
      body: { email: customer.email, password: customer.password, totpCode: genCode(enroll.body.secret) },
    });
    expect(loginWithTotp.status).toBe(200);

    // disable
    const disableCode = genCode(enroll.body.secret);
    const disable = await call("auth/totp/disable", { method: "POST", body: { code: disableCode }, token: loginWithTotp.body.token });
    expect(disable.status).toBe(200);
    expect(disable.body.enabled).toBe(false);

    const after = await rows<{ totp_enabled: boolean }>("SELECT totp_enabled FROM account_user WHERE id=$1", [customer.userId]);
    expect(after[0].totp_enabled).toBe(false);
  });
});

  it("auth/me با کوکی معتبر کار می‌کند و بدون آن 401 می‌دهد", async () => {
    const customer = await createCustomer();
    const viaBearer = await call("auth/me", { token: customer.token });
    expect(viaBearer.status).toBe(200);
    const bodyBearer = viaBearer.body as any;
    const emailBearer = bodyBearer.email ?? bodyBearer.user?.email;
    expect(emailBearer).toBe(customer.email);

    const viaCookie = await call("auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=${customer.token}` },
    });
    expect(viaCookie.status).toBe(200);
    const bodyCookie = viaCookie.body as any;
    const emailCookie = bodyCookie.email ?? bodyCookie.user?.email;
    expect(emailCookie).toBe(customer.email);

    const noAuth = await call("auth/me", {});
    expect(noAuth.status).toBe(401);
  });
});
