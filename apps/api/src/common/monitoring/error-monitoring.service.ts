import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { redactSensitive } from "../logging/redaction";
import { RequestContext } from "../context/request-context";

export interface CapturedErrorPayload {
  errorId: string;
  timestamp: string;
  message: string;
  name?: string;
  stack?: string;
  requestId?: string;
  correlationId?: string;
  actorId?: string | null;
  actorRole?: string | null;
  context?: Record<string, unknown>;
}

/**
 * Phase 4.9 Checkpoint C — Production Error Monitoring Adapter.
 *
 * Provides a Sentry / remote webhook-ready error reporter abstraction.
 * Sanitizes all context, credentials, and PII before dispatch, and generates
 * unique error correlation IDs (`err_*`) returned to clients for traceability.
 */
@Injectable()
export class ErrorMonitoringService {
  private readonly logger = new Logger("ErrorMonitor");
  private readonly webhookUrl = process.env.ERROR_WEBHOOK_URL || null;
  private readonly isProduction = process.env.NODE_ENV === "production";

  captureException(error: unknown, context?: Record<string, unknown>): string {
    const errorId = `err_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const reqCtx = RequestContext.current();
    const timestamp = new Date().toISOString();

    const isErr = error instanceof Error;
    const message = isErr ? error.message : String(error);
    const name = isErr ? error.name : "UnknownError";
    const stack = isErr && error.stack ? redactSensitive(error.stack) : undefined;

    const payload: CapturedErrorPayload = {
      errorId,
      timestamp,
      name,
      message,
      stack,
      requestId: reqCtx?.requestId,
      correlationId: reqCtx?.correlationId,
      actorId: reqCtx?.actorId ?? null,
      actorRole: reqCtx?.actorRole ?? null,
      context: context ? (redactSensitive(context) as Record<string, unknown>) : undefined,
    };

    // Log structured alert
    if (this.isProduction) {
      this.logger.error(JSON.stringify(payload));
    } else {
      this.logger.error(
        `[${errorId}] ${name}: ${message} (req: ${payload.requestId || "none"})`,
        stack,
      );
    }

    // Remote dispatch if webhook configured
    if (this.webhookUrl && this.isProduction) {
      try {
        fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((netErr) => {
          this.logger.warn(`Failed to dispatch error report to webhook: ${netErr?.message || netErr}`);
        });
      } catch {
        /* Non-blocking fail-safe */
      }
    }

    return errorId;
  }
}
