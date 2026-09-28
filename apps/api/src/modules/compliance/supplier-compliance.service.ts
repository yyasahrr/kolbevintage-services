import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  legalPolicyDocument,
  supplierBankVerification,
  supplierComplianceDocument,
  supplierComplianceHold,
  supplierComplianceProfile,
  supplierComplianceReview,
  supplierContractAcceptance,
  BANK_DESTINATION_KINDS,
  BUSINESS_ENTITY_TYPES,
  COMPLIANCE_DOCUMENT_TYPES,
  COMPLIANCE_HOLD_REASON_CODES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { ComplianceService, toBundleEntry } from "./compliance.service";
import { ComplianceDomainError, optionalString, requireOneOf, requireString } from "./compliance.errors";
import { ComplianceKeyring, normalizeBankDestination, requestMetadataHash, sha256Hex } from "./compliance.hashing";
import { DocumentAccessSigner, LocalPrivateDocumentStorage, sanitizeFilename, validateDocumentUpload } from "./document-storage";
import {
  SUPPLIER_COMPLIANCE_MANAGER_ROLES,
  SUPPLIER_COMPLIANCE_VIEWER_ROLES,
  SUPPLIER_CONTRACT_SIGNING_ROLES,
  settlementRequiresBankVerification,
  type ComplianceActor,
  type RequestMetadata,
  type SettlementEligibility,
  type SettlementEligibilityReason,
} from "./compliance.contract";

type Executor = any;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/** Profile projection safe for the supplier portal (no reviewer notes, no risk flags). */
export function supplierProfileView(row: any) {
  return {
    id: row.id,
    supplierId: row.supplierId,
    status: row.status,
    entityType: row.entityType,
    legalName: row.legalName,
    registrationIdentifier: row.registrationIdentifier,
    taxIdentifier: row.taxIdentifier,
    representativeName: row.representativeName,
    representativeAuthorityStatus: row.representativeAuthorityStatus,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    approvedAt: row.approvedAt,
    expiresAt: row.expiresAt,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** Document metadata projection — never the object key. */
export function documentView(row: any) {
  return {
    id: row.id,
    documentType: row.documentType,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    originalFilename: row.originalFilename,
    uploadedAt: row.uploadedAt,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason,
    scanStatus: row.scanStatus,
  };
}

export function bankView(row: any) {
  return {
    id: row.id,
    destinationKind: row.destinationKind,
    maskedValue: row.maskedValue,
    holderNameDeclared: row.holderNameDeclared,
    status: row.status,
    holderMatchStatus: row.holderMatchStatus,
    isCurrent: row.isCurrent,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    verificationSource: row.verificationSource,
    rejectionReason: row.rejectionReason,
  };
}

const PROFILE_EDITABLE_STATUSES = ["draft", "rejected"] as const;

@Injectable()
export class SupplierComplianceService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(ComplianceKeyring) private readonly keyring: ComplianceKeyring,
    @Inject(LocalPrivateDocumentStorage) private readonly storage: LocalPrivateDocumentStorage,
    @Inject(DocumentAccessSigner) private readonly signer: DocumentAccessSigner,
  ) {}

  /* ───────────────────────── authorization (membership-based, no "first membership wins") ───────────────────────── */

  async resolveMembership(actor: ComplianceActor, supplierId: string, allowedRoles: readonly string[]): Promise<{ role: string; supplierId: string }> {
    if (actor.role === "admin") return { role: "admin", supplierId };
    if (actor.role !== "supplier" || !actor.userId) throw new ComplianceDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "عضویت در تیم تأمین‌کننده لازم است");
    const memberships = await this.suppliers.getUserMemberships(actor.userId);
    const membership = memberships.find((m: any) => m.supplierId === supplierId);
    if (!membership) throw new ComplianceDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "شما عضو این تأمین‌کننده نیستید");
    if (!allowedRoles.includes(membership.role)) throw new ComplianceDomainError("SUPPLIER_ROLE_NOT_AUTHORIZED", `نقش ${membership.role} برای این عملیات مجاز نیست`);
    return { role: membership.role, supplierId };
  }

  private assertAdmin(actor: ComplianceActor) {
    if (actor.role !== "admin") throw new ComplianceDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
  }

  private async assertSupplierExists(supplierId: string, executor?: Executor) {
    const row = await this.suppliers.getSupplierById(supplierId, executor);
    if (!row) throw new ComplianceDomainError("SUPPLIER_NOT_FOUND", "تأمین‌کننده یافت نشد");
    return row;
  }

  /* ───────────────────────── KYB profile ───────────────────────── */

  async getProfile(actor: ComplianceActor, supplierId: string) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_VIEWER_ROLES);
    const [row] = await this.db.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).limit(1);
    if (!row) return null;
    return actor.role === "admin" ? row : supplierProfileView(row);
  }

  async upsertProfile(actor: ComplianceActor, supplierId: string, patch: Record<string, unknown>) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_MANAGER_ROLES);
    const next: Record<string, unknown> = {};
    if ("entityType" in patch) next.entityType = patch.entityType === null || patch.entityType === "" ? null : requireOneOf(patch.entityType, BUSINESS_ENTITY_TYPES, "entityType");
    for (const key of ["legalName", "registrationIdentifier", "taxIdentifier", "representativeName"] as const) {
      if (key in patch) next[key] = optionalString(patch[key], key, 300);
    }
    // Supplier can DECLARE representative authority; only admin may mark it verified.
    if ("representativeAuthorityDeclared" in patch && patch.representativeAuthorityDeclared === true) next.representativeAuthorityStatus = "declared";
    return this.db.transaction(async (tx: Executor) => {
      await this.assertSupplierExists(supplierId, tx);
      const now = await this.compliance.dbNow(tx);
      const [existing] = await tx.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).for("update").limit(1);
      let row;
      if (existing) {
        if (!(PROFILE_EDITABLE_STATUSES as readonly string[]).includes(existing.status) && actor.role !== "admin") {
          throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_PROFILE_LOCKED", `پروفایل در وضعیت ${existing.status} توسط تأمین‌کننده قابل ویرایش نیست`);
        }
        if (existing.representativeAuthorityStatus === "verified" && next.representativeAuthorityStatus === "declared") delete next.representativeAuthorityStatus;
        [row] = await tx.update(supplierComplianceProfile).set({ ...next, updatedAt: now }).where(eq(supplierComplianceProfile.id, existing.id)).returning();
      } else {
        [row] = await tx.insert(supplierComplianceProfile).values({ id: newId("scp"), supplierId, status: "draft", ...next, createdBy: actor.userId } as any).returning();
      }
      await this.audit.record(
        { actorId: actor.userId, actorRole: actor.role, action: existing ? "supplier_compliance.profile_updated" : "supplier_compliance.profile_created", entityType: "supplier_compliance_profile", entityId: row.id, after: { supplierId, fields: Object.keys(next) } },
        tx,
      );
      return actor.role === "admin" ? row : supplierProfileView(row);
    });
  }

  async submitProfile(actor: ComplianceActor, supplierId: string) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_MANAGER_ROLES);
    return this.db.transaction(async (tx: Executor) => {
      const [profile] = await tx.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).for("update").limit(1);
      if (!profile) throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_PROFILE_NOT_FOUND", "پروفایل انطباق ایجاد نشده است");
      if (!(PROFILE_EDITABLE_STATUSES as readonly string[]).includes(profile.status)) {
        throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_INVALID_TRANSITION", `پروفایل در وضعیت ${profile.status} قابل ارسال نیست`);
      }
      const missing = ["legalName", "entityType", "representativeName"].filter((f) => !profile[f]);
      if (missing.length > 0) throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_PROFILE_INCOMPLETE", `فیلدهای الزامی: ${missing.join(", ")}`);
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx
        .update(supplierComplianceProfile)
        .set({ status: "submitted", submittedAt: now, version: profile.status === "rejected" ? profile.version + 1 : profile.version, updatedAt: now })
        .where(eq(supplierComplianceProfile.id, profile.id))
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.profile_submitted", entityType: "supplier_compliance_profile", entityId: profile.id, before: { status: profile.status }, after: { status: "submitted", version: updated.version } }, tx);
      return supplierProfileView(updated);
    });
  }

  /** Admin review decisions. Each decision is an immutable review row + audit entry. */
  async reviewProfile(actor: ComplianceActor, supplierId: string, input: { decision: unknown; notes?: unknown; representativeAuthorityVerified?: unknown; riskFlags?: unknown; expiresAt?: unknown }) {
    this.assertAdmin(actor);
    const decision = requireOneOf(input.decision, ["under_review", "needs_information", "approved", "rejected", "suspended", "reinstated", "expired"] as const, "decision");
    const notes = optionalString(input.notes, "notes", 5000);
    if ((decision === "rejected" || decision === "needs_information" || decision === "suspended") && !notes) {
      throw new ComplianceDomainError("VALIDATION_ERROR", "برای این تصمیم ثبت دلیل الزامی است", 400);
    }
    const transitions: Record<string, { from: string[]; to: string }> = {
      under_review: { from: ["submitted"], to: "under_review" },
      needs_information: { from: ["submitted", "under_review"], to: "draft" },
      approved: { from: ["submitted", "under_review"], to: "approved" },
      rejected: { from: ["submitted", "under_review"], to: "rejected" },
      suspended: { from: ["approved"], to: "suspended" },
      reinstated: { from: ["suspended", "expired"], to: "approved" },
      expired: { from: ["approved"], to: "expired" },
    };
    return this.db.transaction(async (tx: Executor) => {
      const [profile] = await tx.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).for("update").limit(1);
      if (!profile) throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_PROFILE_NOT_FOUND", "پروفایل انطباق یافت نشد");
      const rule = transitions[decision];
      if (!rule.from.includes(profile.status)) throw new ComplianceDomainError("SUPPLIER_COMPLIANCE_INVALID_TRANSITION", `تصمیم ${decision} از وضعیت ${profile.status} مجاز نیست`);
      const now = await this.compliance.dbNow(tx);
      const patch: Record<string, unknown> = { status: rule.to, reviewedAt: now, updatedAt: now };
      if (rule.to === "approved") patch.approvedAt = now;
      if (input.representativeAuthorityVerified === true) patch.representativeAuthorityStatus = "verified";
      if (Array.isArray(input.riskFlags)) patch.riskFlags = input.riskFlags.filter((f) => typeof f === "string").slice(0, 20);
      if (input.expiresAt !== undefined) {
        const parsed = input.expiresAt === null ? null : new Date(String(input.expiresAt));
        if (parsed && Number.isNaN(parsed.getTime())) throw new ComplianceDomainError("VALIDATION_ERROR", "expiresAt نامعتبر است", 400);
        patch.expiresAt = parsed;
      }
      const [updated] = await tx.update(supplierComplianceProfile).set(patch).where(eq(supplierComplianceProfile.id, profile.id)).returning();
      const reviewId = newId("scr");
      await tx.insert(supplierComplianceReview).values({ id: reviewId, supplierId, profileId: profile.id, profileVersion: profile.version, decision, notes, reviewedBy: actor.userId! });
      await this.audit.record(
        { actorId: actor.userId, actorRole: actor.role, action: `supplier_compliance.${decision}`, entityType: "supplier_compliance_profile", entityId: profile.id, before: { status: profile.status }, after: { status: rule.to, reviewId } },
        tx,
      );
      return updated;
    });
  }

  async listReviews(actor: ComplianceActor, supplierId: string) {
    this.assertAdmin(actor);
    return this.db.select().from(supplierComplianceReview).where(eq(supplierComplianceReview.supplierId, supplierId)).orderBy(desc(supplierComplianceReview.createdAt));
  }

  async listProfilesForAdmin(filter: { status?: string | null } = {}) {
    const query = this.db.select().from(supplierComplianceProfile);
    return filter.status ? query.where(eq(supplierComplianceProfile.status, filter.status)).orderBy(desc(supplierComplianceProfile.updatedAt)).limit(500) : query.orderBy(desc(supplierComplianceProfile.updatedAt)).limit(500);
  }

  /* ───────────────────────── private documents ───────────────────────── */

  async uploadDocument(actor: ComplianceActor, supplierId: string, input: { documentType: unknown; mimeType: unknown; contentBase64: unknown; originalFilename?: unknown }) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_MANAGER_ROLES);
    if (!actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    const documentType = requireOneOf(input.documentType, COMPLIANCE_DOCUMENT_TYPES, "documentType");
    const { mimeType, bytes, checksum } = validateDocumentUpload({ mimeType: input.mimeType, contentBase64: input.contentBase64 });
    await this.assertSupplierExists(supplierId);
    const id = newId("scd");
    const objectKey = `supplier/${sha256Hex(supplierId).slice(0, 16)}/${id}`;
    await this.storage.put(objectKey, bytes);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx
        .insert(supplierComplianceDocument)
        .values({
          id,
          supplierId,
          documentType,
          storageProvider: this.storage.provider,
          objectKey,
          mimeType,
          sizeBytes: bytes.length,
          checksumSha256: checksum,
          originalFilename: sanitizeFilename(input.originalFilename),
          uploadedBy: actor.userId!,
          reviewStatus: "pending",
          scanStatus: "unavailable",
        })
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.document_uploaded", entityType: "supplier_compliance_document", entityId: id, after: { supplierId, documentType, mimeType, sizeBytes: bytes.length, checksum } }, tx);
      return documentView(row);
    });
  }

  async listDocuments(actor: ComplianceActor, supplierId: string) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_VIEWER_ROLES);
    const rows = await this.db.select().from(supplierComplianceDocument).where(eq(supplierComplianceDocument.supplierId, supplierId)).orderBy(desc(supplierComplianceDocument.uploadedAt));
    return rows.map(documentView);
  }

  /** Owner supplier (manager roles) or admin only; issuance is audited; the URL is short-lived. */
  async issueDocumentAccess(actor: ComplianceActor, documentId: string) {
    const [doc] = await this.db.select().from(supplierComplianceDocument).where(eq(supplierComplianceDocument.id, documentId)).limit(1);
    if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
    try {
      await this.resolveMembership(actor, doc.supplierId, SUPPLIER_COMPLIANCE_MANAGER_ROLES);
    } catch {
      throw new ComplianceDomainError("DOCUMENT_ACCESS_DENIED", "دسترسی به این سند مجاز نیست");
    }
    const now = await this.compliance.dbNow();
    const { token, expiresAt } = this.signer.issue({ kind: "supplier_document", documentId, actorId: actor.userId ?? "admin" }, now.getTime());
    await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.document_access_issued", entityType: "supplier_compliance_document", entityId: documentId, after: { expiresAt } });
    return { url: `/api/v1/legal/documents/access/${token}`, expiresAt };
  }

  /** Resolves a signed token → bytes. Called by the public access endpoint. */
  async readByToken(token: string): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
    const now = await this.compliance.dbNow();
    const payload = this.signer.verify(token, now.getTime());
    if (payload.kind !== "supplier_document") throw new ComplianceDomainError("DOCUMENT_URL_INVALID", "لینک دسترسی معتبر نیست");
    const [doc] = await this.db.select().from(supplierComplianceDocument).where(eq(supplierComplianceDocument.id, payload.documentId)).limit(1);
    if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
    const bytes = await this.storage.read(doc.objectKey);
    if (sha256Hex(bytes) !== doc.checksumSha256) throw new ComplianceDomainError("COMPLIANCE_STORAGE_UNAVAILABLE", "چک‌سام سند مطابقت ندارد");
    await this.audit.record({ actorId: payload.actorId, actorRole: "signed_url", action: "supplier_compliance.document_downloaded", entityType: "supplier_compliance_document", entityId: doc.id });
    return { bytes, mimeType: doc.mimeType, filename: doc.originalFilename || `${doc.id}` };
  }

  async reviewDocument(actor: ComplianceActor, documentId: string, input: { reviewStatus: unknown; rejectionReason?: unknown; scanStatus?: unknown }) {
    this.assertAdmin(actor);
    const reviewStatus = requireOneOf(input.reviewStatus, ["approved", "rejected"] as const, "reviewStatus");
    const rejectionReason = optionalString(input.rejectionReason, "rejectionReason", 2000);
    if (reviewStatus === "rejected" && !rejectionReason) throw new ComplianceDomainError("VALIDATION_ERROR", "دلیل رد الزامی است", 400);
    const scanStatus = input.scanStatus === undefined ? null : requireOneOf(input.scanStatus, ["pending", "clean", "rejected", "unavailable"] as const, "scanStatus");
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(supplierComplianceDocument).where(eq(supplierComplianceDocument.id, documentId)).for("update").limit(1);
      if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
      if (doc.reviewStatus !== "pending") throw new ComplianceDomainError("DOCUMENT_REVIEW_INVALID_TRANSITION", `سند قبلاً ${doc.reviewStatus} شده است`);
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx
        .update(supplierComplianceDocument)
        .set({ reviewStatus, rejectionReason: reviewStatus === "rejected" ? rejectionReason : null, reviewedBy: actor.userId, reviewedAt: now, scanStatus: scanStatus ?? doc.scanStatus, updatedAt: now })
        .where(eq(supplierComplianceDocument.id, documentId))
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `supplier_compliance.document_${reviewStatus}`, entityType: "supplier_compliance_document", entityId: documentId, after: { reviewStatus, scanStatus: updated.scanStatus } }, tx);
      return documentView(updated);
    });
  }

  /* ───────────────────────── supplier agreement (contract acceptance) ───────────────────────── */

  async acceptSupplierAgreement(actor: ComplianceActor, supplierId: string, input: { policyDocumentId: unknown; requestMetadata?: RequestMetadata | null }) {
    if (actor.role === "admin") throw new ComplianceDomainError("SUPPLIER_ROLE_NOT_AUTHORIZED", "قرارداد فقط توسط نمایندهٔ مجاز خود تأمین‌کننده پذیرفته می‌شود");
    const membership = await this.resolveMembership(actor, supplierId, SUPPLIER_CONTRACT_SIGNING_ROLES);
    const policyDocumentId = requireString(input.policyDocumentId, "policyDocumentId", 128);
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, policyDocumentId)).limit(1);
      if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
      if (doc.policyType !== "SUPPLIER_AGREEMENT" || doc.scope !== "SUPPLIER") throw new ComplianceDomainError("POLICY_SCOPE_MISMATCH", "سند، قرارداد تأمین‌کننده نیست", 400);
      if (doc.status !== "published") throw new ComplianceDomainError("LEGAL_POLICY_VERSION_NOT_ACTIVE", `نسخهٔ ${doc.version} فعال نیست`);
      const [existing] = await tx.select().from(supplierContractAcceptance).where(and(eq(supplierContractAcceptance.supplierId, supplierId), eq(supplierContractAcceptance.policyDocumentId, doc.id))).limit(1);
      if (existing) return { acceptance: existing, replayed: true };
      const acceptedAt = await this.compliance.dbNow(tx);
      const evidenceHash = sha256Hex([supplierId, actor.userId, membership.role, doc.id, doc.contentHash, acceptedAt.toISOString()].join("|"));
      const id = newId("sca");
      const [row] = await tx
        .insert(supplierContractAcceptance)
        .values({ id, supplierId, policyDocumentId: doc.id, acceptedByUserId: actor.userId!, memberRole: membership.role, acceptedAt, evidenceHash, requestMetadataHash: requestMetadataHash(input.requestMetadata) })
        .returning();
      // Personal-level evidence too (subject = the signing member), so the member's own history is complete.
      await this.compliance.recordAcceptance({ subject: { userId: actor.userId, supplierId }, policyDocumentId: doc.id, context: "supplier_onboarding", requestMetadata: input.requestMetadata ?? null, subjectType: "supplier_member" }, tx);
      await this.compliance.recordTransactionSnapshot(
        { scope: "SUPPLIER", supplierId, userId: actor.userId, subjectHash: this.keyring.subjectHash({ userId: actor.userId }), policyBundle: [toBundleEntry(doc)] },
        tx,
      );
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.agreement_accepted", entityType: "supplier_contract_acceptance", entityId: id, after: { supplierId, policyDocumentId: doc.id, version: doc.version, memberRole: membership.role } }, tx);
      return { acceptance: row, replayed: false };
    });
  }

  async getContractStatus(supplierId: string, executor?: Executor) {
    const db = executor || this.db;
    const required = await this.compliance.getRequiredBundle("SUPPLIER", db);
    const accepted = await db
      .select({ policyDocumentId: supplierContractAcceptance.policyDocumentId, acceptedAt: supplierContractAcceptance.acceptedAt, memberRole: supplierContractAcceptance.memberRole, policyType: legalPolicyDocument.policyType, version: legalPolicyDocument.version, status: legalPolicyDocument.status })
      .from(supplierContractAcceptance)
      .innerJoin(legalPolicyDocument, eq(legalPolicyDocument.id, supplierContractAcceptance.policyDocumentId))
      .where(eq(supplierContractAcceptance.supplierId, supplierId));
    const missing = required
      .filter((req) => !accepted.some((a: any) => a.policyDocumentId === req.documentId))
      .map((req) => ({ ...req, reason: accepted.some((a: any) => a.policyType === req.policyType && a.version < req.version) ? ("REACCEPTANCE_REQUIRED" as const) : ("NEVER_ACCEPTED" as const) }));
    return { supplierId, required, accepted, missing, satisfied: missing.length === 0 };
  }

  /* ───────────────────────── holds ───────────────────────── */

  async createHold(actor: ComplianceActor, supplierId: string, input: { reasonCode: unknown; notes?: unknown }) {
    this.assertAdmin(actor);
    const reasonCode = requireOneOf(input.reasonCode, COMPLIANCE_HOLD_REASON_CODES, "reasonCode");
    const notes = optionalString(input.notes, "notes", 5000);
    return this.db.transaction(async (tx: Executor) => {
      await this.assertSupplierExists(supplierId, tx);
      const id = newId("sch");
      const [row] = await tx.insert(supplierComplianceHold).values({ id, supplierId, reasonCode, notes, status: "active", createdBy: actor.userId! }).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.hold_created", entityType: "supplier_compliance_hold", entityId: id, after: { supplierId, reasonCode } }, tx);
      return row;
    });
  }

  async releaseHold(actor: ComplianceActor, holdId: string, input: { releaseNotes?: unknown } = {}) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [hold] = await tx.select().from(supplierComplianceHold).where(eq(supplierComplianceHold.id, holdId)).for("update").limit(1);
      if (!hold) throw new ComplianceDomainError("HOLD_NOT_FOUND", "قفل انطباق یافت نشد");
      if (hold.status !== "active") throw new ComplianceDomainError("HOLD_ALREADY_RELEASED", "قفل قبلاً آزاد شده است");
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx.update(supplierComplianceHold).set({ status: "released", releasedAt: now, releasedBy: actor.userId, releaseNotes: optionalString(input.releaseNotes, "releaseNotes", 5000) }).where(eq(supplierComplianceHold.id, holdId)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.hold_released", entityType: "supplier_compliance_hold", entityId: holdId, before: { status: "active" }, after: { status: "released" } }, tx);
      return updated;
    });
  }

  async listHolds(actor: ComplianceActor, supplierId: string) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_VIEWER_ROLES);
    const rows = await this.db.select().from(supplierComplianceHold).where(eq(supplierComplianceHold.supplierId, supplierId)).orderBy(desc(supplierComplianceHold.createdAt));
    return actor.role === "admin" ? rows : rows.map((h: any) => ({ id: h.id, reasonCode: h.reasonCode, status: h.status, createdAt: h.createdAt, releasedAt: h.releasedAt }));
  }

  async hasActiveHold(supplierId: string, executor?: Executor): Promise<boolean> {
    const db = executor || this.db;
    const [row] = await db.select({ id: supplierComplianceHold.id }).from(supplierComplianceHold).where(and(eq(supplierComplianceHold.supplierId, supplierId), eq(supplierComplianceHold.status, "active"))).limit(1);
    return Boolean(row);
  }

  /* ───────────────────────── bank destination verification metadata (no plaintext) ───────────────────────── */

  async submitBankDestination(actor: ComplianceActor, supplierId: string, input: { destinationKind: unknown; value: unknown; holderName?: unknown }) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_MANAGER_ROLES);
    if (!actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    const destinationKind = requireOneOf(input.destinationKind, BANK_DESTINATION_KINDS, "destinationKind");
    const raw = requireString(input.value, "value", 64);
    const { normalized, masked } = normalizeBankDestination(destinationKind, raw);
    const normalizedHash = this.keyring.bankDestinationHash(destinationKind, normalized);
    const holderNameDeclared = optionalString(input.holderName, "holderName", 200);
    return this.db.transaction(async (tx: Executor) => {
      await this.assertSupplierExists(supplierId, tx);
      const now = await this.compliance.dbNow(tx);
      const [current] = await tx.select().from(supplierBankVerification).where(and(eq(supplierBankVerification.supplierId, supplierId), eq(supplierBankVerification.isCurrent, true))).for("update").limit(1);
      if (current && current.normalizedHash === normalizedHash && current.destinationKind === destinationKind) return { verification: bankView(current), replayed: true };
      if (current) await tx.update(supplierBankVerification).set({ isCurrent: false, updatedAt: now }).where(eq(supplierBankVerification.id, current.id));
      const id = newId("sbv");
      const [row] = await tx
        .insert(supplierBankVerification)
        .values({ id, supplierId, destinationKind, maskedValue: masked, normalizedHash, holderNameDeclared, status: "pending", holderMatchStatus: "unknown", isCurrent: true, submittedBy: actor.userId!, submittedAt: now })
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "supplier_compliance.bank_submitted", entityType: "supplier_bank_verification", entityId: id, after: { supplierId, destinationKind, maskedValue: masked, supersededId: current?.id ?? null } }, tx);
      return { verification: bankView(row), replayed: false };
    });
  }

  async reviewBankDestination(actor: ComplianceActor, verificationId: string, input: { status: unknown; holderMatchStatus?: unknown; verificationSource?: unknown; providerReference?: unknown; rejectionReason?: unknown }) {
    this.assertAdmin(actor);
    const status = requireOneOf(input.status, ["verified", "rejected"] as const, "status");
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx.select().from(supplierBankVerification).where(eq(supplierBankVerification.id, verificationId)).for("update").limit(1);
      if (!row) throw new ComplianceDomainError("BANK_VERIFICATION_NOT_FOUND", "رکورد حساب بانکی یافت نشد");
      if (row.status !== "pending" && row.status !== "unverified") throw new ComplianceDomainError("BANK_VERIFICATION_INVALID_TRANSITION", `رکورد در وضعیت ${row.status} است`);
      const now = await this.compliance.dbNow(tx);
      const patch: Record<string, unknown> = { status, updatedAt: now };
      if (status === "verified") {
        patch.verifiedAt = now;
        patch.verifiedBy = actor.userId;
        patch.verificationSource = requireString(input.verificationSource, "verificationSource", 200);
        patch.holderMatchStatus = input.holderMatchStatus === undefined ? "unknown" : requireOneOf(input.holderMatchStatus, ["unknown", "matched", "mismatched"] as const, "holderMatchStatus");
        patch.providerReference = optionalString(input.providerReference, "providerReference", 200);
      } else {
        patch.rejectionReason = requireString(input.rejectionReason, "rejectionReason", 2000);
      }
      const [updated] = await tx.update(supplierBankVerification).set(patch).where(eq(supplierBankVerification.id, verificationId)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `supplier_compliance.bank_${status}`, entityType: "supplier_bank_verification", entityId: verificationId, before: { status: row.status }, after: { status, holderMatchStatus: patch.holderMatchStatus ?? null, verificationSource: patch.verificationSource ?? null } }, tx);
      return bankView(updated);
    });
  }

  async getCurrentBankDestination(actor: ComplianceActor, supplierId: string) {
    await this.resolveMembership(actor, supplierId, SUPPLIER_COMPLIANCE_VIEWER_ROLES);
    const [row] = await this.db.select().from(supplierBankVerification).where(and(eq(supplierBankVerification.supplierId, supplierId), eq(supplierBankVerification.isCurrent, true))).limit(1);
    return row ? bankView(row) : null;
  }

  /**
   * Seller identity facts for invoicing. Only an APPROVED KYB profile contributes
   * legal identifiers; otherwise the supplier's registered legal name is used and
   * `kybStatus` tells the consumer how much to trust it.
   */
  async getSellerIdentitySnapshot(supplierId: string, executor?: Executor) {
    const db = executor || this.db;
    const supplier = await this.suppliers.getSupplierById(supplierId, db);
    if (!supplier) throw new ComplianceDomainError("SUPPLIER_NOT_FOUND", "تأمین‌کننده یافت نشد");
    const [profile] = await db.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).limit(1);
    const approved = profile?.status === "approved";
    return {
      sellerKind: "SUPPLIER" as const,
      supplierId,
      legalName: approved && profile.legalName ? profile.legalName : supplier.legalName ?? null,
      displayName: supplier.displayName ?? null,
      entityType: approved ? profile.entityType ?? null : null,
      registrationIdentifier: approved ? profile.registrationIdentifier ?? null : null,
      taxIdentifier: approved ? profile.taxIdentifier ?? null : null,
      kybStatus: profile?.status ?? "missing",
    };
  }

  /* ───────────────────────── settlement eligibility (read-only contract for Phase 4.8) ───────────────────────── */

  async getSupplierSettlementEligibility(supplierId: string, executor?: Executor): Promise<SettlementEligibility> {
    const db = executor || this.db;
    const reasons: SettlementEligibilityReason[] = [];
    const [profile] = await db.select().from(supplierComplianceProfile).where(eq(supplierComplianceProfile.supplierId, supplierId)).limit(1);
    if (!profile) reasons.push("SUPPLIER_COMPLIANCE_PROFILE_MISSING");
    else if (profile.status !== "approved") reasons.push("SUPPLIER_COMPLIANCE_NOT_APPROVED");
    else if (profile.representativeAuthorityStatus !== "verified") reasons.push("SUPPLIER_VERIFICATION_INCOMPLETE");
    const contract = await this.getContractStatus(supplierId, db);
    if (contract.required.length === 0) {
      // No Supplier Agreement published yet → contract requirement cannot be satisfied.
      reasons.push("SUPPLIER_CONTRACT_NOT_ACCEPTED");
    } else if (!contract.satisfied) {
      reasons.push(contract.missing.some((m) => m.reason === "REACCEPTANCE_REQUIRED") ? "SUPPLIER_CONTRACT_OUTDATED" : "SUPPLIER_CONTRACT_NOT_ACCEPTED");
    }
    const bankRequired = settlementRequiresBankVerification();
    if (bankRequired) {
      const [bank] = await db.select().from(supplierBankVerification).where(and(eq(supplierBankVerification.supplierId, supplierId), eq(supplierBankVerification.isCurrent, true))).limit(1);
      if (!bank || bank.status !== "verified") reasons.push("SUPPLIER_BANK_NOT_VERIFIED");
    }
    if (await this.hasActiveHold(supplierId, db)) reasons.push("SUPPLIER_COMPLIANCE_HOLD_ACTIVE");
    const checkedAt = (await this.compliance.dbNow(db)).toISOString();
    return { supplierId, eligible: reasons.length === 0, reasons, checkedAt, policy: { bankVerificationRequired: bankRequired } };
  }
}
