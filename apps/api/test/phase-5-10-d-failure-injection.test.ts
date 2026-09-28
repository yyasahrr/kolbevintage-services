import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { CatalogService } from "../src/modules/catalog/catalog.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RatingsService } from "../src/modules/ratings/ratings.service";

/**
 * Phase 5.10-D6 — failure injection over search/discovery/ratings.
 *
 * Proofs are historical (archived products stay reviewable, deleted
 * proof items don't take reviews down, products can't be deleted
 * under reviews); taxonomy mutations degrade honestly (dead
 * categories empty, suspended brands delist without hiding
 * products); unpublishing 404s without counting the view; and a
 * rating-sort walk under hide churn terminates with valid rows.
 * Real PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_d_failure_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;
let ratings: RatingsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510d_${Date.now()}_${seq++}`;

const users = {} as Record<string, string>;
const ids = {} as Record<string, string>;

const as = (name: string, role: string) => ({ actorId: users[name], actorRole: role });

async function wholesaleProof(buyer: string, productTag: string) {
  const accId = makeId("wacc");
  await db.insert(schema.wholesaleAccount).values({ id: accId, userId: users[buyer], memberName: "M", storeName: "S", phone: "09120000000", city: "تهران" });
  const orderId = makeId("word");
  await db.insert(schema.wholesaleOrder).values({
    id: orderId, orderCode: `WO-${seq}`, accountId: accId, buyerUserId: users[buyer], totalUnits: 1, version: 0, status: "completed",
  } as any);
  await db.insert(schema.wholesaleOrderItem).values({
    id: makeId("witem"), orderId, productId: ids[productTag], sellerId: ids.kolbe, productName: productTag, sku: `SKU-${productTag}`, quantity: 1,
  } as any);
  return orderId;
}

describe("Phase 5.10-D6 failure injection", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510d-failure";
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
    ratings = app.get(RatingsService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }

    const offers = app.get(OffersService);
    ids.kolbe = await offers.ensureSeller(null, "KOLBE");

    ids.cat = makeId("cat");
    await db.insert(schema.category).values({ id: ids.cat, name: "دسته", slug: `cat-${ids.cat}`, status: "active" });
    ids.brand = makeId("brand");
    await db.insert(schema.brand).values({ id: ids.brand, name: "برند", slug: `brand-${ids.brand}`, status: "active", verificationStatus: "approved" });

    const product = async (tag: string, extra: Record<string, unknown> = {}) => {
      ids[tag] = makeId(`prod_${tag}`);
      await db.insert(schema.product).values({ id: ids[tag], name: `کالای ${tag} نایاب`, slug: `r510d-${tag}-${ids[tag]}`, status: "published", ownerType: "KOLBE", categoryId: ids.cat, brandId: ids.brand, ...extra } as any);
      const vid = makeId(`var_${tag}`);
      ids[`${tag}v`] = vid;
      await db.insert(schema.productVariant).values({ id: vid, productId: ids[tag], sku: `SKU-${vid}`, status: "active", attributes: {} as any });
      await db.insert(schema.sellerOffer).values({
        id: makeId("offer"), productId: ids[tag], sellerId: ids.kolbe, variantId: vid,
        sku: `OFFER-${seq}`, status: "published", retailPrice: 100000n as any, wholesalePrice: 80000n as any, currency: "IRR",
      });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: vid, sellerId: ids.kolbe, onHand: 10, reserved: 0, status: "active" });
    };
    for (const tag of ["pArch", "pDel", "pCat", "pBrand", "pUnpub", "pHide1", "pHide2", "pHide3", "p8"]) {
      await product(tag);
    }
    for (const buyer of ["custA", "custB"]) {
      for (const tag of ["pArch", "pDel", "pCat", "pBrand", "pUnpub", "pHide1", "pHide2", "pHide3", "p8"]) {
        await wholesaleProof(buyer, tag);
      }
    }
    await ratings.fileReview(as("custB", "customer"), ids.pHide1, { rating: 5 });
    await ratings.fileReview(as("custB", "customer"), ids.pHide2, { rating: 4 });
    await ratings.fileReview(as("custB", "customer"), ids.pHide3, { rating: 3 });
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

  it("files on archived products: the proof is the order, not the status", async () => {
    await db.update(schema.product).set({ status: "archived" }).where(eq(schema.product.id, ids.pArch));
    const filed = await ratings.fileReview(as("custA", "customer"), ids.pArch, { rating: 5, review: "پیش از بایگانی خریدم" });
    expect(filed.status).toBe("visible");
    // …but the archived product leaves every public surface.
    expect((await catalog.browseProducts({ channel: "retail", limit: 50 })).results.map((row) => row.id)).not.toContain(ids.pArch);
    await expect(catalog.getProductDetail(ids.pArch, "retail")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("cannot delete a product under reviews: restrict fires, the review stands", async () => {
    const filed = await ratings.fileReview(as("custA", "customer"), ids.pDel, { rating: 5 });
    let code = "";
    try {
      await db.delete(schema.product).where(eq(schema.product.id, ids.pDel));
    } catch (error: any) {
      code = error?.cause?.code ?? error?.code ?? "";
    }
    expect(code).toBe("23503");
    const listed = await ratings.listReviews(ids.pDel, {});
    expect(listed.reviews.map((row) => row.id)).toContain(filed.id);
  });

  it("empties browse when the category dies, without touching siblings", async () => {
    await db.update(schema.category).set({ status: "archived" }).where(eq(schema.category.id, ids.cat));
    const page = await catalog.browseProducts({ channel: "retail", category: ids.cat, limit: 50 });
    expect(page.results).toHaveLength(0);
    expect(page.facets).toEqual({ categories: [], brands: [] });
    // Unfiltered browse is unaffected (products don't vanish, only the filter does).
    const all = await catalog.browseProducts({ channel: "retail", limit: 50 });
    expect(all.results.map((row) => row.id)).toContain(ids.pCat);
    await db.update(schema.category).set({ status: "active" }).where(eq(schema.category.id, ids.cat));
  });

  it("keeps products browsable when their brand suspends, while delisting the brand", async () => {
    await db.update(schema.brand).set({ status: "suspended" }).where(eq(schema.brand.id, ids.brand));
    const page = await catalog.browseProducts({ channel: "retail", brand: ids.brand, limit: 50 });
    expect(page.results.map((row) => row.id)).toContain(ids.pBrand);
    expect((await catalog.listBrands()).map((row) => row.id)).not.toContain(ids.brand);
    await db.update(schema.brand).set({ status: "active" }).where(eq(schema.brand.id, ids.brand));
  });

  it("404s unpublished detail without counting the view", async () => {
    const [before] = await db.select().from(schema.product).where(eq(schema.product.id, ids.pUnpub));
    await db.update(schema.product).set({ status: "draft" }).where(eq(schema.product.id, ids.pUnpub));
    await expect(catalog.getProductDetail(ids.pUnpub, "retail")).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    const [after] = await db.select().from(schema.product).where(eq(schema.product.id, ids.pUnpub));
    expect((after as any).viewCount).toBe((before as any).viewCount);
  });

  it("returns empty — never errors — when nothing is published", async () => {
    await db.update(schema.product).set({ status: "draft" });
    expect((await catalog.searchProducts("نایاب", "retail")).results).toHaveLength(0);
    const browse = await catalog.browseProducts({ channel: "retail", limit: 50 });
    expect(browse.results).toHaveLength(0);
    expect(browse.nextCursor).toBeNull();
    // Restore every fixture except the deliberately archived/drafted ones.
    for (const tag of ["pDel", "pCat", "pBrand", "pHide1", "pHide2", "pHide3", "p8"]) {
      await db.update(schema.product).set({ status: "published" }).where(eq(schema.product.id, ids[tag]));
    }
  });

  it("terminates a rating-sort walk under hide churn with valid rows", async () => {
    // pHide1/2/3 carry custB's 5/4/3; p8 is unrated. Walk limit-1; hide
    // the leader after the first page and keep walking.
    const first = await catalog.browseProducts({ channel: "retail", sort: "rating", limit: 1 });
    expect(first.results).toHaveLength(1);
    const leaderReviews = await ratings.listReviews(first.results[0].id as string, {});
    for (const row of leaderReviews.reviews) {
      await ratings.setReviewVisibility(as("admin", "admin"), row.id as string, false);
    }
    const seen: string[] = [first.results[0].id as string];
    let cursor = first.nextCursor ?? undefined;
    let pages = 1;
    while (cursor && pages < 10) {
      const chunk = await catalog.browseProducts({ channel: "retail", sort: "rating", limit: 1, cursor });
      if (!chunk.results.length) break;
      // Every row is well-formed and priced, even mid-churn.
      expect(typeof chunk.results[0].priceFrom).toBe("string");
      seen.push(chunk.results[0].id as string);
      cursor = chunk.nextCursor ?? undefined;
      pages += 1;
    }
    // Terminates (bounded pages) — keyset pagination assumes a stable
    // sort, so dupes across churned pages are possible and NOT asserted;
    // validity + termination are.
    expect(pages).toBeLessThan(10);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("survives proof-item deletion: old reviews stand, new filings refuse", async () => {
    const filed = await ratings.fileReview(as("custA", "customer"), ids.p8, { rating: 5 });
    // Both buyers' proof items vanish (data repair, not a flow).
    await db.delete(schema.wholesaleOrderItem).where(eq(schema.wholesaleOrderItem.productId, ids.p8));
    await expect(ratings.fileReview(as("custB", "customer"), ids.p8, { rating: 4 })).rejects.toMatchObject({ code: "REVIEW_NOT_VERIFIED" });
    // The stored proof is historical: the old review stands and aggregates.
    const listed = await ratings.listReviews(ids.p8, {});
    expect(listed.reviews.map((row) => row.id)).toContain(filed.id);
    expect(await ratings.getSummary(ids.p8)).toEqual({ average: 5, count: 1 });
  });
});
