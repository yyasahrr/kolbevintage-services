/**
 * نمونه‌های آمادهٔ کلاینت (فاز ۶.۱).
 *
 * سه مقصدِ متفاوت وجود دارد، اما **یک** پیاده‌سازیِ حمل‌ونقل
 * (`createApiClient`). تفاوتِ مقصد فقط در `baseUrl` است — نه در رفتارِ خطا،
 * نشست یا قالبِ پاسخ. این همان چیزی است که «مرز مشترک» را معنا می‌کند.
 *
 * - `canonical`: مالکِ حقیقت (`/api/v1`). مقصدِ همهٔ کدهای تازه.
 * - `compatStore` / `compatAdmin`: مسیرهای گذارِ ثبت‌شده در `truth-registry.ts`
 *   (۴۷ مسیر). این دو قرار است در فازهای ۶.۲ تا ۶.۷ حذف شوند، نه اینکه تکثیر شوند.
 */

import { createApiClient } from "./client";
import type { ApiClient, ApiClientOptions } from "./types";

export const CANONICAL_API_BASE = "/api/v1";
export const COMPAT_STORE_API_BASE = "/store/kolbe";
export const COMPAT_ADMIN_API_BASE = "/admin/kolbe";

export function createCanonicalClient(options: ApiClientOptions = {}): ApiClient {
  return createApiClient({ baseUrl: CANONICAL_API_BASE, ...options });
}

export function createCompatStoreClient(options: ApiClientOptions = {}): ApiClient {
  return createApiClient({ baseUrl: COMPAT_STORE_API_BASE, ...options });
}

export function createCompatAdminClient(options: ApiClientOptions = {}): ApiClient {
  return createApiClient({ baseUrl: COMPAT_ADMIN_API_BASE, ...options });
}

let canonicalSingleton: ApiClient | null = null;
let compatStoreSingleton: ApiClient | null = null;
let compatAdminSingleton: ApiClient | null = null;

/** کلاینتِ پیش‌فرضِ کدِ تازه. پایه در هر بار استفاده ارزیابی می‌شود (SSR-safe). */
export function canonicalClient(): ApiClient {
  canonicalSingleton ??= createCanonicalClient();
  return canonicalSingleton;
}

export function compatStoreClient(): ApiClient {
  compatStoreSingleton ??= createCompatStoreClient();
  return compatStoreSingleton;
}

export function compatAdminClient(): ApiClient {
  compatAdminSingleton ??= createCompatAdminClient();
  return compatAdminSingleton;
}

/** فقط برای تست: پاک‌سازی نمونه‌های تنبل. */
export function resetClientSingletonsForTests(): void {
  canonicalSingleton = null;
  compatStoreSingleton = null;
  compatAdminSingleton = null;
}
