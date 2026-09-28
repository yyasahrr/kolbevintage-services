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
 * Phase 5.11-B — after-sales ops over staff HTTP (Nest e2e).
 *
 * Refund file/approve/complete/fail, return approve→restock/reject,
 * and guest-capability revocation, all over the admin routes. Seams
 * stay the authority (tested in 5.9); here the routes, codes, replay
 * mapping, and guard narrowing are pinned. Real PostgreSQL, full
 * Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_b_aftersales_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p511b-internal-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511b_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin" | "financeHat", string>;
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

async function driveToDelivered(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  return retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
}

async function orderItemIds(tag: string): Promise<string[]> {
  const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids[tag]));
  return rows.map((row) => row.id);
}

const guestCheckout = (body: unknown, key: string) =>
  request(app.getHttpServer()).post("/api/v1/retail/orders").set("Idempotency-Key", key).set("x-kolbe-internal-token", INTERNAL_TOKEN).send(body);

describe("Phase 5.11-B after-sales ops", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511b-after";
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

    for (const [name, role] of [["custA", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Phase 5.11-C (setup-only): this suite's staff actor is TOTP-enrolled;
    // the C-tranche gate refuses paid cancels and refund terminal
    // transitions for unenrolled staff. Assertions unchanged.
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);
    tokens.financeHat = verifier.issue(users.admin, "finance", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "After Product", slug: `after-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("files refunds over HTTP: 201 new, 200 replay, customer/finance refused, key required", async () => {
    await checkoutAs("B1");
    await payOrderGateway("B1");
    await retailOrders.cancelRetailOrder(ids.B1, admin());
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B1}/refunds`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.B1 })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B1}/refunds`)
      .set("authorization", `Bearer ${tokens.financeHat}`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.B1 })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B1}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ amount: totals.B1 })
      .expect(400);
    expect(missing.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_REQUIRED");
    const key = makeId("req");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B1}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({ amount: totals.B1 })
      .expect(201);
    expect(filed.body.replayed).toBe(false);
    expect(filed.body.refund.status).toBe("requested");
    expect(filed.body.refund.amount).toBe(totals.B1);
    const replayed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B1}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", key)
      .send({ amount: totals.B1 })
      .expect(200);
    expect(replayed.body.replayed).toBe(true);
    expect(replayed.body.refund.id).toBe(filed.body.refund.id);
  });

  it("drives file-approve-complete over HTTP to a resolved refund", async () => {
    await checkoutAs("B2");
    await payOrderGateway("B2");
    await retailOrders.cancelRetailOrder(ids.B2, admin());
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B2}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.B2 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/approve`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("appr"))
      .send({})
      .expect(201);
    const completed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/complete`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("comp"))
      .send({ externalReference: `BANK-B2-${filed.body.refund.id.slice(-8)}` })
      .expect(201);
    expect(completed.body.refund.status).toBe("completed");
    expect(completed.body.view.payment.refundPending).toBe(false);
  });

  it("fails refunds over HTTP with completion refused after failure", async () => {
    await checkoutAs("B3");
    await payOrderGateway("B3");
    await retailOrders.cancelRetailOrder(ids.B3, admin());
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B3}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.B3 })
      .expect(201);
    const failed = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/fail`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("fail"))
      .send({ reason: "bank rejected the payout" })
      .expect(201);
    expect(failed.body.refund.status).toBe("failed");
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/complete`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("comp"))
      .send({ externalReference: `BANK-B3-${filed.body.refund.id.slice(-8)}` })
      .expect(409);
    expect(refused.body.error).toBe("INVALID_STATUS_TRANSITION");
  });

  it("drives a return approve-receive-inspect-restock over HTTP to returned", async () => {
    await checkoutAs("B4");
    await payOrderGateway("B4");
    await driveToDelivered("B4");
    const [lineId] = await orderItemIds("B4");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.B4}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
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
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/inspect`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ inspectionDecision: "RESTOCKABLE" })
      .expect(200);
    const restocked = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/restock`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(restocked.body.status).toBe("RESTOCKED");
    const order = await request(app.getHttpServer())
      .get(`/api/v1/retail/orders/${ids.B4}`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(200);
    expect(order.body.status).toBe("returned");
  });

  it("rejects returns over HTTP only with a reason", async () => {
    await checkoutAs("B5");
    await payOrderGateway("B5");
    await driveToDelivered("B5");
    const [lineId] = await orderItemIds("B5");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.B5}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/reject`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(400);
    expect(refused.body.error).toBe("RETAIL_RETURN_REJECT_REASON_REQUIRED");
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/reject`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ reason: "outside the return window" })
      .expect(200);
    expect(rejected.body.status).toBe("REJECTED");
  });

  it("exposes no staff withdraw route", async () => {
    await checkoutAs("B6");
    await payOrderGateway("B6");
    await driveToDelivered("B6");
    const [lineId] = await orderItemIds("B6");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.B6}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/withdraw`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(404);
  });

  it("revokes guest capability over HTTP with reads refused after", async () => {
    const created = await guestCheckout(orderBody({ payMethod: "cod" }), makeId("key")).expect(201);
    expect(created.body.guestCapability).toMatch(/^rgc_/);
    await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${created.body.orderCode}`)
      .set("x-retail-order-token", created.body.guestCapability)
      .expect(200);
    const revoked = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${created.body.id}/guest-capability/revoke`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(revoked.body.revoked).toBe(true);
    const refused = await request(app.getHttpServer())
      .get(`/api/v1/customer/guest/orders/by-code/${created.body.orderCode}`)
      .set("x-retail-order-token", created.body.guestCapability)
      .expect(403);
    expect(refused.body.error).toBe("RETAIL_GUEST_CAPABILITY_REVOKED");
    // Idempotent: nothing live left to revoke.
    const again = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${created.body.id}/guest-capability/revoke`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(again.body.revoked).toBe(false);
  });

  it("revokes nothing on customer orders (no hash, honest false)", async () => {
    await checkoutAs("B8");
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B8}/guest-capability/revoke`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({})
      .expect(200);
    expect(res.body.revoked).toBe(false);
  });

  it("rejects cross-order line ids on HTTP filing", async () => {
    await checkoutAs("B9");
    await payOrderGateway("B9");
    await driveToDelivered("B9");
    await checkoutAs("B10");
    await payOrderGateway("B10");
    await driveToDelivered("B10");
    const [foreignLine] = await orderItemIds("B10");
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/admin/retail/orders/${ids.B9}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: "1", lines: [{ retailOrderItemId: foreignLine, quantity: 1 }] })
      .expect(422);
    expect(refused.body.error).toBe("RETAIL_REFUND_LINE_UNKNOWN");
  });
});
