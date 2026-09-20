import { Injectable, Inject } from "@nestjs/common";
import { eq, and, notInArray, inArray, isNull, desc, asc, sql, lt } from "drizzle-orm";
import {
  supportCase,
  supportCaseSla,
  type SupportTeam,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";

export interface QueuePagination {
  limit?: number;
  offset?: number;
}

@Injectable()
export class SupportOperationsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
  ) {}

  /**
   * Unassigned cases waiting for triage.
   */
  async getUnassignedQueue(opts: QueuePagination = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const cases = await this.db
      .select()
      .from(supportCase)
      .where(
        and(
          isNull(supportCase.assignedAdminId),
          inArray(supportCase.status, ["OPEN", "IN_PROGRESS", "WAITING_FOR_INTERNAL"]),
        ),
      )
      .orderBy(desc(supportCase.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportCase)
      .where(
        and(
          isNull(supportCase.assignedAdminId),
          inArray(supportCase.status, ["OPEN", "IN_PROGRESS", "WAITING_FOR_INTERNAL"]),
        ),
      );

    return { cases, total: count };
  }

  /**
   * Cases assigned to a specific admin.
   */
  async getMyQueue(adminId: string, opts: QueuePagination = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const cases = await this.db
      .select()
      .from(supportCase)
      .where(
        and(
          eq(supportCase.assignedAdminId, adminId),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      )
      .orderBy(desc(supportCase.lastActivityAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportCase)
      .where(
        and(
          eq(supportCase.assignedAdminId, adminId),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      );

    return { cases, total: count };
  }

  /**
   * Cases routed to a specific team.
   */
  async getTeamQueue(teamKey: SupportTeam, opts: QueuePagination = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const cases = await this.db
      .select()
      .from(supportCase)
      .where(
        and(
          eq(supportCase.assignedTeamKey, teamKey),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      )
      .orderBy(desc(supportCase.lastActivityAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportCase)
      .where(
        and(
          eq(supportCase.assignedTeamKey, teamKey),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      );

    return { cases, total: count };
  }

  /**
   * High-priority urgent cases queue.
   */
  async getUrgentQueue(opts: QueuePagination = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const cases = await this.db
      .select()
      .from(supportCase)
      .where(
        and(
          eq(supportCase.priority, "URGENT"),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      )
      .orderBy(asc(supportCase.openedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportCase)
      .where(
        and(
          eq(supportCase.priority, "URGENT"),
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
        ),
      );

    return { cases, total: count };
  }

  /**
   * Breached cases queue based on SLA timestamps.
   */
  async getBreachedQueue(opts: QueuePagination = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const now = new Date();

    const casesWithSla = await this.db
      .select({
        case: supportCase,
        sla: supportCaseSla,
      })
      .from(supportCase)
      .innerJoin(supportCaseSla, eq(supportCase.id, supportCaseSla.caseId))
      .where(
        and(
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
          sql`(${supportCaseSla.firstResponseDueAt} < ${now} AND ${supportCaseSla.firstResponseAt} IS NULL)
             OR (${supportCaseSla.resolutionDueAt} < ${now} AND ${supportCaseSla.resolvedAt} IS NULL)`,
        ),
      )
      .orderBy(asc(supportCaseSla.resolutionDueAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportCase)
      .innerJoin(supportCaseSla, eq(supportCase.id, supportCaseSla.caseId))
      .where(
        and(
          notInArray(supportCase.status, ["RESOLVED", "CLOSED"]),
          sql`(${supportCaseSla.firstResponseDueAt} < ${now} AND ${supportCaseSla.firstResponseAt} IS NULL)
             OR (${supportCaseSla.resolutionDueAt} < ${now} AND ${supportCaseSla.resolvedAt} IS NULL)`,
        ),
      );

    return {
      cases: casesWithSla.map((item) => ({
        ...item.case,
        sla: item.sla,
      })),
      total: count,
    };
  }

  /**
   * Support Control Tower factual metrics.
   */
  async getControlTowerMetrics() {
    // 1. Status counts
    const statusCounts = await this.db
      .select({
        status: supportCase.status,
        count: sql<number>`count(*)::int`,
      })
      .from(supportCase)
      .groupBy(supportCase.status);

    const byStatus: Record<string, number> = {};
    let totalCases = 0;
    let activeCases = 0;
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
      totalCases += row.count;
      if (row.status !== "RESOLVED" && row.status !== "CLOSED") {
        activeCases += row.count;
      }
    }

    // 2. Priority counts
    const priorityCounts = await this.db
      .select({
        priority: supportCase.priority,
        count: sql<number>`count(*)::int`,
      })
      .from(supportCase)
      .where(notInArray(supportCase.status, ["RESOLVED", "CLOSED"]))
      .groupBy(supportCase.priority);

    const byPriority: Record<string, number> = {};
    for (const row of priorityCounts) {
      byPriority[row.priority] = row.count;
    }

    // 3. Requester type counts
    const requesterCounts = await this.db
      .select({
        requesterType: supportCase.requesterType,
        count: sql<number>`count(*)::int`,
      })
      .from(supportCase)
      .where(notInArray(supportCase.status, ["RESOLVED", "CLOSED"]))
      .groupBy(supportCase.requesterType);

    const byRequesterType: Record<string, number> = {};
    for (const row of requesterCounts) {
      byRequesterType[row.requesterType] = row.count;
    }

    // 4. Team distribution
    const teamCounts = await this.db
      .select({
        teamKey: supportCase.assignedTeamKey,
        count: sql<number>`count(*)::int`,
      })
      .from(supportCase)
      .where(notInArray(supportCase.status, ["RESOLVED", "CLOSED"]))
      .groupBy(supportCase.assignedTeamKey);

    const byTeam: Record<string, number> = {};
    for (const row of teamCounts) {
      byTeam[row.teamKey ?? "UNASSIGNED"] = row.count;
    }

    // 5. SLA Performance
    const now = new Date();
    const [slaMetrics] = await this.db
      .select({
        totalWithSla: sql<number>`count(*)::int`,
        breachedFirstResponse: sql<number>`count(*) FILTER (
          WHERE (${supportCaseSla.firstResponseAt} > ${supportCaseSla.firstResponseDueAt})
             OR (${supportCaseSla.firstResponseAt} IS NULL AND ${supportCaseSla.firstResponseDueAt} < ${now})
        )::int`,
        breachedResolution: sql<number>`count(*) FILTER (
          WHERE (${supportCaseSla.resolvedAt} > ${supportCaseSla.resolutionDueAt})
             OR (${supportCaseSla.resolvedAt} IS NULL AND ${supportCaseSla.resolutionDueAt} < ${now})
        )::int`,
        avgFirstResponseMinutes: sql<number>`coalesce(avg(
          EXTRACT(EPOCH FROM (${supportCaseSla.firstResponseAt} - ${supportCaseSla.createdAt})) / 60
        ) FILTER (WHERE ${supportCaseSla.firstResponseAt} IS NOT NULL), 0)::float`,
        avgResolutionMinutes: sql<number>`coalesce(avg(
          EXTRACT(EPOCH FROM (${supportCaseSla.resolvedAt} - ${supportCaseSla.createdAt})) / 60
        ) FILTER (WHERE ${supportCaseSla.resolvedAt} IS NOT NULL), 0)::float`,
      })
      .from(supportCaseSla);

    const totalWithSla = slaMetrics?.totalWithSla ?? 0;
    const breachedTotal = Math.max(
      slaMetrics?.breachedFirstResponse ?? 0,
      slaMetrics?.breachedResolution ?? 0,
    );
    const complianceRate =
      totalWithSla > 0
        ? Number((((totalWithSla - breachedTotal) / totalWithSla) * 100).toFixed(2))
        : 100;

    return {
      overview: {
        totalCases,
        activeCases,
        closedOrResolved: totalCases - activeCases,
      },
      byStatus,
      byPriority,
      byRequesterType,
      byTeam,
      slaPerformance: {
        totalWithSla,
        breachedFirstResponse: slaMetrics?.breachedFirstResponse ?? 0,
        breachedResolution: slaMetrics?.breachedResolution ?? 0,
        complianceRate,
        avgFirstResponseMinutes: Math.round(slaMetrics?.avgFirstResponseMinutes ?? 0),
        avgResolutionMinutes: Math.round(slaMetrics?.avgResolutionMinutes ?? 0),
      },
    };
  }
}
