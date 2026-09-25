/**
 * ساخت نشانیِ درخواست برای لایهٔ حمل‌ونقل مشترک (فاز ۶.۱).
 *
 * نکتهٔ مهم: این توابع خالص و بدون وابستگی به مرورگر/Node هستند تا بتوان همهٔ
 * حالت‌های ترکیبِ پایه/مسیر/پارامتر را به‌صورت واحد تست کرد.
 */

import type { QueryInput, QueryValue } from "./types";

const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

export function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL.test(value);
}

function normalizeBase(baseUrl: string): string {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry === null || entry === undefined) continue;
      params.append(key, String(entry));
    }
    return;
  }
  params.append(key, String(value));
}

/**
 * ترکیب پایه، مسیر و پارامترها.
 *
 * - مسیرِ مطلق (http/https) بدون پایه استفاده می‌شود (برای فراخوانی سرویس دیگر).
 * - پارامترهای `null`/`undefined` حذف می‌شوند، نه اینکه به رشتهٔ «null» تبدیل شوند.
 * - آرایه‌ها به پارامتر تکرارشونده تبدیل می‌شوند (`tag=a&tag=b`).
 */
export function buildRequestUrl(baseUrl: string, path: string, query?: QueryInput): string {
  const target = isAbsoluteUrl(path) ? path : `${normalizeBase(baseUrl)}${normalizePath(path)}`;
  if (!query) return target;
  const params = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) appendQueryValue(params, key, value);
  }
  const serialized = params.toString();
  if (!serialized) return target;
  return `${target}${target.includes("?") ? "&" : "?"}${serialized}`;
}

function readEnvValue(key: string): string | undefined {
  try {
    const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
    return value && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const DEFAULT_API_BASE = "/api/v1";

/**
 * پایهٔ نشانیِ پیش‌فرض.
 *
 * اولویت:
 *  1. در محیطِ بدون `window` (SSR/RSC/تست): `KOLBE_API_INTERNAL_URL` — آدرس داخلی
 *     سرویس که در harness تست ست می‌شود و هرگز به مرورگر فرستاده نمی‌شود.
 *  2. `NEXT_PUBLIC_API_BASE` (مستند در `.env.example`) سپس `NEXT_PUBLIC_KOLBE_API`
 *     برای سازگاری با کلاینت قدیمیِ فروشگاه.
 *  3. `/api/v1` — همان-origin؛ کوکی HttpOnly بدون نیاز به CORS می‌رسد.
 *
 * هیچ مقدار میزبان/پورتی در کد تولیدی hardcode نمی‌شود.
 */
export function resolveDefaultBaseUrl(): string {
  const isBrowser = typeof globalThis.window !== "undefined";
  if (!isBrowser) {
    const internal = readEnvValue("KOLBE_API_INTERNAL_URL");
    if (internal) return internal;
  }
  return readEnvValue("NEXT_PUBLIC_API_BASE") ?? readEnvValue("NEXT_PUBLIC_KOLBE_API") ?? DEFAULT_API_BASE;
}
