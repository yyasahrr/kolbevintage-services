import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { WholesaleMembershipService } from "./wholesale-membership.service";
import { EntitlementResolver } from "./entitlement.resolver";

@Controller("admin/wholesale/memberships")
@Roles("admin")
export class AdminWholesaleMembershipsController {
  constructor(
    @Inject(WholesaleMembershipService) private readonly membershipService: WholesaleMembershipService,
    @Inject(EntitlementResolver) private readonly entitlementResolver: EntitlementResolver,
  ) {}

  @Post()
  async createPending(@Body() body: any, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const membership = await this.membershipService.createPendingMembership(
      {
        accountId: body.accountId,
        planVersionId: body.planVersionId,
        metadata: body.metadata,
      },
      actorId,
    );
    return toApiJson({ membership });
  }

  @Get()
  async listMemberships(
    @Query("status") status?: string,
    @Query("accountId") accountId?: string,
    @Query("limit") limit?: number,
  ) {
    const memberships = await this.membershipService.listMemberships({
      status,
      accountId,
      limit: limit ? Number(limit) : undefined,
    });
    return toApiJson({ memberships });
  }

  @Get(":id")
  async getMembership(@Param("id") id: string) {
    const membership = await this.membershipService.getMembership(id);
    return toApiJson({ membership });
  }

  @Post(":id/activate")
  async activate(
    @Param("id") id: string,
    @Body() body: { durationDays?: number; startedAt?: string; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const activated = await this.membershipService.activateMembership(id, actorId, {
      durationDays: body.durationDays,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      reason: body.reason,
    });
    return toApiJson({ membership: activated });
  }

  @Post(":id/renew")
  async renew(
    @Param("id") id: string,
    @Body() body: { durationDays?: number; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const renewed = await this.membershipService.renewMembership(id, actorId, body);
    return toApiJson({ membership: renewed });
  }

  @Post(":id/schedule-change")
  async scheduleChange(
    @Param("id") id: string,
    @Body() body: { targetPlanVersionId: string; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const updated = await this.membershipService.schedulePlanChange(
      id,
      body.targetPlanVersionId,
      actorId,
      body,
    );
    return toApiJson({ membership: updated });
  }

  @Post(":id/upgrade")
  async upgrade(
    @Param("id") id: string,
    @Body() body: { targetPlanVersionId: string; immediate?: boolean; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const upgraded = await this.membershipService.upgradeMembership(
      id,
      body.targetPlanVersionId,
      actorId,
      body,
    );
    return toApiJson({ membership: upgraded });
  }

  @Post(":id/downgrade")
  async downgrade(
    @Param("id") id: string,
    @Body() body: { targetPlanVersionId: string; immediate?: boolean; reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const downgraded = await this.membershipService.downgradeMembership(
      id,
      body.targetPlanVersionId,
      actorId,
      body,
    );
    return toApiJson({ membership: downgraded });
  }

  @Post(":id/suspend")
  async suspend(
    @Param("id") id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const suspended = await this.membershipService.suspendMembership(id, body.reason, actorId);
    return toApiJson({ membership: suspended });
  }

  @Post(":id/resume")
  async resume(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const resumed = await this.membershipService.resumeMembership(id, actorId, body);
    return toApiJson({ membership: resumed });
  }

  @Post(":id/cancel")
  async cancel(
    @Param("id") id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const cancelled = await this.membershipService.cancelMembership(id, body.reason, actorId);
    return toApiJson({ membership: cancelled });
  }

  @Post("sweep-expired")
  async sweepExpired(@Body() body: { limit?: number }, @CurrentUser() user: Claims) {
    const actorId = user?.sub;
    const expiredCount = await this.membershipService.expireMembershipsSweep(actorId, body.limit);
    return toApiJson({ expiredCount });
  }
}
