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
 * Phase 5.11-D8 — ops-route security (Nest e2e).
 *
 * Full role matrix, guard-before-existence (no oracles), injection
 * inertness, hostile-cursor degradation (the D hardening), explicit
 * routes only (no transition smuggling), key validation, and
 * retail-only refund rows. Real PostgreSQL, full Nest application,
 * real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_d_security_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511d_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "vip" | "supplier" | "admin", string>;
const tokens = {} as Record<"custA" | "vip" | "supplier" | "admin" | "financeHat" | "garbage", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2 }],
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
    ...overrides,
  };
}

async function checkoutAs(tag: string, overrides: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    { ...(orderBody(overrides) as any), idempotencyKey: makeId("key") },
  );
  ids[tag] = created.id;
  totals[tag] = created.totals.grandTotal;
  return created;
}

async function payOrderGateway(tag: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(ids[tag], buyerA(), {
    rail: "manual_transfer",
    amount: totals[tag],
    evidenceReference: `BANK-${tag}`,
    idempotencyKey: makeId("ev"),
  });
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${tag}-VERIFY`,
    idempotencyKey: makeId("verify"),
  });
  expect(view.payment.status).toBe("paid");
  return view;
}

describe("Phase 5.11-D8 security", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await adminClient.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await adminClient.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511d-sec";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);

    for (const [name, role] of [["custA", "customer"], ["vip", "vip"], ["supplier", "supplier"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Phase 5.11-C (setup-only): this suite's staff actor is TOTP-enrolled;
    // the C-tranche gate refuses paid cancels for unenrolled staff.
    // Assertions unchanged.
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.vip = verifier.issue(users.vip, "vip", 0);
    tokens.supplier = verifier.issue(users.supplier, "supplier", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);
    tokens.financeHat = verifier.issue(users.admin, "finance", 0);
    tokens.garbage = "not-a-token";

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Security Product", slug: `sec-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
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

  it("enforces the full role matrix on ops writes", async () => {
    await checkoutAs("S1");
    await payOrderGateway("S1");
    const url = `/api/v1/admin/retail/orders/${ids.S1}/confirm`;
    for (const role of ["custA", "vip", "supplier"] as const) {
      await request(app.getHttpServer()).post(url).set("authorization", `Bearer ${tokens[role]}`).send({}).expect(403);
    }
    await request(app.getHttpServer()).post(url).send({}).expect(401);
    await request(app.getHttpServer()).post(url).set("authorization", `Bearer ${tokens.garbage}`).send({}).expect(401);
    await request(app.getHttpServer()).post(url).set("authorization", `Bearer ${tokens.financeHat}`).send({}).expect(401);
    const ok = await request(app.getHttpServer()).post(url).set("authorization", `Bearer ${tokens.admin}`).send({}).expect(200);
    expect(ok.body.status).toBe("confirmed");
  });

  it("checks the guard before existence: no oracles for non-staff", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/orders/ghost-order")
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/admin/retail/orders/ghost-order/confirm")
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(403);
    // Staff get the honest 404 for the same rows.
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/orders/ghost-order")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(404);
  });

  it("treats filter input as inert data, never code", async () => {
    await checkoutAs("S3");
    const injected = await request(app.getHttpServer())
      .get(`/api/v1/admin/retail/orders?status=${encodeURIComponent("' OR '1'='1")}`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(injected.body.orders).toEqual([]);
    const wildcard = await request(app.getHttpServer())
      .get("/api/v1/admin/retail/orders?orderCode=%25")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(wildcard.body.orders).toEqual([]);
    const customer = await request(app.getHttpServer())
      .get(`/api/v1/admin/retail/orders?customerId=${encodeURIComponent("x'; DROP TABLE retail_order; --")}`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(customer.body.orders).toEqual([]);
    // And the table obviously survives.
    const listed = await request(app.getHttpServer())
      .get("/api/v1/admin/retail/orders")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(listed.body.orders.length).toBeGreaterThan(0);
  });

  it("degrades hostile cursors to the first page (never 500)", async () => {
    await checkoutAs("S4");
    const hostile = Buffer.from(JSON.stringify({ createdAt: "not-a-date' OR '1'='1", id: "x' OR 1=1 --" })).toString("base64url");
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/retail/orders?cursor=${hostile}`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(res.body.orders.length).toBeGreaterThan(0);
    const rawJson = await request(app.getHttpServer())
      .get(`/api/v1/admin/retail/orders?cursor=${encodeURIComponent(JSON.stringify({ createdAt: "garbage", id: "y" }))}`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(rawJson.body.orders.length).toBeGreaterThan(0);
  });

  it("exposes explicit return routes only: transition/withdraw smuggling 404s", async () => {
    await checkoutAs("S5");
    await payOrderGateway("S5");
    await retailOrders.confirmRetailOrder(ids.S5, admin());
    await retailOrders.packRetailOrder(ids.S5, admin());
    const created = await retailOrders.createRetailShipment(ids.S5, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids.S5));
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S5}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: rows[0].id, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/transition`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ to: "WITHDRAWN" })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/withdraw`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(404);
  });

  it("requires the inspection decision over HTTP", async () => {
    await checkoutAs("S6");
    await payOrderGateway("S6");
    await retailOrders.confirmRetailOrder(ids.S6, admin());
    await retailOrders.packRetailOrder(ids.S6, admin());
    const created = await retailOrders.createRetailShipment(ids.S6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids.S6));
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S6}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: rows[0].id, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/approve`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/receive`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/inspect`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(400);
    expect(refused.body.error).toBe("RETAIL_RETURN_INSPECTION_REQUIRED");
  });

  it("rejects malformed idempotency keys with 400, never 500", async () => {
    await checkoutAs("S7");
    await payOrderGateway("S7");
    await retailOrders.cancelRetailOrder(ids.S7, admin());
    const control = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.S7}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ amount: totals.S7, idempotencyKey: "abcd" })
      .expect(400);
    expect(control.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_INVALID");
    const long = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.S7}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ amount: totals.S7, idempotencyKey: "k".repeat(129) })
      .expect(400);
    expect(long.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_INVALID");
  });

  it("shapes refund queue rows retail-only with string money", async () => {
    await checkoutAs("S8");
    await payOrderGateway("S8");
    await retailOrders.cancelRetailOrder(ids.S8, admin());
    const filed = await retailOrders.requestRetailRefund(ids.S8, admin(), { amount: totals.S8, idempotencyKey: makeId("req") });
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/retail/refunds")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    const row = res.body.refunds.find((r: any) => r.id === filed.refund.id);
    expect(row).toBeTruthy();
    expect(row.retailOrderId).toBe(ids.S8);
    expect(typeof row.amount).toBe("string");
    expect(row.amount).toBe(totals.S8);
    expect("wholesaleOrderId" in row).toBe(false);
    expect("childOrderId" in row).toBe(false);
  });
});
