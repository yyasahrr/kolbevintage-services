import { Injectable, NestMiddleware, Logger, Inject, Optional } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { redactSensitive } from "./redaction";
import { RequestContext } from "../context/request-context";
import { MetricsService } from "../../modules/health/metrics.service";

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  constructor(
    @Optional() @Inject(MetricsService) private readonly metricsService?: MetricsService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const existingReqId = req.headers["x-request-id"];
    const requestId =
      typeof existingReqId === "string" && existingReqId.trim()
        ? existingReqId.trim()
        : randomUUID();

    const existingCorrId = req.headers["x-correlation-id"];
    const correlationId =
      typeof existingCorrId === "string" && existingCorrId.trim()
        ? existingCorrId.trim()
        : requestId;

    (req as any).requestId = requestId;
    (req as any).correlationId = correlationId;

    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Correlation-Id", correlationId);

    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;
      const path = req.originalUrl || req.url;

      // Record metrics
      this.metricsService?.recordHttpRequest(req.method, path, status, durationMs);

      const logPayload = {
        requestId,
        correlationId,
        method: req.method,
        path,
        status,
        durationMs,
        ip: clientIp,
        userAgent: req.headers["user-agent"] ?? null,
      };

      if (status >= 500) {
        this.logger.error(JSON.stringify(redactSensitive(logPayload)));
      } else if (status >= 400) {
        this.logger.warn(JSON.stringify(redactSensitive(logPayload)));
      } else {
        this.logger.log(JSON.stringify(redactSensitive(logPayload)));
      }
    });

    RequestContext.run(
      {
        requestId,
        correlationId,
        ip: clientIp,
        startTime: start,
      },
      () => {
        next();
      },
    );
  }
}
