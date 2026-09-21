import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, Roles } from "../../common/guards/session.guard";
import type { Claims } from "../../common/session";
import { AdminPermissionGuard, RequireAdminPermission } from "../admin/admin-rbac.guard";
import { CmsArticleService } from "./cms-article.service";
import { CmsContentService } from "./cms-content.service";
import { CmsLegacyImportService } from "./cms-import.service";
import { CmsMediaService } from "./cms-media.service";
import { CmsNavigationService } from "./cms-navigation.service";
import { CmsPageService } from "./cms-page.service";
import { CmsPreviewService, type CmsPreviewTarget } from "./cms-preview.service";
import { CmsPublicationService } from "./cms-publication.service";

@Controller("cms/admin")
@Roles("admin")
@UseGuards(AdminPermissionGuard)
export class CmsAdminController {
  constructor(
    @Inject(CmsPageService) private readonly pages: CmsPageService,
    @Inject(CmsContentService) private readonly content: CmsContentService,
    @Inject(CmsNavigationService) private readonly navigation: CmsNavigationService,
    @Inject(CmsArticleService) private readonly articles: CmsArticleService,
    @Inject(CmsMediaService) private readonly media: CmsMediaService,
    @Inject(CmsPublicationService) private readonly publication: CmsPublicationService,
    @Inject(CmsPreviewService) private readonly preview: CmsPreviewService,
    @Inject(CmsLegacyImportService) private readonly importer: CmsLegacyImportService,
  ) {}

  @Get("pages")
  @RequireAdminPermission("cms:content:view")
  listPages(@Query() query: { q?: string; pageType?: string; status?: string; limit?: number; offset?: number }) { return this.pages.listPages(query); }

  @Post("pages")
  @RequireAdminPermission("cms:content:create")
  createPage(@Body() body: any, @CurrentUser() user: Claims) { return this.pages.createPage({ ...body, createdBy: user.sub }); }

  @Get("pages/:id")
  @RequireAdminPermission("cms:content:view")
  getPage(@Param("id") id: string) { return this.pages.getPageById(id); }

  @Get("pages/:id/revisions")
  @RequireAdminPermission("cms:content:view")
  listPageRevisions(@Param("id") id: string) { return this.pages.listRevisions(id); }

  @Post("pages/:id/revisions")
  @RequireAdminPermission("cms:content:edit")
  createPageRevision(@Param("id") pageId: string, @Body() body: any, @CurrentUser() user: Claims) { return this.pages.createRevision({ ...body, pageId, createdBy: user.sub }); }

  @Post("pages/:id/rollback/:revisionId")
  @RequireAdminPermission("cms:content:edit")
  rollbackPage(@Param("id") pageId: string, @Param("revisionId") revisionId: string, @CurrentUser() user: Claims) { return this.pages.rollback(pageId, revisionId, user.sub); }

  @Post("page-revisions/:id/status")
  @RequireAdminPermission("cms:content:edit")
  transitionPageRevision(@Param("id") id: string, @Body() body: { status: string }, @CurrentUser() user: Claims) { return this.pages.transitionRevision(id, body.status, user.sub); }

  @Post("page-revisions/:id/publish")
  @RequireAdminPermission("cms:content:publish")
  publishPage(@Param("id") id: string, @CurrentUser() user: Claims) { return this.publication.publishPage(id, user.sub); }

  @Post("page-revisions/:id/schedule")
  @RequireAdminPermission("cms:content:publish")
  schedulePage(@Param("id") id: string, @Body() body: { publishAt: string; unpublishAt?: string; idempotencyKey: string }, @CurrentUser() user: Claims) { return this.publication.schedulePage(id, body.publishAt, body.unpublishAt, body.idempotencyKey, user.sub); }

  @Post("pages/:id/archive")
  @RequireAdminPermission("cms:content:archive")
  archivePage(@Param("id") id: string, @CurrentUser() user: Claims) { return this.pages.archivePage(id, user.sub); }

  @Post("pages/:id/unpublish")
  @RequireAdminPermission("cms:content:publish")
  unpublishPage(@Param("id") id: string, @CurrentUser() user: Claims) { return this.publication.unpublishPage(id, user.sub); }

  @Get("documents")
  @RequireAdminPermission("cms:content:view")
  listDocuments(@Query("limit") limit?: number) { return this.content.listDocuments(limit); }

  @Post("documents")
  @RequireAdminPermission("cms:content:create")
  createDocument(@Body() body: any, @CurrentUser() user: Claims) { return this.content.createDocument({ ...body, createdBy: user.sub }); }

  @Post("documents/:id/rollback/:revisionId")
  @RequireAdminPermission("cms:content:edit")
  rollbackDocument(@Param("id") documentId: string, @Param("revisionId") revisionId: string, @CurrentUser() user: Claims) { return this.content.rollback(documentId, revisionId, user.sub); }

  @Post("documents/:id/revisions")
  @RequireAdminPermission("cms:content:edit")
  createDocumentRevision(@Param("id") documentId: string, @Body() body: any, @CurrentUser() user: Claims) { return this.content.createRevision({ ...body, documentId, createdBy: user.sub }); }

  @Get("documents/:id/revisions")
  @RequireAdminPermission("cms:content:view")
  listDocumentRevisions(@Param("id") id: string) { return this.content.listRevisions(id); }

  @Post("documents/:id/archive")
  @RequireAdminPermission("cms:content:archive")
  archiveDocument(@Param("id") id: string, @CurrentUser() user: Claims) { return this.content.archiveDocument(id, user.sub); }

  @Post("content-revisions/:id/schedule")
  @RequireAdminPermission("cms:content:publish")
  scheduleContent(@Param("id") id: string, @Body() body: { publishAt: string; unpublishAt?: string; idempotencyKey: string }, @CurrentUser() user: Claims) { return this.publication.scheduleRevision("CONTENT_REVISION", id, body.publishAt, body.unpublishAt, body.idempotencyKey, user.sub); }

  @Post("content-revisions/:id/publish")
  @RequireAdminPermission("cms:content:publish")
  publishContent(@Param("id") id: string, @CurrentUser() user: Claims) { return this.publication.publishContent(id, user.sub); }

  @Post("content-revisions/:id/status")
  @RequireAdminPermission("cms:content:edit")
  transitionContentRevision(@Param("id") id: string, @Body() body: { status: string }, @CurrentUser() user: Claims) { return this.content.transitionRevision(id, body.status, user.sub); }

  @Post("navigations")
  @RequireAdminPermission("cms:navigation:manage")
  createNavigation(@Body() body: any, @CurrentUser() user: Claims) { return this.navigation.createNavigation({ ...body, createdBy: user.sub }); }

  @Post("navigations/:id/archive")
  @RequireAdminPermission("cms:navigation:manage")
  archiveNavigation(@Param("id") id: string, @CurrentUser() user: Claims) { return this.navigation.archiveNavigation(id, user.sub); }

  @Post("navigations/:id/rollback/:revisionId")
  @RequireAdminPermission("cms:navigation:manage")
  rollbackNavigation(@Param("id") navigationId: string, @Param("revisionId") revisionId: string, @CurrentUser() user: Claims) { return this.navigation.rollback(navigationId, revisionId, user.sub); }

  @Post("navigations/:id/revisions")
  @RequireAdminPermission("cms:navigation:manage")
  createNavigationRevision(@Param("id") navigationId: string, @Body() body: any, @CurrentUser() user: Claims) { return this.navigation.createRevision({ ...body, navigationId, createdBy: user.sub }); }

  @Get("navigations/:key")
  @RequireAdminPermission("cms:navigation:manage")
  getNavigation(@Param("key") key: string) { return this.navigation.getByKey(key); }

  @Post("navigation-revisions/:id/schedule")
  @RequireAdminPermission("cms:navigation:manage")
  scheduleNavigation(@Param("id") id: string, @Body() body: { publishAt: string; unpublishAt?: string; idempotencyKey: string }, @CurrentUser() user: Claims) { return this.publication.scheduleRevision("NAVIGATION_REVISION", id, body.publishAt, body.unpublishAt, body.idempotencyKey, user.sub); }

  @Post("navigation-revisions/:id/publish")
  @RequireAdminPermission("cms:navigation:manage")
  publishNavigation(@Param("id") id: string, @CurrentUser() user: Claims) { return this.publication.publishNavigation(id, user.sub); }

  @Post("navigation-revisions/:id/status")
  @RequireAdminPermission("cms:navigation:manage")
  transitionNavigationRevision(@Param("id") id: string, @Body() body: { status: string }, @CurrentUser() user: Claims) { return this.navigation.transitionRevision(id, body.status, user.sub); }

  @Post("article-taxonomy")
  @RequireAdminPermission("cms:blog:manage")
  createArticleTaxonomy(@Body() body: any, @CurrentUser() user: Claims) { return this.articles.createTaxonomy({ ...body, createdBy: user.sub }); }

  @Get("article-taxonomy")
  @RequireAdminPermission("cms:blog:manage")
  listArticleTaxonomy(@Query("kind") kind?: string) { return this.articles.listTaxonomy(kind); }

  @Post("articles")
  @RequireAdminPermission("cms:blog:manage")
  createArticle(@Body() body: any, @CurrentUser() user: Claims) { return this.articles.createArticle({ ...body, createdBy: user.sub }); }

  @Post("articles/:id/archive")
  @RequireAdminPermission("cms:content:archive")
  archiveArticle(@Param("id") id: string, @CurrentUser() user: Claims) { return this.articles.archiveArticle(id, user.sub); }

  @Post("articles/:id/rollback/:revisionId")
  @RequireAdminPermission("cms:blog:manage")
  rollbackArticle(@Param("id") articleId: string, @Param("revisionId") revisionId: string, @CurrentUser() user: Claims) { return this.articles.rollback(articleId, revisionId, user.sub); }

  @Post("articles/:id/revisions")
  @RequireAdminPermission("cms:blog:manage")
  createArticleRevision(@Param("id") articleId: string, @Body() body: any, @CurrentUser() user: Claims) { return this.articles.createRevision({ articleId, revision: body, createdBy: user.sub }); }

  @Get("articles")
  @RequireAdminPermission("cms:blog:manage")
  listArticles(@Query("limit") limit?: number) { return this.articles.listArticles(limit); }

  @Post("article-revisions/:id/schedule")
  @RequireAdminPermission("cms:content:publish")
  scheduleArticle(@Param("id") id: string, @Body() body: { publishAt: string; unpublishAt?: string; idempotencyKey: string }, @CurrentUser() user: Claims) { return this.publication.scheduleRevision("ARTICLE_REVISION", id, body.publishAt, body.unpublishAt, body.idempotencyKey, user.sub); }

  @Post("article-revisions/:id/publish")
  @RequireAdminPermission("cms:content:publish")
  publishArticle(@Param("id") id: string, @CurrentUser() user: Claims) { return this.publication.publishArticle(id, user.sub); }

  @Post("article-revisions/:id/status")
  @RequireAdminPermission("cms:blog:manage")
  transitionArticleRevision(@Param("id") id: string, @Body() body: { status: string }, @CurrentUser() user: Claims) { return this.articles.transitionRevision(id, body.status, user.sub); }

  @Post("media")
  @RequireAdminPermission("cms:media:manage")
  async uploadMedia(@Body() body: { filename: string; mimeType: string; base64: string; altText?: string; caption?: string; width?: number; height?: number; durationMs?: number }, @CurrentUser() user: Claims) {
    const bytes = Buffer.from(body.base64 ?? "", "base64");
    return this.media.upload({ ...body, bytes, createdBy: user.sub });
  }

  @Get("media")
  @RequireAdminPermission("cms:media:manage")
  listMedia(@Query("includeArchived") includeArchived?: string, @Query("limit") limit?: number) { return this.media.list({ includeArchived: includeArchived === "true", limit }); }

  @Get("media/:id/usages")
  @RequireAdminPermission("cms:media:manage")
  mediaUsages(@Param("id") id: string) { return this.media.usages(id); }

  @Post("media/:id/archive")
  @RequireAdminPermission("cms:media:manage")
  archiveMedia(@Param("id") id: string, @CurrentUser() user: Claims) { return this.media.archive(id, user.sub); }

  @Post("media/:id/purge")
  @RequireAdminPermission("cms:media:manage")
  purgeMedia(@Param("id") id: string, @CurrentUser() user: Claims) { return this.media.purgeArchived(id, user.sub); }

  @Post("import/site-settings")
  @RequireAdminPermission("cms:content:create")
  importSiteSettings(@Body() body: { dryRun?: boolean; settingKey?: string }, @CurrentUser() user: Claims) { return this.importer.importSiteSettings({ ...body, actorId: user.sub }); }

  @Post("preview-token")
  @RequireAdminPermission("cms:content:view")
  issuePreviewToken(@Body() body: { target: CmsPreviewTarget; targetId: string; ttlSeconds?: number }) { return { token: this.preview.issue(body.target, body.targetId, body.ttlSeconds) }; }
}
