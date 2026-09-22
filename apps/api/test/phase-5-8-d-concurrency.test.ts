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
import { InventoryService } from "../src/modules/inventory/inventory.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { ShippingService } from "../src/modules/shipping/shipping.service";

/**
 * Phase 5.8-D7 — race conditions across the retail commerce core.
 *
 * Every race converges on exactly one authoritative fact: one consumed
 * hold, one shipment per order, one confirmed state, one paid fact, one
 * redelivery. Races are driven with Promise.allSettled so the loser
 * surfaces as a domain error (never an unhandled rejection), and each
 * test then asserts the single-tally invariant plus legal formation.
 * Real PostgreSQL.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_d_concurrency_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-d-concurrency-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let inventory: InventoryService;
let shipping: ShippingService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_d58c_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin", string>;
const tokens = {} as Record<"custA" | "custB" | "admin", string>;
const ids = {} as Record<string, string>;
let kolbeSellerId = "";
const totals = {} as Record<string, string>;

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(customer: string, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: customer, phone: "09121234567", email: `${customer}@example.test` },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2 }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون، پلاک ۱", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shippingMethodId: "pishtaz",
    payMethod: "gateway",
    ...overrides,
  };
}

const postOrder = (body: unknown, token: string, key?: string) =>
  request(app.getHttpServer()).post("/api/v1/retail/orders").set("authorization", `Bearer ${token}`).set("Idempotency-Key", key ?? makeId("key")).set("x-kolbe-internal-token", "").send(body);

async function checkoutAs(tag: string, token: string, name: string, overrides: Record<string, unknown> = {}) {
  const response = await postOrder(orderBody(name, overrides), token).expect(201);
  ids[tag] = response.body.id;
  totals[tag] = response.body.totals.grandTotal;
  return response.body;
}

async function payOrderGateway(tag: string, buyer = buyerA()) {
  const { payment } = await retailOrders.submitPaymentEvidence(ids[tag], buyer, {
    rail: "manual_transfer",
    amount: totals[tag],
    evidenceReference: `BANK-${tag}`,
    idempotencyKey: makeId("ev"),
  });
  await retailOrders.verifyPayment(payment.id, admin(), { externalReference: `BANK-${tag}-VERIFY`, idempotencyKey: makeId("verify") });
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

async function reservationRows(allocationId: string) {
  return db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.allocationId, allocationId));
}

async function shipmentRows(orderId: string) {
  return db.select().from(schema.shipment).where(eq(schema.shipment.retailOrderId, orderId));
}

async function orderEvents(orderId: string) {
  return db
    .select()
    .from(schema.orderEvent)
    .where(and(eq(schema.orderEvent.aggregateType, "retail_order"), eq(schema.orderEvent.aggregateId, orderId)));
}

async function orderRow(orderId: string) {
  const [row] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, orderId)).limit(1);
  return row as any;
}

async function stockOf() {
  const [row] = await db
    .select()
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, ids.v1), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return row as any;
}

describe("Phase 5.8-D7 concurrency", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-d-concurrency";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    process.env.PAYMENT_PROVIDER_MODE = "fake";
    process.env.SHIPPING_PROVIDER_MODE = "fake";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);
    inventory = app.get(InventoryService);
    shipping = app.get(ShippingService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.custB = verifier.issue(users.custB, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);

    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");

    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "D Concurrency Product", slug: `dc-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("D7.1 converges a double-submitted checkout on the same key: one order, one consumed hold, legal formation", async () => {
    const before = await stockOf();
    const key = makeId("key");
    const body = orderBody("ra-one", { payMethod: "gateway" });
    const [first, second] = await Promise.allSettled([
      postOrder(body, tokens.custA, key),
      postOrder(JSON.parse(JSON.stringify(body)), tokens.custA, key),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    const a = (first as PromiseFulfilledResult<request.Response>).value;
    const b = (second as PromiseFulfilledResult<request.Response>).value;
    // Advisory lock serializes the race: one creates (201), the loser replays (200) the same order.
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(b.body.id).toBe(a.body.id);
    const replayed = a.status === 200 ? a : b;
    expect(replayed.body.replayed).toBe(true);
    const orderId = a.body.id as string;
    ids.R1 = orderId;
    const keyed = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.idempotencyKey, key));
    expect(keyed).toHaveLength(1);
    const rows = await reservationRows(orderId);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).status).toBe("active");
    // Gateway stock is HELD at checkout exactly once (consumed at verify).
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved + 2);
    const formed = await orderRow(orderId);
    expect(formed.orderStatus).toBe("placed");
    expect(formed.customerId).toBe(users.custA);
    expect(formed.creationRequestHash).toBeTruthy();
    expect(formed.customerName).toBe("ra-one");
    expect(await orderEvents(orderId)).toHaveLength(1);
  });

  it("D7.2 converges two providers confirming the same order: one confirmation, one emit", async () => {
    await checkoutAs("R2", tokens.custA, "ra-two", { payMethod: "cod" });
    const [first, second] = await Promise.allSettled([
      retailOrders.confirmRetailOrder(ids.R2, admin()),
      retailOrders.confirmRetailOrder(ids.R2, admin()),
    ]);
    // One wins; the other lands on the now-dead transition.
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = first.status === "rejected" ? first.reason : (second as PromiseRejectedResult).reason;
    expect(rejected?.code ?? rejected?.response?.code).toBe("RETAIL_TRANSITION_INVALID");
    const formed = await orderRow(ids.R2);
    expect(formed.orderStatus).toBe("confirmed");
    expect(formed.version).toBe(1);
    expect(await orderEvents(ids.R2)).toHaveLength(2);
  });

  it("D7.3 converges two shippers racing ship-all: one parcel, the loser bounded (multi-parcel is by design)", async () => {
    const before = await stockOf();
    await checkoutAs("R3", tokens.custA, "ra-three", { payMethod: "cod" });
    await retailOrders.confirmRetailOrder(ids.R3, admin());
    await retailOrders.packRetailOrder(ids.R3, admin());
    const [first, second] = await Promise.allSettled([
      retailOrders.createRetailShipment(ids.R3, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" }),
      retailOrders.createRetailShipment(ids.R3, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" }),
    ]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = first.status === "rejected" ? first.reason : (second as PromiseRejectedResult).reason;
    expect(rejected?.code ?? rejected?.response?.code).toBe("RETAIL_SHIPMENT_QUANTITY_EXCEEDED");
    const parcels = await shipmentRows(ids.R3);
    expect(parcels).toHaveLength(1);
    // COD hold settled exactly once by the race: the original hold is released and one consumed settlement row is re-cut.
    const holds = await reservationRows(ids.R3);
    expect(holds).toHaveLength(2);
    expect(holds.map((row: any) => row.status).sort()).toEqual(["confirmed", "released"]);
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved);
    expect((await orderRow(ids.R3)).orderStatus).toBe("packed");
  });

  it("D7.4 converges two buyers racing the last stock: exactly one order, nothing negative", async () => {
    // Drain the shelf to exactly 2 free units (each order below needs 2).
    await checkoutAs("R4warm", tokens.custB, "warmup", { payMethod: "gateway" });
    await payOrderGateway("R4warm", buyerB());
    const preDrain = await stockOf();
    await db.update(schema.productVariantInventory).set({ onHand: preDrain.reserved + 2 }).where(and(eq(schema.productVariantInventory.variantId, ids.v1), eq(schema.productVariantInventory.sellerId, kolbeSellerId)));
    const drained = await stockOf();
    expect(drained.onHand - drained.reserved).toBe(2);
    const [first, second] = await Promise.allSettled([
      postOrder(orderBody("ra-four-a"), tokens.custA),
      postOrder(orderBody("ra-four-b"), tokens.custB),
    ]);
    const wins = [first, second].filter((r) => r.status === "fulfilled").map((r) => (r as any).value as request.Response);
    expect(wins.filter((r) => r.status === 201)).toHaveLength(1);
    const loser = wins.find((r) => r.status !== 201);
    expect(loser?.status).toBe(409);
    expect(loser?.body.error).toBe("RETAIL_INSUFFICIENT_STOCK");
    const after = await stockOf();
    expect(after.onHand - after.reserved).toBe(0);
    expect(after.onHand).toBeGreaterThanOrEqual(after.reserved);
    // Restock for the remaining races (the shelf is honestly empty now).
    await inventory.upsertVariantInventory({
      variantId: ids.v1,
      sellerId: kolbeSellerId,
      onHandDelta: 50,
      reason: "d7.4 restock",
      requester: { userId: users.admin, role: "admin" },
      idempotencyKey: makeId("restock"),
    });
  });

  it("D7.5 converges a double-submitted evidence on one key: one evidence, one verified payment", async () => {
    await checkoutAs("R5", tokens.custA, "ra-five");
    const key = makeId("ev");
    const evidence = { rail: "manual_transfer", amount: totals.R5, evidenceReference: "BANK-R5", idempotencyKey: key };
    const [first, second] = await Promise.allSettled([
      retailOrders.submitPaymentEvidence(ids.R5, buyerA(), { ...evidence }),
      retailOrders.submitPaymentEvidence(ids.R5, buyerA(), { ...evidence }),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    const firstId = ((first as PromiseFulfilledResult<any>).value.payment as any).id as string;
    const secondId = ((second as PromiseFulfilledResult<any>).value.payment as any).id as string;
    expect(secondId).toBe(firstId);
    const flags = [first, second].map((r) => ((r as PromiseFulfilledResult<any>).value as any).replayed);
    expect(flags.sort()).toEqual([false, true]);
    const evidences = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.R5));
    expect(evidences).toHaveLength(1);
    await retailOrders.verifyPayment(firstId, admin(), { externalReference: "BANK-R5-VERIFY", idempotencyKey: makeId("verify") });
    const formed = await orderRow(ids.R5);
    expect(formed.paymentStatus).toBe("paid");
  });

  it("D7.6 converges two cancellers on one unpaid order: one cancel, one full refund of holds", async () => {
    const before = await stockOf();
    await checkoutAs("R6", tokens.custA, "ra-six");
    const [first, second] = await Promise.allSettled([
      retailOrders.cancelRetailOrder(ids.R6, buyerA()),
      retailOrders.cancelRetailOrder(ids.R6, buyerA()),
    ]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = first.status === "rejected" ? first.reason : (second as PromiseRejectedResult).reason;
    expect(rejected?.code ?? rejected?.response?.code).toBe("RETAIL_TRANSITION_INVALID");
    // The winner's cancel releases the active hold in full: exactly one released row, shelf fully restored.
    const holds = await reservationRows(ids.R6);
    expect(holds).toHaveLength(1);
    expect((holds[0] as any).status).toBe("released");
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved);
    expect((await orderRow(ids.R6)).orderStatus).toBe("cancelled");
  });

  it("D7.7 converges double verify on one evidence: one paid fact, one emit", async () => {
    await checkoutAs("R7", tokens.custA, "ra-seven");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.R7, buyerA(), {
      rail: "manual_transfer", amount: totals.R7, evidenceReference: "BANK-R7", idempotencyKey: makeId("ev"),
    });
    const key = makeId("verify");
    const [first, second] = await Promise.allSettled([
      retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-R7-V", idempotencyKey: key }),
      retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-R7-V", idempotencyKey: key }),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    const flags = [first, second].map((r) => ((r as PromiseFulfilledResult<any>).value as any).replayed);
    expect(flags.sort()).toEqual([false, true]);
    const formed = await orderRow(ids.R7);
    expect(formed.paymentStatus).toBe("paid");
    const paidRows = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.R7));
    expect(paidRows).toHaveLength(1);
    expect((paidRows[0] as any).status).toBe("verified");
  });
});
