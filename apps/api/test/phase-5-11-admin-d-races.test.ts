import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.11-D — race hardening the C-tranche did not add: refund
 * approve-vs-complete, double return receive, double paid cancel, and
 * double return restock. Every race must converge with no 500s, exactly
 * one winner-side effect, honest losers, and non-negative inventory.
 * (Flag/clear races are T7 of the C suite; approve+fail and
 * approve+reject races live in the 5.9-D / 5.11-D concurrency suites.)
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_admin_d_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: any;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511ad_${Date.now()}_${seq++}`;
const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(productId: string, variantId: string, quantity = 2, extra: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId, variantId, quantity }],
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
    ...extra,
  };
}

async function checkoutAs(orderTag: string, quantity = 2) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    orderBody(ids.p1, ids.p1v, quantity) as any,
  );
  ids[orderTag] = created.id;
  totals[orderTag] = created.totals.grandTotal;
  return created;
}

async function payOrderGateway(orderTag: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(
    ids[orderTag],
    { actorId: users.custA, actorRole: "customer" },
    { rail: "manual_transfer", amount: totals[orderTag], evidenceReference: `BANK-${orderTag}`, idempotencyKey: makeId("ev") },
  );
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${orderTag}-VERIFY`,
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
  return rows.map((row: any) => row.id);
}

async function onHand(): Promise<number> {
  const rows = await db.select().from(schema.productVariantInventory).where(eq(schema.productVariantInventory.variantId, ids.p1v));
  return Number((rows[0] as any).onHand);
}

const post = (url: string, token: string, body: unknown = {}) =>
  request(app.getHttpServer()).post(url).set("authorization", `Bearer ${token}`).send(body as any);

describe("Phase 5.11-D race hardening", () => {
  beforeAll(async () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511d-race";
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
    // The race driver is TOTP-enrolled (paid cancels + refund terminals).
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Race Product", slug: `race-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.p1v = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.p1v, productId: ids.p1, sku: `SKU-${ids.p1v}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.p1v, sku: `OFFER-${ids.p1v}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.p1v, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
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

  it("R1 converges racing refund approve + complete: money moves exactly once", async () => {
    await checkoutAs("R1");
    await payOrderGateway("R1");
    await post(`/api/v1/customer/orders/${ids.R1}/cancel`, tokens.custA, { reason: "r1 setup" }).expect(201);
    const filed = await post(`/api/v1/admin/retail/orders/${ids.R1}/refunds`, tokens.admin, { amount: totals.R1, idempotencyKey: makeId("k") }).expect(201);
    const refundId = filed.body.refund.id as string;
    const [a, b] = await Promise.all([
      post(`/api/v1/admin/retail/refunds/${refundId}/approve`, tokens.admin, { idempotencyKey: makeId("k") }),
      post(`/api/v1/admin/retail/refunds/${refundId}/complete`, tokens.admin, { externalReference: "BANK-R1", idempotencyKey: makeId("k") }),
    ]);
    // Either approve-then-complete (both 2xx) or complete-too-early (honest
    // 409) — never a 500, never a half-moved refund.
    expect([200, 201, 409]).toContain(a.status);
    expect([200, 201, 409]).toContain(b.status);
    const current = await db.select().from(schema.refund).where(eq(schema.refund.id, refundId));
    expect(["requested", "approved", "completed"]).toContain((current[0] as any).status);
    if ((current[0] as any).status === "requested") {
      await post(`/api/v1/admin/retail/refunds/${refundId}/approve`, tokens.admin, { idempotencyKey: makeId("k") }).expect(201);
    }
    if ((current[0] as any).status !== "completed") {
      const after = await db.select().from(schema.refund).where(eq(schema.refund.id, refundId));
      if ((after[0] as any).status === "approved") {
        await post(`/api/v1/admin/retail/refunds/${refundId}/complete`, tokens.admin, { externalReference: "BANK-R1", idempotencyKey: makeId("k") }).expect(201);
      }
    }
    const done = await db.select().from(schema.refund).where(eq(schema.refund.id, refundId));
    expect((done[0] as any).status).toBe("completed");
    const facts = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "retail_order.refund_completed"), eq(schema.auditLog.entityId, ids.R1)));
    expect(facts).toHaveLength(1);
  });

  it("R2 refuses double return receive: one winner, one honest loser, one event", async () => {
    await checkoutAs("R2");
    await payOrderGateway("R2");
    await driveToDelivered("R2");
    const [lineId] = await orderItemIds("R2");
    const filed = await post(`/api/v1/customer/orders/${ids.R2}/returns`, tokens.custA, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" }).expect(201);
    await post(`/api/v1/admin/retail/returns/${filed.body.id}/approve`, tokens.admin, {}).expect(200);
    const [a, b] = await Promise.all([
      post(`/api/v1/admin/retail/returns/${filed.body.id}/receive`, tokens.admin, {}),
      post(`/api/v1/admin/retail/returns/${filed.body.id}/receive`, tokens.admin, {}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");
    const events = await db.select().from(schema.retailReturnEvent).where(and(eq(schema.retailReturnEvent.returnId, filed.body.id), eq(schema.retailReturnEvent.toStatus, "RECEIVED")));
    expect(events).toHaveLength(1);
    const req = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.body.id));
    expect((req[0] as any).status).toBe("RECEIVED");
    expect((req[0] as any).receivedAt).not.toBeNull();
  });

  it("R3 converges double paid cancel: both 200, one cancel, restock exactly once, stock non-negative", async () => {
    await checkoutAs("R3");
    await payOrderGateway("R3");
    await retailOrders.confirmRetailOrder(ids.R3, admin());
    await retailOrders.packRetailOrder(ids.R3, admin());
    await retailOrders.createRetailShipment(ids.R3, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const before = await onHand();
    const [a, b] = await Promise.all([
      post(`/api/v1/admin/retail/orders/${ids.R3}/cancel`, tokens.admin, {}),
      post(`/api/v1/admin/retail/orders/${ids.R3}/cancel`, tokens.admin, {}),
    ]);
    // Cancel is idempotent: the loser replays the cancelled view.
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const after = await onHand();
    expect(after - before).toBe(2);
    expect(after >= 0).toBe(true);
    const cancels = await db.select().from(schema.retailOrderEvent).where(and(eq(schema.retailOrderEvent.orderId, ids.R3), eq(schema.retailOrderEvent.toStatus, "cancelled")));
    expect(cancels).toHaveLength(1);
  });

  it("R4 converges double return restock: one winner, stock += qty exactly once", async () => {
    await checkoutAs("R4");
    await payOrderGateway("R4");
    await driveToDelivered("R4");
    const [lineId] = await orderItemIds("R4");
    const filed = await post(`/api/v1/customer/orders/${ids.R4}/returns`, tokens.custA, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" }).expect(201);
    await post(`/api/v1/admin/retail/returns/${filed.body.id}/approve`, tokens.admin, {}).expect(200);
    await post(`/api/v1/admin/retail/returns/${filed.body.id}/receive`, tokens.admin, {}).expect(200);
    await post(`/api/v1/admin/retail/returns/${filed.body.id}/inspect`, tokens.admin, { inspectionDecision: "RESTOCKABLE" }).expect(200);
    const before = await onHand();
    const [a, b] = await Promise.all([
      post(`/api/v1/admin/retail/returns/${filed.body.id}/restock`, tokens.admin, {}),
      post(`/api/v1/admin/retail/returns/${filed.body.id}/restock`, tokens.admin, {}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");
    const after = await onHand();
    expect(after - before).toBe(1);
    expect(after >= 0).toBe(true);
    const req = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.body.id));
    expect((req[0] as any).status).toBe("RESTOCKED");
  });
});
