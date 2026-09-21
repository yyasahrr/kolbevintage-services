import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import {
  promotion,
  promotionRevision,
  PROMOTION_CHANNELS,
  PROMOTION_STATUSES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import type { PromotionActor } from "./promotions.contract";
import { PromotionConflictError, PromotionDomainError, PromotionNotFoundError } from "./promotions.errors";
import {
  assertChannel,
  assertOneOf,
  assertPromotionKey,
  assertPromotionTransition,
  makePromotionId,
  requireSafeInteger,
  requireText,
} from "./promotions.logic";
import { PromotionRevisionService } from "./promotion-revision.service";

export type ListPromotionsFilter = {
  channel?: string;
  status?: string;
  page?: unknown;
  limit?: unknown;
};

/**
 * Promotion identity + campaign lifecycle.
 *
 * Identity (key, channel, lifecycle) is separate from versioned commercial
 * terms (promotion_revision). Activation is atomic: entering ACTIVE or
 * SCHEDULED always resolves to a published revision inside the same
 * transaction, so a promotion can never be live without terms.
 */
@Injectable()
export class PromotionService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PromotionRevisionService) private readonly revisions: PromotionRevisionService,
  ) {}

  private assertAdmin(actor: PromotionActor): void {
    if (actor?.role !== "admin") {
      throw new PromotionDomainError("PROMOTION_FORBIDDEN", "promotion writes require an admin actor", 403);
    }
    requireText(actor?.userId, "actor.userId", 128);
  }

  async createPromotion(actor: PromotionActor, input: { promotionKey: string; channel: string }) {
    this.assertAdmin(actor);
    const key = assertPromotionKey(input?.promotionKey);
    const channel = assertChannel(input?.channel);
    const id = makePromotionId("promo");
    try {
      const [row] = await this.db
        .insert(promotion)
        .values({ id, promotionKey: key, channel, status: "DRAFT", createdBy: actor.userId })
        .returning();
      await this.audit.record({
        actorId: actor.userId,
        actorRole: "admin",
        action: "promotion.created",
        entityType: "promotion",
        entityId: id,
        after: { promotionKey: key, channel },
      });
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PromotionConflictError("PROMOTION_KEY_DUPLICATE", `promotionKey ${key} already exists`);
      }
      throw error;
    }
  }

  async getPromotion(id: string) {
    const key = requireText(id, "id", 128);
    const [row] = await this.db.select().from(promotion).where(eq(promotion.id, key)).limit(1);
    if (!row) throw new PromotionNotFoundError("promotion", key);
    return row;
  }

  async listPromotions(filter: ListPromotionsFilter = {}) {
    // Allowlisted filters only: unknown channel/status values are rejected,
    // never interpolated — malicious filter input cannot reach a query.
    const conditions = [];
    if (filter.channel !== undefined && filter.channel !== null && filter.channel !== "") {
      assertOneOf(filter.channel, PROMOTION_CHANNELS as unknown as string[], "channel");
      conditions.push(eq(promotion.channel, filter.channel as string));
    }
    if (filter.status !== undefined && filter.status !== null && filter.status !== "") {
      assertOneOf(filter.status, PROMOTION_STATUSES as unknown as string[], "status");
      conditions.push(eq(promotion.status, filter.status as string));
    }
    const page = requireSafeInteger(filter.page ?? 1, "page", 1, 10_000);
    const limit = requireSafeInteger(filter.limit ?? 20, "limit", 1, 100);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(promotion)
      .where(where)
      .orderBy(desc(promotion.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    return { items: rows, page, limit };
  }

  /**
   * Explicit lifecycle transition. Entering ACTIVE/SCHEDULED requires a
   * published revision: pass `revisionId` to publish-switch atomically, or
   * rely on the promotion's current published revision.
   */
  async transition(actor: PromotionActor, id: string, to: string, opts: { revisionId?: string } = {}) {
    this.assertAdmin(actor);
    const key = requireText(id, "id", 128);
    const target = assertOneOf(to, PROMOTION_STATUSES as unknown as string[], "status");
    const requestedRevision = opts.revisionId === undefined || opts.revisionId === null || opts.revisionId === ""
      ? null
      : requireText(opts.revisionId, "revisionId", 128);

    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(promotion).where(eq(promotion.id, key)).for("update").limit(1);
      if (!current) throw new PromotionNotFoundError("promotion", key);
      assertPromotionTransition(current.status, target);

      let currentRevisionId = current.currentPublishedRevisionId;
      if (target === "ACTIVE" || target === "SCHEDULED") {
        if (requestedRevision) {
          const published = await this.revisions.publishRevisionInTransaction(tx, requestedRevision, actor.userId, {
            expectedPromotionId: current.id,
          });
          currentRevisionId = published.id;
        }
        if (!currentRevisionId) {
          throw new PromotionDomainError("PROMOTION_REVISION_REQUIRED", `Cannot enter ${target} without a published revision`);
        }
        const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, currentRevisionId)).limit(1);
        if (!revision || revision.promotionId !== current.id || revision.status !== "PUBLISHED") {
          throw new PromotionDomainError("PROMOTION_REVISION_MISMATCH", "current published revision is not usable");
        }
      }

      const [updated] = await tx
        .update(promotion)
        .set({ status: target, currentPublishedRevisionId: currentRevisionId, updatedAt: new Date() })
        .where(eq(promotion.id, key))
        .returning();
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.transitioned",
          entityType: "promotion",
          entityId: key,
          before: { status: current.status, currentPublishedRevisionId: current.currentPublishedRevisionId },
          after: { status: target, currentPublishedRevisionId: currentRevisionId },
        },
        tx,
      );
      return updated;
    });
  }

  /** Atomic publish + activate convenience wrapper (DRAFT/IN_REVIEW → ACTIVE). */
  async publishAndActivate(actor: PromotionActor, id: string, revisionId: string) {
    return this.transition(actor, id, "ACTIVE", { revisionId });
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const top = error as { code?: string; cause?: unknown };
  if (top.code === "23505") return true;
  // Drizzle wraps the pg driver error: the SQLSTATE lives on `.cause`.
  const cause = top.cause;
  return Boolean(cause) && typeof cause === "object" && (cause as { code?: string }).code === "23505";
}
