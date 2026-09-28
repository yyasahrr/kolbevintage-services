import { DomainError } from "@kolbe/shared";

export class CrmContactNotFoundError extends DomainError {
  constructor(contactId: string) {
    super(404, "CRM_CONTACT_NOT_FOUND", `CRM contact '${contactId}' was not found`);
    this.name = "CrmContactNotFoundError";
  }
}

export class CrmContactDuplicateLinkError extends DomainError {
  constructor(message = "This user account is already linked to a CRM contact") {
    super(409, "CRM_CONTACT_DUPLICATE_LINK", message);
    this.name = "CrmContactDuplicateLinkError";
  }
}

export class CrmStageInvalidError extends DomainError {
  constructor(stage: string) {
    super(400, "CRM_STAGE_INVALID", `Invalid CRM stage: '${stage}'`);
    this.name = "CrmStageInvalidError";
  }
}

export class CrmTagNotFoundError extends DomainError {
  constructor(tagId: string) {
    super(404, "CRM_TAG_NOT_FOUND", `CRM tag '${tagId}' was not found`);
    this.name = "CrmTagNotFoundError";
  }
}

export class CrmTagDuplicateError extends DomainError {
  constructor(message = "Tag is already assigned to this contact") {
    super(409, "CRM_TAG_DUPLICATE", message);
    this.name = "CrmTagDuplicateError";
  }
}

export class CrmTaskNotFoundError extends DomainError {
  constructor(taskId: string) {
    super(404, "CRM_TASK_NOT_FOUND", `CRM task '${taskId}' was not found`);
    this.name = "CrmTaskNotFoundError";
  }
}

export class CrmTaskInvalidStateError extends DomainError {
  constructor(message: string) {
    super(400, "CRM_TASK_INVALID_STATE", message);
    this.name = "CrmTaskInvalidStateError";
  }
}
