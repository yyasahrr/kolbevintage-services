import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../../common/guards/session.guard";
import { toApiJson } from "../../common/api-json";
import { ControlTowerService } from "./control-tower.service";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";

@Controller("admin/wholesale/control-tower")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class ControlTowerController {
  constructor(
    @Inject(ControlTowerService) private readonly controlTowerService: ControlTowerService,
  ) {}

  @Get("overview")
  @RequireAdminPermission("wholesale:control_tower:view")
  async getOverview() {
    const overview = await this.controlTowerService.getOverview();
    return toApiJson({ overview });
  }

  @Get("queues/pending-approvals")
  @RequireAdminPermission("wholesale:control_tower:view")
  async getPendingApprovals(
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
    const result = await this.controlTowerService.getPendingApprovalsQueue({ limit, offset });
    return toApiJson(result);
  }

  @Get("queues/pending-accounts")
  @RequireAdminPermission("wholesale:control_tower:view")
  async getPendingAccounts(
    @Query("search") search?: string,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
    const result = await this.controlTowerService.getPendingAccountsQueue({ search, limit, offset });
    return toApiJson(result);
  }

  @Get("queues/expiring-memberships")
  @RequireAdminPermission("wholesale:control_tower:view")
  async getExpiringMemberships(
    @Query("days") daysRaw?: string,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
  ) {
    const daysThreshold = daysRaw ? parseInt(daysRaw, 10) : 14;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0;
    const result = await this.controlTowerService.getExpiringMembershipsQueue({
      daysThreshold,
      limit,
      offset,
    });
    return toApiJson(result);
  }

  @Get("feed")
  @RequireAdminPermission("wholesale:control_tower:view")
  async getActivityFeed(@Query("limit") limitRaw?: string) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 25;
    const feed = await this.controlTowerService.getActivityFeed({ limit });
    return toApiJson({ feed });
  }

  @Get("search")
  @RequireAdminPermission("wholesale:control_tower:view")
  async searchDirectory(
    @Query("q") query: string,
    @Query("status") status?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    const results = await this.controlTowerService.searchDirectory(query || "", {
      status,
      limit,
    });
    return toApiJson({ results });
  }
}
