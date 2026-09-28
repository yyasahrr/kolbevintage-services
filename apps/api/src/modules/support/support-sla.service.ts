import { Injectable, Inject } from "@nestjs/common";
import { eq, and, desc, asc, isNull, sql } from "drizzle-orm";
import {
  supportCase,
  supportSlaPolicy,
  supportCaseSla,
  supportCaseEscalationHistory,
  supportCasePriorityHistory,
  supportCaseAssignmentHistory,
  type SupportPriority,
  type SupportRequesterType,
  type SupportCategory,
  type SupportEscalationSource,
  type SupportTeam,
  SUPPORT_PRIORITIES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  SupportCaseNotFoundError,
  SupportInvalidPriorityTransitionError,
  SupportSlaPolicyNotFoundError,
} from "./support.errors";
import crypto from "node:crypto";

export interface CreateSlaPolicyInput {
  policyCode: string;
  name: string;
  requesterType?: SupportRequesterType | null;
  category?: SupportCategory | null;
  priority: SupportPriority;
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
  isActive?: boolean;
}

export interface EscalateCaseInput {
  reason: string;
  source: SupportEscalationSource;
  newPriority: SupportPriority;
  toTeamKey?: SupportTeam | null;
  actorAdminId: string;
}

export interface CaseSlaEvaluation {
  caseId: string;
  policyId: string | null;
  policyVersion: number;
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  isFirstResponseBreached: boolean;
  isResolutionBreached: boolean;
  firstResponseMinutesTaken: number | null;
  resolutionMinutesTaken: number | null;
}

@Injectable()
export class SupportSlaService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Registers a new versioned SLA policy.
   */
  async createPolicy(input: CreateSlaPolicyInput) {
    const now = new Date();
    const policyId = `sla_${crypto.randomUUID()}`;

    // Get highest version for this policy code
    const existing = await this.db
      .select({ version: supportSlaPolicy.version })
      .from(supportSlaPolicy)
      .where(eq(supportSlaPolicy.policyCode, input.policyCode))
      .orderBy(desc(supportSlaPolicy.version))
      .limit(1);

    const version = existing.length > 0 ? existing[0].version + 1 : 1;

    const [created] = await this.db
      .insert(supportSlaPolicy)
      .values({
        id: policyId,
        version,
        policyCode: input.policyCode,
        name: input.name,
        requesterType: input.requesterType ?? null,
        category: input.category ?? null,
        priority: input.priority,
        firstResponseTargetMinutes: input.firstResponseTargetMinutes,
        resolutionTargetMinutes: input.resolutionTargetMinutes,
        isActive: input.isActive ?? true,
        createdAt: now,
      })
      .returning();

    return created;
  }

  /**
   * Lists SLA policies.
   */
  async listPolicies(activeOnly = true) {
    if (activeOnly) {
      return this.db
        .select()
        .from(supportSlaPolicy)
        .where(eq(supportSlaPolicy.isActive, true))
        .orderBy(asc(supportSlaPolicy.policyCode), desc(supportSlaPolicy.version));
    }
    return this.db
      .select()
      .from(supportSlaPolicy)
      .orderBy(asc(supportSlaPolicy.policyCode), desc(supportSlaPolicy.version));
  }

  /**
   * Matches the best active policy for given case attributes.
   * Fallback priority hierarchy:
   * 1. Exact match (requesterType + category + priority)
   * 2. Category + priority
   * 3. Requester + priority
   * 4. Priority fallback
   */
  async matchPolicy(
    requesterType: SupportRequesterType,
    category: SupportCategory,
    priority: SupportPriority,
  ): Promise<typeof supportSlaPolicy.$inferSelect | null> {
    const activePolicies = await this.db
      .select()
      .from(supportSlaPolicy)
      .where(and(eq(supportSlaPolicy.isActive, true), eq(supportSlaPolicy.priority, priority)))
      .orderBy(desc(supportSlaPolicy.version));

    // 1. Exact match
    const exact = activePolicies.find(
      (p) => p.requesterType === requesterType && p.category === category,
    );
    if (exact) return exact;

    // 2. Category + priority
    const categoryMatch = activePolicies.find(
      (p) => p.category === category && p.requesterType === null,
    );
    if (categoryMatch) return categoryMatch;

    // 3. Requester + priority
    const requesterMatch = activePolicies.find(
      (p) => p.requesterType === requesterType && p.category === null,
    );
    if (requesterMatch) return requesterMatch;

    // 4. Priority fallback
    const priorityFallback = activePolicies.find(
      (p) => p.requesterType === null && p.category === null,
    );
    if (priorityFallback) return priorityFallback;

    // Any match with same priority
    return activePolicies[0] ?? null;
  }

  /**
   * Snapshots SLA targets for a case into support_case_sla.
   * Invariant: Immutable case targets snapshot — never overwrites if already present.
   */
  async applySlaToCase(caseId: string, customPolicyId?: string) {
    // 1. Check if SLA target already snapshotted
    const [existingSla] = await this.db
      .select()
      .from(supportCaseSla)
      .where(eq(supportCaseSla.caseId, caseId));
    if (existingSla) {
      return existingSla;
    }

    // 2. Fetch case
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(caseId);
    }

    let policy: typeof supportSlaPolicy.$inferSelect | null = null;
    if (customPolicyId) {
      const [custom] = await this.db
        .select()
        .from(supportSlaPolicy)
        .where(eq(supportSlaPolicy.id, customPolicyId));
      policy = custom ?? null;
    }

    if (!policy) {
      policy = await this.matchPolicy(
        c.requesterType as SupportRequesterType,
        c.category as SupportCategory,
        c.priority as SupportPriority,
      );
    }

    // Default target minutes if no matching policy exists
    const firstResponseTargetMinutes = policy?.firstResponseTargetMinutes ?? 120; // 2 hours
    const resolutionTargetMinutes = policy?.resolutionTargetMinutes ?? 1440; // 24 hours
    const policyVersion = policy?.version ?? 1;

    const baseTime = c.openedAt.getTime();
    const firstResponseDueAt = new Date(baseTime + firstResponseTargetMinutes * 60 * 1000);
    const resolutionDueAt = new Date(baseTime + resolutionTargetMinutes * 60 * 1000);

    const now = new Date();
    const [created] = await this.db
      .insert(supportCaseSla)
      .values({
        id: `csla_${crypto.randomUUID()}`,
        caseId,
        policyId: policy?.id ?? null,
        policyVersion,
        firstResponseTargetMinutes,
        resolutionTargetMinutes,
        firstResponseDueAt,
        resolutionDueAt,
        firstResponseAt: c.firstResponseAt ?? null,
        resolvedAt: c.resolvedAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return created;
  }

  /**
   * Records agent first response time and checks SLA compliance.
   */
  async recordFirstResponse(caseId: string, responseAt = new Date()) {
    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) throw new SupportCaseNotFoundError(caseId);

    // If first response was already recorded, preserve original
    if (c.firstResponseAt) return;

    await this.db
      .update(supportCase)
      .set({ firstResponseAt: responseAt, updatedAt: responseAt })
      .where(eq(supportCase.id, caseId));

    await this.db
      .update(supportCaseSla)
      .set({ firstResponseAt: responseAt, updatedAt: responseAt })
      .where(eq(supportCaseSla.caseId, caseId));
  }

  /**
   * Records resolution time and checks SLA compliance.
   */
  async recordResolution(caseId: string, resolvedAt = new Date()) {
    await this.db
      .update(supportCaseSla)
      .set({ resolvedAt, updatedAt: resolvedAt })
      .where(eq(supportCaseSla.caseId, caseId));
  }

  /**
   * Evaluates real-time SLA metrics and breach status for a case.
   */
  async evaluateCaseSla(caseId: string): Promise<CaseSlaEvaluation> {
    const [sla] = await this.db
      .select()
      .from(supportCaseSla)
      .where(eq(supportCaseSla.caseId, caseId));

    const targetSla = sla ?? (await this.applySlaToCase(caseId));

    const now = new Date();
    const firstResponseBreached = targetSla.firstResponseAt
      ? targetSla.firstResponseAt.getTime() > targetSla.firstResponseDueAt.getTime()
      : now.getTime() > targetSla.firstResponseDueAt.getTime();

    const resolutionBreached = targetSla.resolvedAt
      ? targetSla.resolvedAt.getTime() > targetSla.resolutionDueAt.getTime()
      : now.getTime() > targetSla.resolutionDueAt.getTime();

    const firstResponseMinutesTaken = targetSla.firstResponseAt
      ? Math.round((targetSla.firstResponseAt.getTime() - targetSla.createdAt.getTime()) / (60 * 1000))
      : null;

    const resolutionMinutesTaken = targetSla.resolvedAt
      ? Math.round((targetSla.resolvedAt.getTime() - targetSla.createdAt.getTime()) / (60 * 1000))
      : null;

    return {
      caseId: targetSla.caseId,
      policyId: targetSla.policyId,
      policyVersion: targetSla.policyVersion,
      firstResponseTargetMinutes: targetSla.firstResponseTargetMinutes,
      resolutionTargetMinutes: targetSla.resolutionTargetMinutes,
      firstResponseDueAt: targetSla.firstResponseDueAt,
      resolutionDueAt: targetSla.resolutionDueAt,
      firstResponseAt: targetSla.firstResponseAt,
      resolvedAt: targetSla.resolvedAt,
      isFirstResponseBreached: firstResponseBreached,
      isResolutionBreached: resolutionBreached,
      firstResponseMinutesTaken,
      resolutionMinutesTaken,
    };
  }

  /**
   * Escalates a case: bumps priority, optionally reassigns team, and records immutable history.
   */
  async escalateCase(caseId: string, input: EscalateCaseInput) {
    if (!SUPPORT_PRIORITIES.includes(input.newPriority)) {
      throw new SupportInvalidPriorityTransitionError("UNKNOWN", input.newPriority);
    }

    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, caseId));
    if (!c) throw new SupportCaseNotFoundError(caseId);

    const now = new Date();
    const fromPriority = c.priority;
    const fromTeamKey = c.assignedTeamKey;
    const toTeamKey = input.toTeamKey ?? fromTeamKey;

    // 1. Update case priority & team
    const [updatedCase] = await this.db
      .update(supportCase)
      .set({
        priority: input.newPriority,
        assignedTeamKey: toTeamKey,
        updatedAt: now,
      })
      .where(eq(supportCase.id, caseId))
      .returning();

    // 2. Insert priority history
    await this.db.insert(supportCasePriorityHistory).values({
      id: `scph_${crypto.randomUUID()}`,
      caseId,
      fromPriority,
      toPriority: input.newPriority,
      changedByAdminId: input.actorAdminId,
      reason: `Escalation: ${input.reason}`,
      createdAt: now,
    });

    // 3. If team changed, insert assignment history
    if (toTeamKey !== fromTeamKey && input.actorAdminId) {
      await this.db.insert(supportCaseAssignmentHistory).values({
        id: `scah_${crypto.randomUUID()}`,
        caseId,
        fromAdminId: c.assignedAdminId,
        toAdminId: c.assignedAdminId,
        fromTeamKey,
        toTeamKey,
        assignedByAdminId: input.actorAdminId,
        reason: `Escalation team routing: ${input.reason}`,
        createdAt: now,
      });
    }

    // 4. Insert escalation history
    const [escalation] = await this.db
      .insert(supportCaseEscalationHistory)
      .values({
        id: `sceh_${crypto.randomUUID()}`,
        caseId,
        reason: input.reason,
        source: input.source,
        fromPriority,
        toPriority: input.newPriority,
        fromTeamKey,
        toTeamKey,
        actorAdminId: input.actorAdminId,
        createdAt: now,
      })
      .returning();

    // 5. Audit log
    await this.audit.record({
      action: "support.case.escalated",
      entityType: "support_case",
      entityId: caseId,
      actorId: input.actorAdminId,
      actorRole: "admin",
      metadata: {
        fromPriority,
        toPriority: input.newPriority,
        source: input.source,
        reason: input.reason,
      },
    });

    return {
      case: updatedCase,
      escalation,
    };
  }

  /**
   * Retrieves escalation history for a case.
   */
  async getCaseEscalations(caseId: string) {
    return this.db
      .select()
      .from(supportCaseEscalationHistory)
      .where(eq(supportCaseEscalationHistory.caseId, caseId))
      .orderBy(desc(supportCaseEscalationHistory.createdAt));
  }
}
