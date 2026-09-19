/**
 * بهداشت لاگ و ماسک‌کردن داده‌های حساس — فاز ۴.۹ سخت‌سازی تولید.
 *
 * قاعده: هیچ رمز، توکن، کوکی، هدر احراز هویت، شماره کارت، شبا، شناسهٔ ملی
 * یا سند هویتی نباید در خروجی لاگ‌ها، خطاها یا پیام‌های تشخیصی چاپ شود.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "passwordhash",
  "secret",
  "token",
  "jwt",
  "authorization",
  "cookie",
  "set-cookie",
  "sessionsecret",
  "apikey",
  "api_key",
  "internalapitoken",
  "totpcode",
  "totpsecret",
  "cvv",
  "cvv2",
  "pin",
  "contentbase64",
  "privatekey",
  "secretkey",
  "accesskey",
  "certificate",
  "refreshtoken",
]);

/**
 * ماسک‌کردن رشته‌های حساس مالی و هویتی.
 */
export function maskSensitiveString(key: string, value: string): string {
  if (!value || typeof value !== "string") return value;
  const lowerKey = key.toLowerCase().replace(/[-_]/g, "");

  // رمز و توکن کاملاً حذف می‌شوند
  if (
    lowerKey.includes("password") ||
    lowerKey.includes("token") ||
    lowerKey.includes("secret") ||
    lowerKey.includes("jwt") ||
    lowerKey.includes("cookie") ||
    lowerKey.includes("authorization") ||
    lowerKey.includes("base64")
  ) {
    return "[REDACTED]";
  }

  // شماره شبا (IBAN) — حفظ ۴ کاراکتر اول و ۴ کاراکتر آخر
  if (lowerKey.includes("sheba") || lowerKey.includes("iban")) {
    const clean = value.replace(/\s+/g, "");
    if (clean.length > 8) {
      return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
    }
    return "****";
  }

  // شماره کارت بانکی (۱۶ رقمی) — حفظ ۴ رقم اول و ۴ رقم آخر
  if (lowerKey.includes("card") || lowerKey.includes("pan")) {
    const clean = value.replace(/\D/g, "");
    if (clean.length === 16) {
      return `${clean.slice(0, 4)}-****-****-${clean.slice(-4)}`;
    } else if (clean.length > 6) {
      return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
    }
    return "****";
  }

  // کدملی یا شماره شناسنامه
  if (lowerKey.includes("national") || lowerKey.includes("melli")) {
    const clean = value.replace(/\D/g, "");
    if (clean.length >= 8) {
      return `***${clean.slice(-4)}`;
    }
    return "****";
  }

  return value;
}

/**
 * پاک‌سازی بازگشتی اشیاء قبل از لاگ‌کردن.
 */
export function redactSensitive<T = unknown>(data: T, depth = 0): T {
  if (data === null || data === undefined) return data;
  if (depth > 6) return "[MAX_DEPTH]" as unknown as T;

  if (typeof data === "string") {
    let str: string = data;
    if (/Bearer\s+[A-Za-z0-9-_.]+/i.test(str)) {
      str = str.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, "Bearer [REDACTED]");
    }
    str = str.replace(/(password|token|secret|jwt)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
    return str as any as T;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitive(item, depth + 1)) as unknown as T;
  }

  // اگر شیء از نوع Error باشد
  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    } as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(data as Record<string, unknown>)) {
    const normalizedKey = k.toLowerCase().replace(/[-_]/g, "");

    if (SENSITIVE_KEYS.has(normalizedKey)) {
      result[k] = "[REDACTED]";
    } else if (typeof val === "string") {
      result[k] = redactSensitive(maskSensitiveString(k, val));
    } else if (typeof val === "object" && val !== null) {
      result[k] = redactSensitive(val, depth + 1);
    } else {
      result[k] = val;
    }
  }

  return result as T;
}
