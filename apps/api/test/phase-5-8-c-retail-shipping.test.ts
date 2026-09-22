import path from "node:path";
import fs from "node:fs";
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
import { FakeShippingProvider } from "../src/modules/shipping/providers/fake-shipping.provider";
import { ManualShippingProvider } from "../src/modules/shipping/providers/manual-shipping.provider";
import { ShippingProviderRegistry } from "../src/modules/shipping/shipping-provider.registry";
import { ShippingService } from "../src/modules/shipping/shipping.service";

/**
 * Phase 5.8-C — retail shipping + fulfillment lifecycle.
 *
 * Service-level over HTTP-created orders (Checkpoint D owns the operator
 * HTTP surface): server-side quotes, fulfillment gates (paid-or-COD),
 * confirm/pack/shipment/handoff/delivery orchestration, idempotent
 * creation, carrier webhooks vs operator attestation, cancel coordination
 * (in-flight refusal, warehouse-cancel + restock), the customer shipment
 * read, and the fulfillment notification relay. Real PostgreSQL, full Nest
 * application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_c_retail_shipping_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-c-shipping-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let retailRepo: RetailOrdersRepository;
let inventory: InventoryService;
let relay: RetailNotificationRelayService;
let shipping: ShippingService;
let fakeShipping: FakeShippingProvider;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_c58_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin", string>;
const tokens = {} as Record<"custA" | "custB" | "admin", string>;
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

const getShipmentHttp = (orderId: string, token: string) =>
  request(app.getHttpServer()).get(`/api/v1/retail/orders/${orderId}/shipment`).set("authorization", `Bearer ${token}`);

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
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${tag}-VERIFY`,
    idempotencyKey: makeId("verify"),
  });
  expect(view.payment.status).toBe("paid");
  return view;
}

async function confirmPack(orderId: string) {
  await retailOrders.confirmRetailOrder(orderId, admin());
  return retailOrders.packRetailOrder(orderId, admin());
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

async function retailLineIds(orderId: string) {
  const rows = await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, orderId));
  return rows.map((row: any) => row.id as string);
}

async function factRows(orderId: string, eventType: string) {
  return db
    .select()
    .from(schema.orderEvent)
    .where(and(eq(schema.orderEvent.aggregateType, "retail_order"), eq(schema.orderEvent.aggregateId, orderId), eq(schema.orderEvent.eventType, eventType)));
}

async function historyRows(orderId: string) {
  return db.select().from(schema.retailOrderEvent).where(eq(schema.retailOrderEvent.orderId, orderId));
}

async function auditActions(entityId: string) {
  const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId));
  return rows.map((row: any) => row.action as string);
}

async function inboxRow(eventId: string) {
  const [row] = await db.select().from(schema.shipmentEvent).where(eq(schema.shipmentEvent.externalEventId, eventId)).limit(1);
  return row as any;
}

async function stockOf(variantId: string) {
  const [row] = await db
    .select()
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, variantId), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return row as any;
}

async function activeHolds(orderId: string) {
  return inventory.listActiveReservationsByAllocation(orderId);
}

const shipSignedHeaders = () => ({ "x-fake-shipping-signature": FakeShippingProvider.webhookSecret() });

async function fakeWebhook(body: Record<string, unknown>, headers: Record<string, string> | null = null) {
  return retailOrders.handleRetailCarrierWebhook("fake", { headers: (headers ?? shipSignedHeaders()) as any, body });
}

describe("Phase 5.8-C retail shipping + fulfillment lifecycle", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-c-retail-shipping";
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
    retailRepo = app.get(RetailOrdersRepository);
    inventory = app.get(InventoryService);
    relay = app.get(RetailNotificationRelayService);
    shipping = app.get(ShippingService);
    fakeShipping = app.get(FakeShippingProvider);

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
    await db.insert(schema.product).values({ id: ids.p1, name: "C Product One", slug: `c1-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });

    ids.p2 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p2, name: "C Product Two", slug: `c2-${ids.p2}`, ownerType: "KOLBE", status: "published" });
    ids.v2 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v2, productId: ids.p2, sku: `SKU-${ids.v2}`, status: "active", attributes: { size: "S" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p2, sellerId: kolbeSellerId, variantId: ids.v2, sku: `OFFER-${ids.v2}`, status: "published", retailPrice: 100000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v2, sellerId: kolbeSellerId, onHand: 10, reserved: 0, status: "active" });

    // Published IN_APP templates for the four fulfillment relay keys.
    const templates = app.get(NotificationTemplateService);
    for (const [key, subject, body] of [
      ["RETAIL_ORDER_CONFIRMED", "سفارش {{orderCode}} تأیید شد", "سفارش {{orderCode}} برای ارسال تأیید شد."],
      ["RETAIL_SHIPMENT_CREATED", "مرسوله {{orderCode}} ایجاد شد", "مرسوله سفارش {{orderCode}} ایجاد شد."],
      ["RETAIL_SHIPMENT_HANDED_OVER", "مرسوله {{orderCode}} تحویل شد", "مرسوله سفارش {{orderCode}} تحویل حامل شد."],
      ["RETAIL_SHIPMENT_DELIVERED", "سفارش {{orderCode}} رسید", "سفارش {{orderCode}} تحویل گیرنده شد."],
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

    // Wholesale shipment the retail paths must never see (C24).
    await db.insert(schema.wholesaleAccount).values({ id: "cc_wa", userId: users.custA, memberName: "CC", storeName: "CC Store", phone: "09120000000", city: "Tehran" });
    await db.insert(schema.wholesaleOrder).values({ id: "cc_wo", orderCode: "CC-WO-1", accountId: "cc_wa", buyerUserId: users.custA, status: "confirmed" });
    await db.insert(schema.purchaseOrder).values({ id: "cc_po", orderCode: "CC-PO-1", sellerId: kolbeSellerId, wholesaleOrderId: "cc_wo", status: "confirmed" });
    await db.insert(schema.shipment).values({
      id: "cc_wsh", shipmentCode: "SHP-CC-WS-1", wholesaleOrderId: "cc_wo", childOrderId: "cc_po",
      sellerId: kolbeSellerId, provider: "fake", status: "in_transit", externalReference: "WS-EXT-1", trackingCode: "WS-TRK-1",
    } as any);
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

  it("C1 resolves retail shipping quotes server-side from the shared rules", async () => {
    expect(retailOrders.resolveRetailQuote("post", 1000000n, false)).toMatchObject({ version: "retail-ship-v1", method: "post", amount: 59000n, currency: "IRR", freeApplied: false });
    expect(retailOrders.resolveRetailQuote("pishtaz", 500000n, false).amount).toBe(89000n);
    expect(retailOrders.resolveRetailQuote("tipax", 100n, false).amount).toBe(145000n);
    // Free at/above the threshold, and always free for cash-on-delivery.
    expect(retailOrders.resolveRetailQuote("pishtaz", 3000000n, false)).toMatchObject({ amount: 0n, freeApplied: true });
    expect(retailOrders.resolveRetailQuote("tipax", 100n, true)).toMatchObject({ amount: 0n, freeApplied: true });
    await expectCode(Promise.resolve().then(() => retailOrders.resolveRetailQuote("drone", 100n, false)), "RETAIL_SHIPPING_METHOD_INVALID");
  });

  it("C2 ignores browser shipping prices; the shipment snapshots the server quote", async () => {
    const body = await checkoutAs("Q1", { shippingPrice: 1 });
    expect(body.totals.shippingTotal).toBe("89000");
    await payOrderGateway("Q1");
    await confirmPack(ids.Q1);
    const created = await retailOrders.createRetailShipment(ids.Q1, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    expect(created.shipment.quoteSnapshot).toMatchObject({ rulesVersion: "retail-ship-v1", method: "pishtaz", amount: "89000", currency: "IRR", freeApplied: false });
    // The order's own totals are immutable history: shipping never moves them.
    const reread = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.Q1);
    expect(reread.totals.shippingTotal).toBe("89000");
    expect(reread.totals.grandTotal).toBe(body.totals.grandTotal);
  });

  it("C3 links the retail shipment to the retail order with no wholesale side", async () => {
    await checkoutAs("S1");
    await payOrderGateway("S1");
    await confirmPack(ids.S1);
    const created = await retailOrders.createRetailShipment(ids.S1, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    expect(created.replayed).toBe(false);
    expect(created.shipment.retailOrderId).toBe(ids.S1);
    expect(created.shipment.wholesaleOrderId).toBeNull();
    expect(created.shipment.childOrderId).toBeNull();
    expect(created.shipment.shipmentCode).toMatch(/^RSHP-/);
    expect(created.shipment.status).toBe("ready");
    expect(created.items).toHaveLength(1);
    const item = created.items[0] as any;
    expect(item.retailOrderItemId).toBe((await retailLineIds(ids.S1))[0]);
    expect(item.wholesaleOrderItemId).toBeNull();
    expect(item.pieceQuantity).toBe(2);
    // Fulfillment acts are staff-only: buyers cannot self-ship.
    await expectCode(retailOrders.createRetailShipment(ids.S1, buyer(), { idempotencyKey: makeId("ship") }), "RETAIL_ORDER_FORBIDDEN");
  });

  it("C4 requires no wholesale child for retail fulfillment", async () => {
    await checkoutAs("S4");
    await payOrderGateway("S4");
    await confirmPack(ids.S4);
    const before = await db.select().from(schema.purchaseOrder);
    await retailOrders.createRetailShipment(ids.S4, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const after = await db.select().from(schema.purchaseOrder);
    expect(after.length).toBe(before.length);
    const [row] = await shipmentRows(ids.S4);
    expect((row as any).childOrderId).toBeNull();
  });

  it("C5 replays a duplicate shipment command but bounds cumulative quantity", async () => {
    await checkoutAs("S5");
    await payOrderGateway("S5");
    await confirmPack(ids.S5);
    const key = makeId("ship");
    const first = await retailOrders.createRetailShipment(ids.S5, admin(), { idempotencyKey: key, providerName: "manual" });
    const second = await retailOrders.createRetailShipment(ids.S5, admin(), { idempotencyKey: key, providerName: "manual" });
    expect(second.replayed).toBe(true);
    expect(second.shipment.id).toBe(first.shipment.id);
    expect(await shipmentRows(ids.S5)).toHaveLength(1);
    // A second command for the fully shipped line is bounded, not silently partial.
    await expectCode(retailOrders.createRetailShipment(ids.S5, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" }), "RETAIL_SHIPMENT_QUANTITY_EXCEEDED");
  });

  it("C6 bounds shipment item quantities to ordered quantities", async () => {
    await checkoutAs("S6");
    await payOrderGateway("S6");
    await confirmPack(ids.S6);
    const [lineId] = await retailLineIds(ids.S6);
    await expectCode(
      retailOrders.createRetailShipment(ids.S6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 3 }] }),
      "RETAIL_SHIPMENT_QUANTITY_EXCEEDED",
    );
    const first = await retailOrders.createRetailShipment(ids.S6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] });
    expect((first.items[0] as any).pieceQuantity).toBe(1);
    await retailOrders.createRetailShipment(ids.S6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] });
    await expectCode(
      retailOrders.createRetailShipment(ids.S6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] }),
      "RETAIL_SHIPMENT_QUANTITY_EXCEEDED",
    );
    expect(await shipmentRows(ids.S6)).toHaveLength(2);
  });

  it("C7 rejects cross-order shipment items", async () => {
    await checkoutAs("S7a");
    await payOrderGateway("S7a");
    await confirmPack(ids.S7a);
    await checkoutAs("S7b");
    await payOrderGateway("S7b");
    await confirmPack(ids.S7b);
    const [foreignLine] = await retailLineIds(ids.S7a);
    await expectCode(
      retailOrders.createRetailShipment(ids.S7b, admin(), { idempotencyKey: makeId("ship"), items: [{ retailOrderItemId: foreignLine, quantity: 1 }] }),
      "RETAIL_SHIPMENT_ITEM_MISMATCH",
    );
    expect(await shipmentRows(ids.S7b)).toHaveLength(0);
  });

  it("C8 rejects fulfillment before financial readiness", async () => {
    await checkoutAs("U8");
    await expectCode(retailOrders.confirmRetailOrder(ids.U8, admin()), "RETAIL_FULFILLMENT_NOT_READY");
    await expectCode(retailOrders.createRetailShipment(ids.U8, admin(), { idempotencyKey: makeId("ship") }), "RETAIL_FULFILLMENT_NOT_READY");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.U8);
    expect(view.status).toBe("placed");
    expect(await shipmentRows(ids.U8)).toHaveLength(0);
  });

  it("C9 refuses provider-backed shipment for unpaid orders without calling the carrier", async () => {
    await checkoutAs("U9");
    const externalBefore = fakeShipping.externalShipmentCount();
    await expectCode(retailOrders.createRetailShipment(ids.U9, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" }), "RETAIL_FULFILLMENT_NOT_READY");
    expect(fakeShipping.externalShipmentCount()).toBe(externalBefore);
  });

  it("C10 ships COD unpaid with inline stock confirmation (explicit policy)", async () => {
    await checkoutAs("COD10", { payMethod: "cod" });
    const before = await stockOf(ids.v1);
    await confirmPack(ids.COD10);
    const created = await retailOrders.createRetailShipment(ids.COD10, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    expect(created.shipment.status).toBe("ready");
    expect(created.shipment.quoteSnapshot).toMatchObject({ method: "pishtaz", amount: "0", freeApplied: true });
    expect(await activeHolds(ids.COD10)).toHaveLength(0);
    const after = await stockOf(ids.v1);
    expect(after.onHand).toBe(before.onHand - 2);
    expect(after.reserved).toBe(before.reserved - 2);
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.COD10);
    expect(view.payment).toMatchObject({ method: "cod", status: "pending_cod", collected: false });
    // A lapsed COD hold is re-secured at shipment time (same order, second line of defense).
    await checkoutAs("COD10b", { payMethod: "cod", lines: [{ productId: ids.p2, variantId: ids.v2, quantity: 1 }] });
    const [hold] = await activeHolds(ids.COD10b);
    await inventory.releaseRetail({ reservationId: (hold as any).id, requester: { userId: "system", role: "system", principalType: "system" } as any, reason: "c10 lapse simulation", idempotencyKey: makeId("lapse") });
    await confirmPack(ids.COD10b);
    const beforeB = await stockOf(ids.v2);
    await retailOrders.createRetailShipment(ids.COD10b, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const afterB = await stockOf(ids.v2);
    expect(afterB.onHand).toBe(beforeB.onHand - 1);
    expect(await activeHolds(ids.COD10b)).toHaveLength(0);
  });

  it("C11 keeps manual shipments operator-managed: no external refs, operator handoff", async () => {
    await checkoutAs("M11");
    await payOrderGateway("M11");
    await confirmPack(ids.M11);
    const created = await retailOrders.createRetailShipment(ids.M11, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    expect(created.shipment.provider).toBe("manual");
    expect(created.shipment.externalReference).toBeNull();
    expect(created.shipment.trackingCode).toBeNull();
    expect(created.shipment.trackingUrl).toBeNull();
    const handoff = await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    expect(handoff.shipment.status).toBe("handed_over");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.M11);
    expect(view.status).toBe("shipped");
  });

  it("C12a refuses to construct a fake-enabled shipping registry in production", async () => {
    const saved = { nodeEnv: process.env.NODE_ENV, mode: process.env.SHIPPING_PROVIDER_MODE, provider: process.env.WHOLESALE_SHIPPING_PROVIDER };
    try {
      process.env.NODE_ENV = "production";
      process.env.SHIPPING_PROVIDER_MODE = "fake";
      expect(() => new ShippingProviderRegistry(new ManualShippingProvider(), new FakeShippingProvider())).toThrow(/prohibited in production/);
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      if (saved.mode === undefined) delete process.env.SHIPPING_PROVIDER_MODE;
      else process.env.SHIPPING_PROVIDER_MODE = saved.mode;
      if (saved.provider === undefined) delete process.env.WHOLESALE_SHIPPING_PROVIDER;
      else process.env.WHOLESALE_SHIPPING_PROVIDER = saved.provider;
    }
  });

  it("C12b blocks fake shipping resolution in production even when constructed earlier", async () => {
    const registry = new ShippingProviderRegistry(new ManualShippingProvider(), new FakeShippingProvider());
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => registry.resolve("fake")).toThrow(/prohibited in production/);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });

  it("C13 treats duplicate tracking events as harmless replays", async () => {
    await checkoutAs("F13");
    await payOrderGateway("F13");
    await confirmPack(ids.F13);
    const created = await retailOrders.createRetailShipment(ids.F13, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const ext = created.shipment.externalReference as string;
    const trk = created.shipment.trackingCode as string;
    expect(ext).toMatch(/^EXT-/);
    expect(trk).toMatch(/^TRK-/);
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    fakeShipping.setCarrierState(ext, "in_transit");
    const eventId = makeId("evt");
    const first = await fakeWebhook({ eventId, externalReference: ext, trackingCode: trk, state: "in_transit" });
    expect(first.status).toBe("processed");
    const second = await fakeWebhook({ eventId, externalReference: ext, trackingCode: trk, state: "in_transit" });
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe("processed");
    const current = await shipping.getRetailShipmentById(created.shipment.id);
    expect((current.shipment as any).status).toBe("in_transit");
    const transitions = (await auditActions(created.shipment.id)).filter((action) => action === "shipping.shipment_in_transit");
    expect(transitions).toHaveLength(1);
  });

  it("C14 rejects backward tracking transitions without touching state", async () => {
    await checkoutAs("F14");
    await payOrderGateway("F14");
    await confirmPack(ids.F14);
    const created = await retailOrders.createRetailShipment(ids.F14, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const ext = created.shipment.externalReference as string;
    const trk = created.shipment.trackingCode as string;
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    fakeShipping.setCarrierState(ext, "in_transit");
    await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" });
    fakeShipping.setCarrierState(ext, "delivered");
    await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "delivered" });
    // Backward claim against the terminal parcel: kept as a fact, rejected as a move.
    fakeShipping.setCarrierState(ext, "in_transit");
    const backward = await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" });
    expect(backward.status).toBe("ignored");
    expect(backward.reason).toMatch(/^backward_transition_rejected/);
    const current = await shipping.getRetailShipmentById(created.shipment.id);
    expect((current.shipment as any).status).toBe("delivered");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F14);
    expect(view.status).toBe("delivered");
    // Terminal agreement still replays cleanly.
    fakeShipping.setCarrierState(ext, "delivered");
    const agree = await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "delivered" });
    expect(agree.status).toBe("processed");
    expect(agree.reason).toBe("already_delivered");
  });

  it("C15 binds both carrier refs to one shipment; cross-order scans are rejected", async () => {
    await checkoutAs("F15a");
    await payOrderGateway("F15a");
    await confirmPack(ids.F15a);
    const a = await retailOrders.createRetailShipment(ids.F15a, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    await retailOrders.markRetailShipmentHandoff(a.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await checkoutAs("F15b");
    await payOrderGateway("F15b");
    await confirmPack(ids.F15b);
    const b = await retailOrders.createRetailShipment(ids.F15b, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    await retailOrders.markRetailShipmentHandoff(b.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    const eventId = makeId("evt");
    await expectCode(
      fakeWebhook({ eventId, externalReference: a.shipment.externalReference, trackingCode: b.shipment.trackingCode, state: "in_transit" }),
      "RETAIL_PROVIDER_EVENT_REJECTED",
    );
    expect((await inboxRow(eventId)).status).toBe("failed");
    expect(((await shipping.getRetailShipmentById(a.shipment.id)).shipment as any).status).toBe("handed_over");
    expect(((await shipping.getRetailShipmentById(b.shipment.id)).shipment as any).status).toBe("handed_over");
  });

  it("C16 records handoff explicitly: shipment handed_over, order shipped, replay-safe", async () => {
    await checkoutAs("F16");
    await payOrderGateway("F16");
    await confirmPack(ids.F16);
    const created = await retailOrders.createRetailShipment(ids.F16, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const key = makeId("hand");
    const first = await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: key });
    expect(first.replayed).toBe(false);
    expect(first.shipment.status).toBe("handed_over");
    const second = await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: key });
    expect(second.replayed).toBe(true);
    await expectCode(retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") }), "INVALID_SHIPMENT_TRANSITION");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.F16);
    expect(view.status).toBe("shipped");
    const shipped = (await historyRows(ids.F16)).find((row: any) => row.toStatus === "shipped") as any;
    expect(shipped).toBeDefined();
    expect(shipped.reason).toBe("shipment_handed_over");
    expect(await factRows(ids.F16, "retail_order.shipment_handed_over")).toHaveLength(1);
  });

  it("C17 advances in_transit via operator attestation on manual shipments", async () => {
    await checkoutAs("M17");
    await payOrderGateway("M17");
    await confirmPack(ids.M17);
    const created = await retailOrders.createRetailShipment(ids.M17, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    const first = await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "in_transit", note: "parcel scanned at depot" });
    expect(first.status).toBe("processed");
    const again = await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "in_transit" });
    expect(again.duplicate).toBe(true);
    const current = await shipping.getRetailShipmentById(created.shipment.id);
    expect((current.shipment as any).status).toBe("in_transit");
    // Attestation cannot move carrier-backed freight: fake answers to carrier truth only.
    await checkoutAs("F17");
    await payOrderGateway("F17");
    await confirmPack(ids.F17);
    const fake = await retailOrders.createRetailShipment(ids.F17, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    await expectCode(retailOrders.recordRetailManualTracking(fake.shipment.id, admin(), { state: "in_transit" }), "RETAIL_PROVIDER_EVENT_REJECTED");
    // And carrier webhooks cannot move operator-managed freight.
    await expectCode(fakeWebhook({ eventId: makeId("evt"), externalReference: "MANUAL-NEVER-ISSUED", state: "in_transit" }), "RETAIL_PROVIDER_EVENT_REJECTED");
  });

  it("C18 delivers the shipment on carrier delivery", async () => {
    await checkoutAs("F18");
    await payOrderGateway("F18");
    await confirmPack(ids.F18);
    const created = await retailOrders.createRetailShipment(ids.F18, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    const ext = created.shipment.externalReference as string;
    const trk = created.shipment.trackingCode as string;
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    fakeShipping.setCarrierState(ext, "in_transit");
    await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" });
    fakeShipping.setCarrierState(ext, "delivered");
    const outcome = await fakeWebhook({ eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "delivered" });
    expect(outcome.status).toBe("processed");
    const current = await shipping.getRetailShipmentById(created.shipment.id);
    expect((current.shipment as any).status).toBe("delivered");
    expect((current.shipment as any).deliveredAt).not.toBeNull();
  });

  it("C19 delivers the order only when every line is fully delivered (contract fan-out)", async () => {
    await checkoutAs("P19");
    await payOrderGateway("P19");
    await confirmPack(ids.P19);
    const [lineId] = await retailLineIds(ids.P19);
    const first = await retailOrders.createRetailShipment(ids.P19, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] });
    await retailOrders.markRetailShipmentHandoff(first.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    const partial = await retailOrders.recordRetailManualTracking(first.shipment.id, admin(), { state: "delivered" });
    expect(partial.status).toBe("processed");
    expect(partial.reason).toBe("partial_delivery_order_stays_shipped");
    let view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.P19);
    expect(view.status).toBe("shipped");
    expect(await factRows(ids.P19, "retail_order.shipment_delivered")).toHaveLength(0);
    const second = await retailOrders.createRetailShipment(ids.P19, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineId, quantity: 1 }] });
    await retailOrders.markRetailShipmentHandoff(second.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(second.shipment.id, admin(), { state: "delivered" });
    view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.P19);
    expect(view.status).toBe("delivered");
    // The fan-out went through the Orders contract: the history row is the proof.
    const delivered = (await historyRows(ids.P19)).find((row: any) => row.toStatus === "delivered") as any;
    expect(delivered).toBeDefined();
    expect(delivered.fromStatus).toBe("shipped");
    expect(delivered.reason).toBe("shipment_delivered");
    expect(delivered.actorRole).toBe("admin"); // operator-attested delivery attributes the operator (carrier webhooks attribute system)
    expect(await factRows(ids.P19, "retail_order.shipment_delivered")).toHaveLength(1);
  });

  it("C20 keeps Shipping SQL off retail_order (static: no direct order mutation)", async () => {
    const sources = ["shipping.service.ts", "shipping.orchestrator.ts", "shipping-provider.registry.ts"]
      .map((file) => fs.readFileSync(path.join(ROOT, "apps", "api", "src", "modules", "shipping", file), "utf8"))
      .join("\n");
    for (const pattern of [/INSERT\s+INTO\s+"?retail_order"?\b/i, /UPDATE\s+"?retail_order"?\b/i, /DELETE\s+FROM\s+"?retail_order"?\b/i, /insert\(\s*retailOrder\b/, /\.update\(\s*retailOrder\b/, /updateStatus\(/]) {
      expect(sources).not.toMatch(pattern);
    }
    // Retail orchestration performs the fan-out through transitionOrder (C19 proves the history row).
    const retail = fs.readFileSync(path.join(ROOT, "apps", "api", "src", "modules", "orders", "retail", "retail-orders.service.ts"), "utf8");
    expect(retail).toMatch(/transitionOrder\(orderId, "delivered"/);
  });

  it("C21 releases reservation + restocks on pre-shipment cancel", async () => {
    await checkoutAs("CC21", { payMethod: "cod" });
    const pristine = await stockOf(ids.v1);
    await confirmPack(ids.CC21);
    await retailOrders.createRetailShipment(ids.CC21, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const shipped = await stockOf(ids.v1);
    expect(shipped.onHand).toBe(pristine.onHand - 2);
    const view = await retailOrders.cancelRetailOrder(ids.CC21, { actorId: users.custA, actorRole: "customer", reason: "changed mind" });
    expect(view.status).toBe("cancelled");
    const [shipment] = await shipmentRows(ids.CC21);
    expect((shipment as any).status).toBe("cancelled");
    expect(await activeHolds(ids.CC21)).toHaveLength(0);
    const restored = await stockOf(ids.v1);
    expect(restored.onHand).toBe(pristine.onHand);
    expect(restored.reserved).toBe(pristine.reserved - 2);
    expect(await factRows(ids.CC21, "retail_order.cancelled")).toHaveLength(1);
  });

  it("C22 replays cancel harmlessly: stable state, single fact", async () => {
    const before = await stockOf(ids.v1);
    await expectCode(retailOrders.cancelRetailOrder(ids.CC21, { actorId: users.custA, actorRole: "customer" }), "RETAIL_TRANSITION_INVALID");
    expect(await factRows(ids.CC21, "retail_order.cancelled")).toHaveLength(1);
    const [shipment] = await shipmentRows(ids.CC21);
    expect((shipment as any).status).toBe("cancelled");
    const after = await stockOf(ids.v1);
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(before.reserved);
  });

  it("C23 refuses paid cancel without money movement", async () => {
    await checkoutAs("PC23");
    await payOrderGateway("PC23");
    await expectCode(retailOrders.cancelRetailOrder(ids.PC23, { actorId: users.custA, actorRole: "customer" }), "RETAIL_CANCEL_PAID_FORBIDDEN");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.PC23);
    expect(view.status).toBe("placed");
    expect(view.payment.status).toBe("paid");
    const payments = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.PC23));
    expect(payments).toHaveLength(1);
    expect((payments[0] as any).status).toBe("verified");
  });

  it("C24 cannot touch wholesale shipments from retail paths", async () => {
    const eventId = makeId("evt");
    await expectCode(fakeWebhook({ eventId, externalReference: "WS-EXT-1", trackingCode: "WS-TRK-1", state: "delivered" }), "RETAIL_PROVIDER_EVENT_REJECTED");
    expect((await inboxRow(eventId)).status).toBe("failed");
    await expectCode(Promise.resolve().then(() => shipping.getRetailShipmentById("cc_wsh")), "SHIPMENT_NOT_FOUND");
    const [ws] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, "cc_wsh")).limit(1);
    expect((ws as any).status).toBe("in_transit");
    expect((ws as any).retailOrderId).toBeNull();
  });

  it("C25 scopes shipment reads to the owner (IDOR)", async () => {
    await checkoutAs("R25");
    await payOrderGateway("R25");
    await confirmPack(ids.R25);
    await retailOrders.createRetailShipment(ids.R25, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await getShipmentHttp(ids.R25, tokens.custB).expect(403);
    const own = await getShipmentHttp(ids.R25, tokens.custA).expect(200);
    expect(own.body.orderId).toBe(ids.R25);
    expect(own.body.shipments).toHaveLength(1);
    expect(own.body.shipments[0]).toMatchObject({ provider: "manual", method: "pishtaz", status: "ready" });
    expect(own.body.shipments[0]).not.toHaveProperty("externalReference");
    expect(own.body.shipments[0].items[0]).toMatchObject({ quantity: 2 });
    await getShipmentHttp(ids.R25, tokens.admin).expect(200);
    await getShipmentHttp("rord_missing", tokens.custA).expect(404);
  });

  it("C26 retains audit + history across the lifecycle", async () => {
    await checkoutAs("A26");
    await payOrderGateway("A26");
    await confirmPack(ids.A26);
    const created = await retailOrders.createRetailShipment(ids.A26, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    fakeShipping.setCarrierState(created.shipment.externalReference, "delivered");
    await fakeWebhook({ eventId: makeId("evt"), externalReference: created.shipment.externalReference, trackingCode: created.shipment.trackingCode, state: "delivered" });
    const orderAudit = await auditActions(ids.A26);
    for (const action of ["retail_order.confirmed", "retail_order.status_changed"]) {
      expect(orderAudit).toContain(action);
    }
    const shipmentAudit = await auditActions(created.shipment.id);
    for (const action of ["shipping.shipment_created", "shipping.shipment_ready", "shipping.shipment_handed_over", "shipping.shipment_delivered", "retail_order.shipment_created", "retail_order.shipment_handed_over", "retail_order.shipment_delivered"]) {
      expect(shipmentAudit).toContain(action);
    }
    const history = (await historyRows(ids.A26)) as any[];
    expect(history.map((row) => row.toStatus)).toEqual(["placed", "confirmed", "packed", "shipped", "delivered"]);
    const versions = history.map((row) => row.orderVersion);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  it("C27 isolates notification failure from commerce truth", async () => {
    await checkoutAs("N27");
    await payOrderGateway("N27");
    await confirmPack(ids.N27);
    const created = await retailOrders.createRetailShipment(ids.N27, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    // Drop one template: the relay fails the delivery, commerce stays delivered.
    const [doomed] = await db.select().from(schema.notificationTemplate).where(eq(schema.notificationTemplate.templateKey, "retail_shipment_created_inapp"));
    await db.delete(schema.notificationTemplateVersion).where(eq(schema.notificationTemplateVersion.templateId, (doomed as any).id));
    await db.delete(schema.notificationTemplate).where(eq(schema.notificationTemplate.templateKey, "retail_shipment_created_inapp"));
    const [createdFact] = await factRows(ids.N27, "retail_order.shipment_created");
    const failed = await relay.relayEvent((createdFact as any).id);
    expect(failed.failures).toBe(1);
    expect(failed.deliveries).toBe(0);
    const current = await shipping.getRetailShipmentById(created.shipment.id);
    expect((current.shipment as any).status).toBe("delivered");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.N27);
    expect(view.status).toBe("delivered");
    // The surviving keys still deliver exactly once.
    for (const type of ["retail_order.confirmed", "retail_order.shipment_handed_over", "retail_order.shipment_delivered"]) {
      const [fact] = await factRows(ids.N27, type);
      const ok = await relay.relayEvent((fact as any).id);
      expect(ok).toMatchObject({ deliveries: 1, failures: 0 });
    }
  });
});
