/**
 * آداپتور کاتالوگ عمده‌فروشی (فاز ۶.۳‑C).
 *
 * جایگزینِ `loadWholesaleVipProducts` در `storefront/lib/wholesaleVipApi.ts` و
 * قیمتِ جعلیِ سمتِ کلاینت (`round(price * 0.68)`) است. قواعدِ تغییرناپذیر:
 *  1. قیمتِ عمده **رشتهٔ اعشاری** است (`priceFrom` / `offers[].price`) — هرگز
 *     عددِ شناور و هرگز محاسبهٔ سمتِ کلاینت. مرجعِ قیمت فقط سرور است.
 *  2. فهرست با **CURSOR** صفحه‌بندی می‌شود (بدونِ load-all)؛ `nextCursor` تنها
 *     مرجعِ صفحهٔ بعد است و «خالی» به‌معنای «پایان» نیست مگر `hasMore === false`.
 *  3. فروشنده/منبع (`ownerType`: KOLBE|SUPPLIER و `offers[].sellerId`) حفظ می‌شود.
 *  4. EMPTY ≠ ERROR: این توابع `ApiResult` برمی‌گردانند؛ فهرستِ خالیِ معتبر
 *     `ok:true` با `items: []` است، در حالی که ۴۲۹/۵۰۰/شبکه `ok:false` است.
 *
 * این ماژول به مرورگر وابسته نیست و با `ApiClient` تزریق‌شده تست می‌شود.
 */

import { normalizePage, type Page } from "../pagination/pagination";
import { ApiError } from "../http/errors";
import type { ApiClient, ApiResult } from "../http/types";

export type WholesaleSellerType = "KOLBE" | "SUPPLIER" | "UNKNOWN";

export type WholesaleCatalogItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sellerType: WholesaleSellerType;
  /** قیمتِ عمده به‌صورت رشتهٔ اعشاری (مرجعِ سرور) — هرگز number. */
  priceFrom: string;
  currency: string;
  availability: number;
  categoryId: string | null;
  brandId: string | null;
  createdAt: string | null;
};

export type WholesaleCatalogPage = Page<WholesaleCatalogItem>;

export type WholesaleCatalogQuery = {
  cursor?: string | null;
  limit?: number;
  q?: string;
  category?: string;
  brand?: string;
  sort?: string;
  signal?: AbortSignal;
};

export type WholesaleVariant = {
  id: string;
  sku: string;
  size: string;
  color: string;
  colorHex: string;
};

export type WholesaleOffer = {
  id: string;
  variantId: string;
  sellerId: string;
  /** قیمتِ پیشنهادیِ عمده به‌صورت رشتهٔ اعشاری — هرگز number. */
  price: string;
  currency: string;
};

export type WholesaleProductDetail = {
  id: string;
  name: string;
  slug: string;
  description: string;
  sellerType: WholesaleSellerType;
  status: string;
  priceFrom: string;
  currency: string;
  availability: number;
  variants: WholesaleVariant[];
  offers: WholesaleOffer[];
  media: string[];
};

const SELLER_TYPES: readonly string[] = ["KOLBE", "SUPPLIER"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSeller(value: unknown): WholesaleSellerType {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SELLER_TYPES.includes(normalized) ? (normalized as WholesaleSellerType) : "UNKNOWN";
}

/** رشتهٔ اعشاریِ قیمت را **بدونِ هیچ محاسبه‌ای** حفظ می‌کند (number → string). */
function decimalString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "0";
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result.length > 0 ? result : null;
}

function nonNegativeInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function mapWholesaleCatalogItem(raw: unknown): WholesaleCatalogItem | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (id.length === 0) return null;
  return {
    id,
    name: text(raw.name),
    slug: text(raw.slug),
    description: text(raw.description),
    sellerType: parseSeller(raw.ownerType ?? raw.sellerType),
    priceFrom: decimalString(raw.priceFrom ?? raw.wholesalePrice ?? raw.wholesale_price),
    currency: text(raw.priceCurrency ?? raw.currency) || "IRR",
    availability: nonNegativeInt(raw.availability),
    categoryId: nullableText(raw.categoryId),
    brandId: nullableText(raw.brandId),
    createdAt: nullableText(raw.createdAt),
  };
}

function mapVariant(raw: unknown): WholesaleVariant | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (id.length === 0) return null;
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  return {
    id,
    sku: text(raw.sku),
    size: text(attributes.size ?? raw.size),
    color: text(attributes.color ?? raw.color),
    colorHex: text(attributes.color_hex ?? raw.colorHex) || "#d6d3d1",
  };
}

function mapOffer(raw: unknown): WholesaleOffer | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (id.length === 0) return null;
  return {
    id,
    variantId: text(raw.variantId),
    sellerId: text(raw.sellerId),
    price: decimalString(raw.price),
    currency: text(raw.currency) || "IRR",
  };
}

function mapMediaUrl(raw: unknown): string | null {
  if (typeof raw === "string") return raw.length > 0 ? raw : null;
  if (isRecord(raw)) return nullableText(raw.url ?? raw.src ?? raw.href);
  return null;
}

export function mapWholesaleProductDetail(raw: unknown): WholesaleProductDetail | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  if (id.length === 0) return null;
  const variants = Array.isArray(raw.variants) ? raw.variants.map(mapVariant).filter((v): v is WholesaleVariant => v !== null) : [];
  const offers = Array.isArray(raw.offers) ? raw.offers.map(mapOffer).filter((o): o is WholesaleOffer => o !== null) : [];
  const media = Array.isArray(raw.media) ? raw.media.map(mapMediaUrl).filter((m): m is string => m !== null) : [];
  return {
    id,
    name: text(raw.name),
    slug: text(raw.slug),
    description: text(raw.description),
    sellerType: parseSeller(raw.ownerType ?? raw.sellerType),
    status: text(raw.status),
    priceFrom: decimalString(raw.priceFrom ?? raw.wholesalePrice),
    currency: text(raw.priceCurrency ?? raw.currency) || "IRR",
    availability: nonNegativeInt(raw.availability),
    variants,
    offers,
    media,
  };
}

/**
 * فهرستِ کاتالوگ عمده (CURSOR). `nextCursor` برای صفحهٔ بعد بازگردانده می‌شود؛
 * فهرستِ خالیِ معتبر `ok:true` با `items: []` است (EMPTY ≠ ERROR).
 */
export async function fetchWholesaleCatalog(
  client: ApiClient,
  query: WholesaleCatalogQuery = {},
): Promise<ApiResult<WholesaleCatalogPage>> {
  const result = await client.requestResult<unknown>("/catalog/browse", {
    query: {
      channel: "wholesale",
      ...(query.limit != null ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.q ? { q: query.q } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.brand ? { brand: query.brand } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
    },
    signal: query.signal,
  });
  if (!result.ok) return result;
  const page = normalizePage<unknown>(result.data, "CURSOR");
  const items = page.items.map(mapWholesaleCatalogItem).filter((item): item is WholesaleCatalogItem => item !== null);
  // `normalizePage` با mode="CURSOR" همیشه واریانتِ CURSOR می‌دهد؛ این assertion
  // فقط برای باریک‌کردنِ نوعِ اتحادِ `Page` است (بدونِ `any`).
  const cursorPage = page as Extract<Page<unknown>, { mode: "CURSOR" }>;
  return { ok: true, data: { ...cursorPage, items }, meta: result.meta };
}

/** جزئیاتِ یک محصولِ عمده (واریانت‌ها + پیشنهادها با قیمتِ رشتهٔ اعشاری + رسانه). */
export async function fetchWholesaleProductDetail(
  client: ApiClient,
  productId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ApiResult<WholesaleProductDetail>> {
  const result = await client.requestResult<unknown>(`/catalog/products/${encodeURIComponent(productId)}`, {
    query: { channel: "wholesale" },
    signal: options.signal,
  });
  if (!result.ok) return result;
  const detail = mapWholesaleProductDetail(result.data);
  if (!detail) {
    return {
      ok: false,
      meta: result.meta,
      error: new ApiError({
        kind: "MALFORMED_RESPONSE",
        message: "قالبِ جزئیاتِ محصول قابل تفسیر نیست.",
        status: result.meta.status,
        requestId: result.meta.requestId,
        transport: "protocol",
      }),
    };
  }
  return { ok: true, data: detail, meta: result.meta };
}
