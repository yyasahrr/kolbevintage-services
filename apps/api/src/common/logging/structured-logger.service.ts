import { Injectable, LoggerService, LogLevel } from "@nestjs/common";
import { RequestContext } from "../context/request-context";
import { redactSensitive } from "./redaction";

export interface LogEntry {
  time: string;
  level: LogLevel;
  context?: string;
  message: string;
  requestId?: string;
  correlationId?: string;
  actorId?: string | null;
  actorRole?: string | null;
  tenantId?: string | null;
  stack?: string;
  metadata?: unknown;
}

/**
 * Phase 4.9 Checkpoint C — Structured Production Logger.
 *
 * Formats diagnostic output as machine-readable JSON in production and readable
 * text in development. Integrates with RequestContext to trace logs across
 * distributed calls, and applies redaction to prevent secret leaks.
 */
@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly isProduction = process.env.NODE_ENV === "production";

  private formatEntry(
    level: LogLevel,
    message: any,
    context?: string,
    stack?: string,
  ): string {
    const ctx = RequestContext.current();
    const time = new Date().toISOString();

    let formattedMessage = typeof message === "string" ? message : JSON.stringify(message);

    const entry: LogEntry = {
      time,
      level,
      context: context || "Application",
      message: formattedMessage,
      requestId: ctx?.requestId,
      correlationId: ctx?.correlationId,
      actorId: ctx?.actorId ?? null,
      actorRole: ctx?.actorRole ?? null,
      tenantId: ctx?.tenantId ?? null,
    };

    if (stack && (!this.isProduction || level === "error" || level === "fatal")) {
      entry.stack = redactSensitive(stack);
    }

    const sanitized = redactSensitive(entry);

    if (this.isProduction) {
      return JSON.stringify(sanitized);
    }

    // In dev / test: readable format
    const reqInfo = sanitized.requestId ? ` [req:${sanitized.requestId}]` : "";
    const prefix = `[${time}] [${level.toUpperCase()}] [${sanitized.context}]${reqInfo}:`;
    if (sanitized.stack) {
      return `${prefix} ${sanitized.message}\n${sanitized.stack}`;
    }
    return `${prefix} ${sanitized.message}`;
  }

  log(message: any, context?: string): void {
    console.log(this.formatEntry("log", message, context));
  }

  error(message: any, stack?: string, context?: string): void {
    console.error(this.formatEntry("error", message, context, stack));
  }

  warn(message: any, context?: string): void {
    console.warn(this.formatEntry("warn", message, context));
  }

  debug?(message: any, context?: string): void {
    if (!this.isProduction) {
      console.debug(this.formatEntry("debug", message, context));
    }
  }

  verbose?(message: any, context?: string): void {
    if (!this.isProduction) {
      console.info(this.formatEntry("verbose", message, context));
    }
  }
}
