import { Inject, Injectable } from "@nestjs/common";
import { siteSetting } from "@kolbe/database";
import { DomainError } from "@kolbe/shared";
import { KOLBE_DB, type KolbeDatabase } from "../../database/database.module";
import { AuditService } from "../audit/audit.service";

const PRESENTATION_KEYS = new Set(["categories", "designSystem", "header", "heroStudio", "builder", "hero", "collectionBanner", "footer"]);
const HERO_VIDEO_SETTING_KEY = "storefront-hero-video";
const HERO_VIDEO_URL = "/store/kolbe/site/hero-video";
const BANNER_VIDEO_SETTING_KEY = "storefront-banner-video";
const BANNER_VIDEO_URL = "/store/kolbe/site/banner-video";

function extractEmbeddedVideos(settings: Record<string, any>) {
  const heroVideo = typeof settings.heroStudio?.heroVideo === "string" && /^data:video\//i.test(settings.heroStudio.heroVideo)
    ? settings.heroStudio.heroVideo
    : null;
  const bannerVideo = settings.builder?.banner?.mediaType === "video"
    && typeof settings.builder?.banner?.media === "string"
    && /^data:video\//i.test(settings.builder.banner.media)
    ? settings.builder.banner.media
    : null;
  const safeSettings = structuredClone(settings);
  if (heroVideo) safeSettings.heroStudio.heroVideo = HERO_VIDEO_URL;
  if (bannerVideo) safeSettings.builder.banner.media = BANNER_VIDEO_URL;
  return { heroVideo, bannerVideo, safeSettings };
}

function validateEmbeddedMedia(value: unknown, depth = 0): void {
  if (depth > 20) throw new DomainError(422, "SITE_SETTINGS_TOO_DEEP", "ساختار تنظیمات بیش از حد تو در تو است");
  if (typeof value === "string" && value.startsWith("data:")) {
    const match = value.match(/^data:(video\/(?:mp4|webm)|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new DomainError(422, "INVALID_EMBEDDED_MEDIA", "رسانه تعبیه‌شده نامعتبر است");
    if (Buffer.byteLength(match[2], "base64") > 15 * 1024 * 1024) throw new DomainError(413, "EMBEDDED_MEDIA_TOO_LARGE", "حجم رسانه بیش از حد مجاز است");
  } else if (Array.isArray(value)) value.forEach((item) => validateEmbeddedMedia(item, depth + 1));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => validateEmbeddedMedia(item, depth + 1));
}

@Injectable()
export class CmsSiteSettingsService {
  constructor(@Inject(KOLBE_DB) private readonly db: KolbeDatabase, private readonly audit: AuditService) {}
  async save(settings: unknown, actorId: string) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new DomainError(422, "INVALID_SETTINGS", "تنظیمات سایت نامعتبر است");
    const keys = Object.keys(settings as object);
    if (!keys.length || keys.some((key) => !PRESENTATION_KEYS.has(key))) throw new DomainError(422, "ARBITRARY_SITE_SETTING_KEY", "کلید تنظیمات سایت مجاز نیست");
    validateEmbeddedMedia(settings);
    const { heroVideo, bannerVideo, safeSettings } = extractEmbeddedVideos(settings as Record<string, any>);
    const encoded = JSON.stringify(safeSettings);
    if (Buffer.byteLength(encoded, "utf8") > 25 * 1024 * 1024) throw new DomainError(413, "SITE_SETTINGS_TOO_LARGE", "حجم تنظیمات سایت بیش از حد مجاز است");
    const updatedAt = new Date();
    await this.db.transaction(async (tx) => {
      if (heroVideo) await tx.insert(siteSetting).values({ settingKey: HERO_VIDEO_SETTING_KEY, value: { dataUrl: heroVideo }, updatedBy: actorId, updatedAt }).onConflictDoUpdate({ target: siteSetting.settingKey, set: { value: { dataUrl: heroVideo }, updatedBy: actorId, updatedAt } });
      if (bannerVideo) await tx.insert(siteSetting).values({ settingKey: BANNER_VIDEO_SETTING_KEY, value: { dataUrl: bannerVideo }, updatedBy: actorId, updatedAt }).onConflictDoUpdate({ target: siteSetting.settingKey, set: { value: { dataUrl: bannerVideo }, updatedBy: actorId, updatedAt } });
      await tx.insert(siteSetting).values({ settingKey: "storefront", value: safeSettings as any, updatedBy: actorId, updatedAt }).onConflictDoUpdate({ target: siteSetting.settingKey, set: { value: safeSettings as any, updatedBy: actorId, updatedAt } });
      await this.audit.record({ actorId, actorRole: "admin", action: "site_settings.updated", entityType: "site_setting", entityId: "storefront", after: { keys } }, tx);
    });
    return { saved: true, updatedAt: updatedAt.toISOString() };
  }
}
