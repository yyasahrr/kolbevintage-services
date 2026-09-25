/**
 * نقش‌ها و قابلیت‌های نشست (فاز ۶.۱).
 *
 * نقش فقط از سرور می‌آید (`apps/api/src/common/session.ts` → `Claims.role`).
 * این فایل هیچ نقشی را «حدس» نمی‌زند: اگر سرور نقشی خارج از این فهرست بفرستد،
 * مقدار به‌جای افتادن در یک حالتِ پیش‌فرضِ خطرناک، به‌صورت صریح `unknown` علامت
 * می‌خورد تا UI آن را به‌عنوان «بدون دسترسی» رفتار کند.
 */

export const SESSION_ROLES = ["customer", "vip", "supplier", "admin", "finance"] as const;

export type SessionRole = (typeof SESSION_ROLES)[number];

/** نقشِ نامعتبر/ناشناخته — هرگز به‌معنای دسترسی نیست. */
export type UnknownRole = "unknown";

export type ResolvedSessionRole = SessionRole | UnknownRole;

export function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === "string" && (SESSION_ROLES as readonly string[]).includes(value);
}

export function normalizeServerRole(value: unknown): ResolvedSessionRole {
  return isSessionRole(value) ? value : "unknown";
}

/**
 * قابلیت‌های تأمین‌کننده در پایگاه داده کدهای رشته‌ایِ آزادِ هر تأمین‌کننده هستند
 * (`supplierCapability.capabilityCode`)؛ پس در سمت کلاینت مجموعه‌ای «بسته» نیست.
 * این فهرست فقط برای مستندسازیِ کدهای رایج است و **هیچ رفتاری** به آن گره نخورده
 * — منطقِ واقعی باید `supplierHasCapability()` را با کدِ دریافت‌شده از سرور صدا بزند.
 *
 * نکتهٔ حیاتی (ثبت‌شده در truth-registry): «تأمین‌کننده» مترادفِ «تولیدکننده»
 * نیست؛ نمایشِ بخشِ تولید باید به یک capability صریح گره بخورد، نه به نقش.
 */
export const COMMON_SUPPLIER_CAPABILITY_CODES = ["production", "manufacturing", "cutting", "sewing", "finishing", "packaging"] as const;

export function isAdminRole(role: ResolvedSessionRole): boolean {
  return role === "admin";
}

export function isSupplierRole(role: ResolvedSessionRole): boolean {
  return role === "supplier";
}
