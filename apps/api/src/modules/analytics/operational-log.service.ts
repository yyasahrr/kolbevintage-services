import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { systemLog } from "@kolbe/database";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class OperationalLogService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, private readonly audit: AuditService) {}
  async list(query: Record<string, string | undefined>) {
    const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
    const limit = Math.max(10, Math.min(100, Number(query.limit) || 50));
    const conditions: any[] = [];
    if (query.level && query.level !== "all") conditions.push(eq(systemLog.level, query.level));
    if (query.source && query.source !== "all") conditions.push(eq(systemLog.source, query.source));
    if (query.status && query.status !== "all") conditions.push(eq(systemLog.status, query.status));
    if (query.q?.trim()) { const q = `%${query.q.trim().slice(0, 160)}%`; conditions.push(or(ilike(systemLog.message, q), ilike(systemLog.eventType, q), ilike(systemLog.path, q))); }
    const rangeMs = query.range === "30d" ? 30 * 86400000 : query.range === "7d" ? 7 * 86400000 : query.range === "all" ? null : 86400000;
    if (rangeMs) conditions.push(gte(systemLog.lastSeenAt, new Date(Date.now() - rangeMs)));
    const where = conditions.length ? and(...conditions) : undefined;
    const [logs, totals, summaryResult] = await Promise.all([
      this.db.select().from(systemLog).where(where).orderBy(desc(systemLog.lastSeenAt)).limit(limit).offset((page - 1) * limit),
      this.db.select({ value: count() }).from(systemLog).where(where),
      this.db.execute(sql`SELECT coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level IN ('error','critical')),0) open_errors, coalesce(sum(occurrence_count) FILTER (WHERE status='open' AND level='critical'),0) critical_open, coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level IN ('error','critical')),0) errors_24h, coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND source='frontend'),0) frontend_24h, coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND level='warning'),0) warnings_24h, coalesce(sum(occurrence_count) FILTER (WHERE last_seen_at>=now()-interval '24 hours' AND event_type='api.slow'),0) slow_24h FROM system_log`),
    ]);
    const s = (summaryResult as any).rows?.[0] ?? {};
    const total = Number(totals[0]?.value ?? 0);
    return { logs, pagination: { page, limit, total, pageCount: Math.max(1, Math.ceil(total / limit)), capped: false }, summary: { openErrors: Number(s.open_errors ?? 0), criticalOpen: Number(s.critical_open ?? 0), errors24h: Number(s.errors_24h ?? 0), frontend24h: Number(s.frontend_24h ?? 0), warnings24h: Number(s.warnings_24h ?? 0), slow24h: Number(s.slow_24h ?? 0) } };
  }
  async resolve(id: string, input: any, actorId: string) {
    const status = String(input.status ?? "resolved");
    if (!["open", "resolved", "ignored"].includes(status)) throw new DomainError(422, "INVALID_LOG_STATUS", "وضعیت رخداد نامعتبر است");
    const [before] = await this.db.select().from(systemLog).where(eq(systemLog.id, id)).limit(1);
    if (!before) throw new DomainError(404, "OPERATIONAL_LOG_NOT_FOUND", "رخداد یافت نشد");
    const [updated] = await this.db.update(systemLog).set({ status, resolvedAt: status === "open" ? null : new Date(), resolvedBy: status === "open" ? null : actorId, resolutionNote: String(input.note ?? "").trim().slice(0, 1000) || null, updatedAt: new Date() }).where(eq(systemLog.id, id)).returning();
    await this.audit.record({ actorId, actorRole: "admin", action: "operational_log.status_changed", entityType: "system_log", entityId: id, before: { status: before.status }, after: { status } });
    return { log: updated };
  }
}
