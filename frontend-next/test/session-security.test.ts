import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, corsHeadersFor } from "../server/kolbe-api";
import { call, login } from "./helpers";

/**
 * آزمون‌های امنیت نشست.
 *
 * قواعد حاکم: «Do not store auth/session tokens in localStorage» و
 * «Prefer Secure + HttpOnly + SameSite cookies».
 *
 * در این گام، کوکی HttpOnly **همراه** توکن فعلی صادر می‌شود (مهاجرت دوگانه‌خوان)
 * تا فرانت‌ها بدون شکستن، مرحله‌به‌مرحله به کوکی منتقل شوند.
 */

function parseSetCookie(header: string | null) {
  if (!header) return null;
  const [pair, ...attributes] = header.split(";").map((part) => part.trim());
  const [name, ...value] = pair.split("=");
  return { name, value: value.join("="), attributes: attributes.map((a) => a.toLowerCase()) };
}

describe("امنیت نشست", () => {
  it("ورود، کوکی HttpOnly + SameSite=Lax صادر می‌کند", async () => {
    const login$ = await login("admin");
    const cookie = parseSetCookie(login$.response.headers.get("set-cookie"));

    expect(cookie).not.toBeNull();
    expect(cookie!.name).toBe(SESSION_COOKIE);
    expect(cookie!.value.length).toBeGreaterThan(20);
    expect(cookie!.attributes).toContain("httponly");
    expect(cookie!.attributes).toContain("samesite=lax");
    expect(cookie!.attributes).toContain("path=/");
  });

  it("هم توکن Bearer و هم کوکی معتبر پذیرفته می‌شوند (dual-read)", async () => {
    const admin = await login("admin");
    const cookieHeader = `other=1; ${SESSION_COOKIE}=${admin.token}`;

    const viaBearer = await call("admin/suppliers", { token: admin.token });
    expect(viaBearer.status).toBe(200);

    const viaCookie = await call("admin/suppliers", { headers: { cookie: cookieHeader } });
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.suppliers.length).toBe(viaBearer.body.suppliers.length);
  });

  it("کوکی جعلی پذیرفته نمی‌شود", async () => {
    const forged = "eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImV4cCI6NDEwMjQ0NDgwMH0.forged-signature";
    const result = await call("admin/suppliers", { headers: { cookie: `${SESSION_COOKIE}=${forged}` } });
    expect(result.status).toBe(401);
  });

  it("خروج، کوکی را پاک می‌کند", async () => {
    const result = await call("auth/logout", { method: "POST", body: {} });
    expect(result.status).toBe(200);
    const cookie = parseSetCookie(result.headers.get("set-cookie"));
    expect(cookie!.name).toBe(SESSION_COOKIE);
    expect(cookie!.value).toBe("");
    expect(cookie!.attributes.some((a) => a.startsWith("max-age=0"))).toBe(true);
  });

  it("توکن منقضی رد می‌شود", async () => {
    // ساخت توکن منقضی با همان الگوریتم (HMAC-SHA256) و راز تست.
    const { createHmac } = await import("node:crypto");
    const payload = Buffer.from(
      JSON.stringify({ sub: "usr_x", role: "admin", exp: Math.floor(Date.now() / 1000) - 60 }),
    ).toString("base64url");
    const signature = createHmac("sha256", process.env.KOLBE_SESSION_SECRET!)
      .update(payload)
      .digest("base64url");

    const result = await call("admin/suppliers", { token: `${payload}.${signature}` });
    expect(result.status).toBe(401);
  });

  it("CORS در تولید فقط مبدأهای مجاز را اکو می‌کند", () => {
    const previous = { ...process.env };
    try {
      delete process.env.KOLBE_ALLOWED_ORIGINS;
      process.env.NODE_ENV = "production";
      // بدون پیکربندی، هیچ مبدأیی مجاز نیست (فروشگاه same-origin نیازی به CORS ندارد).
      expect(corsHeadersFor("https://evil.example")["access-control-allow-origin"]).toBeUndefined();

      process.env.KOLBE_ALLOWED_ORIGINS = "https://kolbe.ir,https://www.kolbe.ir";
      expect(corsHeadersFor("https://kolbe.ir")["access-control-allow-origin"]).toBe("https://kolbe.ir");
      expect(corsHeadersFor("https://evil.example")["access-control-allow-origin"]).toBeUndefined();
    } finally {
      process.env = previous;
    }
  });
});
