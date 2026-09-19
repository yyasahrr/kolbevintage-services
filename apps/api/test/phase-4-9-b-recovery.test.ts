/**
 * Phase 4.9 — Checkpoint B: Data Safety, Distributed Job Locks & Crash Recovery
 *
 * Covers:
 *  1. PostgreSQL Connection Pooling & Timeout Safety Configuration
 *  2. Advisory Lock Concurrency & Mutex Safety (`JobLockService`):
 *     - Single-worker election (duplicate workers skip gracefully)
 *     - Non-blocking behavior
 *     - Automatic release on job completion, error, or client crash/disconnect
 *     - Transaction-scoped advisory locks (`pg_try_advisory_xact_lock`)
 *  3. Domain Recovery Routines:
 *     - Inventory: expired hold cleanup & stock release
 *     - Shipping: stale carrier event reclamation & pending dispatch sweeps
 *     - Payments: stale webhook event reclamation & unresolved payment sweeps
 *     - Settlement: payout status reconciliation & balance projection sweeps
 *  4. Recovery Orchestrator (`RecoveryService.runAll`):
 *     - Fault isolation across domains
 *     - Consolidated recovery summary
 *     - Concurrent orchestrator collision prevention
 *  5. Admin HTTP Recovery Controller:
 *     - Role-based authorization (admin only, rejects non-admin / unauthenticated)
 *     - Status inspection & routine dispatch
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@kolbe/database";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import { JobLockService } from "../src/modules/recovery/job-lock.service";
import { RecoveryService } from "../src/modules/recovery/recovery.service";
import { RecoveryScheduler } from "../src/modules/recovery/recovery.scheduler";
import { loadConfig } from "../src/config/configuration";

const TEST_DB = "kolbe_phase_4_9_recovery_test";

let h: Harness;
let ctx: SupplierContext;
let jobLockService: JobLockService;
let recoveryService: RecoveryService;
let recoveryScheduler: RecoveryScheduler;

const cookie = (userId: string, role: string) =>
  `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

describe("Phase 4.9 — Checkpoint B: Data Safety, Distributed Job Locks & Recovery", () => {
  beforeAll(async () => {
    h = await bootHarness(TEST_DB);
    ctx = await seedTwoSuppliers(h.db);
    jobLockService = h.app.get(JobLockService);
    recoveryService = h.app.get(RecoveryService);
    recoveryScheduler = h.app.get(RecoveryScheduler);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 1. PostgreSQL Connection Pooling & Timeout Safety Configuration
   * ────────────────────────────────────────────────────────────────────────── */
  describe("1. Database Connection Pool & Timeout Safety", () => {
    it("loads pool size, idle timeout, connection timeout, and statement timeout defaults", () => {
      const cfg = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: process.env.DATABASE_URL,
      } as NodeJS.ProcessEnv);

      expect(cfg.database).toBeDefined();
      expect(cfg.database.poolMax).toBeGreaterThanOrEqual(10);
      expect(cfg.database.poolMin).toBeGreaterThanOrEqual(0);
      expect(cfg.database.idleTimeoutMs).toBe(30000);
      expect(cfg.database.connectionTimeoutMs).toBe(5000);
      expect(cfg.database.statementTimeoutMs).toBe(15000);
    });

    it("respects custom environment overrides for pool and timeout limits", () => {
      const customEnv = {
        NODE_ENV: "test",
        DATABASE_URL: process.env.DATABASE_URL,
        DATABASE_POOL_MAX: "25",
        DATABASE_POOL_MIN: "5",
        DATABASE_IDLE_TIMEOUT_MS: "45000",
        DATABASE_CONNECTION_TIMEOUT_MS: "8000",
        DATABASE_STATEMENT_TIMEOUT_MS: "20000",
      } as NodeJS.ProcessEnv;

      const cfg = loadConfig(customEnv);
      expect(cfg.database.poolMax).toBe(25);
      expect(cfg.database.poolMin).toBe(5);
      expect(cfg.database.idleTimeoutMs).toBe(45000);
      expect(cfg.database.connectionTimeoutMs).toBe(8000);
      expect(cfg.database.statementTimeoutMs).toBe(20000);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 2. Advisory Lock Concurrency & Mutex Safety (JobLockService)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("2. Advisory Lock Concurrency & Mutex Safety", () => {
    it("guarantees single-worker execution: second worker skips immediately when lock is held", async () => {
      const lockKey = "test:concurrency:worker_mutex";
      let worker1Started = false;
      let worker1Finished = false;
      let worker2Ran = false;

      // Start worker 1 which holds the lock for 100ms
      const worker1Promise = jobLockService.withSessionLock(lockKey, async () => {
        worker1Started = true;
        await new Promise((r) => setTimeout(r, 100));
        worker1Finished = true;
        return "WORKER_1_DONE";
      });

      // Wait until worker 1 has definitely acquired the lock
      while (!worker1Started) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Concurrently attempt worker 2 on the same lockKey
      const worker2Result = await jobLockService.withSessionLock(lockKey, async () => {
        worker2Ran = true;
        return "WORKER_2_DONE";
      });

      // Worker 2 must have skipped without executing
      expect(worker2Result.executed).toBe(false);
      expect(worker2Ran).toBe(false);

      const worker1Result = await worker1Promise;
      expect(worker1Result.executed).toBe(true);
      expect(worker1Result.result).toBe("WORKER_1_DONE");
      expect(worker1Finished).toBe(true);
    });

    it("allows subsequent worker to acquire lock once previous worker completes", async () => {
      const lockKey = "test:concurrency:subsequent_execution";

      const firstRun = await jobLockService.withSessionLock(lockKey, async () => {
        return "PASS_1";
      });
      expect(firstRun.executed).toBe(true);
      expect(firstRun.result).toBe("PASS_1");

      const isLockedAfterFirst = await jobLockService.isLocked(lockKey);
      expect(isLockedAfterFirst).toBe(false);

      const secondRun = await jobLockService.withSessionLock(lockKey, async () => {
        return "PASS_2";
      });
      expect(secondRun.executed).toBe(true);
      expect(secondRun.result).toBe("PASS_2");
    });

    it("releases session advisory lock even when the worker function throws an exception", async () => {
      const lockKey = "test:concurrency:exception_cleanup";

      await expect(
        jobLockService.withSessionLock(lockKey, async () => {
          throw new Error("Worker simulation crash");
        }),
      ).rejects.toThrow("Worker simulation crash");

      // Verify the lock was freed in finally block
      const isLocked = await jobLockService.isLocked(lockKey);
      expect(isLocked).toBe(false);

      // Subsequent worker can run without obstruction
      const nextRun = await jobLockService.withSessionLock(lockKey, async () => {
        return "RECOVERED_AFTER_EXCEPTION";
      });
      expect(nextRun.executed).toBe(true);
      expect(nextRun.result).toBe("RECOVERED_AFTER_EXCEPTION");
    });

    it("transaction-scoped advisory lock releases automatically at transaction commit/rollback", async () => {
      const lockKey = "test:concurrency:xact_lock";
      let inTx = false;

      // Start transaction 1
      const tx1Promise = jobLockService.withTransactionLock(lockKey, async (tx) => {
        inTx = true;
        // Verify we can execute inside transaction
        await tx.execute(sql`SELECT 1`);
        await new Promise((r) => setTimeout(r, 100));
        return "TX_1_SUCCESS";
      });

      while (!inTx) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Try running transaction 2 concurrently on same lock
      const tx2Result = await jobLockService.withTransactionLock(lockKey, async () => {
        return "TX_2_SHOULD_SKIP";
      });
      expect(tx2Result.executed).toBe(false);

      const tx1Result = await tx1Promise;
      expect(tx1Result.executed).toBe(true);
      expect(tx1Result.result).toBe("TX_1_SUCCESS");

      // Lock should now be unlocked
      const isLocked = await jobLockService.isLocked(lockKey);
      expect(isLocked).toBe(false);
    });

    it("simulates client crash / abrupt termination: PostgreSQL drops advisory lock on disconnect", async () => {
      const lockKey = "test:concurrency:abrupt_disconnect";
      const client = await h.pool.connect();

      // Client acquires advisory lock
      const res = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) as acquired",
        [lockKey],
      );
      expect(res.rows[0].acquired).toBe(true);

      expect(await jobLockService.isLocked(lockKey)).toBe(true);

      // Simulate crash: destroy connection abruptly without explicit unlock
      client.release(true);

      // Brief wait for PostgreSQL process connection cleanup
      await new Promise((r) => setTimeout(r, 80));

      expect(await jobLockService.isLocked(lockKey)).toBe(false);

      // Next worker can acquire lock immediately
      const nextWorker = await jobLockService.withSessionLock(lockKey, async () => {
        return "ACQUIRED_AFTER_CRASH";
      });
      expect(nextWorker.executed).toBe(true);
      expect(nextWorker.result).toBe("ACQUIRED_AFTER_CRASH");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 3. Domain Recovery Routines
   * ────────────────────────────────────────────────────────────────────────── */
  describe("3. Domain Recovery Routines", () => {
    it("inventory recovery: cleans up expired holds, releases reserved stock, and inserts ledger RELEASE", async () => {
      const resId = makeId("res_expired");
      const initialReserved = 5;
      const reservationQty = 3;

      // Set variant inventory reserved stock to 5
      await h.db
        .update(schema.productVariantInventory)
        .set({ reserved: initialReserved })
        .where(eq(schema.productVariantInventory.variantId, ctx.varId));

      // Insert an expired reservation (expired 30 minutes ago)
      const expiresAt = new Date(Date.now() - 30 * 60 * 1000);
      await h.db.insert(schema.inventoryReservation).values({
        id: resId,
        variantId: ctx.varId,
        sellerId: ctx.sellerA,
        quantity: reservationQty,
        status: "active",
        expiresAt,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      } as any);

      // Execute inventory recovery
      const recoveryResult = await recoveryService.runInventoryHoldCleanup();
      expect(recoveryResult.executed).toBe(true);
      expect(recoveryResult.result?.releasedCount).toBeGreaterThanOrEqual(1);

      // Check reservation status changed to expired
      const [updatedRes] = await h.db
        .select()
        .from(schema.inventoryReservation)
        .where(eq(schema.inventoryReservation.id, resId))
        .limit(1);
      expect(updatedRes.status).toBe("expired");

      // Check variant inventory reserved count was decremented
      const [inv] = await h.db
        .select()
        .from(schema.productVariantInventory)
        .where(eq(schema.productVariantInventory.variantId, ctx.varId))
        .limit(1);
      expect(inv.reserved).toBe(initialReserved - reservationQty);

      // Check ledger recorded a RELEASE entry
      const ledgerRows = await h.db
        .select()
        .from(schema.inventoryLedger)
        .where(
          and(
            eq(schema.inventoryLedger.variantId, ctx.varId),
            eq(schema.inventoryLedger.changeType, "RELEASE"),
          ),
        );
      expect(ledgerRows.length).toBeGreaterThanOrEqual(1);
      expect(ledgerRows.some((l) => l.reason?.includes(resId))).toBe(true);

      // Idempotency: second run finds 0 additional expired reservations
      const secondRun = await recoveryService.runInventoryHoldCleanup();
      expect(secondRun.executed).toBe(true);
      expect(secondRun.result?.releasedCount).toBe(0);
    });

    it("shipping recovery: reclaims stale processing events and scans pending shipments", async () => {
      const eventId = makeId("shpe_stale");
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Insert shipment event stuck in 'processing' status
      await h.db.insert(schema.shipmentEvent).values({
        id: eventId,
        provider: "fake",
        externalEventId: `ext_${eventId}`,
        eventType: "shipment.in_transit",
        payloadHash: "dummyhash",
        safeMetadata: { trackingCode: "FAKE-123" },
        status: "processing",
        receivedAt: thirtyMinutesAgo,
        createdAt: thirtyMinutesAgo,
        updatedAt: thirtyMinutesAgo,
      } as any);

      const recoveryResult = await recoveryService.runShippingRecovery({
        staleMinutes: 10,
        limit: 50,
      });

      expect(recoveryResult.executed).toBe(true);
      expect(recoveryResult.result?.reclaimedEventsCount).toBeGreaterThanOrEqual(1);

      // Verify the event transitioned to failed with failure reason
      const [reclaimed] = await h.db
        .select()
        .from(schema.shipmentEvent)
        .where(eq(schema.shipmentEvent.id, eventId))
        .limit(1);
      expect(reclaimed.status).toBe("failed");
      expect(reclaimed.failureReason).toBe("stale_processing_reclaimed");

      // Idempotent: subsequent sweep finds 0 stale processing events
      const secondRun = await recoveryService.runShippingRecovery({ staleMinutes: 10 });
      expect(secondRun.executed).toBe(true);
      expect(secondRun.result?.reclaimedEventsCount).toBe(0);
    });

    it("payments recovery: reclaims stale webhook events and scans unresolved provider payments", async () => {
      const eventId = makeId("payev_stale");
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Insert payment provider event stuck in 'processing' status
      await h.db.insert(schema.paymentProviderEvent).values({
        id: eventId,
        provider: "fake",
        externalEventId: `ext_${eventId}`,
        eventType: "payment.pending",
        payloadHash: "dummyhash",
        safeMetadata: { amount: "1000" },
        status: "processing",
        receivedAt: thirtyMinutesAgo,
        createdAt: thirtyMinutesAgo,
        updatedAt: thirtyMinutesAgo,
      } as any);

      const recoveryResult = await recoveryService.runPaymentsRecovery({
        staleMinutes: 10,
        limit: 50,
      });

      expect(recoveryResult.executed).toBe(true);
      expect(recoveryResult.result?.reclaimedEventsCount).toBeGreaterThanOrEqual(1);

      // Verify status transitioned to failed
      const [reclaimed] = await h.db
        .select()
        .from(schema.paymentProviderEvent)
        .where(eq(schema.paymentProviderEvent.id, eventId))
        .limit(1);
      expect(reclaimed.status).toBe("failed");
      expect(reclaimed.failureReason).toBe("stale_processing_reclaimed");
    });

    it("settlement recovery: runs payout status reconciliation and projection drift checks", async () => {
      const recoveryResult = await recoveryService.runSettlementRecovery({
        olderThanMinutes: 10,
        actorId: ctx.userAdmin,
      });

      expect(recoveryResult.executed).toBe(true);
      expect(recoveryResult.result).toBeDefined();
      expect(recoveryResult.result?.payoutReconciliation.runId).toMatch(/^srec_/);
      expect(recoveryResult.result?.projectionReconciliation.status).toMatch(
        /^(completed|mismatch_detected)$/,
      );
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 4. Recovery Orchestrator (runAll) & Fault Isolation
   * ────────────────────────────────────────────────────────────────────────── */
  describe("4. Recovery Orchestrator & Fault Isolation", () => {
    it("runs all recovery domains and compiles a full status report", async () => {
      const summary = await recoveryService.runAll({ actorId: ctx.userAdmin });

      expect(summary.timestamp).toBeDefined();
      expect(summary.allSuccessful).toBe(true);
      expect(summary.inventory.executed).toBe(true);
      expect(summary.shipping.executed).toBe(true);
      expect(summary.payments.executed).toBe(true);
      expect(summary.settlement.executed).toBe(true);
    });

    it("fault isolation: an unexpected error in one domain does not prevent others from completing", async () => {
      // Temporarily sabotage shippingService.reclaimStaleProcessingEvents
      const originalReclaim = h.shippingService.reclaimStaleProcessingEvents;
      h.shippingService.reclaimStaleProcessingEvents = async () => {
        throw new Error("Simulated carrier gateway outage");
      };

      try {
        const summary = await recoveryService.runAll({ actorId: ctx.userAdmin });

        // Overall marked as not completely successful
        expect(summary.allSuccessful).toBe(false);

        // Shipping reported failure
        expect(summary.shipping.executed).toBe(false);
        expect((summary.shipping as any).error).toContain("Simulated carrier gateway outage");

        // Remaining three domains executed successfully
        expect(summary.inventory.executed).toBe(true);
        expect(summary.payments.executed).toBe(true);
        expect(summary.settlement.executed).toBe(true);
      } finally {
        h.shippingService.reclaimStaleProcessingEvents = originalReclaim;
      }
    });

    it("concurrent orchestrator runs: parallel runAll calls do not duplicate operations", async () => {
      const [run1, run2] = await Promise.all([
        recoveryService.runAll({ actorId: ctx.userAdmin }),
        recoveryService.runAll({ actorId: ctx.userAdmin }),
      ]);

      // Both complete without throwing
      expect(run1).toBeDefined();
      expect(run2).toBeDefined();

      // For any domain, at least one worker executed and the other either executed sequentially or skipped cleanly
      expect(run1.inventory.executed || run2.inventory.executed).toBe(true);
      expect(run1.shipping.executed || run2.shipping.executed).toBe(true);
      expect(run1.payments.executed || run2.payments.executed).toBe(true);
      expect(run1.settlement.executed || run2.settlement.executed).toBe(true);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 5. Admin HTTP Recovery Controller & RBAC
   * ────────────────────────────────────────────────────────────────────────── */
  describe("5. Admin HTTP Recovery Controller", () => {
    it("rejects unauthenticated requests to recovery status (401)", async () => {
      const res = await api().get("/api/v1/admin/recovery/status");
      expect(res.status).toBe(401);
    });

    it("rejects non-admin role requests to recovery status (403)", async () => {
      const res = await api()
        .get("/api/v1/admin/recovery/status")
        .set("Cookie", cookie(ctx.userBuyer, "vip"));
      expect(res.status).toBe(403);
    });

    it("rejects supplier requests to trigger recovery (403)", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", cookie(ctx.userAOwner, "supplier"))
        .send({ routine: "all" });
      expect(res.status).toBe(403);
    });

    it("allows admin to inspect recovery locks and scheduler status (200)", async () => {
      const res = await api()
        .get("/api/v1/admin/recovery/status")
        .set("Cookie", cookie(ctx.userAdmin, "admin"));

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      expect(res.body.schedulerRunning).toBe(false);
      expect(res.body.locks).toBeDefined();
      expect(typeof res.body.locks.inventoryHolds).toBe("boolean");
      expect(typeof res.body.locks.shippingEvents).toBe("boolean");
      expect(typeof res.body.locks.payments).toBe("boolean");
      expect(typeof res.body.locks.settlement).toBe("boolean");
    });

    it("allows admin to trigger domain recovery via HTTP (201/200)", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", cookie(ctx.userAdmin, "admin"))
        .send({ routine: "inventory" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.routine).toBe("inventory");
      expect(res.body.results.executed).toBe(true);
    });
  });
});
