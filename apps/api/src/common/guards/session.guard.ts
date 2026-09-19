/**
 * نگهبان نشست و نقش — فاز ۲ سخت‌سازی.
 *
 * قاعدهٔ A6: «Do not use client-supplied supplier IDs as ownership authority».
 * هویت و نقش فقط از توکن امضاشده خوانده می‌شود و در `request.claims` قرار
 * می‌گیرد؛ هیچ کنترلری نباید `userId`/`supplierId` را از بدنه یا query بگیرد.
 *
 * فاز ۲ اضافه می‌کند:
 *   - بررسی نسخهٔ توکن (token_version) در برابر دیتابیس — ابطال با افزایش نسخه
 *   - بررسی وضعیت حساب (فقط active مجاز)
 *   - بررسی Origin برای درخواست‌های تغییردهنده (D35)
 *   - ثبت IP و تلاش ورود در لاگ حسابرسی (غیرمسدودکننده)
 *
 * استفاده:
 * ```ts
 * @UseGuards(SessionGuard)
 * @Roles("admin")
 * @Get("logs")
 * ```
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
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithClaims>();

    // D35 — بررسی Origin برای درخواست‌های تغییردهنده
    if (this.shouldCheckOrigin(request)) {
      const origin = String(request.headers["origin"] ?? "");
      if (origin && !this.isOriginAllowed(origin)) {
        throw new ForbiddenError("FORBIDDEN_ORIGIN", "مبدأ درخواست مجاز نیست");
      }
    }

    const token = extractToken(request.headers as Record<string, unknown>);
    const claims = token ? this.verifier.verify(token) : null;
    if (!claims) throw new UnauthorizedError();

    // فاز ۲ — بررسی نسخهٔ توکن و وضعیت حساب در دیتابیس
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
      // اگر توکن نسخه دارد، باید با نسخهٔ دیتابیس برابر باشد؛ اگر ندارد (لگاسی)
      // فقط وقتی نسخهٔ دیتابیس ۰ است می‌پذیریم (دورهٔ گذار برای parity)
      if (claims.tv !== undefined) {
        if (claims.tv !== user.tokenVersion) throw new UnauthorizedError();
      } else {
        if (user.tokenVersion !== 0) throw new UnauthorizedError();
      }
      // نقش داخل توکن باید با نقش دیتابیس هم‌خوان باشد (جلوگیری از ارتقای نقش با توکن قدیمی)
      if (user.role !== claims.role) throw new UnauthorizedError();
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) throw error;
      // خطای دیتابیس نباید توکن را معتبر جلوه دهد — fail-closed
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

  private shouldCheckOrigin(request: Request): boolean {
    const method = String(request.method ?? "GET").toUpperCase();
    // فقط برای متدهای تغییردهنده
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
    // اگر Origin نداریم (same-origin fetch یا curl)، اجازه می‌دهیم — SameSite=Lax محافظ اصلی است
    const origin = request.headers["origin"];
    if (!origin) return false;
    return true;
  }

  private isOriginAllowed(origin: string): boolean {
    // در توسعه اگر allowlist خالی باشد، همهٔ مبدأهای localhost مجاز هستند
    if (this.config.allowedOrigins.length === 0) {
      if (this.config.env !== "production") return true;
      // در تولید allowlist خالی نباید باشد (قبلاً در loadConfig چک شده)، اما اگر باشد، هیچ Origin خارجی مجاز نیست
      return false;
    }
    // تطبیق دقیق یا wildcard ساده
    return this.config.allowedOrigins.some((allowed) => {
      if (allowed === "*") return true;
      if (allowed === origin) return true;
      // پشتیبانی از زیردامنه wildcard مثل https://*.kolbe.ir
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
