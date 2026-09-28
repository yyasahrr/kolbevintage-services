import { HttpException, HttpStatus } from "@nestjs/common";

export class WholesalePlanError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ error: code, message, details }, status);
    this.name = "WholesalePlanError";
  }
}

export class WholesalePlanNotFoundError extends WholesalePlanError {
  constructor(planId: string) {
    super("PLAN_NOT_FOUND", `Wholesale plan '${planId}' was not found`, HttpStatus.NOT_FOUND);
  }
}

export class WholesalePlanVersionNotFoundError extends WholesalePlanError {
  constructor(versionId: string) {
    super("PLAN_VERSION_NOT_FOUND", `Wholesale plan version '${versionId}' was not found`, HttpStatus.NOT_FOUND);
  }
}

export class WholesalePlanImmutableError extends WholesalePlanError {
  constructor(versionId: string, status: string) {
    super(
      "PLAN_VERSION_IMMUTABLE",
      `Wholesale plan version '${versionId}' is in status '${status}' and cannot be modified. Create a new draft version instead.`,
      HttpStatus.CONFLICT,
    );
  }
}

export class WholesalePlanCodeConflictError extends WholesalePlanError {
  constructor(code: string) {
    super("PLAN_CODE_CONFLICT", `Wholesale plan code '${code}' already exists`, HttpStatus.CONFLICT);
  }
}
