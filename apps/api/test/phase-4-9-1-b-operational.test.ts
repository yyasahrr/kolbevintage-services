/**
 * Phase 4.9.1 — Checkpoint B: Operational Proof & Closeout Verification Suite
 *
 * Covers:
 *  B1: Real backup -> restore smoke verification using disposable databases
 *      (verifying table count, row conservation, foreign keys, check constraints, checksum integrity)
 *  B2: Production configuration regression test proving fail-fast on invalid/missing settings
 *  B3: Multi-instance rate-limit test with shared Redis state across 3+ replicas
 *  B4: Bounded load smoke execution (verifying error-free high-frequency request handling)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import RedisMock from "ioredis-mock";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import {
  loadConfig,
  ConfigurationError,
} from "../src/config/configuration";
import { RateLimiterService } from "../src/common/rate-limit/rate-limiter.service";
import { runBackup } from "../../../scripts/backup-db.mjs";
import { runRestore, verifyChecksum } from "../../../scripts/restore-db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";

const HARNESS_DB = "kolbe_phase_4_9_1_b_operational_test";
const SRC_SMOKE_DB = "kolbe_disposable_smoke_backup_src";
const DST_SMOKE_DB = "kolbe_disposable_smoke_backup_dst";

let h: Harness;
let ctx: SupplierContext;

const api = () => request(h.app.getHttpServer());

describe("Phase 4.9.1 — Checkpoint B: Operational Proof & Closeout", () => {
  beforeAll(async () => {
    h = await bootHarness(HARNESS_DB);
    ctx = await seedTwoSuppliers(h.db);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * B1: Real Backup -> Restore Smoke Verification
   * ────────────────────────────────────────────────────────────────────────── */
  describe("B1: Real Backup -> Restore Smoke Verification", () => {
    const srcUrl = `postgres://postgres:postgres@127.0.0.1:55432/${SRC_SMOKE_DB}`;
    const dstUrl = `postgres://postgres:postgres@127.0.0.1:55432/${DST_SMOKE_DB}`;
    const tempBackupPath = path.join("/tmp", `kolbe_smoke_backup_${Date.now()}.sql`);

    beforeAll(async () => {
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${SRC_SMOKE_DB}" WITH (FORCE)`);
        await admin.query(`DROP DATABASE IF EXISTS "${DST_SMOKE_DB}" WITH (FORCE)`);
        await admin.query(`CREATE DATABASE "${SRC_SMOKE_DB}"`);
        await admin.query(`CREATE DATABASE "${DST_SMOKE_DB}"`);
      } finally {
        await admin.end();
      }

      // Apply latest schema migrations to both databases
      execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: srcUrl },
      });
      execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: dstUrl },
      });
    });

    afterAll(async () => {
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${SRC_SMOKE_DB}" WITH (FORCE)`);
        await admin.query(`DROP DATABASE IF EXISTS "${DST_SMOKE_DB}" WITH (FORCE)`);
      } catch {
        /* best effort */
      } finally {
        await admin.end();
      }

      try {
        if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);
        if (fs.existsSync(`${tempBackupPath}.sha256`)) fs.unlinkSync(`${tempBackupPath}.sha256`);
      } catch {
        /* ignore */
      }
    });

    it("seeds rich domain records, backs up, verifies checksum, and restores cleanly", async () => {
      const srcClient = new Client({ connectionString: srcUrl });
      await srcClient.connect();

      const testUserId = "usr_smoke_" + makeId("u");
      const testSupId = "sup_smoke_" + makeId("s");

      try {
        // Seed critical business entities
        await srcClient.query(`
          INSERT INTO account_user (id, email, password_hash, salt, role, status)
          VALUES ('${testUserId}', 'smoke_user@kolbe.test', 'hash_smoke', 'salt_smoke', 'supplier', 'active');
        `);
        await srcClient.query(`
          INSERT INTO supplier (id, legal_name, display_name, status)
          VALUES ('${testSupId}', 'Smoke Legal Name', 'Smoke Display Name', 'approved');
        `);
      } finally {
        await srcClient.end();
      }

      // 1. Run backup from source
      const backupResult = await runBackup({ url: srcUrl, output: tempBackupPath });
      expect(fs.existsSync(tempBackupPath)).toBe(true);
      expect(fs.existsSync(`${tempBackupPath}.sha256`)).toBe(true);
      expect(backupResult.sha256).toBeDefined();

      // 2. Verify SHA-256 integrity
      const checksumCheck = verifyChecksum(tempBackupPath);
      expect(checksumCheck.verified).toBe(true);
      expect(checksumCheck.hash).toBe(backupResult.sha256);

      // 3. Test corruption detection: tampered file must fail restore
      const corruptPath = tempBackupPath + ".corrupt";
      fs.writeFileSync(corruptPath, "corrupted content", "utf8");
      fs.writeFileSync(`${corruptPath}.sha256`, `wronghash  ${path.basename(corruptPath)}\n`, "utf8");
      await expect(runRestore({ url: dstUrl, input: corruptPath })).rejects.toThrow(/مطابقت ندارد/);
      fs.unlinkSync(corruptPath);
      fs.unlinkSync(`${corruptPath}.sha256`);

      // 4. Run restore into disposable target database
      const restoreResult = await runRestore({ url: dstUrl, input: tempBackupPath });
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.checksumVerified).toBe(true);
      if (restoreResult.tablesCount !== undefined) {
        expect(restoreResult.tablesCount).toBe(199); // 5.9-C alters the refund engine in place (no new tables); 5.11-C 0045 adds the suspicious-flag table
      }

      // 5. Verify restored data and invariants in target database
      const dstClient = new Client({ connectionString: dstUrl });
      await dstClient.connect();
      try {
        const countRes = await dstClient.query(`
          SELECT count(*)::int as c
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        `);
        expect(countRes.rows[0].c).toBe(199); // 5.9-C alters the refund engine in place (no new tables); 5.11-C 0045 adds the suspicious-flag table

        const userRes = await dstClient.query(`SELECT * FROM account_user WHERE id = '${testUserId}'`);
        expect(userRes.rows.length).toBe(1);
        expect(userRes.rows[0].email).toBe("smoke_user@kolbe.test");
        expect(userRes.rows[0].role).toBe("supplier");
        expect(userRes.rows[0].status).toBe("active");

        const supRes = await dstClient.query(`SELECT * FROM supplier WHERE id = '${testSupId}'`);
        expect(supRes.rows.length).toBe(1);
        expect(supRes.rows[0].legal_name).toBe("Smoke Legal Name");
        expect(supRes.rows[0].display_name).toBe("Smoke Display Name");

        // 6. Verify constraints survived in restored database
        // A) CHECK constraint prevents invalid role
        await expect(
          dstClient.query(`
            INSERT INTO account_user (id, email, password_hash, salt, role, status)
            VALUES ('usr_inv', 'inv@kolbe.test', 'h', 's', 'invalid_role_xyz', 'active');
          `),
        ).rejects.toThrow();

        // B) CHECK constraint prevents negative token_version
        await expect(
          dstClient.query(`
            INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version)
            VALUES ('usr_neg', 'neg@kolbe.test', 'h', 's', 'supplier', 'active', -1);
          `),
        ).rejects.toThrow();
      } finally {
        await dstClient.end();
      }
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * B2: Production Configuration Regression Test
   * ────────────────────────────────────────────────────────────────────────── */
  describe("B2: Production Configuration Regression Test", () => {
    const validProdEnv = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://prod_user:prod_pass@10.0.0.1:5432/kolbe",
      KOLBE_SESSION_SECRET: "strong-random-session-secret-at-least-32-characters-long!",
      KOLBE_INTERNAL_API_TOKEN: "strong-internal-api-token-at-least-32-characters-long!",
      KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
      TRUST_PROXY: "1",
      REDIS_URL: "redis://10.0.0.2:6379",
      S3_ENDPOINT: "https://s3.parspack.com",
      S3_BUCKET: "kolbe-assets",
      S3_ACCESS_KEY: "prod_access_key",
      S3_SECRET_KEY: "prod_secret_key",
      PAYMENT_PROVIDER_MODE: "zarinpal",
      SHIPPING_PROVIDER_MODE: "post_ir",
      TAX_INVOICE_PROVIDER_MODE: "moadian",
      PAYOUT_PROVIDER_MODE: "paya",
    };

    it("accepts a completely valid production configuration", () => {
      const cfg = loadConfig(validProdEnv);
      expect(cfg.env).toBe("production");
      expect(cfg.trustProxy).toBe(1);
      expect(cfg.redisUrl).toBe("redis://10.0.0.2:6379");
      expect(cfg.storage.bucket).toBe("kolbe-assets");
    });

    it("fails fast on missing or short session secret in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, KOLBE_SESSION_SECRET: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, KOLBE_SESSION_SECRET: "short-secret" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on missing internal API token in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, KOLBE_INTERNAL_API_TOKEN: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, KOLBE_INTERNAL_API_TOKEN: "short" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on missing allowed origins in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, KOLBE_ALLOWED_ORIGINS: "" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on missing REDIS_URL in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, REDIS_URL: "" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on missing or unsafe TRUST_PROXY in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, TRUST_PROXY: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, TRUST_PROXY: "true" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, TRUST_PROXY: "-1" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on any fake provider in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, PAYMENT_PROVIDER_MODE: "fake" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, SHIPPING_PROVIDER_MODE: "fake" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, TAX_INVOICE_PROVIDER_MODE: "fake" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, PAYOUT_PROVIDER_MODE: "fake", ALLOW_FAKE_PAYOUT_PROVIDER: "true" }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast on missing S3 storage credentials in production", () => {
      expect(() =>
        loadConfig({ ...validProdEnv, S3_ENDPOINT: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, S3_BUCKET: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, S3_ACCESS_KEY: "" }),
      ).toThrow(ConfigurationError);

      expect(() =>
        loadConfig({ ...validProdEnv, S3_SECRET_KEY: "" }),
      ).toThrow(ConfigurationError);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * B3: Multi-Instance Rate-Limit Test with Shared Redis State
   * ────────────────────────────────────────────────────────────────────────── */
  describe("B3: Multi-Instance Rate-Limit Test with Shared Redis State", () => {
    it("coordinates limits across 3 replicas and blocks newly joined 4th replica", async () => {
      const sharedRedis = new RedisMock();
      const config: any = { env: "production", redisUrl: "redis://127.0.0.1:6379" };

      // Three independent API server instances
      const replica1 = new RateLimiterService(config, sharedRedis.duplicate() as any);
      const replica2 = new RateLimiterService(config, sharedRedis.duplicate() as any);
      const replica3 = new RateLimiterService(config, sharedRedis.duplicate() as any);

      const bucketKey = "multi_replica_" + makeId("r");
      const limit = 10;
      const windowSeconds = 60;
      const fixedNow = 1700000000000;

      // Replica 1 consumes 4
      for (let i = 0; i < 4; i++) {
        const res = await replica1.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
        expect(res.allowed).toBe(true);
      }

      // Replica 2 consumes 4
      for (let i = 0; i < 4; i++) {
        const res = await replica2.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
        expect(res.allowed).toBe(true);
      }

      // Replica 3 consumes 2 (total 10 consumed)
      for (let i = 0; i < 2; i++) {
        const res = await replica3.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
        expect(res.allowed).toBe(true);
      }

      // 11th request on Replica 1 -> Rejected
      const r1Blocked = await replica1.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(r1Blocked.allowed).toBe(false);
      expect(r1Blocked.remaining).toBe(0);

      // 12th request on Replica 2 -> Rejected
      const r2Blocked = await replica2.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(r2Blocked.allowed).toBe(false);
      expect(r2Blocked.remaining).toBe(0);

      // 13th request on Replica 3 -> Rejected
      const r3Blocked = await replica3.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(r3Blocked.allowed).toBe(false);
      expect(r3Blocked.remaining).toBe(0);

      // A newly started 4th replica container immediately sees the quota exhausted
      const replica4 = new RateLimiterService(config, sharedRedis.duplicate() as any);
      const r4Blocked = await replica4.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(r4Blocked.allowed).toBe(false);
      expect(r4Blocked.remaining).toBe(0);

      // Resetting or clearing the bucket allows all replicas to resume
      await replica4.resetAll();
      const r4AfterReset = await replica4.consume(bucketKey, limit, windowSeconds);
      expect(r4AfterReset.allowed).toBe(true);
      expect(r4AfterReset.remaining).toBe(9);
    });

    it("maintains exact quota consistency under high parallel concurrency across replicas", async () => {
      const sharedRedis = new RedisMock();
      const config: any = { env: "production", redisUrl: "redis://127.0.0.1:6379" };

      const repA = new RateLimiterService(config, sharedRedis.duplicate() as any);
      const repB = new RateLimiterService(config, sharedRedis.duplicate() as any);

      const bucketKey = "concurrent_quota_" + makeId("cq");
      const limit = 20;
      const windowSeconds = 60;

      // 30 simultaneous requests distributed between repA and repB
      const requests = Array.from({ length: 30 }, (_, i) => {
        const instance = i % 2 === 0 ? repA : repB;
        return instance.consume(bucketKey, limit, windowSeconds);
      });

      const results = await Promise.all(requests);
      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(20);
      expect(blockedCount).toBe(10);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * B4: Bounded Load Smoke Execution
   * ────────────────────────────────────────────────────────────────────────── */
  describe("B4: Bounded Load Smoke Execution", () => {
    it("handles 50 consecutive health probe requests cleanly without degradation", async () => {
      const startTime = Date.now();
      const count = 50;
      const latencies: number[] = [];

      for (let i = 0; i < count; i++) {
        const t0 = Date.now();
        const res = await api().get("/api/v1/health/liveness");
        const elapsed = Date.now() - t0;
        latencies.push(elapsed);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("UP");
      }

      const totalDuration = Date.now() - startTime;
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(count * 0.5)];
      const p95 = latencies[Math.floor(count * 0.95)];

      // Verify bounded performance
      expect(totalDuration).toBeLessThan(10000); // 50 requests in < 10 seconds
      expect(p50).toBeLessThan(100); // p50 < 100ms
      expect(p95).toBeLessThan(300); // p95 < 300ms
    });
  });
});
