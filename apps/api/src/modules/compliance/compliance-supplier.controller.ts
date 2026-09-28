import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { SupplierComplianceService } from "./supplier-compliance.service";
import { ProductComplianceService } from "./product-compliance.service";
import { ComplianceService } from "./compliance.service";
import type { ComplianceActor } from "./compliance.contract";

function actorOf(claims: Claims): ComplianceActor {
  return { userId: claims.sub, role: claims.role };
}

function metaOf(req: Request) {
  return { ip: req.ip ?? null, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null, requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null };
}

/**
 * Phase 4.7.5 — supplier compliance portal.
 * Every route is authorized against the supplier's membership (role-aware),
 * never against "the first membership of the user".
 */
@Controller("supplier/compliance")
export class ComplianceSupplierController {
  constructor(
    @Inject(SupplierComplianceService) private readonly supplierCompliance: SupplierComplianceService,
    @Inject(ProductComplianceService) private readonly productCompliance: ProductComplianceService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
  ) {}

  @Get("agreement")
  @Roles("supplier")
  async agreement() {
    return toApiJson({ required: await this.compliance.getRequiredBundle("SUPPLIER"), published: (await this.compliance.getPublishedPolicies("SUPPLIER")).map((d: any) => ({ id: d.id, policyType: d.policyType, version: d.version, title: d.title, contentHash: d.contentHash })) });
  }

  @Get(":supplierId/profile")
  @Roles("supplier")
  async profile(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    return toApiJson({ profile: await this.supplierCompliance.getProfile(actorOf(claims), supplierId) });
  }

  @Put(":supplierId/profile")
  @Roles("supplier")
  async upsertProfile(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ profile: await this.supplierCompliance.upsertProfile(actorOf(claims), supplierId, body ?? {}) });
  }

  @Post(":supplierId/profile/submit")
  @Roles("supplier")
  async submitProfile(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    return toApiJson({ profile: await this.supplierCompliance.submitProfile(actorOf(claims), supplierId) });
  }

  @Get(":supplierId/documents")
  @Roles("supplier")
  async documents(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    return toApiJson({ documents: await this.supplierCompliance.listDocuments(actorOf(claims), supplierId) });
  }

  @Post(":supplierId/documents")
  @Roles("supplier")
  async upload(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: { documentType: string; mimeType: string; contentBase64: string; originalFilename?: string }) {
    return toApiJson({ document: await this.supplierCompliance.uploadDocument(actorOf(claims), supplierId, body ?? ({} as any)) });
  }

  @Post("documents/:documentId/access")
  @Roles("supplier")
  async documentAccess(@CurrentUser() claims: Claims, @Param("documentId") documentId: string) {
    return toApiJson(await this.supplierCompliance.issueDocumentAccess(actorOf(claims), documentId));
  }

  @Get(":supplierId/agreement")
  @Roles("supplier")
  async contractStatus(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    await this.supplierCompliance.resolveMembership(actorOf(claims), supplierId, ["owner", "finance", "sales", "warehouse"]);
    return toApiJson(await this.supplierCompliance.getContractStatus(supplierId));
  }

  @Post(":supplierId/agreement/accept")
  @Roles("supplier")
  async acceptAgreement(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: { policyDocumentId: string }, @Req() req: Request) {
    return toApiJson(await this.supplierCompliance.acceptSupplierAgreement(actorOf(claims), supplierId, { policyDocumentId: body?.policyDocumentId, requestMetadata: metaOf(req) }));
  }

  @Get(":supplierId/holds")
  @Roles("supplier")
  async holds(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    return toApiJson({ holds: await this.supplierCompliance.listHolds(actorOf(claims), supplierId) });
  }

  @Get(":supplierId/bank")
  @Roles("supplier")
  async bank(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    return toApiJson({ current: await this.supplierCompliance.getCurrentBankDestination(actorOf(claims), supplierId) });
  }

  @Post(":supplierId/bank")
  @Roles("supplier")
  async submitBank(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: { destinationKind: string; value: string; holderName?: string }) {
    return toApiJson(await this.supplierCompliance.submitBankDestination(actorOf(claims), supplierId, body ?? ({} as any)));
  }

  @Get(":supplierId/settlement-eligibility")
  @Roles("supplier")
  async eligibility(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    await this.supplierCompliance.resolveMembership(actorOf(claims), supplierId, ["owner", "finance"]);
    return toApiJson(await this.supplierCompliance.getSupplierSettlementEligibility(supplierId));
  }

  /* ───────────── product provenance documents (ownership = record.seller membership) ─────────────
   * Declarations and uploads live under the Offers owner (`supplier/offers/:offerId/compliance*`). */

  @Post("products/documents/:documentId/access")
  @Roles("supplier")
  async productDocumentAccess(@CurrentUser() claims: Claims, @Param("documentId") documentId: string) {
    return toApiJson(await this.productCompliance.issueDocumentAccess(actorOf(claims), documentId));
  }
}
