import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  cmsMediaAsset,
  cmsMediaUsage,
  cmsPage,
  cmsPageRevision,
  type KolbeDatabase,
} from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import {
  assertUniqueRouteSafety,
  collectMediaReferences,
  makeCmsId,
  normalizeRoutePath,
  validateBlocks,
  validatePageType,
  validateRevisionStatusTransition,
  validateSeo,
  type CmsBlock,
  type CmsPageType,
  type CmsSeoMetadata,
} from "./cms-validation";

export type CreatePageInput = {
  stableKey: string;
  pageType: CmsPageType | string;
  routePath: string;
  title?: string;
  blocks?: unknown;
  seoMetadata?: unknown;
  mediaIds?: string[];
  createdBy?: string | null;
};

export type CreateRevisionInput = {
  pageId: string;
  title: string;
  blocks: unknown;
  seoMetadata?: unknown;
  createdBy?: string | null;
  sourceRevisionId?: string;
  mediaIds?: string[];
  contentSchemaVersion?: number;
};

function safeStableKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError([{ field: "stableKey", code: "KEY_REQUIRED" }]);
  const key = value.normalize("NFKC").trim();
  if (key.length > 180 || key.includes("/") || key.includes("\\") || key.includes("..") || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._-]*$/u.test(key)) {
    throw new ValidationError([{ field: "stableKey", code: "KEY_INVALID" }]);
  }
  return key;
}

function safeTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new ValidationError([{ field: "title", code: "TITLE_INVALID" }]);
  return value.normalize("NFKC").trim();
}

@Injectable()
export class CmsPageService {
  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createPage(input: CreatePageInput) {
    const stableKey = safeStableKey(input.stableKey);
    const pageType = validatePageType(input.pageType);
    const routePath = assertUniqueRouteSafety(input.routePath);
    const title = safeTitle(input.title ?? stableKey);
    const blocks = validateBlocks(input.blocks ?? [], "blocks");
    const seoMetadata = validateSeo(input.seoMetadata ?? {}, "seoMetadata");
    const pageId = makeCmsId("page");

    try {
      return await this.db.transaction(async (tx) => {
        const [page] = await tx.insert(cmsPage).values({
          id: pageId,
          stableKey,
          pageType,
          routePath,
          status: "ACTIVE",
          createdBy: input.createdBy ?? null,
        }).returning();
        if (!page) throw new ConflictError("CMS_PAGE_CREATE_FAILED");
        const revision = await this.insertRevision(tx, {
          pageId,
          title,
          blocks,
          seoMetadata,
          createdBy: input.createdBy ?? null,
          contentSchemaVersion: 1,
          mediaRefs: collectMediaReferences({ blocks, seoMetadata }),
        });
        await this.audit.record({
          actorId: input.createdBy ?? null,
          actorRole: "admin",
          action: "cms.page.created",
          entityType: "cms_page",
          entityId: pageId,
          after: { stableKey, pageType, routePath, revisionId: revision.id },
        }, tx);
        return { page, revision };
      });
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ValidationError) throw error;
      if ((error as { code?: string })?.code === "23505") throw new ConflictError("CMS_PAGE_IDENTITY_CONFLICT", "Page key or route already exists");
      throw error;
    }
  }

  async archivePage(id: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [page] = await tx.select().from(cmsPage).where(eq(cmsPage.id, id)).for("update").limit(1);
      if (!page) throw new NotFoundError("CMS page", id);
      if (page.status === "ARCHIVED") return page;
      const [updated] = await tx.update(cmsPage).set({ status: "ARCHIVED" }).where(eq(cmsPage.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.page.archived", entityType: "cms_page", entityId: id, before: { status: page.status }, after: { status: "ARCHIVED" } }, tx);
      return updated;
    });
  }

  async getPageById(id: string) {
    const [page] = await this.db.select().from(cmsPage).where(eq(cmsPage.id, id)).limit(1);
    if (!page) throw new NotFoundError("CMS page", id);
    return page;
  }

  async getPageByKey(stableKey: string) {
    const [page] = await this.db.select().from(cmsPage).where(eq(cmsPage.stableKey, safeStableKey(stableKey))).limit(1);
    if (!page) throw new NotFoundError("CMS page", stableKey);
    return page;
  }

  async listPages(options: { q?: string; pageType?: string; status?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(Number(options.limit ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(options.offset ?? 0) || 0, 0);
    const conditions = [];
    if (options.q?.trim()) {
      const query = options.q.trim().slice(0, 100);
      conditions.push(sql`(${cmsPage.stableKey} ILIKE ${`%${query}%`} OR ${cmsPage.routePath} ILIKE ${`%${query}%`})`);
    }
    if (options.pageType) conditions.push(eq(cmsPage.pageType, options.pageType));
    if (options.status) conditions.push(eq(cmsPage.status, options.status));
    return this.db.select().from(cmsPage).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(cmsPage.updatedAt), cmsPage.id).limit(limit).offset(offset);
  }

  async createRevision(input: CreateRevisionInput) {
    const title = safeTitle(input.title);
    const blocks = validateBlocks(input.blocks, "blocks");
    const seoMetadata = validateSeo(input.seoMetadata ?? {}, "seoMetadata");
    const contentSchemaVersion = input.contentSchemaVersion ?? 1;
    if (!Number.isInteger(contentSchemaVersion) || contentSchemaVersion < 1 || contentSchemaVersion > 100) throw new ValidationError([{ field: "contentSchemaVersion", code: "SCHEMA_VERSION_INVALID" }]);
    const page = await this.getPageById(input.pageId);
    if (page.status === "ARCHIVED") throw new ConflictError("CMS_PAGE_ARCHIVED", "Cannot edit an archived page");
    if (input.sourceRevisionId) {
      const [source] = await this.db.select({ id: cmsPageRevision.id, pageId: cmsPageRevision.pageId }).from(cmsPageRevision).where(eq(cmsPageRevision.id, input.sourceRevisionId)).limit(1);
      if (!source || source.pageId !== input.pageId) throw new ValidationError([{ field: "sourceRevisionId", code: "SOURCE_REVISION_NOT_ON_PAGE" }]);
    }
    if (input.mediaIds !== undefined && (!Array.isArray(input.mediaIds) || input.mediaIds.some((id) => typeof id !== "string"))) throw new ValidationError([{ field: "mediaIds", code: "ARRAY_OF_IDS_REQUIRED" }]);
    const mediaRefs = [...collectMediaReferences({ blocks, seoMetadata }), ...(input.mediaIds ?? []).map((id) => ({ id, path: "mediaIds" }))];
    return this.db.transaction(async (tx) => {
      const revision = await this.insertRevision(tx, {
        pageId: input.pageId,
        title,
        blocks,
        seoMetadata,
        createdBy: input.createdBy ?? null,
        sourceRevisionId: input.sourceRevisionId,
        contentSchemaVersion,
        mediaRefs,
      });
      await this.audit.record({
        actorId: input.createdBy ?? null,
        actorRole: "admin",
        action: input.sourceRevisionId ? "cms.page.rollback_revision_created" : "cms.page.revision_created",
        entityType: "cms_page_revision",
        entityId: revision.id,
        after: { pageId: input.pageId, version: revision.version, sourceRevisionId: input.sourceRevisionId ?? null },
      }, tx);
      return revision;
    });
  }

  async rollback(pageId: string, sourceRevisionId: string, actorId: string | null) {
    const [source] = await this.db.select().from(cmsPageRevision).where(and(eq(cmsPageRevision.id, sourceRevisionId), eq(cmsPageRevision.pageId, pageId))).limit(1);
    if (!source) throw new NotFoundError("CMS source revision", sourceRevisionId);
    return this.createRevision({
      pageId,
      title: source.title,
      blocks: source.blocks,
      seoMetadata: source.seoMetadata,
      sourceRevisionId,
      createdBy: actorId,
      contentSchemaVersion: source.contentSchemaVersion,
    });
  }

  async getRevisionById(id: string) {
    const [revision] = await this.db.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, id)).limit(1);
    if (!revision) throw new NotFoundError("CMS page revision", id);
    return revision;
  }

  async listRevisions(pageId: string) {
    await this.getPageById(pageId);
    return this.db.select().from(cmsPageRevision).where(eq(cmsPageRevision.pageId, pageId)).orderBy(desc(cmsPageRevision.version));
  }

  async transitionRevision(id: string, status: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, id)).for("update");
      if (!revision) throw new NotFoundError("CMS page revision", id);
      validateRevisionStatusTransition(revision.status, status);
      const [updated] = await tx.update(cmsPageRevision).set({ status: status as typeof revision.status, archivedAt: status === "ARCHIVED" ? new Date() : revision.archivedAt }).where(eq(cmsPageRevision.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: `cms.page.revision.${status.toLowerCase()}`, entityType: "cms_page_revision", entityId: id, before: { status: revision.status }, after: { status } }, tx);
      return updated;
    });
  }

  /** Internal insertion shared by page creation and revision creation. Caller owns the transaction. */
  async insertRevision(
    tx: KolbeDatabase,
    input: { pageId: string; title: string; blocks: CmsBlock[]; seoMetadata: CmsSeoMetadata; createdBy: string | null; sourceRevisionId?: string; contentSchemaVersion: number; mediaRefs?: Array<{ id: string; path: string }> },
  ) {
    const [last] = await tx.select({ version: cmsPageRevision.version }).from(cmsPageRevision).where(eq(cmsPageRevision.pageId, input.pageId)).orderBy(desc(cmsPageRevision.version)).limit(1);
    const version = (last?.version ?? 0) + 1;
    const id = makeCmsId("page_rev");
    const [revision] = await tx.insert(cmsPageRevision).values({
      id,
      pageId: input.pageId,
      version,
      title: input.title,
      blocks: input.blocks,
      seoMetadata: input.seoMetadata,
      contentSchemaVersion: input.contentSchemaVersion,
      status: "DRAFT",
      createdBy: input.createdBy,
      sourceRevisionId: input.sourceRevisionId ?? null,
    }).returning();
    if (!revision) throw new ConflictError("CMS_REVISION_CREATE_FAILED");
    if (input.mediaRefs?.length) await this.attachMediaUsage(tx, "PAGE_REVISION", id, input.mediaRefs);
    return revision;
  }

  async attachMediaUsage(tx: KolbeDatabase, revisionType: string, revisionId: string, refs: Array<{ id: string; path: string }>) {
    const ids = [...new Set(refs.map((ref) => ref.id))];
    if (!ids.length) return;
    const assets = await tx.select({ id: cmsMediaAsset.id, archivedAt: cmsMediaAsset.archivedAt }).from(cmsMediaAsset).where(inArray(cmsMediaAsset.id, ids));
    if (assets.length !== ids.length) {
      const existing = new Set(assets.map((asset) => asset.id));
      throw new ValidationError(ids.filter((id) => !existing.has(id)).map((id) => ({ field: "mediaIds", code: `MEDIA_NOT_FOUND:${id}` })));
    }
    const archived = assets.filter((asset) => asset.archivedAt).map((asset) => asset.id);
    if (archived.length) throw new ValidationError(archived.map((id) => ({ field: "mediaIds", code: `MEDIA_ARCHIVED:${id}` })));
    const rows = refs.map((ref) => ({ id: makeCmsId("media_use"), mediaAssetId: ref.id, revisionType, revisionId, fieldPath: ref.path }));
    await tx.insert(cmsMediaUsage).values(rows).onConflictDoNothing();
  }
}

/** Named responsibility used by module consumers that only need revision APIs. */
@Injectable()
export class CmsRevisionService {
  constructor(@Inject(CmsPageService) private readonly pages: CmsPageService) {}
  create(input: CreateRevisionInput) { return this.pages.createRevision(input); }
  list(pageId: string) { return this.pages.listRevisions(pageId); }
  get(id: string) { return this.pages.getRevisionById(id); }
  rollback(pageId: string, revisionId: string, actorId: string | null) { return this.pages.rollback(pageId, revisionId, actorId); }
}
