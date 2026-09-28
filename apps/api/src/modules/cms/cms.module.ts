import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { AdminModule } from "../admin/admin.module";
import { AuditModule } from "../audit/audit.module";
import { RecoveryModule } from "../recovery/recovery.module";
import { CmsAdminController } from "./cms-admin.controller";
import { CmsArticleService } from "./cms-article.service";
import { CmsContentService } from "./cms-content.service";
import { CmsLegacyImportService } from "./cms-import.service";
import { CmsMediaService, CMS_PUBLIC_MEDIA_STORAGE } from "./cms-media.service";
import { CmsNavigationService } from "./cms-navigation.service";
import { CmsPageService, CmsRevisionService } from "./cms-page.service";
import { CmsPreviewService } from "./cms-preview.service";
import { CmsPromotionReferenceService } from "./cms-promotion-reference.service";
import { CmsPublicController } from "./cms-public.controller";
import { CmsPublicationScheduler, CmsPublicationService } from "./cms-publication.service";
import { LocalPublicMediaStorage } from "./public-media-storage";
import { PromotionsModule } from "../promotions/promotions.module";
import { CmsCompatController } from "./cms-compat.controller";
import { CmsSiteSettingsService } from "./cms-site-settings.service";

@Module({
  imports: [DatabaseModule, AuditModule, AdminModule, RecoveryModule, PromotionsModule],
  controllers: [CmsAdminController, CmsPublicController, CmsCompatController],
  providers: [
    CmsPageService,
    CmsRevisionService,
    CmsContentService,
    CmsNavigationService,
    CmsArticleService,
    CmsMediaService,
    CmsPublicationService,
    CmsPublicationScheduler,
    CmsPreviewService,
    CmsPromotionReferenceService,
    CmsLegacyImportService,
    CmsSiteSettingsService,
    LocalPublicMediaStorage,
    { provide: CMS_PUBLIC_MEDIA_STORAGE, useExisting: LocalPublicMediaStorage },
  ],
  exports: [
    CmsPageService,
    CmsRevisionService,
    CmsContentService,
    CmsNavigationService,
    CmsArticleService,
    CmsMediaService,
    CmsPublicationService,
    CmsPublicationScheduler,
    CmsPreviewService,
    CmsPromotionReferenceService,
  ],
})
export class CmsModule {}
