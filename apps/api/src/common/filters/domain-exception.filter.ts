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
  Optional,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorCodes, isDomainError, toPublicError } from "@kolbe/shared";
import { redactSensitive } from "../logging/redaction";
import { ErrorMonitoringService } from "../monitoring/error-monitoring.service";

type ValidationIssue = { property?: string; constraints?: Record<string, string> };

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");
  private readonly errorMonitoring: ErrorMonitoringService;

  /**
   * `@Optional()` اینجا یک ضرورتِ DI است، نه تزئین.
   *
   * این فیلتر با `{ provide: APP_FILTER, useClass: DomainExceptionFilter }` ثبت
   * می‌شود و `ErrorMonitoringService` در هیچ ماژولی provider نشده است. چون
   * `apps/api/tsconfig.json` مقدار `emitDecoratorMetadata: true` دارد، متادیتای
   * `design:paramtypes` منتشر می‌شود و Nest این پارامترِ «اختیاریِ تایپ‌اسکریپتی»
   * را یک وابستگیِ **الزامی** تلقی می‌کند.
   *
   * نتیجهٔ عملی پیش از این اصلاح: بیلدِ کامپایل‌شده (`npm run dev:api` و ایمیجِ
   * Docker که `node dist/main.js` را اجرا می‌کند) اصلاً boot نمی‌شد و با
   * «Nest can't resolve dependencies of the DomainExceptionFilter» شکست می‌خورد؛
   * در حالی که اجرای تست‌ها (که از سورس TS ترانسپایل می‌شوند) این را پنهان
   * می‌کرد. `@Optional()` همان رفتارِ قبلی — ساختِ نمونهٔ محلی در غیابِ provider
   * — را حفظ می‌کند و نیت را به Nest اعلام می‌کند.
   */
  constructor(@Optional() errorMonitoring?: ErrorMonitoringService) {
    this.errorMonitoring = errorMonitoring ?? new ErrorMonitoringService();
  }

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
    } else if (
      exception instanceof SyntaxError &&
      "status" in exception &&
      (exception as any).status === 400 &&
      "body" in exception
    ) {
      status = HttpStatus.BAD_REQUEST;
      error = "MALFORMED_JSON";
      message = "قالب بدنهٔ درخواست نامعتبر است (خطای ساختار JSON)";
    } else if ((exception as any)?.type === "entity.too.large" || (exception as any)?.status === 413) {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      error = "PAYLOAD_TOO_LARGE";
      message = "حجم بدنهٔ درخواست بیش از سقف مجاز است";
    } else if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      status = exception.getStatus();
      // خطاهای اعتبارسنجی class-validator پیام ساخت‌یافته دارند؛ آن‌ها را
      // به یک فهرست فشرده تبدیل می‌کنیم تا کلاینت بتواند فیلد خطادار را نشان دهد.
      if (typeof payload === "object" && payload !== null && "message" in payload) {
        const raw = (payload as { message: unknown }).message;
        if (
          typeof raw === "string" &&
          (raw.toLowerCase().includes("json") || raw.toLowerCase().includes("unexpected token"))
        ) {
          error = "MALFORMED_JSON";
          message = "قالب بدنهٔ درخواست نامعتبر است (خطای ساختار JSON)";
        } else if (Array.isArray(raw)) {
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

    let errorId: string | undefined;
    if (status >= 500) {
      errorId = this.errorMonitoring.captureException(exception, {
        method: request.method,
        path: request.originalUrl,
        requestId,
      });
      // پیام داخلی هرگز به کلاینت نمی‌رود.
      const publicError = toPublicError(exception);
      error = publicError.body.error;
      message = publicError.body.message;
    }

    response.status(status).json({
      error,
      message,
      requestId: requestId ?? null,
      ...(errorId ? { errorId } : {}),
    });
  }
}
