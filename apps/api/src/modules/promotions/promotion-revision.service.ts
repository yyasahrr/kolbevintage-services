import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  promotion,
  promotionBenefit,
  promotionRevision,
  promotionTarget,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { AdminApprovalsService } from "../admin/admin-approvals.service";
import type { PromotionActor } from "./promotions.contract";
import { PromotionCodes, PromotionDomainError, PromotionNotFoundError } from "./promotions.errors";
import {
  assertIdempotencyKey,
  assertOneOf,
  assertRevisionTransition,
  assertStackingPolicy,
  hashPromotionTerms,
  makePromotionId,
  normalizeBenefitInput,
  normalizeTargetInput,
  optionalText,
  parseDateInput,
  requireSafeInteger,
  requireText,
  type NormalizedBenefit,
  type NormalizedTarget,
} from "./promotions.logic";
import { PromotionEligibilityService } from "./promotion-eligibility.service";

export type DraftRevisionInput = {
  stackingPolicy?: string;
  priority?: unknown;
  couponRequired?: boolean;
  startsAt?: unknown;
  endsAt?: unknown;
  usageLimitTotal?: unknown;
  usageLimitPerCustomer?: unknown;
  targets?: Array<{
    targetType: string;
    referenceId?: string | null;
    minSubtotal?: unknown;
    minQuantity?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
  }>;
  benefits?: Array<{ benefitType: string; scope: string; percentBps?: unknown; amount?: unknown }>;
};

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

/**
 * Versioned commercial terms.
 *
 * A revision snapshots the complete commercial offer (stacking, window,
 * limits, targets, benefits). Publishing is one atomic step: terms hash
 * recomputed, previous published revision superseded, promotion pointer
 * moved. Afterwards the service refuses edits and the database trigger
 * rejects them — editing an active campaign always mints a new draft.
 */
@Injectable()
export class PromotionRevisionService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AdminApprovalsService) private readonly approvals: AdminApprovalsService,
    @Inject(PromotionEligibilityService) private readonly eligibility: PromotionEligibilityService,
  ) {}

  private assertAdmin(actor: PromotionActor): void {
    if (actor?.role !== "admin") {
      throw new PromotionDomainError("PROMOTION_FORBIDDEN", "promotion writes require an admin actor", 403);
    }
    requireText(actor?.userId, "actor.userId", 128);
  }

  private normalizeTerms(input: DraftRevisionInput): {
    stackingPolicy: string;
    priority: number;
    couponRequired: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimitTotal: number | null;
    usageLimitPerCustomer: number | null;
    targets: NormalizedTarget[];
    benefits: NormalizedBenefit[];
  } {
    const stackingPolicy = input.stackingPolicy === undefined ? "STACKABLE" : assertStackingPolicy(input.stackingPolicy);
    const priority = input.priority === undefined || input.priority === null ? 100 : requireSafeInteger(input.priority, "priority", 0, 1_000_000);
    const couponRequired = input.couponRequired ?? false;
    if (typeof couponRequired !== "boolean") {
      throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "couponRequired must be a boolean");
    }
    const startsAt = parseDateInput(input.startsAt, "startsAt");
    const endsAt = parseDateInput(input.endsAt, "endsAt");
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "revision requires startsAt < endsAt");
    }
    const usageLimitTotal = input.usageLimitTotal === undefined || input.usageLimitTotal === null || input.usageLimitTotal === ""
      ? null
      : requireSafeInteger(input.usageLimitTotal, "usageLimitTotal", 1, 1_000_000_000);
    const usageLimitPerCustomer = input.usageLimitPerCustomer === undefined || input.usageLimitPerCustomer === null || input.usageLimitPerCustomer === ""
      ? null
      : requireSafeInteger(input.usageLimitPerCustomer, "usageLimitPerCustomer", 1, 1_000_000_000);
    const targets = (input.targets ?? []).map((target) => normalizeTargetInput(target));
    if (targets.length > 50) throw new PromotionDomainError(PromotionCodes.TARGET_INVALID, "at most 50 targets per revision");
    const benefits = (input.benefits ?? []).map((benefit) => normalizeBenefitInput(benefit));
    if (benefits.length > 10) throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "at most 10 benefits per revision");
    return { stackingPolicy, priority, couponRequired, startsAt, endsAt, usageLimitTotal, usageLimitPerCustomer, targets, benefits };
  }

  async createDraftRevision(actor: PromotionActor, promotionId: string, input: DraftRevisionInput = {}) {
    this.assertAdmin(actor);
    const pid = requireText(promotionId, "promotionId", 128);
    const terms = this.normalizeTerms(input);
    return this.db.transaction(async (tx) => {
      const [parent] = await tx.select().from(promotion).where(eq(promotion.id, pid)).for("update").limit(1);
      if (!parent) throw new PromotionNotFoundError("promotion", pid);
      if (parent.status === "ENDED" || parent.status === "ARCHIVED") {
        throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Cannot draft a revision on a ${parent.status} promotion`);
      }
      await this.eligibility.assertReferencesExist(terms.targets, parent.channel);
      const existing = await tx
        .select({ n: promotionRevision.revisionNumber })
        .from(promotionRevision)
        .where(eq(promotionRevision.promotionId, pid))
        .orderBy(desc(promotionRevision.revisionNumber))
        .limit(1);
      const revisionNumber = (existing[0]?.n ?? 0) + 1;
      const id = makePromotionId("prev");
      const termsHash = hashPromotionTerms(terms);
      await tx.insert(promotionRevision).values({
        id,
        promotionId: pid,
        revisionNumber,
        status: "DRAFT",
        stackingPolicy: terms.stackingPolicy,
        priority: terms.priority,
        couponRequired: terms.couponRequired,
        startsAt: terms.startsAt,
        endsAt: terms.endsAt,
        usageLimitTotal: terms.usageLimitTotal,
        usageLimitPerCustomer: terms.usageLimitPerCustomer,
        termsHash,
        createdBy: actor.userId,
      });
      await this.insertTerms(tx, id, terms.targets, terms.benefits);
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.revision.drafted",
          entityType: "promotion_revision",
          entityId: id,
          after: { promotionId: pid, revisionNumber, termsHash },
        },
        tx,
      );
      return this.readRevision(tx, id);
    });
  }

  /** Copy-on-write: a new draft cloned from any revision (incl. published). */
  async createDraftFromPublished(actor: PromotionActor, revisionId: string) {
    this.assertAdmin(actor);
    const rid = requireText(revisionId, "revisionId", 128);
    const source = await this.getRevision(rid);
    return this.createDraftRevision(actor, source.revision.promotionId, {
      stackingPolicy: source.revision.stackingPolicy,
      priority: source.revision.priority,
      couponRequired: source.revision.couponRequired,
      startsAt: source.revision.startsAt,
      endsAt: source.revision.endsAt,
      usageLimitTotal: source.revision.usageLimitTotal,
      usageLimitPerCustomer: source.revision.usageLimitPerCustomer,
      targets: source.targets.map((target) => ({
        targetType: target.targetType,
        referenceId: target.referenceId,
        minSubtotal: target.minSubtotal ?? undefined,
        minQuantity: target.minQuantity ?? undefined,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
      })),
      benefits: source.benefits.map((benefit) => ({
        benefitType: benefit.benefitType,
        scope: benefit.scope,
        percentBps: benefit.percentBps ?? undefined,
        amount: benefit.amount ?? undefined,
      })),
    });
  }

  /** Replace all targets/benefits of a DRAFT/IN_REVIEW revision. */
  async replaceTerms(
    actor: PromotionActor,
    revisionId: string,
    input: { targets?: DraftRevisionInput["targets"]; benefits?: DraftRevisionInput["benefits"] },
  ) {
    this.assertAdmin(actor);
    const rid = requireText(revisionId, "revisionId", 128);
    const targets = (input.targets ?? []).map((target) => normalizeTargetInput(target));
    const benefits = (input.benefits ?? []).map((benefit) => normalizeBenefitInput(benefit));
    if (targets.length > 50 || benefits.length > 10) {
      throw new PromotionDomainError(PromotionCodes.INVALID_INPUT, "too many targets or benefits");
    }
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, rid)).for("update").limit(1);
      if (!revision) throw new PromotionNotFoundError("promotion_revision", rid);
      if (revision.status !== "DRAFT" && revision.status !== "IN_REVIEW") {
        throw new PromotionDomainError(PromotionCodes.TERMS_IMMUTABLE, `Cannot edit terms of a ${revision.status} revision`);
      }
      const [parent] = await tx.select().from(promotion).where(eq(promotion.id, revision.promotionId)).limit(1);
      if (!parent) throw new PromotionNotFoundError("promotion", revision.promotionId);
      await this.eligibility.assertReferencesExist(targets, parent.channel);
      await tx.delete(promotionTarget).where(eq(promotionTarget.revisionId, rid));
      await tx.delete(promotionBenefit).where(eq(promotionBenefit.revisionId, rid));
      await this.insertTerms(tx, rid, targets, benefits);
      const termsHash = hashPromotionTerms({
        stackingPolicy: revision.stackingPolicy,
        priority: revision.priority,
        couponRequired: revision.couponRequired,
        startsAt: revision.startsAt,
        endsAt: revision.endsAt,
        usageLimitTotal: revision.usageLimitTotal,
        usageLimitPerCustomer: revision.usageLimitPerCustomer,
        targets,
        benefits,
      });
      await tx.update(promotionRevision).set({ termsHash, updatedAt: new Date() }).where(eq(promotionRevision.id, rid));
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.revision.terms_replaced",
          entityType: "promotion_revision",
          entityId: rid,
          after: { targets: targets.length, benefits: benefits.length, termsHash },
        },
        tx,
      );
      return this.readRevision(tx, rid);
    });
  }

  async transitionRevision(actor: PromotionActor, revisionId: string, to: string) {
    this.assertAdmin(actor);
    const rid = requireText(revisionId, "revisionId", 128);
    const target = assertOneOf(to, ["DRAFT", "IN_REVIEW", "ARCHIVED"], "status");
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, rid)).for("update").limit(1);
      if (!revision) throw new PromotionNotFoundError("promotion_revision", rid);
      // Publishing has its own atomic path (publishRevision); this covers the
      // editorial loop only.
      assertRevisionTransition(revision.status, target);
      const [updated] = await tx
        .update(promotionRevision)
        .set({ status: target, updatedAt: new Date() })
        .where(eq(promotionRevision.id, rid))
        .returning();
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.revision.transitioned",
          entityType: "promotion_revision",
          entityId: rid,
          before: { status: revision.status },
          after: { status: target },
        },
        tx,
      );
      return updated;
    });
  }

  /** Maker step: open a PROMOTION_PUBLISH approval for a draft/in-review revision. */
  async requestPublishApproval(
    actor: PromotionActor,
    revisionId: string,
    input: { makerNotes?: string; idempotencyKey: string },
  ) {
    this.assertAdmin(actor);
    const rid = requireText(revisionId, "revisionId", 128);
    const idempotencyKey = assertIdempotencyKey(input?.idempotencyKey);
    const notes = optionalText(input?.makerNotes, "makerNotes", 2000);
    const revision = await this.getRevision(rid);
    if (revision.revision.status !== "DRAFT" && revision.revision.status !== "IN_REVIEW") {
      throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, "Only DRAFT/IN_REVIEW revisions can request publish approval");
    }
    const request = await this.approvals.createApprovalRequest(
      {
        requestType: "PROMOTION_PUBLISH",
        targetType: "promotion_revision",
        targetId: rid,
        payload: { promotionId: revision.revision.promotionId, termsHash: revision.revision.termsHash },
        makerNotes: notes ?? undefined,
        idempotencyKey,
      },
      actor.userId,
    );
    await this.db
      .update(promotionRevision)
      .set({ approvalRequestId: request.id, updatedAt: new Date() })
      .where(and(eq(promotionRevision.id, rid), sql`${promotionRevision.status} IN ('DRAFT', 'IN_REVIEW')`));
    return request;
  }

  async publishRevision(revisionId: string, actorId: string) {
    requireText(actorId, "actorId", 128);
    const rid = requireText(revisionId, "revisionId", 128);
    return this.db.transaction(async (tx) => this.publishRevisionInTransaction(tx, rid, actorId));
  }

  /**
   * Atomic publish: recompute the terms hash from the stored rows, validate a
   * linked maker/checker approval when present, supersede the previous
   * published revision, and move the promotion pointer — all in one tx.
   * Idempotent for the current published revision.
   */
  async publishRevisionInTransaction(tx: DbOrTx, revisionId: string, actorId: string, opts: { expectedPromotionId?: string } = {}) {
    const rid = requireText(revisionId, "revisionId", 128);
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, rid)).for("update").limit(1);
    if (!revision) throw new PromotionNotFoundError("promotion_revision", rid);
    if (opts.expectedPromotionId && revision.promotionId !== opts.expectedPromotionId) {
      throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "revision does not belong to the promotion");
    }
    const [parent] = await tx.select().from(promotion).where(eq(promotion.id, revision.promotionId)).for("update").limit(1);
    if (!parent) throw new PromotionNotFoundError("promotion", revision.promotionId);
    if (parent.currentPublishedRevisionId === rid && revision.status === "PUBLISHED") return revision;
    assertRevisionTransition(revision.status, "PUBLISHED");

    const targets = await tx.select().from(promotionTarget).where(eq(promotionTarget.revisionId, rid)).orderBy(asc(promotionTarget.id));
    const benefits = await tx.select().from(promotionBenefit).where(eq(promotionBenefit.revisionId, rid)).orderBy(asc(promotionBenefit.id));
    if (benefits.length === 0) {
      throw new PromotionDomainError(PromotionCodes.BENEFIT_INVALID, "Cannot publish a revision without benefits");
    }
    const termsHash = hashPromotionTerms({
      stackingPolicy: revision.stackingPolicy,
      priority: revision.priority,
      couponRequired: revision.couponRequired,
      startsAt: revision.startsAt,
      endsAt: revision.endsAt,
      usageLimitTotal: revision.usageLimitTotal,
      usageLimitPerCustomer: revision.usageLimitPerCustomer,
      targets: targets.map((target) => ({
        targetType: target.targetType,
        referenceId: target.referenceId,
        minSubtotal: target.minSubtotal,
        minQuantity: target.minQuantity,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
      })),
      benefits: benefits.map((benefit) => ({
        benefitType: benefit.benefitType,
        scope: benefit.scope,
        percentBps: benefit.percentBps,
        amount: benefit.amount,
      })),
    });

    if (revision.approvalRequestId) {
      await this.assertPublishApproval(revision.approvalRequestId, rid, actorId);
    }

    const previousId = parent.currentPublishedRevisionId;
    if (previousId && previousId !== rid) {
      await tx
        .update(promotionRevision)
        .set({ status: "SUPERSEDED", updatedAt: new Date() })
        .where(and(eq(promotionRevision.id, previousId), eq(promotionRevision.status, "PUBLISHED")));
    }
    const [published] = await tx
      .update(promotionRevision)
      .set({ status: "PUBLISHED", termsHash, publishedAt: new Date(), publishedBy: actorId, updatedAt: new Date() })
      .where(eq(promotionRevision.id, rid))
      .returning();
    await tx.update(promotion).set({ currentPublishedRevisionId: rid, updatedAt: new Date() }).where(eq(promotion.id, parent.id));
    await this.audit.record(
      {
        actorId,
        actorRole: "admin",
        action: "promotion.revision.published",
        entityType: "promotion_revision",
        entityId: rid,
        before: { status: revision.status, previousPublishedRevisionId: previousId },
        after: { status: "PUBLISHED", termsHash },
      },
      tx,
    );
    return published;
  }

  private async assertPublishApproval(approvalRequestId: string, revisionId: string, actorId: string): Promise<void> {
    const approval = (await this.approvals.getApprovalRequest(approvalRequestId)) as {
      id: string;
      requestType: string;
      targetType: string;
      targetId: string;
      makerId: string;
      checkerId: string | null;
      status: string;
    } | null;
    if (!approval) throw new PromotionDomainError(PromotionCodes.APPROVAL_INVALID, "linked approval request is missing");
    if (approval.requestType !== "PROMOTION_PUBLISH" || approval.targetType !== "promotion_revision" || approval.targetId !== revisionId) {
      throw new PromotionDomainError(PromotionCodes.APPROVAL_INVALID, "linked approval does not target this revision");
    }
    if (approval.status !== "approved" && approval.status !== "executed") {
      throw new PromotionDomainError(PromotionCodes.APPROVAL_REQUIRED, `publish approval is ${approval.status}, not approved`);
    }
    if (!approval.checkerId || approval.checkerId === approval.makerId) {
      throw new PromotionDomainError(PromotionCodes.APPROVAL_INVALID, "publish approval violates the two-person rule");
    }
    if (approval.makerId === actorId && approval.checkerId === actorId) {
      throw new PromotionDomainError(PromotionCodes.APPROVAL_INVALID, "publisher cannot be both maker and checker");
    }
  }

  async getRevision(revisionId: string) {
    const rid = requireText(revisionId, "revisionId", 128);
    return this.readRevision(this.db, rid);
  }

  async listRevisions(promotionId: string) {
    const pid = requireText(promotionId, "promotionId", 128);
    return this.db
      .select()
      .from(promotionRevision)
      .where(eq(promotionRevision.promotionId, pid))
      .orderBy(desc(promotionRevision.revisionNumber));
  }

  private async readRevision(executor: DbOrTx, rid: string) {
    const [revision] = await executor.select().from(promotionRevision).where(eq(promotionRevision.id, rid)).limit(1);
    if (!revision) throw new PromotionNotFoundError("promotion_revision", rid);
    const targets = await executor.select().from(promotionTarget).where(eq(promotionTarget.revisionId, rid)).orderBy(asc(promotionTarget.id));
    const benefits = await executor.select().from(promotionBenefit).where(eq(promotionBenefit.revisionId, rid)).orderBy(asc(promotionBenefit.id));
    return { revision, targets, benefits };
  }

  private async insertTerms(executor: DbOrTx, revisionId: string, targets: NormalizedTarget[], benefits: NormalizedBenefit[]) {
    for (const target of targets) {
      await executor.insert(promotionTarget).values({
        id: makePromotionId("ptarget"),
        revisionId,
        targetType: target.targetType,
        referenceId: target.referenceId,
        minSubtotal: target.minSubtotal,
        minQuantity: target.minQuantity,
        startsAt: target.startsAt,
        endsAt: target.endsAt,
      });
    }
    for (const benefit of benefits) {
      await executor.insert(promotionBenefit).values({
        id: makePromotionId("pbenefit"),
        revisionId,
        benefitType: benefit.benefitType,
        scope: benefit.scope,
        percentBps: benefit.percentBps,
        amount: benefit.amount,
      });
    }
  }
}
