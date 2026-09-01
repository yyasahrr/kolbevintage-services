/**
 * متغیرهای محیطی لایه Next.js
 * (در نسخه Vite از import.meta.env خوانده می‌شد؛ اینجا از NEXT_PUBLIC_* پشتیبانی می‌شود)
 */
function readEnv(key: string): string | undefined {
  try {
    return (process.env as Record<string, string | undefined>)[key];
  } catch {
    return undefined;
  }
}

export const KOLBE_API_BASE = readEnv("NEXT_PUBLIC_KOLBE_API") ?? "";

export const MEDUSA_PUBLISHABLE_KEY =
  readEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY") ??
  "pk_8f89ce3f6e86e7085af4fa9f374537c7efc4bbb7f3a591406cb67fb44b3604ee";
