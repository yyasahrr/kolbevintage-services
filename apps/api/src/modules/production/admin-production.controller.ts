import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { ProductionService } from "./production.service";
import { ProductionDomainError } from "./production.logic";

function adminActor(claims: Claims) {
  if (claims.role !== "admin") throw new ProductionDomainError("ROLE_NOT_ALLOWED", "Admin role required", 403);
  return { userId: claims.sub, role: "admin" as const };
}
function key(one?: string, two?: string): string {
  const value = one || two;
  if (!value) throw new ProductionDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
  return value;
}

@Controller("admin/production")
@Roles("admin")
export class AdminProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get("jobs")
  async jobs(@CurrentUser() claims: Claims, @Query("page") page?: string, @Query("limit") limit?: string, @Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    return toApiJson(await this.production.listJobs(adminActor(claims), { page, limit, status, supplierId }));
  }

  @Post("milestone-definitions")
  async createMilestone(@CurrentUser() claims: Claims, @Body() body: any) { return toApiJson({ definition: await this.production.createMilestoneDefinition(adminActor(claims), body || {}) }); }

  @Get("milestone-definitions")
  async milestones(@CurrentUser() claims: Claims) { return toApiJson({ definitions: await this.production.listMilestoneDefinitions(adminActor(claims)) }); }

  @Post("checklists")
  async createChecklist(@CurrentUser() claims: Claims, @Body() body: any) { return toApiJson(await this.production.createChecklist(adminActor(claims), body || {})); }

  @Post("checklists/:id/publish")
  async publishChecklist(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.publishChecklist(adminActor(claims), id, { idempotencyKey: key(one, two) })); }

  @Get("checklists")
  async listChecklists(@CurrentUser() claims: Claims, @Query("status") status?: string, @Query("page") page?: string, @Query("limit") limit?: string) { return toApiJson(await this.production.listChecklists(adminActor(claims), { status, page, limit })); }

  @Post("jobs/:jobId/samples/:sampleRevisionId/review")
  async reviewSample(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("sampleRevisionId") sampleRevisionId: string, @Body() body: any, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.reviewSample(adminActor(claims), jobId, sampleRevisionId, { ...(body || {}), idempotencyKey: key(one, two) })); }

  @Post("change-requests/:id/decide")
  async decideChange(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: any, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.decideChangeRequest(adminActor(claims), id, { ...(body || {}), idempotencyKey: key(one, two) })); }

  @Post("quality-releases/:id/decide")
  async decideRelease(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: any, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.approveQualityRelease(adminActor(claims), id, { decision: body?.decision, note: body?.note, idempotencyKey: key(one, two) })); }

  @Post("recalls/:id/decide")
  async decideRecall(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: any, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.approveRecall(adminActor(claims), id, { decision: body?.decision, notes: body?.notes, idempotencyKey: key(one, two) })); }

  @Post("recalls/:id/transition")
  async transitionRecall(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: any, @Headers("idempotency-key") one: string, @Headers("Idempotency-Key") two: string) { return toApiJson(await this.production.transitionRecall(adminActor(claims), id, body?.status, { reason: body?.reason, idempotencyKey: key(one, two) })); }
}
