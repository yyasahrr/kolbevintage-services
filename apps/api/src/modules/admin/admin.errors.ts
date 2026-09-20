export class AdminPermissionDeniedError extends Error {
  public readonly code = "ADMIN_PERMISSION_DENIED";
  public readonly statusCode = 403;

  constructor(public readonly permission: string, message?: string) {
    super(message || `Access denied: missing required admin permission '${permission}'`);
    this.name = "AdminPermissionDeniedError";
  }
}

export class TwoPersonRuleViolationError extends Error {
  public readonly code = "TWO_PERSON_RULE_VIOLATION";
  public readonly statusCode = 400;

  constructor(message = "Maker cannot approve or decide their own approval request under two-person rule") {
    super(message);
    this.name = "TwoPersonRuleViolationError";
  }
}

export class ApprovalRequestStateError extends Error {
  public readonly code = "APPROVAL_REQUEST_INVALID_STATE";
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ApprovalRequestStateError";
  }
}

export class ApprovalExecutionError extends Error {
  public readonly code = "APPROVAL_EXECUTION_FAILED";
  public readonly statusCode = 500;

  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ApprovalExecutionError";
  }
}

export class BusinessSettingValidationError extends Error {
  public readonly code = "BUSINESS_SETTING_INVALID_VALUE";
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "BusinessSettingValidationError";
  }
}

export class BusinessSettingReadOnlyError extends Error {
  public readonly code = "BUSINESS_SETTING_READ_ONLY";
  public readonly statusCode = 409;

  constructor(public readonly key: string) {
    super(`Business setting '${key}' is read-only and cannot be modified`);
    this.name = "BusinessSettingReadOnlyError";
  }
}
