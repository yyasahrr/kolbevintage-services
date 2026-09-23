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
 * Phase 5.11-D7 — ops-route concurrency (Nest e2e).
 *
 * Races over HTTP converge exactly as the seams converge: one
 * winner with an honest loser code, replays collapsing to a single
 * effect, and keyset walks terminating under concurrent inserts.
 * Real PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_d_concurrency_test";
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

const authed = () => ({ admin: tokens.admin, customer: tokens.custA });

describe("Phase 5.11-D7 concurrency", () => {
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
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Race Product", slug: `race-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("converges racing confirms: one 200, one honest 400", async () => {
    await checkoutAs("R1");
    await payOrderGateway("R1");
    const fire = () =>
      request(app.getHttpServer()).post(`/api/v1/admin/retail/orders/${ids.R1}/confirm`).set("authorization", `Bearer ${authed().admin}`).send({});
    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error).toBe("RETAIL_TRANSITION_INVALID");
  });

  it("collapses same-key double filing to 201 + 200 replay", async () => {
    await checkoutAs("R2");
    await payOrderGateway("R2");
    await retailOrders.cancelRetailOrder(ids.R2, admin());
    const key = makeId("req");
    const fire = () =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/retail/orders/${ids.R2}/refunds`)
        .set("authorization", `Bearer ${authed().admin}`)
        .set("idempotency-key", key)
        .send({ amount: totals.R2 });
    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.R2));
    expect(rows).toHaveLength(1);
  });

  it("converges racing approve + fail on a refund", async () => {
    await checkoutAs("R3");
    await payOrderGateway("R3");
    await retailOrders.cancelRetailOrder(ids.R3, admin());
    const filed = await retailOrders.requestRetailRefund(ids.R3, admin(), { amount: totals.R3, idempotencyKey: makeId("req") });
    const approve = request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.refund.id}/approve`)
      .set("authorization", `Bearer ${authed().admin}`)
      .set("idempotency-key", makeId("appr"))
      .send({});
    const fail = request(app.getHttpServer())
      .post(`/api/v1/admin/retail/refunds/${filed.refund.id}/fail`)
      .set("authorization", `Bearer ${authed().admin}`)
      .set("idempotency-key", makeId("fail"))
      .send({ reason: "race loser" });
    const [a, b] = await Promise.all([approve, fail]);
    // Approve-then-fail is legal (both 201); fail-then-approve refuses
    // the approve with 409. Either way the row ends failed, honestly.
    const [row] = await db.select().from(schema.refund).where(eq(schema.refund.id, filed.refund.id));
    if (a.status === 201 && b.status === 201) {
      expect((row as any).status).toBe("failed");
    } else {
      expect(a.status).toBe(409);
      expect(a.body.error).toBe("INVALID_STATUS_TRANSITION");
      expect((row as any).status).toBe("failed");
    }
  });

  it("converges racing return approve + reject", async () => {
    await checkoutAs("R4");
    await payOrderGateway("R4");
    await retailOrders.confirmRetailOrder(ids.R4, admin());
    await retailOrders.packRetailOrder(ids.R4, admin());
    const created = await retailOrders.createRetailShipment(ids.R4, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    const [lineId] = await orderItemIds("R4");
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.R4}/returns`)
      .set("authorization", `Bearer ${authed().customer}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" })
      .expect(201);
    const approve = request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/approve`)
      .set("authorization", `Bearer ${authed().admin}`)
      .send({});
    const reject = request(app.getHttpServer())
      .post(`/api/v1/admin/retail/returns/${filed.body.id}/reject`)
      .set("authorization", `Bearer ${authed().admin}`)
      .send({ reason: "race reject" });
    const [a, b] = await Promise.all([approve, reject]);
    // APPROVED -> REJECTED is legal, so approve-then-reject lands both
    // 200; reject-then-approve refuses the approve with 400. Either way
    // the row ends REJECTED, honestly.
    const [row] = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.id, filed.body.id));
    if (a.status === 200 && b.status === 200) {
      expect((row as any).status).toBe("REJECTED");
    } else {
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      const loser = a.status === 400 ? a : b;
      expect(loser.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");
      expect((row as any).status).toBe("REJECTED");
    }
  });

  it("terminates keyset walks under concurrent inserts with seeds seen once", async () => {
    const seeds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const tag = `W${i}`;
      await checkoutAs(tag);
      seeds.push(ids[tag]);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const url = cursor ? `/api/v1/admin/retail/orders?limit=2&cursor=${cursor}` : "/api/v1/admin/retail/orders?limit=2";
      const res = await request(app.getHttpServer()).get(url).set("authorization", `Bearer ${authed().admin}`).expect(200);
      pages++;
      seen.push(...res.body.orders.map((row: any) => row.id));
      cursor = res.body.nextCursor;
      if (pages === 1) {
        // Concurrent prepends land before the cursor: skipped, never duped.
        await checkoutAs("WX1");
        await checkoutAs("WX2");
        await checkoutAs("WX3");
      }
      if (!res.body.hasMore) break;
      expect(pages).toBeLessThan(8);
    }
    expect(cursor).toBeNull();
    for (const seed of seeds) {
      expect(seen.filter((id) => id === seed)).toHaveLength(1);
    }
  });

  it("collapses same-key double handoff to 201 + 200 replay", async () => {
    await checkoutAs("R6");
    await payOrderGateway("R6");
    await retailOrders.confirmRetailOrder(ids.R6, admin());
    await retailOrders.packRetailOrder(ids.R6, admin());
    const created = await retailOrders.createRetailShipment(ids.R6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const key = makeId("hand");
    const fire = () =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/retail/shipments/${created.shipment.id}/handoff`)
        .set("authorization", `Bearer ${authed().admin}`)
        .set("idempotency-key", key)
        .send({});
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
  });

  it("converges racing whole-filings: one 201, the loser exceeds the ceiling", async () => {
    await checkoutAs("R7");
    await payOrderGateway("R7");
    await retailOrders.cancelRetailOrder(ids.R7, admin());
    const fire = () =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/retail/orders/${ids.R7}/refunds`)
        .set("authorization", `Bearer ${authed().admin}`)
        .set("idempotency-key", makeId("req"))
        .send({ amount: totals.R7 });
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toBe("REFUND_EXCEEDS_ALLOCATED");
    const rows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.R7));
    expect(rows).toHaveLength(1);
  });
});
