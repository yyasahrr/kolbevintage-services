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
import { ManualTransferProvider } from "../src/modules/payments/manual-transfer.provider";
import { PaymentProviderRegistry } from "../src/modules/payments/payment-provider.registry";
import { PaymentsService } from "../src/modules/payments/payments.service";
import {
  FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER,
  FakePaymentProvider,
} from "../src/modules/payments/providers/fake-payment.provider";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.8-B fixup — retail provider callbacks, payment ownership, and
 * method policies.
 *
 * The wholesale provider-event machinery (adapter auth + normalize, inbox
 * dedupe + claim, server-to-server queryStatus) drives retail callbacks:
 * the event is only a trigger, the provider channel is the truth. Failed
 * payments never touch stock; terminal conflicts are rejections, never
 * rewrites. Payment actions are owner-checked; COD/wallet/installment
 * stay truthful. Real PostgreSQL, full Nest application.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_b_retail_callback_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-b-callback-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let payments: PaymentsService;
let inventory: InventoryService;
let fake: FakePaymentProvider;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_cb58_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin", string>;
const tokens = {} as Record<"custA", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;
const intentOf = {} as Record<string, any>;
let kolbeSellerId = "";

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });
const systemRequester = () => ({ userId: "system", role: "system", principalType: "system" as const });

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
  const response = await request(app.getHttpServer())
    .post("/api/v1/retail/orders")
    .set("authorization", `Bearer ${tokens.custA}`)
    .set("Idempotency-Key", makeId("key"))
    .set("x-kolbe-internal-token", "")
    .send(orderBody(overrides));
  expect(response.status).toBe(201);
  ids[tag] = response.body.id;
  totals[tag] = response.body.totals.grandTotal;
  return response.body;
}

async function gatewayIntent(tag: string) {
  const { payment } = await retailOrders.createPaymentIntent(ids[tag], buyerA(), { idempotencyKey: makeId("intent"), providerName: "fake" });
  intentOf[tag] = payment;
  return payment;
}

const signedHeaders = () => ({ [FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER]: FakePaymentProvider.webhookSecret() });
const webhookBody = (eventId: string, providerReference: string, status: string) => ({ eventId, providerReference, status, currency: "IRR" });
const callback = (providerReference: string, status: string, eventId?: string, headers?: Record<string, string>) =>
  retailOrders.handleRetailProviderCallback("fake", {
    headers: headers ?? signedHeaders(),
    body: webhookBody(eventId ?? makeId("evt"), providerReference, status),
  });

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

async function inboxRow(eventId: string) {
  const [row] = await db.select().from(schema.paymentProviderEvent).where(eq(schema.paymentProviderEvent.externalEventId, eventId)).limit(1);
  return row as any;
}

async function stockOf() {
  const [row] = await db
    .select()
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, ids.v1), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return row;
}

describe("Phase 5.8-B retail provider callbacks + ownership", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-b-retail-callback";
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
    payments = app.get(PaymentsService);
    inventory = app.get(InventoryService);
    fake = app.get(FakePaymentProvider);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    tokens.custA = new SessionVerifier(process.env.KOLBE_SESSION_SECRET).issue(users.custA, "customer", 0);

    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");

    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "CB Product", slug: `cb-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });

    // Wholesale payment fixture: retail paths must never touch it.
    await db.insert(schema.wholesaleAccount).values({ id: "cb_wa", userId: users.custA, memberName: "CB", storeName: "CB Store", phone: "09120000000", city: "Tehran" });
    await db.insert(schema.wholesaleOrder).values({ id: "cb_wo", orderCode: "CB-WO-1", accountId: "cb_wa", buyerUserId: users.custA, status: "confirmed" });
    await db.insert(schema.payment).values({
      id: "cb_wpay", paymentReference: "CB-WS-REF-1", wholesaleOrderId: "cb_wo", method: "online", provider: "fake",
      providerReference: "WS-REF-1", status: "pending", amount: 1000n as any, currency: "IRR",
    });
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

  it("pays the order on a verified provider callback (atomic: paid + confirmed + processed)", async () => {
    await checkoutAs("W1");
    const intent = await gatewayIntent("W1");
    const before = await stockOf();
    const eventId = makeId("evt");
    const result = await callback(intent.providerReference, "payment.success", eventId);
    expect(result.outcome).toBe("paid");
    expect(result.replayed).toBe(false);
    expect(result.view?.payment).toEqual({ method: "gateway", status: "paid", collected: true, requiresManualSettlement: false, refundPending: false });
    const rows = await paymentRows(ids.W1);
    expect(rows.find((row: any) => row.id === intent.id)?.status).toBe("verified");
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
    expect((await inboxRow(eventId)).status).toBe("processed");
  });

  it("replays a duplicate redelivery without a second paid fact", async () => {
    const eventId = makeId("evt");
    const first = await callback(intentOf.W1.providerReference, "payment.success", eventId);
    expect(first.outcome).toBe("paid");
    expect(first.replayed).toBe(true);
    const second = await callback(intentOf.W1.providerReference, "payment.success", eventId);
    expect(second).toMatchObject({ outcome: "replayed", replayed: true });
    const facts = await db
      .select()
      .from(schema.orderEvent)
      .where(and(eq(schema.orderEvent.aggregateId, ids.W1), eq(schema.orderEvent.eventType, "retail_order.paid")));
    expect(facts).toHaveLength(1);
  });

  it("ignores a badly signed webhook and touches nothing", async () => {
    await checkoutAs("W2");
    const intent = await gatewayIntent("W2");
    const eventId = makeId("evt");
    await expectCode(
      retailOrders.handleRetailProviderCallback("fake", {
        headers: { [FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER]: "wrong-secret" },
        body: webhookBody(eventId, intent.providerReference, "payment.success"),
      }),
      "RETAIL_WEBHOOK_UNAUTHENTICATED",
    );
    expect((await inboxRow(eventId)).status).toBe("ignored");
    expect((await paymentRows(ids.W2)).find((row: any) => row.id === intent.id)?.status).toBe("pending");
  });

  it("rejects unknown providers and channel-less providers before touching the inbox", async () => {
    await expectCode(retailOrders.handleRetailProviderCallback("nope", { headers: {}, body: {} }), "PAYMENT_PROVIDER_UNKNOWN");
    await expectCode(
      retailOrders.handleRetailProviderCallback("manual", { headers: {}, body: { status: "payment.success" } }),
      "RETAIL_PROVIDER_EVENT_REJECTED",
    );
  });

  it("rejects a reference the gateway never issued", async () => {
    const eventId = makeId("evt");
    await expectCode(callback("FAKE-NEVER-ISSUED", "payment.success", eventId), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
  });

  it("rejects a provider amount that differs by one rial", async () => {
    await checkoutAs("AMT");
    const intent = await gatewayIntent("AMT");
    fake.setScenario(intent.id, "wrong_amount");
    const eventId = makeId("evt");
    await expectCode(callback(intent.providerReference, "payment.success", eventId), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
    expect((await paymentRows(ids.AMT)).find((row: any) => row.id === intent.id)?.status).toBe("pending");
  });

  it("rejects a provider currency mismatch", async () => {
    await checkoutAs("W3");
    const intent = await gatewayIntent("W3");
    fake.setScenario(intent.id, "wrong_currency");
    const eventId = makeId("evt");
    await expectCode(callback(intent.providerReference, "payment.success", eventId), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
    expect((await paymentRows(ids.W3)).find((row: any) => row.id === intent.id)?.status).toBe("pending");
  });

  it("fails only the row on provider failure: order unpaid, hold kept for retry", async () => {
    await checkoutAs("W4");
    const intent = await gatewayIntent("W4");
    fake.setScenario(intent.id, "failure");
    const before = await stockOf();
    const eventId = makeId("evt");
    // The event claims success; the server channel says failed — the channel wins.
    const result = await callback(intent.providerReference, "payment.success", eventId);
    expect(result.outcome).toBe("failed");
    const row = (await paymentRows(ids.W4)).find((r: any) => r.id === intent.id) as any;
    expect(row.status).toBe("failed");
    expect(row.failureReason).toContain("failure");
    const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.W4)).limit(1);
    expect((order as any).paymentStatus).toBe("unpaid");
    expect(await inventory.listActiveReservationsByAllocation(ids.W4)).toHaveLength(1);
    expect(await stockOf()).toMatchObject({ onHand: before.onHand, reserved: before.reserved });
    expect((await inboxRow(eventId)).status).toBe("processed");
  });

  it("releases a pending event for retry, then pays on redelivery", async () => {
    const intent = intentOf.W2;
    fake.setScenario(intent.id, "pending");
    const eventId = makeId("evt");
    const pending = await callback(intent.providerReference, "payment.success", eventId);
    expect(pending.outcome).toBe("pending");
    expect((await paymentRows(ids.W2)).find((row: any) => row.id === intent.id)?.status).toBe("pending");
    expect((await inboxRow(eventId)).status).toBe("received");
    fake.setScenario(intent.id, "success");
    const paid = await callback(intent.providerReference, "payment.success", eventId);
    expect(paid.outcome).toBe("paid");
    expect(paid.view?.payment.status).toBe("paid");
    expect((await inboxRow(eventId)).status).toBe("processed");
  });

  it("rejects a failure event for an already-paid order (terminal conflict)", async () => {
    const eventId = makeId("evt");
    await expectCode(callback(intentOf.W1.providerReference, "payment.failed", eventId), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
    const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.W1)).limit(1);
    expect((order as any).paymentStatus).toBe("paid");
  });

  it("agrees with a failure replay on a failed payment", async () => {
    const replayed = await callback(intentOf.W4.providerReference, "payment.failed", makeId("evt"));
    expect(replayed).toMatchObject({ outcome: "failed", replayed: true });
  });

  it("forbids cross-customer payment actions while staff bypass", async () => {
    await checkoutAs("OWN");
    await expectCode(retailOrders.createPaymentIntent(ids.OWN, buyerB(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.OWN, buyerB(), { rail: "manual_transfer", amount: totals.OWN, evidenceReference: "X", idempotencyKey: makeId("ev") }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    await expectCode(
      retailOrders.createPaymentIntent(ids.OWN, { actorId: null, actorRole: "guest" }, { idempotencyKey: makeId("intent"), providerName: "fake" }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    const staff = await retailOrders.createPaymentIntent(ids.OWN, admin(), { idempotencyKey: makeId("intent"), providerName: "fake" });
    expect(staff.payment.retailOrderId).toBe(ids.OWN);
  });

  it("pays COD on collection proof: hold at checkout, confirm at verify (B12)", async () => {
    const body = await checkoutAs("COD1", { payMethod: "cod" });
    expect(body.payment).toEqual({ method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false, refundPending: false });
    expect(await inventory.listActiveReservationsByAllocation(ids.COD1)).toHaveLength(1);
    const before = await stockOf();
    const { payment } = await retailOrders.submitPaymentEvidence(ids.COD1, buyerA(), {
      rail: "cod",
      amount: totals.COD1,
      evidenceReference: "COD-PROOF-1",
      idempotencyKey: makeId("ev"),
    });
    const { view } = await retailOrders.verifyPayment(payment.id, admin(), { externalReference: "BANK-COD-1", idempotencyKey: makeId("verify") });
    expect(view.payment).toEqual({ method: "cod", status: "paid", collected: true, requiresManualSettlement: false, refundPending: false });
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
  });

  it("keeps wallet/installment truthful and retail-only (B8/B24)", async () => {
    const wallet = await checkoutAs("WAL1", { payMethod: "wallet" });
    expect(wallet.payment).toEqual({ method: "wallet", status: "unpaid", collected: false, requiresManualSettlement: true, refundPending: false });
    await expectCode(retailOrders.createPaymentIntent(ids.WAL1, buyerA(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_INTENT_METHOD_UNSUPPORTED");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.WAL1, buyerA(), {
      rail: "manual_transfer",
      amount: totals.WAL1,
      evidenceReference: "WALLET-EXT-1",
      idempotencyKey: makeId("ev"),
    });
    expect(payment.status).toBe("evidence_submitted");
    expect(payment.provider).toBe("manual");
    const [row] = (await paymentRows(ids.WAL1)).filter((r: any) => r.id === payment.id) as any[];
    expect(row.wholesaleOrderId).toBeNull();
    const installment = await checkoutAs("INS1", { payMethod: "installment" });
    expect(installment.payment).toEqual({ method: "installment", status: "unpaid", collected: false, requiresManualSettlement: true, refundPending: false });
    await expectCode(retailOrders.createPaymentIntent(ids.INS1, buyerA(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_INTENT_METHOD_UNSUPPORTED");
  });

  it("cannot touch wholesale payments from retail paths (B26)", async () => {
    const eventId = makeId("evt");
    await expectCode(callback("WS-REF-1", "payment.success", eventId), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
    await expectCode(
      payments.verifyRetailPaymentRow({ paymentId: "cb_wpay", adminUserId: users.admin, externalReference: "X", idempotencyKey: makeId("verify"), actorRole: "admin" }),
      "RETAIL_PAYMENT_EXPECTED",
    );
    const [ws] = await db.select().from(schema.payment).where(eq(schema.payment.id, "cb_wpay")).limit(1);
    expect((ws as any).status).toBe("pending");
  });

  it("replays confirmation harmlessly: stock consumed exactly once", async () => {
    await checkoutAs("CNF");
    const [hold] = await inventory.listActiveReservationsByAllocation(ids.CNF);
    const before = await stockOf();
    const key = makeId("idem");
    const first = await inventory.confirmRetail({ reservationId: (hold as any).id, requester: systemRequester(), reason: "cb confirm", idempotencyKey: key });
    expect((first as any).replayed).not.toBe(true);
    const second = await inventory.confirmRetail({ reservationId: (hold as any).id, requester: systemRequester(), reason: "cb confirm", idempotencyKey: key });
    expect((second as any).replayed).toBe(true);
    const after = await stockOf();
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
  });

  it("replays release harmlessly: stock restored exactly once", async () => {
    await checkoutAs("RLS");
    const [hold] = await inventory.listActiveReservationsByAllocation(ids.RLS);
    const before = await stockOf();
    const key = makeId("idem");
    await inventory.releaseRetail({ reservationId: (hold as any).id, requester: systemRequester(), reason: "cb release", idempotencyKey: key });
    const second = await inventory.releaseRetail({ reservationId: (hold as any).id, requester: systemRequester(), reason: "cb release", idempotencyKey: key });
    expect((second as any).replayed).toBe(true);
    const after = await stockOf();
    expect(after.reserved).toBe(before.reserved - 2);
    expect(after.onHand).toBe(before.onHand);
  });

  it("refuses to construct a fake-enabled registry in production (B21)", async () => {
    const saved = { nodeEnv: process.env.NODE_ENV, mode: process.env.PAYMENT_PROVIDER_MODE, provider: process.env.WHOLESALE_PAYMENT_PROVIDER };
    try {
      process.env.NODE_ENV = "production";
      process.env.PAYMENT_PROVIDER_MODE = "fake";
      expect(() => new PaymentProviderRegistry(new ManualTransferProvider(), new FakePaymentProvider())).toThrow(/prohibited in production/);
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      if (saved.mode === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
      else process.env.PAYMENT_PROVIDER_MODE = saved.mode;
      if (saved.provider === undefined) delete process.env.WHOLESALE_PAYMENT_PROVIDER;
      else process.env.WHOLESALE_PAYMENT_PROVIDER = saved.provider;
    }
  });

  it("blocks fake resolution in production even when constructed earlier (B21)", async () => {
    const registry = new PaymentProviderRegistry(new ManualTransferProvider(), new FakePaymentProvider());
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => registry.resolve("fake")).toThrow(/prohibited in production/);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });
});
