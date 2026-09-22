import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  accountUser,
  supplier,
  wholesaleAccount,
  supportCase,
  supportCaseAssignmentHistory,
  supportCasePriorityHistory,
  supportCaseRelation,
  supportCaseStatusHistory,
  supportMessage,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_REQUESTER_TYPES,
  SUPPORT_SOURCES,
  type SupportCategory,
  type SupportPriority,
  type SupportCaseStatus,
  type SupportRequesterType,
  type SupportSource,
  type SupportAuthorType,
  type SupportRelationType,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  SupportCaseNotFoundError,
  SupportInvalidPriorityTransitionError,
  SupportInvalidStatusTransitionError,
} from "./support.errors";
import crypto from "node:crypto";

export interface CreateCaseInput {
  requesterType: SupportRequesterType;
  requesterUserId?: string | null;
  wholesaleAccountId?: string | null;
  supplierId?: string | null;
  category: SupportCategory;
  subject: string;
  priority?: SupportPriority;
  source?: SupportSource;
  initialMessage?: string;
  relations?: Array<{
    relationType: SupportRelationType;
    targetId: string;
    itemId?: string | null;
    quantity?: number | null;
    metadata?: Record<string, unknown>;
  }>;
}

export interface ListCasesFilter {
  requesterType?: SupportRequesterType;
  requesterUserId?: string;
  wholesaleAccountId?: string;
  supplierId?: string;
  status?: SupportCaseStatus;
  category?: SupportCategory;
  priority?: SupportPriority;
  assignedAdminId?: string;
  assignedTeamKey?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const ALLOWED_STATUS_TRANSITIONS: Record<SupportCaseStatus, SupportCaseStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "WAITING_FOR_INTERNAL", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "WAITING_FOR_INTERNAL", "RESOLVED", "CLOSED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "OPEN", "RESOLVED", "CLOSED"],
  WAITING_FOR_INTERNAL: ["IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "OPEN"],
  CLOSED: ["OPEN"],
};

@Injectable()
export class SupportCaseService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Generates a unique, non-sequential, human-friendly public tracking reference.
   * Format: SUP-XXXXXXXX (8 uppercase alphanumeric characters)
   */
  async generatePublicReference(): Promise<string> {
    for (let attempts = 0; attempts < 10; attempts++) {
      const code = "SUP-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      const existing = await this.db
        .select({ id: supportCase.id })
        .from(supportCase)
        .where(eq(supportCase.publicReference, code))
        .limit(1);
      if (!existing.length) {
        return code;
      }
    }
    // Fallback if collision
    return "SUP-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
  }

  async createCase(input: CreateCaseInput, executor?: any): Promise<typeof supportCase.$inferSelect> {
    const ex = (executor as any) ?? this.db;
    const caseId = `case_${crypto.randomUUID()}`;
    const publicRef = await this.generatePublicReference();
    const priority = input.priority ?? "NORMAL";
    const source = input.source ?? "PORTAL";
    const now = new Date();

    const [created] = await ex
      .insert(supportCase)
      .values({
        id: caseId,
        publicReference: publicRef,
        requesterType: input.requesterType,
        requesterUserId: input.requesterUserId ?? null,
        wholesaleAccountId: input.wholesaleAccountId ?? null,
        supplierId: input.supplierId ?? null,
        category: input.category,
        subject: input.subject.trim(),
        priority,
        status: "OPEN",
        source,
        openedAt: now,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Initial status history entry
    const authorType: SupportAuthorType =
      input.requesterType === "RETAIL_CUSTOMER"
        ? "CUSTOMER"
        : input.requesterType === "ADMIN_CREATED"
          ? "ADMIN"
          : (input.requesterType as SupportAuthorType);

    await ex.insert(supportCaseStatusHistory).values({
      id: `scsh_${crypto.randomUUID()}`,
      caseId,
      fromStatus: "OPEN",
      toStatus: "OPEN",
      actorType: authorType,
      actorId: input.requesterUserId ?? null,
      reason: "Initial case creation",
      source: "PORTAL",
      createdAt: now,
    });

    // Optional initial message
    if (input.initialMessage && input.initialMessage.trim().length > 0) {
      await ex.insert(supportMessage).values({
        id: `smsg_${crypto.randomUUID()}`,
        caseId,
        authorType,
        authorId: input.requesterUserId ?? null,
        authorDisplayName: input.subject,
        body: input.initialMessage.trim(),
        visibility: "PUBLIC",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Optional initial domain relations
    if (input.relations && input.relations.length > 0) {
      for (const rel of input.relations) {
        await ex.insert(supportCaseRelation).values({
          id: `screl_${crypto.randomUUID()}`,
          caseId,
          relationType: rel.relationType,
          targetId: rel.targetId,
          itemId: rel.itemId ?? null,
          quantity: rel.quantity ?? null,
          metadata: (rel.metadata as any) ?? {},
          createdAt: now,
        });
      }
    }

    await this.audit.record(
      {
        action: "support.case.created",
      entityType: "support_case",
      entityId: caseId,
      actorId: input.requesterUserId ?? "system",
      actorRole: input.requesterType,
        metadata: {
          publicReference: publicRef,
          category: input.category,
          priority,
        },
      },
      ex,
    );

    return created;
  }

  async getCaseById(id: string): Promise<typeof supportCase.$inferSelect> {
    const [found] = await this.db
      .select()
      .from(supportCase)
      .where(eq(supportCase.id, id))
      .limit(1);

    if (!found) {
      throw new SupportCaseNotFoundError(id);
    }
    return found;
  }

  async getCaseByPublicReference(publicReference: string): Promise<typeof supportCase.$inferSelect> {
    const [found] = await this.db
      .select()
      .from(supportCase)
      .where(eq(supportCase.publicReference, publicReference.trim().toUpperCase()))
      .limit(1);

    if (!found) {
      throw new SupportCaseNotFoundError(publicReference);
    }
    return found;
  }

  async listCases(filter: ListCasesFilter = {}) {
    const conditions = [];

    if (filter.requesterType) {
      conditions.push(eq(supportCase.requesterType, filter.requesterType));
    }
    if (filter.requesterUserId) {
      conditions.push(eq(supportCase.requesterUserId, filter.requesterUserId));
    }
    if (filter.wholesaleAccountId) {
      conditions.push(eq(supportCase.wholesaleAccountId, filter.wholesaleAccountId));
    }
    if (filter.supplierId) {
      conditions.push(eq(supportCase.supplierId, filter.supplierId));
    }
    if (filter.status) {
      conditions.push(eq(supportCase.status, filter.status));
    }
    if (filter.category) {
      conditions.push(eq(supportCase.category, filter.category));
    }
    if (filter.priority) {
      conditions.push(eq(supportCase.priority, filter.priority));
    }
    if (filter.assignedAdminId) {
      conditions.push(eq(supportCase.assignedAdminId, filter.assignedAdminId));
    }
    if (filter.assignedTeamKey) {
      conditions.push(eq(supportCase.assignedTeamKey, filter.assignedTeamKey));
    }
    if (filter.search && filter.search.trim().length > 0) {
      const term = `%${filter.search.trim()}%`;
      conditions.push(
        or(
          ilike(supportCase.id, term),
          ilike(supportCase.publicReference, term),
          ilike(supportCase.subject, term),
        ),
      );
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    const offset = Math.max(filter.offset ?? 0, 0);

    const [cases, totalRes] = await Promise.all([
      this.db
        .select()
        .from(supportCase)
        .where(whereClause)
        .orderBy(desc(supportCase.lastActivityAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(supportCase)
        .where(whereClause),
    ]);

    return {
      cases,
      total: totalRes[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async transitionStatus(
    caseId: string,
    toStatus: SupportCaseStatus,
    actor: { type: SupportAuthorType; id?: string },
    reason?: string,
    source = "API",
  ): Promise<typeof supportCase.$inferSelect> {
    const existing = await this.getCaseById(caseId);
    const fromStatus = existing.status as SupportCaseStatus;

    if (fromStatus === toStatus) {
      return existing;
    }

    const allowed = ALLOWED_STATUS_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new SupportInvalidStatusTransitionError(fromStatus, toStatus);
    }

    const now = new Date();
    const updates: Partial<typeof supportCase.$inferInsert> = {
      status: toStatus,
      lastActivityAt: now,
      updatedAt: now,
    };

    if (toStatus === "RESOLVED") {
      updates.resolvedAt = now;
    } else if (toStatus === "CLOSED") {
      updates.closedAt = now;
    } else if (toStatus === "OPEN" && (fromStatus === "RESOLVED" || fromStatus === "CLOSED")) {
      updates.reopenedAt = now;
      updates.resolvedAt = null;
      updates.closedAt = null;
    }

    const [updated] = await this.db
      .update(supportCase)
      .set(updates)
      .where(eq(supportCase.id, caseId))
      .returning();

    await this.db.insert(supportCaseStatusHistory).values({
      id: `scsh_${crypto.randomUUID()}`,
      caseId,
      fromStatus,
      toStatus,
      actorType: actor.type,
      actorId: actor.id ?? null,
      reason: reason ?? null,
      source,
      createdAt: now,
    });

    await this.audit.record({
      action: "support.case.status_changed",
      entityType: "support_case",
      entityId: caseId,
      actorId: actor.id ?? "system",
      actorRole: actor.type,
      before: { status: fromStatus },
      after: { status: toStatus },
      metadata: { reason, source },
    });

    return updated;
  }

  async changePriority(
    caseId: string,
    toPriority: SupportPriority,
    changedByAdminId: string,
    reason?: string,
  ): Promise<typeof supportCase.$inferSelect> {
    const existing = await this.getCaseById(caseId);
    const fromPriority = existing.priority as SupportPriority;

    if (fromPriority === toPriority) {
      return existing;
    }

    if (!SUPPORT_PRIORITIES.includes(toPriority)) {
      throw new SupportInvalidPriorityTransitionError(fromPriority, toPriority);
    }

    const now = new Date();
    const [updated] = await this.db
      .update(supportCase)
      .set({
        priority: toPriority,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(supportCase.id, caseId))
      .returning();

    await this.db.insert(supportCasePriorityHistory).values({
      id: `scph_${crypto.randomUUID()}`,
      caseId,
      fromPriority,
      toPriority,
      changedByAdminId,
      reason: reason ?? null,
      createdAt: now,
    });

    await this.audit.record({
      action: "support.case.priority_changed",
      entityType: "support_case",
      entityId: caseId,
      actorId: changedByAdminId,
      actorRole: "admin",
      before: { priority: fromPriority },
      after: { priority: toPriority },
      metadata: { reason },
    });

    return updated;
  }

  async assignCase(
    caseId: string,
    toAdminId: string | null,
    toTeamKey: string | null,
    assignedByAdminId: string,
    reason?: string,
  ): Promise<typeof supportCase.$inferSelect> {
    const existing = await this.getCaseById(caseId);
    const now = new Date();

    const [updated] = await this.db
      .update(supportCase)
      .set({
        assignedAdminId: toAdminId,
        assignedTeamKey: toTeamKey,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(supportCase.id, caseId))
      .returning();

    await this.db.insert(supportCaseAssignmentHistory).values({
      id: `scah_${crypto.randomUUID()}`,
      caseId,
      fromAdminId: existing.assignedAdminId,
      toAdminId,
      fromTeamKey: existing.assignedTeamKey,
      toTeamKey,
      assignedByAdminId,
      reason: reason ?? null,
      createdAt: now,
    });

    await this.audit.record({
      action: "support.case.assigned",
      entityType: "support_case",
      entityId: caseId,
      actorId: assignedByAdminId,
      actorRole: "admin",
      before: { assignedAdminId: existing.assignedAdminId, assignedTeamKey: existing.assignedTeamKey },
      after: { assignedAdminId: toAdminId, assignedTeamKey: toTeamKey },
      metadata: { reason },
    });

    return updated;
  }

  async addRelation(
    caseId: string,
    relation: {
      relationType: SupportRelationType;
      targetId: string;
      itemId?: string | null;
      quantity?: number | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<typeof supportCaseRelation.$inferSelect> {
    await this.getCaseById(caseId); // Asserts case exists

    const [rel] = await this.db
      .insert(supportCaseRelation)
      .values({
        id: `screl_${crypto.randomUUID()}`,
        caseId,
        relationType: relation.relationType,
        targetId: relation.targetId,
        itemId: relation.itemId ?? null,
        quantity: relation.quantity ?? null,
        metadata: (relation.metadata as any) ?? {},
        createdAt: new Date(),
      })
      .returning();

    return rel;
  }

  async getCaseRelations(caseId: string): Promise<Array<typeof supportCaseRelation.$inferSelect>> {
    return this.db
      .select()
      .from(supportCaseRelation)
      .where(eq(supportCaseRelation.caseId, caseId))
      .orderBy(desc(supportCaseRelation.createdAt));
  }

  async getCaseStatusHistory(caseId: string): Promise<Array<typeof supportCaseStatusHistory.$inferSelect>> {
    return this.db
      .select()
      .from(supportCaseStatusHistory)
      .where(eq(supportCaseStatusHistory.caseId, caseId))
      .orderBy(desc(supportCaseStatusHistory.createdAt));
  }

  async getCasePriorityHistory(caseId: string): Promise<Array<typeof supportCasePriorityHistory.$inferSelect>> {
    return this.db
      .select()
      .from(supportCasePriorityHistory)
      .where(eq(supportCasePriorityHistory.caseId, caseId))
      .orderBy(desc(supportCasePriorityHistory.createdAt));
  }

  async getCaseAssignmentHistory(caseId: string): Promise<Array<typeof supportCaseAssignmentHistory.$inferSelect>> {
    return this.db
      .select()
      .from(supportCaseAssignmentHistory)
      .where(eq(supportCaseAssignmentHistory.caseId, caseId))
      .orderBy(desc(supportCaseAssignmentHistory.createdAt));
  }
}
