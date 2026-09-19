import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { redactSensitive } from "./redaction";

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const existingId = req.headers["x-request-id"];
    const requestId = typeof existingId === "string" && existingId.trim() ? existingId.trim() : randomUUID();

    (req as any).requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    res.on("finish", () => {
      const durationMs = Date.now() - start;
      const status = res.statusCode;

      const logPayload = {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        status,
        durationMs,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip,
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

    next();
  }
}
