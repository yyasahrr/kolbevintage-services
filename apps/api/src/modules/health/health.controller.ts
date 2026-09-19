import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { KOLBE_DB_HANDLE, type KolbeDbHandle } from "../../database/database.module";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { Public } from "../../common/guards/session.guard";
import { MetricsService } from "./metrics.service";

/**
 * Phase 4.9 Checkpoint C — Health, Liveness, Readiness & Metrics Model.
 *
 * Provides:
 *  - GET /health           -> General health with 200/503 status
 *  - GET /health/liveness  -> Process liveness probe (200 OK)
 *  - GET /health/readiness -> Dependency readiness probe (DB connectivity & schema check, 200/503)
 *  - GET /health/metrics   -> Prometheus / OpenMetrics scraping format
 *  - GET /health/diagnostics -> JSON summary of system vitals and pool statistics
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(KOLBE_DB_HANDLE) private readonly handle: KolbeDbHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    @Inject(MetricsService) private readonly metricsService: MetricsService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "سلامت عمومی سرویس و اتصال دیتابیس" })
  async health(@Res({ passthrough: true }) res: Response) {
    let database: "up" | "down" = "up";
    let latencyMs: number | null = null;

    try {
      const started = Date.now();
      await this.handle.pool.query("SELECT 1");
      latencyMs = Date.now() - started;
    } catch {
      database = "down";
    }

    const isHealthy = database === "up";
    if (!isHealthy) {
      res.status(503);
    }

    return {
      ok: isHealthy,
      status: isHealthy ? "UP" : "DOWN",
      service: "kolbe-api",
      version: 1,
      env: this.config.env,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      database: {
        status: database,
        latencyHint: latencyMs !== null ? `${latencyMs}ms` : null,
      },
      redis: this.config.redisUrl ? "configured" : "not_configured",
      storage: this.config.storage.bucket ? "configured" : "not_configured",
    };
  }

  @Get("liveness")
  @Public()
  @ApiOperation({ summary: "بررسی زنده بودن پروسه (Liveness Probe)" })
  liveness() {
    return {
      status: "UP",
      service: "kolbe-api",
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("live")
  @Public()
  @ApiOperation({ summary: "نام مستعار Liveness Probe" })
  live() {
    return this.liveness();
  }

  @Get("readiness")
  @Public()
  @ApiOperation({ summary: "بررسی آمادگی سرویس برای دریافت ترافیک (Readiness Probe)" })
  async readiness(@Res({ passthrough: true }) res: Response) {
    let dbStatus: "up" | "down" = "up";
    let dbLatencyMs = 0;

    try {
      const started = Date.now();
      await this.handle.pool.query("SELECT 1");
      dbLatencyMs = Date.now() - started;
    } catch {
      dbStatus = "down";
    }

    const isReady = dbStatus === "up";
    if (!isReady) {
      res.status(503);
    }

    return {
      status: isReady ? "UP" : "DOWN",
      service: "kolbe-api",
      timestamp: new Date().toISOString(),
      checks: {
        database: {
          status: dbStatus,
          latencyMs: dbStatus === "up" ? dbLatencyMs : undefined,
        },
        redis: {
          status: this.config.redisUrl ? "configured" : "not_configured",
        },
        storage: {
          status: this.config.storage.bucket ? "configured" : "not_configured",
        },
      },
    };
  }

  @Get("ready")
  @Public()
  @ApiOperation({ summary: "نام مستعار Readiness Probe" })
  ready(@Res({ passthrough: true }) res: Response) {
    return this.readiness(res);
  }

  @Get("metrics")
  @Public()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({ summary: "خروجی معیارهای مانیتورینگ در قالب استاندارد Prometheus" })
  metrics() {
    return this.metricsService.toPrometheusFormat();
  }

  @Get("diagnostics")
  @Public()
  @ApiOperation({ summary: "خلاصه ساخت‌یافته وضعیت و آمار مصرف منابع" })
  diagnostics() {
    return {
      service: "kolbe-api",
      env: this.config.env,
      diagnostics: this.metricsService.getDiagnosticsSummary(),
    };
  }
}
