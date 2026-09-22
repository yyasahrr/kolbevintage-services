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
import { NotificationTemplateService } from "../src/modules/notifications/notification-template.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailNotificationRelayService } from "../src/modules/orders/retail/retail-notification-relay.service";
import { RetailOrdersRepository } from "../src/modules/orders/retail/retail-orders.repository";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.8-B — retail payment orchestration + inventory lifecycle + relay.
 *
 * Service-level over HTTP-created orders (Checkpoint D owns the HTTP
 * surface): gateway intents via the fake provider, manual/cod evidence,
 * atomic verification (paid marking + sibling hygiene + stock confirm +
 * paid fact), unpaid cancellation (transition + hold release + cancelled
 * fact), expiry reaping (hold only, never the order), re-reserve on verify,
 * fail-closed stock shortfall, and the best-effort retail notification
 * relay. Real PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_b_retail_payment_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-b-payment-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let retailRepo: RetailOrdersRepository;
let inventory: InventoryService;
let relay: RetailNotificationRelayService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_b58_${Date.now()}_${seq++}`;

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

const postOrder = (body: unknown, token: string) =>
  request(app.getHttpServer())
    .post("/api/v1/retail/orders")
    .set("authorization", `Bearer ${token}`)
    .set("Idempotency-Key", makeId("key"))
    .set("x-kolbe-internal-token", "")
    .send(body);

async function checkoutAs(tag: string, overrides: Record<string, unknown> = {}) {
  const response = await postOrder(orderBody(overrides), tokens.custA).expect(201);
  ids[tag] = response.body.id;
  totals[tag] = response.body.totals.grandTotal;
  return response.body;
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

async function paymentRows(orderId: string) {
  return db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, orderId));
}

async function reservationRows(orderId: string) {
  return db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.allocationId, orderId));
}

async function factRows(orderId: string, eventType: string) {
  return db
    .select()
    .from(schema.orderEvent)
    .where(and(eq(schema.orderEvent.aggregateType, "retail_order"), eq(schema.orderEvent.aggregateId, orderId), eq(schema.orderEvent.eventType, eventType)));
}

async function stockOf(variantId: string) {
  const [row] = await db
    .select()
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, variantId), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return row;
}

describe("Phase 5.8-B retail payment + inventory lifecycle", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-b-retail-payment";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    process.env.PAYMENT_PROVIDER_MODE = "fake";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);
    retailRepo = app.get(RetailOrdersRepository);
    inventory = app.get(InventoryService);
    relay = app.get(RetailNotificationRelayService);

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
    await db.insert(schema.product).values({ id: ids.p1, name: "B Product One", slug: `b1-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });

    // Single-unit variant for the fail-closed shortfall test (v1 stock stays intact).
    ids.p2 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p2, name: "B Product Two", slug: `b2-${ids.p2}`, ownerType: "KOLBE", status: "published" });
    ids.v2 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v2, productId: ids.p2, sku: `SKU-${ids.v2}`, status: "active", attributes: { size: "S" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p2, sellerId: kolbeSellerId, variantId: ids.v2, sku: `OFFER-${ids.v2}`, status: "published", retailPrice: 100000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v2, sellerId: kolbeSellerId, onHand: 1, reserved: 0, status: "active" });

    // Published IN_APP templates for the three relay keys (enqueue renders
    // strictly: only {{orderCode}} is referenced, the one variable every
    // retail fact payload carries).
    const templates = app.get(NotificationTemplateService);
    for (const [key, subject, body] of [
      ["RETAIL_ORDER_CREATED", "سفارش {{orderCode}} ثبت شد", "سفارش خرده‌فروشی {{orderCode}} با موفقیت ثبت شد."],
      ["RETAIL_ORDER_PAID", "پرداخت سفارش {{orderCode}}", "پرداخت سفارش {{orderCode}} تأیید شد."],
      ["RETAIL_ORDER_CANCELLED", "لغو سفارش {{orderCode}}", "سفارش {{orderCode}} لغو شد."],
    ] as const) {
      const tpl = await templates.createTemplate({
        templateKey: `${key.toLowerCase()}_inapp`,
        name: subject,
        eventKey: key,
        channel: "IN_APP",
        category: "TRANSACTIONAL",
        initialVersion: { subject, body, variablesSchema: ["orderCode"] },
        adminUserId: users.admin,
      });
      await templates.publishVersion(tpl.id, 1, users.admin);
    }
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

  it("creates a gateway intent with the fake provider (TxA row + provider + TxB persist)", async () => {
    await checkoutAs("G1");
    const { payment, replayed } = await retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: makeId("intent"), providerName: "fake" });
    expect(replayed).toBe(false);
    expect(payment.retailOrderId ?? payment.retail_order_id).toBe(ids.G1);
    expect(payment.status).toBe("pending");
    expect(payment.provider).toBe("fake");
    expect(BigInt(payment.amount).toString()).toBe(totals.G1);
    expect(payment.providerReference ?? payment.provider_reference).toMatch(/^FAKE-/);
  });

  it("replays an intent idempotency key without a second row", async () => {
    const key = makeId("intent");
    const first = await retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: key, providerName: "fake" });
    const second = await retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: key, providerName: "fake" });
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    const rows = await paymentRows(ids.G1);
    expect(rows.filter((row: any) => row.idempotencyKey === key)).toHaveLength(1);
  });

  it("rejects an intent key reused with a different provider", async () => {
    const key = makeId("intent");
    await retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: key, providerName: "fake" });
    await expectCode(retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: key, providerName: "manual" }), "IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects online intents for cash-on-delivery orders", async () => {
    await checkoutAs("C1", { payMethod: "cod" });
    await expectCode(retailOrders.createPaymentIntent(ids.C1, buyer(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_INTENT_METHOD_UNSUPPORTED");
  });

  it("contains an unknown provider: registry error, row stays pending", async () => {
    const key = makeId("intent");
    await expectCode(retailOrders.createPaymentIntent(ids.G1, buyer(), { idempotencyKey: key, providerName: "nope" }), "PAYMENT_PROVIDER_UNKNOWN");
    const rows = await paymentRows(ids.G1);
    const row = rows.find((r: any) => r.idempotencyKey === key) as any;
    expect(row.status).toBe("pending");
    expect(row.providerReference).toBeNull();
  });

  it("submits manual evidence for exact order totals", async () => {
    await checkoutAs("G2");
    const { payment, replayed } = await retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
      rail: "manual_transfer",
      amount: totals.G2,
      evidenceReference: "REF-100",
      idempotencyKey: makeId("ev"),
    });
    ids.eG2 = payment.id;
    expect(replayed).toBe(false);
    expect(payment.status).toBe("evidence_submitted");
    expect(payment.method).toBe("manual_transfer");
    expect(BigInt(payment.amount).toString()).toBe(totals.G2);
  });

  it("rejects evidence whose amount differs by one rial", async () => {
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
        rail: "manual_transfer",
        amount: (BigInt(totals.G2) - 1n).toString(),
        evidenceReference: "REF-101",
        idempotencyKey: makeId("ev"),
      }),
      "RETAIL_AMOUNT_MISMATCH",
    );
  });

  it("rejects evidence on the wrong rail", async () => {
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
        rail: "cod",
        amount: totals.G2,
        evidenceReference: "REF-102",
        idempotencyKey: makeId("ev"),
      }),
      "RETAIL_EVIDENCE_RAIL_MISMATCH",
    );
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.C1, buyer(), {
        rail: "manual_transfer",
        amount: totals.C1,
        evidenceReference: "REF-103",
        idempotencyKey: makeId("ev"),
      }),
      "RETAIL_EVIDENCE_RAIL_MISMATCH",
    );
  });

  it("accepts cod-rail evidence for cash-on-delivery orders", async () => {
    const { payment } = await retailOrders.submitPaymentEvidence(ids.C1, buyer(), {
      rail: "cod",
      amount: totals.C1,
      evidenceReference: "COD-1",
      idempotencyKey: makeId("ev"),
    });
    expect(payment.status).toBe("evidence_submitted");
    expect(payment.method).toBe("cod");
  });

  it("replays evidence idempotency keys without a second row", async () => {
    const key = makeId("ev");
    const first = await retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
      rail: "manual_transfer",
      amount: totals.G2,
      evidenceReference: "REF-104",
      idempotencyKey: key,
    });
    const second = await retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
      rail: "manual_transfer",
      amount: totals.G2,
      evidenceReference: "REF-104",
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
  });

  it("verifies evidence atomically: paid + confirmed stock + paid fact", async () => {
    const before = await stockOf(ids.v1);
    const { view, payment, replayed } = await retailOrders.verifyPayment(ids.eG2, admin(), {
      externalReference: "BANK-1",
      idempotencyKey: makeId("verify"),
    });
    expect(replayed).toBe(false);
    expect(payment.status).toBe("verified");
    expect(view.payment).toEqual({ method: "gateway", status: "paid", collected: true, requiresManualSettlement: false });
    const after = await stockOf(ids.v1);
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
    const holds = await reservationRows(ids.G2);
    expect(holds.map((row: any) => row.status)).toEqual(["confirmed"]);
    const facts = await factRows(ids.G2, "retail_order.paid");
    expect(facts).toHaveLength(1);
    expect((facts[0] as any).payload.payment_id).toBe(ids.eG2);
    const siblings = (await paymentRows(ids.G2)).filter((row: any) => row.id !== ids.eG2);
    expect(siblings.length).toBeGreaterThan(0);
    for (const row of siblings as any[]) expect(row.status).toBe("cancelled");
  });

  it("replays verification without a second paid fact", async () => {
    const key = makeId("verify");
    const first = await retailOrders.verifyPayment(ids.eG2, admin(), { externalReference: "BANK-1", idempotencyKey: key });
    expect(first.replayed).toBe(true);
    expect(first.view.payment.status).toBe("paid");
    expect(await factRows(ids.G2, "retail_order.paid")).toHaveLength(1);
  });

  it("blocks new payments once the order is paid", async () => {
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.G2, buyer(), {
        rail: "manual_transfer",
        amount: totals.G2,
        evidenceReference: "REF-LATE",
        idempotencyKey: makeId("ev"),
      }),
      "RETAIL_ALREADY_PAID",
    );
    await expectCode(retailOrders.createPaymentIntent(ids.G2, buyer(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_ALREADY_PAID");
  });

  it("verifies a pending gateway intent and cancels stale siblings", async () => {
    await checkoutAs("G3");
    const intent = await retailOrders.createPaymentIntent(ids.G3, buyer(), { idempotencyKey: makeId("intent"), providerName: "fake" });
    const evidence = await retailOrders.submitPaymentEvidence(ids.G3, buyer(), {
      rail: "manual_transfer",
      amount: totals.G3,
      evidenceReference: "REF-G3",
      idempotencyKey: makeId("ev"),
    });
    const { view } = await retailOrders.verifyPayment(intent.payment.id, admin(), {
      externalReference: "FAKE-CB-1",
      idempotencyKey: makeId("verify"),
    });
    expect(view.payment).toMatchObject({ status: "paid", collected: true });
    const rows = await paymentRows(ids.G3);
    const sibling = rows.find((row: any) => row.id === evidence.payment.id) as any;
    expect(sibling.status).toBe("cancelled");
    await expectCode(
      retailOrders.verifyPayment(evidence.payment.id, admin(), { externalReference: "BANK-X", idempotencyKey: makeId("verify") }),
      "INVALID_STATUS_TRANSITION",
    );
  });

  it("refuses verification from non-finance roles", async () => {
    await checkoutAs("G4");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.G4, buyer(), {
      rail: "manual_transfer",
      amount: totals.G4,
      evidenceReference: "REF-G4",
      idempotencyKey: makeId("ev"),
    });
    await expectCode(retailOrders.verifyPayment(payment.id, buyer(), { externalReference: "BANK-X", idempotencyKey: makeId("verify") }), "ROLE_NOT_ALLOWED");
    const rows = await paymentRows(ids.G4);
    expect((rows[0] as any).status).toBe("evidence_submitted");
  });

  it("cancels an unpaid order: transition + hold release + cancelled fact", async () => {
    await checkoutAs("G5");
    expect(await inventory.listActiveReservationsByAllocation(ids.G5)).toHaveLength(1);
    const before = await stockOf(ids.v1);
    const view = await retailOrders.cancelRetailOrder(ids.G5, { ...buyer(), reason: "changed mind" });
    expect(view.status).toBe("cancelled");
    expect(await inventory.listActiveReservationsByAllocation(ids.G5)).toHaveLength(0);
    const after = await stockOf(ids.v1);
    expect(after.reserved).toBe(before.reserved - 2);
    expect(after.onHand).toBe(before.onHand);
    const holds = await reservationRows(ids.G5);
    expect(holds.map((row: any) => row.status)).toEqual(["released"]);
    expect(await factRows(ids.G5, "retail_order.cancelled")).toHaveLength(1);
  });

  it("refuses to cancel paid or already-cancelled orders", async () => {
    await expectCode(retailOrders.cancelRetailOrder(ids.G2, { ...buyer(), reason: "too late" }), "RETAIL_CANCEL_PAID_FORBIDDEN");
    await expectCode(retailOrders.cancelRetailOrder(ids.G5, { ...buyer(), reason: "again" }), "RETAIL_TRANSITION_INVALID");
  });

  it("expiry reaps the hold but never the order", async () => {
    await checkoutAs("G6");
    const [hold] = await reservationRows(ids.G6);
    await pool.query(`UPDATE inventory_reservation SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [(hold as any).id]);
    const before = await stockOf(ids.v1);
    await inventory.releaseExpiredReservations(100, users.admin);
    expect(await inventory.listActiveReservationsByAllocation(ids.G6)).toHaveLength(0);
    const holds = await reservationRows(ids.G6);
    expect(holds.map((row: any) => row.status)).toEqual(["expired"]);
    const after = await stockOf(ids.v1);
    expect(after.reserved).toBe(before.reserved - 2);
    const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.G6)).limit(1);
    expect((order as any).orderStatus).toBe("placed");
    expect((order as any).paymentStatus).toBe("unpaid");
  });

  it("verify re-reserves lines whose hold lapsed", async () => {
    const { payment } = await retailOrders.submitPaymentEvidence(ids.G6, buyer(), {
      rail: "manual_transfer",
      amount: totals.G6,
      evidenceReference: "REF-G6",
      idempotencyKey: makeId("ev"),
    });
    const { view } = await retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-G6", idempotencyKey: makeId("verify") });
    expect(view.payment.status).toBe("paid");
    const holds = await reservationRows(ids.G6);
    expect(holds.map((row: any) => row.status).sort()).toEqual(["confirmed", "expired"]);
  });

  it("fails verification closed when stock is gone: payment and order untouched", async () => {
    const body = await checkoutAs("G7", { lines: [{ productId: ids.p2, variantId: ids.v2, quantity: 1 }] });
    expect(body.totals.grandTotal).toBe(totals.G7);
    const { payment } = await retailOrders.submitPaymentEvidence(ids.G7, buyer(), {
      rail: "manual_transfer",
      amount: totals.G7,
      evidenceReference: "REF-G7",
      idempotencyKey: makeId("ev"),
    });
    const [hold] = await reservationRows(ids.G7);
    await pool.query(`UPDATE inventory_reservation SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [(hold as any).id]);
    await inventory.releaseExpiredReservations(100, users.admin);
    await pool.query(`UPDATE product_variant_inventory SET on_hand = 0 WHERE variant_id = $1 AND seller_id = $2`, [ids.v2, kolbeSellerId]);
    await expectCode(retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-G7", idempotencyKey: makeId("verify") }), "RETAIL_INSUFFICIENT_STOCK");
    const rows = await paymentRows(ids.G7);
    expect((rows[0] as any).status).toBe("evidence_submitted");
    const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.G7)).limit(1);
    expect((order as any).paymentStatus).toBe("unpaid");
    expect(await factRows(ids.G7, "retail_order.paid")).toHaveLength(0);
  });

  it("relays the paid fact to a transactional in-app notification", async () => {
    const [fact] = await factRows(ids.G2, "retail_order.paid");
    const result = await relay.relayEvent((fact as any).id);
    expect(result).toMatchObject({ failures: 0, skipped: 0 });
    expect(result.deliveries).toBeGreaterThan(0);
    const events = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (fact as any).id));
    expect(events).toHaveLength(1);
    expect((events[0] as any).eventKey).toBe("RETAIL_ORDER_PAID");
    expect((events[0] as any).payload.totals).toEqual({ items: "500000", shipping: "89000", grand: "589000" });
    const deliveries = await db.select().from(schema.notificationDelivery).where(eq(schema.notificationDelivery.eventId, (events[0] as any).id));
    expect(deliveries).toHaveLength(1);
    expect((deliveries[0] as any).channel).toBe("IN_APP");
    // Dedup: a second relay of the same fact creates nothing new.
    await relay.relayEvent((fact as any).id);
    const eventsAfter = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (fact as any).id));
    expect(eventsAfter).toHaveLength(1);
  });

  it("relays created and cancelled facts under their own keys", async () => {
    const [created] = await factRows(ids.G1, "retail_order.created");
    expect(await relay.relayEvent((created as any).id)).toMatchObject({ failures: 0, skipped: 0 });
    const createdEvents = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (created as any).id));
    expect((createdEvents[0] as any).eventKey).toBe("RETAIL_ORDER_CREATED");
    const [cancelled] = await factRows(ids.G5, "retail_order.cancelled");
    expect(await relay.relayEvent((cancelled as any).id)).toMatchObject({ failures: 0, skipped: 0 });
    const cancelledEvents = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (cancelled as any).id));
    expect((cancelledEvents[0] as any).eventKey).toBe("RETAIL_ORDER_CANCELLED");
  });

  it("skips unknown fact types without writing notifications", async () => {
    // A wholesale event type on a retail aggregate: valid per the CHECK, but
    // not one of the three relay-mapped facts.
    const inserted = await retailRepo.insertOrderEvent({
      id: makeId("evt"),
      aggregateType: "retail_order",
      aggregateId: ids.G1,
      eventType: "order.created",
      payload: { order_code: "RT-0000-XXXXXX" },
      actorId: null,
      actorRole: null,
      idempotencyKey: null,
    });
    expect(await relay.relayEvent((inserted as any).id)).toEqual({ deliveries: 0, failures: 0, skipped: 1 });
    const events = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (inserted as any).id));
    expect(events).toHaveLength(0);
  });

  it("skips facts for orders without an account holder", async () => {
    const [created] = await factRows(ids.C1, "retail_order.created");
    const before = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (created as any).id));
    await pool.query(`UPDATE retail_order SET customer_id = NULL WHERE id = $1`, [ids.C1]);
    expect(await relay.relayEvent((created as any).id)).toEqual({ deliveries: 0, failures: 0, skipped: 1 });
    const after = await db.select().from(schema.notificationEvent).where(eq(schema.notificationEvent.sourceEventId, (created as any).id));
    expect(after).toHaveLength(before.length);
  });
});
