import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import {
  cmsArticle,
  cmsArticleRevision,
  cmsContentDocument,
  cmsContentRevision,
  cmsNavigation,
  cmsNavigationRevision,
  cmsPage,
  cmsPageRevision,
  cmsPublicationSchedule,
  type KolbeDatabase,
} from "@kolbe/database";
import { ConflictError, NotFoundError, ValidationError } from "@kolbe/shared";
import { KOLBE_DB } from "../../database/database.module";
import { CONFIG_TOKEN, type AppConfig } from "../../config/configuration";
import { AuditService } from "../audit/audit.service";
import { JobLockService } from "../recovery/job-lock.service";
import { makeCmsId, validateRevisionStatusTransition, validateSchedule } from "./cms-validation";

export type PublicationTarget = "PAGE_REVISION" | "CONTENT_REVISION" | "NAVIGATION_REVISION" | "ARTICLE_REVISION";

@Injectable()
export class CmsPublicationService {
  private readonly logger = new Logger(CmsPublicationService.name);

  constructor(
    @Inject(KOLBE_DB) private readonly db: KolbeDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobLockService) private readonly jobLock: JobLockService,
  ) {}

  async publishPage(revisionId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, revisionId)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS page revision", revisionId);
      const [page] = await tx.select().from(cmsPage).where(eq(cmsPage.id, revision.pageId)).for("update").limit(1);
      if (!page) throw new NotFoundError("CMS page", revision.pageId);
      if (page.status === "ARCHIVED") throw new ConflictError("CMS_PAGE_ARCHIVED", "Cannot publish an archived page");
      if (revision.status === "PUBLISHED" && page.currentPublishedRevisionId === revision.id) return revision;
      validateRevisionStatusTransition(revision.status, "PUBLISHED");
      const oldId = page.currentPublishedRevisionId;
      if (oldId && oldId !== revision.id) {
        await tx.update(cmsPageRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsPageRevision.id, oldId), eq(cmsPageRevision.status, "PUBLISHED")));
      }
      const [updated] = await tx.update(cmsPageRevision).set({ status: "PUBLISHED", publishedAt: new Date(), publishedBy: actorId, supersededAt: null }).where(eq(cmsPageRevision.id, revision.id)).returning();
      await tx.update(cmsPage).set({ currentPublishedRevisionId: revision.id }).where(eq(cmsPage.id, page.id));
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.page.published", entityType: "cms_page_revision", entityId: revision.id, before: { currentPublishedRevisionId: oldId }, after: { status: "PUBLISHED", pageId: page.id } }, tx);
      return updated;
    });
  }

  async publishContent(revisionId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => { await this.publishContentInTransaction(tx, revisionId, actorId); const [revision] = await tx.select().from(cmsContentRevision).where(eq(cmsContentRevision.id, revisionId)).limit(1); return revision; });
  }

  async publishNavigation(revisionId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => { await this.publishNavigationInTransaction(tx, revisionId, actorId); const [revision] = await tx.select().from(cmsNavigationRevision).where(eq(cmsNavigationRevision.id, revisionId)).limit(1); return revision; });
  }

  async publishArticle(revisionId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => { await this.publishArticleInTransaction(tx, revisionId, actorId); const [revision] = await tx.select().from(cmsArticleRevision).where(eq(cmsArticleRevision.id, revisionId)).limit(1); return revision; });
  }

  async unpublishPage(pageId: string, actorId: string | null) {
    return this.db.transaction(async (tx) => {
      const [page] = await tx.select().from(cmsPage).where(eq(cmsPage.id, pageId)).for("update").limit(1);
      if (!page) throw new NotFoundError("CMS page", pageId);
      if (!page.currentPublishedRevisionId) return page;
      const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, page.currentPublishedRevisionId)).for("update").limit(1);
      if (revision?.status === "PUBLISHED") await tx.update(cmsPageRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(eq(cmsPageRevision.id, revision.id));
      const [updated] = await tx.update(cmsPage).set({ currentPublishedRevisionId: null }).where(eq(cmsPage.id, pageId)).returning();
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.page.unpublished", entityType: "cms_page", entityId: pageId, before: { currentPublishedRevisionId: page.currentPublishedRevisionId }, after: { currentPublishedRevisionId: null } }, tx);
      return updated;
    });
  }

  async schedulePage(revisionId: string, publishAtInput: unknown, unpublishAtInput: unknown, idempotencyKey: string, actorId: string | null) {
    const { publishAt, unpublishAt } = validateSchedule(publishAtInput, unpublishAtInput);
    const key = this.safeIdempotencyKey(idempotencyKey);
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, revisionId)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS page revision", revisionId);
      validateRevisionStatusTransition(revision.status, "SCHEDULED");
      const [existing] = await tx.select().from(cmsPublicationSchedule).where(eq(cmsPublicationSchedule.idempotencyKey, key)).limit(1);
      if (existing) return existing;
      const [schedule] = await tx.insert(cmsPublicationSchedule).values({ id: makeCmsId("schedule"), targetType: "PAGE_REVISION", pageRevisionId: revisionId, publishAt, unpublishAt, timezone: "UTC", status: "SCHEDULED", idempotencyKey: key, createdBy: actorId }).returning();
      await tx.update(cmsPageRevision).set({ status: "SCHEDULED", publishAt, unpublishAt }).where(eq(cmsPageRevision.id, revisionId));
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.page.publication_scheduled", entityType: "cms_publication_schedule", entityId: schedule?.id ?? null, after: { revisionId, publishAt, unpublishAt } }, tx);
      return schedule;
    });
  }

  async scheduleRevision(targetType: PublicationTarget | string, revisionId: string, publishAtInput: unknown, unpublishAtInput: unknown, idempotencyKey: string, actorId: string | null) {
    const target = targetType as PublicationTarget;
    const { publishAt, unpublishAt } = validateSchedule(publishAtInput, unpublishAtInput);
    const key = this.safeIdempotencyKey(idempotencyKey);
    const targetTable = target === "PAGE_REVISION" ? cmsPageRevision : target === "CONTENT_REVISION" ? cmsContentRevision : target === "NAVIGATION_REVISION" ? cmsNavigationRevision : target === "ARTICLE_REVISION" ? cmsArticleRevision : null;
    const targetColumn = target === "PAGE_REVISION" ? "pageRevisionId" : target === "CONTENT_REVISION" ? "contentRevisionId" : target === "NAVIGATION_REVISION" ? "navigationRevisionId" : target === "ARTICLE_REVISION" ? "articleRevisionId" : null;
    if (!targetTable || !targetColumn) throw new ValidationError([{ field: "targetType", code: "SCHEDULE_TARGET_INVALID" }]);
    return this.db.transaction(async (tx) => {
      const [revision] = await tx.select().from(targetTable as any).where(eq((targetTable as any).id, revisionId)).for("update").limit(1);
      if (!revision) throw new NotFoundError("CMS revision", revisionId);
      validateRevisionStatusTransition(revision.status, "SCHEDULED");
      const [existing] = await tx.select().from(cmsPublicationSchedule).where(eq(cmsPublicationSchedule.idempotencyKey, key)).limit(1);
      if (existing) return existing;
      const [schedule] = await tx.insert(cmsPublicationSchedule).values({ id: makeCmsId("schedule"), targetType: target, [targetColumn]: revisionId, publishAt, unpublishAt, timezone: "UTC", status: "SCHEDULED", idempotencyKey: key, createdBy: actorId } as any).returning();
      const lifecycle: Record<string, unknown> = { status: "SCHEDULED" };
      if (target !== "NAVIGATION_REVISION") { lifecycle.publishAt = publishAt; lifecycle.unpublishAt = unpublishAt; }
      await tx.update(targetTable as any).set(lifecycle as any).where(eq((targetTable as any).id, revisionId));
      await this.audit.record({ actorId, actorRole: "admin", action: "cms.revision.publication_scheduled", entityType: "cms_publication_schedule", entityId: schedule?.id ?? null, after: { targetType: target, revisionId, publishAt, unpublishAt } }, tx);
      return schedule;
    });
  }

  async processDueSchedules(now = new Date(), limit = 25) {
    return this.jobLock.withSessionLock("job:cms:publication", async () => {
      const max = Math.min(Math.max(limit, 1), 100);
      const schedules = await this.db.select().from(cmsPublicationSchedule).where(and(eq(cmsPublicationSchedule.status, "SCHEDULED"), lte(cmsPublicationSchedule.publishAt, now))).orderBy(asc(cmsPublicationSchedule.publishAt), cmsPublicationSchedule.id).limit(max);
      const results: Array<{ id: string; executed: boolean; unpublished?: boolean; error?: string }> = [];
      for (const schedule of schedules) {
        try {
          const executed = await this.db.transaction(async (tx) => {
            const [claimed] = await tx.update(cmsPublicationSchedule).set({ status: "PROCESSING", claimedAt: new Date(), attemptCount: sql`${cmsPublicationSchedule.attemptCount} + 1` }).where(and(eq(cmsPublicationSchedule.id, schedule.id), eq(cmsPublicationSchedule.status, "SCHEDULED"))).returning();
            if (!claimed) return false;
            if (claimed.targetType === "PAGE_REVISION" && claimed.pageRevisionId) await this.publishPageInTransaction(tx, claimed.pageRevisionId, claimed.createdBy);
            else if (claimed.targetType === "CONTENT_REVISION" && claimed.contentRevisionId) await this.publishContentInTransaction(tx, claimed.contentRevisionId, claimed.createdBy);
            else if (claimed.targetType === "NAVIGATION_REVISION" && claimed.navigationRevisionId) await this.publishNavigationInTransaction(tx, claimed.navigationRevisionId, claimed.createdBy);
            else if (claimed.targetType === "ARTICLE_REVISION" && claimed.articleRevisionId) await this.publishArticleInTransaction(tx, claimed.articleRevisionId, claimed.createdBy);
            else throw new ValidationError([{ field: "schedule", code: "TARGET_MISSING" }]);
            await tx.update(cmsPublicationSchedule).set({ status: "EXECUTED", executedAt: new Date(), lastError: null }).where(eq(cmsPublicationSchedule.id, claimed.id));
            return true;
          });
          results.push({ id: schedule.id, executed });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown publication error";
          await this.db.update(cmsPublicationSchedule).set({ status: "FAILED", lastError: message }).where(eq(cmsPublicationSchedule.id, schedule.id));
          this.logger.error(`CMS publication schedule ${schedule.id} failed: ${message}`);
          results.push({ id: schedule.id, executed: false, error: message });
        }
      }
      const unpublishSchedules = await this.db.select().from(cmsPublicationSchedule).where(and(eq(cmsPublicationSchedule.status, "EXECUTED"), lte(cmsPublicationSchedule.unpublishAt, now))).orderBy(asc(cmsPublicationSchedule.unpublishAt), cmsPublicationSchedule.id).limit(max);
      for (const schedule of unpublishSchedules) {
        try {
          const unpublished = await this.db.transaction(async (tx) => {
            const [claimed] = await tx.update(cmsPublicationSchedule).set({ status: "PROCESSING", claimedAt: new Date(), attemptCount: sql`${cmsPublicationSchedule.attemptCount} + 1` }).where(and(eq(cmsPublicationSchedule.id, schedule.id), eq(cmsPublicationSchedule.status, "EXECUTED"))).returning();
            if (!claimed) return false;
            if (claimed.targetType === "PAGE_REVISION" && claimed.pageRevisionId) await this.unpublishPageInTransaction(tx, claimed.pageRevisionId, claimed.createdBy);
            else if (claimed.targetType === "CONTENT_REVISION" && claimed.contentRevisionId) await this.unpublishContentInTransaction(tx, claimed.contentRevisionId, claimed.createdBy);
            else if (claimed.targetType === "NAVIGATION_REVISION" && claimed.navigationRevisionId) await this.unpublishNavigationInTransaction(tx, claimed.navigationRevisionId, claimed.createdBy);
            else if (claimed.targetType === "ARTICLE_REVISION" && claimed.articleRevisionId) await this.unpublishArticleInTransaction(tx, claimed.articleRevisionId, claimed.createdBy);
            else throw new ValidationError([{ field: "schedule", code: "TARGET_MISSING" }]);
            await tx.update(cmsPublicationSchedule).set({ status: "CANCELLED", lastError: null }).where(eq(cmsPublicationSchedule.id, claimed.id));
            return true;
          });
          results.push({ id: schedule.id, executed: false, unpublished });
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown unpublish error";
          await this.db.update(cmsPublicationSchedule).set({ status: "FAILED", lastError: message }).where(eq(cmsPublicationSchedule.id, schedule.id));
          this.logger.error(`CMS unpublication schedule ${schedule.id} failed: ${message}`);
          results.push({ id: schedule.id, executed: false, error: message });
        }
      }
      return results;
    });
  }

  async recoverStaleSchedules(ageMinutes = 15) {
    const cutoff = new Date(Date.now() - Math.max(ageMinutes, 1) * 60_000);
    return this.db.update(cmsPublicationSchedule).set({ status: "SCHEDULED", claimedAt: null, lastError: "Recovered stale processing claim" }).where(and(eq(cmsPublicationSchedule.status, "PROCESSING"), lte(cmsPublicationSchedule.claimedAt, cutoff))).returning({ id: cmsPublicationSchedule.id });
  }

  async getPublishedPage(routePath: string) {
    const [page] = await this.db.select().from(cmsPage).where(and(eq(cmsPage.routePath, routePath), eq(cmsPage.status, "ACTIVE"))).limit(1);
    if (!page?.currentPublishedRevisionId) return null;
    const [revision] = await this.db.select().from(cmsPageRevision).where(and(eq(cmsPageRevision.id, page.currentPublishedRevisionId), eq(cmsPageRevision.status, "PUBLISHED"))).limit(1);
    return revision ? { page, revision } : null;
  }

  async getPublishedDocument(documentKey: string) {
    const [document] = await this.db.select().from(cmsContentDocument).where(and(eq(cmsContentDocument.documentKey, documentKey), eq(cmsContentDocument.status, "ACTIVE"))).limit(1);
    if (!document?.currentPublishedRevisionId) return null;
    const [revision] = await this.db.select().from(cmsContentRevision).where(and(eq(cmsContentRevision.id, document.currentPublishedRevisionId), eq(cmsContentRevision.status, "PUBLISHED"))).limit(1);
    return revision ? { document, revision } : null;
  }

  private async publishContentInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsContentRevision).where(eq(cmsContentRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS content revision", revisionId);
    validateRevisionStatusTransition(revision.status, "PUBLISHED");
    const [document] = await tx.select().from(cmsContentDocument).where(eq(cmsContentDocument.id, revision.documentId)).for("update").limit(1);
    if (!document) throw new NotFoundError("CMS content document", revision.documentId);
    if (document.currentPublishedRevisionId) await tx.update(cmsContentRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsContentRevision.id, document.currentPublishedRevisionId), eq(cmsContentRevision.status, "PUBLISHED")));
    await tx.update(cmsContentRevision).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(cmsContentRevision.id, revisionId));
    await tx.update(cmsContentDocument).set({ currentPublishedRevisionId: revisionId }).where(eq(cmsContentDocument.id, document.id));
    await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.document.published", entityType: "cms_content_revision", entityId: revisionId, after: { documentId: document.id } }, tx);
  }

  private async publishNavigationInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsNavigationRevision).where(eq(cmsNavigationRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS navigation revision", revisionId);
    validateRevisionStatusTransition(revision.status, "PUBLISHED");
    const [navigation] = await tx.select().from(cmsNavigation).where(eq(cmsNavigation.id, revision.navigationId)).for("update").limit(1);
    if (!navigation) throw new NotFoundError("CMS navigation", revision.navigationId);
    if (navigation.currentPublishedRevisionId) await tx.update(cmsNavigationRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsNavigationRevision.id, navigation.currentPublishedRevisionId), eq(cmsNavigationRevision.status, "PUBLISHED")));
    await tx.update(cmsNavigationRevision).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(cmsNavigationRevision.id, revisionId));
    await tx.update(cmsNavigation).set({ currentPublishedRevisionId: revisionId }).where(eq(cmsNavigation.id, navigation.id));
    await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.navigation.published", entityType: "cms_navigation_revision", entityId: revisionId, after: { navigationId: navigation.id } }, tx);
  }

  private async publishArticleInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsArticleRevision).where(eq(cmsArticleRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS article revision", revisionId);
    validateRevisionStatusTransition(revision.status, "PUBLISHED");
    const [article] = await tx.select().from(cmsArticle).where(eq(cmsArticle.id, revision.articleId)).for("update").limit(1);
    if (!article) throw new NotFoundError("CMS article", revision.articleId);
    if (article.currentPublishedRevisionId) await tx.update(cmsArticleRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsArticleRevision.id, article.currentPublishedRevisionId), eq(cmsArticleRevision.status, "PUBLISHED")));
    await tx.update(cmsArticleRevision).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(cmsArticleRevision.id, revisionId));
    await tx.update(cmsArticle).set({ currentPublishedRevisionId: revisionId }).where(eq(cmsArticle.id, article.id));
    await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.article.published", entityType: "cms_article_revision", entityId: revisionId, after: { articleId: article.id } }, tx);
  }

  private async publishPageInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS page revision", revisionId);
    const [page] = await tx.select().from(cmsPage).where(eq(cmsPage.id, revision.pageId)).for("update").limit(1);
    if (!page) throw new NotFoundError("CMS page", revision.pageId);
    validateRevisionStatusTransition(revision.status, "PUBLISHED");
    if (page.currentPublishedRevisionId) await tx.update(cmsPageRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsPageRevision.id, page.currentPublishedRevisionId), eq(cmsPageRevision.status, "PUBLISHED")));
    await tx.update(cmsPageRevision).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(cmsPageRevision.id, revisionId));
    await tx.update(cmsPage).set({ currentPublishedRevisionId: revisionId }).where(eq(cmsPage.id, page.id));
    await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.page.published", entityType: "cms_page_revision", entityId: revisionId, after: { pageId: page.id } }, tx);
  }

  private async unpublishPageInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsPageRevision).where(eq(cmsPageRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS page revision", revisionId);
    const [page] = await tx.select().from(cmsPage).where(eq(cmsPage.id, revision.pageId)).for("update").limit(1);
    if (!page) throw new NotFoundError("CMS page", revision.pageId);
    if (page.currentPublishedRevisionId === revisionId) {
      await tx.update(cmsPageRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsPageRevision.id, revisionId), eq(cmsPageRevision.status, "PUBLISHED")));
      await tx.update(cmsPage).set({ currentPublishedRevisionId: null }).where(eq(cmsPage.id, page.id));
      await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.page.unpublished", entityType: "cms_page", entityId: page.id, after: { revisionId } }, tx);
    }
  }

  private async unpublishContentInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsContentRevision).where(eq(cmsContentRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS content revision", revisionId);
    const [document] = await tx.select().from(cmsContentDocument).where(eq(cmsContentDocument.id, revision.documentId)).for("update").limit(1);
    if (!document) throw new NotFoundError("CMS content document", revision.documentId);
    if (document.currentPublishedRevisionId === revisionId) {
      await tx.update(cmsContentRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsContentRevision.id, revisionId), eq(cmsContentRevision.status, "PUBLISHED")));
      await tx.update(cmsContentDocument).set({ currentPublishedRevisionId: null }).where(eq(cmsContentDocument.id, document.id));
      await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.document.unpublished", entityType: "cms_content_document", entityId: document.id, after: { revisionId } }, tx);
    }
  }

  private async unpublishNavigationInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsNavigationRevision).where(eq(cmsNavigationRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS navigation revision", revisionId);
    const [navigation] = await tx.select().from(cmsNavigation).where(eq(cmsNavigation.id, revision.navigationId)).for("update").limit(1);
    if (!navigation) throw new NotFoundError("CMS navigation", revision.navigationId);
    if (navigation.currentPublishedRevisionId === revisionId) {
      await tx.update(cmsNavigationRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsNavigationRevision.id, revisionId), eq(cmsNavigationRevision.status, "PUBLISHED")));
      await tx.update(cmsNavigation).set({ currentPublishedRevisionId: null }).where(eq(cmsNavigation.id, navigation.id));
      await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.navigation.unpublished", entityType: "cms_navigation", entityId: navigation.id, after: { revisionId } }, tx);
    }
  }

  private async unpublishArticleInTransaction(tx: any, revisionId: string, actorId: string | null = null) {
    const [revision] = await tx.select().from(cmsArticleRevision).where(eq(cmsArticleRevision.id, revisionId)).for("update").limit(1);
    if (!revision) throw new NotFoundError("CMS article revision", revisionId);
    const [article] = await tx.select().from(cmsArticle).where(eq(cmsArticle.id, revision.articleId)).for("update").limit(1);
    if (!article) throw new NotFoundError("CMS article", revision.articleId);
    if (article.currentPublishedRevisionId === revisionId) {
      await tx.update(cmsArticleRevision).set({ status: "SUPERSEDED", supersededAt: new Date() }).where(and(eq(cmsArticleRevision.id, revisionId), eq(cmsArticleRevision.status, "PUBLISHED")));
      await tx.update(cmsArticle).set({ currentPublishedRevisionId: null }).where(eq(cmsArticle.id, article.id));
      await this.audit.record({ actorId, actorRole: actorId ? "admin" : "system", action: "cms.article.unpublished", entityType: "cms_article", entityId: article.id, after: { revisionId } }, tx);
    }
  }

  private safeIdempotencyKey(value: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,180}$/.test(value)) throw new ValidationError([{ field: "idempotencyKey", code: "IDEMPOTENCY_KEY_INVALID" }]);
    return value;
  }
}

@Injectable()
export class CmsPublicationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly logger = new Logger(CmsPublicationScheduler.name);

  constructor(@Inject(CmsPublicationService) private readonly publication: CmsPublicationService, @Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  onApplicationBootstrap(): void {
    const enabled = process.env.ENABLE_CMS_PUBLICATION_SCHEDULER === "true" || this.config.recovery?.schedulerEnabled === true;
    if (!enabled) return;
    const intervalMs = Math.max(5_000, Number(process.env.CMS_PUBLICATION_INTERVAL_MS ?? this.config.recovery?.intervalMs ?? 60_000));
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.publication.processDueSchedules().catch((error) => this.logger.error(`CMS publication tick failed: ${error instanceof Error ? error.message : String(error)}`)).finally(() => { this.running = false; });
    }, intervalMs);
  }

  onApplicationShutdown(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  run(now = new Date()) { return this.publication.processDueSchedules(now); }
  isRunning(): boolean { return this.timer !== null; }
}
