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
 * Phase 5.11-D6 — ops-route failure injection (Nest e2e).
 *
 * Every honest refusal the seams make must cross HTTP with its code
 * and status intact: replay convergence, key conflicts, idempotent
 * recancel, machine refusals, unpaid-refund and out-of-order-return
 * refusals, missing rows, and completion ordering. Real PostgreSQL,
 * full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_d_failure_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511d_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin", string>;
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

async function orderItemIds(tag: string): Promise<string[]> {
  const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids[tag]));
  return rows.map((row) => row.id);
}

const post = (url: string) => request(app.getHttpServer()).post(url).set("authorization", `Bearer ${tokens.admin}`);

describe("Phase 5.11-D6 failure injection", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511d-failure";
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

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Failure Product", slug: `fail-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("converges double verify on different keys: 201 then 200 replayed", async () => {
    await checkoutAs("F1");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.F1, buyerA(), {
      rail: "manual_transfer",
      amount: totals.F1,
      evidenceReference: "BANK-F1",
      idempotencyKey: makeId("ev"),
    });
    const first = await post(`/api/v1/admin/retail/payments/${payment.id}/verify`)
      .set("idempotency-key", makeId("verify"))
      .send({ externalReference: "BANK-F1-VERIFY" })
      .expect(201);
    expect(first.body.replayed).toBe(false);
    const second = await post(`/api/v1/admin/retail/payments/${payment.id}/verify`)
      .set("idempotency-key", makeId("verify"))
      .send({ externalReference: "BANK-F1-VERIFY" })
      .expect(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.view.payment.status).toBe("paid");
  });

  it("refuses same-key different-request shipment with 409 conflict", async () => {
    await checkoutAs("F2");
    await payOrderGateway("F2");
    await post(`/api/v1/admin/retail/orders/${ids.F2}/confirm`).send({}).expect(200);
    await post(`/api/v1/admin/retail/orders/${ids.F2}/pack`).send({}).expect(200);
    const key = makeId("ship");
    await post(`/api/v1/admin/retail/orders/${ids.F2}/shipments`)
      .set("idempotency-key", key)
      .send({ providerName: "manual" })
      .expect(201);
    const [lineId] = await orderItemIds("F2");
    const conflict = await post(`/api/v1/admin/retail/orders/${ids.F2}/shipments`)
      .set("idempotency-key", key)
      .send({ providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] })
      .expect(409);
    expect(conflict.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
  });

  it("recancels idempotently over HTTP", async () => {
    await checkoutAs("F3");
    await payOrderGateway("F3");
    const first = await post(`/api/v1/admin/retail/orders/${ids.F3}/cancel`).send({}).expect(200);
    expect(first.body.status).toBe("cancelled");
    const second = await post(`/api/v1/admin/retail/orders/${ids.F3}/cancel`).send({}).expect(200);
    expect(second.body.status).toBe("cancelled");
    expect(second.body.payment.refundPending).toBe(true);
  });

  it("refuses confirm-after-cancel with the machine code", async () => {
    await checkoutAs("F4");
    await payOrderGateway("F4");
    await post(`/api/v1/admin/retail/orders/${ids.F4}/cancel`).send({}).expect(200);
    const refused = await post(`/api/v1/admin/retail/orders/${ids.F4}/confirm`).send({}).expect(400);
    expect(refused.body.error).toBe("RETAIL_TRANSITION_INVALID");
  });

  it("refuses refund filing on unpaid orders", async () => {
    await checkoutAs("F5");
    const refused = await post(`/api/v1/admin/retail/orders/${ids.F5}/refunds`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.F5 })
      .expect(422);
    expect(refused.body.error).toBe("RETAIL_REFUND_UNPAID");
  });

  it("refuses out-of-order return transitions", async () => {
    await checkoutAs("F6");
    await payOrderGateway("F6");
    await retailOrders.confirmRetailOrder(ids.F6, admin());
    await retailOrders.packRetailOrder(ids.F6, admin());
    const created = await retailOrders.createRetailShipment(ids.F6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    const [lineId] = await orderItemIds("F6");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.F6}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    const refused = await post(`/api/v1/admin/retail/returns/${filed.body.id}/receive`).send({}).expect(400);
    expect(refused.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");
  });

  it("404s revocation on missing orders", async () => {
    const res = await post("/api/v1/admin/retail/orders/ghost-order/guest-capability/revoke").send({}).expect(404);
    expect(res.body.error).toBe("RETAIL_ORDER_NOT_FOUND");
  });

  it("refuses completion before approval", async () => {
    await checkoutAs("F8");
    await payOrderGateway("F8");
    await retailOrders.cancelRetailOrder(ids.F8, admin());
    const filed = await post(`/api/v1/admin/retail/orders/${ids.F8}/refunds`)
      .set("idempotency-key", makeId("req"))
      .send({ amount: totals.F8 })
      .expect(201);
    const refused = await post(`/api/v1/admin/retail/refunds/${filed.body.refund.id}/complete`)
      .set("idempotency-key", makeId("comp"))
      .send({ externalReference: `BANK-F8-${filed.body.refund.id.slice(-8)}` })
      .expect(409);
    expect(refused.body.error).toBe("INVALID_STATUS_TRANSITION");
  });
});
