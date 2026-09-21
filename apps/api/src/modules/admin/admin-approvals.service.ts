import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  approvalRequest,
  accountUser,
  APPROVAL_REQUEST_TYPES,
  APPROVAL_REQUEST_STATUSES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { WholesalePlanService } from "../vip/wholesale-plan.service";
import { WholesaleMembershipService } from "../vip/wholesale-membership.service";
import { BusinessSettingsService } from "./business-settings.service";
import {
  ApprovalExecutionError,
  ApprovalRequestStateError,
  TwoPersonRuleViolationError,
} from "./admin.errors";

export interface CreateApprovalRequestInput {
  requestType: (typeof APPROVAL_REQUEST_TYPES)[number];
  targetType: string;
  targetId: string;
  payload: Record<string, any>;
  makerNotes?: string;
  idempotencyKey?: string;
}

@Injectable()
export class AdminApprovalsService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(WholesalePlanService) private readonly planService: WholesalePlanService,
    @Inject(forwardRef(() => WholesaleMembershipService))
    private readonly membershipService: WholesaleMembershipService,
    @Inject(forwardRef(() => BusinessSettingsService))
    private readonly settingsService: BusinessSettingsService,
  ) {}

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  async createApprovalRequest(input: CreateApprovalRequestInput, makerId: string) {
    const id = this.makeId("appr");
    const idempotencyKey = input.idempotencyKey || `idem_${id}`;

    // Check idempotency
    const [existing] = await this.db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await this.db
      .insert(approvalRequest)
      .values({
        id,
        requestType: input.requestType,
        targetType: input.targetType,
        targetId: input.targetId,
        makerId,
        status: "pending",
        makerNotes: input.makerNotes,
        payload: input.payload,
        idempotencyKey,
      })
      .returning();

    await this.auditService.record({
      actorId: makerId,
      actorRole: "admin",
      action: "approval_request_created",
      entityType: "approval_request",
      entityId: id,
      metadata: { requestType: input.requestType, targetType: input.targetType, targetId: input.targetId },
    });

    return created;
  }

  async decideApprovalRequest(
    requestId: string,
    decision: "approve" | "reject",
    checkerNotes: string | undefined,
    checkerId: string,
    autoExecute = true,
  ) {
    const [req] = await this.db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .limit(1);

    if (!req) {
      throw new ApprovalRequestStateError(`Approval request '${requestId}' not found`);
    }

    if (req.status !== "pending") {
      throw new ApprovalRequestStateError(
        `Cannot decide approval request in status '${req.status}'. Must be 'pending'.`,
      );
    }

    // MANDATORY TWO-PERSON RULE CHECK
    if (req.makerId === checkerId) {
      throw new TwoPersonRuleViolationError(
        "Two-person rule violation: Maker cannot approve or reject their own approval request",
      );
    }

    if (decision === "reject") {
      const [rejected] = await this.db
        .update(approvalRequest)
        .set({
          status: "rejected",
          checkerId,
          checkerNotes,
          rejectedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(approvalRequest.id, requestId))
        .returning();

      await this.auditService.record({
        actorId: checkerId,
        actorRole: "admin",
        action: "approval_request_rejected",
        entityType: "approval_request",
        entityId: requestId,
        metadata: { checkerNotes },
      });

      return rejected;
    }

    // Decision is "approve"
    const [approved] = await this.db
      .update(approvalRequest)
      .set({
        status: "approved",
        checkerId,
        checkerNotes,
        approvedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(approvalRequest.id, requestId))
      .returning();

    await this.auditService.record({
      actorId: checkerId,
      actorRole: "admin",
      action: "approval_request_approved",
      entityType: "approval_request",
      entityId: requestId,
      metadata: { checkerNotes },
    });

    if (autoExecute) {
      return await this.executeApprovedRequest(requestId, checkerId);
    }

    return approved;
  }

  async executeApprovedRequest(requestId: string, executorId: string) {
    const [req] = await this.db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .limit(1);

    if (!req) {
      throw new ApprovalRequestStateError(`Approval request '${requestId}' not found`);
    }

    if (req.status !== "approved") {
      throw new ApprovalRequestStateError(
        `Cannot execute approval request in status '${req.status}'. Must be 'approved'.`,
      );
    }

    try {
      let executionResult: any = null;
      const payload = (req.payload || {}) as Record<string, any>;

      // Deterministic dispatch based strictly on requestType
      switch (req.requestType) {
        case "PLAN_VERSION_PUBLISH": {
          const planId = req.targetId;
          const versionId = payload.versionId as string;
          if (!versionId) throw new Error("Missing versionId in payload");
          const published = await this.planService.publishPlanVersion(planId, versionId, executorId);
          executionResult = { planId, versionId: published.id, status: published.status };
          break;
        }

        case "MEMBERSHIP_MANUAL_ACTIVATE": {
          const membershipId = req.targetId;
          const durationDays = payload.durationDays as number | undefined;
          const reason = payload.reason as string | undefined;
          const activated = await this.membershipService.activateMembership(membershipId, executorId, {
            durationDays,
            reason: reason || "Activated via approved maker-checker workflow",
          });
          executionResult = { membershipId, status: activated.status, expiresAt: activated.expiresAt };
          break;
        }

        case "MEMBERSHIP_PLAN_CHANGE": {
          const membershipId = req.targetId;
          const targetPlanVersionId = payload.targetPlanVersionId as string;
          const isImmediate = payload.immediate ?? true;
          if (isImmediate) {
            const upgraded = await this.membershipService.upgradeMembership(
              membershipId,
              targetPlanVersionId,
              executorId,
              { reason: "Executed via approval workflow" },
            );
            executionResult = { membershipId, planVersionId: upgraded.planVersionId };
          } else {
            const scheduled = await this.membershipService.schedulePlanChange(
              membershipId,
              targetPlanVersionId,
              executorId,
              { reason: "Scheduled via approval workflow" },
            );
            executionResult = { membershipId, scheduledPlanVersionId: scheduled.scheduledPlanVersionId };
          }
          break;
        }

        case "MEMBERSHIP_TERMINATE": {
          const membershipId = req.targetId;
          const reason = (payload.reason as string) || "Terminated via approval workflow";
          const cancelled = await this.membershipService.cancelMembership(membershipId, reason, executorId);
          executionResult = { membershipId, status: cancelled.status };
          break;
        }

        case "BUSINESS_SETTING_CHANGE": {
          const key = req.targetId;
          const settingInput = payload as any;
          const saved = await this.settingsService.setSetting(
            key,
            settingInput,
            executorId,
          );
          executionResult = { key, version: saved.version };
          break;
        }

        case "PRODUCTION_RECALL": {
          // Production owns recall execution. The shared Admin approval row still
          // enforces maker/checker separation; the Production API performs the
          // domain transition when it calls this service with autoExecute=false.
          executionResult = { deferredTo: "production.recall", targetType: req.targetType, targetId: req.targetId };
          break;
        }

        case "PROMOTION_PUBLISH": {
          // Promotions owns publish execution (same deferred pattern as recalls).
          // The shared Admin approval row enforces maker/checker separation; the
          // Promotions API validates the approved/executed row at publish time.
          executionResult = { deferredTo: "promotions.publish", targetType: req.targetType, targetId: req.targetId };
          break;
        }

        default:
          throw new Error(`Unsupported approval requestType: ${req.requestType}`);
      }

      // Mark executed successfully
      const [executed] = await this.db
        .update(approvalRequest)
        .set({
          status: "executed",
          executedAt: sql`now()`,
          executionResult,
          updatedAt: sql`now()`,
        })
        .where(eq(approvalRequest.id, requestId))
        .returning();

      await this.auditService.record({
        actorId: executorId,
        actorRole: "admin",
        action: "approval_request_executed",
        entityType: "approval_request",
        entityId: requestId,
        metadata: { executionResult },
      });

      return executed;
    } catch (err: any) {
      // Mark failed
      const [failed] = await this.db
        .update(approvalRequest)
        .set({
          status: "failed",
          executionResult: { error: err.message || "Unknown execution error" },
          updatedAt: sql`now()`,
        })
        .where(eq(approvalRequest.id, requestId))
        .returning();

      await this.auditService.record({
        actorId: executorId,
        actorRole: "admin",
        action: "approval_request_execution_failed",
        entityType: "approval_request",
        entityId: requestId,
        metadata: { error: err.message },
      });

      throw new ApprovalExecutionError(`Approval execution failed: ${err.message}`, err);
    }
  }

  async cancelApprovalRequest(requestId: string, reason: string, actorId: string) {
    const [req] = await this.db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .limit(1);

    if (!req) {
      throw new ApprovalRequestStateError(`Approval request '${requestId}' not found`);
    }

    if (req.status !== "pending") {
      throw new ApprovalRequestStateError(
        `Cannot cancel approval request in status '${req.status}'. Only 'pending' can be cancelled.`,
      );
    }

    const [cancelled] = await this.db
      .update(approvalRequest)
      .set({
        status: "cancelled",
        checkerNotes: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(approvalRequest.id, requestId))
      .returning();

    await this.auditService.record({
      actorId,
      actorRole: "admin",
      action: "approval_request_cancelled",
      entityType: "approval_request",
      entityId: requestId,
      metadata: { reason },
    });

    return cancelled;
  }

  async listApprovalRequests(filter?: {
    status?: string;
    requestType?: string;
    makerId?: string;
    checkerId?: string;
    limit?: number;
  }) {
    const conditions = [];
    if (filter?.status) conditions.push(eq(approvalRequest.status, filter.status));
    if (filter?.requestType) conditions.push(eq(approvalRequest.requestType, filter.requestType));
    if (filter?.makerId) conditions.push(eq(approvalRequest.makerId, filter.makerId));
    if (filter?.checkerId) conditions.push(eq(approvalRequest.checkerId, filter.checkerId));

    const query = this.db
      .select({
        id: approvalRequest.id,
        requestType: approvalRequest.requestType,
        targetType: approvalRequest.targetType,
        targetId: approvalRequest.targetId,
        makerId: approvalRequest.makerId,
        makerName: accountUser.displayName,
        checkerId: approvalRequest.checkerId,
        status: approvalRequest.status,
        makerNotes: approvalRequest.makerNotes,
        checkerNotes: approvalRequest.checkerNotes,
        payload: approvalRequest.payload,
        executionResult: approvalRequest.executionResult,
        approvedAt: approvalRequest.approvedAt,
        rejectedAt: approvalRequest.rejectedAt,
        executedAt: approvalRequest.executedAt,
        createdAt: approvalRequest.createdAt,
      })
      .from(approvalRequest)
      .innerJoin(accountUser, eq(accountUser.id, approvalRequest.makerId));

    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(approvalRequest.createdAt)).limit(filter?.limit || 50)
      : await query.orderBy(desc(approvalRequest.createdAt)).limit(filter?.limit || 50);

    return rows;
  }

  async getApprovalRequest(requestId: string) {
    const [row] = await this.db
      .select()
      .from(approvalRequest)
      .where(eq(approvalRequest.id, requestId))
      .limit(1);

    if (!row) return null;

    const [maker] = await this.db
      .select({ id: accountUser.id, displayName: accountUser.displayName, phone: accountUser.phone })
      .from(accountUser)
      .where(eq(accountUser.id, row.makerId))
      .limit(1);

    let checker = null;
    if (row.checkerId) {
      [checker] = await this.db
        .select({ id: accountUser.id, displayName: accountUser.displayName, phone: accountUser.phone })
        .from(accountUser)
        .where(eq(accountUser.id, row.checkerId))
        .limit(1);
    }

    return {
      ...row,
      maker,
      checker,
    };
  }
}
