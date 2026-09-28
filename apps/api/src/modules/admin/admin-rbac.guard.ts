import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminRbacService } from "./admin-rbac.service";

export const ADMIN_PERMISSION_KEY = "kolbe:admin_permission";
export const RequireAdminPermission = (permission: string) =>
  SetMetadata(ADMIN_PERMISSION_KEY, permission);

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AdminRbacService) private readonly rbacService: AdminRbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      ADMIN_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const actorId = request.claims?.sub || request.user?.sub || request.user?.id;
    if (!actorId) {
      return false;
    }

    await this.rbacService.assertPermission(actorId, requiredPermission);
    return true;
  }
}
