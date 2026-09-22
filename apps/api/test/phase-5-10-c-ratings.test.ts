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
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { RatingsService } from "../src/modules/ratings/ratings.service";

/**
 * Phase 5.10-C — verified-purchase product reviews (Nest e2e).
 *
 * A review exists iff its rater owns a delivered retail order or a
 * completed wholesale order containing the product, and the proving
 * order id is stored on the row. Staff cannot file; strangers
 * cannot update; flags queue for staff without taking down;
 * hides leave the public surfaces and the audit trail. Real
 * PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_10_c_ratings_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let catalog: CatalogService;
let retailOrders: RetailOrdersService;
let ratings: RatingsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r510c_${Date.now()}_${seq++}`;

const users = {} as Record<string, string>;
const tokens = {} as Record<"custA" | "custD" | "admin", string>;
const ids = {} as Record<string, string>;
const reviewIds = {} as Record<string, string>;
const delivered = {} as Record<string, string>;

const as = (name: string, role: string) => ({ actorId: users[name], actorRole: role });
const buyerA = () => as("custA", "customer");
const admin = () => as("admin", "admin");

function orderBody(productId: string, variantId: string) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId, variantId, quantity: 1 }],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون، پلاک ۱",
      plaque: "۱",
      unit: "۲",
      postal: "1234567890",
      note: "",
    },
    shippingMethodId: "pishtaz",
    payMethod: "gateway",
    idempotencyKey: makeId("key"),
  };
}

async function buyAndDeliver(buyer: string, productTag: string, variantTag: string, orderTag: string, stopBeforeDelivery = false) {
  const created = await retailOrders.createRetailOrder({ kind: "customer", userId: users[buyer] }, orderBody(ids[productTag], ids[variantTag]) as any);
  ids[orderTag] = created.id;
  const { payment } = await retailOrders.submitPaymentEvidence(
    created.id,
    { actorId: users[buyer], actorRole: "customer" },
    { rail: "manual_transfer", amount: created.totals.grandTotal, evidenceReference: `BANK-${orderTag}`, idempotencyKey: makeId("ev") },
  );
  await retailOrders.verifyPayment(payment.id, admin(), { externalReference: `BANK-${orderTag}-V`, idempotencyKey: makeId("verify") });
  await retailOrders.confirmRetailOrder(created.id, admin());
  if (stopBeforeDelivery) return created.id;
  await retailOrders.packRetailOrder(created.id, admin());
  const shipment = await retailOrders.createRetailShipment(created.id, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(shipment.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  await retailOrders.recordRetailManualTracking(shipment.shipment.id, admin(), { state: "delivered" });
  delivered[orderTag] = created.id;
  return created.id;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error: any) {
    expect(error?.code ?? error?.response?.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("Phase 5.10-C ratings", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p510c-ratings";
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
    retailOrders = app.get(RetailOrdersService);
    ratings = app.get(RatingsService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["custC", "customer"], ["custD", "customer"], ["vipV", "vip"], ["wbuyer", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    for (let n = 1; n <= 5; n++) {
      const userId = makeId(`user_wr${n}`);
      users[`wr${n}`] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer", status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.custD = verifier.issue(users.custD, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);

    const offers = app.get(OffersService);
    const kolbeSeller = await offers.ensureSeller(null, "KOLBE");
    for (const tag of ["p1", "p2", "p3"]) {
      ids[tag] = makeId(`prod_${tag}`);
      await db.insert(schema.product).values({ id: ids[tag], name: `کالای ${tag}`, slug: `r510c-${tag}-${ids[tag]}`, status: "published", ownerType: "KOLBE" });
      ids[`${tag}v`] = makeId(`var_${tag}`);
      await db.insert(schema.productVariant).values({ id: ids[`${tag}v`], productId: ids[tag], sku: `SKU-${ids[`${tag}v`]}`, status: "active", attributes: {} as any });
      await db.insert(schema.sellerOffer).values({
        id: makeId("offer"), productId: ids[tag], sellerId: kolbeSeller, variantId: ids[`${tag}v`],
        sku: `OFFER-${seq}`, status: "published", retailPrice: 100000n as any, wholesalePrice: 80000n as any, currency: "IRR",
      });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids[`${tag}v`], sellerId: kolbeSeller, onHand: 50, reserved: 0, status: "active" });
    }

    // Retail proofs through the real order flow.
    await buyAndDeliver("custA", "p1", "p1v", "oA1");
    await buyAndDeliver("vipV", "p1", "p1v", "oV1");
    await buyAndDeliver("custB", "p2", "p2v", "oB2");
    await buyAndDeliver("custC", "p1", "p1v", "oC1", true); // paid, never delivered
    await buyAndDeliver("custD", "p1", "p1v", "oD1"); // files only via HTTP

    // Wholesale proofs as direct rows (fixtures for the proof read, not the wholesale machine).
    for (const buyer of ["wbuyer", "wr1", "wr2", "wr3", "wr4", "wr5"]) {
      const accId = makeId("wacc");
      await db.insert(schema.wholesaleAccount).values({ id: accId, userId: users[buyer], memberName: "M", storeName: "S", phone: "09120000000", city: "تهران" });
      const orderId = makeId("word");
      await db.insert(schema.wholesaleOrder).values({
        id: orderId, orderCode: `WO-${seq}`, accountId: accId, buyerUserId: users[buyer],
        totalUnits: 1, version: 0, status: "completed",
      } as any);
      await db.insert(schema.wholesaleOrderItem).values({
        id: makeId("witem"), orderId, productId: ids.p2, sellerId: kolbeSeller, productName: "p2", sku: "SKU-P2", quantity: 1,
      } as any);
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

  it("files a retail-verified review with the proving order stored", async () => {
    const filed = await ratings.fileReview(buyerA(), ids.p1, { rating: 5, review: "بسیار عالی" });
    reviewIds.a1 = filed.id as string;
    expect(filed).toMatchObject({ productId: ids.p1, raterId: users.custA, rating: 5, review: "بسیار عالی", status: "visible", verifiedChannel: "retail" });
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, reviewIds.a1));
    expect((row as any).verifiedRetailOrderId).toBe(delivered.oA1);
    expect((row as any).verifiedWholesaleOrderId).toBeNull();
  });

  it("files a wholesale-verified review and a rating-only VIP review", async () => {
    const filed = await ratings.fileReview(as("wbuyer", "customer"), ids.p2, { rating: 4, review: "خوب" });
    reviewIds.w2 = filed.id as string;
    expect(filed.verifiedChannel).toBe("wholesale");
    const [row] = await db.select().from(schema.productRating).where(eq(schema.productRating.id, reviewIds.w2));
    expect((row as any).verifiedRetailOrderId).toBeNull();
    expect((row as any).verifiedWholesaleOrderId).not.toBeNull();
    const vip = await ratings.fileReview(as("vipV", "vip"), ids.p1, { rating: 4 });
    reviewIds.v1 = vip.id as string;
    expect(vip.review).toBeNull();
  });

  it("refuses the unverified: undelivered, foreign product, and stranger — persisting nothing", async () => {
    const before = await db.select({ id: schema.productRating.id }).from(schema.productRating);
    await expectCode(ratings.fileReview(as("custC", "customer"), ids.p1, { rating: 5 }), "REVIEW_NOT_VERIFIED"); // paid, not delivered
    await expectCode(ratings.fileReview(as("custC", "customer"), ids.p2, { rating: 5 }), "REVIEW_NOT_VERIFIED"); // stranger
    await expectCode(ratings.fileReview(buyerA(), ids.p2, { rating: 5 }), "REVIEW_NOT_VERIFIED"); // bought p1, not p2
    const after = await db.select({ id: schema.productRating.id }).from(schema.productRating);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
  });

  it("refuses staff filing, bad ratings, and ghost products", async () => {
    await expectCode(ratings.fileReview(admin(), ids.p1, { rating: 5 }), "REVIEW_FORBIDDEN");
    await expectCode(ratings.fileReview({ actorId: null, actorRole: "system" }, ids.p1, { rating: 5 }), "REVIEW_FORBIDDEN");
    for (const rating of [0, 6, 2.5, "5", null]) {
      await expectCode(ratings.fileReview(buyerA(), ids.p1, { rating }), "REVIEW_RATING_INVALID");
    }
    await expectCode(ratings.fileReview(buyerA(), "ghost", { rating: 5 }), "PRODUCT_NOT_FOUND");
  });

  it("allows one review per rater per product, updated by its owner alone", async () => {
    await expectCode(ratings.fileReview(buyerA(), ids.p1, { rating: 1, review: "second" }), "REVIEW_ALREADY_EXISTS");
    const updated = await ratings.updateReview(buyerA(), reviewIds.a1, { rating: 4, review: "خوب بود" });
    expect(updated).toMatchObject({ rating: 4, review: "خوب بود", status: "visible", verifiedChannel: "retail" });
    await expectCode(ratings.updateReview(as("custB", "customer"), reviewIds.a1, { rating: 1 }), "REVIEW_NOT_FOUND");
    await expectCode(ratings.updateReview(buyerA(), "ghost", { rating: 1 }), "REVIEW_NOT_FOUND");
  });

  it("flags for the staff queue without taking down; own flags refused", async () => {
    const flagged = await ratings.flagReview(as("custB", "customer"), reviewIds.a1);
    expect(flagged.status).toBe("flagged");
    const listed = await ratings.listReviews(ids.p1, {});
    expect(listed.reviews.map((row) => row.id)).toContain(reviewIds.a1); // flags don't censor
    await expectCode(ratings.flagReview(buyerA(), reviewIds.a1), "REVIEW_FLAG_OWN");
    const again = await ratings.flagReview(as("custB", "customer"), reviewIds.a1);
    expect(again.status).toBe("flagged"); // idempotent
  });

  it("hides and shows under admin with an audit trail, idempotently", async () => {
    await expectCode(ratings.setReviewVisibility(buyerA(), reviewIds.a1, false), "REVIEW_FORBIDDEN");
    const hidden = await ratings.setReviewVisibility(admin(), reviewIds.a1, false);
    expect(hidden.status).toBe("hidden");
    const listed = await ratings.listReviews(ids.p1, {});
    expect(listed.reviews.map((row) => row.id)).not.toContain(reviewIds.a1);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, reviewIds.a1));
    expect(audits.map((row: any) => row.action)).toEqual(["product_review.hidden"]);
    await ratings.setReviewVisibility(admin(), reviewIds.a1, false); // idempotent: no second row
    const auditsAfter = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, reviewIds.a1));
    expect(auditsAfter).toHaveLength(1);
    const shown = await ratings.setReviewVisibility(admin(), reviewIds.a1, true);
    expect(shown.status).toBe("visible");
  });

  it("summarizes visible + flagged, excluding hidden", async () => {
    // p1: custA 4 (visible again) + vipV 4 → 4.0 × 2.
    expect(await ratings.getSummary(ids.p1)).toEqual({ average: 4, count: 2 });
    await ratings.setReviewVisibility(admin(), reviewIds.v1, false);
    expect(await ratings.getSummary(ids.p1)).toEqual({ average: 4, count: 1 });
    await ratings.setReviewVisibility(admin(), reviewIds.v1, true);
    // Flagged still aggregates (queue, not takedown).
    await ratings.flagReview(as("custB", "customer"), reviewIds.v1);
    expect(await ratings.getSummary(ids.p1)).toEqual({ average: 4, count: 2 });
    expect(await ratings.getSummary(ids.p3)).toEqual({ average: null, count: 0 });
  });

  it("walks the review keyset with no dupes or skips", async () => {
    for (const [n, buyer] of ["wr1", "wr2", "wr3", "wr4", "wr5"].entries()) {
      await ratings.fileReview(as(buyer, "customer"), ids.p2, { rating: (n % 5) + 1, review: `نظر ${n}` });
    }
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await ratings.listReviews(ids.p2, { limit: 2, cursor });
      pages += 1;
      for (const row of page.reviews) seen.push(row.id as string);
      cursor = page.nextCursor ?? undefined;
    } while (cursor && pages < 10);
    expect(pages).toBe(3); // wbuyer + 5 = 6 → 2 + 2 + 2
    expect(new Set(seen).size).toBe(6);
    // Cross-product isolation: p2's walk never surfaces p1's reviews.
    expect(seen).not.toContain(reviewIds.a1);
  });

  it("embeds the rating block in detail and the card in browse", async () => {
    const detail = await catalog.getProductDetail(ids.p1, "retail");
    expect(detail.rating).toEqual({ average: 4, count: 2 });
    const bare = await catalog.getProductDetail(ids.p3, "retail");
    expect(bare.rating).toEqual({ average: null, count: 0 });
    const page = await catalog.browseProducts({ channel: "retail", sort: "rating", limit: 50 });
    const card = page.results.find((row) => row.id === ids.p1)!;
    expect(card).toMatchObject({ ratingAverage: 4, ratingCount: 2 });
  });

  it("sorts browse by rating with the unrated sunk, across the keyset", async () => {
    const page = await catalog.browseProducts({ channel: "retail", sort: "rating", limit: 50 });
    const order = page.results.map((row) => row.id as string);
    // p1 avg 4.0 > p2 avg (4+1+2+3+4+5+5)/7 ≈ 3.43 > unrated p3.
    expect(order).toEqual([ids.p1, ids.p2, ids.p3]);
    const walk: string[] = [];
    let cursor: string | null | undefined;
    do {
      const chunk = await catalog.browseProducts({ channel: "retail", sort: "rating", limit: 1, cursor });
      walk.push(chunk.results[0].id as string);
      cursor = chunk.nextCursor ?? undefined;
    } while (cursor);
    expect(walk).toEqual(order);
  });

  it("sanitizes markup and caps length at 2000", async () => {
    const filed = await ratings.fileReview(as("custB", "customer"), ids.p2, { rating: 5, review: `<script>alert(1)</script>${"x".repeat(2500)}` });
    expect(filed.review as string).not.toContain("<");
    expect((filed.review as string).length).toBe(2000);
  });

  it("enforces the HTTP RBAC matrix on reviews", async () => {
    await request(app.getHttpServer()).post(`/api/v1/catalog/products/${ids.p1}/reviews`).send({ rating: 5 }).expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${ids.p1}/reviews`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ rating: 5 })
      .expect(403);
    // custD bought p1 and files only here: a real 201 over HTTP.
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${ids.p1}/reviews`)
      .set("authorization", `Bearer ${tokens.custD}`)
      .send({ rating: 4, review: "از طریق وب" })
      .expect(201);
    expect(filed.body).toMatchObject({ productId: ids.p1, rating: 4, status: "visible", verifiedChannel: "retail" });
    // custA never bought p2 → honest 403 with the code in the body.
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/catalog/products/${ids.p2}/reviews`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ rating: 5 })
      .expect(403);
    expect(refused.body.error).toBe("REVIEW_NOT_VERIFIED");
    await request(app.getHttpServer()).get(`/api/v1/catalog/products/${ids.p1}/reviews`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/catalog/products/${ids.p1}/reviews/summary`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/catalog/reviews/${reviewIds.a1}/hide`).set("authorization", `Bearer ${tokens.admin}`).send({}).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/catalog/reviews/${reviewIds.a1}/show`).set("authorization", `Bearer ${tokens.admin}`).send({}).expect(201);
  });
});
