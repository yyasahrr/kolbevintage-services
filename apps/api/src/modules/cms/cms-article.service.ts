import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cmsArticle, cmsArticleRevision, cmsArticleRevisionTaxonomy, cmsArticleTaxonomy, cmsMediaAsset, cmsMediaUsage, type KolbeDatabase } from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";
import { collectMediaReferences, makeCmsId, normalizeSlug, validateRichBody, validateRevisionStatusTransition, validateSeo } from "./cms-validation";

function articleKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}._:-]{0,179}$/u.test(value.normalize("NFKC").trim())) throw new ValidationError([{ field: "articleKey", code: "ARTICLE_KEY_INVALID" }]);
  return value.normalize("NFKC").trim();
}

function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError([{ field, code: "TEXT_REQUIRED" }]);
    return null;
  }
  if (typeof value !== "string" || value.length > max) throw new ValidationError([{ field, code: "TEXT_INVALID" }]);
  return value.normalize("NFKC").trim();
}

@Injectable()
export class CmsArticleService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, @Inject(AuditService) private readonly audit: AuditService) {}

  async createTaxonomy(input: { taxonomyKey: string; slug: string; label: string; kind?: "CATEGORY" | "TAG"; parentId?: string | null; createdBy?: string | null }) {
    const key = articleKey(input.taxonomyKey);
    const slug = normalizeSlug(input.slug, "taxonomy.slug");
    const label = text(input.label, "taxonomy.label", 200, true) as string;
    const kind = input.kind ?? "CATEGORY";
    if (kind !== "CATEGORY" && kind !== "TAG") throw new ValidationError([{ field: "kind", code: "TAXONOMY_KIND_INVALID" }]);
    if (input.parentId) {
      const [parent] = await this.db.select({ id: cmsArticleTaxonomy.id, kind: cmsArticleTaxonomy.kind }).from(cmsArticleTaxonomy).where(and(eq(cmsArticleTaxonomy.id, input.parentId), eq(cmsArticleTaxonomy.status, "ACTIVE"))).limit(1);
      if (!parent || parent.kind !== kind) throw new ValidationError([{ field: "parentId", code: "TAXONOMY_PARENT_INVALID" }]);
    }
    try {
      const [term] = await this.db.insert(cmsArticleTaxonomy).values({ id: makeCmsId("taxonomy"), taxonomyKey: key, slug, label, kind, parentId: input.parentId ?? null, status: "ACTIVE", createdBy: input.createdBy ?? null }).returning();
      await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.article.taxonomy_created", entityType: "cms_article_taxonomy", entityId: term?.id ?? null, after: { taxonomyKey: key, slug, kind } });
      return term;
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") throw new ConflictError("CMS_TAXONOMY_CONFLICT", "Taxonomy key or slug already exists");
      throw error;
    }
  }

  async listTaxonomy(kind?: string) {
    return this.db.select().from(cmsArticleTaxonomy).where(kind ? eq(cmsArticleTaxonomy.kind, kind) : undefined).orderBy(cmsArticleTaxonomy.kind, cmsArticleTaxonomy.slug);
  }

  async createArticle(input: { articleKey: string; revision: ArticleRevisionInput; createdBy?: string | null }) {
    const key = articleKey(input.articleKey);
    const id = makeCmsId("article");
    try {
      return await this.db.transaction(async (tx) => {
        const [article] = await tx.insert(cmsArticle).values({ id, articleKey: key, status: "ACTIVE", createdBy: input.createdBy ?? null }).returning();
        if (!article) throw new ConflictError("CMS_ARTICLE_CREATE_FAILED");
        const revision = await this.insertRevision(tx, { articleId: id, input: input.revision, createdBy: input.createdBy ?? null });
        await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.article.created", entityType: "cms_article", entityId: id, after: { articleKey: key, revisionId: revision.id } }, tx);
        return { article, revision };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") throw new ConflictError("CMS_ARTICLE_KEY_CONFLICT", "Article key already exists");
      throw error;
    }
  }

  async rollback(articleId: string, sourceRevisionId: string, actorId: string | null) {
    const [source] = await this.db.select().from(cmsArticleRevision).where(and(eq(cmsArticleRevision.id, sourceRevisionId), eq(cmsArticleRevision.articleId, articleId))).limit(1);
    if (!source) throw new NotFoundError("CMS source article revision", sourceRevisionId);
    const terms = await this.db.select({ taxonomyId: cmsArticleRevisionTaxonomy.taxonomyId }).from(cmsArticleRevisionTaxonomy).where(eq(cmsArticleRevisionTaxonomy.articleRevisionId, sourceRevisionId));
    return this.createRevision({ articleId, createdBy: actorId, revision: { slug: source.slug, title: source.title, excerpt: source.excerpt, category: source.category, coverMediaId: source.coverMediaId, structuredBody: source.structuredBody, authorDisplayName: source.authorDisplayName, authorId: source.authorId, readTimeMinutes: source.readTimeMinutes, isPinned: source.isPinned, isFeatured: source.isFeatured, seoMetadata: source.seoMetadata, sourceRevisionId, taxonomyTermIds: terms.map((term) => term.taxonomyId) } });
  }

  async createRevision(input: { articleId: string; revision: ArticleRevisionInput; createdBy?: string | null }) {
    const [article] = await this.db.select().from(cmsArticle).where(eq(cmsArticle.id, input.articleId)).limit(1);
    if (!article) throw new NotFoundError("CMS article", input.articleId);
    if (article.status === "ARCHIVED") throw new ConflictError("CMS_ARTICLE_ARCHIVED");
    return this.db.transaction(async (tx) => {
      const revision = await this.insertRevision(tx, { articleId: input.articleId, input: input.revision, createdBy: input.createdBy ?? null, sourceRevisionId: input.revision.sourceRevisionId });
      await this.audit.record({ actorId: input.createdBy ?? null, actorRole: "admin", action: "cms.article.revision_created", entityType: "cms_article_revision", entityId: revision.id, after: { articleId: input.articleId, version: revision.version, slug: revision.slug } }, tx);
      return revision;
    });
  }

  async insertRevision(tx: any, args: { articleId: string; input: ArticleRevisionInput; createdBy: string | null; sourceRevisionId?: string }) {
    const input = args.input;
    const slug = normalizeSlug(input.slug);
    const title = text(input.title, "title", 300, true) as string;
    const excerpt = text(input.excerpt, "excerpt", 800) ?? "";
    const category = text(input.category, "category", 120);
    const structuredBody = validateRichBody(input.structuredBody);
    const seoMetadata = validateSeo(input.seoMetadata ?? {});
    const readTimeMinutes = input.readTimeMinutes === undefined || input.readTimeMinutes === null ? null : Number(input.readTimeMinutes);
    if (readTimeMinutes !== null && (!Number.isInteger(readTimeMinutes) || readTimeMinutes < 1 || readTimeMinutes > 999)) throw new ValidationError([{ field: "readTimeMinutes", code: "READ_TIME_INVALID" }]);
    if (input.authorId !== undefined && input.authorId !== null && typeof input.authorId !== "string") throw new ValidationError([{ field: "authorId", code: "AUTHOR_ID_INVALID" }]);
    if (input.isPinned !== undefined && typeof input.isPinned !== "boolean") throw new ValidationError([{ field: "isPinned", code: "BOOLEAN_REQUIRED" }]);
    if (input.isFeatured !== undefined && typeof input.isFeatured !== "boolean") throw new ValidationError([{ field: "isFeatured", code: "BOOLEAN_REQUIRED" }]);
    if (input.taxonomyTermIds !== undefined && (!Array.isArray(input.taxonomyTermIds) || input.taxonomyTermIds.some((id) => typeof id !== "string"))) throw new ValidationError([{ field: "taxonomyTermIds", code: "ARRAY_OF_IDS_REQUIRED" }]);
    if (input.coverMediaId) {
      const [cover] = await tx.select({ id: cmsMediaAsset.id }).from(cmsMediaAsset).where(and(eq(cmsMediaAsset.id, input.coverMediaId), sql`${cmsMediaAsset.archivedAt} IS NULL`)).limit(1);
      if (!cover) throw new ValidationError([{ field: "coverMediaId", code: "MEDIA_NOT_FOUND" }]);
    }
    if (args.sourceRevisionId) {
      const [source] = await tx.select({ id: cmsArticleRevision.id, articleId: cmsArticleRevision.articleId }).from(cmsArticleRevision).where(eq(cmsArticleRevision.id, args.sourceRevisionId)).limit(1);
      if (!source || source.articleId !== args.articleId) throw new ValidationError([{ field: "sourceRevisionId", code: "SOURCE_REVISION_NOT_ON_ARTICLE" }]);
    }
    const [last] = await tx.select({ version: cmsArticleRevision.version }).from(cmsArticleRevision).where(eq(cmsArticleRevision.articleId, args.articleId)).orderBy(desc(cmsArticleRevision.version)).limit(1);
    const [revision] = await tx.insert(cmsArticleRevision).values({
      id: makeCmsId("article_rev"), articleId: args.articleId, version: (last?.version ?? 0) + 1, slug, title, excerpt, category,
      coverMediaId: input.coverMediaId ?? null, structuredBody, authorDisplayName: text(input.authorDisplayName, "authorDisplayName", 160), authorId: input.authorId ?? null,
      readTimeMinutes, isPinned: input.isPinned ?? false, isFeatured: input.isFeatured ?? false, seoMetadata, status: "DRAFT", createdBy: args.createdBy, sourceRevisionId: args.sourceRevisionId ?? null,
    }).returning();
    if (!revision) throw new ConflictError("CMS_ARTICLE_REVISION_CREATE_FAILED");
    const taxonomyIds = [...new Set(input.taxonomyTermIds ?? [])];
    if (taxonomyIds.length) {
      const terms = await tx.select({ id: cmsArticleTaxonomy.id }).from(cmsArticleTaxonomy).where(and(inArray(cmsArticleTaxonomy.id, taxonomyIds), eq(cmsArticleTaxonomy.status, "ACTIVE")));
      if (terms.length !== taxonomyIds.length) throw new ValidationError([{ field: "taxonomyTermIds", code: "TAXONOMY_TERM_NOT_FOUND" }]);
      await tx.insert(cmsArticleRevisionTaxonomy).values(taxonomyIds.map((taxonomyId) => ({ id: makeCmsId("article_taxonomy"), articleRevisionId: revision.id, taxonomyId }))).onConflictDoNothing();
    }
    const refs = collectMediaReferences({ structuredBody, seoMetadata, coverMediaId: input.coverMediaId });
    if (refs.length) {
      const ids = [...new Set(refs.map((ref) => ref.id))];
      const assets = await tx.select({ id: cmsMediaAsset.id, archivedAt: cmsMediaAsset.archivedAt }).from(cmsMediaAsset).where(inArray(cmsMediaAsset.id, ids));
      if (assets.length !== ids.length) throw new ValidationError([{ field: "media", code: "MEDIA_NOT_FOUND" }]);
      if (assets.some((asset: { archivedAt: Date | null }) => asset.archivedAt)) throw new ValidationError([{ field: "media", code: "MEDIA_ARCHIVED" }]);
      await tx.insert(cmsMediaUsage).values(refs.map((ref) => ({ id: makeCmsId("media_use"), mediaAssetId: ref.id, revisionType: "ARTICLE_REVISION", revisionId: revision.id, fieldPath: ref.path }))).onConflictDoNothing();
    }
    return revision;
  }

  async transitionRevision(id: string, status: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsArticleRevision).where(eq(cmsArticleRevision.id, id)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS article revision", id);
      validateRevisionStatusTransition(revision.status, status);
      const [updated] = await tx.update(cmsArticleRevision).set({ status: status as typeof revision.status, archivedAt: status === "ARCHIVED" ? new Date() : revision.archivedAt }).where(eq(cmsArticleRevision.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: `cms.article.revision.${status.toLowerCase()}`, entityType: "cms_article_revision", entityId: id, before: { status: revision.status }, after: { status } }, tx);
      return updated;
    });
  }

  async archiveArticle(id: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [article] = await tx.select().from(cmsArticle).where(eq(cmsArticle.id, id)).for("update").limit(1);
      if (!article) throw new NotFoundError("CMS article", id);
      if (article.status === "ARCHIVED") return article;
      const [updated] = await tx.update(cmsArticle).set({ status: "ARCHIVED" }).where(eq(cmsArticle.id, id)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.article.archived", entityType: "cms_article", entityId: id, before: { status: article.status }, after: { status: "ARCHIVED" } }, tx);
      return updated;
    });
  }

  async getPublishedBySlug(input: string) {
    const slug = normalizeSlug(input);
    const [row] = await this.db.select({ revision: cmsArticleRevision }).from(cmsArticleRevision).innerJoin(cmsArticle, eq(cmsArticle.id, cmsArticleRevision.articleId)).where(and(eq(cmsArticleRevision.slug, slug), eq(cmsArticleRevision.status, "PUBLISHED"), eq(cmsArticle.status, "ACTIVE"), eq(cmsArticle.currentPublishedRevisionId, cmsArticleRevision.id))).limit(1);
    return row?.revision ?? null;
  }

  async getArticle(key: string) {
    const [article] = await this.db.select().from(cmsArticle).where(eq(cmsArticle.articleKey, articleKey(key))).limit(1);
    if (!article) throw new NotFoundError("CMS article", key);
    return article;
  }

  async listArticles(limit = 50) { return this.db.select().from(cmsArticle).orderBy(desc(cmsArticle.updatedAt)).limit(Math.min(Math.max(limit, 1), 100)); }
}

export type ArticleRevisionInput = {
  slug: string;
  title: string;
  excerpt?: string;
  category?: string | null;
  coverMediaId?: string | null;
  structuredBody: unknown;
  authorDisplayName?: string | null;
  authorId?: string | null;
  readTimeMinutes?: number | null;
  isPinned?: boolean;
  isFeatured?: boolean;
  seoMetadata?: unknown;
  sourceRevisionId?: string;
  taxonomyTermIds?: string[];
};
