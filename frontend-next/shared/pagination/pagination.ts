/**
 * پایهٔ صفحه‌بندیِ مشترک (فاز ۶.۱).
 *
 * فاز ۶.۰ نشان داد چند صفحهٔ فعلی فرض می‌کنند پاسخِ لیست همیشه «کل مجموعه داده»
 * است؛ در حالی که قراردادهای ثبت‌شده چهار حالت دارند: NONE / OFFSET / KEYSET /
 * CURSOR. این ماژول متادیتای canonical سرور را حفظ می‌کند و در نبودِ متادیتا،
 * **نادانی را اعلام می‌کند** (`hasMore: null`, `complete: false`) به‌جای آنکه
 * فرض کند داده کامل است.
 *
 * هیچ رفتار «همه را بیاور» (load-all) در اینجا نیست؛ تصمیمِ واکشی همیشه دست
 * صاحبِ صفحه است و از `nextRequestQuery()` می‌آید.
 */

import type { QueryInput } from "../http/types";

export const PAGINATION_MODES = ["NONE", "OFFSET", "KEYSET", "CURSOR"] as const;

export type PaginationMode = (typeof PAGINATION_MODES)[number];

export class PaginationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaginationContractError";
  }
}

export type Page<T> =
  | { mode: "NONE"; items: readonly T[]; pageSize: number | null; complete: boolean }
  | {
      mode: "OFFSET";
      items: readonly T[];
      pageSize: number | null;
      page: number;
      total: number | null;
      pageCount: number | null;
      hasMore: boolean | null;
      complete: boolean;
    }
  | {
      mode: "KEYSET";
      items: readonly T[];
      pageSize: number | null;
      nextKey: string | null;
      prevKey: string | null;
      hasMore: boolean | null;
      complete: boolean;
    }
  | {
      mode: "CURSOR";
      items: readonly T[];
      pageSize: number | null;
      nextCursor: string | null;
      prevCursor: string | null;
      hasMore: boolean | null;
      complete: boolean;
    };

const DEFAULT_ITEM_KEYS = ["items", "data", "results", "rows", "records", "entries"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function readStringValue(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readBoolean(source: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
}

function readPageSize(container: Record<string, unknown> | null, itemsLength: number): number | null {
  if (!container) return null;
  return readNumber(container, ["limit", "pageSize", "page_size", "perPage", "per_page", "size"]) ?? (itemsLength > 0 ? null : 0);
}

function locateItems(raw: unknown, itemsPath?: string | readonly string[]): { items: readonly unknown[]; container: Record<string, unknown> | null } {
  if (Array.isArray(raw)) return { items: raw, container: null };
  if (!isRecord(raw)) {
    throw new PaginationContractError(
      "پاسخ لیست باید آرایه یا شیئی شامل آرایه باشد؛ قالب دریافت‌شده قابل تفسیر نیست.",
    );
  }
  const candidates = itemsPath === undefined ? DEFAULT_ITEM_KEYS : Array.isArray(itemsPath) ? itemsPath : [itemsPath];
  for (const key of candidates) {
    const value = raw[key];
    if (Array.isArray(value)) return { items: value, container: raw };
  }
  // تشخیصِ قطعی: اگر دقیقاً یک ویژگی آرایه وجود دارد، همان فهرست است.
  const arrayKeys = Object.keys(raw).filter((key) => Array.isArray(raw[key]));
  if (arrayKeys.length === 1) {
    const only = raw[arrayKeys[0] as string];
    if (Array.isArray(only)) return { items: only, container: raw };
  }
  throw new PaginationContractError(
    `آرایهٔ آیتم‌ها در پاسخ یافت نشد. کلیدهای بررسی‌شده: ${candidates.join(", ")}. برایEndpointهای با کلید سفارشی، itemsPath را بفرستید.`,
  );
}

export type NormalizePageOptions = {
  itemsPath?: string | readonly string[];
  /** مقدارِ `page` برای حالت OFFSET وقتی سرور آن را نمی‌فرستد. */
  fallbackPage?: number;
};

/**
 * نرمال‌سازی پاسخِ لیست به `Page<T>`.
 *
 * در نبودِ متادیتا مقدارها `null` می‌مانند تا مصرف‌کننده مجبور باشد «نامعلوم» را
 * مدیریت کند؛ فرضِ «همهٔ داده‌ها رسیده» ممنوع است.
 */
export function normalizePage<T>(
  raw: unknown,
  mode: PaginationMode,
  options: NormalizePageOptions = {},
): Page<T> {
  const { items: rawItems, container } = locateItems(raw, options.itemsPath);
  const items = rawItems as readonly T[];
  const source = container ?? {};
  const nested = isRecord(source.pagination) ? source.pagination : null;
  const meta = nested ?? source;
  // متادیتا می‌تواند در خودِ پاسخ یا در شیءِ `pagination` باشد (هر دو قراردادِ
  // canonical وجود دارد: لاگ‌ها `pagination.limit` و سفارش‌ها `nextCursor` سطحِ اول).
  const pageSize = readPageSize(meta, items.length);

  if (mode === "NONE") {
    return { mode: "NONE", items, pageSize, complete: true };
  }

  if (mode === "OFFSET") {
    const page = readNumber(meta, ["page", "currentPage", "current_page"]) ?? options.fallbackPage ?? 1;
    const total = readNumber(meta, ["total", "totalCount", "total_count", "count"]);
    const pageCount = readNumber(meta, ["pageCount", "page_count", "totalPages", "total_pages"]);
    const explicitHasMore = readBoolean(meta, ["hasMore", "has_more", "hasNext", "has_next"]);
    let hasMore: boolean | null = explicitHasMore;
    if (hasMore === null && total !== null && pageSize !== null && pageSize > 0) {
      hasMore = page * pageSize < total;
    }
    const complete = hasMore === false;
    return { mode: "OFFSET", items, pageSize, page, total, pageCount, hasMore, complete };
  }

  if (mode === "CURSOR") {
    const nextCursor = readStringValue(meta, ["nextCursor", "next_cursor", "next", "cursor"]);
    const prevCursor = readStringValue(meta, ["prevCursor", "prev_cursor", "previousCursor"]);
    const explicitHasMore = readBoolean(meta, ["hasMore", "has_more", "hasNext", "has_next"]);
    const hasMore = explicitHasMore ?? (nextCursor === null ? null : true);
    return { mode: "CURSOR", items, pageSize, nextCursor, prevCursor, hasMore, complete: hasMore === false };
  }

  const nextKey = readStringValue(meta, ["nextKey", "next_key", "nextAfter", "next_after", "nextCursor"]);
  const prevKey = readStringValue(meta, ["prevKey", "prev_key", "previousKey"]);
  const explicitHasMore = readBoolean(meta, ["hasMore", "has_more", "hasNext", "has_next"]);
  const hasMore = explicitHasMore ?? (nextKey === null ? null : true);
  return { mode: "KEYSET", items, pageSize, nextKey, prevKey, hasMore, complete: hasMore === false };
}

export function itemsOf<T>(page: Page<T>): readonly T[] {
  return page.items;
}

/**
 * آیا این صفحه ثابت می‌کند که دادهٔ بیشتری وجود ندارد؟
 * `false` به معنای «نمی‌دانیم» است، نه «چیزی نمانده».
 */
export function isCompletePage<T>(page: Page<T>): boolean {
  return page.complete;
}

export function hasMore<T>(page: Page<T>): boolean | null {
  return page.mode === "NONE" ? false : page.hasMore;
}

/**
 * پارامترهای درخواستِ صفحهٔ بعد؛ اگر ادامه‌ای نباشد `null`.
 * نامِ پارامترها در هر Endpoint متفاوت است، پس خروجیِ این تابع یک شیء عمومی است
 * که صاحبِ صفحه به قراردادِ همان Endpoint نگاشت می‌کند.
 */
export function nextRequestQuery<T>(page: Page<T>): QueryInput | null {
  if (page.mode === "NONE") return null;
  const limit = page.pageSize === null ? {} : { limit: page.pageSize };
  if (page.mode === "OFFSET") {
    return page.hasMore === false ? null : { page: page.page + 1, ...limit };
  }
  if (page.mode === "CURSOR") {
    return page.nextCursor === null ? null : { cursor: page.nextCursor, ...limit };
  }
  return page.nextKey === null ? null : { key: page.nextKey, ...limit };
}

/**
 * برچسبِ کوتاه برای نمایشِ «تعداد نمایش‌داده‌شده از کل» در UI.
 * فقط وقتی `total` از سرور رسیده باشد عددِ کل نشان داده می‌شود.
 */
export function pageSummary<T>(page: Page<T>): { shown: number; total: number | null } {
  return { shown: page.items.length, total: page.mode === "OFFSET" ? page.total : null };
}
