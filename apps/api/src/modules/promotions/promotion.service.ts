/**
 * Phase 5.7 — promotion identity, lifecycle, revisions, targets.
 *
 * Identity (`promotion`) carries the lifecycle; `promotion_revision` carries
 * immutable commercial terms. There is no arbitrary status PATCH — every edge
 * is an explicit audited method. Service guards mirror the database triggers;
 * both must agree (defense in depth, tested against live PostgreSQL).
 */

import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  promotion,
  promotionRevision,
  promotionSchedule,
  promotionTarget,
  type KolbeDatabase,
} from "@kolbe/database";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { PROMOTION_FACTS_PROVIDER, type PromotionDisplayState, type PromotionFactsProvider } from "./promotions.contract";
import {
  assertPromotionTransition,
  assertRevisionTransition,
  assertWindowValid,
  hashRevisionTerms,
  makePromotionId,
  parseBenefit,
  parseChannel,
  parseIdempotencyKey,
  parseNonNegativeInt,
  parseOptionalDate,
  parseOptionalText,
  parsePositiveInt,
  parsePromotionCode,
  parsePromotionStatus,
  parseStackingPolicy,
  parseTargetType,
  parseTargetValue,
  parseTitle,
  parseUsageLimit,
  PromotionDomainError,
  type ParsedTargetValue,
} from "./promotions.logic";

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

/** Internal signal: a concurrent transaction won the same idempotency key. */
class PromotionScheduleReplaySignal {
  constructor(readonly idempotencyKey: string) {}
}

/** True when the error is a unique violation on an idempotency key (unwraps Drizzle's `cause`). */
function isIdempotencyConflict(error: unknown): boolean {
  const inner = (error as { cause?: unknown })?.cause ?? error;
  const code = (inner as { code?: string })?.code ?? (error as { code?: string })?.code;
  const constraint = (inner as { constraint?: string })?.constraint ?? (error as { constraint?: string })?.constraint ?? "";
  return code === "23505" && constraint.includes("idempotency");
}

export function mapPromotionPgError(error: unknown, fallbackCode = "PROMOTION_INPUT_INVALID"): never {
  // Drizzle wraps driver errors: the SQLSTATE lives on `cause`.
  const inner = (error as { cause?: unknown })?.cause ?? error;
  const code = (inner as { code?: string })?.code ?? (error as { code?: string })?.code;
  const constraint = (inner as { constraint?: string })?.constraint ?? (error as { constraint?: string })?.constraint ?? "";
  if (code === "23505") {
    if (constraint.includes("promotion_code_unique")) {
      throw new PromotionDomainError("PROMOTION_CODE_TAKEN", "Promotion code is already in use", 409);
    }
    if (constraint.includes("promotion_coupon_code_normalized_unique")) {
      throw new PromotionDomainError("PROMOTION_COUPON_TAKEN", "Coupon code is already in use", 409);
    }
    if (constraint.includes("promotion_target_revision")) {
      throw new PromotionDomainError("PROMOTION_TARGET_DUPLICATE", "Duplicate target on this revision", 409);
    }
    if (constraint.includes("promotion_revision_promotion_number_unique")) {
      throw new PromotionDomainError("PROMOTION_REVISION_CONFLICT", "Revision number conflict, retry", 409);
    }
    if (constraint.includes("idempotency_unique")) {
      throw new PromotionDomainError("PROMOTION_IDEMPOTENCY_REPLAY", "Idempotency key already used", 409);
    }
    if (constraint.includes("coupon_order_unique") || constraint.includes("auto_order_unique")) {
      throw new PromotionDomainError("PROMOTION_ORDER_ALREADY_DISCOUNTED", "This order already used the promotion", 409);
    }
    throw new PromotionDomainError("PROMOTION_CONFLICT", "Conflicting promotion record", 409);
  }
  if (code === "23503") {
    throw new PromotionDomainError("PROMOTION_REFERENCE_INVALID", "Referenced promotion record does not exist", 422);
  }
  if (code === "23514") {
    throw new PromotionDomainError(fallbackCode, "Promotion input violates a commercial invariant", 400);
  }
  throw error;
}

export type CreatePromotionInput = {
  code: unknown;
  title: unknown;
  description?: unknown;
  channel: unknown;
};

export type CreateRevisionInput = {
  benefitType: unknown;
  benefitScope: unknown;
  percentBps?: unknown;
  amount?: unknown;
  stackingPolicy: unknown;
  priority?: unknown;
  maxTotalUses?: unknown;
  maxUsesPerActor?: unknown;
  couponRequired?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  targets?: Array<{ targetType: unknown; valueText?: unknown; valueAmount?: unknown; valueQuantity?: unknown }>;
};

export type AddTargetInput = {
  targetType: unknown;
  valueText?: unknown;
  valueAmount?: unknown;
  valueQuantity?: unknown;
};

@Injectable()
export class PromotionService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(PROMOTION_FACTS_PROVIDER) private readonly facts: PromotionFactsProvider,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ── Identity ─────────────────────────────────────────────────────── */

  async createPromotion(actorId: string, input: CreatePromotionInput) {
    const code = parsePromotionCode(input.code);
    const title = parseTitle(input.title);
    const description = parseOptionalText(input.description, "description", 2000);
    const channel = parseChannel(input.channel);
    try {
      const [created] = await this.db
        .insert(promotion)
        .values({ id: makePromotionId("promo"), code, title, description, channel, status: "DRAFT", createdBy: actorId })
        .returning();
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.created",
        entityType: "promotion", entityId: created.id, after: { code, channel },
      });
      return created;
    } catch (error) {
      mapPromotionPgError(error);
    }
  }

  async getPromotion(id: string) {
    const [found] = await this.db.select().from(promotion).where(eq(promotion.id, id)).limit(1);
    if (!found) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
    let publishedRevision: Record<string, unknown> | null = null;
    if (found.currentPublishedRevisionId) {
      publishedRevision = await this.getRevision(found.currentPublishedRevisionId);
    }
    return { ...found, publishedRevision };
  }

  /**
   * Phase 5.7-B — display-safe campaign state for CMS/SiteBuilder references.
   *
   * Presentation-only: identity, lifecycle status, revision window, and the
   * benefit shape for rendering ("15% off", "free shipping"). It carries no
   * eligibility inputs, no per-actor data, and no computed discounts — CMS
   * resolves this at serve time and must never decide eligibility or totals
   * from it. Unknown codes return null (total function for render paths);
   * malformed codes throw (loud authoring errors).
   */
  async getPromotionDisplayState(code: unknown, nowInput?: unknown): Promise<PromotionDisplayState | null> {
    const canonical = parsePromotionCode(code);
    const now = parseOptionalDate(nowInput, "now") ?? new Date();
    const [found] = await this.db.select().from(promotion).where(eq(promotion.code, canonical)).limit(1);
    if (!found) return null;
    let benefit: PromotionDisplayState["benefit"] = null;
    let window: PromotionDisplayState["window"] = { startsAt: null, endsAt: null };
    if (found.currentPublishedRevisionId) {
      const [revision] = await this.db.select().from(promotionRevision).where(eq(promotionRevision.id, found.currentPublishedRevisionId)).limit(1);
      if (revision && revision.status === "PUBLISHED") {
        window = { startsAt: revision.startsAt?.toISOString() ?? null, endsAt: revision.endsAt?.toISOString() ?? null };
        const inWindow = (!revision.startsAt || revision.startsAt.getTime() <= now.getTime())
          && (!revision.endsAt || revision.endsAt.getTime() > now.getTime());
        benefit = {
          type: revision.benefitType,
          scope: revision.benefitScope,
          percentBps: revision.percentBps,
          amount: revision.amount === null ? null : revision.amount.toString(),
          couponRequired: revision.couponRequired,
          inWindow,
        };
      }
    }
    return {
      code: found.code,
      title: found.title,
      channel: found.channel,
      status: found.status,
      displayActive: found.status === "ACTIVE" && benefit !== null && benefit.inWindow,
      window,
      benefit,
    };
  }

  async listPromotions(filter: { status?: unknown; channel?: unknown; code?: unknown; page?: unknown; limit?: unknown } = {}) {
    let status: string | undefined;
    let channel: "RETAIL" | "WHOLESALE" | undefined;
    if (filter.status !== undefined && filter.status !== null && filter.status !== "") {
      status = parsePromotionStatus(filter.status);
    }
    if (filter.channel !== undefined && filter.channel !== null && filter.channel !== "") {
      channel = parseChannel(filter.channel);
    }
    let code: string | undefined;
    if (filter.code !== undefined && filter.code !== null && filter.code !== "") {
      code = parsePromotionCode(filter.code);
    }
    const page = filter.page === undefined ? 1 : parsePositiveInt(filter.page, "page", 100_000, "PROMOTION_FILTER_INVALID");
    const limit = filter.limit === undefined ? 20 : parsePositiveInt(filter.limit, "limit", 100, "PROMOTION_FILTER_INVALID");
    const conditions = [];
    if (status) conditions.push(eq(promotion.status, status));
    if (channel) conditions.push(eq(promotion.channel, channel));
    if (code) conditions.push(eq(promotion.code, code));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const items = await this.db
      .select()
      .from(promotion)
      .where(where)
      .orderBy(desc(promotion.createdAt), desc(promotion.id))
      .limit(limit)
      .offset((page - 1) * limit);
    const [{ count }] = await this.db.select({ count: sql<number>`count(*)::int` }).from(promotion).where(where);
    return { items, page, limit, total: count };
  }

  /* ── Lifecycle (explicit edges only) ──────────────────────────────── */

  private async transitionInTx(
    tx: DbOrTx,
    id: string,
    to: string,
    actorId: string,
    action: string,
  ) {
    const [current] = await tx.select().from(promotion).where(eq(promotion.id, id)).for("update").limit(1);
    if (!current) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
    assertPromotionTransition(current.status, to);
    const [updated] = await tx.update(promotion).set({ status: to, updatedAt: new Date() }).where(eq(promotion.id, id)).returning();
    if (to === "ENDED" || to === "ARCHIVED" || (current.status === "SCHEDULED" && to === "DRAFT")) {
      await this.cancelPendingSchedules(tx, id);
    }
    await this.audit.record({
      actorId, actorRole: "admin", action, entityType: "promotion", entityId: id,
      before: { status: current.status }, after: { status: to },
    }, tx);
    return updated;
  }

  private async cancelPendingSchedules(tx: DbOrTx, promotionId: string): Promise<number> {
    const cancelled = await tx
      .update(promotionSchedule)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(and(eq(promotionSchedule.promotionId, promotionId), inArray(promotionSchedule.status, ["SCHEDULED", "CLAIMED"])))
      .returning({ id: promotionSchedule.id });
    return cancelled.length;
  }

  private async requirePublishedRevision(tx: DbOrTx, promo: { id: string; currentPublishedRevisionId: string | null }) {
    if (!promo.currentPublishedRevisionId) {
      throw new PromotionDomainError("PROMOTION_NO_PUBLISHED_REVISION", "Promotion has no published revision", 409);
    }
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, promo.currentPublishedRevisionId)).limit(1);
    if (!revision || revision.status !== "PUBLISHED") {
      throw new PromotionDomainError("PROMOTION_NO_PUBLISHED_REVISION", "Current revision is not published", 409);
    }
    return revision;
  }

  async submitForReview(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "IN_REVIEW", actorId, "promotion.submitted"));
  }

  async rejectToDraft(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "DRAFT", actorId, "promotion.rejected"));
  }

  async unschedule(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "DRAFT", actorId, "promotion.unscheduled"));
  }

  async scheduleActivation(id: string, actorId: string, input: { revisionId?: unknown; runAt: unknown; idempotencyKey: unknown }) {
    const runAt = parseOptionalDate(input.runAt, "run_at");
    if (!runAt) throw new PromotionDomainError("PROMOTION_SCHEDULE_INVALID", "run_at is required");
    if (runAt.getTime() <= Date.now()) {
      throw new PromotionDomainError("PROMOTION_SCHEDULE_INVALID", "run_at must be in the future");
    }
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    const revisionRef = input.revisionId === undefined || input.revisionId === null || input.revisionId === ""
      ? null
      : parseOptionalText(input.revisionId, "revision_id", 160);
    return this.withScheduleReplay(idempotencyKey, () => this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const [replay] = await executor.select().from(promotionSchedule).where(eq(promotionSchedule.idempotencyKey, idempotencyKey)).limit(1);
      if (replay) return { schedule: replay, replayed: true as const };
      const [promo] = await executor.select().from(promotion).where(eq(promotion.id, id)).for("update").limit(1);
      if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
      // Double-checked idempotency: a concurrent same-key transaction may have
      // committed while this one waited on the promotion lock.
      const [afterLock] = await executor.select().from(promotionSchedule).where(eq(promotionSchedule.idempotencyKey, idempotencyKey)).limit(1);
      if (afterLock) return { schedule: afterLock, replayed: true as const };
      assertPromotionTransition(promo.status, "SCHEDULED");
      const revisionId = revisionRef ?? promo.currentPublishedRevisionId;
      if (!revisionId) throw new PromotionDomainError("PROMOTION_NO_PUBLISHED_REVISION", "Nothing to schedule: no revision", 409);
      const revision = await this.publishRevisionInTx(executor, revisionId, actorId, true);
      try {
        const [schedule] = await executor
          .insert(promotionSchedule)
          .values({
            id: makePromotionId("promosched"), promotionId: id, revisionId: revision.id,
            action: "ACTIVATE", runAt, status: "SCHEDULED", idempotencyKey, createdBy: actorId,
          })
          .returning();
        await executor.update(promotion).set({ status: "SCHEDULED", updatedAt: new Date() }).where(eq(promotion.id, id));
        await this.audit.record({
          actorId, actorRole: "admin", action: "promotion.activation_scheduled",
          entityType: "promotion_schedule", entityId: schedule.id,
          before: { status: promo.status }, after: { status: "SCHEDULED", revisionId: revision.id, runAt: runAt.toISOString() },
        }, executor);
        return { schedule, replayed: false as const };
      } catch (error) {
        // A failed statement aborts the transaction (any further query inside
        // would 25P02), so concurrent same-key conflicts are only *signalled*
        // here; the winner row is re-read outside, in `withScheduleReplay`.
        if (isIdempotencyConflict(error)) throw new PromotionScheduleReplaySignal(idempotencyKey);
        mapPromotionPgError(error);
      }
    }));
  }

  async scheduleEnd(id: string, actorId: string, input: { runAt: unknown; idempotencyKey: unknown }) {
    const runAt = parseOptionalDate(input.runAt, "run_at");
    if (!runAt) throw new PromotionDomainError("PROMOTION_SCHEDULE_INVALID", "run_at is required");
    if (runAt.getTime() <= Date.now()) {
      throw new PromotionDomainError("PROMOTION_SCHEDULE_INVALID", "run_at must be in the future");
    }
    const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
    return this.withScheduleReplay(idempotencyKey, () => this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const [replay] = await executor.select().from(promotionSchedule).where(eq(promotionSchedule.idempotencyKey, idempotencyKey)).limit(1);
      if (replay) return { schedule: replay, replayed: true as const };
      const [promo] = await executor.select().from(promotion).where(eq(promotion.id, id)).for("update").limit(1);
      if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
      // Double-checked idempotency: a concurrent same-key transaction may have
      // committed while this one waited on the promotion lock.
      const [afterLockEnd] = await executor.select().from(promotionSchedule).where(eq(promotionSchedule.idempotencyKey, idempotencyKey)).limit(1);
      if (afterLockEnd) return { schedule: afterLockEnd, replayed: true as const };
      if (!["ACTIVE", "PAUSED", "SCHEDULED"].includes(promo.status)) {
        throw new PromotionDomainError("PROMOTION_SCHEDULE_INVALID", `Cannot schedule end from ${promo.status}`, 409);
      }
      const revision = await this.requirePublishedRevision(executor, promo);
      const [schedule] = await executor
        .insert(promotionSchedule)
        .values({
          id: makePromotionId("promosched"), promotionId: id, revisionId: revision.id,
          action: "END", runAt, status: "SCHEDULED", idempotencyKey, createdBy: actorId,
        })
        .returning();
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.end_scheduled",
        entityType: "promotion_schedule", entityId: schedule.id, after: { runAt: runAt.toISOString() },
      }, executor);
      return { schedule, replayed: false as const };
    }));
  }

  /**
   * Concurrent same-key schedule creation: exactly one transaction wins the
   * insert; losers observe the idempotency conflict and return the winner as
   * a replay. The re-read runs outside the rolled-back transaction, where the
   * winner's committed row is visible.
   */
  private async withScheduleReplay<T>(idempotencyKey: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      if (error instanceof PromotionScheduleReplaySignal || isIdempotencyConflict(error)) {
        const [existing] = await this.db
          .select()
          .from(promotionSchedule)
          .where(eq(promotionSchedule.idempotencyKey, idempotencyKey))
          .limit(1);
        if (existing) return { schedule: existing, replayed: true as const } as unknown as T;
        throw new PromotionDomainError("PROMOTION_IDEMPOTENCY_REPLAY", "Schedule was created concurrently; retry the read", 409);
      }
      mapPromotionPgError(error);
    }
  }

  async activate(id: string, actorId: string, input: { expectedRevisionId?: unknown } = {}) {
    return this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const [promo] = await executor.select().from(promotion).where(eq(promotion.id, id)).for("update").limit(1);
      if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
      assertPromotionTransition(promo.status, "ACTIVE");
      const revision = await this.requirePublishedRevision(executor, promo);
      const expected = input.expectedRevisionId === undefined || input.expectedRevisionId === null || input.expectedRevisionId === ""
        ? null
        : parseOptionalText(input.expectedRevisionId, "expected_revision_id", 160);
      if (expected && expected !== revision.id) {
        throw new PromotionDomainError("PROMOTION_REVISION_STALE", "Published revision changed under this activation", 409);
      }
      // Manual activation wins over pending scheduled activation rows.
      await executor
        .update(promotionSchedule)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(
          eq(promotionSchedule.promotionId, id),
          eq(promotionSchedule.action, "ACTIVATE"),
          inArray(promotionSchedule.status, ["SCHEDULED", "CLAIMED"]),
        ));
      const [updated] = await executor.update(promotion).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(promotion.id, id)).returning();
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.activated",
        entityType: "promotion", entityId: id,
        before: { status: promo.status }, after: { status: "ACTIVE", revisionId: revision.id },
      }, executor);
      return updated;
    });
  }

  async pause(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "PAUSED", actorId, "promotion.paused"));
  }

  async resume(id: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const [promo] = await executor.select().from(promotion).where(eq(promotion.id, id)).for("update").limit(1);
      if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${id} not found`, 404);
      assertPromotionTransition(promo.status, "ACTIVE");
      await this.requirePublishedRevision(executor, promo);
      const [updated] = await executor.update(promotion).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(promotion.id, id)).returning();
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.resumed",
        entityType: "promotion", entityId: id, before: { status: "PAUSED" }, after: { status: "ACTIVE" },
      }, executor);
      return updated;
    });
  }

  async end(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "ENDED", actorId, "promotion.ended"));
  }

  async archive(id: string, actorId: string) {
    return this.db.transaction((tx) => this.transitionInTx(tx as DbOrTx, id, "ARCHIVED", actorId, "promotion.archived"));
  }

  /* ── Revisions ────────────────────────────────────────────────────── */

  private async verifyTargetReference(targetType: string, value: ParsedTargetValue): Promise<void> {
    if (targetType === "PRODUCT") {
      const found = await this.facts.getProductFacts(value.valueText as string);
      if (!found) throw new PromotionDomainError("PROMOTION_TARGET_UNKNOWN", `Product ${value.valueText} does not exist or is archived`, 422);
    } else if (targetType === "OFFER") {
      const found = await this.facts.getOfferFacts(value.valueText as string);
      if (!found) throw new PromotionDomainError("PROMOTION_TARGET_UNKNOWN", `Offer ${value.valueText} does not exist or is ineligible`, 422);
    } else if (targetType === "VIP_PLAN") {
      const exists = await this.facts.vipPlanExists(value.valueText as string);
      if (!exists) throw new PromotionDomainError("PROMOTION_TARGET_UNKNOWN", `VIP plan ${value.valueText} does not exist`, 422);
    } else if (targetType === "VIP_ACCOUNT") {
      const exists = await this.facts.wholesaleAccountExists(value.valueText as string);
      if (!exists) throw new PromotionDomainError("PROMOTION_TARGET_UNKNOWN", `Wholesale account ${value.valueText} does not exist`, 422);
    } else if (targetType === "CUSTOMER_SEGMENT" && (value.valueText as string).startsWith("tag:")) {
      const key = (value.valueText as string).slice("tag:".length);
      const exists = await this.facts.tagExists(key);
      if (!exists) throw new PromotionDomainError("PROMOTION_TARGET_UNKNOWN", `CRM tag ${key} does not exist or is inactive`, 422);
    }
    // CATEGORY is shape-validated here and matched against authoritative
    // product.categoryId facts at evaluation; a dead category simply never
    // matches (fail closed by construction).
  }

  private parseCouponRequired(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value !== "boolean") throw new PromotionDomainError("PROMOTION_INPUT_INVALID", "coupon_required must be boolean");
    return value;
  }

  async createRevision(promotionId: string, actorId: string, input: CreateRevisionInput) {
    const benefit = parseBenefit(input);
    const stackingPolicy = parseStackingPolicy(input.stackingPolicy);
    const priority = input.priority === undefined ? 100 : parseNonNegativeInt(input.priority, "priority", 1_000_000);
    const maxTotalUses = parseUsageLimit(input.maxTotalUses, "max_total_uses");
    const maxUsesPerActor = parseUsageLimit(input.maxUsesPerActor, "max_uses_per_actor");
    const couponRequired = this.parseCouponRequired(input.couponRequired);
    const startsAt = parseOptionalDate(input.startsAt, "starts_at");
    const endsAt = parseOptionalDate(input.endsAt, "ends_at");
    assertWindowValid(startsAt, endsAt);
    const rawTargets = input.targets ?? [];
    if (!Array.isArray(rawTargets)) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "targets must be an array");
    if (rawTargets.length > 50) throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "too many targets (max 50)");
    const parsedTargets = rawTargets.map((target) => {
      const type = parseTargetType((target as AddTargetInput).targetType);
      return { type, ...(parseTargetValue(type, target as AddTargetInput)) };
    });
    // Duplicate detection before touching the database.
    const seen = new Set<string>();
    for (const target of parsedTargets) {
      const key = `${target.type}|${target.valueText ?? ""}|${target.valueAmount?.toString() ?? ""}|${target.valueQuantity ?? ""}`;
      if (seen.has(key)) throw new PromotionDomainError("PROMOTION_TARGET_DUPLICATE", "Duplicate target on this revision", 409);
      seen.add(key);
    }
    for (const target of parsedTargets) {
      await this.verifyTargetReference(target.type, target);
    }
    const termsHash = hashRevisionTerms(
      {
        benefitType: benefit.benefitType, benefitScope: benefit.benefitScope,
        percentBps: benefit.percentBps, amount: benefit.amount, currency: "IRR",
        stackingPolicy, priority, maxTotalUses, maxUsesPerActor, couponRequired, startsAt, endsAt,
      },
      parsedTargets.map((target) => ({ targetType: target.type, valueText: target.valueText, valueAmount: target.valueAmount, valueQuantity: target.valueQuantity })),
    );
    try {
      return await this.db.transaction(async (tx) => {
        const executor = tx as DbOrTx;
        const [promo] = await executor.select().from(promotion).where(eq(promotion.id, promotionId)).for("update").limit(1);
        if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${promotionId} not found`, 404);
        if (promo.status === "ENDED" || promo.status === "ARCHIVED") {
          throw new PromotionDomainError("PROMOTION_CLOSED_FOR_EDIT", `Cannot revise a ${promo.status} promotion`, 409);
        }
        const existing = await executor
          .select({ number: promotionRevision.revisionNumber })
          .from(promotionRevision)
          .where(eq(promotionRevision.promotionId, promotionId));
        const revisionNumber = existing.reduce((max, row) => Math.max(max, row.number), 0) + 1;
        const [revision] = await executor
          .insert(promotionRevision)
          .values({
            id: makePromotionId("promorev"), promotionId, revisionNumber, status: "DRAFT",
            benefitType: benefit.benefitType, benefitScope: benefit.benefitScope,
            percentBps: benefit.percentBps, amount: benefit.amount, currency: "IRR",
            stackingPolicy, priority, maxTotalUses, maxUsesPerActor, couponRequired,
            startsAt, endsAt, termsHash, createdBy: actorId,
          })
          .returning();
        const targets = [];
        for (const target of parsedTargets) {
          const [row] = await executor
            .insert(promotionTarget)
            .values({
              id: makePromotionId("promotgt"), revisionId: revision.id,
              targetType: target.type, valueText: target.valueText,
              valueAmount: target.valueAmount, valueQuantity: target.valueQuantity,
            })
            .returning();
          targets.push(row);
        }
        await this.audit.record({
          actorId, actorRole: "admin", action: "promotion.revision_created",
          entityType: "promotion_revision", entityId: revision.id,
          after: { promotionId, revisionNumber, benefitType: benefit.benefitType, termsHash },
        }, executor);
        return { ...revision, targets };
      });
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      mapPromotionPgError(error);
    }
  }

  private async recomputeTermsHash(tx: DbOrTx, revisionId: string): Promise<string> {
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new PromotionDomainError("PROMOTION_REVISION_NOT_FOUND", `Revision ${revisionId} not found`, 404);
    const targets = await tx.select().from(promotionTarget).where(eq(promotionTarget.revisionId, revisionId));
    const termsHash = hashRevisionTerms(
      {
        benefitType: revision.benefitType, benefitScope: revision.benefitScope,
        percentBps: revision.percentBps, amount: revision.amount, currency: revision.currency,
        stackingPolicy: revision.stackingPolicy, priority: revision.priority,
        maxTotalUses: revision.maxTotalUses, maxUsesPerActor: revision.maxUsesPerActor,
        couponRequired: revision.couponRequired, startsAt: revision.startsAt, endsAt: revision.endsAt,
      },
      targets.map((target) => ({ targetType: target.targetType, valueText: target.valueText, valueAmount: target.valueAmount, valueQuantity: target.valueQuantity })),
    );
    await tx.update(promotionRevision).set({ termsHash, updatedAt: new Date() }).where(eq(promotionRevision.id, revisionId));
    return termsHash;
  }

  private async requireDraftRevision(tx: DbOrTx, revisionId: string) {
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new PromotionDomainError("PROMOTION_REVISION_NOT_FOUND", `Revision ${revisionId} not found`, 404);
    if (revision.status !== "DRAFT") {
      throw new PromotionDomainError("PROMOTION_REVISION_NOT_DRAFT", "Only DRAFT revisions can be edited — create a new revision", 409);
    }
    const [promo] = await tx.select().from(promotion).where(eq(promotion.id, revision.promotionId)).limit(1);
    if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${revision.promotionId} not found`, 404);
    if (promo.status === "ENDED" || promo.status === "ARCHIVED") {
      throw new PromotionDomainError("PROMOTION_CLOSED_FOR_EDIT", `Cannot edit a ${promo.status} promotion`, 409);
    }
    return { revision, promo };
  }

  async addTarget(revisionId: string, actorId: string, input: AddTargetInput) {
    const type = parseTargetType(input.targetType);
    const parsed = parseTargetValue(type, input);
    await this.verifyTargetReference(type, parsed);
    try {
      return await this.db.transaction(async (tx) => {
        const executor = tx as DbOrTx;
        const { revision } = await this.requireDraftRevision(executor, revisionId);
        const targetCount = await executor
          .select({ count: sql<number>`count(*)::int` })
          .from(promotionTarget)
          .where(eq(promotionTarget.revisionId, revisionId));
        if ((targetCount[0]?.count ?? 0) >= 50) {
          throw new PromotionDomainError("PROMOTION_TARGET_INVALID", "too many targets (max 50)");
        }
        const [row] = await executor
          .insert(promotionTarget)
          .values({
            id: makePromotionId("promotgt"), revisionId: revision.id,
            targetType: type, valueText: parsed.valueText,
            valueAmount: parsed.valueAmount, valueQuantity: parsed.valueQuantity,
          })
          .returning();
        const termsHash = await this.recomputeTermsHash(executor, revision.id);
        await this.audit.record({
          actorId, actorRole: "admin", action: "promotion.target_added",
          entityType: "promotion_target", entityId: row.id, after: { revisionId: revision.id, type, termsHash },
        }, executor);
        return row;
      });
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      mapPromotionPgError(error);
    }
  }

  async removeTarget(revisionId: string, targetId: string, actorId: string) {
    return this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const { revision } = await this.requireDraftRevision(executor, revisionId);
      const [existing] = await executor
        .select()
        .from(promotionTarget)
        .where(and(eq(promotionTarget.id, targetId), eq(promotionTarget.revisionId, revision.id)))
        .limit(1);
      if (!existing) throw new PromotionDomainError("PROMOTION_TARGET_NOT_FOUND", `Target ${targetId} not found`, 404);
      await executor.delete(promotionTarget).where(eq(promotionTarget.id, targetId));
      const termsHash = await this.recomputeTermsHash(executor, revision.id);
      await this.audit.record({
        actorId, actorRole: "admin", action: "promotion.target_removed",
        entityType: "promotion_target", entityId: targetId,
        before: { revisionId: revision.id, type: existing.targetType }, after: { termsHash },
      }, executor);
      return { removed: targetId, termsHash };
    });
  }

  /** Publishes inside an existing transaction. `lenient` returns the already-published current revision. */
  private async publishRevisionInTx(tx: DbOrTx, revisionId: string, actorId: string, lenient = false) {
    const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new PromotionDomainError("PROMOTION_REVISION_NOT_FOUND", `Revision ${revisionId} not found`, 404);
    const [promo] = await tx.select().from(promotion).where(eq(promotion.id, revision.promotionId)).for("update").limit(1);
    if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${revision.promotionId} not found`, 404);
    if (promo.status === "ENDED" || promo.status === "ARCHIVED") {
      throw new PromotionDomainError("PROMOTION_CLOSED_FOR_EDIT", `Cannot publish on a ${promo.status} promotion`, 409);
    }
    if (revision.status === "PUBLISHED" && lenient && promo.currentPublishedRevisionId === revision.id) {
      return revision;
    }
    assertRevisionTransition(revision.status, "PUBLISHED");
    const targets = await tx.select().from(promotionTarget).where(eq(promotionTarget.revisionId, revision.id));
    const termsHash = hashRevisionTerms(
      {
        benefitType: revision.benefitType, benefitScope: revision.benefitScope,
        percentBps: revision.percentBps, amount: revision.amount, currency: revision.currency,
        stackingPolicy: revision.stackingPolicy, priority: revision.priority,
        maxTotalUses: revision.maxTotalUses, maxUsesPerActor: revision.maxUsesPerActor,
        couponRequired: revision.couponRequired, startsAt: revision.startsAt, endsAt: revision.endsAt,
      },
      targets.map((target) => ({ targetType: target.targetType, valueText: target.valueText, valueAmount: target.valueAmount, valueQuantity: target.valueQuantity })),
    );
    const previousId = promo.currentPublishedRevisionId;
    if (previousId && previousId !== revision.id) {
      const [previous] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, previousId)).for("update").limit(1);
      if (previous && previous.status === "PUBLISHED") {
        assertRevisionTransition(previous.status, "SUPERSEDED");
        await tx.update(promotionRevision).set({ status: "SUPERSEDED", supersededAt: new Date(), updatedAt: new Date() }).where(eq(promotionRevision.id, previous.id));
      }
    }
    const [published] = await tx
      .update(promotionRevision)
      .set({ status: "PUBLISHED", termsHash, publishedAt: new Date(), publishedBy: actorId, updatedAt: new Date() })
      .where(eq(promotionRevision.id, revision.id))
      .returning();
    await tx.update(promotion).set({ currentPublishedRevisionId: revision.id, updatedAt: new Date() }).where(eq(promotion.id, promo.id));
    await this.audit.record({
      actorId, actorRole: "admin", action: "promotion.revision_published",
      entityType: "promotion_revision", entityId: revision.id,
      before: { previousRevisionId: previousId }, after: { promotionId: promo.id, termsHash },
    }, tx);
    return published;
  }

  async publishRevision(revisionId: string, actorId: string) {
    return this.db.transaction((tx) => this.publishRevisionInTx(tx as DbOrTx, revisionId, actorId, false));
  }

  async discardRevision(revisionId: string, actorId: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const executor = tx as DbOrTx;
        const { revision } = await this.requireDraftRevision(executor, revisionId);
        await executor.delete(promotionTarget).where(eq(promotionTarget.revisionId, revision.id));
        await executor.delete(promotionRevision).where(eq(promotionRevision.id, revision.id));
        await this.audit.record({
          actorId, actorRole: "admin", action: "promotion.revision_discarded",
          entityType: "promotion_revision", entityId: revision.id,
          before: { promotionId: revision.promotionId, revisionNumber: revision.revisionNumber },
        }, executor);
        return { discarded: revision.id };
      });
    } catch (error) {
      if (error instanceof PromotionDomainError) throw error;
      if ((error as { code?: string })?.code === "23503") {
        throw new PromotionDomainError("PROMOTION_REVISION_REFERENCED", "Revision is referenced by schedules or coupons and cannot be discarded", 409);
      }
      mapPromotionPgError(error);
    }
  }

  async getRevision(revisionId: string) {
    const [revision] = await this.db.select().from(promotionRevision).where(eq(promotionRevision.id, revisionId)).limit(1);
    if (!revision) throw new PromotionDomainError("PROMOTION_REVISION_NOT_FOUND", `Revision ${revisionId} not found`, 404);
    const targets = await this.db.select().from(promotionTarget).where(eq(promotionTarget.revisionId, revisionId));
    return { ...revision, targets };
  }

  async listRevisions(promotionId: string) {
    const [promo] = await this.db.select({ id: promotion.id }).from(promotion).where(eq(promotion.id, promotionId)).limit(1);
    if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${promotionId} not found`, 404);
    const revisions = await this.db
      .select()
      .from(promotionRevision)
      .where(eq(promotionRevision.promotionId, promotionId))
      .orderBy(desc(promotionRevision.revisionNumber));
    const targets = await this.db
      .select()
      .from(promotionTarget)
      .where(inArray(promotionTarget.revisionId, revisions.map((revision) => revision.id).concat("__none__")));
    const byRevision = new Map<string, typeof targets>();
    for (const target of targets) {
      const list = byRevision.get(target.revisionId) ?? [];
      list.push(target);
      byRevision.set(target.revisionId, list);
    }
    return revisions.map((revision) => ({ ...revision, targets: byRevision.get(revision.id) ?? [] }));
  }

  /* ── Scheduler support (explicit, audited) ──────────────────────────── */

  /** Worker entry: applies a claimed schedule row. Idempotent on DONE/CANCELLED. */
  async applySchedule(
    schedule: { id: string; promotionId: string; revisionId: string; action: string; status: string },
    workerId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const executor = tx as DbOrTx;
      const [current] = await executor.select().from(promotionSchedule).where(eq(promotionSchedule.id, schedule.id)).for("update").limit(1);
      if (!current) throw new PromotionDomainError("PROMOTION_SCHEDULE_NOT_FOUND", `Schedule ${schedule.id} not found`, 404);
      if (current.status === "DONE" || current.status === "CANCELLED") return { schedule: current, applied: false as const };
      const [promo] = await executor.select().from(promotion).where(eq(promotion.id, current.promotionId)).for("update").limit(1);
      if (!promo) throw new PromotionDomainError("PROMOTION_NOT_FOUND", `Promotion ${current.promotionId} not found`, 404);
      if (current.action === "ACTIVATE") {
        assertPromotionTransition(promo.status, "ACTIVE");
        if (promo.currentPublishedRevisionId !== current.revisionId) {
          throw new PromotionDomainError("PROMOTION_SCHEDULE_REVISION_STALE", "Scheduled revision is no longer current", 409);
        }
        await this.requirePublishedRevision(executor, promo);
        await executor.update(promotion).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(promotion.id, promo.id));
      } else {
        assertPromotionTransition(promo.status, "ENDED");
        await executor.update(promotion).set({ status: "ENDED", updatedAt: new Date() }).where(eq(promotion.id, promo.id));
        await this.cancelPendingSchedules(executor, promo.id);
      }
      const [done] = await executor
        .update(promotionSchedule)
        .set({ status: "DONE", updatedAt: new Date() })
        .where(eq(promotionSchedule.id, current.id))
        .returning();
      await this.audit.record({
        actorId: workerId, actorRole: "system", action: current.action === "ACTIVATE" ? "promotion.activated" : "promotion.ended",
        entityType: "promotion", entityId: promo.id,
        before: { status: promo.status }, after: { status: current.action === "ACTIVATE" ? "ACTIVE" : "ENDED", scheduleId: current.id },
      }, executor);
      return { schedule: done, applied: true as const };
    });
  }
}
