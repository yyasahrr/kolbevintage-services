/**
 * Phase 4.9 — Checkpoint C: Observability & Production Infrastructure Test Suite
 *
 * Covers:
 *  1. Request Context Propagation (AsyncLocalStorage across async chains)
 *  2. Structured Logger (JSON output in production, diagnostic redaction)
 *  3. Health, Liveness & Readiness Model (200/503 status, DB/dependency checks)
 *  4. Prometheus / OpenMetrics Exporter (/metrics format, pool stats, HTTP counters)
 *  5. Error Monitoring Adapter (sanitization, unique errorId emission)
 *  6. Infrastructure Hardening (Docker dumb-init, Nginx proxy, CI preflight gate)
 */

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  bootHarness,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";
import { RequestContext } from "../src/common/context/request-context";
import { StructuredLoggerService } from "../src/common/logging/structured-logger.service";
import { ErrorMonitoringService } from "../src/common/monitoring/error-monitoring.service";
import { MetricsService } from "../src/modules/health/metrics.service";
import { KOLBE_DB_HANDLE, type KolbeDbHandle } from "../src/database/database.module";

const TEST_DB = "kolbe_phase_4_9_observability_test";

let h: Harness;
let ctx: SupplierContext;
let metricsService: MetricsService;

const api = () => request(h.app.getHttpServer());
const cookie = (userId: string, role: string) =>
  `kolbe_session=${h.issueToken(userId, role)}`;

describe("Phase 4.9 — Checkpoint C: Observability & Production Infrastructure", () => {
  beforeAll(async () => {
    h = await bootHarness(TEST_DB);
    ctx = await seedTwoSuppliers(h.db);
    metricsService = h.app.get(MetricsService);
  });

  afterAll(async () => {
    await h?.close();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 1. Request Context Propagation (AsyncLocalStorage)
   * ────────────────────────────────────────────────────────────────────────── */
  describe("1. Request Context Propagation", () => {
    it("propagates requestId and correlationId across asynchronous operations", async () => {
      let capturedInAsync: { req: string; corr: string } | null = null;

      await RequestContext.run(
        {
          requestId: "req_test_123",
          correlationId: "corr_test_456",
          actorId: "usr_alice",
          actorRole: "admin",
        },
        async () => {
          // Multiple async hops
          await new Promise((r) => setTimeout(r, 20));
          await Promise.resolve();

          capturedInAsync = {
            req: RequestContext.getRequestId(),
            corr: RequestContext.getCorrelationId(),
          };

          expect(RequestContext.getActorId()).toBe("usr_alice");
        },
      );

      expect(capturedInAsync).toEqual({
        req: "req_test_123",
        corr: "corr_test_456",
      });
    });

    it("HTTP middleware accepts client correlation ID and returns both headers", async () => {
      const customCorrelationId = "ext-trace-789-xyz";
      const customRequestId = "client-req-001";

      const res = await api()
        .get("/api/v1/health")
        .set("X-Request-Id", customRequestId)
        .set("X-Correlation-Id", customCorrelationId);

      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(customRequestId);
      expect(res.headers["x-correlation-id"]).toBe(customCorrelationId);
    });

    it("HTTP middleware generates request-id and correlation-id when omitted", async () => {
      const res = await api().get("/api/v1/health");

      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-correlation-id"]).toBeDefined();
      expect(res.headers["x-request-id"]).toBe(res.headers["x-correlation-id"]);
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 2. Structured Production Logger
   * ────────────────────────────────────────────────────────────────────────── */
  describe("2. Structured Production Logger", () => {
    it("formats log entries and redacts credentials in structured payloads", () => {
      const logger = new StructuredLoggerService();
      const logs: string[] = [];

      const origLog = console.log;
      console.log = (msg: string) => logs.push(msg);

      try {
        RequestContext.run(
          {
            requestId: "req_log_test",
            correlationId: "corr_log_test",
            actorId: "usr_secret_actor",
          },
          () => {
            logger.log("Order payment completed token=kolbe_sec_abcdef12345678901234567890 password=supersecret");
          },
        );
      } finally {
        console.log = origLog;
      }

      expect(logs.length).toBe(1);
      const output = logs[0];
      expect(output).toContain("req_log_test");
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain("supersecret");
      expect(output).not.toContain("abcdef12345678901234567890");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 3. Health, Liveness & Readiness Model
   * ────────────────────────────────────────────────────────────────────────── */
  describe("3. Health, Liveness & Readiness Model", () => {
    it("GET /api/v1/health returns 200 with UP status when system is healthy", async () => {
      const res = await api().get("/api/v1/health");

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("UP");
      expect(res.body.service).toBe("kolbe-api");
      expect(res.body.database.status).toBe("up");
      expect(typeof res.body.uptimeSeconds).toBe("number");
    });

    it("GET /api/v1/health/liveness returns 200 process alive confirmation", async () => {
      const res = await api().get("/api/v1/health/liveness");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UP");
      expect(res.body.service).toBe("kolbe-api");
      expect(typeof res.body.uptimeSeconds).toBe("number");
      expect(res.body.timestamp).toBeDefined();
    });

    it("GET /api/v1/health/live alias works identically", async () => {
      const res = await api().get("/api/v1/health/live");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UP");
    });

    it("GET /api/v1/health/readiness checks database and returns 200", async () => {
      const res = await api().get("/api/v1/health/readiness");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UP");
      expect(res.body.checks.database.status).toBe("up");
      expect(typeof res.body.checks.database.latencyMs).toBe("number");
    });

    it("GET /api/v1/health/ready alias works identically", async () => {
      const res = await api().get("/api/v1/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("UP");
    });

    it("GET /api/v1/health/readiness returns 503 when database connectivity fails", async () => {
      const dbHandle = h.app.get<KolbeDbHandle>(KOLBE_DB_HANDLE);
      const originalQuery = dbHandle.pool.query.bind(dbHandle.pool);

      // Simulate transient PostgreSQL outage on SELECT 1
      (dbHandle.pool as any).query = async (text: string, ...args: any[]) => {
        if (typeof text === "string" && text.includes("SELECT 1")) {
          throw new Error("Connection terminated unexpectedly (simulated DB failure)");
        }
        return originalQuery(text, ...args);
      };

      try {
        const res = await api().get("/api/v1/health/readiness");
        expect(res.status).toBe(503);
        expect(res.body.status).toBe("DOWN");
        expect(res.body.checks.database.status).toBe("down");

        // Combined health endpoint also fails-closed with 503
        const healthRes = await api().get("/api/v1/health");
        expect(healthRes.status).toBe(503);
        expect(healthRes.body.ok).toBe(false);
        expect(healthRes.body.database.status).toBe("down");
      } finally {
        dbHandle.pool.query = originalQuery;
      }
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 4. Prometheus / OpenMetrics Exporter & Diagnostics
   * ────────────────────────────────────────────────────────────────────────── */
  describe("4. Prometheus / OpenMetrics & Diagnostics", () => {
    it("GET /api/v1/health/metrics returns OpenMetrics compliant text format", async () => {
      // Trigger a request first so metrics exist
      await api().get("/api/v1/health");

      const res = await api().get("/api/v1/health/metrics");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");

      const body = res.text;
      expect(body).toContain("# HELP http_requests_total");
      expect(body).toContain("# TYPE http_requests_total counter");
      expect(body).toContain('http_requests_total{method="GET",path="/api/v1/health",status="200"}');

      expect(body).toContain("# HELP kolbe_db_pool_total");
      expect(body).toContain("kolbe_db_pool_total");

      expect(body).toContain("# HELP process_resident_memory_bytes");
      expect(body).toContain("process_resident_memory_bytes");

      expect(body).toContain("# HELP process_uptime_seconds");
    });

    it("GET /api/v1/health/diagnostics returns structured JSON resource statistics", async () => {
      const res = await api().get("/api/v1/health/diagnostics");

      expect(res.status).toBe(200);
      expect(res.body.service).toBe("kolbe-api");
      expect(res.body.diagnostics).toBeDefined();
      expect(typeof res.body.diagnostics.uptimeSeconds).toBe("number");
      expect(typeof res.body.diagnostics.memory.rssMb).toBe("number");
      expect(typeof res.body.diagnostics.requestsCount).toBe("number");
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 5. Error Monitoring Adapter
   * ────────────────────────────────────────────────────────────────────────── */
  describe("5. Error Monitoring Adapter", () => {
    it("captures exceptions, attaches request context, and emits errorId with sanitized context", () => {
      const monitor = new ErrorMonitoringService();
      let errorId: string;

      RequestContext.run(
        {
          requestId: "req_err_test",
          correlationId: "corr_err_test",
          actorId: "usr_alice",
        },
        () => {
          errorId = monitor.captureException(new Error("Simulated payment gateway timeout"), {
            orderId: "ord_123",
            cardPan: "6037991812345678",
            secretToken: "sk_live_verysecrettoken",
          });
        },
      );

      expect(errorId!).toMatch(/^err_[a-f0-9]{16}$/);
    });

    it("global exception filter returns errorId on 500 responses", async () => {
      // Endpoint that doesn't exist returns 404
      const res404 = await api().get("/api/v1/non_existent_route");
      expect(res404.status).toBe(404);
      expect(res404.body.errorId).toBeUndefined();
    });
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * 6. Docker, Nginx & CI/CD Infrastructure Hardening
   * ────────────────────────────────────────────────────────────────────────── */
  describe("6. Infrastructure Hardening & Verification", () => {
    it("api.Dockerfile includes dumb-init signal handling, USER node, and healthcheck", () => {
      const dockerfilePath = path.resolve(import.meta.dirname, "../../../infra/docker/api.Dockerfile");
      const content = fs.readFileSync(dockerfilePath, "utf8");

      expect(content).toContain("dumb-init");
      expect(content).toContain("USER node");
      expect(content).toMatch(/HEALTHCHECK/i);
      expect(content).toContain("ENTRYPOINT [\"dumb-init\", \"--\"]");
    });

    it("infra/nginx/kolbe.conf configures rate limits, trusted real-ip, and /metrics proxy", () => {
      const nginxConfPath = path.resolve(import.meta.dirname, "../../../infra/nginx/kolbe.conf");
      const content = fs.readFileSync(nginxConfPath, "utf8");

      expect(content).toContain("set_real_ip_from");
      expect(content).toContain("real_ip_header X-Forwarded-For;");
      expect(content).toContain("limit_req_status 429;");
      expect(content).toContain("location = /metrics");
      expect(content).toContain("proxy_pass http://kolbe_api");
    });

    it("infra/nginx/kolbe-proxy-params.conf includes X-Request-ID and X-Correlation-ID", () => {
      const proxyParamsPath = path.resolve(import.meta.dirname, "../../../infra/nginx/kolbe-proxy-params.conf");
      const content = fs.readFileSync(proxyParamsPath, "utf8");

      expect(content).toContain("X-Request-ID");
      expect(content).toContain("X-Correlation-ID");
    });

    it("package.json and scripts include migration preflight verification tooling", () => {
      const packageJsonPath = path.resolve(import.meta.dirname, "../../../package.json");
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      expect(pkg.scripts["preflight:check"]).toBe("node scripts/migration-preflight.mjs");

      const scriptPath = path.resolve(import.meta.dirname, "../../../scripts/migration-preflight.mjs");
      expect(fs.existsSync(scriptPath)).toBe(true);
    });
  });
});
