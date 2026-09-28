import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OffersService } from "../src/modules/offers/offers.service";

/**
 * Phase 5.10-B — discovery (Nest e2e).
 *
 * Browse filters by category subtree, brand, price window, and
 * stock; prices come from published channel offers over active
 * variants (unpriced products are excluded, never listed with a
 * made-up price); availability sums sellable shelf where a priced
 * offer can actually sell it; sorts page by keyset; facets count
 * the sibling-filtered set; detail is status-gated (drafts 404
 * exactly like missing rows) and bumps an honestly-labeled hit
 * counter. Real PostgreSQL, full Nest application, real
 * CatalogService.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_b_discovery_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510b_${Date.now()}_${seq++}`;
const stamp = Date.now().toString(36);

const ids = {} as Record<string, string>;
let kolbeSeller = "";
let supSeller = "";
const foundIds = (page: { results: Array<Record<string, unknown>> }) => page.results.map((row) => row.id as string);
const rowOf = (page: { results: Array<Record<string, unknown>> }, id: string) => page.results.find((row) => row.id === id);

describe("Phase 5.10-B discovery", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${TEST_DB}" TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`);
    } finally {
      await adminClient.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510b-discovery";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    catalog = app.get(CatalogService);
    const offers = app.get(OffersService);
    kolbeSeller = await offers.ensureSeller(null, "KOLBE");
    const supplierId = makeId("supplier");
    await db.insert(schema.supplier).values({ id: supplierId, legalName: "تأمین آزمون", displayName: "Supplier", status: "approved" });
    supSeller = makeId("seller_sup");
    await db.insert(schema.seller).values({ id: supSeller, type: "SUPPLIER", supplierId, displayName: "Supplier", status: "active" });

    const cat = async (tag: string, row: Record<string, unknown>) => {
      ids[tag] = makeId(`cat_${tag}`);
      await db.insert(schema.category).values({ id: ids[tag], status: "active", ...row } as any);
    };
    await cat("root", { name: "ظروف", slug: `zorouf-${stamp}` });
    await cat("child", { name: "ظروف مسی", slug: `zorouf-masi-${stamp}`, parentId: ids.root });
    await cat("leaf", { name: "کتری", slug: `ketri-${stamp}`, parentId: ids.child });
    await cat("dead", { name: "بایگانی", slug: `dead-${stamp}`, status: "archived" });
    await cat("orphanParent", { name: "والد یتیم", slug: `orphanp-${stamp}` });
    await cat("orphan", { name: "یتیم", slug: `orphan-${stamp}`, parentId: ids.orphanParent });
    await db.update(schema.category).set({ status: "archived" }).where(eq(schema.category.id, ids.orphanParent));
    await cat("cycA", { name: "دور-الف", slug: `cyca-${stamp}` });
    await cat("cycB", { name: "دور-ب", slug: `cycb-${stamp}`, parentId: ids.cycA });
    await db.update(schema.category).set({ parentId: ids.cycB }).where(eq(schema.category.id, ids.cycA));

    const brand = async (tag: string, row: Record<string, unknown>) => {
      ids[tag] = makeId(`brand_${tag}`);
      await db.insert(schema.brand).values({ id: ids[tag], status: "active", verificationStatus: "approved", ...row } as any);
    };
    await brand("brandOk", { name: "مس‌گران", slug: `mesgaran-${stamp}` });
    await brand("brandPending", { name: "در انتظار", slug: `pending-${stamp}`, verificationStatus: "pending" });
    await brand("brandSusp", { name: "تعلیق‌شده", slug: `susp-${stamp}`, status: "suspended" });

    const product = async (tag: string, row: Record<string, unknown>) => {
      ids[tag] = makeId(`prod_${tag}`);
      await db.insert(schema.product).values({ id: ids[tag], status: "published", ownerType: "KOLBE", ...row } as any);
      return ids[tag];
    };
    const variant = async (tag: string, productId: string, status = "active") => {
      ids[tag] = makeId(`var_${tag}`);
      await db.insert(schema.productVariant).values({ id: ids[tag], productId, sku: `SKU-${ids[tag]}`, status } as any);
      return ids[tag];
    };
    const offer = async (productId: string, sellerId: string, variantId: string | null, row: Record<string, unknown>) => {
      await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId, sellerId, variantId, sku: `OFFER-${seq}`, status: "published", ...row } as any);
    };
    const stock = async (variantId: string, sellerId: string, onHand: number, reserved: number) => {
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId, sellerId, onHand, reserved, status: "active" });
    };

    // d1: the fully-dressed product (two variants, mixed offers, split stock).
    await product("d1", { name: "کتری مسی", slug: `d1-${stamp}`, brandId: ids.brandOk, categoryId: ids.leaf });
    await variant("d1a", ids.d1, "active");
    await variant("d1b", ids.d1, "archived");
    await offer(ids.d1, kolbeSeller, ids.d1a, { retailPrice: 100000n, wholesalePrice: 80000n, currency: "IRR" });
    await offer(ids.d1, kolbeSeller, ids.d1a, { retailPrice: 1n, wholesalePrice: 1n, status: "draft" });
    await offer(ids.d1, supSeller, ids.d1a, { retailPrice: 999999n, wholesalePrice: 70000n, currency: "IRR" });
    await offer(ids.d1, kolbeSeller, ids.d1b, { retailPrice: 5n, wholesalePrice: 5n });
    await stock(ids.d1a, kolbeSeller, 10, 3);
    await stock(ids.d1a, supSeller, 5, 5);
    await stock(ids.d1b, kolbeSeller, 100, 0);
    await db.insert(schema.productMedia).values([
      { id: makeId("media"), productId: ids.d1, url: "https://img.test/d1-b.jpg", type: "image", position: 2 },
      { id: makeId("media"), productId: ids.d1, url: "https://img.test/d1-a.jpg", type: "image", position: 1 },
    ]);

    // d2: single offer, thin stock.
    await product("d2", { name: "قوری چینی", slug: `d2-${stamp}`, brandId: ids.brandOk, categoryId: ids.child });
    await variant("d2a", ids.d2);
    await offer(ids.d2, kolbeSeller, ids.d2a, { retailPrice: 200000n, wholesalePrice: 150000n });
    await stock(ids.d2a, kolbeSeller, 2, 0);

    // d3: priced but bare shelf (no brand).
    await product("d3", { name: "سماور نفتی", slug: `d3-${stamp}`, categoryId: ids.root });
    await variant("d3a", ids.d3);
    await offer(ids.d3, kolbeSeller, ids.d3a, { retailPrice: 50000n, wholesalePrice: 40000n });
    await stock(ids.d3a, kolbeSeller, 0, 0);

    // d4: no offers at all — browsable never, detailed with nulls.
    await product("d4", { name: "سینی بی‌قیمت", slug: `d4-${stamp}`, brandId: ids.brandOk, categoryId: ids.leaf });
    await variant("d4a", ids.d4);
    await stock(ids.d4a, kolbeSeller, 9, 0);

    // d5: supplier-owned (wholesale-only).
    await product("d5", { name: "کتری صادراتی", slug: `d5-${stamp}`, brandId: ids.brandOk, categoryId: ids.leaf, ownerType: "SUPPLIER" });
    await variant("d5a", ids.d5);
    await offer(ids.d5, supSeller, ids.d5a, { wholesalePrice: 60000n });
    await stock(ids.d5a, supSeller, 4, 1);

    // d6: draft with offers — hidden everywhere.
    await product("d6", { name: "پیش‌نویس", slug: `d6-${stamp}`, brandId: ids.brandOk, categoryId: ids.leaf, status: "draft" });
    await variant("d6a", ids.d6);
    await offer(ids.d6, kolbeSeller, ids.d6a, { retailPrice: 10n, wholesalePrice: 10n });

    // d7: offer without a variant — unfulfillable, same treatment as d4.
    await product("d7", { name: "بی‌واریانت", slug: `d7-${stamp}`, categoryId: ids.root });
    await offer(ids.d7, kolbeSeller, null, { retailPrice: 10n, wholesalePrice: 10n });

    // Bulk ladder for sort + keyset proofs (retail 1000×n, one unit each).
    for (let n = 1; n <= 12; n++) {
      const pid = await product(`bulk${n}`, { name: `دکوری ${n}`, slug: `bulk-${stamp}-${n}`, brandId: ids.brandOk, categoryId: ids.root });
      const vid = await variant(`bulkv${n}`, pid);
      await offer(pid, kolbeSeller, vid, { retailPrice: BigInt(1000 * n), wholesalePrice: BigInt(900 * n) });
      await stock(vid, kolbeSeller, 1, 0);
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await adminClient.end();
    }
  });

  it("includes the category subtree; unknown and archived roots yield empty", async () => {
    const root = await catalog.browseProducts({ channel: "retail", category: ids.root, limit: 50 });
    expect(foundIds(root)).toEqual(expect.arrayContaining([ids.d1, ids.d2, ids.d3]));
    const child = await catalog.browseProducts({ channel: "retail", category: ids.child, limit: 50 });
    expect(foundIds(child)).toEqual(expect.arrayContaining([ids.d1, ids.d2]));
    expect(foundIds(child)).not.toContain(ids.d3);
    const leaf = await catalog.browseProducts({ channel: "retail", category: ids.leaf, limit: 50 });
    expect(foundIds(leaf)).toContain(ids.d1);
    expect(foundIds(leaf)).not.toContain(ids.d2);
    expect((await catalog.browseProducts({ channel: "retail", category: "ghost" })).results).toHaveLength(0);
    expect((await catalog.browseProducts({ channel: "retail", category: ids.dead })).results).toHaveLength(0);
  });

  it("filters by brand; unknown brands yield empty", async () => {
    const page = await catalog.browseProducts({ channel: "retail", brand: ids.brandOk, limit: 50 });
    expect(foundIds(page)).toEqual(expect.arrayContaining([ids.d1, ids.d2]));
    expect(foundIds(page)).not.toContain(ids.d3); // brand IS NULL
    expect((await catalog.browseProducts({ channel: "retail", brand: "ghost" })).results).toHaveLength(0);
  });

  it("windows prices with both bounds, one bound, and honest empties", async () => {
    const both = await catalog.browseProducts({ channel: "retail", minPrice: "100000", maxPrice: "200000", limit: 50 });
    expect(foundIds(both)).toEqual(expect.arrayContaining([ids.d1, ids.d2]));
    expect(foundIds(both)).not.toContain(ids.d3);
    const minOnly = await catalog.browseProducts({ channel: "retail", minPrice: "150000", limit: 50 });
    expect(foundIds(minOnly)).toContain(ids.d2);
    expect(foundIds(minOnly)).not.toContain(ids.d1);
    const maxOnly = await catalog.browseProducts({ channel: "retail", maxPrice: "60000", limit: 50 });
    expect(foundIds(maxOnly)).toContain(ids.d3);
    expect(foundIds(maxOnly)).not.toContain(ids.d1);
    // min > max can satisfy nothing: empty, not an error.
    expect((await catalog.browseProducts({ channel: "retail", minPrice: "200000", maxPrice: "100000" })).results).toHaveLength(0);
    // Garbage bounds are ignored, not fatal.
    const garbage = await catalog.browseProducts({ channel: "retail", minPrice: "banana", maxPrice: "-5", limit: 50 });
    expect(foundIds(garbage)).toEqual(expect.arrayContaining([ids.d1, ids.d2, ids.d3]));
  });

  it("scopes price and availability per channel from the right offers", async () => {
    const retail = await catalog.browseProducts({ channel: "retail", category: ids.leaf, limit: 50 });
    const d1r = rowOf(retail, ids.d1)!;
    expect(d1r.priceFrom).toBe("100000"); // KOLBE retail; draft/5-rial/archived offers ignored
    expect(d1r.priceCurrency).toBe("IRR");
    expect(d1r.availability).toBe(7); // 10−3 KOLBE; supplier shelf + archived variant excluded
    expect(typeof d1r.priceFrom).toBe("string");
    expect(typeof d1r.availability).toBe("number");
    const wholesale = await catalog.browseProducts({ channel: "wholesale", category: ids.leaf, limit: 50 });
    const d1w = rowOf(wholesale, ids.d1)!;
    expect(d1w.priceFrom).toBe("70000"); // min(80000 KOLBE, 70000 supplier)
    expect(d1w.availability).toBe(7); // 7 KOLBE + 0 supplier (5−5)
    // Supplier-owned product: retail hides, wholesale prices.
    expect(foundIds(retail)).not.toContain(ids.d5);
    const d5w = rowOf(wholesale, ids.d5)!;
    expect(d5w.priceFrom).toBe("60000");
    expect(d5w.availability).toBe(3);
  });

  it("excludes unpriced products from browse but details them with nulls", async () => {
    for (const channel of ["retail", "wholesale"] as const) {
      const page = await catalog.browseProducts({ channel, limit: 50 });
      expect(foundIds(page)).not.toContain(ids.d4); // no offers
      expect(foundIds(page)).not.toContain(ids.d7); // offer without a variant
      expect(foundIds(page)).not.toContain(ids.d6); // draft
    }
    const detail = await catalog.getProductDetail(ids.d4, "retail");
    expect(detail.priceFrom).toBeNull();
    expect(detail.priceCurrency).toBeNull();
    expect(detail.availability).toBe(0);
  });

  it("fences inStock on sellable shelf", async () => {
    const stocked = await catalog.browseProducts({ channel: "retail", category: ids.root, inStock: "true", limit: 50 });
    expect(foundIds(stocked)).toEqual(expect.arrayContaining([ids.d1, ids.d2]));
    expect(foundIds(stocked)).not.toContain(ids.d3); // priced but 0 available
    const all = await catalog.browseProducts({ channel: "retail", category: ids.root, limit: 50 });
    expect(foundIds(all)).toContain(ids.d3);
  });

  it("sorts price_asc across the keyset with no dupes or skips", async () => {
    const seen: string[] = [];
    const prices: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await catalog.browseProducts({ channel: "retail", category: ids.root, sort: "price_asc", limit: 5, cursor });
      pages += 1;
      for (const row of page.results) {
        seen.push(row.id as string);
        prices.push(row.priceFrom as string);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && pages < 10);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(12);
    const numeric = prices.map(BigInt);
    expect([...numeric].sort((a, b) => (a < b ? -1 : 1))).toEqual(numeric);
    expect(seen).toEqual(expect.arrayContaining([ids.d1, ids.d2, ids.d3]));
  });

  it("sorts price_desc from the top and newest to termination", async () => {
    const desc = await catalog.browseProducts({ channel: "retail", category: ids.root, sort: "price_desc", limit: 50 });
    const prices = desc.results.map((row) => BigInt(row.priceFrom as string));
    expect([...prices].sort((a, b) => (a > b ? -1 : 1))).toEqual(prices);
    expect(desc.results[0].priceFrom).toBe("200000"); // d2 tops the fixture
    expect(desc.nextCursor).toBeNull();
    const fresh = await catalog.browseProducts({ channel: "retail", category: ids.root, limit: 5 });
    expect(fresh.nextCursor).not.toBeNull();
    const tail = await catalog.browseProducts({ channel: "retail", category: ids.root, limit: 50, cursor: fresh.nextCursor! });
    expect(tail.nextCursor).toBeNull();
    expect(new Set([...fresh.results, ...tail.results].map((row) => row.id)).size).toBe(fresh.results.length + tail.results.length);
  });

  it("refuses malformed cursors and cross-sort cursors", async () => {
    await expect(catalog.browseProducts({ channel: "retail", cursor: "!!!" })).rejects.toMatchObject({ code: "BROWSE_CURSOR_INVALID" });
    const page = await catalog.browseProducts({ channel: "retail", category: ids.root, sort: "price_asc", limit: 2 });
    await expect(catalog.browseProducts({ channel: "retail", sort: "newest", cursor: page.nextCursor! })).rejects.toMatchObject({
      code: "BROWSE_CURSOR_INVALID",
    });
  });

  it("counts facets over the sibling-filtered set, excluding the facet's own filter", async () => {
    const page = await catalog.browseProducts({ channel: "retail", brand: ids.brandOk, limit: 50 });
    // Brand facet ignores the brand filter: unbranded d3 is counted via its category.
    const catFacet = page.facets.categories.find((facet) => facet.id === ids.root)!;
    expect(catFacet.count).toBeGreaterThanOrEqual(1);
    // Category facet respects the brand filter: only branded products counted.
    const brandFacet = page.facets.brands;
    expect(brandFacet.find((facet) => facet.id === ids.brandOk)!.count).toBe(page.results.length);
    // NULL brand/category rows never appear in facets.
    expect(brandFacet.map((facet) => facet.id)).not.toContain(null);
  });

  it("details the dressed product: breadcrumb, active variants, channel offers, ordered media", async () => {
    const detail = await catalog.getProductDetail(ids.d1, "retail");
    expect(detail.breadcrumb).toEqual([
      { id: ids.root, name: "ظروف", slug: expect.any(String) },
      { id: ids.child, name: "ظروف مسی", slug: expect.any(String) },
      { id: ids.leaf, name: "کتری", slug: expect.any(String) },
    ]);
    expect((detail.variants as unknown[]).map((row: any) => row.id)).toEqual([ids.d1a]);
    expect((detail.offers as unknown[]).map((row: any) => row.price)).toEqual(["100000"]); // KOLBE retail only
    expect((detail.media as unknown[]).map((row: any) => row.url)).toEqual(["https://img.test/d1-a.jpg", "https://img.test/d1-b.jpg"]);
    expect(detail).toMatchObject({ priceFrom: "100000", priceCurrency: "IRR", availability: 7 });
    expect((detail.brand as any).id).toBe(ids.brandOk);
    const wholesale = await catalog.getProductDetail(ids.d1, "wholesale");
    expect((wholesale.offers as unknown[]).map((row: any) => row.price).sort()).toEqual(["70000", "80000"]);
    expect(wholesale.priceFrom).toBe("70000");
  });

  it("404s drafts identically to missing rows, over HTTP too", async () => {
    await expect(catalog.getProductDetail(ids.d6, "retail")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(catalog.getProductDetail("ghost", "retail")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    for (const id of [ids.d6, "ghost"]) {
      const res = await request(app.getHttpServer()).get(`/api/v1/catalog/products/${id}`).expect(404);
      expect(res.body.error).toBe("PRODUCT_NOT_FOUND");
    }
  });

  it("bumps the hit counter once per detail read, atomically under concurrency", async () => {
    const before = (await catalog.getProductDetail(ids.d2, "retail")).viewCount as number;
    await catalog.getProductDetail(ids.d2, "retail");
    await catalog.getProductDetail(ids.d2, "retail");
    const afterSerial = (await catalog.getProductDetail(ids.d2, "retail")).viewCount as number;
    expect(afterSerial).toBe(before + 3);
    await Promise.all(Array.from({ length: 10 }, () => catalog.getProductDetail(ids.d2, "retail")));
    const [row] = await db.select().from(schema.product).where(eq(schema.product.id, ids.d2));
    expect((row as any).viewCount).toBe(afterSerial + 10);
  });

  it("serves the active category tree without orphans, the dead, or the cycle", async () => {
    const tree = await catalog.listCategories();
    const root = tree.find((node) => node.id === ids.root) as any;
    expect(root.children.map((node: any) => node.id)).toEqual([ids.child]);
    expect(root.children[0].children.map((node: any) => node.id)).toEqual([ids.leaf]);
    const collect = (nodes: any[]): string[] => nodes.flatMap((node) => [node.id, ...collect(node.children)]);
    const all = collect(tree as any[]);
    expect(all).not.toContain(ids.dead);
    expect(all).not.toContain(ids.orphan);
    expect(all).not.toContain(ids.cycA);
    expect(all).not.toContain(ids.cycB);
  });

  it("lists only approved-active brands", async () => {
    const brands = await catalog.listBrands();
    expect(brands.map((row) => row.id)).toEqual([ids.brandOk]);
  });

  it("serves browse over public HTTP and fails cursors closed with 400", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/catalog/browse")
      .query({ channel: "retail", category: ids.leaf, sort: "price_asc", limit: 2 })
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(["facets", "nextCursor", "results"]);
    expect(res.body.results[0].id).toBe(ids.d1);
    const bad = await request(app.getHttpServer()).get("/api/v1/catalog/browse").query({ cursor: "!!!" }).expect(400);
    expect(bad.body.error).toBe("BROWSE_CURSOR_INVALID");
    // The A-surface cursor fix rides along: search cursors 400 too (was 500).
    const searchBad = await request(app.getHttpServer()).get("/api/v1/catalog/products").query({ q: "x", cursor: "!!!" }).expect(400);
    expect(searchBad.body.error).toBe("SEARCH_CURSOR_INVALID");
    await request(app.getHttpServer()).get("/api/v1/catalog/categories").expect(200);
    await request(app.getHttpServer()).get("/api/v1/catalog/brands").expect(200);
  });
});
