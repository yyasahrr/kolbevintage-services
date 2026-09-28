/**
 * ماژول audit — مالک جدول `audit_log`.
 *
 * قاعده‌های A2/A3/A13/A17:
 *  - این جدول فقط مالکیت این ماژول است؛ هیچ ماژول دیگری نباید مستقیم در آن بنویسد.
 *  - ثبت رکورد حسابرسی **در همان تراکنش** تغییر دامنه انجام می‌شود؛ پس اگر تغییر
 *    rollback شد، رکورد حسابرسی هم ثبت نمی‌شود (و برعکس). برای همین API این سرویس
 *    یک `tx` می‌گیرد، نه اینکه خودش تراکنش باز کند.
 *  - فقط-افزودنی بودن در سطح دیتابیس با تریگر تضمین شده است؛ این سرویس حتی
 *    متدی برای UPDATE/DELETE ندارد.
 */

import { Inject, Injectable } from "@nestjs/common";
import { auditLog, type KolbeDatabase } from "@kolbe/database";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { KOLBE_DB } from "../../database/database.module";
import { redactSensitive } from "../../common/logging/redaction";

export type AuditEntry = {
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  requestId?: string | null;
  actorIp?: string | null;
};

export type AuditLogRow = typeof auditLog.$inferSelect;

/** شناسهٔ حسابرسی — پیشوند معنادار برای دیباگ انسانی. */
function auditId(): string {
  return `aud_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

@Injectable()
export class AuditService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  /**
   * ثبت رکورد حسابرسی.
   *
   * `executor` می‌تواند یک تراکنش باشد (`tx`) تا نوشتن اتمیک شود. اگر ماژولی
   * تراکنش فعالی ندارد، همان `db` را پاس می‌دهد و درج مستقل انجام می‌شود.
   */
  async record(
    entry: AuditEntry,
    executor: KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0] = this.db,
  ): Promise<string> {
    const id = auditId();
    await (executor as KolbeDatabase).insert(auditLog).values({
      id,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      actorIp: entry.actorIp ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before == null ? null : redactSensitive(entry.before),
      after: entry.after == null ? null : redactSensitive(entry.after),
      metadata: entry.metadata == null ? null : redactSensitive(entry.metadata),
      requestId: entry.requestId ?? null,
    });
    return id;
  }

  /** خواندن رکوردهای حسابرسی یک موجودیت (برای صفحهٔ «تاریخ تغییرات» مدیر). */
  async listForEntity(entityType: string, entityId: string, limit = 50): Promise<AuditLogRow[]> {
    return this.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(limit, 200));
  }

  /** آخرین رکوردهای حسابرسی، با فیلترهای اختیاری. */
  async list(filters: { entityType?: string; actorId?: string; action?: string }, limit = 50): Promise<AuditLogRow[]> {
    const conditions: SQL[] = [];
    if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
    if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));
    if (filters.action) conditions.push(eq(auditLog.action, filters.action));

    return this.db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(limit, 200));
  }
}
