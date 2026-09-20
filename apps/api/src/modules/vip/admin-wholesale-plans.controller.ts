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
import { WholesalePlanService } from "./wholesale-plan.service";

@Controller("admin/wholesale/plans")
@Roles("admin")
export class AdminWholesalePlansController {
  constructor(@Inject(WholesalePlanService) private readonly planService: WholesalePlanService) {}

  @Post()
  async createPlan(@Body() body: any, @CurrentUser() user: Claims) {
    const actorId = user.sub;
    const plan = await this.planService.createPlan(
      {
        code: body.code,
        name: body.name,
        description: body.description,
        tierLevel: body.tierLevel,
        currency: body.currency,
        sortOrder: body.sortOrder,
      },
      actorId,
    );
    return toApiJson({ plan });
  }

  @Get()
  async listPlans(@Query("status") status?: string) {
    const plans = await this.planService.listPlans({ status });
    return toApiJson({ plans });
  }

  @Get(":id")
  async getPlan(@Param("id") id: string) {
    const plan = await this.planService.getPlan(id);
    return toApiJson({ plan });
  }

  @Post(":id/versions")
  async createVersion(
    @Param("id") planId: string,
    @Body() body: any,
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const version = await this.planService.createPlanVersion(
      planId,
      {
        name: body.name,
        description: body.description,
        billingPeriod: body.billingPeriod,
        durationDays: body.durationDays,
        baseFee: body.baseFee,
        depositRequirement: body.depositRequirement,
        changeSummary: body.changeSummary,
        features: body.features,
        limits: body.limits,
      },
      actorId,
    );
    return toApiJson({ version });
  }

  @Get(":id/versions")
  async listVersions(@Param("id") planId: string) {
    const versions = await this.planService.listVersions(planId);
    return toApiJson({ versions });
  }

  @Post(":id/versions/:versionId/publish")
  async publishVersion(
    @Param("id") planId: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const published = await this.planService.publishPlanVersion(planId, versionId, actorId);
    return toApiJson({ version: published });
  }

  @Post(":id/versions/:versionId/features")
  async addFeature(
    @Param("versionId") versionId: string,
    @Body() body: any,
  ) {
    const feature = await this.planService.addFeature(versionId, body);
    return toApiJson({ feature });
  }

  @Post(":id/versions/:versionId/limits")
  async addLimit(
    @Param("versionId") versionId: string,
    @Body() body: any,
  ) {
    const limit = await this.planService.addLimit(versionId, body);
    return toApiJson({ limit });
  }

  @Post(":id/fork")
  async forkVersion(
    @Param("id") planId: string,
    @Body() body: { changeSummary?: string },
    @CurrentUser() user: Claims,
  ) {
    const actorId = user.sub;
    const version = await this.planService.createNewVersionFromPublished(
      planId,
      body.changeSummary || "New version from active baseline",
      actorId,
    );
    return toApiJson({ version });
  }
}
