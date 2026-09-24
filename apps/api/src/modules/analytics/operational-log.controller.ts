import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { OperationalLogService } from "./operational-log.service";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";

@Controller("analytics/operational-logs")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class OperationalLogController {
  constructor(@Inject(OperationalLogService) private readonly logs: OperationalLogService) {}
  @Get()
  @RequireAdminPermission("analytics:report:view")
  list(@Query() query: Record<string, string | undefined>) { return this.logs.list(query); }
  @Patch(":id")
  @Post(":id")
  @HttpCode(200)
  @RequireAdminPermission("analytics:report:manage")
  resolve(@Param("id") id: string, @Body() body: any, @CurrentUser() claims: Claims) { return this.logs.resolve(id, body, claims.sub); }
}
