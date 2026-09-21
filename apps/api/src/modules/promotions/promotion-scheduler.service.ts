/**
 * Phase 5.7 — durable scheduled activation/ending.
 *
 * Same pattern as CMS publication scheduling: a session-level advisory lock
 * elects a single worker, due rows are claimed atomically (double-claim
 * impossible), applied through the audited `applySchedule` path, and retried
 * with a bounded attempt budget before parking as FAILED. Crashed claims are
 * recovered back to SCHEDULED. The interval loop is opt-in via
 * `ENABLE_PROMOTION_SCHEDULER=true` (off in tests; tests call the methods).
 */

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { promotionSchedule, type KolbeDatabase } from "@kolbe/database";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { JobLockService } from "../recovery/job-lock.service";
import { PromotionService } from "./promotion.service";

const SCHEDULER_LOCK = "job:promotions:scheduler";
const WORKER_ID = "promotion-scheduler";
const MAX_ATTEMPTS = 5;

@Injectable()
export class PromotionSchedulerService {
  private readonly logger = new Logger(PromotionSchedulerService.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobLockService) private readonly jobLock: JobLockService,
    @Inject(PromotionService) private readonly promotions: PromotionService,
  ) {}

  async processDueSchedules(now = new Date(), limit = 25) {
    const locked = await this.jobLock.withSessionLock(SCHEDULER_LOCK, async () => {
      const max = Math.min(Math.max(limit, 1), 100);
      const due = await this.db
        .select()
        .from(promotionSchedule)
        .where(and(eq(promotionSchedule.status, "SCHEDULED"), lte(promotionSchedule.runAt, now)))
        .orderBy(asc(promotionSchedule.runAt), promotionSchedule.id)
        .limit(max);
      const results: Array<{ id: string; applied: boolean; error?: string }> = [];
      for (const schedule of due) {
        const [claimed] = await this.db
          .update(promotionSchedule)
          .set({
            status: "CLAIMED",
            claimedBy: WORKER_ID,
            claimedAt: new Date(),
            attempts: sql`${promotionSchedule.attempts} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(promotionSchedule.id, schedule.id), eq(promotionSchedule.status, "SCHEDULED")))
          .returning();
        if (!claimed) {
          results.push({ id: schedule.id, applied: false });
          continue;
        }
        try {
          const outcome = await this.promotions.applySchedule(claimed, WORKER_ID);
          results.push({ id: schedule.id, applied: outcome.applied });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown schedule error";
          const exhausted = claimed.attempts >= MAX_ATTEMPTS;
          await this.db
            .update(promotionSchedule)
            .set({
              status: exhausted ? "FAILED" : "SCHEDULED",
              claimedBy: null,
              claimedAt: null,
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(promotionSchedule.id, claimed.id));
          this.logger.error(`Promotion schedule ${claimed.id} failed (attempt ${claimed.attempts}): ${message}`);
          results.push({ id: schedule.id, applied: false, error: message });
        }
      }
      return results;
    });
    return locked.executed ? (locked.result ?? []) : [];
  }

  async recoverStaleClaims(ageMinutes = 15) {
    const cutoff = new Date(Date.now() - Math.max(ageMinutes, 1) * 60_000);
    const locked = await this.jobLock.withSessionLock(SCHEDULER_LOCK, async () =>
      this.db
        .update(promotionSchedule)
        .set({ status: "SCHEDULED", claimedBy: null, claimedAt: null, lastError: "Recovered stale scheduler claim", updatedAt: new Date() })
        .where(and(eq(promotionSchedule.status, "CLAIMED"), lte(promotionSchedule.claimedAt, cutoff)))
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
export class PromotionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(PromotionScheduler.name);

  constructor(@Inject(PromotionSchedulerService) private readonly scheduler: PromotionSchedulerService) {}

  onApplicationBootstrap(): void {
    if (process.env.ENABLE_PROMOTION_SCHEDULER !== "true") return;
    const intervalMs = Math.max(5_000, Number(process.env.PROMOTION_SCHEDULER_INTERVAL_MS ?? 60_000));
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.scheduler
        .processDueSchedules()
        .then(() => this.scheduler.recoverStaleClaims())
        .catch((error) => this.logger.error(`Promotion scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`))
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
    return this.scheduler.processDueSchedules(now);
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}
