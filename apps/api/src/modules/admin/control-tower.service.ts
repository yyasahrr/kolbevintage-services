import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  wholesaleAccount,
  wholesaleMembership,
  wholesalePlan,
  wholesaleRequest,
  approvalRequest,
  auditLog,
  accountUser,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";

export interface ControlTowerOverview {
  accounts: {
    pending: number;
    approved: number;
    rejected: number;
    suspended: number;
    expired: number;
    total: number;
  };
  memberships: {
    pending: number;
    active: number;
    suspended: number;
    cancelled: number;
    expired: number;
    total: number;
  };
  approvals: {
    pending: number;
    approved: number;
    rejected: number;
    executed: number;
    failed: number;
    cancelled: number;
    total: number;
  };
  plans: {
    published: number;
    total: number;
  };
  openRequests: number;
  expiringMemberships14Days: number;
  generatedAt: string;
}

@Injectable()
export class ControlTowerService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase) {}

  /**
   * Authoritative metrics strictly aggregated from real database tables.
   * No fabricated or synthetic numbers.
   */
  async getOverview(): Promise<ControlTowerOverview> {
    // 1. Wholesale Accounts breakdown
    const accountCounts = await this.db
      .select({
        status: wholesaleAccount.status,
        count: sql<number>`count(*)::int`,
      })
      .from(wholesaleAccount)
      .groupBy(wholesaleAccount.status);

    const accounts = {
      pending: 0,
      approved: 0,
      rejected: 0,
      suspended: 0,
      expired: 0,
      total: 0,
    };
    for (const row of accountCounts) {
      if (row.status in accounts) {
        accounts[row.status as keyof typeof accounts] = Number(row.count);
      }
      accounts.total += Number(row.count);
    }

    // 2. Memberships breakdown
    const membershipCounts = await this.db
      .select({
        status: wholesaleMembership.status,
        count: sql<number>`count(*)::int`,
      })
      .from(wholesaleMembership)
      .groupBy(wholesaleMembership.status);

    const memberships = {
      pending: 0,
      active: 0,
      suspended: 0,
      cancelled: 0,
      expired: 0,
      total: 0,
    };
    for (const row of membershipCounts) {
      if (row.status in memberships) {
        memberships[row.status as keyof typeof memberships] = Number(row.count);
      }
      memberships.total += Number(row.count);
    }

    // 3. Approval Requests breakdown
    const approvalCounts = await this.db
      .select({
        status: approvalRequest.status,
        count: sql<number>`count(*)::int`,
      })
      .from(approvalRequest)
      .groupBy(approvalRequest.status);

    const approvals = {
      pending: 0,
      approved: 0,
      rejected: 0,
      executed: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    };
    for (const row of approvalCounts) {
      if (row.status in approvals) {
        approvals[row.status as keyof typeof approvals] = Number(row.count);
      }
      approvals.total += Number(row.count);
    }

    // 4. Plans count
    const [plansPublishedRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesalePlan)
      .where(eq(wholesalePlan.status, "active"));

    const [plansTotalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesalePlan);

    // 5. Open wholesale requests
    const [openReqsRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesaleRequest)
      .where(
        or(
          eq(wholesaleRequest.status, "pending"),
          eq(wholesaleRequest.status, "under_review"),
        ),
      );

    // 6. Expiring memberships within next 14 days
    const [expiringRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesaleMembership)
      .where(
        and(
          eq(wholesaleMembership.status, "active"),
          lte(
            wholesaleMembership.expiresAt,
            sql`now() + interval '14 days'`,
          ),
        ),
      );

    return {
      accounts,
      memberships,
      approvals,
      plans: {
        published: Number(plansPublishedRow?.count || 0),
        total: Number(plansTotalRow?.count || 0),
      },
      openRequests: Number(openReqsRow?.count || 0),
      expiringMemberships14Days: Number(expiringRow?.count || 0),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Pending approval requests queue (oldest pending first).
   */
  async getPendingApprovalsQueue(options: { limit?: number; offset?: number }) {
    const limit = Math.min(options.limit || 20, 100);
    const offset = options.offset || 0;

    const rows = await this.db
      .select({
        id: approvalRequest.id,
        requestType: approvalRequest.requestType,
        targetType: approvalRequest.targetType,
        targetId: approvalRequest.targetId,
        makerId: approvalRequest.makerId,
        makerName: accountUser.displayName,
        makerNotes: approvalRequest.makerNotes,
        status: approvalRequest.status,
        payload: approvalRequest.payload,
        createdAt: approvalRequest.createdAt,
      })
      .from(approvalRequest)
      .innerJoin(accountUser, eq(accountUser.id, approvalRequest.makerId))
      .where(eq(approvalRequest.status, "pending"))
      .orderBy(asc(approvalRequest.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalRequest)
      .where(eq(approvalRequest.status, "pending"));

    return {
      items: rows,
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Pending accounts queue needing admin approval.
   */
  async getPendingAccountsQueue(options: { search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(options.limit || 20, 100);
    const offset = options.offset || 0;

    const conditions = [eq(wholesaleAccount.status, "pending")];
    if (options.search) {
      const term = `%${options.search}%`;
      conditions.push(
        or(
          ilike(wholesaleAccount.memberName, term),
          ilike(wholesaleAccount.storeName, term),
          ilike(wholesaleAccount.phone, term),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: wholesaleAccount.id,
        userId: wholesaleAccount.userId,
        memberName: wholesaleAccount.memberName,
        storeName: wholesaleAccount.storeName,
        phone: wholesaleAccount.phone,
        city: wholesaleAccount.city,
        status: wholesaleAccount.status,
        createdAt: wholesaleAccount.createdAt,
      })
      .from(wholesaleAccount)
      .where(and(...conditions))
      .orderBy(asc(wholesaleAccount.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesaleAccount)
      .where(and(...conditions));

    return {
      items: rows,
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Memberships expiring within threshold days or already expired.
   */
  async getExpiringMembershipsQueue(options: { daysThreshold?: number; limit?: number; offset?: number }) {
    const limit = Math.min(options.limit || 20, 100);
    const offset = options.offset || 0;
    const days = options.daysThreshold || 14;

    const rows = await this.db
      .select({
        id: wholesaleMembership.id,
        accountId: wholesaleMembership.accountId,
        memberName: wholesaleAccount.memberName,
        storeName: wholesaleAccount.storeName,
        phone: wholesaleAccount.phone,
        planName: wholesalePlan.name,
        status: wholesaleMembership.status,
        startedAt: wholesaleMembership.startedAt,
        expiresAt: wholesaleMembership.expiresAt,
      })
      .from(wholesaleMembership)
      .innerJoin(wholesaleAccount, eq(wholesaleAccount.id, wholesaleMembership.accountId))
      .innerJoin(wholesalePlan, eq(wholesalePlan.id, wholesaleMembership.planId))
      .where(
        and(
          eq(wholesaleMembership.status, "active"),
          lte(wholesaleMembership.expiresAt, sql`now() + ${days} * interval '1 day'`),
        ),
      )
      .orderBy(asc(wholesaleMembership.expiresAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(wholesaleMembership)
      .where(
        and(
          eq(wholesaleMembership.status, "active"),
          lte(wholesaleMembership.expiresAt, sql`now() + ${days} * interval '1 day'`),
        ),
      );

    return {
      items: rows,
      total: Number(totalRow?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Recent operational activity feed from audit log.
   */
  async getActivityFeed(options: { limit?: number }) {
    const limit = Math.min(options.limit || 25, 100);
    const relevantEntityTypes = [
      "wholesale_plan",
      "wholesale_membership",
      "approval_request",
      "business_setting",
      "admin_role",
      "admin_internal_note",
    ];

    const rows = await this.db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorRole: auditLog.actorRole,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(inArray(auditLog.entityType, relevantEntityTypes))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return rows;
  }

  /**
   * Directory search across wholesale accounts.
   */
  async searchDirectory(query: string, options?: { status?: string; limit?: number }) {
    const limit = Math.min(options?.limit || 20, 50);
    const term = `%${query.trim()}%`;

    const conditions = [
      or(
        ilike(wholesaleAccount.memberName, term),
        ilike(wholesaleAccount.storeName, term),
        ilike(wholesaleAccount.phone, term),
        eq(wholesaleAccount.id, query.trim()),
      )!,
    ];

    if (options?.status) {
      conditions.push(eq(wholesaleAccount.status, options.status));
    }

    return await this.db
      .select({
        id: wholesaleAccount.id,
        userId: wholesaleAccount.userId,
        memberName: wholesaleAccount.memberName,
        storeName: wholesaleAccount.storeName,
        phone: wholesaleAccount.phone,
        city: wholesaleAccount.city,
        status: wholesaleAccount.status,
        planName: wholesaleAccount.planName,
        createdAt: wholesaleAccount.createdAt,
      })
      .from(wholesaleAccount)
      .where(and(...conditions))
      .orderBy(desc(wholesaleAccount.createdAt))
      .limit(limit);
  }
}
