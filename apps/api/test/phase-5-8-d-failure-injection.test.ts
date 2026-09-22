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
import { RetailNotificationRelayService } from "../src/modules/orders/retail/retail-notification-relay.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { FakeShippingProvider } from "../src/modules/shipping/providers/fake-shipping.provider";
import { ShippingService } from "../src/modules/shipping/shipping.service";

/**
 * Phase 5.8-D6 — failure injection across the retail commerce core.
 *
 * Every injected failure must leave a recoverable, truthful state: no
 * impossible partial commerce (paid-but-unconfirmed, shipped-but-unpaid,
 * consumed-but-unrecorded). Failures either roll back atomically or park
 * in an explicit retryable state (pending row + failed command, failed
 * inbox row) that the same key/event resumes. Real PostgreSQL.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_d_failure_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-d-failure-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let inventory: InventoryService;
let relay: RetailNotificationRelayService;
let shipping: ShippingService;
let fakeShipping: FakeShippingProvider;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_d58f_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin", string>;
const ids = {} as Record<string, string>;
let kolbeSellerId = "";
const totals = {} as Record<string, string>;

const buyer = () => ({ actorId: users.custA, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2 }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون، پلاک ۱", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shippingMethodId: "pishtaz",
    payMethod: "gateway",
    ...overrides,
  };
}

const postOrder = (body: unknown, token: string) =>
  request(app.getHttpServer()).post("/api/v1/retail/orders").set("authorization", `Bearer ${token}`).set("Idempotency-Key", makeId("key")).set("x-kolbe-internal-token", "").send(body);

async function checkoutAs(tag: string, overrides: Record<string, unknown> = {}) {
  const response = await postOrder(orderBody(overrides), tokens.custA).expect(201);
  ids[tag] = response.body.id;
  totals[tag] = response.body.totals.grandTotal;
  return response.body;
}

async function payOrderGateway(tag: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(ids[tag], buyer(), {
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

async function shipmentRows(orderId: string) {
  return db.select().from(schema.shipment).where(eq(schema.shipment.retailOrderId, orderId));
}

async function commandRow(orderId: string, key: string) {
  const [row] = await db
    .select()
    .from(schema.commandIdempotency)
    .where(and(eq(schema.commandIdempotency.scopeId, orderId), eq(schema.commandIdempotency.idempotencyKey, key)))
    .limit(1);
  return row as any;
}

async function shipInboxRow(eventId: string) {
  const [row] = await db.select().from(schema.shipmentEvent).where(eq(schema.shipmentEvent.externalEventId, eventId)).limit(1);
  return row as any;
}

async function shipInboxCount() {
  const rows = await db.select().from(schema.shipmentEvent);
  return rows.length;
}

async function stockOf(variantId: string) {
  const [row] = await db
    .select()
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, variantId), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return row as any;
}

const shipSignedHeaders = () => ({ "x-fake-shipping-signature": FakeShippingProvider.webhookSecret() });

describe("Phase 5.8-D6 failure injection", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-d-failure";
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
    relay = app.get(RetailNotificationRelayService);
    shipping = app.get(ShippingService);
    fakeShipping = app.get(FakeShippingProvider);

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
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");

    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "D Product One", slug: `d1-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("D6.1 parks a carrier outage as pending + retryable, then resumes on the same key", async () => {
    await checkoutAs("F1");
    await payOrderGateway("F1");
    await retailOrders.confirmRetailOrder(ids.F1, admin());
    await retailOrders.packRetailOrder(ids.F1, admin());
    const key = makeId("ship");
    fakeShipping.failNextCreateShipment(1);
    await expectCode(retailOrders.createRetailShipment(ids.F1, admin(), { idempotencyKey: key, providerName: "fake" }), "PROVIDER_ERROR");
    // Parked truthfully: one pending row, no tracking, retryable command, order still packed.
    const parked = await shipmentRows(ids.F1);
    expect(parked).toHaveLength(1);
    expect((parked[0] as any).status).toBe("pending");
    expect((parked[0] as any).trackingCode).toBeNull();
    expect((await commandRow(ids.F1, key)).state).toBe("failed");
    let view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F1);
    expect(view.status).toBe("packed");
    // Same key resumes through provider idempotency — no second parcel.
    const resumed = await retailOrders.createRetailShipment(ids.F1, admin(), { idempotencyKey: key, providerName: "fake" });
    expect(resumed.replayed).toBe(true);
    expect(resumed.shipment.id).toBe((parked[0] as any).id);
    expect(resumed.shipment.status).toBe("ready");
    expect(resumed.shipment.trackingCode).toMatch(/^TRK-/);
    expect(await shipmentRows(ids.F1)).toHaveLength(1);
    expect((await commandRow(ids.F1, key)).state).toBe("completed");
  });

  it("D6.2 parks a tracking outage as a re-claimable inbox failure, then applies on redelivery", async () => {
    await checkoutAs("F2");
    await payOrderGateway("F2");
    await retailOrders.confirmRetailOrder(ids.F2, admin());
    await retailOrders.packRetailOrder(ids.F2, admin());
    const created = await retailOrders.createRetailShipment(ids.F2, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    const ext = created.shipment.externalReference as string;
    const trk = created.shipment.trackingCode as string;
    fakeShipping.setCarrierState(ext, "in_transit");
    fakeShipping.failNextTracking(1);
    const dead = makeId("evt");
    await expectCode(
      retailOrders.handleRetailCarrierWebhook("fake", { headers: shipSignedHeaders() as any, body: { eventId: dead, externalReference: ext, trackingCode: trk, state: "in_transit" } }),
      "PROVIDER_ERROR",
    );
    expect((await shipInboxRow(dead)).status).toBe("failed");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("handed_over");
    // Redelivery (fresh event id, carrier now reachable) applies exactly once.
    const live = makeId("evt");
    const outcome = await retailOrders.handleRetailCarrierWebhook("fake", { headers: shipSignedHeaders() as any, body: { eventId: live, externalReference: ext, trackingCode: trk, state: "in_transit" } });
    expect(outcome.status).toBe("processed");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("in_transit");
  });

  it("D6.3 refuses handoff on a never-finalized parcel; the order stays packed", async () => {
    await checkoutAs("F3");
    await payOrderGateway("F3");
    await retailOrders.confirmRetailOrder(ids.F3, admin());
    await retailOrders.packRetailOrder(ids.F3, admin());
    const key = makeId("ship");
    fakeShipping.failNextCreateShipment(1);
    await expectCode(retailOrders.createRetailShipment(ids.F3, admin(), { idempotencyKey: key, providerName: "fake" }), "PROVIDER_ERROR");
    const [pending] = await shipmentRows(ids.F3);
    await expectCode(retailOrders.markRetailShipmentHandoff((pending as any).id, admin(), { idempotencyKey: makeId("hand") }), "INVALID_SHIPMENT_TRANSITION");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F3);
    expect(view.status).toBe("packed");
  });

  it("D6.4 ignores pre-handoff scans without auto-advance, then applies after handoff", async () => {
    await checkoutAs("F4");
    await payOrderGateway("F4");
    await retailOrders.confirmRetailOrder(ids.F4, admin());
    await retailOrders.packRetailOrder(ids.F4, admin());
    const created = await retailOrders.createRetailShipment(ids.F4, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const ext = created.shipment.externalReference as string;
    const trk = created.shipment.trackingCode as string;
    fakeShipping.setCarrierState(ext, "in_transit");
    const early = await retailOrders.handleRetailCarrierWebhook("fake", { headers: shipSignedHeaders() as any, body: { eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" } });
    expect(early.status).toBe("ignored");
    expect(early.reason).toBe("handoff_not_recorded");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("ready");
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    const late = await retailOrders.handleRetailCarrierWebhook("fake", { headers: shipSignedHeaders() as any, body: { eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" } });
    expect(late.status).toBe("processed");
  });

  it("D6.5 persists nothing on unauthenticated or unknown-provider tracking", async () => {
    await checkoutAs("F5");
    await payOrderGateway("F5");
    await retailOrders.confirmRetailOrder(ids.F5, admin());
    await retailOrders.packRetailOrder(ids.F5, admin());
    const created = await retailOrders.createRetailShipment(ids.F5, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const before = await shipInboxCount();
    await expectCode(
      retailOrders.handleRetailCarrierWebhook("fake", { headers: { "x-fake-shipping-signature": "forged" } as any, body: { eventId: makeId("evt"), externalReference: created.shipment.externalReference, state: "delivered" } }),
      "RETAIL_WEBHOOK_UNAUTHENTICATED",
    );
    await expectCode(retailOrders.handleRetailCarrierWebhook("nope", { headers: {}, body: {} }), "SHIPPING_PROVIDER_UNKNOWN");
    await expectCode(retailOrders.handleRetailCarrierWebhook("manual", { headers: {}, body: { state: "in_transit" } }), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect(await shipInboxCount()).toBe(before);
  });

  it("D6.6 refuses cancel once freight leaves the warehouse; both sides stay intact", async () => {
    await checkoutAs("F6", { payMethod: "cod" });
    await retailOrders.confirmRetailOrder(ids.F6, admin());
    await retailOrders.packRetailOrder(ids.F6, admin());
    const created = await retailOrders.createRetailShipment(ids.F6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await expectCode(retailOrders.cancelRetailOrder(ids.F6, buyer()), "RETAIL_CANCEL_SHIPMENT_IN_PROGRESS");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F6);
    expect(view.status).toBe("shipped");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("handed_over");
  });

  it("D6.7 fails the whole relay batch safely when no template exists", async () => {
    await checkoutAs("F7");
    await payOrderGateway("F7");
    await retailOrders.confirmRetailOrder(ids.F7, admin());
    await retailOrders.packRetailOrder(ids.F7, admin());
    const created = await retailOrders.createRetailShipment(ids.F7, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    // No templates were seeded in this database: every fulfillment fact fails delivery, commerce is untouched.
    const summary = await relay.relayPending(50);
    expect(summary.deliveries).toBe(0);
    expect(summary.failures).toBeGreaterThanOrEqual(4);
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F7);
    expect(view.status).toBe("delivered");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("delivered");
  });

  it("D6.8 fails COD shipment closed when the hold is gone and the shelf is bare", async () => {
    // An operator erroneously releases the COD hold; an external sale then
    // drains every free unit (service-guarded, down to the reserved floor).
    // The shipment must fail closed: no parcel, nothing resurrected.
    await checkoutAs("F8", { payMethod: "cod" });
    await retailOrders.confirmRetailOrder(ids.F8, admin());
    await retailOrders.packRetailOrder(ids.F8, admin());
    const [hold] = await inventory.listActiveReservationsByAllocation(ids.F8);
    expect(hold).toBeTruthy();
    await inventory.releaseRetail({
      reservationId: (hold as any).id,
      requester: { userId: users.admin, role: "admin" },
      reason: "d6.8 erroneous operator release",
      idempotencyKey: makeId("rel"),
    });
    const shelf = await stockOf(ids.v1);
    await inventory.upsertVariantInventory({
      variantId: ids.v1,
      sellerId: kolbeSellerId,
      onHandDelta: -(shelf.onHand - shelf.reserved),
      reason: "d6.8 external sale drains free stock",
      requester: { userId: users.admin, role: "admin" },
      idempotencyKey: makeId("drain"),
    });
    const drained = await stockOf(ids.v1);
    expect(drained.onHand).toBe(drained.reserved);
    await expectCode(retailOrders.createRetailShipment(ids.F8, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" }), "RETAIL_INSUFFICIENT_STOCK");
    // Fail closed: no parcel, the released hold stays released, the order is still packed.
    expect(await shipmentRows(ids.F8)).toHaveLength(0);
    expect(await inventory.listActiveReservationsByAllocation(ids.F8)).toHaveLength(0);
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F8);
    expect(view.status).toBe("packed");
  });
});
