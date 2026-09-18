import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

/**
 * ماژول حسابرسی.
 *
 * وضعیت: **live** — اولین ماژولی که در NestJS پیاده شده است، چون همهٔ ماژول‌های
 * بعدی به آن وابسته‌اند (هر تغییر مدیر باید حسابرسی شود). جدول `audit_log` را
 * مالک است و `AuditService` را export می‌کند.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
