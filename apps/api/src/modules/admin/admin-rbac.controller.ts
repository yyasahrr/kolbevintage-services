import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminRbacService } from "./admin-rbac.service";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";

@Controller("admin/rbac")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminRbacController {
  constructor(@Inject(AdminRbacService) private readonly rbacService: AdminRbacService) {}

  @Get("roles")
  @RequireAdminPermission("wholesale:settings:view")
  async listRoles() {
    const roles = await this.rbacService.listRoles();
    return toApiJson({ roles });
  }

  @Post("roles")
  @RequireAdminPermission("wholesale:settings:manage")
  async createRole(@Body() body: any, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const role = await this.rbacService.createRole(
      {
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        isSystem: body.isSystem,
      },
      actorId,
    );
    return toApiJson({ role });
  }

  @Post("roles/:id/permissions")
  @RequireAdminPermission("wholesale:settings:manage")
  async assignPermissions(
    @Param("id") roleId: string,
    @Body() body: { actions: string[] },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const permissions = await this.rbacService.assignPermissionsToRole(
      roleId,
      body.actions,
      actorId,
    );
    return toApiJson({ permissions });
  }

  @Post("users/:userId/roles")
  @RequireAdminPermission("wholesale:settings:manage")
  async assignUserRole(
    @Param("userId") targetUserId: string,
    @Body() body: { roleId: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const assignment = await this.rbacService.assignRoleToUser(
      targetUserId,
      body.roleId,
      actorId,
    );
    return toApiJson({ assignment });
  }

  @Get("users/:userId/roles")
  @RequireAdminPermission("wholesale:settings:view")
  async getUserRoles(@Param("userId") targetUserId: string) {
    const roles = await this.rbacService.getUserRoles(targetUserId);
    return toApiJson({ roles });
  }
}
