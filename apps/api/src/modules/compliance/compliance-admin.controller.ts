import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { toApiJson } from "../../common/api-json";
import { ComplianceService } from "./compliance.service";
import { SupplierComplianceService } from "./supplier-compliance.service";
import { ProductComplianceService } from "./product-compliance.service";
import { PrivacyService } from "./privacy.service";
import type { ComplianceActor } from "./compliance.contract";

function actorOf(claims: Claims): ComplianceActor {
  return { userId: claims.sub, role: claims.role };
}

/** Phase 4.7.5 — admin compliance surface. Every mutation is audited by the services. */
@Controller("admin/compliance")
export class ComplianceAdminController {
  constructor(
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(SupplierComplianceService) private readonly supplierCompliance: SupplierComplianceService,
    @Inject(ProductComplianceService) private readonly productCompliance: ProductComplianceService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
  ) {}

  /* ───────────── legal policy documents ───────────── */

  @Get("policies")
  @Roles("admin")
  async listPolicies(@Query("scope") scope?: string, @Query("policyType") policyType?: string, @Query("status") status?: string) {
    return toApiJson({ policies: await this.compliance.listPoliciesForAdmin({ scope, policyType, status }) });
  }

  @Post("policies")
  @Roles("admin")
  async createPolicy(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ policy: await this.compliance.createPolicyDraft(actorOf(claims), body as any) });
  }

  @Get("policies/:id")
  @Roles("admin")
  async getPolicy(@Param("id") id: string) {
    return toApiJson({ policy: await this.compliance.getPolicyForAdmin(id) });
  }

  @Put("policies/:id")
  @Roles("admin")
  async updatePolicy(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ policy: await this.compliance.updatePolicyDraft(actorOf(claims), id, body as any) });
  }

  @Post("policies/:id/publish")
  @Roles("admin")
  async publishPolicy(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { effectiveAt?: string }) {
    return toApiJson({ policy: await this.compliance.publishPolicy(actorOf(claims), id, body ?? {}) });
  }

  @Post("policies/:id/retire")
  @Roles("admin")
  async retirePolicy(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson({ policy: await this.compliance.retirePolicy(actorOf(claims), id) });
  }

  /* ───────────── business identity & credentials ───────────── */

  @Get("business-profile")
  @Roles("admin")
  async businessProfile() {
    return toApiJson({ profile: await this.compliance.getBusinessProfileForAdmin(), publicView: await this.compliance.getPublicBusinessProfile() });
  }

  @Put("business-profile")
  @Roles("admin")
  async upsertBusinessProfile(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ profile: await this.compliance.upsertBusinessProfile(actorOf(claims), body ?? {}) });
  }

  @Get("credentials")
  @Roles("admin")
  async credentials() {
    return toApiJson({ credentials: await this.compliance.listCredentialsForAdmin() });
  }

  @Post("credentials")
  @Roles("admin")
  async createCredential(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ credential: await this.compliance.createCredential(actorOf(claims), body as any) });
  }

  @Post("credentials/:id/status")
  @Roles("admin")
  async transitionCredential(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { status: string; verificationSource?: string; notes?: string }) {
    return toApiJson({ credential: await this.compliance.transitionCredential(actorOf(claims), id, body ?? ({} as any)) });
  }

  /* ───────────── supplier compliance ───────────── */

  @Get("suppliers")
  @Roles("admin")
  async supplierProfiles(@Query("status") status?: string) {
    return toApiJson({ profiles: await this.supplierCompliance.listProfilesForAdmin({ status }) });
  }

  @Get("suppliers/:supplierId")
  @Roles("admin")
  async supplierProfile(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string) {
    const actor = actorOf(claims);
    return toApiJson({
      profile: await this.supplierCompliance.getProfile(actor, supplierId),
      documents: await this.supplierCompliance.listDocuments(actor, supplierId),
      contract: await this.supplierCompliance.getContractStatus(supplierId),
      holds: await this.supplierCompliance.listHolds(actor, supplierId),
      bank: await this.supplierCompliance.getCurrentBankDestination(actor, supplierId),
      reviews: await this.supplierCompliance.listReviews(actor, supplierId),
      settlementEligibility: await this.supplierCompliance.getSupplierSettlementEligibility(supplierId),
    });
  }

  @Put("suppliers/:supplierId/profile")
  @Roles("admin")
  async adminUpsertSupplierProfile(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ profile: await this.supplierCompliance.upsertProfile(actorOf(claims), supplierId, body ?? {}) });
  }

  @Post("suppliers/:supplierId/review")
  @Roles("admin")
  async reviewSupplier(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ profile: await this.supplierCompliance.reviewProfile(actorOf(claims), supplierId, body as any) });
  }

  @Post("suppliers/documents/:documentId/review")
  @Roles("admin")
  async reviewSupplierDocument(@CurrentUser() claims: Claims, @Param("documentId") documentId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ document: await this.supplierCompliance.reviewDocument(actorOf(claims), documentId, body as any) });
  }

  @Post("suppliers/documents/:documentId/access")
  @Roles("admin")
  async supplierDocumentAccess(@CurrentUser() claims: Claims, @Param("documentId") documentId: string) {
    return toApiJson(await this.supplierCompliance.issueDocumentAccess(actorOf(claims), documentId));
  }

  @Post("suppliers/:supplierId/holds")
  @Roles("admin")
  async createHold(@CurrentUser() claims: Claims, @Param("supplierId") supplierId: string, @Body() body: { reasonCode: string; notes?: string }) {
    return toApiJson({ hold: await this.supplierCompliance.createHold(actorOf(claims), supplierId, body ?? ({} as any)) });
  }

  @Post("suppliers/holds/:holdId/release")
  @Roles("admin")
  async releaseHold(@CurrentUser() claims: Claims, @Param("holdId") holdId: string, @Body() body: { releaseNotes?: string }) {
    return toApiJson({ hold: await this.supplierCompliance.releaseHold(actorOf(claims), holdId, body ?? {}) });
  }

  @Post("suppliers/bank/:verificationId/review")
  @Roles("admin")
  async reviewBank(@CurrentUser() claims: Claims, @Param("verificationId") verificationId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ verification: await this.supplierCompliance.reviewBankDestination(actorOf(claims), verificationId, body as any) });
  }

  @Get("suppliers/:supplierId/settlement-eligibility")
  @Roles("admin")
  async eligibility(@Param("supplierId") supplierId: string) {
    return toApiJson(await this.supplierCompliance.getSupplierSettlementEligibility(supplierId));
  }

  /* ───────────── product compliance ───────────── */

  @Get("products")
  @Roles("admin")
  async products(@Query("status") status?: string) {
    return toApiJson({ records: await this.productCompliance.listForAdmin({ status }) });
  }

  @Get("products/:productId")
  @Roles("admin")
  async product(@CurrentUser() claims: Claims, @Param("productId") productId: string) {
    const actor = actorOf(claims);
    return toApiJson({ record: await this.productCompliance.getRecord(actor, productId), documents: await this.productCompliance.listDocuments(actor, productId) });
  }

  @Post("products/:productId/review")
  @Roles("admin")
  async reviewProduct(@CurrentUser() claims: Claims, @Param("productId") productId: string, @Body() body: { status: string; reviewNotes?: string }) {
    return toApiJson({ record: await this.productCompliance.review(actorOf(claims), productId, body ?? ({} as any)) });
  }

  @Post("products/documents/:documentId/review")
  @Roles("admin")
  async reviewProductDocument(@CurrentUser() claims: Claims, @Param("documentId") documentId: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ document: await this.productCompliance.reviewDocument(actorOf(claims), documentId, body as any) });
  }

  @Post("products/documents/:documentId/access")
  @Roles("admin")
  async productDocumentAccess(@CurrentUser() claims: Claims, @Param("documentId") documentId: string) {
    return toApiJson(await this.productCompliance.issueDocumentAccess(actorOf(claims), documentId));
  }

  /* ───────────── privacy: retention, holds, data-subject requests ───────────── */

  @Get("retention-policies")
  @Roles("admin")
  async retentionPolicies() {
    return toApiJson({ policies: await this.privacy.listRetentionPolicies() });
  }

  @Post("retention-policies")
  @Roles("admin")
  async createRetentionPolicy(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ policy: await this.privacy.createRetentionPolicy(actorOf(claims), body as any) });
  }

  @Post("retention-policies/:id/verify")
  @Roles("admin")
  async verifyRetentionPolicy(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { legalSourceReference: string }) {
    return toApiJson({ policy: await this.privacy.verifyRetentionPolicy(actorOf(claims), id, body ?? ({} as any)) });
  }

  @Post("retention-policies/:id/activate")
  @Roles("admin")
  async activateRetentionPolicy(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson({ policy: await this.privacy.activateRetentionPolicy(actorOf(claims), id) });
  }

  @Post("retention-policies/:id/dry-run")
  @Roles("admin")
  async dryRun(@CurrentUser() claims: Claims, @Param("id") id: string) {
    return toApiJson(await this.privacy.dryRunRetentionPolicy(actorOf(claims), id));
  }

  @Get("legal-holds")
  @Roles("admin")
  async legalHolds(@Query("scopeType") scopeType?: string, @Query("scopeId") scopeId?: string, @Query("status") status?: string) {
    return toApiJson({ holds: await this.privacy.listLegalHolds({ scopeType, scopeId, status }) });
  }

  @Post("legal-holds")
  @Roles("admin")
  async createLegalHold(@CurrentUser() claims: Claims, @Body() body: Record<string, unknown>) {
    return toApiJson({ hold: await this.privacy.createLegalHold(actorOf(claims), body as any) });
  }

  @Post("legal-holds/:id/release")
  @Roles("admin")
  async releaseLegalHold(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: { releaseNotes?: string }) {
    return toApiJson({ hold: await this.privacy.releaseLegalHold(actorOf(claims), id, body ?? {}) });
  }

  @Get("data-requests")
  @Roles("admin")
  async dataRequests(@Query("status") status?: string) {
    return toApiJson({ requests: await this.privacy.listRequestsForAdmin({ status }) });
  }

  @Post("data-requests/:id/transition")
  @Roles("admin")
  async transitionRequest(@CurrentUser() claims: Claims, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return toApiJson({ request: await this.privacy.transitionRequest(actorOf(claims), id, body as any) });
  }

  /* ───────────── transaction snapshots (evidence lookup) ───────────── */

  @Get("snapshots/wholesale/:orderId")
  @Roles("admin")
  async wholesaleSnapshot(@Param("orderId") orderId: string) {
    return toApiJson({ snapshot: await this.compliance.getSnapshotForWholesaleOrder(orderId) });
  }

  @Get("snapshots/retail/:orderRef")
  @Roles("admin")
  async retailSnapshot(@Param("orderRef") orderRef: string) {
    return toApiJson({ snapshot: await this.compliance.getSnapshotForRetailOrder(orderRef) });
  }
}
