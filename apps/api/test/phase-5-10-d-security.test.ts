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
import { RatingsService } from "../src/modules/ratings/ratings.service";

/**
 * Phase 5.10-D8 — search/discovery/ratings security (Nest e2e).
 *
 * Cross-rater writes 404 (ids are not enumerable across raters);
 * staff, suppliers, and the system principal cannot file; anonymous
 * callers stop at the guard on every mutator; hidden reviews leave
 * no enumerable surface; sort/bound/cursor parameters degrade to
 * defaults instead of reaching SQL; and public review rows carry
 * no PII. Real PostgreSQL, full Nest application, real services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_d_security_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;
let ratings: RatingsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510d_${Date.now()}_${seq++}`;

const users = {} as Record<string, string>;
const tokens = {} as Record<string, string>;
const ids = {} as Record<string, string>;
const reviewIds = {} as Record<string, string>;

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
}

describe("Phase 5.10-D8 security", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510d-security";
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

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["supplier", "supplier"], ["admin", "admin"]] as const) {
      const userId = makeId("user"); // opaque on purpose: the PII test pins the product, not the fixture
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["supplier", "supplier"], ["admin", "admin"]] as const) {
      tokens[name] = verifier.issue(users[name], role as any, 0);
    }

    const offers = app.get(OffersService);
    ids.kolbe = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod_p1");
    await db.insert(schema.product).values({ id: ids.p1, name: "کالای امنیتی", slug: `r510d-sec-${ids.p1}`, status: "published", ownerType: "KOLBE" } as any);
    const vid = makeId("var_p1");
    await db.insert(schema.productVariant).values({ id: vid, productId: ids.p1, sku: `SKU-${vid}`, status: "active", attributes: {} as any });
    await db.insert(schema.sellerOffer).values({
      id: makeId("offer"), productId: ids.p1, sellerId: ids.kolbe, variantId: vid,
      sku: `OFFER-${seq}`, status: "published", retailPrice: 100000n as any, wholesalePrice: 80000n as any, currency: "IRR",
    });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: vid, sellerId: ids.kolbe, onHand: 10, reserved: 0, status: "active" });
    await wholesaleProof("custA", "p1");
    await wholesaleProof("custB", "p1");
    const filed = await ratings.fileReview(as("custA", "customer"), ids.p1, { rating: 5, review: "اصیل" });
    reviewIds.a1 = filed.id as string;
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

  it("404s cross-rater updates at the seam and over HTTP, leaving the row untouched", async () => {
    await expect(ratings.updateReview(as("custB", "customer"), reviewIds.a1, { rating: 1 })).rejects.toMatchObject({ code: "REVIEW_NOT_FOUND" });
    await request(app.getHttpServer())
      .patch(`/api/v1/catalog/reviews/${reviewIds.a1}`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({ rating: 1 })
      .expect(404);
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, reviewIds.a1));
    expect((row as any).rating).toBe(5);
    expect((row as any).review).toBe("اصیل");
  });

  it("refuses every non-buyer role on filing, including the system principal", async () => {
    for (const actor of [as("admin", "admin"), as("supplier", "supplier"), { actorId: users.custA, actorRole: "finance" }, { actorId: null, actorRole: "system" }]) {
      await expect(ratings.fileReview(actor, ids.p1, { rating: 5 })).rejects.toMatchObject({ code: "REVIEW_FORBIDDEN" });
    }
    // Null identity with a buyer role is still refused.
    await expect(ratings.fileReview({ actorId: null, actorRole: "customer" }, ids.p1, { rating: 5 })).rejects.toMatchObject({ code: "REVIEW_FORBIDDEN" });
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${ids.p1}/reviews`)
      .set("authorization", `Bearer ${tokens.supplier}`)
      .send({ rating: 5 })
      .expect(403);
  });

  it("stops anonymous callers at the guard on every review mutator", async () => {
    const server = app.getHttpServer();
    await request(server).post(`/api/v1/catalog/products/${ids.p1}/reviews`).send({ rating: 5 }).expect(401);
    await request(server).patch(`/api/v1/catalog/reviews/${reviewIds.a1}`).send({ rating: 1 }).expect(401);
    await request(server).post(`/api/v1/catalog/reviews/${reviewIds.a1}/flag`).send({}).expect(401);
    await request(server).post(`/api/v1/catalog/reviews/${reviewIds.a1}/hide`).send({}).expect(401);
    await request(server).post(`/api/v1/catalog/reviews/${reviewIds.a1}/show`).send({}).expect(401);
  });

  it("leaves hidden reviews no enumerable surface", async () => {
    await ratings.setReviewVisibility(as("admin", "admin"), reviewIds.a1, false);
    expect((await ratings.listReviews(ids.p1, {})).reviews).toHaveLength(0);
    expect(await ratings.getSummary(ids.p1)).toEqual({ average: null, count: 0 });
    // No direct-review route exists to bypass the list filter.
    await request(app.getHttpServer()).get(`/api/v1/catalog/reviews/${reviewIds.a1}`).expect(404);
    await ratings.setReviewVisibility(as("admin", "admin"), reviewIds.a1, true);
  });

  it("degrades hostile sort and bound parameters to safe defaults", async () => {
    const before = await db.select({ id: schema.product.id }).from(schema.product);
    const sorted = await catalog.browseProducts({ channel: "retail", sort: "price_asc; DROP TABLE product", limit: 50 });
    expect(sorted.results.map((row) => row.id)).toContain(ids.p1); // fell back to newest, still works
    const bounded = await catalog.browseProducts({ channel: "retail", minPrice: "0 OR 1=1", maxPrice: "99999999999999999999", limit: 50 });
    expect(bounded.results.map((row) => row.id)).toContain(ids.p1); // garbage ignored, over-max clamped
    const after = await db.select({ id: schema.product.id }).from(schema.product);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
  });

  it("fails tampered cursors closed on every keyset", async () => {
    const browse = await catalog.browseProducts({ channel: "retail", limit: 1 });
    const bad = `${browse.nextCursor ?? "e30"}!tampered`;
    await expect(catalog.browseProducts({ channel: "retail", cursor: bad })).rejects.toMatchObject({ code: "BROWSE_CURSOR_INVALID" });
    await expect(catalog.searchProducts("x", "retail", { cursor: "1' OR '1'='1" })).rejects.toMatchObject({ code: "SEARCH_CURSOR_INVALID" });
    await expect(ratings.listReviews(ids.p1, { cursor: bad })).rejects.toMatchObject({ code: "REVIEW_CURSOR_INVALID" });
    const res = await request(app.getHttpServer()).get("/api/v1/catalog/browse").query({ cursor: bad }).expect(400);
    expect(res.body.error).toBe("BROWSE_CURSOR_INVALID");
  });

  it("exposes no PII on public review rows", async () => {
    const listed = await ratings.listReviews(ids.p1, {});
    expect(listed.reviews).toHaveLength(1);
    expect(Object.keys(listed.reviews[0]).sort()).toEqual(
      ["createdAt", "id", "productId", "raterId", "rating", "review", "status", "updatedAt", "verifiedChannel"].sort(),
    );
    const serialized = JSON.stringify(listed.reviews[0]);
    expect(serialized).not.toContain("custA");
    expect(serialized).not.toContain("@test.com");
    expect(serialized).not.toContain("0912");
  });

  it("keeps customers out of moderation over HTTP", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/reviews/${reviewIds.a1}/hide`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/reviews/${reviewIds.a1}/show`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({})
      .expect(403);
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, reviewIds.a1));
    expect((row as any).status).toBe("visible");
  });
});
