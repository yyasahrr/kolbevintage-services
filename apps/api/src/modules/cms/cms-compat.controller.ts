import { Body, Controller, Inject, Put, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CmsSiteSettingsService } from "./cms-site-settings.service";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";

@Controller("cms/compat")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class CmsCompatController {
  constructor(@Inject(CmsSiteSettingsService) private readonly settings: CmsSiteSettingsService) {}
  @Put("site-settings")
  @RequireAdminPermission("cms:content:edit")
  save(@Body() body: any, @CurrentUser() claims: Claims) { return this.settings.save(body.settings, claims.sub); }
}
