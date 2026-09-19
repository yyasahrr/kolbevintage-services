import { Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { ComplianceService } from "./compliance.service";
import { PrivacyService } from "./privacy.service";
import { ComplianceDomainError } from "./compliance.errors";
import type { ComplianceActor, LegalPolicyScope } from "./compliance.contract";

function actorOf(claims: Claims): ComplianceActor {
  return { userId: claims.sub, role: claims.role };
}

function metaOf(req: Request) {
  return { ip: req.ip ?? null, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null, requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null };
}

/**
 * Phase 4.7.5 — authenticated buyer/user legal surface (`/legal/me/*`).
 * Any active session may use it; each call is scoped to the caller only.
 */
@Controller("legal/me")
export class ComplianceAccountController {
  constructor(
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
  ) {}

  @Get("requirements")
  async requirements(@CurrentUser() claims: Claims, @Query("scope") scope?: string) {
    if (scope !== "RETAIL" && scope !== "WHOLESALE_VIP") throw new ComplianceDomainError("VALIDATION_ERROR", "scope باید RETAIL یا WHOLESALE_VIP باشد", 400);
    return toApiJson(await this.compliance.getAcceptanceStatus(scope as LegalPolicyScope, { userId: claims.sub }));
  }

  @Get("acceptances")
  async acceptances(@CurrentUser() claims: Claims) {
    return toApiJson({ acceptances: await this.compliance.listAcceptancesForSubject({ userId: claims.sub }) });
  }

  @Post("acceptances")
  async accept(@CurrentUser() claims: Claims, @Body() body: { policyDocumentId: string; context?: string }, @Req() req: Request) {
    return toApiJson(await this.compliance.acceptPolicyAsUser(actorOf(claims), { policyDocumentId: body?.policyDocumentId, context: body?.context, requestMetadata: metaOf(req) }));
  }

  @Get("consent")
  async consent(@CurrentUser() claims: Claims) {
    return toApiJson(await this.compliance.getConsentState(claims.sub));
  }

  @Post("consent")
  async recordConsent(@CurrentUser() claims: Claims, @Body() body: { purpose: string; eventType: string; source?: string; noticeDocumentId?: string }) {
    return toApiJson(await this.compliance.recordConsent(actorOf(claims), { purpose: body?.purpose, eventType: body?.eventType, source: body?.source, noticeDocumentId: body?.noticeDocumentId }));
  }

  @Get("data-requests")
  async myRequests(@CurrentUser() claims: Claims) {
    return toApiJson({ requests: await this.privacy.listMyRequests(actorOf(claims)) });
  }

  @Post("data-requests")
  async submitRequest(@CurrentUser() claims: Claims, @Body() body: { requestType: string; subjectNote?: string }) {
    return toApiJson(await this.privacy.submitRequest(actorOf(claims), { requestType: body?.requestType, subjectNote: body?.subjectNote }));
  }

  @Get("data-export")
  async dataExport(@CurrentUser() claims: Claims) {
    return toApiJson(await this.privacy.buildAccessExport(claims.sub));
  }
}
