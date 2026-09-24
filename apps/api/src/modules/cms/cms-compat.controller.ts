import { Body, Controller, Inject, Put } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { CmsSiteSettingsService } from "./cms-site-settings.service";

@Controller("cms/compat")
@Roles("admin")
export class CmsCompatController {
  constructor(@Inject(CmsSiteSettingsService) private readonly settings: CmsSiteSettingsService) {}
  @Put("site-settings")
  save(@Body() body: any, @CurrentUser() claims: Claims) { return this.settings.save(body.settings, claims.sub); }
}
