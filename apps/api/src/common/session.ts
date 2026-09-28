/**
 * اعتبارسنجی نشست — سازگار با توکن موجود (لایهٔ گذار).
 *
 * چرا ماژول مستقل و نه فقط یک Guard؟ چون در دورهٔ گذار **دو سطح HTTP** وجود دارد:
 * route handler قدیمی Next.js روی `/store/kolbe/*` و این سرویس روی `/api/v1/*`.
 * هر دو باید یک توکن را بپذیرند تا کاربران هنگام جابه‌جایی یک دامنه، از حساب خارج
 * نشوند. این فایل تنها نقطهٔ اعتبارسنجی توکن در سمت NestJS است.
 *
 * قواعد حاکم:
 *  - A9: کوکی `HttpOnly; SameSite=Lax; Secure` مسیر هدف است. در گذار، هم هدر
 *    `Authorization: Bearer` و هم کوکی پذیرفته می‌شود (dual-read).
 *  - قاعدهٔ «No client-supplied supplier IDs as ownership authority»: نقش و هویت
 *    از امضای توکن می‌آید، نه از بدنهٔ درخواست.
 *
 * ⚠️ بدهی فنی ثبت‌شده: امضای HMAC و فقدان ابطال (revocation) در فاز ۲ با
 * Argon2 + چرخش refresh token + لیست سیاه Redis جایگزین می‌شود.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "@kolbe/shared";

export type Role = "customer" | "vip" | "supplier" | "admin" | "finance";

export type Claims = {
  sub: string;
  role: Role;
  exp: number;
  tv?: number; // token_version — فاز ۲ برای ابطال
};

export const SESSION_COOKIE = "kolbe_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export class SessionVerifier {
  constructor(private readonly secret: string) {}

  /** امضای HMAC-SHA256 روی بدنهٔ base64url. */
  private sign(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }

  issue(userId: string, role: Role, tokenVersion: number = 0, ttlSeconds: number = SESSION_TTL_SECONDS): string {
    const payload: Claims = {
      sub: userId,
      role,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      tv: tokenVersion,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  /**
   * صدور توکن سازگار با لگاسی (بدون tv) — برای آزمون برابری (parity test).
   * در کد جدید همیشه `issue` با tv استفاده می‌شود؛ این متد فقط برای آزمون
   * interchangeability است تا ثابت کند توکن قدیمی و جدید با یک secret قابل
   * تأیید متقابل‌اند.
   */
  issueLegacy(userId: string, role: Role, ttlSeconds: number = SESSION_TTL_SECONDS): string {
    const payload = { sub: userId, role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string): Claims | null {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = this.sign(body);
    const provided = Buffer.from(signature);
    const calculated = Buffer.from(expected);
    if (provided.length !== calculated.length) return null;
    if (!timingSafeEqual(provided, calculated)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims & { exp: number };
      if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
      if (!claims.sub || !claims.role) return null;
      // tv اختیاری است تا توکن‌های لگاسی بدون tv هم پذیرفته شوند (دورهٔ گذار)
      if (claims.tv !== undefined && typeof claims.tv !== "number") return null;
      return claims;
    } catch {
      return null;
    }
  }

  /** هدر Set-Cookie نشست — HttpOnly/SameSite و در تولید Secure. */
  cookie(token: string, isProduction: boolean): string {
    const secure = isProduction ? "; Secure" : "";
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
  }

  clearCookie(isProduction: boolean): string {
    const secure = isProduction ? "; Secure" : "";
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  }
}

/** استخراج توکن: اول هدر Bearer، سپس کوکی (dual-read در دورهٔ گذار). */
export function extractToken(headers: Record<string, unknown>): string | null {
  const authorization = headers["authorization"];
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1];
  }
  const cookie = headers["cookie"];
  if (typeof cookie === "string") {
    for (const part of cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function requireRole(claims: Claims | null, ...roles: Role[]): Claims {
  if (!claims) throw new UnauthorizedError();
  if (roles.length && !roles.includes(claims.role)) throw new UnauthorizedError();
  return claims;
}
