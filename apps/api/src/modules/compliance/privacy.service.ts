import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  consentEvent,
  dataRetentionPolicy,
  dataSubjectRequest,
  legalHold,
  legalPolicyAcceptance,
  supplierComplianceDocument,
  transactionComplianceSnapshot,
  DATA_SUBJECT_REQUEST_TYPES,
  LEGAL_HOLD_SCOPE_TYPES,
  RETENTION_ACTIONS,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { ComplianceService } from "./compliance.service";
import { ComplianceDomainError, optionalString, requireOneOf, requireString } from "./compliance.errors";
import type { ComplianceActor } from "./compliance.contract";

type Executor = any;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Data categories the Compliance module can evaluate itself in a retention dry-run.
 * Categories owned by other modules are reported as `evaluable: false` — Compliance
 * never queries foreign tables (A2/A3) and never deletes anything (Part 23).
 */
const OWN_CATEGORIES: Record<string, { table: any; timeColumn: any }> = {
  consent_event: { table: consentEvent, timeColumn: consentEvent.occurredAt },
  legal_policy_acceptance: { table: legalPolicyAcceptance, timeColumn: legalPolicyAcceptance.acceptedAt },
  supplier_compliance_document: { table: supplierComplianceDocument, timeColumn: supplierComplianceDocument.uploadedAt },
  transaction_compliance_snapshot: { table: transactionComplianceSnapshot, timeColumn: transactionComplianceSnapshot.createdAt },
  data_subject_request: { table: dataSubjectRequest, timeColumn: dataSubjectRequest.createdAt },
};

/** Categories that are legal/financial evidence — a deletion request never destroys them (Part 22/24). */
export const NEVER_DELETED_CATEGORIES = [
  { category: "legal_policy_acceptance", basis: "contract evidence (E-Commerce Law art. 6-14 data-message evidentiary value; see source register S-01) — NEEDS_LEGAL_VERIFICATION for duration" },
  { category: "transaction_compliance_snapshot", basis: "binding transaction evidence" },
  { category: "financial_ledger / payments / invoices", basis: "bookkeeping & tax record obligations — NEEDS_TAX_ACCOUNTANT_VERIFICATION for duration" },
  { category: "audit_log", basis: "security & accountability log (append-only)" },
] as const;

const DSAR_TRANSITIONS: Record<string, { from: string[]; to: string; decision: boolean }> = {
  require_identity: { from: ["submitted"], to: "identity_verification_required", decision: false },
  start_review: { from: ["submitted", "identity_verification_required"], to: "under_review", decision: false },
  approve: { from: ["under_review"], to: "approved", decision: true },
  reject: { from: ["under_review", "identity_verification_required"], to: "rejected", decision: true },
  start_processing: { from: ["approved"], to: "processing", decision: false },
  complete: { from: ["processing", "approved"], to: "completed", decision: false },
};

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
  ) {}

  private assertAdmin(actor: ComplianceActor) {
    if (actor.role !== "admin") throw new ComplianceDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
  }

  /* ───────────────────────── retention policies (configurable, dry-run only) ───────────────────────── */

  async createRetentionPolicy(actor: ComplianceActor, input: { dataCategory: unknown; scope?: unknown; retentionDays?: unknown; retentionBasis: unknown; action?: unknown; legalSourceReference?: unknown }) {
    this.assertAdmin(actor);
    const dataCategory = requireString(input.dataCategory, "dataCategory", 100);
    const scope = input.scope === undefined ? "platform" : requireOneOf(input.scope, ["retail", "wholesale", "supplier", "platform"] as const, "scope");
    const retentionDays = input.retentionDays === undefined || input.retentionDays === null ? null : Number(input.retentionDays);
    if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays <= 0)) throw new ComplianceDomainError("VALIDATION_ERROR", "retentionDays باید عدد صحیح مثبت باشد", 400);
    const retentionBasis = requireString(input.retentionBasis, "retentionBasis", 2000);
    const action = input.action === undefined ? "review" : requireOneOf(input.action, RETENTION_ACTIONS, "action");
    const legalSourceReference = optionalString(input.legalSourceReference, "legalSourceReference", 300);
    return this.db.transaction(async (tx: Executor) => {
      const id = newId("drp");
      const [row] = await tx.insert(dataRetentionPolicy).values({ id, dataCategory, scope, retentionDays, retentionBasis, action, legalSourceReference, verificationStatus: "NEEDS_LEGAL_VERIFICATION", status: "draft", createdBy: actor.userId }).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "retention_policy.created", entityType: "data_retention_policy", entityId: id, after: { dataCategory, scope, retentionDays, action } }, tx);
      return row;
    });
  }

  /** Marks the legal basis as verified — an explicit, audited admin act with a source reference. */
  async verifyRetentionPolicy(actor: ComplianceActor, id: string, input: { legalSourceReference: unknown }) {
    this.assertAdmin(actor);
    const legalSourceReference = requireString(input.legalSourceReference, "legalSourceReference", 300);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx.select().from(dataRetentionPolicy).where(eq(dataRetentionPolicy.id, id)).for("update").limit(1);
      if (!row) throw new ComplianceDomainError("RETENTION_POLICY_NOT_FOUND", "سیاست نگهداری یافت نشد");
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx.update(dataRetentionPolicy).set({ verificationStatus: "VERIFIED", legalSourceReference, updatedAt: now }).where(eq(dataRetentionPolicy.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "retention_policy.verified", entityType: "data_retention_policy", entityId: id, after: { legalSourceReference } }, tx);
      return updated;
    });
  }

  async activateRetentionPolicy(actor: ComplianceActor, id: string) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx.select().from(dataRetentionPolicy).where(eq(dataRetentionPolicy.id, id)).for("update").limit(1);
      if (!row) throw new ComplianceDomainError("RETENTION_POLICY_NOT_FOUND", "سیاست نگهداری یافت نشد");
      if (row.status !== "draft") throw new ComplianceDomainError("RETENTION_POLICY_INVALID_TRANSITION", `سیاست در وضعیت ${row.status} است`);
      if ((row.action === "delete" || row.action === "anonymize") && (row.verificationStatus !== "VERIFIED" || row.retentionDays === null)) {
        throw new ComplianceDomainError("RETENTION_POLICY_NOT_VERIFIED", "سیاست مخرب بدون تأیید حقوقی و مدت مشخص فعال نمی‌شود");
      }
      const now = await this.compliance.dbNow(tx);
      const [current] = await tx.select().from(dataRetentionPolicy).where(and(eq(dataRetentionPolicy.dataCategory, row.dataCategory), eq(dataRetentionPolicy.scope, row.scope), eq(dataRetentionPolicy.status, "active"))).for("update").limit(1);
      if (current) await tx.update(dataRetentionPolicy).set({ status: "retired", updatedAt: now }).where(eq(dataRetentionPolicy.id, current.id));
      const [updated] = await tx.update(dataRetentionPolicy).set({ status: "active", effectiveAt: now, updatedAt: now }).where(eq(dataRetentionPolicy.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "retention_policy.activated", entityType: "data_retention_policy", entityId: id, before: { retiredPolicyId: current?.id ?? null }, after: { status: "active" } }, tx);
      return updated;
    });
  }

  async listRetentionPolicies() {
    return this.db.select().from(dataRetentionPolicy).orderBy(desc(dataRetentionPolicy.createdAt));
  }

  /** Non-destructive evaluation: counts candidates older than the window. Nothing is modified. */
  async dryRunRetentionPolicy(actor: ComplianceActor, id: string) {
    this.assertAdmin(actor);
    const [policy] = await this.db.select().from(dataRetentionPolicy).where(eq(dataRetentionPolicy.id, id)).limit(1);
    if (!policy) throw new ComplianceDomainError("RETENTION_POLICY_NOT_FOUND", "سیاست نگهداری یافت نشد");
    const now = await this.compliance.dbNow();
    const own = OWN_CATEGORIES[policy.dataCategory];
    const neverDeleted = NEVER_DELETED_CATEGORIES.some((c) => c.category === policy.dataCategory);
    let candidates: number | null = null;
    if (own && policy.retentionDays !== null) {
      const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
      const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(own.table).where(lt(own.timeColumn, cutoff));
      candidates = Number(row?.count ?? 0);
    }
    const activeHolds = await this.db.select({ count: sql<number>`count(*)::int` }).from(legalHold).where(eq(legalHold.status, "active"));
    const result = {
      policyId: policy.id,
      dataCategory: policy.dataCategory,
      action: policy.action,
      retentionDays: policy.retentionDays,
      verificationStatus: policy.verificationStatus,
      evaluable: Boolean(own) && policy.retentionDays !== null,
      evaluableReason: !own ? "OWNER_SERVICE_NOT_AVAILABLE" : policy.retentionDays === null ? "RETENTION_DAYS_NOT_SET" : null,
      candidates,
      destructiveExecutionAvailable: false,
      blockedBy: [neverDeleted ? "LEGAL_EVIDENCE_CATEGORY" : null, Number(activeHolds[0]?.count ?? 0) > 0 ? "ACTIVE_LEGAL_HOLDS_PRESENT" : null].filter(Boolean),
      evaluatedAt: now,
    };
    await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "retention_policy.dry_run", entityType: "data_retention_policy", entityId: id, after: { candidates, evaluable: result.evaluable } });
    return result;
  }

  /* ───────────────────────── legal holds ───────────────────────── */

  async createLegalHold(actor: ComplianceActor, input: { scopeType: unknown; scopeId: unknown; reason: unknown; expiresAt?: unknown }) {
    this.assertAdmin(actor);
    const scopeType = requireOneOf(input.scopeType, LEGAL_HOLD_SCOPE_TYPES, "scopeType");
    const scopeId = requireString(input.scopeId, "scopeId", 200);
    const reason = requireString(input.reason, "reason", 2000);
    const expiresAt = input.expiresAt ? new Date(String(input.expiresAt)) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new ComplianceDomainError("VALIDATION_ERROR", "expiresAt نامعتبر است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const id = newId("lh");
      const [row] = await tx.insert(legalHold).values({ id, scopeType, scopeId, reason, status: "active", createdBy: actor.userId!, expiresAt }).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "legal_hold.created", entityType: "legal_hold", entityId: id, after: { scopeType, scopeId } }, tx);
      return row;
    });
  }

  async releaseLegalHold(actor: ComplianceActor, id: string, input: { releaseNotes?: unknown } = {}) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [hold] = await tx.select().from(legalHold).where(eq(legalHold.id, id)).for("update").limit(1);
      if (!hold) throw new ComplianceDomainError("HOLD_NOT_FOUND", "قفل حقوقی یافت نشد");
      if (hold.status !== "active") throw new ComplianceDomainError("HOLD_ALREADY_RELEASED", "قفل قبلاً آزاد شده است");
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx.update(legalHold).set({ status: "released", releasedAt: now, releasedBy: actor.userId, releaseNotes: optionalString(input.releaseNotes, "releaseNotes", 2000) }).where(eq(legalHold.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "legal_hold.released", entityType: "legal_hold", entityId: id, before: { status: "active" }, after: { status: "released" } }, tx);
      return updated;
    });
  }

  async listLegalHolds(filter: { scopeType?: string | null; scopeId?: string | null; status?: string | null } = {}) {
    const conditions = [] as any[];
    if (filter.scopeType) conditions.push(eq(legalHold.scopeType, filter.scopeType));
    if (filter.scopeId) conditions.push(eq(legalHold.scopeId, filter.scopeId));
    if (filter.status) conditions.push(eq(legalHold.status, filter.status));
    const query = this.db.select().from(legalHold);
    return conditions.length > 0 ? query.where(and(...conditions)).orderBy(desc(legalHold.createdAt)).limit(500) : query.orderBy(desc(legalHold.createdAt)).limit(500);
  }

  async hasActiveLegalHold(scopeType: string, scopeId: string, executor?: Executor): Promise<boolean> {
    const db = executor || this.db;
    const [row] = await db.select({ id: legalHold.id }).from(legalHold).where(and(eq(legalHold.scopeType, scopeType), eq(legalHold.scopeId, scopeId), eq(legalHold.status, "active"))).limit(1);
    return Boolean(row);
  }

  /* ───────────────────────── data subject requests ───────────────────────── */

  async submitRequest(actor: ComplianceActor, input: { requestType: unknown; subjectNote?: unknown }) {
    if (!actor.userId || actor.role === "admin") throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "درخواست فقط توسط صاحب داده ثبت می‌شود");
    const requestType = requireOneOf(input.requestType, DATA_SUBJECT_REQUEST_TYPES, "requestType");
    const subjectNote = optionalString(input.subjectNote, "subjectNote", 2000);
    return this.db.transaction(async (tx: Executor) => {
      const [open] = await tx
        .select({ id: dataSubjectRequest.id })
        .from(dataSubjectRequest)
        .where(and(eq(dataSubjectRequest.userId, actor.userId!), eq(dataSubjectRequest.requestType, requestType), sql`${dataSubjectRequest.status} NOT IN ('rejected', 'completed')`))
        .limit(1);
      if (open) throw new ComplianceDomainError("DATA_SUBJECT_REQUEST_INVALID_STATE", "درخواست بازِ مشابهی وجود دارد");
      const id = newId("dsr");
      const [row] = await tx.insert(dataSubjectRequest).values({ id, userId: actor.userId!, requestType, status: "submitted", subjectNote }).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "data_subject_request.submitted", entityType: "data_subject_request", entityId: id, after: { requestType } }, tx);
      return this.subjectView(row);
    });
  }

  private subjectView(row: any) {
    return { id: row.id, requestType: row.requestType, status: row.status, subjectNote: row.subjectNote, decidedAt: row.decidedAt, completedAt: row.completedAt, retainedCategories: row.retainedCategories ?? [], createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async listMyRequests(actor: ComplianceActor) {
    if (!actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    const rows = await this.db.select().from(dataSubjectRequest).where(eq(dataSubjectRequest.userId, actor.userId)).orderBy(desc(dataSubjectRequest.createdAt));
    return rows.map((r: any) => this.subjectView(r));
  }

  async listRequestsForAdmin(filter: { status?: string | null } = {}) {
    const query = this.db.select().from(dataSubjectRequest);
    return filter.status ? query.where(eq(dataSubjectRequest.status, filter.status)).orderBy(desc(dataSubjectRequest.createdAt)).limit(500) : query.orderBy(desc(dataSubjectRequest.createdAt)).limit(500);
  }

  /**
   * Admin workflow. Decisions are audited. Completing a deletion is blocked by an active
   * legal hold on the user and always records the retained (legal/financial) categories.
   */
  async transitionRequest(actor: ComplianceActor, id: string, input: { action: unknown; decisionReason?: unknown; retainedCategories?: unknown }) {
    this.assertAdmin(actor);
    const action = requireOneOf(input.action, Object.keys(DSAR_TRANSITIONS) as Array<keyof typeof DSAR_TRANSITIONS & string>, "action");
    const rule = DSAR_TRANSITIONS[action];
    const decisionReason = optionalString(input.decisionReason, "decisionReason", 5000);
    if (rule.decision && !decisionReason) throw new ComplianceDomainError("VALIDATION_ERROR", "دلیل تصمیم الزامی است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const [req] = await tx.select().from(dataSubjectRequest).where(eq(dataSubjectRequest.id, id)).for("update").limit(1);
      if (!req) throw new ComplianceDomainError("DATA_SUBJECT_REQUEST_NOT_FOUND", "درخواست یافت نشد");
      if (!rule.from.includes(req.status)) throw new ComplianceDomainError("DATA_SUBJECT_REQUEST_INVALID_STATE", `اقدام ${action} از وضعیت ${req.status} مجاز نیست`);
      const now = await this.compliance.dbNow(tx);
      const patch: Record<string, unknown> = { status: rule.to, updatedAt: now };
      if (rule.decision) {
        patch.decidedBy = actor.userId;
        patch.decidedAt = now;
        patch.decisionReason = decisionReason;
      }
      if (action === "complete") {
        if (req.requestType === "deletion") {
          if (await this.hasActiveLegalHold("user", req.userId, tx)) throw new ComplianceDomainError("LEGAL_HOLD_ACTIVE", "قفل حقوقی فعال است؛ حذف انجام نمی‌شود");
          const extra = Array.isArray(input.retainedCategories) ? input.retainedCategories.filter((c) => c && typeof c === "object") : [];
          patch.retainedCategories = [...NEVER_DELETED_CATEGORIES, ...extra];
        }
        patch.completedAt = now;
      }
      const [updated] = await tx.update(dataSubjectRequest).set(patch).where(eq(dataSubjectRequest.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `data_subject_request.${action}`, entityType: "data_subject_request", entityId: id, before: { status: req.status }, after: { status: rule.to, requestType: req.requestType, retainedCategories: patch.retainedCategories ?? undefined } }, tx);
      return updated;
    });
  }

  /** Access export limited to what Compliance owns about the subject (owner services add their own slices later). */
  async buildAccessExport(userId: string) {
    const acceptances = await this.compliance.listAcceptancesForSubject({ userId });
    const consent = await this.compliance.getConsentState(userId);
    const snapshots = await this.compliance.listSnapshotsForUser(userId);
    const requests = await this.db.select().from(dataSubjectRequest).where(eq(dataSubjectRequest.userId, userId)).orderBy(desc(dataSubjectRequest.createdAt));
    return {
      userId,
      generatedAt: new Date(),
      legalAcceptances: acceptances,
      consent: consent.purposes,
      consentHistory: consent.history,
      transactionSnapshots: snapshots.map((s: any) => ({ id: s.id, scope: s.scope, wholesaleOrderId: s.wholesaleOrderId, retailOrderRef: s.retailOrderRef, policyBundleHash: s.policyBundleHash, createdAt: s.createdAt })),
      dataSubjectRequests: requests.map((r: any) => this.subjectView(r)),
      note: "این خروجی فقط داده‌های ماژول انطباق را شامل می‌شود؛ داده‌های سفارش/پرداخت از سرویس‌های مالک آن‌ها تجمیع می‌شود.",
    };
  }
}
