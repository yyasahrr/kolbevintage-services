/**
 * فیلتر خطای سراسری.
 *
 * قاعدهٔ «قرارداد خطای پایدار»: کلاینت‌ها (از جمله فروشگاه فعلی) روی فیلد `error`
 * تصمیم می‌گیرند و `message` فقط نمایشی است. این فیلتر تضمین می‌کند:
 *   ۱) هر خطای دامنه با کد و وضعیت خودش برگردد؛
 *   ۲) خطاهای ناشناخته به `500 INTERNAL_ERROR` تبدیل شوند؛
 *   ۳) هیچ stack، پیام درایور یا جزئیات SQL به کلاینت نرسد.
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorCodes, isDomainError, toPublicError } from "@kolbe/shared";

type ValidationIssue = { property?: string; constraints?: Record<string, string> };

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = (request as Request & { requestId?: string }).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error: string = ErrorCodes.INTERNAL_ERROR;
    let message = "خطای داخلی سرور";

    if (isDomainError(exception)) {
      status = exception.status;
      error = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      status = exception.getStatus();
      // خطاهای اعتبارسنجی class-validator پیام ساخت‌یافته دارند؛ آن‌ها را
      // به یک فهرست فشرده تبدیل می‌کنیم تا کلاینت بتواند فیلد خطادار را نشان دهد.
      if (typeof payload === "object" && payload !== null && "message" in payload) {
        const raw = (payload as { message: unknown }).message;
        if (Array.isArray(raw)) {
          const issues = raw as (string | ValidationIssue)[];
          const fields = issues.map((issue) =>
            typeof issue === "string"
              ? issue
              : `${issue.property}: ${Object.values(issue.constraints ?? {})[0] ?? "نامعتبر"}`,
          );
          error = ErrorCodes.VALIDATION_FAILED;
          message = fields.join(" | ");
        } else {
          error = String((payload as { error?: string }).error ?? exception.message);
          message = String(raw);
        }
      } else {
        error = exception.message;
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} → ${status} [${requestId ?? "-"}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // پیام داخلی هرگز به کلاینت نمی‌رود.
      const publicError = toPublicError(exception);
      error = publicError.body.error;
      message = publicError.body.message;
    }

    response.status(status).json({ error, message, requestId: requestId ?? null });
  }
}
