/**
 * Phase 5.7-B — maker/checker execution for publish/pause.
 *
 * High-impact transitions run through the shared Admin approval framework
 * (PROMOTION_PUBLISH / PROMOTION_PAUSE), following the PRODUCTION_RECALL
 * precedent: the shared row enforces maker/checker separation and the audit
 * trail, while the domain performs its own transition. There is no direct
 * HTTP path to publish or pause anymore — these request/execute methods are
 * the only route (the scheduler's internal publish is unaffected).
 *
 * Fail-closed bindings:
 * - Duplicate pending/decided-but-unexecuted requests are rejected.
 * - Publish execution re-asserts the exact terms hash captured at request
 *   time: a draft edited after the maker's request cannot be published under
 *   the stale approval.
 * - Execution binds to the deciding checker (no hand-off to a third admin).
 * - Races resolve through the domain guards (DRAFT-only publish,
 *   ACTIVE-only pause): exactly one execution can take effect.
 */

import { Inject, Injectable } from "@nestjs/common";
import { AdminApprovalsService } from "../admin/admin-approvals.service";
import { PromotionService } from "./promotion.service";
import {
  parseIdempotencyKey,
  parseOptionalText,
  PromotionDomainError,
} from "./promotions.logic";

export type RequestPublishInput = {
  revisionId: unknown;
  makerNotes?: unknown;
  idempotencyKey: unknown;
};

export type RequestPauseInput = {
  promotionId: unknown;
  makerNotes?: unknown;
  idempotencyKey: unknown;
};

const PUBLISH_TYPE = "PROMOTION_PUBLISH";
const PAUSE_TYPE = "PROMOTION_PAUSE";

@Injectable()
export class PromotionApprovalService {
  constructor(
    @Inject(PromotionService) private readonly promotions: PromotionService,
    @Inject(AdminApprovalsService) private readonly approvals: AdminApprovalsService,
  ) {}

  async requestPublish(makerId: string, input: RequestPublishInput) {
    const revisionId = parseOptionalText(input.revisionId, "revision_id", 160);
    if (!revisionId) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", "revision_id is required");
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const makerNotes = input.makerNotes === undefined || input.makerNotes === null || input.makerNotes === ""
      ? undefined
      : parseOptionalText(input.makerNotes, "maker_notes", 3000) ?? undefined;

    const revision = await this.promotions.getRevision(revisionId);
    if (revision.status !== "DRAFT") {
      throw new PromotionDomainError("PROMOTION_APPROVAL_STATE", `Only DRAFT revisions can be submitted for publish (is ${revision.status})`, 409);
    }
    await this.assertNoOpenRequest(PUBLISH_TYPE, revisionId);
    const promotion = await this.promotions.getPromotion(revision.promotionId);

    return this.approvals.createApprovalRequest(
      {
        requestType: PUBLISH_TYPE,
        targetType: "promotion_revision",
        targetId: revisionId,
        payload: {
          promotionId: revision.promotionId,
          promotionCode: promotion.code,
          revisionNumber: revision.revisionNumber,
          // Fail-closed binding: execution re-asserts these exact terms.
          termsHash: revision.termsHash,
        },
        makerNotes,
        idempotencyKey,
      },
      makerId,
    );
  }

  async requestPause(makerId: string, input: RequestPauseInput) {
    const promotionId = parseOptionalText(input.promotionId, "promotion_id", 160);
    if (!promotionId) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", "promotion_id is required");
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const makerNotes = input.makerNotes === undefined || input.makerNotes === null || input.makerNotes === ""
      ? undefined
      : parseOptionalText(input.makerNotes, "maker_notes", 3000) ?? undefined;

    const promotion = await this.promotions.getPromotion(promotionId);
    if (promotion.status !== "ACTIVE") {
      throw new PromotionDomainError("PROMOTION_APPROVAL_STATE", `Only ACTIVE promotions can be submitted for pause (is ${promotion.status})`, 409);
    }
    await this.assertNoOpenRequest(PAUSE_TYPE, promotionId);

    return this.approvals.createApprovalRequest(
      {
        requestType: PAUSE_TYPE,
        targetType: "promotion",
        targetId: promotionId,
        payload: { promotionId, promotionCode: promotion.code },
        makerNotes,
        idempotencyKey,
      },
      makerId,
    );
  }

  async executeApprovedPublish(requestId: string, checkerId: string) {
    const approval = await this.loadExecutableApproval(requestId, PUBLISH_TYPE, checkerId);
    const payload = (approval.payload || {}) as Record<string, unknown>;
    const revisionId = approval.targetId;

    const revision = await this.promotions.getRevision(revisionId);
    if (revision.status !== "DRAFT") {
      throw new PromotionDomainError("PROMOTION_APPROVAL_STATE", `Revision is no longer publishable (is ${revision.status})`, 409);
    }
    if (typeof payload.termsHash !== "string" || payload.termsHash !== revision.termsHash) {
      throw new PromotionDomainError(
        "PROMOTION_APPROVAL_TERMS_CHANGED",
        "Revision terms changed after the approval request; re-request publish",
        409,
      );
    }
    if (payload.promotionId !== revision.promotionId) {
      throw new PromotionDomainError("PROMOTION_APPROVAL_STATE", "Approval payload does not match the revision", 409);
    }

    const published = await this.promotions.publishRevision(revisionId, checkerId);
    const completed = await this.approvals.markApprovalExecuted(
      requestId,
      { revisionId, promotionId: revision.promotionId, revisionNumber: revision.revisionNumber, status: published.status },
      checkerId,
    );
    return { approval: completed, revision: published };
  }

  async executeApprovedPause(requestId: string, checkerId: string) {
    const approval = await this.loadExecutableApproval(requestId, PAUSE_TYPE, checkerId);
    const promotionId = approval.targetId;
    const payload = (approval.payload || {}) as Record<string, unknown>;
    if (payload.promotionId !== promotionId) {
      throw new PromotionDomainError("PROMOTION_APPROVAL_STATE", "Approval payload does not match the promotion", 409);
    }

    // ACTIVE-only guard lives in pause(): races fail closed here.
    const paused = await this.promotions.pause(promotionId, checkerId);
    const completed = await this.approvals.markApprovalExecuted(
      requestId,
      { promotionId, status: paused.status },
      checkerId,
    );
    return { approval: completed, promotion: paused };
  }

  private async loadExecutableApproval(requestId: string, requestType: string, checkerId: string) {
    const id = parseOptionalText(requestId, "request_id", 160);
    if (!id) throw new PromotionDomainError("PROMOTION_INPUT_INVALID", "request_id is required");
    const approval = await this.approvals.getApprovalRequest(id);
    if (!approval) throw new PromotionDomainError("PROMOTION_APPROVAL_NOT_FOUND", `Approval request ${id} not found`, 404);
    if (approval.requestType !== requestType) {
      throw new PromotionDomainError("PROMOTION_APPROVAL_TYPE", `Approval request is ${approval.requestType}, expected ${requestType}`);
    }
    if (!isExecutableStatus(approval.status, approval.executionResult)) {
      throw new PromotionDomainError(
        "PROMOTION_APPROVAL_STATE",
        `Approval request is ${approval.status}; it must be decided before execution`,
        409,
      );
    }
    // Execution binds to the deciding checker: the reviewer who approved the
    // terms performs the transition. No hand-off to a third admin.
    if (!approval.checkerId || approval.checkerId !== checkerId) {
      throw new PromotionDomainError("PROMOTION_APPROVAL_FORBIDDEN", "Only the deciding checker can execute this approval", 403);
    }
    return approval;
  }

  /** Pending, approved, or deferred-executed requests all block a re-request. */
  private async assertNoOpenRequest(requestType: string, targetId: string): Promise<void> {
    for (const status of ["pending", "approved", "executed"] as const) {
      const rows = await this.approvals.listApprovalRequests({ requestType, status, limit: 50 });
      const clash = rows.find((row) => row.targetId === targetId && isOpenStatus(row.status, row.executionResult));
      if (clash) {
        throw new PromotionDomainError(
          "PROMOTION_APPROVAL_DUPLICATE",
          `An open ${requestType} request already exists for this target (${clash.id})`,
          409,
        );
      }
    }
  }
}

/** Decided (or decision-finalized) but domain transition not yet recorded. */
function isExecutableStatus(status: string, executionResult: unknown): boolean {
  if (status === "approved") return true;
  return isDeferredExecuted(status, executionResult);
}

function isOpenStatus(status: string, executionResult: unknown): boolean {
  if (status === "pending" || status === "approved") return true;
  return isDeferredExecuted(status, executionResult);
}

/** Generic decide with autoExecute=true finalizes the decision but performs no
 * domain effect; the `deferredTo` marker tells the domain work is pending. */
function isDeferredExecuted(status: string, executionResult: unknown): boolean {
  if (status !== "executed") return false;
  const payload = (executionResult || {}) as Record<string, unknown>;
  return typeof payload.deferredTo === "string";
}
