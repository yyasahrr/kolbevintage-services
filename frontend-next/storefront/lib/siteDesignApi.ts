/**
 * کلاینت استودیوی طراحی سایت (پاسخ ۵۰).
 *
 * چهار فرمان، هیچ حالت مبهم: خواندن وضعیت، ذخیرهٔ پیش‌نویس، انتشار، بازگردانی.
 * همه از مسیر یکپارچهٔ `/store/kolbe/admin/site-design*` می‌گذرند و کوکی نشست
 * مدیر همراه درخواست می‌رود (`api()` خودش `credentials: include` دارد).
 */
import { api, ApiError } from "./api";
import type { SiteSettings } from "../siteSettings";

export type SiteDesignStatus = "draft" | "published" | "archived";

export type SiteDesignRevision = {
  id: string;
  status: SiteDesignStatus;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  payload?: Partial<SiteSettings>;
};

export type SiteDesignState = {
  settingKey: string;
  draft: SiteDesignRevision | null;
  published: SiteDesignRevision | null;
  revisions: SiteDesignRevision[];
};

/** وضعیت استودیو: پیش‌نویس فعال، نسخهٔ منتشرشده و تاریخچه. */
export function loadSiteDesignState() {
  return api<SiteDesignState>("/store/kolbe/admin/site-design");
}

/** ذخیرهٔ پیش‌نویس (بدون انتشار روی سایت زنده). */
export function saveSiteDesignDraft(settings: SiteSettings, note?: string | null) {
  return api<SiteDesignState>("/store/kolbe/admin/site-design/draft", {
    method: "PUT",
    body: { settings, note: note ?? null },
  });
}

/** انتشار: پیش‌نویس فعال (یا نسخهٔ داده‌شده) روی فروشگاه زنده می‌نشیند. */
export function publishSiteDesign(revisionId?: string | null) {
  return api<SiteDesignState>("/store/kolbe/admin/site-design/publish", {
    method: "POST",
    body: { revisionId: revisionId ?? null },
  });
}

/** بازگردانی یک نسخهٔ قدیمی به‌صورت پیش‌نویس تازه. */
export function restoreSiteDesignRevision(revisionId: string) {
  return api<SiteDesignState>("/store/kolbe/admin/site-design/restore", {
    method: "POST",
    body: { revisionId },
  });
}

/** پیام فارسی خطا برای نمایش در استودیو. */
export function siteDesignErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK") return "اتصال به سرور برقرار نشد؛ تغییرات در مرورگر نگه داشته شد.";
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") return "برای این کار باید با حساب مدیر وارد شوید.";
    if (error.code === "SITE_DESIGN_DRAFT_NOT_FOUND") return "پیش‌نویسی برای انتشار وجود ندارد.";
    if (error.code === "SITE_DESIGN_REVISION_NOT_FOUND") return "این نسخه پیدا نشد.";
    if (error.code === "EMBEDDED_VIDEO_NOT_ALLOWED") return "ویدیوی جاسازی‌شده در تنظیمات ظاهر پذیرفته نمی‌شود.";
    if (error.code === "SITE_DESIGN_TOO_LARGE") return "حجم تنظیمات ظاهر بیش از حد مجاز است.";
    if (error.code === "INVALID_SITE_DESIGN_KEYS" || error.code === "INVALID_SITE_DESIGN") return "بخشی از تنظیمات ناشناس است و ذخیره نشد.";
    return "ذخیرهٔ تنظیمات ظاهر انجام نشد.";
  }
  return "ذخیرهٔ تنظیمات ظاهر انجام نشد.";
}
