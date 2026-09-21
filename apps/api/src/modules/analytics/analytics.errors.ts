import { DomainError } from "@kolbe/shared";

export class AnalyticsValidationError extends DomainError {
  constructor(message: string) {
    super(400, "ANALYTICS_INVALID_REQUEST", message);
    this.name = "AnalyticsValidationError";
  }
}

export class AnalyticsForbiddenError extends DomainError {
  constructor(message = "Analytics access is not allowed for this scope") {
    super(403, "ANALYTICS_FORBIDDEN", message);
    this.name = "AnalyticsForbiddenError";
  }
}

export class AnalyticsReportNotFoundError extends DomainError {
  constructor(id: string) {
    super(404, "ANALYTICS_REPORT_NOT_FOUND", `Analytics report '${id}' was not found`);
    this.name = "AnalyticsReportNotFoundError";
  }
}

export class AnalyticsExportNotFoundError extends DomainError {
  constructor(id: string) {
    super(404, "ANALYTICS_EXPORT_NOT_FOUND", `Analytics export '${id}' was not found`);
    this.name = "AnalyticsExportNotFoundError";
  }
}
