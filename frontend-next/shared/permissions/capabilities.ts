/**
 * مدلِ دسترسی/قابلیتِ مشترک (فاز ۶.۱).
 *
 * هدف: پایان دادن به مقایسه‌های رشته‌ایِ پراکنده در UI
 * (`user.role === "admin"`, `permissions.includes("x")`, …) که در چند صفحه تکرار
 * شده بود و هر کدام برداشتِ خودش از «دسترسی» را داشت.
 *
 * قواعد:
 *  1. دسترسی فقط از نشست/قراردادهای سرور می‌آید؛ این مدل چیزی اختراع نمی‌کند.
 *  2. نقشِ `admin` به‌هیچ‌وجه به‌معنای «دسترسیِ نامحدود در فرانت‌اند» نیست.
 *     `hasPermission()` **فقط** فهرستِ مجوزهای دریافت‌شده را نگاه می‌کند. نقش
 *     برای پیمایش/نمایشِ بخش‌ها (`hasRole`) کاربرد دارد، نه برای صدورِ اجازه.
 *  3. `supplier` به‌معنای `manufacturer` نیست؛ توانِ تولید باید با یک
 *     capability صریح اثبات شود.
 *  4. خروجیِ این ماژول فقط «UX» است: مخفی/نمایش/فعال/غیرفعال. مجوزدهیِ واقعی
 *     همچنان در سرور است و پاسخِ ۴۰۳ معتبر است.
 */

import type { ResolvedSessionRole, SessionRole } from "../session/roles";

export type Permission = string;
export type CapabilityCode = string;

export type CapabilitySet = {
  /** نقش‌های اعلام‌شده توسط سرور. */
  readonly roles: readonly ResolvedSessionRole[];
  /** مجوزهای دانه‌ریز (مثلاً `crm:view`) — منبع: نشست/قرارداد سرور. */
  readonly permissions: readonly Permission[];
  /** capabilityهای تأمین‌کننده (کدهای اعلام‌شده توسط سرور، نه فرض‌شده). */
  readonly supplierCapabilities: readonly CapabilityCode[];
  /** شناسهٔ تأمین‌کننده فقط وقتی که سرور آن را اعلام کرده باشد. */
  readonly supplierId: string | null;
  /** همیشه `"server"` — هیچ منبعِ مرورگری مجاز نیست. */
  readonly source: "server";
};

export const ANONYMOUS_CAPABILITIES: CapabilitySet = {
  roles: [],
  permissions: [],
  supplierCapabilities: [],
  supplierId: null,
  source: "server",
};

export type CapabilityInput = {
  roles?: readonly ResolvedSessionRole[];
  permissions?: readonly Permission[];
  supplierCapabilities?: readonly CapabilityCode[];
  supplierId?: string | null;
};

export function createCapabilitySet(input: CapabilityInput = {}): CapabilitySet {
  return {
    roles: input.roles ?? [],
    permissions: input.permissions ?? [],
    supplierCapabilities: input.supplierCapabilities ?? [],
    supplierId: input.supplierId ?? null,
    source: "server",
  };
}

/**
 * تطبیقِ یک مجوز با الگوی گروهی: `crm:*` شامل `crm:view` می‌شود و `*` شامل همه.
 * دقت کنید که این **تطبیقِ الگو** است نه «تطبیقِ پیشوند»: `crm` شامل
 * `crm:view` نمی‌شود تا اشتباهِ رایجِ پیشوندی رخ ندهد.
 */
export function permissionMatches(granted: Permission, required: Permission): boolean {
  if (granted === required) return true;
  if (granted === "*") return true;
  if (!granted.endsWith(":*")) return false;
  const group = granted.slice(0, -1); // "crm:"
  return required.startsWith(group);
}

export function hasPermission(set: CapabilitySet, required: Permission): boolean {
  return set.permissions.some((granted) => permissionMatches(granted, required));
}

export function hasAnyPermission(set: CapabilitySet, required: readonly Permission[]): boolean {
  return required.some((permission) => hasPermission(set, permission));
}

export function hasAllPermissions(set: CapabilitySet, required: readonly Permission[]): boolean {
  return required.every((permission) => hasPermission(set, permission));
}

/** نقش برای هدایت/نمایش است؛ **هرگز** جایگزینِ `hasPermission` نمی‌شود. */
export function hasRole(set: CapabilitySet, role: SessionRole | ResolvedSessionRole): boolean {
  return set.roles.includes(role);
}

export function supplierHasCapability(set: CapabilitySet, capability: CapabilityCode): boolean {
  return set.supplierId !== null && set.supplierCapabilities.includes(capability);
}

/**
 * آیا این نشست می‌تواند بخشِ تولید را ببیند؟
 * شرط: capability صریح (`production` یا `manufacturing`) از سرور رسیده باشد.
 * نقشِ `supplier` به‌تنهایی کافی نیست — «تأمین‌کننده == تولیدکننده» یک فرضِ غلط است.
 */
export function canUseProduction(set: CapabilitySet): boolean {
  return supplierHasCapability(set, "production") || supplierHasCapability(set, "manufacturing");
}

export type UiControlState = "visible" | "hidden" | "enabled" | "disabled";

export type ControlRequirement = {
  /** تک‌مجوز. */
  permission?: Permission;
  /** حداقل یکی از این مجوزها. */
  anyPermission?: readonly Permission[];
  /** همهٔ این مجوزها. */
  allPermissions?: readonly Permission[];
  /** نقشِ لازم برای نمایشِ بخش (اختیاری؛ فقط پیمایش). */
  role?: SessionRole | ResolvedSessionRole;
  /**
   * رفتار در صورتِ عدمِ دسترسی:
   *  - `true` (پیش‌فرض): کنترل کاملاً پنهان می‌شود؛
   *  - `false`: کنترل دیده می‌شود اما غیرفعال است (برای آموزشِ «چه چیزی ممکن است»).
   */
  hideWhenDenied?: boolean;
};

/**
 * وضعیتِ یک کنترلِ UI بر اساسِ دسترسی.
 *
 * این تابع جایگزینِ مقایسه‌های پراکندهٔ `role === "admin"` در صفحات است و
 * تصمیمِ «پنهان در برابر غیرفعال» را در یک نقطه نگه می‌دارد.
 */
export function controlState(set: CapabilitySet, requirement: ControlRequirement = {}): UiControlState {
  const {
    permission,
    anyPermission,
    allPermissions,
    role,
    hideWhenDenied = true,
  } = requirement;

  const checks: boolean[] = [];
  if (permission !== undefined) checks.push(hasPermission(set, permission));
  if (anyPermission !== undefined) checks.push(hasAnyPermission(set, anyPermission));
  if (allPermissions !== undefined) checks.push(hasAllPermissions(set, allPermissions));
  if (role !== undefined) checks.push(hasRole(set, role));

  const allowed = checks.length === 0 ? true : checks.every(Boolean);
  if (allowed) return "visible";
  return hideWhenDenied ? "hidden" : "disabled";
}

export function isActionable(state: UiControlState): boolean {
  return state === "visible" || state === "enabled";
}
