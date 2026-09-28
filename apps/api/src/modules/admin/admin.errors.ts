import { DomainError } from "@kolbe/shared";

export class AdminPermissionDeniedError extends DomainError {
  constructor(public readonly permission: string, message?: string) {
    super(
      403,
      "ADMIN_PERMISSION_DENIED",
      message || `Access denied: missing required admin permission '${permission}'`,
    );
    this.name = "AdminPermissionDeniedError";
  }
}

export class TwoPersonRuleViolationError extends DomainError {
  constructor(message = "Maker cannot approve or decide their own approval request under two-person rule") {
    super(400, "TWO_PERSON_RULE_VIOLATION", message);
    this.name = "TwoPersonRuleViolationError";
  }
}

export class ApprovalRequestStateError extends DomainError {
  constructor(message: string) {
    super(400, "APPROVAL_REQUEST_INVALID_STATE", message);
    this.name = "ApprovalRequestStateError";
  }
}

export class ApprovalExecutionError extends DomainError {
  constructor(message: string, public readonly details?: unknown) {
    super(500, "APPROVAL_EXECUTION_FAILED", message);
    this.name = "ApprovalExecutionError";
  }
}

export class BusinessSettingValidationError extends DomainError {
  constructor(message: string) {
    super(400, "BUSINESS_SETTING_INVALID_VALUE", message);
    this.name = "BusinessSettingValidationError";
  }
}

export class BusinessSettingReadOnlyError extends DomainError {
  constructor(public readonly key: string) {
    super(409, "BUSINESS_SETTING_READ_ONLY", `Business setting '${key}' is read-only and cannot be modified`);
    this.name = "BusinessSettingReadOnlyError";
  }
}
