/**
 * قفل سبک — پاسبان رنگ‌های ممنوعه روی **داده‌های ذخیره‌شده**.
 *
 * ── چرا لازم است؟ ───────────────────────────────────────────────────────────
 * حذف رنگ سرمه‌ای از کد کافی نیست: تنظیمات ظاهر در `localStorage` مرورگر و در
 * `site_setting` سرور ذخیره می‌شود و می‌تواند مقدارهای قدیمی (`#011c3a` و
 * خویشاوندانش) را با خود حمل کند. آن‌گاه همان رنگ ممنوعه در مرورگر دوباره
 * ظاهر می‌شود، بی‌آنکه جایی در کد نوشته شده باشد.
 *
 * این ماژول همان چیزی است که «قفل» را واقعی می‌کند: هر رشتهٔ رنگی، در هر عمق
 * از درخت تنظیمات، با توکن معتبر جایگزین می‌شود — هم هنگام ذخیره در سرور و هم
 * هنگام خواندن در مرورگر.
 */

/** رنگ‌های ممنوعه (خانوادهٔ سرمه‌ای/آبی قدیمی) → معادل قفل‌شده در پالت کرِم و بلوط. */
const BANNED_HEX: Record<string, string> = {
  "#011c3a": "#1a1714",
  "#0b2a46": "#1a1714",
  "#071c31": "#1a1714",
  "#0a1622": "#1a1714",
  "#0a2c55": "#1a1714",
  "#102b3d": "#1a1714",
  "#102f50": "#1a1714",
  "#17253b": "#1a1714",
  "#1e3b6b": "#1a1714",
  "#22304a": "#1a1714",
  "#244e62": "#1a1714",
  "#2f5c8a": "#5f7355",
  "#36563a": "#5f7355",
  "#3d5c3a": "#5f7355",
  "#4b788d": "#8a9a80",
  "#527055": "#5f7355",
  "#6fa4d8": "#9fb08f",
  "#7d8790": "#8a8177",
  "#9aa5ad": "#b3a999",
  "#c6d7e4": "#e8e2d5",
  "#eef2f7": "#f2ebdf",
};

/** همان رنگ‌ها در قالب `rgba(...)`/`rgb(...)`. */
const BANNED_RGB: Array<[RegExp, string]> = [
  [/rgba?\(\s*1\s*,\s*28\s*,\s*58\s*(,[^)]*)?\)/gi, "rgba(26,23,20$1)"],
  [/rgba?\(\s*7\s*,\s*28\s*,\s*49\s*(,[^)]*)?\)/gi, "rgba(26,23,20$1)"],
  [/rgba?\(\s*11\s*,\s*42\s*,\s*70\s*(,[^)]*)?\)/gi, "rgba(26,23,20$1)"],
  [/rgba?\(\s*23\s*,\s*37\s*,\s*59\s*(,[^)]*)?\)/gi, "rgba(26,23,20$1)"],
];

/** آیا این رشته رنگ ممنوعه دارد؟ (برای گزارش و تست) */
export function hasBannedColour(value: string): boolean {
  const lower = value.toLowerCase();
  if (Object.keys(BANNED_HEX).some((hex) => lower.includes(hex))) return true;
  return BANNED_RGB.some(([pattern]) => pattern.test(value));
}

function lockString(value: string): string {
  let result = value;
  const lower = value.toLowerCase();
  for (const [banned, locked] of Object.entries(BANNED_HEX)) {
    if (lower.includes(banned)) {
      result = result.replace(new RegExp(banned, "gi"), locked);
    }
  }
  for (const [pattern, replacement] of BANNED_RGB) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * اعمال قفل سبک روی یک درخت داده (تنظیمات ظاهر).
 * خروجی، همان ساختار با رشته‌های پاک‌شده است؛ آرایه‌ها و شیءهای تازه ساخته
 * می‌شوند تا شیء ورودی تغییر نکند.
 */
export function enforceStyleLock<T>(input: T): T {
  return walk(input) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return lockString(value);
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = walk(item);
    return result;
  }
  return value;
}

/** شمردن رشته‌هایی که قفل روی آن‌ها اثر گذاشته — برای گزارش حسابرسی. */
export function countLockedStrings<T>(input: T): number {
  let count = 0;
  const visit = (value: unknown) => {
    if (typeof value === "string") { if (hasBannedColour(value)) count += 1; return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(input);
  return count;
}
