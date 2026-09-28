import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminTotpService } from "./admin-totp.service";

export const TOTP_ENROLLED_KEY = "kolbe:require_totp_enrolled";
export const RequireTotpEnrolled = () => SetMetadata(TOTP_ENROLLED_KEY, true);

/**
 * Phase 5.11-C — guard for unconditionally high-risk routes (refund
 * approve/complete/fail). Routes without the metadata pass through; routes
 * with it require TOTP enrollment (401 `TOTP_REQUIRED` otherwise).
 *
 * Guard order is structural: this guard is bound at method level, so the
 * global session guard (auth + role) and the controller-level
 * AdminPermissionGuard (granular `retail:*` permission) both run first —
 * unauthenticated callers still get 401-without-code and under-privileged
 * staff still get 403/ADMIN_PERMISSION_DENIED before TOTP is consulted.
 */
@Injectable()
export class AdminTotpGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminTotpService) private readonly totp: AdminTotpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(TOTP_ENROLLED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const actorId = request.claims?.sub || request.user?.sub || request.user?.id;
    if (!actorId) {
      return false;
    }
    await this.totp.assertEnrolled(actorId);
    return true;
  }
}
