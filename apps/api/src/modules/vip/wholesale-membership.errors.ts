import { HttpException, HttpStatus } from "@nestjs/common";

export class WholesaleMembershipError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ error: code, message, details }, status);
    this.name = "WholesaleMembershipError";
  }
}

export class WholesaleMembershipNotFoundError extends WholesaleMembershipError {
  constructor(membershipId: string) {
    super("MEMBERSHIP_NOT_FOUND", `Wholesale membership '${membershipId}' was not found`, HttpStatus.NOT_FOUND);
  }
}

export class WholesaleMembershipConflictError extends WholesaleMembershipError {
  constructor(message: string) {
    super("MEMBERSHIP_CONFLICT", message, HttpStatus.CONFLICT);
  }
}

export class WholesaleMembershipStateError extends WholesaleMembershipError {
  constructor(fromStatus: string, action: string) {
    super(
      "MEMBERSHIP_INVALID_STATE_TRANSITION",
      `Cannot perform action '${action}' on wholesale membership in status '${fromStatus}'`,
      HttpStatus.CONFLICT,
    );
  }
}

export class WholesaleOrderLimitViolationError extends WholesaleMembershipError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
