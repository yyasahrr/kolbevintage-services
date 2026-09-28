import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";
import { AdminOrderFlagsService } from "./admin-order-flags.service";

/**
 * Phase 5.11-C — suspicious-order flag routes. Thin shell over
 * AdminOrderFlagsService: the path namespace is `admin/retail` (console
 * convention) while the module owner stays `admin` (the flag table is
 * admin-owned; the B-tranche analytics controllers set the precedent).
 */
@Controller("admin/retail/orders")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminOrderFlagsController {
  constructor(@Inject(AdminOrderFlagsService) private readonly flags: AdminOrderFlagsService) {}

  @Get(":id/suspicious")
  @RequireAdminPermission("retail:order:view")
  async getFlag(@Param("id") id: string) {
    const flag = await this.flags.getFlag(id);
    return toApiJson({ flagged: flag !== null && flag.clearedAt === null, flag });
  }

  @Post(":id/suspicious")
  @RequireAdminPermission("retail:order:manage")
  async flagOrder(
    @CurrentUser() user: Claims,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { reason?: string },
  ) {
    const result = await this.flags.flagOrder(id, user.sub, body?.reason as string);
    res.status(result.created ? 201 : 200);
    return toApiJson({ flagged: true, flag: result.flag });
  }

  @Post(":id/suspicious/clear")
  @RequireAdminPermission("retail:order:manage")
  @HttpCode(200)
  async clearFlag(@CurrentUser() user: Claims, @Param("id") id: string, @Body() body: { reason?: string }) {
    const result = await this.flags.clearFlag(id, user.sub, body?.reason);
    return toApiJson(result);
  }
}
