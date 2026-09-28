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
import { OffersService } from "../src/modules/offers/offers.service";

/**
 * Phase 5.8-A — retail checkout adversarial surface (Nest e2e).
 *
 * Dual-auth boundaries (session customer/vip vs internal-token guest),
 * injection-shaped inputs, key-ownership rules, oversized payloads, and
 * revoked sessions. Real PostgreSQL, full Nest application.
 *
 * A24 coverage: 20, 21, 23, 35 (+ auth hardening around 22).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_retail_security_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-security-test-token";

let app: INestApplication;
let pool: Pool;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_s58_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "vip" | "admin" | "supplier", string>;
const tokens = {} as Record<"custA" | "custB" | "vip" | "admin" | "supplier", string>;
const ids = { product: "", variant: "" };

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "امنیتی آزمون", phone: "09129998877" },
    lines: [{ productId: ids.product, variantId: ids.variant, quantity: 1 }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون" },
    shippingMethodId: "post",
    payMethod: "cod",
    ...overrides,
  };
}

function postOrder(body: unknown, init: { token?: string; key?: string; internalToken?: string } = {}) {
  let req = request(app.getHttpServer()).post("/api/v1/retail/orders").set("Idempotency-Key", init.key ?? makeId("key"));
  if (init.token) req = req.set("authorization", `Bearer ${init.token}`);
  if (init.internalToken !== undefined) req = req.set("x-kolbe-internal-token", init.internalToken);
  return req.send(body);
}

describe("Phase 5.8-A retail security boundaries", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-retail-security";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    delete process.env.KOLBE_INTERNAL_API_TOKEN;

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    const db = drizzle(pool, { schema: schema as any });

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["vip", "vip"], ["admin", "admin"], ["supplier", "supplier"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "vip", "admin", "supplier"] as const) {
      tokens[name] = verifier.issue(users[name], name === "custA" || name === "custB" ? "customer" : name, 0);
    }

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.product = makeId("prod");
    await db.insert(schema.product).values({ id: ids.product, name: "Security Product", slug: `sec-${ids.product}`, ownerType: "KOLBE", status: "published" });
    ids.variant = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.variant, productId: ids.product, sku: `SKU-${ids.variant}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.product, sellerId: kolbeSellerId, variantId: ids.variant, sku: `OFFER-${ids.variant}`, status: "published", retailPrice: 100000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.variant, sellerId: kolbeSellerId, onHand: 500, reserved: 0, status: "active" });
  }, 180_000);

  afterAll(async () => {
    delete process.env.KOLBE_INTERNAL_API_TOKEN;
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

  it("rejects direct anonymous calls; an unconfigured proxy token fails closed (503)", async () => {
    // Server token unconfigured: any guest attempt fails closed, never anonymous.
    const anonUnconfigured = await postOrder(orderBody()).expect(503);
    expect(anonUnconfigured.body.error).toBe("RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED");
    const wrongUnconfigured = await postOrder(orderBody(), { internalToken: "nope" }).expect(503);
    expect(wrongUnconfigured.body.error).toBe("RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED");
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    try {
      const guest = await postOrder(orderBody(), { internalToken: INTERNAL_TOKEN }).expect(201);
      expect(guest.body.customer.phone).toBe("09129998877");
      const wrong = await postOrder(orderBody(), { internalToken: "wrong-token" }).expect(401);
      expect(wrong.body.error).toBe("UNAUTHORIZED");
      const anon = await postOrder(orderBody()).expect(401);
      expect(anon.body.error).toBe("UNAUTHORIZED");
    } finally {
      delete process.env.KOLBE_INTERNAL_API_TOKEN;
    }
  });

  it("allows customer/vip sessions and forbids admin/supplier sessions on POST", async () => {
    await postOrder(orderBody(), { token: tokens.custA }).expect(201);
    await postOrder(orderBody(), { token: tokens.vip }).expect(201);
    const asAdmin = await postOrder(orderBody(), { token: tokens.admin }).expect(403);
    expect(asAdmin.body.error).toBe("FORBIDDEN");
    const asSupplier = await postOrder(orderBody(), { token: tokens.supplier }).expect(403);
    expect(asSupplier.body.error).toBe("FORBIDDEN");
  });

  it("treats SQL-injection-shaped identifiers as inert data (stable 4xx, tables intact)", async () => {
    const evil = "x' OR '1'='1'; DROP TABLE retail_order; --";
    const badProduct = await postOrder(orderBody({ lines: [{ productId: evil, quantity: 1 }] }), { token: tokens.custA }).expect(404);
    expect(badProduct.body.error).toBe("RETAIL_PRODUCT_NOT_FOUND");
    const badCoupon = await postOrder(orderBody({ couponCodes: [evil] }), { token: tokens.custA });
    expect([400, 404]).toContain(badCoupon.status);
    const badName = await postOrder(orderBody({ customer: { name: evil, phone: "09120001122" } }), { token: tokens.custA }).expect(201);
    expect(badName.body.customer.name).toBe(evil.slice(0, 160));
    // Tables intact: a normal order still works and nothing was dropped.
    const db = drizzle(pool, { schema: schema as any });
    expect((await db.select().from(schema.retailOrder)).length).toBeGreaterThan(0);
    await postOrder(orderBody(), { token: tokens.custA }).expect(201);
  });

  it("binds keys to owners: customer keys reject guests and vice versa (409)", async () => {
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    try {
      const customerKey = makeId("own1");
      await postOrder(orderBody(), { token: tokens.custA, key: customerKey }).expect(201);
      // Same phone as the customer order, but a guest is a different owner.
      const guestReplay = await postOrder(orderBody(), { internalToken: INTERNAL_TOKEN, key: customerKey }).expect(409);
      expect(guestReplay.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
      const guestKey = makeId("own2");
      await postOrder(orderBody(), { internalToken: INTERNAL_TOKEN, key: guestKey }).expect(201);
      const customerReplay = await postOrder(orderBody(), { token: tokens.custA, key: guestKey }).expect(409);
      expect(customerReplay.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
    } finally {
      delete process.env.KOLBE_INTERNAL_API_TOKEN;
    }
  });

  it("binds guest replays to the same contact phone (409 on mismatch)", async () => {
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    try {
      const key = makeId("gphone");
      await postOrder(orderBody(), { internalToken: INTERNAL_TOKEN, key }).expect(201);
      const mismatch = await postOrder(orderBody({ customer: { name: "دیگری", phone: "09123334455" } }), { internalToken: INTERNAL_TOKEN, key }).expect(409);
      expect(mismatch.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
    } finally {
      delete process.env.KOLBE_INTERNAL_API_TOKEN;
    }
  });

  it("rejects malformed keys and oversized lists; truncates overlong text", async () => {
    const longKey = await postOrder(orderBody(), { token: tokens.custA, key: "k".repeat(129) }).expect(400);
    expect(longKey.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_INVALID");
    // Control characters cannot travel in a header (Node rejects them
    // client-side), so they arrive via the body fallback instead.
    const controlKey = await request(app.getHttpServer())
      .post("/api/v1/retail/orders")
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ ...orderBody(), idempotencyKey: "bad\x00key890" })
      .expect(400);
    expect(controlKey.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_INVALID");
    const manyCoupons = await postOrder(orderBody({ couponCodes: Array.from({ length: 21 }, (_, i) => `C${i}`) }), { token: tokens.custA }).expect(400);
    expect(manyCoupons.body.error).toBe("RETAIL_COUPON_CODE_INVALID");
    const longName = await postOrder(orderBody({ customer: { name: "ن".repeat(500), phone: "09120001122" } }), { token: tokens.custA }).expect(201);
    expect(longName.body.customer.name).toHaveLength(160);
  });

  it("rejects suspended accounts and stale token versions", async () => {
    const db = drizzle(pool, { schema: schema as any });
    await db.update(schema.accountUser).set({ status: "suspended" }).where(eq(schema.accountUser.id, users.custB));
    try {
      const suspended = await postOrder(orderBody(), { token: tokens.custB }).expect(403);
      expect(suspended.body.error).toBe("ACCOUNT_SUSPENDED");
    } finally {
      await db.update(schema.accountUser).set({ status: "active" }).where(eq(schema.accountUser.id, users.custB));
    }
    await db.update(schema.accountUser).set({ tokenVersion: 3 }).where(eq(schema.accountUser.id, users.custB));
    try {
      await postOrder(orderBody(), { token: tokens.custB }).expect(401);
    } finally {
      await db.update(schema.accountUser).set({ tokenVersion: 0 }).where(eq(schema.accountUser.id, users.custB));
    }
    await postOrder(orderBody(), { token: tokens.custB }).expect(201);
  });

  it("answers unknown GET ids with 404, never 500", async () => {
    for (const weird of ["rord_missing", "null", "undefined", "..%2F..%2Fx", "x".repeat(200)]) {
      const response = await request(app.getHttpServer()).get(`/api/v1/retail/orders/${weird}`).set("authorization", `Bearer ${tokens.custA}`).expect(404);
      expect(response.body.error).toBe("RETAIL_ORDER_NOT_FOUND");
    }
  });
});
