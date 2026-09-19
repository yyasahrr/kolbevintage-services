import { HttpStatus, Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // ── هدرهای امنیتی استاندارد ───────────────────────────────────────────
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // HSTS فقط تحت شرایط واقعی HTTPS
    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // عدم کش شدن پاسخ‌های حساس API
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");

    // ── بررسی Content-Type برای متدهای تغییردهنده با بدنه ───────────────────
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "PATCH"].includes(method)) {
      const contentLength = Number(req.headers["content-length"] ?? 0);
      const contentType = String(req.headers["content-type"] ?? "").toLowerCase().trim();

      if (contentLength > 0 && !contentType) {
        res.status(HttpStatus.BAD_REQUEST).json({
          error: "CONTENT_TYPE_REQUIRED",
          message: "هدر Content-Type برای ارسال داده‌ها الزامی است",
        });
        return;
      }

      if (
        contentLength > 0 &&
        !contentType.startsWith("application/json") &&
        !contentType.startsWith("multipart/form-data") &&
        !contentType.startsWith("application/x-www-form-urlencoded")
      ) {
        res.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).json({
          error: "UNSUPPORTED_MEDIA_TYPE",
          message: "فرمت Content-Type پشتیبانی نمی‌شود (فقط application/json یا multipart)",
        });
        return;
      }
    }

    next();
  }
}
