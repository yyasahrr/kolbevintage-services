/**
 * کلاینت بک‌اند کلبه (Medusa) - همه درخواستها نسبی هستند و از لایه API
 * خود Next.js (route handlerهای پروکسی) به سرور ۹۰۰۰ میروند
 * (بدون CORS و بدون localhost در مرورگر).
 * توکنها در localStorage نگهداری میشوند و هر نقش کلید خودش را دارد.
 */
import { KOLBE_API_BASE, MEDUSA_PUBLISHABLE_KEY } from "../nextEnv";

export const TOKEN_KEYS = {
  customer: "kv_medusa_customer",
  vip: "kv_medusa_vip",
  admin: "kv_medusa_admin",
  supplier: "kv_medusa_supplier",
} as const;

export type Role = keyof typeof TOKEN_KEYS;

const BASE = KOLBE_API_BASE;
const PUBLISHABLE_KEY = MEDUSA_PUBLISHABLE_KEY;

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export function loadToken(role: Role): string | null {
  try {
    return localStorage.getItem(TOKEN_KEYS[role]);
  } catch {
    return null;
  }
}

export function saveToken(role: Role, token: string) {
  try {
    localStorage.setItem(TOKEN_KEYS[role], token);
  } catch {
    /* ignore */
  }
}

export function clearToken(role: Role) {
  try {
    localStorage.removeItem(TOKEN_KEYS[role]);
  } catch {
    /* ignore */
  }
}

/** درخواست JSON؛ خطای شبکه را با کد NETWORK قابل تشخیص میکند. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; token?: string | null }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
        ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("NETWORK", "اتصال به سرور برقرار نشد.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String((data as any)?.message ?? "");
    if (message.includes("Publishable API key") || (data as any)?.type === "not_allowed") {
      throw new ApiError("BAD_API_KEY", "نسخه صفحه قدیمی است؛ صفحه را با Ctrl+Shift+R رفرش کنید.");
    }
    throw new ApiError(String((data as any)?.error ?? `HTTP_${response.status}`));
  }
  return data as T;
}

/** مثل api اما خطای شبکه را به null تبدیل میکند (برای حالت دمو آفلاین). */
export async function apiOrNull<T>(path: string, init?: Parameters<typeof api>[1]): Promise<T | null> {
  try {
    return await api<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return null;
    throw error;
  }
}

export const isBackendConfigured = true;
