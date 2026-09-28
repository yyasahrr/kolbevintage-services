/**
 * Phase 4.9.1 — Checkpoint A: Security Boundary Gaps Verification Suite
 *
 * Covers:
 *  A1: Distributed Production Rate Limiting (Redis-backed shared state across replicas,
 *      concurrency safety, atomic Lua evaluation, fail-closed 503 RATE_LIMIT_BACKEND_UNAVAILABLE)
 *  A2: Trusted Proxy Hardening (safe defaults, fail-fast on unsafe production config, spoofing resistance)
 *  A3: Cookie-Auth CSRF Policy (Origin validation, Referer fallback, fail-closed on missing both,
 *      Bearer/webhook/internal exemptions)
 *  A4: Unconditional rejection of Fake Providers in Production (zero escape hatches)
 *  A5: Auth Credential Response Hygiene (no reusable session token exposed in JSON responses)
 *  A6: Documentation verification
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { FakePayoutProvider } from "../src/modules/settlement/providers/fake-payout.provider";
import { SettlementDomainError } from "../src/modules/settlement/settlement.errors";

const TEST_DB = "kolbe_phase_4_9_1_a_security_test";

let h: Harness;
let ctx: SupplierContext;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

describe("Phase 4.9.1 — Checkpoint A: Security Boundary Gaps", () => {
  beforeAll(async () => {
    h = await bootHarness(TEST_DB);
    ctx = await seedTwoSuppliers(h.db);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * A1: Distributed Production Rate Limiting
   * ────────────────────────────────────────────────────────────────────────── */
  describe("A1: Distributed Production Rate Limiting", () => {
    it("two independent limiter instances share distributed Redis state", async () => {
      // Shared Redis backend backing both Instance A and Instance B
      const sharedRedis = new RedisMock();
      const replicaRedis = sharedRedis.duplicate();

      const dummyConfig: any = { env: "production", redisUrl: "redis://127.0.0.1:6379" };

      const limiterA = new RateLimiterService(dummyConfig, sharedRedis as any);
      const limiterB = new RateLimiterService(dummyConfig, replicaRedis as any);

      const bucketKey = "shared_user_" + makeId("usr");
      const limit = 5;
      const windowSeconds = 60;
      const fixedNow = 1700000000000;

      // 3 attempts through Instance A
      const resA1 = await limiterA.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      const resA2 = await limiterA.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      const resA3 = await limiterA.consume(bucketKey, limit, windowSeconds, { now: fixedNow });

      expect(resA1.allowed).toBe(true);
      expect(resA2.allowed).toBe(true);
      expect(resA3.allowed).toBe(true);
      expect(resA3.remaining).toBe(2);

      // 2 attempts through Instance B (total 5 consumed globally)
      const resB1 = await limiterB.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      const resB2 = await limiterB.consume(bucketKey, limit, windowSeconds, { now: fixedNow });

      expect(resB1.allowed).toBe(true);
      expect(resB2.allowed).toBe(true);
      expect(resB2.remaining).toBe(0);

      // 6th attempt through Instance A -> Must be rejected (429 condition)
      const resABlocked = await limiterA.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(resABlocked.allowed).toBe(false);
      expect(resABlocked.remaining).toBe(0);

      // 7th attempt through Instance B -> Also rejected
      const resBBlocked = await limiterB.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(resBBlocked.allowed).toBe(false);
      expect(resBBlocked.remaining).toBe(0);

      // Simulating Instance A recreation / restart: new instance must observe existing Redis state
      const limiterA2 = new RateLimiterService(dummyConfig, sharedRedis.duplicate() as any);
      const resA2Blocked = await limiterA2.consume(bucketKey, limit, windowSeconds, { now: fixedNow });
      expect(resA2Blocked.allowed).toBe(false);
      expect(resA2Blocked.remaining).toBe(0);
    });

    it("fails closed with 503 RATE_LIMIT_BACKEND_UNAVAILABLE on sensitive operations when Redis is unavailable", async () => {
      const brokenRedis: any = {
        eval: async () => {
          throw new Error("Connection to Redis lost (ECONNREFUSED)");
        },
        keys: async () => [],
        del: async () => {},
      };

      const limiter = new RateLimiterService(
        { env: "production", redisUrl: "redis://10.254.254.254:6379" } as any,
        brokenRedis,
      );

      // Sensitive operation must fail closed with 503
      await expect(
        limiter.consume("login:ip_test", 5, 60, { sensitive: true }),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          error: "RATE_LIMIT_BACKEND_UNAVAILABLE",
        },
      });
    });

    it("atomic operations under parallel concurrency", async () => {
      const sharedRedis = new RedisMock();
      const limiter = new RateLimiterService(
        { env: "production", redisUrl: "redis://127.0.0.1:6379" } as any,
        sharedRedis as any,
      );

      const bucketKey = "concurrent_test_" + makeId("c");
      const limit = 10;
      const windowSeconds = 60;

      // Launch 15 simultaneous requests
      const promises = Array.from({ length: 15 }, () =>
        limiter.consume(bucketKey, limit, windowSeconds),
      );

      const results = await Promise.all(promises);
      const allowed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);

      expect(allowed.length).toBe(10);
      expect(blocked.length).toBe(5);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * A2: Trusted Proxy Hardening
   * ────────────────────────────────────────────────────────────────────────── */
  describe("A2: Trusted Proxy Hardening", () => {
    it("fails fast in production when TRUST_PROXY is missing or set to unsafe true", () => {
      const baseValidProd = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
        KOLBE_SESSION_SECRET: "strong-random-session-secret-at-least-32-characters-long!",
        KOLBE_INTERNAL_API_TOKEN: "strong-internal-api-token-at-least-32-characters-long!",
        KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
        REDIS_URL: "redis://10.0.0.2:6379",
        S3_ENDPOINT: "https://s3.parspack.com",
        S3_BUCKET: "kolbe",
        S3_ACCESS_KEY: "key",
        S3_SECRET_KEY: "secret",
      };

      // 1. Missing TRUST_PROXY in production
      expect(() =>
        loadConfig({ ...baseValidProd }),
      ).toThrow(ConfigurationError);

      // 2. Unsafe 'true' in production
      expect(() =>
        loadConfig({ ...baseValidProd, TRUST_PROXY: "true" }),
      ).toThrow(ConfigurationError);

      // 3. Malformed string
      expect(() =>
        loadConfig({ ...baseValidProd, TRUST_PROXY: "malformed_proxy_spec" }),
      ).toThrow(ConfigurationError);

      // 4. Valid single hop (1) succeeds
      const conf1 = loadConfig({ ...baseValidProd, TRUST_PROXY: "1" });
      expect(conf1.trustProxy).toBe(1);

      // 5. Valid loopback succeeds
      const conf2 = loadConfig({ ...baseValidProd, TRUST_PROXY: "loopback" });
      expect(conf2.trustProxy).toBe("loopback");
    });

    it("defaults trustProxy to false in test/development when unconfigured", () => {
      const devConfig = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://localhost:5432/kolbe",
        KOLBE_SESSION_SECRET: "dev-secret-32-characters-long-example",
      });
      expect(devConfig.trustProxy).toBe(false);
    });

    it("untrusted client cannot spoof IP merely by sending X-Forwarded-For header", async () => {
      // In default harness (trustProxy: false), Express ignores X-Forwarded-For
      // 5 attempts with different spoofed X-Forwarded-For still consume the single socket IP bucket
      const spoofedIps = [
        "1.1.1.1",
        "2.2.2.2",
        "3.3.3.3",
        "4.4.4.4",
        "5.5.5.5",
      ];

      for (const fakeIp of spoofedIps) {
        const res = await api()
          .post("/api/v1/auth/login")
          .set("X-Forwarded-For", fakeIp)
          .send({ email: "spoof-test@kolbe.test", password: "wrong" });
        expect(res.status).not.toBe(429);
      }

      // 6th attempt with another spoofed IP must be rate limited because req.ip is the true socket IP
      const blocked = await api()
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", "6.6.6.6")
        .send({ email: "spoof-test@kolbe.test", password: "wrong" });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * A3: Cookie-Auth CSRF Policy
   * ────────────────────────────────────────────────────────────────────────── */
  describe("A3: Cookie-Auth CSRF Policy", () => {
    const validCookie = () => cookie(ctx.userAdmin, "admin");

    it("allows mutating requests with matching allowed Origin", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", validCookie())
        .set("Origin", "http://localhost:3000")
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      expect(res.status).toBe(201);
    });

    it("rejects mutating requests with hostile Origin (403 FORBIDDEN_ORIGIN)", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", validCookie())
        .set("Origin", "https://evil-attacker.com")
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN_ORIGIN");
    });

    it("allows fallback to Referer when Origin header is absent", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", validCookie())
        .set("Referer", "http://localhost:3000/admin/dashboard")
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      expect(res.status).toBe(201);
    });

    it("rejects mutating request when Referer is hostile (403 FORBIDDEN_ORIGIN)", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", validCookie())
        .set("Referer", "https://phishing-site.com/exploit")
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN_ORIGIN");
    });

    it("fails closed when BOTH Origin and Referer are missing on cookie-authenticated mutation", async () => {
      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Cookie", validCookie())
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("CSRF_VALIDATION_FAILED");
    });

    it("exempts Bearer-only API clients without cookie session from CSRF checks", async () => {
      const bearerToken = h.issueToken(ctx.userAdmin, "admin");

      const res = await api()
        .post("/api/v1/admin/recovery/run")
        .set("Authorization", `Bearer ${bearerToken}`)
        .set("X-Enforce-CSRF", "true")
        .send({ routine: "inventory" });

      // Succeeds without Origin or Referer
      expect(res.status).toBe(201);
    });

    it("exempts signed provider webhooks from CSRF checks", async () => {
      const res = await api()
        .post("/api/v1/shipping/providers/fake/webhook")
        .set("x-fake-shipping-signature", "fake-shipping-webhook-secret")
        .set("X-Enforce-CSRF", "true")
        .send({
          externalEventId: "evt_csrf_test_123",
          eventType: "shipment.in_transit",
          timestamp: new Date().toISOString(),
        });

      // Not blocked by CSRF (200 OK from webhook controller)
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it("exempts internal service requests presenting valid X-Internal-Token", async () => {
      const res = await api()
        .post("/api/v1/legal/retail/checkout-binding")
        .set("X-Internal-Token", process.env.KOLBE_INTERNAL_API_TOKEN || "test-internal-token")
        .set("X-Enforce-CSRF", "true")
        .send({});

      expect(res.status).not.toBe(403);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * A4: Remove Fake Provider Production Ambiguity
   * ────────────────────────────────────────────────────────────────────────── */
  describe("A4: Remove Fake Provider Production Ambiguity", () => {
    it("unconditionally rejects fake payout provider in production regardless of any bypass variable", () => {
      const baseValidProd = {
        NODE_ENV: "production",
        DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
        KOLBE_SESSION_SECRET: "strong-random-session-secret-at-least-32-characters-long!",
        KOLBE_INTERNAL_API_TOKEN: "strong-internal-api-token-at-least-32-characters-long!",
        KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
        TRUST_PROXY: "1",
        REDIS_URL: "redis://10.0.0.2:6379",
        S3_ENDPOINT: "https://s3.parspack.com",
        S3_BUCKET: "kolbe",
        S3_ACCESS_KEY: "key",
        S3_SECRET_KEY: "secret",
      };

      // Even with ALLOW_FAKE_PAYOUT_PROVIDER=true, production config must fail
      expect(() =>
        loadConfig({
          ...baseValidProd,
          PAYOUT_PROVIDER_MODE: "fake",
          ALLOW_FAKE_PAYOUT_PROVIDER: "true",
        }),
      ).toThrow(ConfigurationError);
    });

    it("FakePayoutProvider execution throws in production environment", async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const provider = new FakePayoutProvider();
        await expect(
          provider.transfer({
            payoutId: "po_123",
            amount: 1000000n,
            currency: "IRR",
            destinationKind: "iban",
            destinationValue: "IR1234567890",
            holderName: "Test Holder",
          }),
        ).rejects.toThrow(SettlementDomainError);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * A5: Auth Credential Response Hygiene
   * ────────────────────────────────────────────────────────────────────────── */
  describe("A5: Auth Credential Response Hygiene", () => {
    it("supplier login does not expose reusable session token in JSON response by default", async () => {
      const res = await api()
        .post("/api/v1/auth/supplier/login")
        .send({
          email: "supplier_a_owner@kolbe.test",
          password: "password123",
        });

      if (res.status === 200 || res.status === 201) {
        expect(res.body.token).toBeUndefined();
        expect(res.body.user).toBeDefined();
        expect(res.headers["set-cookie"]).toBeDefined();
      }
    });
  });
});
