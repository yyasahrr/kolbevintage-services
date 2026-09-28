import { createHash } from "node:crypto";
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
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.9-A — guest order capability (Nest e2e).
 *
 * Guest checkout mints a once-only capability token (hash-only storage);
 * GET /api/v1/customer/guest/orders/by-code/:orderCode resolves the order
 * by code but authenticates ONLY by the secret in `X-Retail-Order-Token`.
 * `orderCode + phone` alone authenticate nothing; legacy orders without a
 * hash fail closed with an honest recovery error.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_a_guest_capability_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p59a-guest-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_g59a_${Date.now()}_${seq++}`;
const ids = {} as Record<string, string>;
let guestToken = "";
let guestOrderCode = "";
let legacyOrderCode = "";

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "مهمان آزمون", phone: "09120000000", email: null },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1 }],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون",
      plaque: "۱",
      unit: "۲",
      postal: "1234567890",
      note: "",
    },
    shippingMethodId: "pishtaz",
    payMethod: "cod",
    ...overrides,
  };
}

const guestCheckout = (body: unknown, key: string) =>
  request(app.getHttpServer())
    .post("/api/v1/retail/orders")
    .set("Idempotency-Key", key)
    .set("x-kolbe-internal-token", INTERNAL_TOKEN)
    .send(body);

describe("Phase 5.9-A guest order capability", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59a-guest";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Guest Product", slug: `guest-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
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

  it("mints a once-only capability on guest checkout and stores hash-only", async () => {
    const key = makeId("key");
    const created = await guestCheckout(orderBody(), key).expect(201);
    expect(created.body.replayed).toBe(false);
    guestToken = created.body.guestCapability;
    guestOrderCode = created.body.orderCode;
    ids.guestOrder = created.body.id;
    expect(typeof guestToken).toBe("string");
    expect(guestToken.startsWith("rgc_")).toBe(true);

    // Replay of the same key re-emits nothing.
    const replayed = await guestCheckout(orderBody(), key).expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.guestCapability).toBeUndefined();

    // Storage holds the SHA-256 hash, never the secret; audit logs the
    // issuance fact, never the secret.
    const row = await pool.query("SELECT guest_capability_hash,guest_capability_issued_at,customer_id FROM retail_order WHERE id=$1", [ids.guestOrder]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].customer_id).toBeNull();
    expect(row.rows[0].guest_capability_hash).toBe(createHash("sha256").update(guestToken).digest("hex"));
    expect(row.rows[0].guest_capability_hash).not.toContain("rgc_");
    expect(row.rows[0].guest_capability_issued_at).not.toBeNull();
    const leaked = await pool.query("SELECT count(*) AS count FROM retail_order WHERE guest_capability_hash=$1", [guestToken]);
    expect(Number(leaked.rows[0].count)).toBe(0);

    const audit = await pool.query('SELECT "after" AS after_data FROM audit_log WHERE entity_id=$1 AND action=$2', [ids.guestOrder, "retail_order.created"]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after_data.guest_capability_issued).toBe(true);
    expect(JSON.stringify(audit.rows[0].after_data)).not.toContain(guestToken);
  });

  it("resolves the guest order by code + header secret with the owner-equivalent detail", async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${guestOrderCode}`)
      .set("x-retail-order-token", guestToken)
      .expect(200);
    expect(response.body).toMatchObject({ orderId: ids.guestOrder, orderCode: guestOrderCode });
    expect(response.body.order.totals).toEqual({ itemsTotal: "250000", promotionDiscountTotal: "0", shippingTotal: "0", grandTotal: "250000" }); // COD ships free
    expect(response.body.shipping.orderId).toBe(ids.guestOrder);
    expect(Array.isArray(response.body.shipping.shipments)).toBe(true);
    // The resolution never re-emits the secret.
    expect(JSON.stringify(response.body)).not.toContain(guestToken);
  });

  it("fails closed: missing/wrong secret, unknown code, legacy order", async () => {
    await request(app.getHttpServer()).get(`/api/v1/customer/guest/orders/by-code/${guestOrderCode}`).expect(401);
    const wrong = await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${guestOrderCode}`)
      .set("x-retail-order-token", "rgc_wrongsecretwrongsecret12")
      .expect(403);
    expect(wrong.body.error).toBe("RETAIL_GUEST_CAPABILITY_INVALID");
    await request(app.getHttpServer())
      .get("/api/v1/customer/guest/orders/by-code/RT-2026-XXXXXX")
      .set("x-retail-order-token", guestToken)
      .expect(404);

    // Legacy order: no capability hash (pre-5.9 row shape).
    legacyOrderCode = `RT-2026-LEGACY`;
    const [guestRow] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.guestOrder)).limit(1);
    await db.insert(schema.retailOrder).values({
      ...(guestRow as any),
      id: makeId("ro_legacy"),
      orderCode: legacyOrderCode,
      idempotencyKey: makeId("legacykey"),
      version: 0,
      guestCapabilityHash: null,
      guestCapabilityIssuedAt: null,
      guestCapabilityRevokedAt: null,
    });
    const legacy = await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${legacyOrderCode}`)
      .set("x-retail-order-token", guestToken)
      .expect(403);
    expect(legacy.body.error).toBe("RETAIL_GUEST_CAPABILITY_REQUIRED");
  });

  it("revokes the capability (staff seam): hash cleared, versioned, audited", async () => {
    const revoked = await retailOrders.revokeRetailGuestCapability(ids.guestOrder, { actorId: "admin_1", actorRole: "admin" });
    expect(revoked).toEqual({ revoked: true });
    const row = await pool.query("SELECT guest_capability_hash,guest_capability_revoked_at,version FROM retail_order WHERE id=$1", [ids.guestOrder]);
    expect(row.rows[0].guest_capability_hash).toBeNull();
    expect(row.rows[0].guest_capability_revoked_at).not.toBeNull();
    expect(Number(row.rows[0].version)).toBe(1);
    const audit = await pool.query("SELECT action FROM audit_log WHERE entity_id=$1 AND action='retail_order.guest_capability_revoked'", [ids.guestOrder]);
    expect(audit.rows).toHaveLength(1);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${guestOrderCode}`)
      .set("x-retail-order-token", guestToken)
      .expect(403);
    expect(after.body.error).toBe("RETAIL_GUEST_CAPABILITY_REVOKED");

    const again = await retailOrders.revokeRetailGuestCapability(ids.guestOrder, { actorId: "admin_1", actorRole: "admin" });
    expect(again).toEqual({ revoked: false });
    await expect(retailOrders.revokeRetailGuestCapability("ro_missing", { actorId: "admin_1", actorRole: "admin" })).rejects.toThrow();
  });
});
