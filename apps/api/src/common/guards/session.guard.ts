/**
 * نگهبان نشست، نقش و محافظت CSRF — فاز ۴.۹.۱ سخت‌سازی پایانی.
 *
 * قاعدهٔ A6: «Do not use client-supplied supplier IDs as ownership authority».
 * هویت و نقش فقط از توکن امضاشده خوانده می‌شود و در `request.claims` قرار
 * می‌گیرد؛ هیچ کنترلری نباید `userId`/`supplierId` را از بدنه یا query بگیرد.
 *
 * ویژگی‌های امنیتی:
 *   - بررسی نسخهٔ توکن (token_version) در برابر دیتابیس — ابطال بلادرنگ با افزایش نسخه
 *   - بررسی وضعیت حساب کاربر (فقط کاربران با وضعیت active مجازند)
 *   - مهار جعل درخواست میان‌وب‌گاهی (CSRF) برای جهش‌های کوکی‌محور در متدهای POST, PUT, PATCH, DELETE
 *   - بررسی انطباق دقیق Origin و fallback به Referer
 *   - استثناهای مجاز و صریح برای کلاینت‌های Bearer-only، وب‌هوک‌های ارائه‌دهندگان و فراخوانی‌های سرویس داخلی
 */

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ForbiddenError, UnauthorizedError } from "@kolbe/shared";
import { eq } from "drizzle-orm";
import { accountUser } from "@kolbe/database";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { extractToken, SessionVerifier, type Claims, type Role } from "../session";
import { RequestContext } from "../context/request-context";

export const ROLES_KEY = "kolbe:roles";
export const PUBLIC_KEY = "kolbe:public";

/** مسیرهایی که نباید نشست بخواهند (سلامت، مستندات، ورود). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export type RequestWithClaims = Request & { claims?: Claims };

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly verifier: SessionVerifier;

  constructor(
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {
    this.verifier = new SessionVerifier(config.sessionSecret);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithClaims>();

    // سیاست مهار CSRF برای درخواست‌های تغییردهنده (POST, PUT, PATCH, DELETE)
    this.checkCsrf(request, Boolean(isPublic));

    if (isPublic) return true;

    const token = extractToken(request.headers as Record<string, unknown>);
    const claims = token ? this.verifier.verify(token) : null;
    if (!claims) throw new UnauthorizedError();

    // بررسی نسخهٔ توکن و وضعیت حساب در دیتابیس
    try {
      const [user] = await this.db
        .select({
          id: accountUser.id,
          role: accountUser.role,
          status: accountUser.status,
          tokenVersion: accountUser.tokenVersion,
        })
        .from(accountUser)
        .where(eq(accountUser.id, claims.sub))
        .limit(1);

      if (!user) throw new UnauthorizedError();
      if (user.status !== "active") {
        throw new ForbiddenError("ACCOUNT_SUSPENDED", "حساب کاربری فعال نیست");
      }

      if (claims.tv !== undefined) {
        if (claims.tv !== user.tokenVersion) throw new UnauthorizedError();
      } else {
        if (user.tokenVersion !== 0) throw new UnauthorizedError();
      }

      if (user.role !== claims.role) throw new UnauthorizedError();
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) throw error;
      throw new UnauthorizedError();
    }

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(claims.role)) {
      throw new ForbiddenError("FORBIDDEN", "این عملیات برای نقش شما مجاز نیست");
    }

    request.claims = claims;
    RequestContext.setActor(claims.sub, claims.role);
    return true;
  }

  private extractOriginFromUrl(urlString: string): string | null {
    try {
      const u = new URL(urlString);
      return u.origin;
    } catch {
      return null;
    }
  }

  private isCsrfExempt(request: Request): boolean {
    // ۱) فراخوانی‌های سرویس داخلی با هدر X-Internal-Token معتبر
    const internalToken = request.headers["x-internal-token"];
    if (
      internalToken &&
      typeof internalToken === "string" &&
      this.config.internalApiToken &&
      internalToken === this.config.internalApiToken
    ) {
      return true;
    }

    // ۲) وب‌هوک‌های ارائه‌دهندگان ثالث که دارای امضای اعتبارسنجی هستند
    const path = String(request.originalUrl ?? request.url ?? request.path ?? "");
    if (path.includes("/webhook")) {
      return true;
    }

    // ۳) کلاینت‌های خالص API که صرفاً از هدر Bearer استفاده می‌کنند (بدون کوکی مرورگر)
    const authHeader = request.headers["authorization"];
    const cookieHeader = request.headers["cookie"];
    const hasBearer = typeof authHeader === "string" && authHeader.trim().toLowerCase().startsWith("bearer ");
    const hasSessionCookie = typeof cookieHeader === "string" && cookieHeader.includes("kolbe_session=");

    if (hasBearer && !hasSessionCookie) {
      return true;
    }

    return false;
  }

  private checkCsrf(request: Request, isPublic: boolean): void {
    const method = String(request.method ?? "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return;

    if (this.isCsrfExempt(request)) {
      return;
    }

    const cookieHeader = request.headers["cookie"];
    const hasSessionCookie = typeof cookieHeader === "string" && cookieHeader.includes("kolbe_session=");

    const path = String(request.originalUrl ?? request.url ?? request.path ?? "");
    const isCookieSettingRoute =
      path.includes("/auth/login") ||
      path.includes("/auth/register") ||
      path.includes("/auth/supplier/login");

    if (!hasSessionCookie && !isCookieSettingRoute && isPublic) {
      // مسیر عمومی غیرکوکی
      return;
    }

    const originHeader = request.headers["origin"];
    const refererHeader = request.headers["referer"];

    const rawOrigin = typeof originHeader === "string" && originHeader.trim() ? originHeader.trim() : null;
    const refererOrigin =
      typeof refererHeader === "string" && refererHeader.trim()
        ? this.extractOriginFromUrl(refererHeader.trim())
        : null;

    const candidateOrigin = rawOrigin ?? refererOrigin;

    if (candidateOrigin) {
      if (!this.isOriginAllowed(candidateOrigin)) {
        throw new ForbiddenError("FORBIDDEN_ORIGIN", "مبدأ درخواست مجاز نیست");
      }
      return;
    }

    // در صورتی که هر دو هدر Origin و Referer غایب باشند
    const enforce = this.config.env === "production" || request.headers["x-enforce-csrf"] === "true";
    if (enforce) {
      throw new ForbiddenError(
        "CSRF_VALIDATION_FAILED",
        "درخواست تغییردهنده بدون مبدأ معتبر (Origin/Referer) مسدود شد",
      );
    }
  }

  private isOriginAllowed(origin: string): boolean {
    if (this.config.allowedOrigins.length === 0) {
      if (this.config.env !== "production") return true;
      return false;
    }

    return this.config.allowedOrigins.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === origin) return true;
      if (allowed.startsWith("https://*.")) {
        const suffix = allowed.slice("https://*.".length);
        try {
          const url = new URL(origin);
          return url.hostname === suffix || url.hostname.endsWith(`.${suffix}`);
        } catch {
          return false;
        }
      }
      return false;
    });
  }
}

/** دسترسی به هویت تأییدشده در کنترلر: `@CurrentUser() claims: Claims`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): Claims => {
  const request = context.switchToHttp().getRequest<RequestWithClaims>();
  if (!request.claims) throw new UnauthorizedError();
  return request.claims;
});
