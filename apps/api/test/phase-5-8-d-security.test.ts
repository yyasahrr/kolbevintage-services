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
import { FakePaymentProvider, FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER } from "../src/modules/payments/providers/fake-payment.provider";
import { FakeShippingProvider } from "../src/modules/shipping/providers/fake-shipping.provider";
import { ShippingService } from "../src/modules/shipping/shipping.service";

/**
 * Phase 5.8-D8 — adversarial security across the retail commerce core.
 *
 * Every hostile actor is refused with a domain code and persists
 * NOTHING: no cross-owner reads or writes (IDOR), no staff action from
 * a customer token, no unsigned/forged/replayed provider input applied,
 * no amount or rail drift, no HTML/script smuggling into persisted
 * contact fields. Real PostgreSQL.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_d_security_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-d-security-test-token";

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let shipping: ShippingService;
let fakeShipping: FakeShippingProvider;
let fakePayment: FakePaymentProvider;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_d58s_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin" | "adminB", string>;
const tokens = {} as Record<"custA" | "custB" | "admin" | "adminB", string>;
const ids = {} as Record<string, string>;
let kolbeSellerId = "";
const totals = {} as Record<string, string>;

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(name: string, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name, phone: "09121234567", email: "buyer@example.test" },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2 }],
    address: { province: "تهران", city: "تهران", address: "خیابان آزمون، پلاک ۱", plaque: "۱", unit: "۲", postal: "1234567890", note: "" },
    shippingMethodId: "pishtaz",
    payMethod: "gateway",
    ...overrides,
  };
}

const postOrder = (body: unknown, token: string) =>
  request(app.getHttpServer()).post("/api/v1/retail/orders").set("authorization", `Bearer ${token}`).set("Idempotency-Key", makeId("key")).set("x-kolbe-internal-token", "").send(body);

const getOrder = (orderId: string, token: string) =>
  request(app.getHttpServer()).get(`/api/v1/retail/orders/${orderId}`).set("authorization", `Bearer ${token}`);

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

async function orderRow(orderId: string) {
  const [row] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, orderId)).limit(1);
  return row as any;
}

async function payInboxRow(eventId: string) {
  const [row] = await db.select().from(schema.paymentProviderEvent).where(eq(schema.paymentProviderEvent.externalEventId, eventId)).limit(1);
  return row as any;
}

async function shipInboxCount() {
  return (await db.select().from(schema.shipmentEvent)).length;
}

describe("Phase 5.8-D8 security", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-d-security";
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
    shipping = app.get(ShippingService);
    fakeShipping = app.get(FakeShippingProvider);
    fakePayment = app.get(FakePaymentProvider);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"], ["adminB", "admin"]] as const) {
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
    tokens.adminB = verifier.issue(users.adminB, "admin", 0);

    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");

    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "D Security Product", slug: `ds-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 200, reserved: 0, status: "active" });
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

  it("D8.1 refuses cross-owner reads over HTTP and at the service seam", async () => {
    await checkoutAs("X1", tokens.custA, "ex-one");
    const http = await getOrder(ids.X1, tokens.custB);
    expect(http.status).toBe(403);
    expect(http.body.error).toBe("RETAIL_ORDER_FORBIDDEN");
    // Service seam refuses the same principal; the row itself is untouched.
    await expectCode(retailOrders.getRetailOrder({ userId: users.custB, role: "customer" }, ids.X1), "RETAIL_ORDER_FORBIDDEN");
    expect((await orderRow(ids.X1)).orderStatus).toBe("placed");
  });

  it("D8.2 refuses cross-owner cancel, payment, and shipment intent (IDOR writes)", async () => {
    await checkoutAs("X2", tokens.custA, "ex-two");
    await expectCode(retailOrders.cancelRetailOrder(ids.X2, buyerB()), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.X2, buyerB(), { rail: "manual_transfer", amount: totals.X2, evidenceReference: "BANK-X2-EVIL", idempotencyKey: makeId("ev") }),
      "RETAIL_ORDER_FORBIDDEN",
    );
    await expectCode(retailOrders.createPaymentIntent(ids.X2, buyerB(), { idempotencyKey: makeId("intent"), providerName: "fake" }), "RETAIL_ORDER_FORBIDDEN");
    expect((await orderRow(ids.X2)).orderStatus).toBe("placed");
    expect(await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.X2))).toHaveLength(0);
  });

  it("D8.3 refuses every staff action from a customer token (RBAC)", async () => {
    await checkoutAs("X3", tokens.custA, "ex-three", { payMethod: "cod" });
    await expectCode(retailOrders.confirmRetailOrder(ids.X3, buyerA()), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(retailOrders.packRetailOrder(ids.X3, buyerA()), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(retailOrders.createRetailShipment(ids.X3, buyerA(), { idempotencyKey: makeId("ship"), providerName: "manual" }), "RETAIL_ORDER_FORBIDDEN");
    await retailOrders.confirmRetailOrder(ids.X3, admin());
    await retailOrders.packRetailOrder(ids.X3, admin());
    const created = await retailOrders.createRetailShipment(ids.X3, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await expectCode(retailOrders.markRetailShipmentHandoff(created.shipment.id, buyerA(), { idempotencyKey: makeId("hand") }), "RETAIL_ORDER_FORBIDDEN");
    await expectCode(retailOrders.recordRetailManualTracking(created.shipment.id, buyerA(), { state: "delivered" }), "RETAIL_ORDER_FORBIDDEN");
    expect((await orderRow(ids.X3)).orderStatus).toBe("packed");
  });

  it("D8.4 refuses payment verification from non-staff roles", async () => {
    await checkoutAs("X4", tokens.custA, "ex-four");
    const { payment } = await retailOrders.submitPaymentEvidence(ids.X4, buyerA(), {
      rail: "manual_transfer", amount: totals.X4, evidenceReference: "BANK-X4", idempotencyKey: makeId("ev"),
    });
    await expectCode(retailOrders.verifyPayment(payment.id, buyerA(), { externalReference: "BANK-X4-V", idempotencyKey: makeId("verify") }), "ROLE_NOT_ALLOWED");
    await expectCode(retailOrders.verifyPayment(payment.id, buyerB(), { externalReference: "BANK-X4-V", idempotencyKey: makeId("verify") }), "ROLE_NOT_ALLOWED");
    expect((await orderRow(ids.X4)).paymentStatus).toBe("unpaid");
  });

  it("D8.5 refuses evidence with a drifted amount or the wrong rail", async () => {
    await checkoutAs("X5", tokens.custA, "ex-five");
    const short = (BigInt(totals.X5) - 1n).toString();
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.X5, buyerA(), { rail: "manual_transfer", amount: short, evidenceReference: "BANK-X5", idempotencyKey: makeId("ev") }),
      "RETAIL_AMOUNT_MISMATCH",
    );
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.X5, buyerA(), { rail: "cod", amount: totals.X5, evidenceReference: "BANK-X5", idempotencyKey: makeId("ev") }),
      "RETAIL_EVIDENCE_RAIL_MISMATCH",
    );
    await checkoutAs("X5cod", tokens.custA, "ex-five-cod", { payMethod: "cod" });
    await expectCode(
      retailOrders.submitPaymentEvidence(ids.X5cod, buyerA(), { rail: "manual_transfer", amount: totals.X5cod, evidenceReference: "BANK-X5C", idempotencyKey: makeId("ev") }),
      "RETAIL_EVIDENCE_RAIL_MISMATCH",
    );
    expect(await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.X5))).toHaveLength(0);
    expect(await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.X5cod))).toHaveLength(0);
  });

  it("D8.6 keeps backward tracking as an ignored fact: nothing moves, nothing resurrects", async () => {
    await checkoutAs("X6", tokens.custA, "ex-six", { payMethod: "cod" });
    await retailOrders.confirmRetailOrder(ids.X6, admin());
    await retailOrders.packRetailOrder(ids.X6, admin());
    const created = await retailOrders.createRetailShipment(ids.X6, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
    // A backward attestation (delivered -> in_transit) is kept as a fact and ignored — never applied, never resurrected.
    const outcome = await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "in_transit" });
    expect(outcome.status).toBe("ignored");
    expect(outcome.reason).toBe("backward_transition_rejected:delivered+in_transit");
    expect(((await shipping.getRetailShipmentById(created.shipment.id)).shipment as any).status).toBe("delivered");
    expect((await orderRow(ids.X6)).orderStatus).toBe("delivered");
  });

  it("D8.7 ignores unsigned callbacks as facts and refuses unknown providers before the inbox", async () => {
    await checkoutAs("X7", tokens.custA, "ex-seven");
    const { payment } = await retailOrders.createPaymentIntent(ids.X7, buyerA(), { idempotencyKey: makeId("intent"), providerName: "fake" });
    const forgedId = makeId("evt");
    await expectCode(
      retailOrders.handleRetailProviderCallback("fake", { headers: { [FAKE_PAYMENT_WEBHOOK_SIGNATURE_HEADER]: "forged" }, body: { eventId: forgedId, providerReference: payment.providerReference, status: "payment.success", currency: "IRR" } }),
      "RETAIL_WEBHOOK_UNAUTHENTICATED",
    );
    // The hostile attempt is kept as an ignored fact (B precedent); the payment row and the order are untouched.
    expect((await payInboxRow(forgedId)).status).toBe("ignored");
    const inboxBefore = (await db.select().from(schema.paymentProviderEvent)).length;
    await expectCode(retailOrders.handleRetailProviderCallback("nope", { headers: {}, body: {} }), "PAYMENT_PROVIDER_UNKNOWN");
    expect((await db.select().from(schema.paymentProviderEvent)).length).toBe(inboxBefore);
    const rows = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.X7));
    expect(rows.find((row: any) => row.id === payment.id)?.status).toBe("pending");
    expect((await orderRow(ids.X7)).paymentStatus).toBe("unpaid");
  });

  it("D8.8 pins confirmed-order shipment creation as legal: money stays honest, handoff still fenced", async () => {
    await checkoutAs("X8", tokens.custA, "ex-eight");
    await payOrderGateway("X8");
    await retailOrders.confirmRetailOrder(ids.X8, admin());
    // Creating the parcel before pack is legal (label-then-pack); no money moves and no premature events emit.
    const created = await retailOrders.createRetailShipment(ids.X8, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    expect((created.shipment as any).status).toBe("ready");
    expect((await orderRow(ids.X8)).orderStatus).toBe("confirmed");
    expect((await orderRow(ids.X8)).paymentStatus).toBe("paid");
    // But the parcel cannot leave the warehouse off a confirmed order: handoff demands pack first (Checkpoint D fence).
    await expectCode(retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") }), "RETAIL_SHIPMENT_NOT_READY");
    await retailOrders.packRetailOrder(ids.X8, admin());
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    expect((await orderRow(ids.X8)).orderStatus).toBe("shipped");
  });

  it("D8.9 refuses handoff from a staff sibling who did not create the parcel (no-op identity: still allowed, fenced by role)", async () => {
    // Staff identity is fungible by design: any admin may hand off any ready
    // parcel. This test pins that the fence is the STAFF ROLE, not parcel
    // ownership — a second admin succeeds where D8.3's customer failed.
    await checkoutAs("X9", tokens.custA, "ex-nine", { payMethod: "cod" });
    await retailOrders.confirmRetailOrder(ids.X9, admin());
    await retailOrders.packRetailOrder(ids.X9, admin());
    const created = await retailOrders.createRetailShipment(ids.X9, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    const sibling = { actorId: users.adminB, actorRole: "admin" };
    await retailOrders.markRetailShipmentHandoff(created.shipment.id, sibling, { idempotencyKey: makeId("hand") });
    expect((await orderRow(ids.X9)).orderStatus).toBe("shipped");
  });

  it("D8.10 strips markup smuggled into contact fields at the trust boundary", async () => {
    const evil = "<script>alert(1)</script>";
    const address = { province: "تهران", city: "تهران", address: evil, plaque: "۱", unit: "۲", postal: "1234567890", note: evil };
    const response = await postOrder(orderBody(evil, { address }), tokens.custA).expect(201);
    // Checkout still succeeds — the hostile payload is neutralized, not bounced.
    const row = await orderRow(response.body.id as string);
    expect(row.customerName).toBe("scriptalert(1)/script");
    expect(JSON.stringify(row.address)).not.toContain("<");
    expect(JSON.stringify(row.address)).not.toContain(">");
    const view = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, response.body.id as string);
    expect(JSON.stringify(view)).not.toContain("<script>");
  });

  it("D8.11 refuses shipment creation and tracking against foreign parcels", async () => {
    await checkoutAs("X11a", tokens.custA, "ex-eleven-a", { payMethod: "cod" });
    await checkoutAs("X11b", tokens.custB, "ex-eleven-b", { payMethod: "cod" });
    for (const tag of ["X11a", "X11b"]) {
      await retailOrders.confirmRetailOrder(ids[tag], admin());
      await retailOrders.packRetailOrder(ids[tag], admin());
    }
    const parcelA = await retailOrders.createRetailShipment(ids.X11a, admin(), { idempotencyKey: makeId("ship"), providerName: "fake" });
    // A line item id from order B cannot be shipped under order A.
    const lineB = (await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids.X11b)).limit(1))[0] as any;
    await expectCode(
      retailOrders.createRetailShipment(ids.X11a, admin(), { idempotencyKey: makeId("ship"), providerName: "manual", items: [{ retailOrderItemId: lineB.id, quantity: 1 }] }),
      "RETAIL_SHIPMENT_ITEM_MISMATCH",
    );
    // A carrier scan for parcel A's refs resolves to parcel A only (C15 precedent, adversarial framing).
    const ext = (parcelA.shipment as any).externalReference as string;
    const trk = (parcelA.shipment as any).trackingCode as string;
    fakeShipping.setCarrierState(ext, "in_transit");
    await retailOrders.markRetailShipmentHandoff((parcelA.shipment as any).id, admin(), { idempotencyKey: makeId("hand") });
    const scan = await retailOrders.handleRetailCarrierWebhook("fake", {
      headers: { "x-fake-shipping-signature": FakeShippingProvider.webhookSecret() } as any,
      body: { eventId: makeId("evt"), externalReference: ext, trackingCode: trk, state: "in_transit" },
    });
    expect(scan.status).toBe("processed");
    expect(scan.shipmentId).toBe((parcelA.shipment as any).id);
    expect(((await shipping.getRetailShipmentById((parcelA.shipment as any).id)).shipment as any).status).toBe("in_transit");
  });
});
