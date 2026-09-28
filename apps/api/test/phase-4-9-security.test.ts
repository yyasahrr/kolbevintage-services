/**
 * Phase 4.9 — Checkpoint A: Security, Runtime & Authorization Hardening Test Suite
 *
 * Covers:
 *  1. Production Environment Validation (fail-fast on weak/placeholder secrets, demo data, fake providers)
 *  2. Logging & Diagnostics Hygiene (structured redaction of sensitive credentials and PII masking)
 *  3. HTTP Security & Headers (nosniff, frame policy, cache control, request correlation ID)
 *  4. Request Safety (content-type enforcement, malformed JSON rejection with 400)
 *  5. Abuse Control & Rate Limiting (HTTP 429 on quota exhaustion, Retry-After header)
 *  6. Authorization & IDOR Boundaries (buyer cross-access, supplier cross-access, sales role isolation, admin restrictions)
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import {
  loadConfig,
  toSafeConfig,
  ConfigurationError,
} from "../src/config/configuration";
import { redactSensitive, maskSensitiveString } from "../src/common/logging/redaction";
import { RateLimiterService } from "../src/common/rate-limit/rate-limiter.service";

const TEST_DB = "kolbe_phase_4_9_security_test";

let h: Harness;
let ctx: SupplierContext;
let rateLimiter: RateLimiterService;

const cookie = (userId: string, role: string) => `kolbe_session=${h.issueToken(userId, role)}`;
const api = () => request(h.app.getHttpServer());

describe("Phase 4.9 — Checkpoint A: Security & Runtime Hardening", () => {
  beforeAll(async () => {
    h = await bootHarness(TEST_DB);
    ctx = await seedTwoSuppliers(h.db);
    rateLimiter = h.app.get(RateLimiterService);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * ۱) Environment Validation (A1)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("1. Environment validation & secret safety", () => {
    it("fails fast in production when session secret is missing or too short (< 32 chars)", () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
          KOLBE_SESSION_SECRET: "short-secret",
          KOLBE_INTERNAL_API_TOKEN: "long-and-secure-internal-api-token-value-32chars",
          KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
          S3_ENDPOINT: "https://s3.parspack.com",
          S3_BUCKET: "kolbe",
          S3_ACCESS_KEY: "key",
          S3_SECRET_KEY: "secret",
        }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast in production when session secret contains placeholder patterns", () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
          KOLBE_SESSION_SECRET: "kolbe-dev-secret-change-me-please-long-enough-32",
          KOLBE_INTERNAL_API_TOKEN: "long-and-secure-internal-api-token-value-32chars",
          KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
          S3_ENDPOINT: "https://s3.parspack.com",
          S3_BUCKET: "kolbe",
          S3_ACCESS_KEY: "key",
          S3_SECRET_KEY: "secret",
        }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast in production when demo seed data flag is enabled", () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
          KOLBE_SESSION_SECRET: "strong-random-session-secret-at-least-32-characters-long!",
          KOLBE_INTERNAL_API_TOKEN: "strong-internal-api-token-at-least-32-characters-long!",
          KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
          KOLBE_SEED_DEMO_DATA: "true",
          S3_ENDPOINT: "https://s3.parspack.com",
          S3_BUCKET: "kolbe",
          S3_ACCESS_KEY: "key",
          S3_SECRET_KEY: "secret",
        }),
      ).toThrow(ConfigurationError);
    });

    it("fails fast in production when fake payment/shipping/payout providers are configured", () => {
      expect(() =>
        loadConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://prod_user:strong_pass@10.0.0.1:5432/kolbe",
          KOLBE_SESSION_SECRET: "strong-random-session-secret-at-least-32-characters-long!",
          KOLBE_INTERNAL_API_TOKEN: "strong-internal-api-token-at-least-32-characters-long!",
          KOLBE_ALLOWED_ORIGINS: "https://kolbe.ir",
          WHOLESALE_PAYMENT_PROVIDER: "fake",
          S3_ENDPOINT: "https://s3.parspack.com",
          S3_BUCKET: "kolbe",
          S3_ACCESS_KEY: "key",
          S3_SECRET_KEY: "secret",
        }),
      ).toThrow(ConfigurationError);
    });

    it("toSafeConfig masks secrets, database passwords, and tokens", () => {
      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://user:super_secret_pw@127.0.0.1:55432/kolbe",
        KOLBE_SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
        KOLBE_INTERNAL_API_TOKEN: "internal-token-at-least-32-chars-long",
      });
      const safe = toSafeConfig(config);
      expect(String(safe.databaseUrl)).not.toContain("super_secret_pw");
      expect(String(safe.databaseUrl)).toContain("REDACTED");
      expect(String(safe.sessionSecret)).not.toBe(config.sessionSecret);
      expect(String(safe.sessionSecret)).toContain("***");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * ۲) Logging Hygiene & Redaction (A7)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("2. Logging hygiene and PII masking", () => {
    it("redacts passwords, tokens, authorization headers and cookies", () => {
      const sensitivePayload = {
        email: "user@kolbe.ir",
        password: "MySuperSecretPassword123!",
        token: "jwt.body.signature",
        authorization: "Bearer secret-bearer-token",
        cookie: "kolbe_session=stolen_session_cookie",
        contentBase64: "SGVsbG8gd29ybGQ=",
        nested: {
          refreshToken: "refresh-token-xyz",
          apiKey: "sk-1234567890",
        },
      };

      const sanitized = redactSensitive(sensitivePayload) as any;
      expect(sanitized.email).toBe("user@kolbe.ir");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.authorization).toBe("[REDACTED]");
      expect(sanitized.cookie).toBe("[REDACTED]");
      expect(sanitized.contentBase64).toBe("[REDACTED]");
      expect(sanitized.nested.refreshToken).toBe("[REDACTED]");
      expect(sanitized.nested.apiKey).toBe("[REDACTED]");
    });

    it("masks bank cards, Sheba / IBAN, and national identification numbers", () => {
      expect(maskSensitiveString("sheba", "IR120120000000001234567890")).toBe("IR12****7890");
      expect(maskSensitiveString("iban", "IR990180000000009876543210")).toBe("IR99****3210");
      expect(maskSensitiveString("cardNumber", "6037991812345678")).toBe("6037-****-****-5678");
      expect(maskSensitiveString("nationalCode", "0012345678")).toBe("***5678");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * ۳) HTTP Security Headers & Request Hygiene (A2, A4, A5)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("3. HTTP security headers, correlation IDs, and request validation", () => {
    it("attaches security headers and correlation X-Request-Id on responses", async () => {
      const res = await api().get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-request-id"].length).toBeGreaterThan(5);
    });

    it("propagates client-supplied X-Request-Id", async () => {
      const customId = "trace-" + makeId("req");
      const res = await api()
        .get("/api/v1/health")
        .set("X-Request-Id", customId);
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(customId);
    });

    it("rejects malformed JSON body with HTTP 400 MALFORMED_JSON", async () => {
      const res = await api()
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send('{"email": "broken-json", "password": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("MALFORMED_JSON");
    });

    it("rejects non-JSON Content-Type on mutating requests with body", async () => {
      const res = await api()
        .post("/api/v1/auth/login")
        .set("Content-Type", "text/plain")
        .send("plain text body");
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * ۴) Abuse Control & Rate Limiting (A3)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("4. Rate limiting & abuse control", () => {
    it("enforces server-side rate limits on login attempts returning 429 and Retry-After", async () => {
      rateLimiter.resetAll();
      const uniqueIp = "198.51.100." + Math.floor(Math.random() * 200 + 10);

      // Senders under limit (limit = 5 for login)
      for (let i = 0; i < 5; i++) {
        const res = await api()
          .post("/api/v1/auth/login")
          .set("X-Forwarded-For", uniqueIp)
          .send({ email: "rate-limit-test@kolbe.ir", password: "wrong-password" });
        expect(res.status).not.toBe(429);
        expect(res.headers["x-ratelimit-limit"]).toBe("5");
      }

      // 6th attempt should be blocked by RateLimitGuard
      const blocked = await api()
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", uniqueIp)
        .send({ email: "rate-limit-test@kolbe.ir", password: "wrong-password" });

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe("RATE_LIMIT_EXCEEDED");
      expect(blocked.headers["retry-after"]).toBeDefined();
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * ۵) Authorization & IDOR Boundaries (A6)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("5. Authorization audit & IDOR regressions", () => {
    it("buyer cannot access another buyer's order (ORDER_OWNERSHIP_VIOLATION 403)", async () => {
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

      // Seed order owned by ctx.userBuyer (Buyer A)
      const orderId = "wo_idor_a_" + makeId("ord");
      await h.pool.query(
        `INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_units, payment_mode, version, idempotency_key, creation_request_hash)
         VALUES ($1, $2, $3, $4, 'draft', 'IRR', 1000, 0, 1000, 1, 'transfer', 0, $5, $6)`,
        [orderId, "KV-IDOR-A", ctx.accId, ctx.userBuyer, "idem_" + orderId, "hash_" + orderId],
      );

      // Buyer B tries to read Buyer A's order
      const res = await api()
        .get(`/api/v1/wholesale/orders/${orderId}`)
        .set("Cookie", cookie(buyerB, "vip"));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("ORDER_OWNERSHIP_VIOLATION");
    });

    it("supplier A cannot access or confirm supplier B's child order", async () => {
      // Create parent wholesale order first to satisfy FK
      const parentOrderId = "wo_parent_" + makeId("ord");
      await h.pool.query(
        `INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, status, currency, items_total, shipping_total, grand_total, total_units, payment_mode, version, idempotency_key, creation_request_hash)
         VALUES ($1, $2, $3, $4, 'draft', 'IRR', 5000000, 0, 5000000, 1, 'transfer', 0, $5, $6)`,
        [parentOrderId, "KV-PARENT-" + parentOrderId, ctx.accId, ctx.userBuyer, "idem_" + parentOrderId, "hash_" + parentOrderId],
      );

      // Create child order belonging to Supplier B
      const childBId = "po_idor_b_" + makeId("po");
      await h.pool.query(
        `INSERT INTO purchase_order (id, order_code, wholesale_order_id, seller_id, supplier_id, status, items_total, grand_total, shipping_responsibility, version)
         VALUES ($1, $2, $3, $4, $5, 'pending', 5000000, 5000000, 'SUPPLIER', 0)`,
        [childBId, "KV-IDOR-B", parentOrderId, ctx.sellerB, ctx.supB],
      );

      // Member of Supplier A attempts to view or confirm Child Order B
      const viewRes = await api()
        .get(`/api/v1/supplier/orders/${childBId}`)
        .set("Cookie", cookie(ctx.userAOwner, "supplier"));

      expect(viewRes.status).toBe(403);
      expect(viewRes.body.error).toBe("SUPPLIER_OWNERSHIP_VIOLATION");

      const confirmRes = await api()
        .post(`/api/v1/supplier/orders/${childBId}/confirm`)
        .set("Cookie", cookie(ctx.userAOwner, "supplier"))
        .set("Idempotency-Key", "idem_idor_" + childBId)
        .send({});

      expect(confirmRes.status).toBe(403);
      expect(confirmRes.body.error).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
    });

    it("supplier sales role is forbidden from financial account mutations", async () => {
      // ctx.userASales is seeded with role "sales" on Supplier A
      const res = await api()
        .post("/api/v1/supplier/financial-account/withdrawals")
        .set("Cookie", cookie(ctx.userASales, "supplier"))
        .set("Idempotency-Key", "idem_sales_withdr_" + makeId("w"))
        .send({ supplierId: ctx.supA, amount: "1000000" });

      expect(res.status).toBe(403);
      expect(["FORBIDDEN", "SUPPLIER_ROLE_NOT_AUTHORIZED"]).toContain(res.body.error);
    });

    it("regular customer/buyer cannot access supplier financial account endpoints", async () => {
      // ctx.userBuyer is role "vip"
      const res = await api()
        .get("/api/v1/supplier/financial-account/summary")
        .set("Cookie", cookie(ctx.userBuyer, "vip"));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("FORBIDDEN");
    });

    it("supplier cannot execute administrative payout or review bank compliance", async () => {
      const payoutRes = await api()
        .post("/api/v1/admin/settlement/payouts/execute")
        .set("Cookie", cookie(ctx.userAOwner, "supplier"))
        .set("Idempotency-Key", "idem_payout_" + makeId("p"))
        .send({ withdrawalRequestId: "wr_123", provider: "fake" });

      expect(payoutRes.status).toBe(403);
      expect(payoutRes.body.error).toBe("FORBIDDEN");

      const bankReviewRes = await api()
        .post("/api/v1/admin/compliance/suppliers/bank/ver_123/review")
        .set("Cookie", cookie(ctx.userAOwner, "supplier"))
        .send({ status: "verified" });

      expect(bankReviewRes.status).toBe(403);
      expect(bankReviewRes.body.error).toBe("FORBIDDEN");
    });
  });
});
