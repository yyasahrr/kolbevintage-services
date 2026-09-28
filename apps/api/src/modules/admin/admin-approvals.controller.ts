import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { AdminApprovalsService } from "./admin-approvals.service";
import { AdminPermissionGuard, RequireAdminPermission } from "./admin-rbac.guard";

@Controller("admin/approvals")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class AdminApprovalsController {
  constructor(
    @Inject(AdminApprovalsService) private readonly approvalsService: AdminApprovalsService,
  ) {}

  @Post()
  @RequireAdminPermission("wholesale:approval:create")
  async createRequest(@Body() body: any, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const request = await this.approvalsService.createApprovalRequest(
      {
        requestType: body.requestType,
        targetType: body.targetType,
        targetId: body.targetId,
        payload: body.payload || {},
        makerNotes: body.makerNotes,
        idempotencyKey: body.idempotencyKey,
      },
      actorId,
    );
    return toApiJson({ request });
  }

  @Get()
  @RequireAdminPermission("wholesale:approval:view")
  async listRequests(
    @Query("status") status?: string,
    @Query("requestType") requestType?: string,
    @Query("makerId") makerId?: string,
    @Query("checkerId") checkerId?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    const requests = await this.approvalsService.listApprovalRequests({
      status,
      requestType,
      makerId,
      checkerId,
      limit,
    });
    return toApiJson({ requests });
  }

  @Get(":id")
  @RequireAdminPermission("wholesale:approval:view")
  async getRequest(@Param("id") id: string) {
    const request = await this.approvalsService.getApprovalRequest(id);
    return toApiJson({ request });
  }

  @Post(":id/decide")
  @RequireAdminPermission("wholesale:approval:decide")
  async decideRequest(
    @Param("id") id: string,
    @Body() body: { decision: "approve" | "reject"; checkerNotes?: string; autoExecute?: boolean },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const decided = await this.approvalsService.decideApprovalRequest(
      id,
      body.decision,
      body.checkerNotes,
      actorId,
      body.autoExecute ?? true,
    );
    return toApiJson({ request: decided });
  }

  @Post(":id/cancel")
  @RequireAdminPermission("wholesale:approval:create")
  async cancelRequest(
    @Param("id") id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const cancelled = await this.approvalsService.cancelApprovalRequest(id, body.reason, actorId);
    return toApiJson({ request: cancelled });
  }
}
