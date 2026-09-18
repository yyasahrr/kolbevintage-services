import { execFileSync } from "node:child_process";
import path from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../packages/database/src/schema/tables";
import { hashAcceptedTerms } from "../src/modules/pricing/pricing.logic";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_orders_http_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let vipToken: string;
let userId: string;
let accountId: string;
let sellerId: string;
let prodId: string;
let varId: string;
let offerId: string;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

describe("POST /api/v1/wholesale/orders — HTTP contract", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-orders-http";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    const db = drizzle(pool, { schema: schema as any });

    // Create VIP user and token
    userId = makeId("user_http");
    const supId = makeId("sup_http");
    sellerId = makeId("seller_http");
    prodId = makeId("prod_http");
    varId = makeId("var_http");
    offerId = makeId("offer_http");
    accountId = makeId("acc_http");

    await db.insert(schema.accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    await db.insert(schema.supplier).values({ id: supId, legalName: "HTTP Sup", displayName: "HTTP Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "HTTP Seller", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "HTTP Product", slug: `http-${Date.now()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
    await db.insert(schema.sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 1000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any });
    await db.insert(schema.wholesaleAccount).values({ id: accountId, userId, memberName: "HTTP", storeName: "HTTP Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_http"), variantId: varId, sellerId, onHand: 100, reserved: 0, status: "active" });

    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    vipToken = verifier.issue(userId, "vip", 0);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("requires Idempotency-Key header → 400 ORDER_IDEMPOTENCY_KEY_REQUIRED", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/wholesale/orders")
      .set("authorization", `Bearer ${vipToken}`)
      .send({
        requests: [{ requestId: "dummy", expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
      })
      .expect(400);

    expect(response.body.error).toBe("ORDER_IDEMPOTENCY_KEY_REQUIRED");
  });

  it("creates order via HTTP with Idempotency-Key", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "1000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_http");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_http_${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/wholesale/orders")
      .set("authorization", `Bearer ${vipToken}`)
      .set("Idempotency-Key", idemKey)
      .send({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
      });
    console.log("CREATE RESPONSE", res.status, res.body);
    const response = res;
    expect(res.status).toBe(201);

    expect(response.body.order).toBeDefined();
    expect(response.body.order.id).toBeDefined();
    expect(response.body.order.orderCode).toMatch(/^KV-W-/);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.children).toHaveLength(1);
    expect(response.body.links).toHaveLength(1);

    // Replay with same key
    const replay = await request(app.getHttpServer())
      .post("/api/v1/wholesale/orders")
      .set("authorization", `Bearer ${vipToken}`)
      .set("Idempotency-Key", idemKey)
      .send({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
      })
      .expect(201);

    expect(replay.body.order.id).toBe(response.body.order.id);
    expect(replay.body.replayed).toBe(true);

    // GET /:id
    const get = await request(app.getHttpServer())
      .get(`/api/v1/wholesale/orders/${response.body.order.id}`)
      .set("authorization", `Bearer ${vipToken}`)
      .expect(200);

    expect(get.body.order.id).toBe(response.body.order.id);
  });

  it("GET /:id enforces ownership", async () => {
    const otherUserId = makeId("user_other");
    const db = drizzle(pool, { schema: schema as any });
    await db.insert(schema.accountUser).values({ id: otherUserId, email: `${otherUserId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    const otherToken = verifier.issue(otherUserId, "vip", 0);

    // Create order for first user
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "1000",
    };
    const reqId = makeId("wreq_own");
    const accId2 = makeId("acc_own");
    await db.insert(schema.wholesaleAccount).values({ id: accId2, userId: otherUserId, memberName: "Other", storeName: "Other Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accId2,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hashAcceptedTerms(snapshot as any),
      acceptedAt: new Date(),
      acceptedBy: otherUserId,
    });

    const idemKey = `idem_own_${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post("/api/v1/wholesale/orders")
      .set("authorization", `Bearer ${otherToken}`)
      .set("Idempotency-Key", idemKey)
      .send({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
      })
      .expect(201);

    // Try to get with first user's token → should fail with 403 ownership violation
    await request(app.getHttpServer())
      .get(`/api/v1/wholesale/orders/${created.body.order.id}`)
      .set("authorization", `Bearer ${vipToken}`)
      .expect(403);
  });
});
