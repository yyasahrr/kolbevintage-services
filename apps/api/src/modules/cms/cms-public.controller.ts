import { Controller, Get, Inject, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../../common/guards/session.guard";
import { CmsArticleService } from "./cms-article.service";
import { CmsContentService } from "./cms-content.service";
import { CmsMediaService } from "./cms-media.service";
import { CmsNavigationService } from "./cms-navigation.service";
import { CmsPageService } from "./cms-page.service";
import { CmsPreviewService } from "./cms-preview.service";
import { CmsPublicationService } from "./cms-publication.service";
import { normalizeRoutePath } from "./cms-validation";

@Controller("cms/public")
@Public()
export class CmsPublicController {
  constructor(
    @Inject(CmsPublicationService) private readonly publication: CmsPublicationService,
    @Inject(CmsContentService) private readonly content: CmsContentService,
    @Inject(CmsNavigationService) private readonly navigation: CmsNavigationService,
    @Inject(CmsArticleService) private readonly articles: CmsArticleService,
    @Inject(CmsMediaService) private readonly media: CmsMediaService,
    @Inject(CmsPageService) private readonly pages: CmsPageService,
    @Inject(CmsPreviewService) private readonly preview: CmsPreviewService,
  ) {}

  @Get("page")
  async page(@Query("path") path: string) {
    return this.publication.getPublishedPage(normalizeRoutePath(path ?? "/", "path"));
  }

  @Get("document/:key")
  document(@Param("key") key: string) { return this.publication.getPublishedDocument(key); }

  @Get("navigation/:key")
  navigationPublished(@Param("key") key: string) { return this.navigation.getPublished(key); }

  @Get("article/:slug")
  article(@Param("slug") slug: string) { return this.articles.getPublishedBySlug(slug); }

  @Get("media/:id/file")
  async mediaFile(@Param("id") id: string, @Res() response: Response) {
    const { asset, bytes } = await this.media.getPublic(id);
    response.setHeader("Content-Type", asset.mimeType);
    response.setHeader("Content-Length", String(bytes.length));
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.send(bytes);
  }

  @Get("preview/page/:revisionId")
  async previewPage(@Param("revisionId") revisionId: string, @Query("token") token: string) {
    if (!this.preview.verify(token, "PAGE_REVISION", revisionId)) throw new NotFoundException();
    const revision = await this.pages.getRevisionById(revisionId);
    return { revision, preview: true, expiresWithToken: true };
  }

  @Get("preview/document/:revisionId")
  async previewDocument(@Param("revisionId") revisionId: string, @Query("token") token: string) {
    if (!this.preview.verify(token, "CONTENT_REVISION", revisionId)) throw new NotFoundException();
    const revision = await this.content.getRevisionById(revisionId);
    return { revision, preview: true, expiresWithToken: true };
  }
}
