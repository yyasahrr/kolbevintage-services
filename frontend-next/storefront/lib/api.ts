/** کلاینت API یکپارچه کلبه — فاز ۲: فقط HttpOnly Cookie، بدون localStorage توکن. */
import { KOLBE_API_BASE } from "../nextEnv";
import { reportApiIssue } from "./clientLogger";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const method = init?.method ?? "GET";
  let result: Response;
  try {
    result = await fetch(`${KOLBE_API_BASE}${path}`, {
      method,
      // کوکی HttpOnly نشست همراه درخواست‌های same-origin فرستاده می‌شود — تنها اعتبار
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    reportApiIssue(path, method, undefined, "اتصال به سرور برقرار نشد.");
    throw new ApiError("NETWORK", "اتصال به سرور برقرار نشد.");
  }
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    const code = String((data as any)?.error ?? `HTTP_${result.status}`);
    if (result.status >= 500) reportApiIssue(path, method, result.status, code);
    throw new ApiError(code, String((data as any)?.message ?? code));
  }
  return data as T;
}

export async function apiOrNull<T>(path: string, init?: Parameters<typeof api>[1]): Promise<T | null> {
  try { return await api<T>(path, init); }
  catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return null;
    throw error;
  }
}

export const isBackendConfigured = true;
