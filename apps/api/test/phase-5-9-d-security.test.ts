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
import { RetailReturnsService } from "../src/modules/orders/retail/retail-returns.service";

/**
 * Phase 5.9-D8 — after-sales security (Nest e2e).
 *
 * Refunds are money acts: admin + finance may drive them, customers,
 * guests, anonymous callers and the system principal are refused; no
 * customer HTTP exists for refunds at all; return withdrawal stays
 * owner-only; staff may file for the owner and any staffer may advance
 * another's filing. Real PostgreSQL, full Nest application, real
 * domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_d_security_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let returns: RetailReturnsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r59d_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin" | "adminB" | "finOps", string>;
const tokens = {} as Record<"custA" | "custB" | "admin", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });
const adminB = () => ({ actorId: users.adminB, actorRole: "admin" });
const finance = () => ({ actorId: users.finOps, actorRole: "finance" });
const system = () => ({ actorId: null, actorRole: "system" });

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

async function driveToDelivered(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  return retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
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

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error: any) {
    expect(error?.code ?? error?.response?.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("Phase 5.9-D8 security", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59d-security";
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
    returns = app.get(RetailReturnsService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"], ["adminB", "admin"], ["finOps", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "admin"] as const) {
      tokens[name] = verifier.issue(users[name], name === "admin" ? "admin" : "customer", 0);
    }

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

  it("lets finance drive the full refund cycle (wholesale parity for money acts)", async () => {
    await checkoutAs("S1");
    await payOrderGateway("S1");
    await retailOrders.cancelRetailOrder(ids.S1, admin());
    const filed = await retailOrders.requestRetailRefund(ids.S1, finance(), { amount: totals.S1, idempotencyKey: makeId("req") });
    expect(filed.refund.status).toBe("requested");
    await retailOrders.approveRetailRefund(filed.refund.id, finance(), { idempotencyKey: makeId("appr") });
    const completed = await retailOrders.completeRetailRefund(filed.refund.id, finance(), {
      externalReference: `BANK-R59D-S1-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(completed.view.payment.refundPending).toBe(false);
  });

  it("refuses the system principal and null identities on every refund act", async () => {
    await checkoutAs("S2");
    await payOrderGateway("S2");
    await retailOrders.cancelRetailOrder(ids.S2, admin());
    await expectCode(retailOrders.requestRetailRefund(ids.S2, system(), { amount: totals.S2, idempotencyKey: makeId("req") }), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(
      retailOrders.requestRetailRefund(ids.S2, { actorId: null, actorRole: "admin" }, { amount: totals.S2, idempotencyKey: makeId("req") }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    const filed = await retailOrders.requestRetailRefund(ids.S2, admin(), { amount: totals.S2, idempotencyKey: makeId("req") });
    await expectCode(retailOrders.approveRetailRefund(filed.refund.id, system(), { idempotencyKey: makeId("appr") }), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, system(), { externalReference: "BANK-SYS", idempotencyKey: makeId("comp") }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    await expectCode(retailOrders.failRetailRefund(filed.refund.id, system(), { reason: "x", idempotencyKey: makeId("fail") }), "RETAIL_ORDER_FORBIDDEN");
    const [row] = await db.select().from(schema.refund).where(eq(schema.refund.id, filed.refund.id));
    expect((row as any).status).toBe("requested");
  });

  it("refuses customers on refund completion and failure (filing/approval were pinned in C)", async () => {
    await checkoutAs("S3");
    await payOrderGateway("S3");
    await retailOrders.cancelRetailOrder(ids.S3, admin());
    const filed = await retailOrders.requestRetailRefund(ids.S3, admin(), { amount: totals.S3, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    await expectCode(
      retailOrders.completeRetailRefund(filed.refund.id, buyerA() as any, { externalReference: "BANK-CUST", idempotencyKey: makeId("comp") }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    await expectCode(retailOrders.failRetailRefund(filed.refund.id, buyerA() as any, { reason: "x", idempotencyKey: makeId("fail") }), "RETAIL_ORDER_FORBIDDEN");
    const [row] = await db.select().from(schema.refund).where(eq(schema.refund.id, filed.refund.id));
    expect((row as any).status).toBe("approved");
  });

  it("exposes no customer HTTP for refunds", async () => {
    await checkoutAs("S4");
    await payOrderGateway("S4");
    await retailOrders.cancelRetailOrder(ids.S4, admin());
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S4}/refunds`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ amount: totals.S4 })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S4}/refunds`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send({ amount: totals.S4 })
      .expect(404);
  });

  it("keeps return withdrawal owner-only over HTTP with the row untouched", async () => {
    await checkoutAs("S5");
    await payOrderGateway("S5");
    await driveToDelivered("S5");
    const [lineId] = await orderItemIds("S5");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S5}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/returns/${filed.body.id}/withdraw`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer()).post(`/api/v1/customer/returns/${filed.body.id}/withdraw`).send({}).expect(401);
    const [row] = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.body.id));
    expect((row as any).status).toBe("REQUESTED");
    // The owner withdraws cleanly.
    await request(app.getHttpServer())
      .post(`/api/v1/customer/returns/${filed.body.id}/withdraw`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(201);
  });

  it("authenticates return filing: anonymous refused, foreign owner refused, staff may file for the owner", async () => {
    await checkoutAs("S6");
    await payOrderGateway("S6");
    await driveToDelivered("S6");
    const [lineId] = await orderItemIds("S6");
    const body = { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" };
    await request(app.getHttpServer()).post(`/api/v1/customer/orders/${ids.S6}/returns`).send(body).expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S6}/returns`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send(body)
      .expect(403);
    // The customer namespace is buyer-only: even admins are refused at HTTP.
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.S6}/returns`)
      .set("authorization", `Bearer ${tokens.admin}`)
      .send(body)
      .expect(403);
    // Staff filing lives at the service seam (back-office operators): the
    // request pins the order owner, not the staffer.
    const staffFiled = await returns.fileRetailReturn(admin(), ids.S6, body);
    const [row] = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, staffFiled.id));
    expect((row as any).customerId).toBe(users.custA);
  });

  it("treats staff identity as fungible on refunds: any staffer advances another's filing", async () => {
    await checkoutAs("S7");
    await payOrderGateway("S7");
    await retailOrders.cancelRetailOrder(ids.S7, admin());
    const filed = await retailOrders.requestRetailRefund(ids.S7, admin(), { amount: totals.S7, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, adminB(), { idempotencyKey: makeId("appr") });
    const completed = await retailOrders.completeRetailRefund(filed.refund.id, finance(), {
      externalReference: `BANK-R59D-S7-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    expect(completed.refund.status).toBe("completed");
  });

  it("rejects cross-order line ids on refund filing without an oracle", async () => {
    await checkoutAs("S8");
    await payOrderGateway("S8");
    await driveToDelivered("S8");
    await checkoutAs("S9");
    await payOrderGateway("S9");
    await driveToDelivered("S9");
    const [foreignLine] = await orderItemIds("S9");
    // A line id from another order is simply "not on this order" — the same
    // code as a malformed id, so ids cannot be probed across orders.
    await expectCode(
      retailOrders.requestRetailRefund(ids.S8, admin(), { amount: "1", lines: [{ retailOrderItemId: foreignLine, quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_LINE_UNKNOWN",
    );
    await expectCode(
      retailOrders.requestRetailRefund(ids.S8, admin(), { amount: "1", lines: [{ retailOrderItemId: "ghost-line", quantity: 1 }], idempotencyKey: makeId("req") }),
      "RETAIL_REFUND_LINE_UNKNOWN",
    );
  });
});
