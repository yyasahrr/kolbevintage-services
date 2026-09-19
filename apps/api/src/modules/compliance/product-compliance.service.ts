import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { productComplianceDocument, productComplianceRecord, COMPLIANCE_DOCUMENT_TYPES, PRODUCT_CONDITION_CLASSES, PRODUCT_ORIGIN_TYPES } from "@kolbe/database";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { ComplianceService } from "./compliance.service";
import { ComplianceDomainError, optionalString, requireOneOf, requireString } from "./compliance.errors";
import { sha256Hex } from "./compliance.hashing";
import { DocumentAccessSigner, LocalPrivateDocumentStorage, sanitizeFilename, validateDocumentUpload } from "./document-storage";
import { documentView } from "./supplier-compliance.service";
import { productPublicationGateMode, type ComplianceActor, type ProductPublicationDecision } from "./compliance.contract";

type Executor = any;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function productRecordView(row: any, admin = false) {
  const base = {
    id: row.id,
    productId: row.productId,
    sellerId: row.sellerId,
    originType: row.originType,
    originCountry: row.originCountry,
    conditionClass: row.conditionClass,
    manufacturerOrImporter: row.manufacturerOrImporter,
    regulatoryIdentifiers: row.regulatoryIdentifiers ?? {},
    sourceRegisterRefs: row.sourceRegisterRefs ?? [],
    status: row.status,
    declaredAt: row.declaredAt,
    reviewedAt: row.reviewedAt,
    updatedAt: row.updatedAt,
  };
  return admin ? { ...base, declaredBy: row.declaredBy, reviewedBy: row.reviewedBy, reviewNotes: row.reviewNotes } : base;
}

@Injectable()
export class ProductComplianceService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(ComplianceService) private readonly compliance: ComplianceService,
    @Inject(LocalPrivateDocumentStorage) private readonly storage: LocalPrivateDocumentStorage,
    @Inject(DocumentAccessSigner) private readonly signer: DocumentAccessSigner,
  ) {}

  /**
   * Supplier authorization = membership (owner/sales/finance) in the supplier that owns `sellerId`.
   * The product↔seller relation itself is asserted by the Offers owner service (the supplier route
   * lives in the offers module), so Compliance never reads offer tables (no catalog/offers cycle).
   */
  private async assertSellerMembership(actor: ComplianceActor, sellerId: string | null): Promise<void> {
    if (actor.role === "admin") return;
    if (actor.role !== "supplier" || !actor.userId) throw new ComplianceDomainError("SUPPLIER_MEMBERSHIP_REQUIRED", "عضویت در تیم تأمین‌کننده لازم است");
    if (!sellerId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "این رکورد به فروشندهٔ شما تعلق ندارد");
    const memberships = await this.suppliers.getUserMemberships(actor.userId);
    const ok = memberships.some((m: any) => m.sellerId === sellerId && ["owner", "sales", "finance"].includes(m.role));
    if (!ok) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "این رکورد به فروشندهٔ شما تعلق ندارد");
  }

  private async loadRecord(productId: string, executor?: Executor) {
    const db = executor || this.db;
    const [row] = await db.select().from(productComplianceRecord).where(eq(productComplianceRecord.productId, productId)).limit(1);
    return row ?? null;
  }

  async getRecord(actor: ComplianceActor, productId: string) {
    const row = await this.loadRecord(productId);
    if (!row) return null;
    await this.assertSellerMembership(actor, row.sellerId);
    return productRecordView(row, actor.role === "admin");
  }

  /** Supplier/admin declaration. A supplier can never set verified/rejected/restricted — the status becomes pending_review. */
  async declare(
    actor: ComplianceActor,
    target: { productId: string; sellerId?: string | null },
    input: { originType?: unknown; originCountry?: unknown; conditionClass?: unknown; manufacturerOrImporter?: unknown; regulatoryIdentifiers?: unknown; sourceRegisterRefs?: unknown },
  ) {
    const productId = target.productId;
    const sellerId = target.sellerId ?? null;
    if (actor.role !== "admin") await this.assertSellerMembership(actor, sellerId);
    const patch: Record<string, unknown> = {};
    if (input.originType !== undefined) patch.originType = requireOneOf(input.originType, PRODUCT_ORIGIN_TYPES, "originType");
    if (input.conditionClass !== undefined) patch.conditionClass = requireOneOf(input.conditionClass, PRODUCT_CONDITION_CLASSES, "conditionClass");
    if (input.originCountry !== undefined) {
      const country = optionalString(input.originCountry, "originCountry", 2);
      if (country && !/^[A-Za-z]{2}$/.test(country)) throw new ComplianceDomainError("VALIDATION_ERROR", "originCountry باید کد دوحرفی ISO باشد", 400);
      patch.originCountry = country ? country.toUpperCase() : null;
    }
    if (input.manufacturerOrImporter !== undefined) patch.manufacturerOrImporter = optionalString(input.manufacturerOrImporter, "manufacturerOrImporter", 300);
    if (input.regulatoryIdentifiers !== undefined) {
      patch.regulatoryIdentifiers = input.regulatoryIdentifiers && typeof input.regulatoryIdentifiers === "object" && !Array.isArray(input.regulatoryIdentifiers) ? input.regulatoryIdentifiers : {};
    }
    if (input.sourceRegisterRefs !== undefined) patch.sourceRegisterRefs = Array.isArray(input.sourceRegisterRefs) ? input.sourceRegisterRefs.filter((r) => typeof r === "string").slice(0, 20) : [];
    return this.db.transaction(async (tx: Executor) => {
      const now = await this.compliance.dbNow(tx);
      const [existing] = await tx.select().from(productComplianceRecord).where(eq(productComplianceRecord.productId, productId)).for("update").limit(1);
      if (existing && actor.role !== "admin" && existing.sellerId && existing.sellerId !== sellerId) {
        throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "رکورد انطباق این محصول به فروشندهٔ دیگری تعلق دارد");
      }
      let row;
      try {
        if (existing) {
          if (existing.status === "restricted" && actor.role !== "admin") throw new ComplianceDomainError("PRODUCT_COMPLIANCE_BLOCKED", "محصول محدود شده است؛ تغییر اظهارنامه فقط توسط مدیر");
          [row] = await tx
            .update(productComplianceRecord)
            .set({ ...patch, sellerId: existing.sellerId ?? sellerId, status: "pending_review", declaredBy: actor.userId, declaredAt: now, reviewedAt: null, reviewedBy: null, updatedAt: now })
            .where(eq(productComplianceRecord.id, existing.id))
            .returning();
        } else {
          [row] = await tx
            .insert(productComplianceRecord)
            .values({ id: newId("pcr"), productId, sellerId, status: "pending_review", declaredBy: actor.userId, declaredAt: now, ...patch } as any)
            .returning();
        }
      } catch (error: any) {
        if (error?.code === "23503" || error?.cause?.code === "23503") throw new ComplianceDomainError("PRODUCT_COMPLIANCE_RECORD_NOT_FOUND", "محصول یافت نشد");
        throw error;
      }
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: existing ? "product_compliance.redeclared" : "product_compliance.declared", entityType: "product_compliance_record", entityId: row.id, before: existing ? { status: existing.status } : null, after: { productId, status: "pending_review", fields: Object.keys(patch) } }, tx);
      return productRecordView(row, actor.role === "admin");
    });
  }

  async review(actor: ComplianceActor, productId: string, input: { status: unknown; reviewNotes?: unknown }) {
    if (actor.role !== "admin") throw new ComplianceDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
    const status = requireOneOf(input.status, ["verified", "rejected", "restricted", "pending_review", "unknown"] as const, "status");
    const reviewNotes = optionalString(input.reviewNotes, "reviewNotes", 5000);
    if ((status === "rejected" || status === "restricted") && !reviewNotes) throw new ComplianceDomainError("VALIDATION_ERROR", "ثبت دلیل الزامی است", 400);
    return this.db.transaction(async (tx: Executor) => {
      const now = await this.compliance.dbNow(tx);
      const [existing] = await tx.select().from(productComplianceRecord).where(eq(productComplianceRecord.productId, productId)).for("update").limit(1);
      let row;
      try {
        if (existing) {
          [row] = await tx.update(productComplianceRecord).set({ status, reviewNotes, reviewedAt: now, reviewedBy: actor.userId, updatedAt: now }).where(eq(productComplianceRecord.id, existing.id)).returning();
        } else {
          [row] = await tx.insert(productComplianceRecord).values({ id: newId("pcr"), productId, status, reviewNotes, reviewedAt: now, reviewedBy: actor.userId } as any).returning();
        }
      } catch (error: any) {
        if (error?.code === "23503" || error?.cause?.code === "23503") throw new ComplianceDomainError("PRODUCT_COMPLIANCE_RECORD_NOT_FOUND", "محصول یافت نشد");
        throw error;
      }
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `product_compliance.${status}`, entityType: "product_compliance_record", entityId: row.id, before: { status: existing?.status ?? null }, after: { productId, status } }, tx);
      return productRecordView(row, true);
    });
  }

  async listForAdmin(filter: { status?: string | null } = {}) {
    const query = this.db.select().from(productComplianceRecord);
    const rows = filter.status ? await query.where(eq(productComplianceRecord.status, filter.status)).orderBy(desc(productComplianceRecord.updatedAt)).limit(500) : await query.orderBy(desc(productComplianceRecord.updatedAt)).limit(500);
    return rows.map((r: any) => productRecordView(r, true));
  }

  /**
   * Publication gate consumed by the catalog owner service.
   *  - off:      never blocks (documented emergency switch).
   *  - external: SUPPLIER-owned products are blocked when rejected/restricted; KOLBE first-party
   *              products are blocked only when restricted. Missing record ⇒ allowed (status `missing`).
   *  - strict:   SUPPLIER-owned products must be `verified`.
   */
  async canPublishProduct(input: { productId: string; ownerType: "KOLBE" | "SUPPLIER" | string }, executor?: Executor): Promise<ProductPublicationDecision> {
    const mode = productPublicationGateMode();
    const db = executor || this.db;
    const [record] = await db.select().from(productComplianceRecord).where(eq(productComplianceRecord.productId, input.productId)).limit(1);
    const complianceStatus = (record?.status ?? "missing") as ProductPublicationDecision["complianceStatus"];
    if (mode === "off") return { allowed: true, mode, complianceStatus, reasonCode: null };
    if (complianceStatus === "restricted") return { allowed: false, mode, complianceStatus, reasonCode: "PRODUCT_COMPLIANCE_BLOCKED" };
    if (input.ownerType !== "SUPPLIER") return { allowed: true, mode, complianceStatus, reasonCode: null };
    if (complianceStatus === "rejected") return { allowed: false, mode, complianceStatus, reasonCode: "PRODUCT_COMPLIANCE_BLOCKED" };
    if (mode === "strict" && complianceStatus !== "verified") return { allowed: false, mode, complianceStatus, reasonCode: "PRODUCT_COMPLIANCE_VERIFICATION_REQUIRED" };
    return { allowed: true, mode, complianceStatus, reasonCode: null };
  }

  /** Alias used by offer owners (same rule set applied to the offer's product). */
  async canPublishOffer(input: { productId: string; sellerType: "KOLBE" | "SUPPLIER" | string }, executor?: Executor): Promise<ProductPublicationDecision> {
    return this.canPublishProduct({ productId: input.productId, ownerType: input.sellerType }, executor);
  }

  /* ───────────────────────── provenance documents ───────────────────────── */

  async uploadDocument(actor: ComplianceActor, productId: string, input: { documentType: unknown; mimeType: unknown; contentBase64: unknown; originalFilename?: unknown }) {
    if (!actor.userId) throw new ComplianceDomainError("COMPLIANCE_ACCESS_DENIED", "ورود لازم است");
    const record = await this.loadRecord(productId);
    if (!record) throw new ComplianceDomainError("PRODUCT_COMPLIANCE_RECORD_NOT_FOUND", "ابتدا اظهارنامهٔ محصول را ثبت کنید");
    await this.assertSellerMembership(actor, record.sellerId);
    const documentType = requireOneOf(input.documentType, COMPLIANCE_DOCUMENT_TYPES, "documentType");
    const { mimeType, bytes, checksum } = validateDocumentUpload({ mimeType: input.mimeType, contentBase64: input.contentBase64 });
    const id = newId("pcd");
    const objectKey = `product/${sha256Hex(productId).slice(0, 16)}/${id}`;
    await this.storage.put(objectKey, bytes);
    return this.db.transaction(async (tx: Executor) => {
      const [row] = await tx
        .insert(productComplianceDocument)
        .values({ id, recordId: record.id, documentType, storageProvider: this.storage.provider, objectKey, mimeType, sizeBytes: bytes.length, checksumSha256: checksum, originalFilename: sanitizeFilename(input.originalFilename), uploadedBy: actor.userId!, reviewStatus: "pending", scanStatus: "unavailable" })
        .returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "product_compliance.document_uploaded", entityType: "product_compliance_document", entityId: id, after: { productId, documentType, checksum } }, tx);
      return documentView(row);
    });
  }

  async listDocuments(actor: ComplianceActor, productId: string) {
    const record = await this.loadRecord(productId);
    if (!record) return [];
    await this.assertSellerMembership(actor, record.sellerId);
    const rows = await this.db.select().from(productComplianceDocument).where(eq(productComplianceDocument.recordId, record.id)).orderBy(desc(productComplianceDocument.uploadedAt));
    return rows.map(documentView);
  }

  async issueDocumentAccess(actor: ComplianceActor, documentId: string) {
    const [doc] = await this.db.select().from(productComplianceDocument).where(eq(productComplianceDocument.id, documentId)).limit(1);
    if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
    const [record] = await this.db.select().from(productComplianceRecord).where(eq(productComplianceRecord.id, doc.recordId)).limit(1);
    try {
      await this.assertSellerMembership(actor, record?.sellerId ?? null);
    } catch {
      throw new ComplianceDomainError("DOCUMENT_ACCESS_DENIED", "دسترسی به این سند مجاز نیست");
    }
    const now = await this.compliance.dbNow();
    const { token, expiresAt } = this.signer.issue({ kind: "product_document", documentId, actorId: actor.userId ?? "admin" }, now.getTime());
    await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: "product_compliance.document_access_issued", entityType: "product_compliance_document", entityId: documentId, after: { expiresAt } });
    return { url: `/api/v1/legal/documents/access/${token}`, expiresAt };
  }

  async readByToken(token: string): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
    const now = await this.compliance.dbNow();
    const payload = this.signer.verify(token, now.getTime());
    if (payload.kind !== "product_document") throw new ComplianceDomainError("DOCUMENT_URL_INVALID", "لینک دسترسی معتبر نیست");
    const [doc] = await this.db.select().from(productComplianceDocument).where(eq(productComplianceDocument.id, payload.documentId)).limit(1);
    if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
    const bytes = await this.storage.read(doc.objectKey);
    if (sha256Hex(bytes) !== doc.checksumSha256) throw new ComplianceDomainError("COMPLIANCE_STORAGE_UNAVAILABLE", "چک‌سام سند مطابقت ندارد");
    await this.audit.record({ actorId: payload.actorId, actorRole: "signed_url", action: "product_compliance.document_downloaded", entityType: "product_compliance_document", entityId: doc.id });
    return { bytes, mimeType: doc.mimeType, filename: doc.originalFilename || doc.id };
  }

  async reviewDocument(actor: ComplianceActor, documentId: string, input: { reviewStatus: unknown; rejectionReason?: unknown; scanStatus?: unknown }) {
    if (actor.role !== "admin") throw new ComplianceDomainError("ROLE_NOT_ALLOWED", "فقط مدیر مجاز است");
    const reviewStatus = requireOneOf(input.reviewStatus, ["approved", "rejected"] as const, "reviewStatus");
    const rejectionReason = optionalString(input.rejectionReason, "rejectionReason", 2000);
    if (reviewStatus === "rejected" && !rejectionReason) throw new ComplianceDomainError("VALIDATION_ERROR", "دلیل رد الزامی است", 400);
    const scanStatus = input.scanStatus === undefined ? null : requireOneOf(input.scanStatus, ["pending", "clean", "rejected", "unavailable"] as const, "scanStatus");
    return this.db.transaction(async (tx: Executor) => {
      const [doc] = await tx.select().from(productComplianceDocument).where(eq(productComplianceDocument.id, documentId)).for("update").limit(1);
      if (!doc) throw new ComplianceDomainError("COMPLIANCE_DOCUMENT_NOT_FOUND", "سند یافت نشد");
      if (doc.reviewStatus !== "pending") throw new ComplianceDomainError("DOCUMENT_REVIEW_INVALID_TRANSITION", `سند قبلاً ${doc.reviewStatus} شده است`);
      const now = await this.compliance.dbNow(tx);
      const [updated] = await tx.update(productComplianceDocument).set({ reviewStatus, rejectionReason: reviewStatus === "rejected" ? rejectionReason : null, reviewedBy: actor.userId, reviewedAt: now, scanStatus: scanStatus ?? doc.scanStatus, updatedAt: now }).where(eq(productComplianceDocument.id, documentId)).returning();
      await this.audit.record({ actorId: actor.userId, actorRole: actor.role, action: `product_compliance.document_${reviewStatus}`, entityType: "product_compliance_document", entityId: documentId, after: { reviewStatus } }, tx);
      return documentView(updated);
    });
  }
}
