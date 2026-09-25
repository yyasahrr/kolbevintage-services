/**
 * کشِ **نمایشی**ِ نشست (فاز ۶.۱).
 *
 * چرا اصلاً چنین چیزی وجود دارد؟ چون پر کردنِ اسم/ایمیل در هدر پیش از پاسخِ
 * `/auth/me` از دید کاربر «پرشِ layout» ایجاد می‌کند. اما این کش:
 *
 *  - هرگز تعیین نمی‌کند کاربر کیست؛
 *  - هرگز نقش، شناسهٔ تأمین‌کننده، وضعیتِ VIP یا مجوزی را تعیین نمی‌کند؛
 *  - فقط بعد از آن معتبر است که با پاسخِ سرور **تطبیق** داده شود
 *    (`isPresentationCacheConsistent`).
 *
 * بنابراین برخلافِ کلاینت‌های قدیمی، هیچ مسیری در این ماژول یک «نشست» از
 * localStorage نمی‌سازد.
 */

import type { Session } from "./types";

export const SESSION_PRESENTATION_CACHE_VERSION = 1;

export const SESSION_PRESENTATION_CACHE_KEY = "kolbe-session-presentation-v1";

export type SessionPresentationCache = {
  version: number;
  cachedAt: string;
  displayName: string | null;
  email: string | null;
  /** فقط یک رشتهٔ نمایشی است؛ برای هیچ تصمیمِ دسترسی استفاده نمی‌شود. */
  roleLabel: string | null;
  supplierDisplayName: string | null;
};

/** حداقل قراردادِ ذخیره‌سازی — قابل تزریق تا بدون DOM هم تست شود. */
export type KeyValueStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

/** نوشتنِ بهترین‌تلاشی: نبودِ localStorage یا خطای کوتا هرگز نباید مسیر را بشکند. */
export function writePresentationCache(storage: KeyValueStorage, session: Session, now = new Date()): boolean {
  if (session.status !== "authenticated") {
    clearPresentationCache(storage);
    return false;
  }
  const payload: SessionPresentationCache = {
    version: SESSION_PRESENTATION_CACHE_VERSION,
    cachedAt: now.toISOString(),
    displayName: session.user.name,
    email: session.user.email,
    roleLabel: session.user.role,
    supplierDisplayName: session.supplier?.displayName ?? null,
  };
  try {
    storage.setItem(SESSION_PRESENTATION_CACHE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readPresentationCache(storage: KeyValueStorage): SessionPresentationCache | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SESSION_PRESENTATION_CACHE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.version !== SESSION_PRESENTATION_CACHE_VERSION) return null;
    return {
      version: SESSION_PRESENTATION_CACHE_VERSION,
      cachedAt: readString(parsed, "cachedAt") ?? "",
      displayName: readString(parsed, "displayName"),
      email: readString(parsed, "email"),
      roleLabel: readString(parsed, "roleLabel"),
      supplierDisplayName: readString(parsed, "supplierDisplayName"),
    };
  } catch {
    return null;
  }
}

export function clearPresentationCache(storage: KeyValueStorage): void {
  try {
    storage.removeItem(SESSION_PRESENTATION_CACHE_KEY);
  } catch {
    // پاک‌سازیِ ناموفق بی‌خطر است؛ کش فقط نمایشی است.
  }
}

/**
 * آیا کش با پاسخِ سرور هم‌خوان است؟
 * اگر بله، می‌توان از آن برای نمایشِ لحظه‌ای استفاده کرد؛ اگر نه باید دور ریخته شود.
 */
export function isPresentationCacheConsistent(cache: SessionPresentationCache | null, session: Session): boolean {
  if (!cache) return false;
  if (session.status !== "authenticated") return false;
  if (cache.email !== null && cache.email !== session.user.email) return false;
  if (cache.roleLabel !== null && cache.roleLabel !== session.user.role) return false;
  return true;
}

/**
 * نامِ نمایشیِ قابل‌استفاده تا پیش از رسیدنِ پاسخِ سرور.
 * آگاهانه فقط `displayName` را برمی‌گرداند — نه نقش و نه شناسه.
 */
export function cachedDisplayName(cache: SessionPresentationCache | null): string | null {
  return cache?.displayName ?? null;
}
