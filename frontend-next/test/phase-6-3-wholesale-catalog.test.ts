/**
 * تست‌های آداپتور کاتالوگ عمده‌فروشی (فاز ۶.۳‑C).
 *
 * پوشش: نگاشتِ فهرستِ CURSOR، حفظِ قیمت به‌صورت **رشتهٔ اعشاری** (بدونِ محاسبه)،
 * حفظِ فروشنده/منبع، صفحه‌بندی با `nextCursor`، و مهم‌تر از همه:
 * **EMPTY ≠ ERROR** — فهرستِ خالیِ معتبر داده است، نه شکست؛ و ۴۲۹/۵۰۰/شبکه
 * هرگز به «خالی» تبدیل نمی‌شوند.
 */

import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../shared/http";
import {
  fetchWholesaleCatalog,
  fetchWholesaleProductDetail,
  mapWholesaleCatalogItem,
  mapWholesaleProductDetail,
} from "../shared/wholesale/catalog";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function clientWith(stub: FetchLike) {
  return createApiClient({ baseUrl: "http://api.test/v1", fetch: stub });
}

const BROWSE_PAGE = {
  results: [
    { id: "prod_blouse", name: "بلوز", slug: "blouse", description: "d", ownerType: "SUPPLIER", priceFrom: "1240000", priceCurrency: "IRR", availability: 40, categoryId: null, brandId: null, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "prod_classic", name: "پیراهن", slug: "classic", description: "d2", ownerType: "KOLBE", priceFrom: "890000", priceCurrency: "IRR", availability: 60 },
  ],
  nextCursor: "CURSOR_NEXT",
  facets: { categories: [], brands: [] },
};

describe("Phase 6.3-C wholesale catalog adapter", () => {
  it("maps the browse list to CURSOR page items with decimal-string prices and seller", async () => {
    const client = clientWith(async () => jsonResponse(BROWSE_PAGE));
    const result = await fetchWholesaleCatalog(client, { limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mode).toBe("CURSOR");
    if (result.data.mode !== "CURSOR") return;
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]).toMatchObject({ id: "prod_blouse", sellerType: "SUPPLIER", priceFrom: "1240000", currency: "IRR", availability: 40 });
    expect(result.data.items[1]).toMatchObject({ id: "prod_classic", sellerType: "KOLBE", priceFrom: "890000" });
    expect(result.data.nextCursor).toBe("CURSOR_NEXT");
  });

  it("preserves the wholesale price as a decimal string (never a number)", async () => {
    const client = clientWith(async () => jsonResponse(BROWSE_PAGE));
    const result = await fetchWholesaleCatalog(client);
    if (!result.ok || result.data.mode !== "CURSOR") throw new Error("expected ok cursor page");
    const price = result.data.items[0].priceFrom;
    expect(typeof price).toBe("string");
    expect(price).toBe("1240000");
  });

  it("requests the canonical browse endpoint with channel=wholesale, cursor and limit", async () => {
    let seenUrl = "";
    const client = clientWith(async (url: string) => { seenUrl = url; return jsonResponse(BROWSE_PAGE); });
    await fetchWholesaleCatalog(client, { cursor: "ABC", limit: 24, category: "shirt" });
    expect(seenUrl).toContain("/catalog/browse");
    expect(seenUrl).toContain("channel=wholesale");
    expect(seenUrl).toContain("cursor=ABC");
    expect(seenUrl).toContain("limit=24");
    expect(seenUrl).toContain("category=shirt");
  });

  it("treats a valid empty list as data, not an error (EMPTY != ERROR)", async () => {
    const client = clientWith(async () => jsonResponse({ results: [], nextCursor: null, facets: {} }));
    const result = await fetchWholesaleCatalog(client);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.mode !== "CURSOR") throw new Error("expected ok cursor page");
    expect(result.data.items).toEqual([]);
    expect(result.data.nextCursor).toBeNull();
  });

  it.each([429, 500])("does NOT convert an HTTP %i into an empty list", async (status) => {
    const client = clientWith(async () => jsonResponse({ error: "X" }, status));
    const result = await fetchWholesaleCatalog(client);
    expect(result.ok).toBe(false);
  });

  it("does NOT convert a network failure into an empty list", async () => {
    const client = clientWith(async () => { throw new TypeError("network down"); });
    const result = await fetchWholesaleCatalog(client);
    expect(result.ok).toBe(false);
  });

  it("maps product detail variants, offers (decimal-string price) and media", async () => {
    const detail = {
      id: "prod_blouse", name: "بلوز", slug: "blouse", description: "d", ownerType: "SUPPLIER", status: "published",
      priceFrom: "1240000", priceCurrency: "IRR", availability: 40,
      variants: [{ id: "var_1", sku: "NL-1", attributes: { size: "L", color: "گلبهی", color_hex: "#c9654d" } }],
      offers: [{ id: "off_1", sellerId: "seller_x", variantId: "var_1", price: "1240000", currency: "IRR" }],
      media: [{ url: "https://cdn/x.jpg" }],
    };
    const client = clientWith(async () => jsonResponse(detail));
    const result = await fetchWholesaleProductDetail(client, "prod_blouse");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sellerType).toBe("SUPPLIER");
    expect(result.data.variants[0]).toMatchObject({ id: "var_1", size: "L", color: "گلبهی", colorHex: "#c9654d" });
    expect(result.data.offers[0]).toMatchObject({ variantId: "var_1", sellerId: "seller_x", price: "1240000" });
    expect(typeof result.data.offers[0].price).toBe("string");
    expect(result.data.media).toEqual(["https://cdn/x.jpg"]);
  });

  it("coerces a numeric price to a string without arithmetic (mapper purity)", () => {
    const item = mapWholesaleCatalogItem({ id: "p", name: "n", priceFrom: 1240000, ownerType: "supplier" });
    expect(item?.priceFrom).toBe("1240000");
    expect(item?.sellerType).toBe("SUPPLIER");
    expect(mapWholesaleCatalogItem({ name: "no id" })).toBeNull();
    expect(mapWholesaleCatalogItem(null)).toBeNull();
  });

  it("returns UNKNOWN for an unrecognised seller and defaults currency to IRR", () => {
    const item = mapWholesaleCatalogItem({ id: "p", ownerType: "MARKETPLACE" });
    expect(item?.sellerType).toBe("UNKNOWN");
    expect(item?.currency).toBe("IRR");
  });

  it("rejects a malformed product detail as a failure, not empty", async () => {
    const client = clientWith(async () => jsonResponse({ nope: true }));
    const result = await fetchWholesaleProductDetail(client, "prod_x");
    expect(result.ok).toBe(false);
    expect(mapWholesaleProductDetail({ nope: true })).toBeNull();
  });
});
