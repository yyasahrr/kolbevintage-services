import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  businessComplianceCredential,
  businessLegalProfile,
  consentEvent,
  legalPolicyAcceptance,
  legalPolicyDocument,
  transactionComplianceSnapshot,
  BUSINESS_CREDENTIAL_TYPES,
  BUSINESS_ENTITY_TYPES,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  LEGAL_ACCEPTANCE_CONTEXTS,
  LEGAL_POLICY_SCOPES,
  LEGAL_POLICY_TYPES,
} from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { ComplianceDomainError, optionalString, requireOneOf, requireString } from "./compliance.errors";
import { ComplianceKeyring, hashCanonical, requestMetadataHash, sha256Hex } from "./compliance.hashing";
import type {
  AcceptanceStatus,
  AcceptanceSubject,
  ComplianceActor,
  LegalPolicyScope,
  LegalPolicyType,
  MissingPolicy,
  PolicyBundleEntry,
  RequestMetadata,
  RetailCheckoutGateInput,
  TransactionSnapshotInput,
} from "./compliance.contract";

type Executor = any;

/** Policy types that are informational only — they never require acceptance. */
const NEVER_REQUIRED: readonly LegalPolicyType[] = ["MARKETING_NOTICE", "COOKIE_NOTICE"];

/** Which policy types may live in which scope (business policy, documented). */
const SCOPE_TYPES: Record<LegalPolicyScope, readonly LegalPolicyType[]> = {
  RETAIL: ["TERMS_OF_SERVICE", "PRIVACY_POLICY", "RETAIL_RETURN_POLICY", "MARKETING_NOTICE", "COOKIE_NOTICE"],
  WHOLESALE_VIP: ["WHOLESALE_TERMS", "PRIVACY_POLICY", "MARKETING_NOTICE"],
  SUPPLIER: ["SUPPLIER_AGREEMENT", "PRIVACY_POLICY"],
  PUBLIC: ["PRIVACY_POLICY", "COOKIE_NOTICE", "MARKETING_NOTICE", "TERMS_OF_SERVICE"],
};

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function toBundleEntry(doc: any): PolicyBundleEntry {
  return {
    documentId: doc.id,
    policyType: doc.policyType,
    scope: doc.scope,
    version: doc.version,
    contentHash: doc.contentHash,
    acceptanceRequired: doc.acceptanceRequired,
    reacceptanceRequired: doc.reacceptanceRequired,
  };
}

/** Public/portal projection of a policy — never leaks admin-only columns. */
export function publicPolicyView(doc: any) {
  return {
    id: doc.id,
    policyType: doc.policyType,
    scope: doc.scope,
    locale: doc.locale,
    version: doc.version,
    status: doc.status,
    title: doc.title,
    summary: doc.summary,
    contentText: doc.contentText,
    contentHash: doc.contentHash,
    ruleParameters: doc.ruleParameters ?? {},
    acceptanceRequired: doc.acceptanceRequired,
    effectiveAt: doc.effectiveAt,
    publishedAt: doc.publishedAt,
    retiredAt: doc.retiredAt,
  };
}

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ComplianceKeyring) private readonly keyring: ComplianceKeyring,
  ) {}

  /* ───────────────────────── helpers ───────────────────────── */

  async dbNow(executor?: Executor): Promise<Date> {
    const db = executor || this.db;
    const result = await db.execute(sql`SELECT NOW() AS now`);
    const raw = (result as any).rows?.[0]?.now ?? (result as any)[0]?.now;
    return new Date(raw);
  }

  subjectHash(subject: AcceptanceSubject): string {
    return this.keyring.subjectHash({ userId: subject.userId ?? null, contact: subject.contact ?? null });
  }

  private assertAdmin(actor: ComplianceActor) {
    if (actor.role !== "admin") throw new ComplianceDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
  }

  /* ───────────────────────── policy documents ───────────────────────── */

  async createPolicyDraft(
    actor: ComplianceActor,
    input: {
      policyType: unknown;
      scope: unknown;
      locale?: unknown;
      title: unknown;
      summary?: unknown;
      contentText: unknown;
      ruleParameters?: unknown;
      acceptanceRequired?: unknown;
      reacceptanceRequired?: unknown;
      contentLocation?: unknown;
    },
  ) {
    this.assertAdmin(actor);
    const policyType = requireOneOf(input.policyType, LEGAL_POLICY_TYPES, "policyType") as LegalPolicyType;
    const scope = requireOneOf(input.scope, LEGAL_POLICY_SCOPES, "scope") as LegalPolicyScope;
    if (!SCOPE_TYPES[scope].includes(policyType)) {
      throw new ComplianceDomainError("POLICY_SCOPE_MISMATCH", `${policyType} در دامنهٔ ${scope} تعریف نمی‌شود`, 400);
    }
    const locale = optionalString(input.locale, "locale", 16) ?? "fa-IR";
    const title = requireString(input.title, "title", 200);
    const contentText = requireString(input.contentText, "contentText", 200_000);
    const summary = optionalString(input.summary, "summary", 2000);
    const contentLocation = optionalString(input.contentLocation, "contentLocation", 512);
    const ruleParameters = input.ruleParameters && typeof input.ruleParameters === "object" && !Array.isArray(input.ruleParameters) ? (input.ruleParameters as Record<string, unknown>) : {};
    const acceptanceRequired = NEVER_REQUIRED.includes(policyType) ? false : Boolean(input.acceptanceRequired ?? true);
    const reacceptanceRequired = input.reacceptanceRequired === undefined ? true : Boolean(input.reacceptanceRequired);

    return this.db.transaction(async (tx: Executor) => {
      const [latest] = await tx
        .select({ version: legalPolicyDocument.version })
        .from(legalPolicyDocument)
        .where(and(eq(legalPolicyDocument.policyType, policyType), eq(legalPolicyDocument.scope, scope), eq(legalPolicyDocument.locale, locale)))
        .orderBy(desc(legalPolicyDocument.version))
        .limit(1);
      const version = (latest?.version ?? 0) + 1;
      const id = newId("lpd");
      const [created] = await tx
        .insert(legalPolicyDocument)
        .values({
          id,
          policyType,
          scope,
          locale,
          version,
          status: "draft",
          title,
          summary,
          contentText,
          contentHash: sha256Hex(contentText),
          contentLocation,
          ruleParameters: ruleParameters as any,
          acceptanceRequired,
          reacceptanceRequired,
          createdBy: actor.userId,
        })
        .returning();
      await this.audit.record(
        { actorId: actor.userId, actorRole: actor.role, action: "legal_policy.draft_created", entityType: "legal_policy_document", entityId: id, after: { policyType, scope, locale, version } },
        tx,
      );
      return created;
    });
  }

  async updatePolicyDraft(actor: ComplianceActor, id: string, patch: { title?: unknown; summary?: unknown; contentText?: unknown; ruleParameters?: unknown; acceptanceRequired?: unknown; reacceptanceRequired?: unknown }) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, id)).for("update").limit(1);
      if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
      if (doc.status !== "draft") throw new ComplianceDomainError("LEGAL_POLICY_IMMUTABLE", "متن منتشرشده تغییر نمی‌کند؛ نسخهٔ جدید بسازید");
      const next: Record<string, unknown> = { updatedAt: await this.dbNow(tx) };
      if (patch.title !== undefined) next.title = requireString(patch.title, "title", 200);
      if (patch.summary !== undefined) next.summary = optionalString(patch.summary, "summary", 2000);
      if (patch.contentText !== undefined) {
        const contentText = requireString(patch.contentText, "contentText", 200_000);
        next.contentText = contentText;
        next.contentHash = sha256Hex(contentText);
      }
      if (patch.ruleParameters !== undefined) {
        next.ruleParameters = patch.ruleParameters && typeof patch.ruleParameters === "object" && !Array.isArray(patch.ruleParameters) ? patch.ruleParameters : {};
      }
      if (patch.acceptanceRequired !== undefined) next.acceptanceRequired = NEVER_REQUIRED.includes(doc.policyType) ? false : Boolean(patch.acceptanceRequired);
      if (patch.reacceptanceRequired !== undefined) next.reacceptanceRequired = Boolean(patch.reacceptanceRequired);
      const [updated] = await tx.update(legalPolicyDocument).set(next).where(eq(legalPolicyDocument.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "legal_policy.draft_updated", entityType: "legal_policy_document", entityId: id, after: { fields: Object.keys(next) } }, tx);
      return updated;
    });
  }

  /** Publishes a draft; the currently published version of the same (type, scope, locale) is retired atomically. */
  async publishPolicy(actor: ComplianceActor, id: string, input: { effectiveAt?: unknown } = {}) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, id)).for("update").limit(1);
      if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
      if (doc.status !== "draft") throw new ComplianceDomainError("LEGAL_POLICY_INVALID_TRANSITION", `سند در وضعیت ${doc.status} قابل انتشار نیست`);
      const now = await this.dbNow(tx);
      let effectiveAt = now;
      if (input.effectiveAt !== undefined && input.effectiveAt !== null) {
        const parsed = new Date(String(input.effectiveAt));
        if (Number.isNaN(parsed.getTime())) throw new ComplianceDomainError("VALIDATION_ERROR", "effectiveAt نامعتبر است", 400);
        effectiveAt = parsed;
      }
      const [current] = await tx
        .select()
        .from(legalPolicyDocument)
        .where(and(eq(legalPolicyDocument.policyType, doc.policyType), eq(legalPolicyDocument.scope, doc.scope), eq(legalPolicyDocument.locale, doc.locale), eq(legalPolicyDocument.status, "published")))
        .for("update")
        .limit(1);
      if (current) {
        await tx.update(legalPolicyDocument).set({ status: "retired", retiredAt: now, updatedAt: now }).where(eq(legalPolicyDocument.id, current.id));
      }
      const [published] = await tx
        .update(legalPolicyDocument)
        .set({ status: "published", publishedAt: now, effectiveAt, publishedBy: actor.userId, updatedAt: now })
        .where(eq(legalPolicyDocument.id, id))
        .returning();
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: actor.role,
          action: "legal_policy.published",
          entityType: "legal_policy_document",
          entityId: id,
          before: { retiredDocumentId: current?.id ?? null, retiredVersion: current?.version ?? null },
          after: { policyType: doc.policyType, scope: doc.scope, version: doc.version, contentHash: doc.contentHash, effectiveAt },
        },
        tx,
      );
      return published;
    });
  }

  async retirePolicy(actor: ComplianceActor, id: string) {
    this.assertAdmin(actor);
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, id)).for("update").limit(1);
      if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
      if (doc.status !== "published") throw new ComplianceDomainError("LEGAL_POLICY_INVALID_TRANSITION", "فقط سند منتشرشده بازنشسته می‌شود");
      const now = await this.dbNow(tx);
      const [retired] = await tx.update(legalPolicyDocument).set({ status: "retired", retiredAt: now, updatedAt: now }).where(eq(legalPolicyDocument.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "legal_policy.retired", entityType: "legal_policy_document", entityId: id, after: { version: doc.version } }, tx);
      return retired;
    });
  }

  async listPoliciesForAdmin(filter: { scope?: string | null; policyType?: string | null; status?: string | null } = {}) {
    const conditions = [] as any[];
    if (filter.scope) conditions.push(eq(legalPolicyDocument.scope, filter.scope));
    if (filter.policyType) conditions.push(eq(legalPolicyDocument.policyType, filter.policyType));
    if (filter.status) conditions.push(eq(legalPolicyDocument.status, filter.status));
    const query = this.db.select().from(legalPolicyDocument);
    const rows = conditions.length > 0 ? await query.where(and(...conditions)).orderBy(desc(legalPolicyDocument.createdAt)).limit(500) : await query.orderBy(desc(legalPolicyDocument.createdAt)).limit(500);
    return rows;
  }

  async getPolicyForAdmin(id: string) {
    const [doc] = await this.db.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, id)).limit(1);
    if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
    return doc;
  }

  /** Published (current) documents of a scope. Drafts are never public. */
  async getPublishedPolicies(scope: LegalPolicyScope, executor?: Executor) {
    const db = executor || this.db;
    if (!(LEGAL_POLICY_SCOPES as readonly string[]).includes(scope)) throw new ComplianceDomainError("VALIDATION_ERROR", "scope نامعتبر است", 400);
    return db.select().from(legalPolicyDocument).where(and(eq(legalPolicyDocument.scope, scope), eq(legalPolicyDocument.status, "published"))).orderBy(legalPolicyDocument.policyType);
  }

  /** A published or retired version is publicly queryable (old versions stay readable); drafts are not. */
  async getPublicPolicy(id: string) {
    const [doc] = await this.db.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, id)).limit(1);
    if (!doc || doc.status === "draft") throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
    return publicPolicyView(doc);
  }

  async getPolicyVersionHistory(policyType: string, scope: string, locale = "fa-IR") {
    const rows = await this.db
      .select()
      .from(legalPolicyDocument)
      .where(and(eq(legalPolicyDocument.policyType, policyType), eq(legalPolicyDocument.scope, scope), eq(legalPolicyDocument.locale, locale)))
      .orderBy(desc(legalPolicyDocument.version));
    return rows.filter((r: any) => r.status !== "draft").map(publicPolicyView);
  }

  /** Requirement bundle = published documents of the scope with acceptance_required. */
  async getRequiredBundle(scope: LegalPolicyScope, executor?: Executor): Promise<PolicyBundleEntry[]> {
    const docs = await this.getPublishedPolicies(scope, executor);
    return docs.filter((d: any) => d.acceptanceRequired && !NEVER_REQUIRED.includes(d.policyType)).map(toBundleEntry);
  }

  /* ───────────────────────── acceptance evidence ───────────────────────── */

  /**
   * Records immutable acceptance evidence. The server resolves the document
   * (must be currently published) — a client can only reference an id it was shown.
   */
  async recordAcceptance(
    input: { subject: AcceptanceSubject; policyDocumentId: string; context: string; orderRef?: string | null; requestMetadata?: RequestMetadata | null; subjectType?: "user" | "guest" | "supplier_member" },
    executor?: Executor,
  ) {
    const run = async (tx: Executor) => {
      const context = requireOneOf(input.context, LEGAL_ACCEPTANCE_CONTEXTS, "context");
      const [doc] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, requireString(input.policyDocumentId, "policyDocumentId", 128))).limit(1);
      if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
      if (doc.status !== "published") throw new ComplianceDomainError("LEGAL_POLICY_VERSION_NOT_ACTIVE", `نسخهٔ ${doc.version} از ${doc.policyType} فعال نیست`);
      const subjectHash = this.subjectHash(input.subject);
      const subjectType = input.subjectType ?? (input.subject.userId ? "user" : "guest");
      const acceptedAt = await this.dbNow(tx);
      const evidenceHash = sha256Hex([subjectHash, doc.id, doc.contentHash, context, acceptedAt.toISOString()].join("|"));
      const id = newId("lpa");
      const [row] = await tx
        .insert(legalPolicyAcceptance)
        .values({
          id,
          policyDocumentId: doc.id,
          subjectType,
          userId: input.subject.userId ?? null,
          subjectHash,
          supplierId: input.subject.supplierId ?? null,
          orderRef: input.orderRef ?? null,
          context,
          acceptedAt,
          evidenceHash,
          requestMetadataHash: requestMetadataHash(input.requestMetadata),
        })
        .returning();
      return { acceptance: row, document: toBundleEntry(doc) };
    };
    return executor ? run(executor) : this.db.transaction(run);
  }

  /** Resolves the current status of a subject against a scope's requirement bundle. */
  async getAcceptanceStatus(scope: LegalPolicyScope, subject: AcceptanceSubject, executor?: Executor): Promise<AcceptanceStatus> {
    const db = executor || this.db;
    const required = await this.getRequiredBundle(scope, db);
    if (required.length === 0) return { scope, satisfied: true, required, missing: [] };
    const subjectHash = this.subjectHash(subject);
    const rows = await db
      .select({ policyDocumentId: legalPolicyAcceptance.policyDocumentId, policyType: legalPolicyDocument.policyType, scope: legalPolicyDocument.scope, version: legalPolicyDocument.version })
      .from(legalPolicyAcceptance)
      .innerJoin(legalPolicyDocument, eq(legalPolicyDocument.id, legalPolicyAcceptance.policyDocumentId))
      .where(and(eq(legalPolicyAcceptance.subjectHash, subjectHash), eq(legalPolicyDocument.scope, scope)));
    const missing: MissingPolicy[] = [];
    for (const req of required) {
      const exact = rows.some((r: any) => r.policyDocumentId === req.documentId);
      if (exact) continue;
      const older = rows.some((r: any) => r.policyType === req.policyType && r.version < req.version);
      if (older && !req.reacceptanceRequired) continue;
      missing.push({ ...req, reason: older ? "REACCEPTANCE_REQUIRED" : "NEVER_ACCEPTED" });
    }
    return { scope, satisfied: missing.length === 0, required, missing };
  }

  /** Throws the stable gate error when a scope's requirements are not met. */
  async assertScopeRequirementsSatisfied(scope: LegalPolicyScope, subject: AcceptanceSubject, executor?: Executor): Promise<AcceptanceStatus> {
    const status = await this.getAcceptanceStatus(scope, subject, executor);
    if (status.satisfied) return status;
    const reaccept = status.missing.some((m) => m.reason === "REACCEPTANCE_REQUIRED");
    const detail = status.missing.map((m) => `${m.policyType} v${m.version} (${m.documentId})`).join(", ");
    throw new ComplianceDomainError(
      reaccept ? "LEGAL_POLICY_REACCEPTANCE_REQUIRED" : "LEGAL_POLICY_ACCEPTANCE_REQUIRED",
      reaccept ? `پذیرش مجدد نسخهٔ جدید لازم است: ${detail}` : `پذیرش سند(های) حقوقی لازم است: ${detail}`,
    );
  }

  async listAcceptancesForSubject(subject: AcceptanceSubject) {
    const subjectHash = this.subjectHash(subject);
    return this.db
      .select({
        id: legalPolicyAcceptance.id,
        policyDocumentId: legalPolicyAcceptance.policyDocumentId,
        policyType: legalPolicyDocument.policyType,
        scope: legalPolicyDocument.scope,
        version: legalPolicyDocument.version,
        contentHash: legalPolicyDocument.contentHash,
        context: legalPolicyAcceptance.context,
        orderRef: legalPolicyAcceptance.orderRef,
        acceptedAt: legalPolicyAcceptance.acceptedAt,
        evidenceHash: legalPolicyAcceptance.evidenceHash,
      })
      .from(legalPolicyAcceptance)
      .innerJoin(legalPolicyDocument, eq(legalPolicyDocument.id, legalPolicyAcceptance.policyDocumentId))
      .where(eq(legalPolicyAcceptance.subjectHash, subjectHash))
      .orderBy(desc(legalPolicyAcceptance.acceptedAt))
      .limit(200);
  }

  /** Portal: authenticated user accepts a policy in a scope (RETAIL or WHOLESALE_VIP). Never creates consent. */
  async acceptPolicyAsUser(actor: ComplianceActor, input: { policyDocumentId: unknown; context?: unknown; requestMetadata?: RequestMetadata | null }) {
    if (!actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    const policyDocumentId = requireString(input.policyDocumentId, "policyDocumentId", 128);
    const context = input.context === undefined ? "portal" : requireOneOf(input.context, ["portal", "registration", "wholesale_confirm", "checkout"] as const, "context");
    const [doc] = await this.db.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, policyDocumentId)).limit(1);
    if (!doc) throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "سند حقوقی یافت نشد");
    if (doc.scope === "SUPPLIER") throw new ComplianceDomainError("POLICY_SCOPE_MISMATCH", "قرارداد تأمین‌کننده فقط از مسیر تیم تأمین‌کننده پذیرفته می‌شود", 400);
    return this.recordAcceptance({ subject: { userId: actor.userId }, policyDocumentId, context, requestMetadata: input.requestMetadata ?? null, subjectType: "user" });
  }

  /* ───────────────────────── consent (≠ contract) ───────────────────────── */

  async recordConsent(actor: ComplianceActor, input: { userId?: string | null; purpose: unknown; eventType: unknown; source?: unknown; noticeDocumentId?: unknown }) {
    const targetUserId = actor.role === "admin" && input.userId ? String(input.userId) : actor.userId;
    if (!targetUserId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    if (actor.role !== "admin" && input.userId && input.userId !== actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "رضایت فقط برای حساب خود ثبت می‌شود");
    if (typeof input.purpose !== "string" || !(CONSENT_PURPOSES as readonly string[]).includes(input.purpose)) {
      throw new ComplianceDomainError("CONSENT_PURPOSE_INVALID", `purpose باید یکی از ${CONSENT_PURPOSES.join("، ")} باشد`, 400);
    }
    const eventType = requireOneOf(input.eventType, ["granted", "withdrawn"] as const, "eventType");
    const source = input.source === undefined ? (actor.role === "admin" ? "admin" : "account_settings") : requireOneOf(input.source, CONSENT_SOURCES, "source");
    const noticeDocumentId = optionalString(input.noticeDocumentId, "noticeDocumentId", 128);
    return this.db.transaction(async (tx: Executor) => {
      if (noticeDocumentId) {
        const [notice] = await tx.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, noticeDocumentId)).limit(1);
        if (!notice || notice.policyType !== "MARKETING_NOTICE") throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "اطلاعیهٔ بازاریابی یافت نشد");
      }
      const occurredAt = await this.dbNow(tx);
      const evidenceHash = sha256Hex([targetUserId, input.purpose, eventType, source, occurredAt.toISOString()].join("|"));
      const id = newId("cse");
      const [row] = await tx.insert(consentEvent).values({ id, userId: targetUserId, purpose: input.purpose, eventType, source, noticeDocumentId, occurredAt, evidenceHash }).returning();
      if (actor.role === "admin") {
        await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "consent.recorded_by_admin", entityType: "consent_event", entityId: id, after: { userId: targetUserId, purpose: input.purpose, eventType } }, tx);
      }
      return row;
    });
  }

  /** Current consent state = latest event per purpose (history is never rewritten). */
  async getConsentState(userId: string) {
    const rows = await this.db.select().from(consentEvent).where(eq(consentEvent.userId, userId)).orderBy(desc(consentEvent.occurredAt), desc(consentEvent.createdAt));
    const state: Record<string, { granted: boolean; since: Date | null; lastEventId: string | null }> = {};
    for (const purpose of CONSENT_PURPOSES) state[purpose] = { granted: false, since: null, lastEventId: null };
    for (const row of rows) {
      if (state[row.purpose].lastEventId) continue;
      state[row.purpose] = { granted: row.eventType === "granted", since: row.occurredAt, lastEventId: row.id };
    }
    return { userId, purposes: state, history: rows.map((r: any) => ({ id: r.id, purpose: r.purpose, eventType: r.eventType, source: r.source, occurredAt: r.occurredAt })) };
  }

  async isConsentGranted(userId: string, purpose: string): Promise<boolean> {
    const state = await this.getConsentState(userId);
    return Boolean(state.purposes[purpose]?.granted);
  }

  /* ───────────────────────── business legal identity ───────────────────────── */

  async getBusinessProfileForAdmin() {
    const [row] = await this.db.select().from(businessLegalProfile).where(eq(businessLegalProfile.profileKey, "kolbe")).limit(1);
    return row ?? null;
  }

  async upsertBusinessProfile(actor: ComplianceActor, patch: Record<string, unknown>) {
    this.assertAdmin(actor);
    const allowed = ["legalName", "tradeName", "entityType", "registrationIdentifier", "taxIdentifier", "businessAddress", "supportEmail", "supportPhone", "complaintContact", "internalNotes"] as const;
    const next: Record<string, unknown> = {};
    for (const key of allowed) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (key === "businessAddress") {
        next[key] = value && typeof value === "object" && !Array.isArray(value) ? value : null;
      } else if (key === "entityType") {
        next[key] = value === null || value === "" ? null : requireOneOf(value, BUSINESS_ENTITY_TYPES, "entityType");
      } else {
        next[key] = optionalString(value, key, key === "internalNotes" ? 5000 : 512);
      }
    }
    return this.db.transaction(async (tx: Executor) => {
      const now = await this.dbNow(tx);
      const [existing] = await tx.select().from(businessLegalProfile).where(eq(businessLegalProfile.profileKey, "kolbe")).for("update").limit(1);
      let row;
      if (existing) {
        [row] = await tx.update(businessLegalProfile).set({ ...next, lastReviewedAt: now, updatedBy: actor.userId, updatedAt: now }).where(eq(businessLegalProfile.id, existing.id)).returning();
      } else {
        [row] = await tx.insert(businessLegalProfile).values({ id: newId("blp"), profileKey: "kolbe", ...next, lastReviewedAt: now, updatedBy: actor.userId } as any).returning();
      }
      await this.audit.record(
        { actorId: actor.userId, actorRole: actor.role, action: existing ? "business_profile.updated" : "business_profile.created", entityType: "business_legal_profile", entityId: row.id, before: existing ? pickIdentity(existing) : null, after: pickIdentity(row) },
        tx,
      );
      return row;
    });
  }

  /** Public, sanitized identity view — no internal notes, no unverified credential claims. */
  async getPublicBusinessProfile() {
    const profile = await this.getBusinessProfileForAdmin();
    const credentials = await this.db.select().from(businessComplianceCredential);
    const now = Date.now();
    const verified = credentials
      .filter((c: any) => c.status === "verified" && (!c.expiresAt || new Date(c.expiresAt).getTime() > now))
      .map((c: any) => ({ credentialType: c.credentialType, issuer: c.issuer, publicReference: c.publicReference, verificationUrl: c.verificationUrl, expiresAt: c.expiresAt }));
    const identity = profile ? pickIdentity(profile) : { legalName: null, tradeName: null, entityType: null, registrationIdentifier: null, taxIdentifier: null, businessAddress: null, supportEmail: null, supportPhone: null, complaintContact: null };
    const gaps: string[] = [];
    if (!identity.legalName) gaps.push("LEGAL_NAME_MISSING");
    if (!identity.businessAddress) gaps.push("BUSINESS_ADDRESS_MISSING");
    if (!identity.supportEmail && !identity.supportPhone) gaps.push("SUPPORT_CONTACT_MISSING");
    if (!identity.complaintContact) gaps.push("COMPLAINT_CONTACT_MISSING");
    return { ...identity, verifiedCredentials: verified, disclosureGaps: gaps, disclosureComplete: gaps.length === 0 };
  }

  async listCredentialsForAdmin() {
    return this.db.select().from(businessComplianceCredential).orderBy(desc(businessComplianceCredential.createdAt));
  }

  async createCredential(actor: ComplianceActor, input: { credentialType: unknown; issuer: unknown; publicReference?: unknown; verificationUrl?: unknown; issuedAt?: unknown; expiresAt?: unknown; notes?: unknown }) {
    this.assertAdmin(actor);
    const credentialType = requireOneOf(input.credentialType, BUSINESS_CREDENTIAL_TYPES, "credentialType");
    const issuer = requireString(input.issuer, "issuer", 200);
    const row = {
      id: newId("bcc"),
      credentialType,
      issuer,
      publicReference: optionalString(input.publicReference, "publicReference", 200),
      verificationUrl: optionalString(input.verificationUrl, "verificationUrl", 512),
      issuedAt: parseOptionalDate(input.issuedAt, "issuedAt"),
      expiresAt: parseOptionalDate(input.expiresAt, "expiresAt"),
      status: "unverified" as const,
      notes: optionalString(input.notes, "notes", 5000),
      createdBy: actor.userId,
    };
    return this.db.transaction(async (tx: Executor) => {
      const [created] = await tx.insert(businessComplianceCredential).values(row).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "business_credential.created", entityType: "business_compliance_credential", entityId: row.id, after: { credentialType, issuer, status: "unverified" } }, tx);
      return created;
    });
  }

  /** Admin verification with an explicit source. Verification is never automatic and never client-set. */
  async transitionCredential(actor: ComplianceActor, id: string, input: { status: unknown; verificationSource?: unknown; notes?: unknown }) {
    this.assertAdmin(actor);
    const target = requireOneOf(input.status, ["verified", "expired", "revoked"] as const, "status");
    return this.db.transaction(async (tx: Executor) => {
      const [cred] = await tx.select().from(businessComplianceCredential).where(eq(businessComplianceCredential.id, id)).for("update").limit(1);
      if (!cred) throw new ComplianceDomainError("CREDENTIAL_NOT_FOUND", "اعتبارنامه یافت نشد");
      const allowed: Record<string, string[]> = { unverified: ["verified", "revoked"], verified: ["expired", "revoked"], expired: ["verified"], revoked: [] };
      if (!allowed[cred.status]?.includes(target)) throw new ComplianceDomainError("CREDENTIAL_INVALID_TRANSITION", `گذار ${cred.status} → ${target} مجاز نیست`);
      const now = await this.dbNow(tx);
      const patch: Record<string, unknown> = { status: target, updatedAt: now, notes: input.notes !== undefined ? optionalString(input.notes, "notes", 5000) : cred.notes };
      if (target === "verified") {
        patch.verifiedAt = now;
        patch.verifiedBy = actor.userId;
        patch.verificationSource = requireString(input.verificationSource, "verificationSource", 512);
      }
      const [updated] = await tx.update(businessComplianceCredential).set(patch).where(eq(businessComplianceCredential.id, id)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `business_credential.${target}`, entityType: "business_compliance_credential", entityId: id, before: { status: cred.status }, after: { status: target, verificationSource: patch.verificationSource ?? null } }, tx);
      return updated;
    });
  }

  /* ───────────────────────── transaction snapshots ───────────────────────── */

  async recordTransactionSnapshot(input: TransactionSnapshotInput, executor?: Executor) {
    const run = async (tx: Executor) => {
      const policyBundleHash = hashCanonical(input.policyBundle);
      const disclosureHash = input.disclosure ? hashCanonical(input.disclosure) : null;
      const commercialSnapshotHash = input.commercialSnapshot !== undefined && input.commercialSnapshot !== null ? hashCanonical(input.commercialSnapshot) : null;
      const id = newId("tcs");
      if (input.retailOrderRef) {
        const [dup] = await tx.select({ id: transactionComplianceSnapshot.id }).from(transactionComplianceSnapshot).where(eq(transactionComplianceSnapshot.retailOrderRef, input.retailOrderRef)).limit(1);
        if (dup) throw new ComplianceDomainError("TRANSACTION_SNAPSHOT_EXISTS", "برای این تراکنش قبلاً اسنپ‌شات حقوقی ثبت شده است");
      }
      if (input.wholesaleOrderId) {
        const [dup] = await tx.select({ id: transactionComplianceSnapshot.id }).from(transactionComplianceSnapshot).where(eq(transactionComplianceSnapshot.wholesaleOrderId, input.wholesaleOrderId)).limit(1);
        if (dup) throw new ComplianceDomainError("TRANSACTION_SNAPSHOT_EXISTS", "برای این تراکنش قبلاً اسنپ‌شات حقوقی ثبت شده است");
      }
      try {
        const [row] = await tx
          .insert(transactionComplianceSnapshot)
          .values({
            id,
            scope: input.scope,
            wholesaleOrderId: input.wholesaleOrderId ?? null,
            retailOrderRef: input.retailOrderRef ?? null,
            supplierId: input.supplierId ?? null,
            userId: input.userId ?? null,
            subjectHash: input.subjectHash,
            policyBundle: input.policyBundle as any,
            policyBundleHash,
            disclosure: (input.disclosure ?? null) as any,
            disclosureHash,
            commercialSnapshotHash,
          })
          .returning();
        return row;
      } catch (error: any) {
        if (error?.code === "23505" || error?.cause?.code === "23505") throw new ComplianceDomainError("TRANSACTION_SNAPSHOT_EXISTS", "برای این تراکنش قبلاً اسنپ‌شات حقوقی ثبت شده است");
        throw error;
      }
    };
    return executor ? run(executor) : this.db.transaction(run);
  }

  async getSnapshotForWholesaleOrder(orderId: string, executor?: Executor) {
    const db = executor || this.db;
    const [row] = await db.select().from(transactionComplianceSnapshot).where(eq(transactionComplianceSnapshot.wholesaleOrderId, orderId)).limit(1);
    return row ?? null;
  }

  async getSnapshotForRetailOrder(orderRef: string) {
    const [row] = await this.db.select().from(transactionComplianceSnapshot).where(eq(transactionComplianceSnapshot.retailOrderRef, orderRef)).limit(1);
    return row ?? null;
  }

  async listSnapshotsForUser(userId: string) {
    return this.db.select().from(transactionComplianceSnapshot).where(eq(transactionComplianceSnapshot.userId, userId)).orderBy(desc(transactionComplianceSnapshot.createdAt)).limit(100);
  }

  /* ───────────────────────── wholesale binding point ───────────────────────── */

  /** Snapshot half of the wholesale binding point (the gate is `assertScopeRequirementsSatisfied`). Idempotent per order. */
  async recordWholesaleConfirmSnapshot(input: { orderId: string; buyerUserId: string; commercialSnapshot: unknown }, executor: Executor) {
    const existing = await this.getSnapshotForWholesaleOrder(input.orderId, executor);
    if (existing) return { snapshot: existing, replayed: true };
    const published = await this.getPublishedPolicies("WHOLESALE_VIP", executor);
    const snapshot = await this.recordTransactionSnapshot(
      {
        scope: "WHOLESALE",
        wholesaleOrderId: input.orderId,
        userId: input.buyerUserId,
        subjectHash: this.subjectHash({ userId: input.buyerUserId }),
        policyBundle: published.map(toBundleEntry),
        commercialSnapshot: input.commercialSnapshot,
      },
      executor,
    );
    return { snapshot, replayed: false };
  }

  /** Gate + snapshot in one call (for callers that do not need to interleave other work). */
  async bindWholesaleConfirmation(input: { orderId: string; buyerUserId: string; commercialSnapshot: unknown }, executor: Executor) {
    const status = await this.assertScopeRequirementsSatisfied("WHOLESALE_VIP", { userId: input.buyerUserId }, executor);
    const published = await this.getPublishedPolicies("WHOLESALE_VIP", executor);
    const existing = await this.getSnapshotForWholesaleOrder(input.orderId, executor);
    if (existing) return { snapshot: existing, status, replayed: true };
    const snapshot = await this.recordTransactionSnapshot(
      {
        scope: "WHOLESALE",
        wholesaleOrderId: input.orderId,
        userId: input.buyerUserId,
        subjectHash: this.subjectHash({ userId: input.buyerUserId }),
        policyBundle: published.map(toBundleEntry),
        commercialSnapshot: input.commercialSnapshot,
      },
      executor,
    );
    return { snapshot, status, replayed: false };
  }

  /* ───────────────────────── retail disclosure + checkout gate ───────────────────────── */

  /** Server-derived pre-contract disclosure bundle for retail (E-Commerce Law art. 33/34 fields — see source register S-01). */
  async buildRetailDisclosure(facts: RetailCheckoutGateInput["facts"], executor?: Executor) {
    const business = await this.getPublicBusinessProfile();
    const published = await this.getPublishedPolicies("RETAIL", executor);
    const returnPolicy = published.find((d: any) => d.policyType === "RETAIL_RETURN_POLICY");
    const gaps = [...business.disclosureGaps];
    if (!returnPolicy) gaps.push("RETURN_POLICY_NOT_PUBLISHED");
    if (!published.some((d: any) => d.policyType === "PRIVACY_POLICY")) gaps.push("PRIVACY_POLICY_NOT_PUBLISHED");
    if (!published.some((d: any) => d.policyType === "TERMS_OF_SERVICE")) gaps.push("TERMS_NOT_PUBLISHED");
    gaps.push("TAX_NOT_ASSESSED");
    return {
      version: 1,
      seller: {
        legalName: business.legalName,
        tradeName: business.tradeName,
        businessAddress: business.businessAddress,
        supportEmail: business.supportEmail,
        supportPhone: business.supportPhone,
        complaintContact: business.complaintContact,
        verifiedCredentials: business.verifiedCredentials,
      },
      offer: {
        currency: facts.currency,
        lines: facts.lines,
        shipping: facts.shipping,
        totals: facts.totals,
        /** Taxes are NOT itemized until tax configuration is accountant-verified (Part 19). */
        taxes: { status: "NOT_ASSESSED", note: "مالیات/عوارض در این مرحله محاسبه و تفکیک نشده است" },
        paymentMethod: facts.paymentMethod,
      },
      policies: published.map((d: any) => ({ policyType: d.policyType, documentId: d.id, version: d.version, contentHash: d.contentHash, title: d.title })),
      returnPolicy: returnPolicy ? { documentId: returnPolicy.id, version: returnPolicy.version, ruleParameters: returnPolicy.ruleParameters ?? {} } : null,
      disclosureGaps: gaps,
    };
  }

  /**
   * Retail binding gate. Pure validation + evidence: the caller (checkout owner)
   * decides the order lifecycle. Fails closed when a required RETAIL policy is
   * not among the explicitly presented active document ids.
   */
  async bindRetailCheckout(input: RetailCheckoutGateInput, executor?: Executor) {
    const run = async (tx: Executor) => {
      const facts = input.facts;
      if (!facts || typeof facts.orderRef !== "string" || facts.orderRef.length === 0) throw new ComplianceDomainError("VALIDATION_ERROR", "orderRef الزامی است", 400);
      const contact = input.subject.userId ? null : input.subject.phone || input.subject.email || null;
      if (!input.subject.userId && !contact) throw new ComplianceDomainError("VALIDATION_ERROR", "هویت خریدار (کاربر یا شمارهٔ تماس) لازم است", 400);
      const subject = { userId: input.subject.userId ?? null, contact };
      const presented = new Set((Array.isArray(input.acceptedPolicyDocumentIds) ? input.acceptedPolicyDocumentIds : []).map(String));
      const required = await this.getRequiredBundle("RETAIL", tx);
      const presentedDocs = presented.size > 0 ? await tx.select().from(legalPolicyDocument).where(inArray(legalPolicyDocument.id, [...presented])) : [];
      const missing: MissingPolicy[] = [];
      for (const req of required) {
        if (presented.has(req.documentId)) continue;
        const older = presentedDocs.some((d: any) => d.policyType === req.policyType && d.scope === "RETAIL" && d.version < req.version);
        missing.push({ ...req, reason: older ? "REACCEPTANCE_REQUIRED" : "NEVER_ACCEPTED" });
      }
      if (missing.length > 0) {
        const reaccept = missing.some((m) => m.reason === "REACCEPTANCE_REQUIRED");
        const detail = missing.map((m) => `${m.policyType} v${m.version} (${m.documentId})`).join(", ");
        throw new ComplianceDomainError(reaccept ? "LEGAL_POLICY_REACCEPTANCE_REQUIRED" : "LEGAL_POLICY_ACCEPTANCE_REQUIRED", `پذیرش سند(های) حقوقی خرده‌فروشی لازم است: ${detail}`);
      }
      const disclosure = await this.buildRetailDisclosure(facts, tx);
      if ((process.env.KOLBE_RETAIL_DISCLOSURE_STRICT ?? "0") === "1" && disclosure.disclosureGaps.some((g) => g !== "TAX_NOT_ASSESSED")) {
        throw new ComplianceDomainError("RETAIL_DISCLOSURE_INCOMPLETE", `افشای پیش از قرارداد ناقص است: ${disclosure.disclosureGaps.join(", ")}`);
      }
      const acceptances = [];
      for (const req of required) {
        const result = await this.recordAcceptance({ subject, policyDocumentId: req.documentId, context: "checkout", orderRef: facts.orderRef, requestMetadata: input.requestMetadata ?? null }, tx);
        acceptances.push(result.acceptance);
      }
      const published = await this.getPublishedPolicies("RETAIL", tx);
      const snapshot = await this.recordTransactionSnapshot(
        {
          scope: "RETAIL",
          retailOrderRef: facts.orderRef,
          userId: input.subject.userId ?? null,
          subjectHash: this.subjectHash(subject),
          policyBundle: published.map(toBundleEntry),
          disclosure,
          commercialSnapshot: facts,
        },
        tx,
      );
      return { snapshotId: snapshot.id, policyBundleHash: snapshot.policyBundleHash, disclosureHash: snapshot.disclosureHash, acceptanceIds: acceptances.map((a: any) => a.id), disclosureGaps: disclosure.disclosureGaps };
    };
    return executor ? run(executor) : this.db.transaction(run);
  }

  /* ───────────────────────── return policy evaluation (versioned) ───────────────────────── */

  /**
   * Evaluates the return window under a specific published policy version.
   * Parameters come from the document's `ruleParameters` — nothing is hardcoded.
   * `windowDays` absent ⇒ policy not configured ⇒ eligibility undetermined (never a guessed number).
   */
  async evaluateReturnEligibility(input: { scope: "RETAIL" | "WHOLESALE"; policyDocumentId?: string | null; deliveredAt?: Date | string | null; orderedAt?: Date | string | null; now?: Date }) {
    const policyType = input.scope === "RETAIL" ? "RETAIL_RETURN_POLICY" : "WHOLESALE_TERMS";
    const scope: LegalPolicyScope = input.scope === "RETAIL" ? "RETAIL" : "WHOLESALE_VIP";
    let doc: any = null;
    if (input.policyDocumentId) {
      [doc] = await this.db.select().from(legalPolicyDocument).where(eq(legalPolicyDocument.id, input.policyDocumentId)).limit(1);
      if (!doc || doc.status === "draft") throw new ComplianceDomainError("LEGAL_POLICY_NOT_FOUND", "نسخهٔ سیاست مرجوعی یافت نشد");
      if (doc.policyType !== policyType || doc.scope !== scope) throw new ComplianceDomainError("POLICY_SCOPE_MISMATCH", "نسخهٔ سیاست با دامنهٔ تراکنش مطابقت ندارد", 400);
    } else {
      [doc] = await this.db.select().from(legalPolicyDocument).where(and(eq(legalPolicyDocument.policyType, policyType), eq(legalPolicyDocument.scope, scope), eq(legalPolicyDocument.status, "published"))).limit(1);
    }
    if (!doc) return { scope: input.scope, policy: null, eligible: null as boolean | null, reason: "RETURN_POLICY_NOT_CONFIGURED" };
    const params = (doc.ruleParameters ?? {}) as Record<string, unknown>;
    const windowDays = typeof params.returnWindowDays === "number" && params.returnWindowDays >= 0 ? params.returnWindowDays : null;
    const startsAt = params.windowStartsAt === "order" ? "order" : "delivery";
    const policy = { documentId: doc.id, version: doc.version, policyType: doc.policyType, returnWindowDays: windowDays, windowStartsAt: startsAt, sourceReference: typeof params.sourceReference === "string" ? params.sourceReference : null };
    if (windowDays === null) return { scope: input.scope, policy, eligible: null as boolean | null, reason: "RETURN_WINDOW_NOT_CONFIGURED" };
    const anchor = startsAt === "delivery" ? input.deliveredAt : input.orderedAt;
    if (!anchor) return { scope: input.scope, policy, eligible: null as boolean | null, reason: startsAt === "delivery" ? "NOT_DELIVERED_YET" : "ORDER_DATE_MISSING" };
    const anchorMs = new Date(anchor).getTime();
    const nowMs = (input.now ?? new Date()).getTime();
    const deadline = anchorMs + windowDays * 86_400_000;
    return { scope: input.scope, policy, eligible: nowMs <= deadline, reason: nowMs <= deadline ? null : "RETURN_WINDOW_EXPIRED", deadline: new Date(deadline) };
  }
}

function pickIdentity(row: any) {
  return {
    legalName: row.legalName ?? null,
    tradeName: row.tradeName ?? null,
    entityType: row.entityType ?? null,
    registrationIdentifier: row.registrationIdentifier ?? null,
    taxIdentifier: row.taxIdentifier ?? null,
    businessAddress: row.businessAddress ?? null,
    supportEmail: row.supportEmail ?? null,
    supportPhone: row.supportPhone ?? null,
    complaintContact: row.complaintContact ?? null,
  };
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new ComplianceDomainError("VALIDATION_ERROR", `${field} نامعتبر است`, 400);
  return parsed;
}
