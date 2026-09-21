import { Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { ProductionService } from "./production.service";
import { ProductionDomainError } from "./production.logic";

type Actor = { userId: string; role: "supplier" | "admin" };

function actor(claims: Claims): Actor {
  return { userId: claims.sub, role: claims.role === "admin" ? "admin" : "supplier" };
}

function idem(first?: string, second?: string): string {
  const value = first || second;
  if (!value) throw new ProductionDomainError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required");
  return value;
}

@Controller("supplier/production")
@Roles("supplier", "admin")
export class SupplierProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get("jobs")
  async listJobs(@CurrentUser() claims: Claims, @Query("page") page?: string, @Query("limit") limit?: string, @Query("status") status?: string, @Query("supplierId") supplierId?: string) {
    return toApiJson(await this.production.listJobs(actor(claims), { page, limit, status, supplierId }));
  }

  @Post("jobs")
  async createJob(@CurrentUser() claims: Claims, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.createJob(actor(claims), { purchaseOrderId: body?.purchaseOrderId, requiresSampleApproval: body?.requiresSampleApproval, requiresQualityRelease: body?.requiresQualityRelease, idempotencyKey: idem(key1, key2) }));
  }

  @Get("jobs/:id")
  async getJob(@CurrentUser() claims: Claims, @Param("id") id: string) { return toApiJson(await this.production.getJob(actor(claims), id)); }

  @Post("jobs/:id/plan")
  async planJob(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.planJob(actor(claims), id, { capacityPeriodId: body?.capacityPeriodId, plannedStartAt: body?.plannedStartAt, plannedEndAt: body?.plannedEndAt, expectedVersion: body?.expectedVersion, idempotencyKey: idem(key1, key2) }));
  }

  @Post("jobs/:id/start")
  async startJob(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.transitionJob(actor(claims), id, "in_progress", { idempotencyKey: idem(key1, key2), expectedVersion: body?.expectedVersion }));
  }

  @Post("jobs/:id/block")
  async blockJob(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.transitionJob(actor(claims), id, "blocked", { idempotencyKey: idem(key1, key2), expectedVersion: body?.expectedVersion, reason: body?.reason }));
  }

  @Post("jobs/:id/complete")
  async completeJob(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.transitionJob(actor(claims), id, "completed", { idempotencyKey: idem(key1, key2), expectedVersion: body?.expectedVersion }));
  }

  @Post("jobs/:id/cancel")
  async cancelJob(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.transitionJob(actor(claims), id, "cancelled", { idempotencyKey: idem(key1, key2), expectedVersion: body?.expectedVersion, reason: body?.reason }));
  }

  @Post("jobs/:id/actual-units")
  async actualUnits(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.recordActualUnits(actor(claims), id, body?.actualUnits, { idempotencyKey: idem(key1, key2), expectedVersion: body?.expectedVersion }));
  }

  @Post("jobs/:jobId/milestones/:milestoneId/start")
  async startMilestone(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("milestoneId") milestoneId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) {
    return toApiJson(await this.production.transitionMilestone(actor(claims), jobId, milestoneId, "in_progress", { idempotencyKey: idem(key1, key2) }));
  }

  @Post("jobs/:jobId/milestones/:milestoneId/complete")
  async completeMilestone(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("milestoneId") milestoneId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) {
    return toApiJson(await this.production.transitionMilestone(actor(claims), jobId, milestoneId, "completed", { idempotencyKey: idem(key1, key2) }));
  }

  @Post("jobs/:jobId/milestones/:milestoneId/skip")
  async skipMilestone(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("milestoneId") milestoneId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) {
    return toApiJson(await this.production.transitionMilestone(actor(claims), jobId, milestoneId, "skipped", { idempotencyKey: idem(key1, key2), reason: body?.reason }));
  }

  @Get("milestones")
  async listMilestones(@CurrentUser() claims: Claims) { return toApiJson({ definitions: await this.production.listMilestoneDefinitions(actor(claims)) }); }

  @Get("capabilities")
  async listCapabilities(@CurrentUser() claims: Claims, @Query("supplierId") supplierId?: string) { return toApiJson({ capabilities: await this.production.listCapabilities(actor(claims), { supplierId }) }); }

  @Post("capabilities")
  async createCapability(@CurrentUser() claims: Claims, @Body() body: any) { return toApiJson({ capability: await this.production.createCapability(actor(claims), body || {}) }); }

  @Get("capacity-periods")
  async listPeriods(@CurrentUser() claims: Claims, @Query("supplierId") supplierId?: string, @Query("page") page?: string, @Query("limit") limit?: string) { return toApiJson(await this.production.listCapacityPeriods(actor(claims), { supplierId, page, limit })); }

  @Post("capacity-periods")
  async createPeriod(@CurrentUser() claims: Claims, @Body() body: any) { return toApiJson({ period: await this.production.createCapacityPeriod(actor(claims), body || {}) }); }

  @Post("capacity-periods/:id/closures")
  async createClosure(@CurrentUser() claims: Claims, @Param("id") capacityPeriodId: string, @Body() body: any) { return toApiJson({ closure: await this.production.createClosure(actor(claims), { ...(body || {}), capacityPeriodId }) }); }

  @Post("closures/:id/cancel")
  async cancelClosure(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.cancelClosure(actor(claims), id, { idempotencyKey: idem(key1, key2), reason: body?.reason })); }

  @Get("jobs/:jobId/samples")
  async listSamples(@CurrentUser() claims: Claims, @Param("jobId") jobId: string) { return toApiJson({ samples: await this.production.listSamples(actor(claims), jobId) }); }

  @Post("jobs/:jobId/samples")
  async createSample(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.createSample(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/samples/:sampleId/revisions")
  async submitSample(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("sampleId") sampleId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.submitSampleRevision(actor(claims), jobId, sampleId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/artifacts")
  async registerArtifact(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.registerArtifact(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/change-requests")
  async createChange(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.createChangeRequest(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/lots")
  async createLot(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.createLot(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/lots/:lotId/output")
  async lotOutput(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("lotId") lotId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.recordLotOutput(actor(claims), jobId, lotId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/lots/:lotId/start")
  async startLot(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("lotId") lotId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionLot(actor(claims), jobId, lotId, "in_progress", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/lots/:lotId/complete")
  async completeLot(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("lotId") lotId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionLot(actor(claims), jobId, lotId, "completed", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/lots/:lotId/traces")
  async trace(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("lotId") lotId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.addLotTrace(actor(claims), jobId, lotId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/inspections")
  async createInspection(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.createInspection(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/inspections/:inspectionId/submit")
  async submitInspection(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("inspectionId") inspectionId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string, @Body() body: any) { return toApiJson(await this.production.submitInspection(actor(claims), jobId, inspectionId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects")
  async defect(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.recordDefect(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects/:defectId/acknowledge")
  async acknowledgeDefect(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("defectId") defectId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionDefect(actor(claims), jobId, defectId, "acknowledged", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects/:defectId/rework")
  async markDefectRework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("defectId") defectId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionDefect(actor(claims), jobId, defectId, "rework", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects/:defectId/accept")
  async acceptDefect(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("defectId") defectId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionDefect(actor(claims), jobId, defectId, "accepted", { dispositionNote: body?.dispositionNote, idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects/:defectId/waive")
  async waiveDefect(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("defectId") defectId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionDefect(actor(claims), jobId, defectId, "waived", { dispositionNote: body?.dispositionNote, idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/defects/:defectId/close")
  async closeDefect(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("defectId") defectId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionDefect(actor(claims), jobId, defectId, "closed", { dispositionNote: body?.dispositionNote, idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/rework")
  async rework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.createRework(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/rework/:reworkId/start")
  async startRework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("reworkId") reworkId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionRework(actor(claims), jobId, reworkId, "in_progress", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/rework/:reworkId/complete")
  async completeRework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("reworkId") reworkId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionRework(actor(claims), jobId, reworkId, "completed", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/rework/:reworkId/fail")
  async failRework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("reworkId") reworkId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionRework(actor(claims), jobId, reworkId, "failed", { idempotencyKey: idem(key1, key2) })); }

  @Post("jobs/:jobId/rework/:reworkId/cancel")
  async cancelRework(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("reworkId") reworkId: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.transitionRework(actor(claims), jobId, reworkId, "cancelled", { idempotencyKey: idem(key1, key2) })); }

  @Get("jobs/:jobId/events")
  async events(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Query("page") page?: string, @Query("limit") limit?: string) { return toApiJson(await this.production.listIntegrationEvents(actor(claims), jobId, { page, limit })); }

  @Get("quality-releases/:id/shipping-handoff")
  async shippingHandoff(@CurrentUser() claims: Claims, @Param("id") id: string) { return toApiJson({ shippingHandoff: await this.production.getShippingHandoff(actor(claims), id) }); }

  @Get("jobs/:jobId/lots/:lotId/release-readiness")
  async readiness(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Param("lotId") lotId: string) { return toApiJson(await this.production.getReleaseReadiness(actor(claims), jobId, lotId)); }

  @Post("jobs/:jobId/quality-releases")
  async requestRelease(@CurrentUser() claims: Claims, @Param("jobId") jobId: string, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.requestQualityRelease(actor(claims), jobId, { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("recalls")
  async createRecall(@CurrentUser() claims: Claims, @Body() body: any, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.createRecall(actor(claims), { ...(body || {}), idempotencyKey: idem(key1, key2) })); }

  @Post("recalls/:id/submit")
  async submitRecall(@CurrentUser() claims: Claims, @Param("id") id: string, @Headers("idempotency-key") key1: string, @Headers("Idempotency-Key") key2: string) { return toApiJson(await this.production.submitRecall(actor(claims), id, { idempotencyKey: idem(key1, key2) })); }

  @Get("recalls")
  async listRecalls(@CurrentUser() claims: Claims, @Query("supplierId") supplierId?: string, @Query("page") page?: string, @Query("limit") limit?: string) { return toApiJson(await this.production.listRecalls(actor(claims), { supplierId, page, limit })); }
}
