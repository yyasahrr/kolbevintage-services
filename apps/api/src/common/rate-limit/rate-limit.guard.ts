import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { RateLimiterService } from "./rate-limiter.service";
import { RATE_LIMIT_METADATA_KEY, type RateLimitOptions } from "./rate-limit.decorator";
import type { RequestWithClaims } from "../guards/session.guard";

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    // اگر متادیتا تعریف نشده باشد، محدودیت کلی پیش‌فرض ۳۰۰ درخواست در دقیقه اعمال می‌شود
    const effectiveOptions: RateLimitOptions = options ?? {
      limit: 300,
      windowSeconds: 60,
      scope: "ip",
      keyPrefix: "global",
    };

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithClaims>();
    const res = http.getResponse<Response>();

    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown-ip";
    const userId = req.claims?.sub;

    let keyIdent = ip;
    if (effectiveOptions.scope === "user") {
      keyIdent = userId ?? ip;
    } else if (effectiveOptions.scope === "user_or_ip") {
      keyIdent = userId ? `u:${userId}` : `ip:${ip}`;
    }

    const prefix = effectiveOptions.keyPrefix ?? req.path;
    const bucketKey = `${prefix}:${keyIdent}`;

    const decision = await this.rateLimiter.consume(
      bucketKey,
      effectiveOptions.limit,
      effectiveOptions.windowSeconds,
    );

    if (res && typeof res.setHeader === "function") {
      res.setHeader("X-RateLimit-Limit", String(decision.limit));
      res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
      res.setHeader("X-RateLimit-Reset", String(decision.resetAt));
    }

    if (!decision.allowed) {
      if (res && typeof res.setHeader === "function") {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      }
      throw new HttpException(
        {
          error: "RATE_LIMIT_EXCEEDED",
          message: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً بعداً دوباره تلاش کنید.",
          retryAfter: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
