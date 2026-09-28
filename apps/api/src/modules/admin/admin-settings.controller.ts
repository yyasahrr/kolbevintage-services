import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { BusinessSettingsService } from "./business-settings.service";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";

@Controller("admin/settings")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminSettingsController {
  constructor(
    @Inject(BusinessSettingsService) private readonly settingsService: BusinessSettingsService,
  ) {}

  @Get()
  @RequireAdminPermission("wholesale:settings:view")
  async listSettings(
    @Query("category") category?: string,
    @Query("revealSecrets") revealSecrets?: string,
  ) {
    const isReveal = revealSecrets === "true";
    const settings = await this.settingsService.listSettings(category, isReveal);
    return toApiJson({ settings });
  }

  @Get(":key")
  @RequireAdminPermission("wholesale:settings:view")
  async getSetting(
    @Param("key") key: string,
    @Query("revealSecret") revealSecret?: string,
  ) {
    const isReveal = revealSecret === "true";
    const setting = await this.settingsService.getSettingRecord(key, isReveal);
    return toApiJson({ setting });
  }

  @Put(":key")
  @RequireAdminPermission("wholesale:settings:manage")
  async setSetting(
    @Param("key") key: string,
    @Body() body: any,
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const setting = await this.settingsService.setSetting(
      key,
      {
        category: body.category,
        value: body.value,
        valueType: body.valueType,
        description: body.description,
        isSecret: body.isSecret,
        isReadOnly: body.isReadOnly,
        reason: body.reason,
      },
      actorId,
    );
    return toApiJson({ setting });
  }

  @Get(":key/history")
  @RequireAdminPermission("wholesale:settings:view")
  async getHistory(@Param("key") key: string) {
    const history = await this.settingsService.getSettingHistory(key);
    return toApiJson({ history });
  }
}
