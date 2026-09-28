/** کلاینت API کلبه برای فرانت قدیمی Vite. */
export const TOKEN_KEYS = {
  customer: "kv_customer", vip: "kv_vip", admin: "kv_admin", supplier: "kv_supplier",
} as const;
export type Role = keyof typeof TOKEN_KEYS;
const BASE = import.meta.env.VITE_KOLBE_API ?? "";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) { super(message ?? code); this.code = code; }
}
export function loadToken(role: Role): string | null {
  try { return localStorage.getItem(TOKEN_KEYS[role]); } catch { return null; }
}
export function saveToken(role: Role, token: string) {
  try { localStorage.setItem(TOKEN_KEYS[role], token); } catch { /* storage unavailable */ }
}
export function clearToken(role: Role) {
  try { localStorage.removeItem(TOKEN_KEYS[role]); } catch { /* storage unavailable */ }
}
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; token?: string | null }): Promise<T> {
  let result: Response;
  try {
    result = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch { throw new ApiError("NETWORK", "اتصال به سرور برقرار نشد."); }
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new ApiError(String((data as any)?.error ?? `HTTP_${result.status}`));
  return data as T;
}
export async function apiOrNull<T>(path: string, init?: Parameters<typeof api>[1]): Promise<T | null> {
  try { return await api<T>(path, init); }
  catch (error) { if (error instanceof ApiError && error.code === "NETWORK") return null; throw error; }
}
export const isBackendConfigured = true;
