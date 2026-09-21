import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { promotion, promotionRevision, promotionSchedule } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { AuditService } from "../audit/audit.service";
import { JobLockService } from "../recovery/job-lock.service";
import type { PromotionActor } from "./promotions.contract";
import { PromotionCodes, PromotionDomainError, PromotionNotFoundError } from "./promotions.errors";
import {
  assertIdempotencyKey,
  assertScheduleAction,
  makePromotionId,
  parseDateInput,
  requireText,
} from "./promotions.logic";

type DbOrTx = KolbeDatabase | Parameters<Parameters<KolbeDatabase["transaction"]>[0]>[0];

/**
 * Durable scheduled activation / deactivation.
 *
 * Same shape as the CMS publication worker: schedule rows are claimed
 * (SCHEDULED → PROCESSING) under a session-level advisory lock, executed
 * inside one transaction each, and stale PROCESSING claims are recovered.
 * Schedules reference an already-published revision and flip lifecycle
 * only — they never author terms.
 */
@Injectable()
export class PromotionScheduleService {
  private readonly logger = new Logger(PromotionScheduleService.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobLockService) private readonly jobLock: JobLockService,
  ) {}

  private assertAdmin(actor: PromotionActor): void {
    if (actor?.role !== "admin") {
      throw new PromotionDomainError("PROMOTION_FORBIDDEN", "promotion writes require an admin actor", 403);
    }
    requireText(actor?.userId, "actor.userId", 128);
  }

  async scheduleAction(
    actor: PromotionActor,
    promotionId: string,
    input: { action: string; revisionId?: string | null; scheduledAt: unknown; idempotencyKey: string },
  ) {
    this.assertAdmin(actor);
    const pid = requireText(promotionId, "promotionId", 128);
    const action = assertScheduleAction(input?.action);
    const scheduledAt = parseDateInput(input?.scheduledAt, "scheduledAt");
    if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
      throw new PromotionDomainError(PromotionCodes.SCHEDULE_INVALID, "scheduledAt must be in the future");
    }
    const idempotencyKey = assertIdempotencyKey(input?.idempotencyKey);
    const revisionId = input?.revisionId === null || input?.revisionId === undefined || input?.revisionId === ""
      ? null
      : requireText(input.revisionId, "revisionId", 128);

    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(promotionSchedule).where(eq(promotionSchedule.idempotencyKey, idempotencyKey)).limit(1);
      if (existing) return { schedule: existing, replayed: true };

      const [promo] = await tx.select().from(promotion).where(eq(promotion.id, pid)).for("update").limit(1);
      if (!promo) throw new PromotionNotFoundError("promotion", pid);
      const targetRevisionId = revisionId ?? promo.currentPublishedRevisionId;
      if (!targetRevisionId) {
        throw new PromotionDomainError(PromotionCodes.REVISION_REQUIRED, "scheduling requires a published revision");
      }
      const [revision] = await tx.select().from(promotionRevision).where(eq(promotionRevision.id, targetRevisionId)).limit(1);
      if (!revision || revision.promotionId !== pid || revision.status !== "PUBLISHED") {
        throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "schedule target must be a published revision of the promotion");
      }
      if (revisionId && revisionId !== promo.currentPublishedRevisionId) {
        throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "schedule target must be the current published revision");
      }

      if (action === "ACTIVATE") {
        if (promo.status !== "IN_REVIEW" && promo.status !== "SCHEDULED" && promo.status !== "DRAFT" && promo.status !== "PAUSED") {
          throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Cannot schedule activation from ${promo.status}`);
        }
        if (promo.status !== "SCHEDULED") {
          await tx.update(promotion).set({ status: "SCHEDULED", updatedAt: new Date() }).where(eq(promotion.id, pid));
        }
      } else {
        if (promo.status !== "ACTIVE" && promo.status !== "PAUSED" && promo.status !== "SCHEDULED") {
          throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Cannot schedule deactivation from ${promo.status}`);
        }
      }

      const [schedule] = await tx
        .insert(promotionSchedule)
        .values({
          id: makePromotionId("psched"),
          promotionId: pid,
          revisionId: targetRevisionId,
          action,
          scheduledAt,
          status: "SCHEDULED",
          idempotencyKey,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.schedule.created",
          entityType: "promotion_schedule",
          entityId: schedule.id,
          after: { promotionId: pid, action, scheduledAt },
        },
        tx,
      );
      return { schedule, replayed: false };
    });
  }

  async cancelSchedule(actor: PromotionActor, scheduleId: string) {
    this.assertAdmin(actor);
    const key = requireText(scheduleId, "scheduleId", 128);
    return this.db.transaction(async (tx) => {
      const [schedule] = await tx.select().from(promotionSchedule).where(eq(promotionSchedule.id, key)).for("update").limit(1);
      if (!schedule) throw new PromotionNotFoundError("promotion_schedule", key);
      if (schedule.status !== "SCHEDULED") {
        throw new PromotionDomainError(PromotionCodes.SCHEDULE_INVALID, `Cannot cancel a ${schedule.status} schedule`);
      }
      const [updated] = await tx
        .update(promotionSchedule)
        .set({ status: "CANCELLED", lastError: null })
        .where(eq(promotionSchedule.id, key))
        .returning();
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: "admin",
          action: "promotion.schedule.cancelled",
          entityType: "promotion_schedule",
          entityId: key,
          after: { promotionId: schedule.promotionId, action: schedule.action },
        },
        tx,
      );
      return updated;
    });
  }

  async processDueSchedules(now = new Date(), limit = 25) {
    return this.jobLock.withSessionLock("job:promotions:schedule", async () => {
      const max = Math.min(Math.max(limit, 1), 100);
      const due = await this.db
        .select()
        .from(promotionSchedule)
        .where(and(eq(promotionSchedule.status, "SCHEDULED"), lte(promotionSchedule.scheduledAt, now)))
        .orderBy(asc(promotionSchedule.scheduledAt), asc(promotionSchedule.id))
        .limit(max);
      const results: Array<{ id: string; executed: boolean; error?: string }> = [];
      for (const schedule of due) {
        try {
          const executed = await this.db.transaction(async (tx) => {
            const [claimed] = await tx
              .update(promotionSchedule)
              .set({ status: "PROCESSING", claimedAt: new Date(), attemptCount: sql`${promotionSchedule.attemptCount} + 1` })
              .where(and(eq(promotionSchedule.id, schedule.id), eq(promotionSchedule.status, "SCHEDULED")))
              .returning();
            if (!claimed) return false;
            await this.executeScheduleInTransaction(tx, claimed);
            await tx
              .update(promotionSchedule)
              .set({ status: "EXECUTED", executedAt: new Date(), lastError: null })
              .where(eq(promotionSchedule.id, claimed.id));
            return true;
          });
          results.push({ id: schedule.id, executed });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown schedule error";
          await this.db
            .update(promotionSchedule)
            .set({ status: "FAILED", lastError: message })
            .where(eq(promotionSchedule.id, schedule.id));
          this.logger.error(`Promotion schedule ${schedule.id} failed: ${message}`);
          results.push({ id: schedule.id, executed: false, error: message });
        }
      }
      return results;
    });
  }

  private async executeScheduleInTransaction(
    tx: DbOrTx,
    schedule: { id: string; promotionId: string; revisionId: string; action: string },
  ): Promise<void> {
    const [promo] = await tx.select().from(promotion).where(eq(promotion.id, schedule.promotionId)).for("update").limit(1);
    if (!promo) throw new PromotionNotFoundError("promotion", schedule.promotionId);
    if (schedule.action === "ACTIVATE") {
      // Terms must not have shifted under the schedule.
      if (promo.currentPublishedRevisionId !== schedule.revisionId) {
        throw new PromotionDomainError(PromotionCodes.REVISION_MISMATCH, "scheduled revision is no longer current");
      }
      if (promo.status === "ACTIVE") return; // idempotent: already live.
      if (promo.status !== "SCHEDULED" && promo.status !== "PAUSED") {
        throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Cannot activate from ${promo.status}`);
      }
      await tx.update(promotion).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(promotion.id, promo.id));
      await this.audit.record(
        {
          actorId: "system",
          actorRole: "system",
          action: "promotion.schedule.activated",
          entityType: "promotion",
          entityId: promo.id,
          after: { scheduleId: schedule.id, revisionId: schedule.revisionId },
        },
        tx,
      );
      return;
    }
    if (promo.status === "ENDED") return; // idempotent: already ended.
    if (promo.status !== "ACTIVE" && promo.status !== "PAUSED" && promo.status !== "SCHEDULED") {
      throw new PromotionDomainError(PromotionCodes.INVALID_TRANSITION, `Cannot deactivate from ${promo.status}`);
    }
    await tx.update(promotion).set({ status: "ENDED", updatedAt: new Date() }).where(eq(promotion.id, promo.id));
    await this.audit.record(
      {
        actorId: "system",
        actorRole: "system",
        action: "promotion.schedule.deactivated",
        entityType: "promotion",
        entityId: promo.id,
        after: { scheduleId: schedule.id },
      },
      tx,
    );
  }

  async recoverStaleSchedules(ageMinutes = 15) {
    const cutoff = new Date(Date.now() - Math.max(ageMinutes, 1) * 60_000);
    const locked = await this.jobLock.withSessionLock("job:promotions:schedule", async () =>
      this.db
        .update(promotionSchedule)
        .set({ status: "SCHEDULED", claimedAt: null, lastError: "Recovered stale processing claim" })
        .where(and(eq(promotionSchedule.status, "PROCESSING"), lte(promotionSchedule.claimedAt, cutoff)))
        .returning({ id: promotionSchedule.id }),
    );
    const recovered = locked.result ?? [];
    if (recovered.length > 0) {
      await this.audit.record({
        actorId: "system",
        actorRole: "system",
        action: "promotion.schedule.stale_claim_recovered",
        entityType: "promotion_schedule",
        entityId: "promotion_schedule",
        after: { count: recovered.length, ageMinutes },
      });
    }
    return recovered;
  }
}

@Injectable()
export class PromotionScheduleRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(PromotionScheduleRunner.name);

  constructor(
    @Inject(PromotionScheduleService) private readonly schedules: PromotionScheduleService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const enabled = process.env.ENABLE_PROMOTION_SCHEDULER === "true" || this.config.recovery?.schedulerEnabled === true;
    if (!enabled) return;
    const intervalMs = Math.max(5_000, Number(process.env.PROMOTION_SCHEDULE_INTERVAL_MS ?? this.config.recovery?.intervalMs ?? 60_000));
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.schedules
        .processDueSchedules()
        .catch((error) => this.logger.error(`Promotion schedule tick failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  run(now = new Date()) {
    return this.schedules.processDueSchedules(now);
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
