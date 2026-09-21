import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  cmsContentDocument,
  cmsContentRevision,
  cmsMediaAsset,
  cmsMediaUsage,
  type KolbeDatabase,
} from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { collectMediaReferences, makeCmsId, validateDocumentPayload, validateDocumentType, validateRevisionStatusTransition, type CmsDbExecutor } from "./cms-validation";

function documentKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._:-]{0,179}$/u.test(value.normalize("NFKC").trim())) throw new ValidationError([{ field: "documentKey", code: "DOCUMENT_KEY_INVALID" }]);
  return value.normalize("NFKC").trim();
}

@Injectable()
export class CmsContentService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, @Inject(AuditService) private readonly audit: AuditService) {}

  async createDocument(input: { documentKey: string; documentType: string; payload: unknown; createdBy?: string | null }) {
    const key = documentKey(input.documentKey);
    const type = validateDocumentType(input.documentType);
    const payload = validateDocumentPayload(type, input.payload);
    const id = makeCmsId("document");
    try {
      return await this.db.transaction(async (tx) => {
        const [document] = await tx.insert(cmsContentDocument).values({ id, documentKey: key, documentType: type, status: "ACTIVE", createdBy: input.createdBy ?? null }).returning();
        if (!document) throw new ConflictError("CMS_DOCUMENT_CREATE_FAILED");
        const revision = await this.insertRevision(tx, { documentId: id, payload, createdBy: input.createdBy ?? null });
        await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.document.created", entityType: "cms_content_document", entityId: id, after: { documentKey: key, documentType: type, revisionId: revision.id } }, tx);
        return { document, revision };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") throw new ConflictError("CMS_DOCUMENT_KEY_CONFLICT", "Document key already exists");
      throw error;
    }
  }

  async rollback(documentId: string, sourceRevisionId: string, actorId: string | null) {
    const [source] = await this.db.select().from(cmsContentRevision).where(and(eq(cmsContentRevision.id, sourceRevisionId), eq(cmsContentRevision.documentId, documentId))).limit(1);
    if (!source) throw new NotFoundError("CMS source revision", sourceRevisionId);
    return this.createRevision({ documentId, payload: source.payload, createdBy: actorId, sourceRevisionId });
  }

  async createRevision(input: { documentId: string; payload: unknown; createdBy?: string | null; sourceRevisionId?: string }) {
    const [document] = await this.db.select().from(cmsContentDocument).where(eq(cmsContentDocument.id, input.documentId)).limit(1);
    if (!document) throw new NotFoundError("CMS content document", input.documentId);
    if (document.status === "ARCHIVED") throw new ConflictError("CMS_DOCUMENT_ARCHIVED");
    const payload = validateDocumentPayload(document.documentType, input.payload);
    if (input.sourceRevisionId) {
      const [source] = await this.db.select({ id: cmsContentRevision.id, documentId: cmsContentRevision.documentId }).from(cmsContentRevision).where(eq(cmsContentRevision.id, input.sourceRevisionId)).limit(1);
      if (!source || source.documentId !== input.documentId) throw new ValidationError([{ field: "sourceRevisionId", code: "SOURCE_REVISION_NOT_ON_DOCUMENT" }]);
    }
    return this.db.transaction(async (tx) => {
      const revision = await this.insertRevision(tx, { documentId: input.documentId, payload, createdBy: input.createdBy ?? null, sourceRevisionId: input.sourceRevisionId });
      await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.document.revision_created", entityType: "cms_content_revision", entityId: revision.id, after: { documentId: input.documentId, version: revision.version, sourceRevisionId: input.sourceRevisionId ?? null } }, tx);
      return revision;
    });
  }

  async insertRevision(tx: CmsDbExecutor, input: { documentId: string; payload: Record<string, unknown>; createdBy: string | null; sourceRevisionId?: string }) {
    const [last] = await tx.select({ version: cmsContentRevision.version }).from(cmsContentRevision).where(eq(cmsContentRevision.documentId, input.documentId)).orderBy(desc(cmsContentRevision.version)).limit(1);
    const [revision] = await tx.insert(cmsContentRevision).values({ id: makeCmsId("document_rev"), documentId: input.documentId, version: (last?.version ?? 0) + 1, payload: input.payload, status: "DRAFT", createdBy: input.createdBy, sourceRevisionId: input.sourceRevisionId ?? null }).returning();
    if (!revision) throw new ConflictError("CMS_DOCUMENT_REVISION_CREATE_FAILED");
    const refs = collectMediaReferences(input.payload);
    if (refs.length) await this.attachMediaUsage(tx, revision.id, refs);
    return revision;
  }

  async attachMediaUsage(tx: CmsDbExecutor, revisionId: string, refs: Array<{ id: string; path: string }>) {
    const ids = [...new Set(refs.map((ref) => ref.id))];
    if (!ids.length) return;
    const assets = await tx.select({ id: cmsMediaAsset.id, archivedAt: cmsMediaAsset.archivedAt }).from(cmsMediaAsset).where(inArray(cmsMediaAsset.id, ids));
    const existing = new Set(assets.map((asset) => asset.id));
    if (existing.size !== ids.length) throw new ValidationError(ids.filter((id) => !existing.has(id)).map((id) => ({ field: "payload", code: `MEDIA_NOT_FOUND:${id}` })));
    const archived = assets.filter((asset) => asset.archivedAt).map((asset) => asset.id);
    if (archived.length) throw new ValidationError(archived.map((id) => ({ field: "payload", code: `MEDIA_ARCHIVED:${id}` })));
    await tx.insert(cmsMediaUsage).values(refs.map((ref) => ({ id: makeCmsId("media_use"), mediaAssetId: ref.id, revisionType: "CONTENT_REVISION", revisionId, fieldPath: ref.path }))).onConflictDoNothing();
  }

  async transitionRevision(id: string, status: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsContentRevision).where(eq(cmsContentRevision.id, id)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS content revision", id);
      validateRevisionStatusTransition(revision.status, status);
      const [updated] = await tx.update(cmsContentRevision).set({ status: status as typeof revision.status, archivedAt: status === "ARCHIVED" ? new Date() : revision.archivedAt }).where(eq(cmsContentRevision.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: `cms.document.revision.${status.toLowerCase()}`, entityType: "cms_content_revision", entityId: id, before: { status: revision.status }, after: { status } }, tx);
      return updated;
    });
  }

  async archiveDocument(id: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [document] = await tx.select().from(cmsContentDocument).where(eq(cmsContentDocument.id, id)).for("update").limit(1);
      if (!document) throw new NotFoundError("CMS content document", id);
      if (document.status === "ARCHIVED") return document;
      const [updated] = await tx.update(cmsContentDocument).set({ status: "ARCHIVED" }).where(eq(cmsContentDocument.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.document.archived", entityType: "cms_content_document", entityId: id, before: { status: document.status }, after: { status: "ARCHIVED" } }, tx);
      return updated;
    });
  }

  async getRevisionById(id: string) {
    const [revision] = await this.db.select().from(cmsContentRevision).where(eq(cmsContentRevision.id, id)).limit(1);
    if (!revision) throw new NotFoundError("CMS content revision", id);
    return revision;
  }

  async getDocument(key: string) {
    const [document] = await this.db.select().from(cmsContentDocument).where(eq(cmsContentDocument.documentKey, documentKey(key))).limit(1);
    if (!document) throw new NotFoundError("CMS content document", key);
    return document;
  }

  async listDocuments(limit = 50) { return this.db.select().from(cmsContentDocument).orderBy(desc(cmsContentDocument.updatedAt)).limit(Math.min(Math.max(limit, 1), 100)); }
  async listRevisions(documentId: string) { return this.db.select().from(cmsContentRevision).where(eq(cmsContentRevision.documentId, documentId)).orderBy(desc(cmsContentRevision.version)); }
}
