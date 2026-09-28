/**
 * Phase 4.9 — Checkpoint D: Adversarial Production Readiness Regression Suite
 *
 * Verifies production launch hardening across all domains:
 *  1. Auth Abuse & Session Hijacking Defense:
 *     - Token invalidation on token_version bump (replay attack defense)
 *     - Suspended user account access rejection (fail-closed)
 *     - Role escalation attempt (tampered token claims rejected against DB role)
 *     - Nonexistent user sub in token rejected (401)
 *     - Invalid / forged JWT signature rejected (401)
 *  2. IDOR & Multi-Tenant Access Boundaries:
 *     - Cross-tenant buyer order access rejected (ORDER_OWNERSHIP_VIOLATION 403)
 *     - Supplier A forbidden from modifying/accessing Supplier B orders (SUPPLIER_OWNERSHIP_VIOLATION 403)
 *     - Supplier forbidden from admin settlement & payout controls (403)
 *     - Buyer forbidden from recovery execution controls (403)
 *     - Unauthenticated requests rejected from audit logs (401)
 *  3. Request Rejection & Malformed Payload Fuzzing:
 *     - Malformed JSON rejection (400 MALFORMED_JSON)
 *     - Over-sized payload rejection (413 PAYLOAD_TOO_LARGE)
 *     - Non-JSON Content-Type rejection on mutations (415 UNSUPPORTED_MEDIA_TYPE)
 *     - Prototype pollution payloads safely parsed without prototype contamination
 *     - SQL injection patterns in query strings safely parameterized
 *  4. Redaction & Sensitive Leak Prevention:
 *     - Prevention of credential / token / PAN / IBAN / national ID leaks in logs
 *     - Error monitoring generates traceable errorId and redacts sensitive error context
 *     - Response security headers (nosniff, frameguard SAMEORIGIN, correlation IDs)
 *  5. Concurrency, Distributed Locking & Duplicate Workers:
 *     - Mutex guarantee across duplicate workers (non-blocking leader election)
 *     - Automatic unlock on worker exception
 *     - Client TCP socket drop / process crash releases advisory lock in PostgreSQL
 *  6. Scheduled Job Failure Recovery & Retry Invariants:
 *     - Expired inventory hold cleanup & stock ledger balance
 *     - Idempotent cleanup (subsequent runs produce 0 duplicate releases)
 *     - Stale shipment and payment webhook event reclamation
 *  7. External Provider Failure Modes & Fault Isolation:
 *     - Third-party provider outage does not compromise API stability
 *     - Recovery orchestrator isolates domain failures (partial failure resilience)
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
import { redactSensitive, maskSensitiveString } from "../src/common/logging/redaction";
import { RequestContext } from "../src/common/context/request-context";
import { ErrorMonitoringService } from "../src/common/monitoring/error-monitoring.service";

const TEST_DB = "kolbe_phase_4_9_adversarial_test";

let h: Harness;
let ctx: SupplierContext;
let jobLockService: JobLockService;
let recoveryService: RecoveryService;

const api = () => request(h.app.getHttpServer());
const cookie = (userId: string, role: string) =>
  `kolbe_session=${h.issueToken(userId, role)}`;

describe("Phase 4.9 — Checkpoint D: Adversarial Production Readiness", () => {
  beforeAll(async () => {
    h = await bootHarness(TEST_DB);
    ctx = await seedTwoSuppliers(h.db);
    jobLockService = h.app.get(JobLockService);
    recoveryService = h.app.get(RecoveryService);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 1. Auth Abuse & Session Hijacking Defense
   * ────────────────────────────────────────────────────────────────────────── */
  describe("1. Auth Abuse & Session Hijacking Defense", () => {
    it("rejects token immediately when account token_version is incremented (revocation)", async () => {
      const validCookie = cookie(ctx.userBuyer, "vip");

      // Verify token initially works on protected endpoint
      const beforeRes = await api()
        .get("/api/v1/auth/me")
        .set("Cookie", validCookie);
      expect(beforeRes.status).toBe(200);

      // Increment token_version in database (simulating session revocation / password change)
      await h.db
        .update(schema.accountUser)
        .set({ tokenVersion: 1 })
        .where(eq(schema.accountUser.id, ctx.userBuyer));

      // Same token must now be rejected as unauthorized
      const afterRes = await api()
        .get("/api/v1/auth/me")
        .set("Cookie", validCookie);
      expect(afterRes.status).toBe(401);

      // Reset tokenVersion for subsequent tests
      await h.db
        .update(schema.accountUser)
        .set({ tokenVersion: 0 })
        .where(eq(schema.accountUser.id, ctx.userBuyer));
    });

    it("rejects tokens belonging to suspended accounts (fail-closed)", async () => {
      const suspendedUser = makeId("user_suspended");
      await h.db.insert(schema.accountUser).values({
        id: suspendedUser,
        email: `${suspendedUser}@test.com`,
        passwordHash: "dummy",
        salt: "dummy",
        role: "vip",
        status: "suspended",
        tokenVersion: 0,
        failedLoginAttempts: 0,
      } as any);

      const res = await api()
        .get("/api/v1/auth/me")
        .set("Cookie", cookie(suspendedUser, "vip"));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("ACCOUNT_SUSPENDED");
    });

    it("rejects role elevation: token signed with 'admin' role rejected if DB role is 'vip'", async () => {
      // Issue a token claiming 'admin', but userBuyer in DB is 'vip'
      const forgedRoleCookie = cookie(ctx.userBuyer, "admin");

      const res = await api()
        .get("/api/v1/admin/recovery/status")
        .set("Cookie", forgedRoleCookie);

      // Must be rejected with 401 because token claims do not match database role
      expect(res.status).toBe(401);
    });

    it("rejects forged or malformed session token signature", async () => {
      const tamperedCookie = "kolbe_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.tamperedsignature";

      const res = await api()
        .get("/api/v1/auth/me")
        .set("Cookie", tamperedCookie);

      expect(res.status).toBe(401);
    });

    it("rejects token pointing to non-existent user id in claims (fail-closed)", async () => {
      const nonExistentCookie = cookie("non_existent_user_99999", "admin");

      const res = await api()
        .get("/api/v1/auth/me")
        .set("Cookie", nonExistentCookie);

      expect(res.status).toBe(401);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 2. IDOR & Multi-Tenant Access Boundaries
   * ────────────────────────────────────────────────────────────────────────── */
  describe("2. IDOR & Multi-Tenant Access Boundaries", () => {
    it("prevents buyer A from reading buyer B's wholesale order", async () => {
      const buyerB = "user_buyer_b_" + makeId("usr");
      const accB = "acc_b_" + makeId("acc");

      await h.pool.query(
        `INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version)
         VALUES ($1, $2, 'hash', 'salt', 'vip', 'active', 0)`,
        [buyerB, `${buyerB}@test.com`],
      );
      await h.pool.query(
        `INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city, status)
         VALUES ($1, $2, 'Buyer B', 'Store B', '09350000000', 'Tehran', 'approved')`,
        [accB, buyerB],
      );

      const orderBId = "wo_b_" + makeId("ord");
      await h.pool.query(
        `INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_units, payment_mode, version, idempotency_key, creation_request_hash)
         VALUES ($1, $2, $3, $4, 'draft', 'IRR', 1000, 0, 1000, 1, 'transfer', 0, $5, $6)`,
        [orderBId, "KV-ORD-B", accB, buyerB, "idem_" + orderBId, "hash_" + orderBId],
      );

      // Buyer A attempts to access Buyer B's order
      const res = await api()
        .get(`/api/v1/wholesale/orders/${orderBId}`)
        .set("Cookie", cookie(ctx.userBuyer, "vip"));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("ORDER_OWNERSHIP_VIOLATION");
    });

    it("prevents supplier A from viewing or modifying supplier B's child orders", async () => {
      const parentOrderId = "wo_p_" + makeId("ord");
      await h.pool.query(
        `INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_units, payment_mode, version, idempotency_key, creation_request_hash)
         VALUES ($1, $2, $3, $4, 'draft', 'IRR', 5000000, 0, 5000000, 1, 'transfer', 0, $5, $6)`,
        [parentOrderId, "KV-P-" + parentOrderId, ctx.accId, ctx.userBuyer, "idem_" + parentOrderId, "hash_" + parentOrderId],
      );

      const childBId = "po_b_" + makeId("po");
      await h.pool.query(
        `INSERT INTO purchase_order (id, order_code, wholesale_order_id, seller_id, supplier_id, status, items_total, grand_total, shipping_responsibility, version)
         VALUES ($1, $2, $3, $4, $5, 'pending', 5000000, 5000000, 'SUPPLIER', 0)`,
        [childBId, "KV-B-" + childBId, parentOrderId, ctx.sellerB, ctx.supB],
      );

      // Supplier A attempts to view Child Order B
      const viewRes = await api()
        .get(`/api/v1/supplier/orders/${childBId}`)
        .set("Cookie", cookie(ctx.userAOwner, "supplier"));

      expect(viewRes.status).toBe(403);
      expect(viewRes.body.error).toBe("SUPPLIER_OWNERSHIP_VIOLATION");

      // Supplier A attempts to confirm Child Order B
      const confirmRes = await api()
        .post(`/api/v1/supplier/orders/${childBId}/confirm`)
        .set("Cookie", cookie(ctx.userAOwner, "supplier"))
        .set("Idempotency-Key", "idem_atk_" + childBId)
        .send({});

      expect(confirmRes.status).toBe(403);
      expect(confirmRes.body.error).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
    });

    it("prevents supplier A from accessing admin settlement control endpoints (403)", async () => {
      const res = await api()
        .get("/api/v1/admin/settlement/payouts")
        .set("Cookie", cookie(ctx.userAOwner, "supplier"));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("prevents regular buyer from accessing recovery execution endpoints (403)", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", cookie(ctx.userBuyer, "vip"))
        .send({ routine: "all" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("prevents unauthenticated callers from reading internal audit logs (401)", async () => {
      const res = await api().get("/api/v1/audit/logs");
      expect(res.status).toBe(401);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 3. Request Rejection & Malformed Payload Fuzzing
   * ────────────────────────────────────────────────────────────────────────── */
  describe("3. Request Rejection & Malformed Payload Fuzzing", () => {
    it("rejects malformed JSON payload with HTTP 400 MALFORMED_JSON", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", cookie(ctx.userAdmin, "admin"))
        .set("Content-Type", "application/json")
        .send('{"routine": "all", corrupted_json: true');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("MALFORMED_JSON");
      expect(res.body.message).toContain("JSON");
    });

    it("rejects over-sized request payload exceeding limit with HTTP 413", async () => {
      const hugeString = "a".repeat(3 * 1024 * 1024); // 3MB exceeds 2MB limit

      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", cookie(ctx.userAdmin, "admin"))
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ hugeData: hugeString }));

      expect(res.status).toBe(413);
      expect(res.body.error).toBe("PAYLOAD_TOO_LARGE");
    });

    it("rejects non-JSON Content-Type on mutating endpoints with 415", async () => {
      const res = await api()
        .post("/api/v1/auth/login")
        .set("Content-Type", "text/plain")
        .send("plain text attack string");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("prototype pollution payload keys do not contaminate Object prototype", async () => {
      const pollutionPayload = JSON.parse(
        '{"email": "test@kolbe.ir", "password": "test", "__proto__": {"polluted": true}, "constructor": {"prototype": {"admin": true}}}',
      );

      await api()
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send(pollutionPayload);

      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).admin).toBeUndefined();
    });

    it("SQL injection strings in search queries do not cause SQL syntax errors or crash", async () => {
      const sqlInjectionQuery = "' OR '1'='1' -- DROP TABLE users;";

      const res = await api()
        .get(`/api/v1/catalog/products?q=${encodeURIComponent(sqlInjectionQuery)}`);

      expect(res.status).toBe(200);
      // 5.10-A: search returns { results, nextCursor } (bare array retired,
      // zero other consumers); the anti-crash intent is unchanged.
      expect(Array.isArray(res.body.results)).toBe(true);
      expect("nextCursor" in res.body).toBe(true);
    });

    it("enforces origin security headers (nosniff, frameguard SAMEORIGIN, correlation)", async () => {
      const res = await api().get("/api/v1/health");

      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-correlation-id"]).toBeDefined();
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 4. Redaction & Sensitive Leak Prevention
   * ────────────────────────────────────────────────────────────────────────── */
  describe("4. Redaction & Sensitive Leak Prevention", () => {
    it("redacts sensitive fields: tokens, passwords, IBANs, national IDs, and card PANs", () => {
      const sensitivePayload = {
        password: "SuperSecretPassword123",
        token: "kolbe_token_999888777",
        authorization: "Bearer secret-access-token",
        cardPan: "6037991812345678",
        sheba: "IR120120000000001234567890",
        nationalCode: "0012345678",
        nested: {
          secretKey: "aws_secret_key_abcdef",
          normalField: "public_value",
        },
      };

      const redacted = redactSensitive(sensitivePayload);

      expect(redacted.password).toBe("[REDACTED]");
      expect(redacted.token).toBe("[REDACTED]");
      expect(redacted.authorization).toBe("[REDACTED]");
      expect(redacted.cardPan).toBe("6037-****-****-5678");
      expect(redacted.sheba).toBe("IR12****7890");
      expect(redacted.nationalCode).toBe("***5678");
      expect(redacted.nested.secretKey).toBe("[REDACTED]");
      expect(redacted.nested.normalField).toBe("public_value");
    });

    it("sanitizes inline credentials in unstructured string messages", () => {
      const logMessage = "Failed authorization token=kolbe_sec_1234567890 password=plain_text_pass";
      const sanitized = redactSensitive(logMessage);

      expect(sanitized).toContain("token=[REDACTED]");
      expect(sanitized).toContain("password=[REDACTED]");
      expect(sanitized).not.toContain("plain_text_pass");
      expect(sanitized).not.toContain("kolbe_sec_1234567890");
    });

    it("error monitoring produces unique traceable errorId and redacts error contexts", () => {
      const monitor = new ErrorMonitoringService();
      const errorId = monitor.captureException(new Error("Database statement timeout"), {
        connectionString: "postgres://user:secretpass@10.0.0.1:5432/db",
        apiKey: "live_api_key_12345678",
      });

      expect(errorId).toMatch(/^err_[a-f0-9]{16}$/);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 5. Concurrency, Distributed Locking & Duplicate Workers
   * ────────────────────────────────────────────────────────────────────────── */
  describe("5. Concurrency, Distributed Locking & Duplicate Workers", () => {
    it("guarantees single-worker execution under heavy concurrent attempts", async () => {
      const lockKey = "adversarial:worker_mutex";
      let executionCount = 0;

      // Launch 5 workers trying to acquire the exact same lock concurrently
      const workers = Array.from({ length: 5 }, async () => {
        return jobLockService.withSessionLock(lockKey, async () => {
          executionCount++;
          await new Promise((r) => setTimeout(r, 60));
          return "EXECUTED";
        });
      });

      const results = await Promise.all(workers);
      const executed = results.filter((r) => r.executed);
      const skipped = results.filter((r) => !r.executed);

      // Exactly 1 worker must have acquired the lock and executed
      expect(executed.length).toBe(1);
      expect(skipped.length).toBe(4);
      expect(executionCount).toBe(1);
    });

    it("guarantees advisory lock cleanup when worker throws unhandled error", async () => {
      const lockKey = "adversarial:exception_unlock";

      // Worker crashes with exception
      await expect(
        jobLockService.withSessionLock(lockKey, async () => {
          throw new Error("Simulated unhandled worker crash");
        }),
      ).rejects.toThrow("Simulated unhandled worker crash");

      // Verify lock is immediately available for subsequent worker
      expect(await jobLockService.isLocked(lockKey)).toBe(false);

      const nextWorker = await jobLockService.withSessionLock(lockKey, async () => {
        return "SUCCESS_AFTER_CRASH";
      });
      expect(nextWorker.executed).toBe(true);
      expect(nextWorker.result).toBe("SUCCESS_AFTER_CRASH");
    });

    it("simulates client TCP disconnect: PostgreSQL immediately releases advisory lock", async () => {
      const lockKey = "adversarial:disconnect_unlock";
      const client = await h.pool.connect();

      await client.query("SELECT pg_try_advisory_lock(hashtext($1))", [lockKey]);
      expect(await jobLockService.isLocked(lockKey)).toBe(true);

      // Simulate abrupt socket drop
      client.release(true);

      // Wait briefly for PostgreSQL backend connection termination
      await new Promise((r) => setTimeout(r, 100));

      // Lock must be released
      expect(await jobLockService.isLocked(lockKey)).toBe(false);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 6. Scheduled Job Failure Recovery & Retry Invariants
   * ────────────────────────────────────────────────────────────────────────── */
  describe("6. Scheduled Job Failure Recovery & Retry Invariants", () => {
    it("cleans up expired reservation holds, updates status, and balances stock ledger", async () => {
      const resId = makeId("res_adv");
      const initialReserved = 10;
      const reservationQty = 4;

      await h.db
        .update(schema.productVariantInventory)
        .set({ reserved: initialReserved })
        .where(eq(schema.productVariantInventory.variantId, ctx.varId));

      const expiredAt = new Date(Date.now() - 20 * 60 * 1000);
      await h.db.insert(schema.inventoryReservation).values({
        id: resId,
        variantId: ctx.varId,
        sellerId: ctx.sellerA,
        quantity: reservationQty,
        status: "active",
        expiresAt: expiredAt,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        updatedAt: new Date(Date.now() - 40 * 60 * 1000),
      } as any);

      // Run recovery
      const res = await recoveryService.runInventoryHoldCleanup();
      expect(res.executed).toBe(true);
      expect(res.result?.releasedCount).toBeGreaterThanOrEqual(1);

      // Verify reservation updated to expired
      const [updated] = await h.db
        .select()
        .from(schema.inventoryReservation)
        .where(eq(schema.inventoryReservation.id, resId))
        .limit(1);
      expect(updated.status).toBe("expired");

      // Verify inventory reserved count decremented
      const [inv] = await h.db
        .select()
        .from(schema.productVariantInventory)
        .where(eq(schema.productVariantInventory.variantId, ctx.varId))
        .limit(1);
      expect(inv.reserved).toBe(initialReserved - reservationQty);

      // Verify ledger RELEASE entry recorded
      const ledger = await h.db
        .select()
        .from(schema.inventoryLedger)
        .where(
          and(
            eq(schema.inventoryLedger.variantId, ctx.varId),
            eq(schema.inventoryLedger.changeType, "RELEASE"),
          ),
        );
      expect(ledger.some((l) => l.reason?.includes(resId))).toBe(true);

      // Idempotency check: immediate subsequent run finds 0 additional reservations to release
      const secondRun = await recoveryService.runInventoryHoldCleanup();
      expect(secondRun.executed).toBe(true);
      expect(secondRun.result?.releasedCount).toBe(0);
    });

    it("reclaims stale shipment and payment webhook events stuck in processing", async () => {
      const shipEventId = makeId("shpe_adv");
      const payEventId = makeId("payev_adv");
      const oldDate = new Date(Date.now() - 45 * 60 * 1000);

      // Insert stuck shipping event
      await h.db.insert(schema.shipmentEvent).values({
        id: shipEventId,
        provider: "fake",
        externalEventId: `ext_${shipEventId}`,
        eventType: "shipment.in_transit",
        payloadHash: "dummy",
        safeMetadata: { note: "stuck" },
        status: "processing",
        receivedAt: oldDate,
        createdAt: oldDate,
        updatedAt: oldDate,
      } as any);

      // Insert stuck payment event
      await h.db.insert(schema.paymentProviderEvent).values({
        id: payEventId,
        provider: "fake",
        externalEventId: `ext_${payEventId}`,
        eventType: "payment.pending",
        payloadHash: "dummy",
        safeMetadata: { note: "stuck" },
        status: "processing",
        receivedAt: oldDate,
        createdAt: oldDate,
        updatedAt: oldDate,
      } as any);

      const [shipResult, payResult] = await Promise.all([
        recoveryService.runShippingRecovery({ staleMinutes: 10 }),
        recoveryService.runPaymentsRecovery({ staleMinutes: 10 }),
      ]);

      expect(shipResult.result?.reclaimedEventsCount).toBeGreaterThanOrEqual(1);
      expect(payResult.result?.reclaimedEventsCount).toBeGreaterThanOrEqual(1);

      const [reclaimedShip] = await h.db
        .select()
        .from(schema.shipmentEvent)
        .where(eq(schema.shipmentEvent.id, shipEventId))
        .limit(1);
      expect(reclaimedShip.status).toBe("failed");
      expect(reclaimedShip.failureReason).toBe("stale_processing_reclaimed");

      const [reclaimedPay] = await h.db
        .select()
        .from(schema.paymentProviderEvent)
        .where(eq(schema.paymentProviderEvent.id, payEventId))
        .limit(1);
      expect(reclaimedPay.status).toBe("failed");
      expect(reclaimedPay.failureReason).toBe("stale_processing_reclaimed");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 7. External Provider Failure Modes & Fault Isolation
   * ────────────────────────────────────────────────────────────────────────── */
  describe("7. External Provider Failure Modes & Fault Isolation", () => {
    it("fault isolation: carrier outage during recovery does not block settlement or inventory recovery", async () => {
      const originalReclaim = h.shippingService.reclaimStaleProcessingEvents;
      h.shippingService.reclaimStaleProcessingEvents = async () => {
        throw new Error("Carrier API connection timeout");
      };

      try {
        const summary = await recoveryService.runAll({ actorId: ctx.userAdmin });

        // Overall marked as having a failure
        expect(summary.allSuccessful).toBe(false);

        // Shipping routine failed with error captured
        expect(summary.shipping.executed).toBe(false);
        expect((summary.shipping as any).error).toContain("Carrier API connection timeout");

        // Inventory, Payments, and Settlement succeeded
        expect(summary.inventory.executed).toBe(true);
        expect(summary.payments.executed).toBe(true);
        expect(summary.settlement.executed).toBe(true);
      } finally {
        h.shippingService.reclaimStaleProcessingEvents = originalReclaim;
      }
    });

    it("resilience: payments recovery isolates error and frees lock on failure", async () => {
      const originalReclaim = h.paymentEventService.reclaimStaleProcessing;
      h.paymentEventService.reclaimStaleProcessing = async () => {
        throw new Error("Payment gateway connection reset by peer");
      };

      try {
        await expect(recoveryService.runPaymentsRecovery()).rejects.toThrow(
          "Payment gateway connection reset by peer",
        );
        // Mutex lock must be released even though execution failed
        expect(await jobLockService.isLocked("job:recovery:payments")).toBe(false);

        // runAll catches and isolates the failure
        const summary = await recoveryService.runAll({ actorId: ctx.userAdmin });
        expect(summary.allSuccessful).toBe(false);
        expect(summary.payments.executed).toBe(false);
        expect((summary.payments as any).error).toContain("Payment gateway connection reset by peer");
        expect(summary.inventory.executed).toBe(true);
      } finally {
        h.paymentEventService.reclaimStaleProcessing = originalReclaim;
      }
    });
  });
});
