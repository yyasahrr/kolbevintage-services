import { DomainError } from "@kolbe/shared";

export class SupportCaseNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(404, "SUPPORT_CASE_NOT_FOUND", `Support case '${identifier}' was not found`);
    this.name = "SupportCaseNotFoundError";
  }
}

export class SupportInvalidStatusTransitionError extends DomainError {
  constructor(fromStatus: string, toStatus: string) {
    super(400, "SUPPORT_INVALID_STATUS_TRANSITION", `Cannot transition support case from ${fromStatus} to ${toStatus}`);
    this.name = "SupportInvalidStatusTransitionError";
  }
}

export class SupportInvalidPriorityTransitionError extends DomainError {
  constructor(fromPriority: string, toPriority: string) {
    super(400, "SUPPORT_INVALID_PRIORITY_TRANSITION", `Cannot transition support priority from ${fromPriority} to ${toPriority}`);
    this.name = "SupportInvalidPriorityTransitionError";
  }
}

export class SupportUnauthorizedAccessError extends DomainError {
  constructor(message = "Unauthorized access to support case") {
    super(403, "SUPPORT_UNAUTHORIZED_ACCESS", message);
    this.name = "SupportUnauthorizedAccessError";
  }
}

export class SupportAttachmentInvalidError extends DomainError {
  constructor(reason: string) {
    super(400, "SUPPORT_ATTACHMENT_INVALID", `Invalid attachment: ${reason}`);
    this.name = "SupportAttachmentInvalidError";
  }
}

export class SupportSlaPolicyNotFoundError extends DomainError {
  constructor(code: string) {
    super(404, "SUPPORT_SLA_POLICY_NOT_FOUND", `SLA Policy '${code}' was not found`);
    this.name = "SupportSlaPolicyNotFoundError";
  }
}

export class SupportActionInvalidError extends DomainError {
  constructor(reason: string) {
    super(400, "SUPPORT_ACTION_INVALID", `Invalid support action: ${reason}`);
    this.name = "SupportActionInvalidError";
  }
}
