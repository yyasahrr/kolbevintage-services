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
