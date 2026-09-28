import { Injectable, Inject } from "@nestjs/common";
import { eq, desc } from "drizzle-orm";
import {
  supportCase,
  supportCaseAction,
  type SupportActionType,
  type SupportActionStatus,
  SUPPORT_ACTION_TYPES,
  SUPPORT_ACTION_STATUSES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  SupportActionInvalidError,
  SupportCaseNotFoundError,
} from "./support.errors";
import crypto from "node:crypto";

export interface RecordCaseActionInput {
  caseId: string;
  actionType: SupportActionType;
  targetDomain: string;
  targetId: string;
  requestedByAdminId: string;
  payload?: Record<string, unknown>;
}

export interface CompleteCaseActionInput {
  status: "EXECUTED" | "REJECTED" | "IN_REVIEW";
  resultingReference?: string | null;
  adminId: string;
}

@Injectable()
export class SupportActionService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Dispatches and records a whitelisted cross-domain resolution action reference.
   * Architecture Invariant: Support never mutates foreign domain tables directly.
   */
  async recordAction(input: RecordCaseActionInput) {
    if (!SUPPORT_ACTION_TYPES.includes(input.actionType)) {
      throw new SupportActionInvalidError(`Action type '${input.actionType}' is not supported`);
    }

    const [c] = await this.db.select().from(supportCase).where(eq(supportCase.id, input.caseId));
    if (!c) {
      throw new SupportCaseNotFoundError(input.caseId);
    }

    const actionId = `scact_${crypto.randomUUID()}`;
    const now = new Date();

    const [created] = await this.db
      .insert(supportCaseAction)
      .values({
        id: actionId,
        caseId: input.caseId,
        actionType: input.actionType,
        targetDomain: input.targetDomain,
        targetId: input.targetId,
        requestedByAdminId: input.requestedByAdminId,
        status: "REQUESTED",
        payload: input.payload ?? {},
        createdAt: now,
      })
      .returning();

    await this.audit.record({
      action: "support.case.action_requested",
      entityType: "support_case_action",
      entityId: actionId,
      actorId: input.requestedByAdminId,
      actorRole: "admin",
      metadata: {
        caseId: input.caseId,
        actionType: input.actionType,
        targetDomain: input.targetDomain,
        targetId: input.targetId,
      },
    });

    return created;
  }

  /**
   * Completes or updates the status of a cross-domain action.
   */
  async completeAction(actionId: string, input: CompleteCaseActionInput) {
    if (!SUPPORT_ACTION_STATUSES.includes(input.status)) {
      throw new SupportActionInvalidError(`Invalid status '${input.status}'`);
    }

    const [action] = await this.db
      .select()
      .from(supportCaseAction)
      .where(eq(supportCaseAction.id, actionId));
    if (!action) {
      throw new SupportActionInvalidError(`Action '${actionId}' was not found`);
    }

    const now = new Date();
    const [updated] = await this.db
      .update(supportCaseAction)
      .set({
        status: input.status,
        resultingReference: input.resultingReference ?? null,
        completedAt: now,
      })
      .where(eq(supportCaseAction.id, actionId))
      .returning();

    await this.audit.record({
      action: "support.case.action_completed",
      entityType: "support_case_action",
      entityId: actionId,
      actorId: input.adminId,
      actorRole: "admin",
      metadata: {
        caseId: action.caseId,
        status: input.status,
        resultingReference: input.resultingReference,
      },
    });

    return updated;
  }

  /**
   * Retrieves all cross-domain actions recorded for a support case.
   */
  async listActionsForCase(caseId: string) {
    return this.db
      .select()
      .from(supportCaseAction)
      .where(eq(supportCaseAction.caseId, caseId))
      .orderBy(desc(supportCaseAction.createdAt));
  }
}
