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
import { RetailReturnsService } from "../src/modules/orders/retail/retail-returns.service";

/**
 * Phase 5.9-B — evolved cancel + first-class returns + support link (Nest e2e).
 *
 * Cancel HTTP matrix (paid → refund-pending, recancel idempotent,
 * delivered → routes-to-return, in-transit intact), return filing gates,
 * the full staff lifecycle to RESTOCKED (single restock, order → returned),
 * reject/withdraw paths, ownership, pagination, and the support-case
 * linkage. Staff transitions run service-level (no Admin HTTP in B). Real
 * PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_9_b_retail_returns_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let returns: RetailReturnsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r59b_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin", string>;
const tokens = {} as Record<"custA" | "custB" | "admin", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;
let kolbeSellerId = "";

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
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
  const response = await request(app.getHttpServer())
    .post("/api/v1/retail/orders")
    .set("authorization", `Bearer ${tokens.custA}`)
    .set("Idempotency-Key", makeId("key"))
    .set("x-kolbe-internal-token", "")
    .send(orderBody(overrides))
    .expect(201);
  ids[tag] = response.body.id;
  totals[tag] = response.body.totals.grandTotal;
  return response.body;
}

async function driveToDelivered(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  const delivered = await retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
  return delivered;
}

async function driveToHandoff(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
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

async function stockOf(variantId: string) {
  const [row] = await db
    .select({ onHand: schema.productVariantInventory.onHand, reserved: schema.productVariantInventory.reserved })
    .from(schema.productVariantInventory)
    .where(and(eq(schema.productVariantInventory.variantId, variantId), eq(schema.productVariantInventory.sellerId, kolbeSellerId)))
    .limit(1);
  return { onHand: (row as any).onHand as number, reserved: (row as any).reserved as number };
}

async function factRows(orderId: string, eventType: string) {
  return db
    .select()
    .from(schema.orderEvent)
    .where(and(eq(schema.orderEvent.aggregateType, "retail_order"), eq(schema.orderEvent.aggregateId, orderId), eq(schema.orderEvent.eventType, eventType)));
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

const shape = (rows: unknown) =>
  JSON.stringify(rows, (_key, value) => (typeof value === "bigint" ? `bigint:${value.toString()}` : value instanceof Date ? `date:${value.toISOString()}` : value));

describe("Phase 5.9-B retail returns", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p59b-returns";
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

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["admin", "admin"]] as const) {
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
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Return Product", slug: `ret-${ids.p1}`, ownerType: "KOLBE", status: "published" });
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

  it("cancels unpaid orders over HTTP, idempotently and owner-scoped", async () => {
    await checkoutAs("C1");
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.C1}/cancel`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ reason: "changed mind" })
      .expect(201);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.payment.refundPending).toBe(false);
    // Recancel: idempotent success.
    const replayed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.C1}/cancel`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(201);
    expect(replayed.body.status).toBe("cancelled");
    expect(await factRows(ids.C1, "retail_order.cancelled")).toHaveLength(1);
    // Ownership: another customer cannot cancel; anonymous cannot either.
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.C1}/cancel`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer()).post(`/api/v1/customer/orders/${ids.C1}/cancel`).send({}).expect(401);
  });

  it("lands paid cancels refund-pending over HTTP with money untouched", async () => {
    await checkoutAs("P1");
    await payOrderGateway("P1");
    const before = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.P1));
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.P1}/cancel`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ reason: "too late" })
      .expect(201);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.payment).toMatchObject({ status: "paid", refundPending: true });
    const after = await db.select().from(schema.payment).where(eq(schema.payment.retailOrderId, ids.P1));
    expect(after).toHaveLength(1);
    expect(shape(after)).toBe(shape(before));
    const facts = await factRows(ids.P1, "retail_order.cancelled");
    expect(facts).toHaveLength(1);
    expect((facts[0] as any).payload.refund_pending).toBe(true);
  });

  it("routes delivered cancels to returns; in-transit stays refused", async () => {
    await checkoutAs("RT1");
    await payOrderGateway("RT1");
    await driveToDelivered("RT1");
    const routed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.RT1}/cancel`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(409);
    expect(routed.body.error).toBe("RETAIL_CANCEL_ROUTES_TO_RETURN");

    await checkoutAs("T1", { payMethod: "cod" });
    await driveToHandoff("T1");
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.T1}/cancel`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(409);
    expect(refused.body.error).toBe("RETAIL_CANCEL_SHIPMENT_IN_PROGRESS");
  });

  it("files a return with a linked support case + SLA", async () => {
    await checkoutAs("D1");
    await payOrderGateway("D1");
    await driveToDelivered("D1");
    const [lineId] = await orderItemIds("D1");
    ids.lineD1 = lineId;
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED", note: "screen <cracked>" })
      .expect(201);
    expect(filed.body).toMatchObject({ orderId: ids.D1, status: "REQUESTED", reason: "DAMAGED", version: 0 });
    expect(filed.body.note).toBe("screen cracked");
    expect(filed.body.items).toHaveLength(1);
    expect(filed.body.history).toHaveLength(1);
    expect(typeof filed.body.supportCaseId).toBe("string");
    ids.R1 = filed.body.id;

    const [supportCase] = await db.select().from(schema.supportCase).where(eq(schema.supportCase.id, filed.body.supportCaseId));
    expect(supportCase).toMatchObject({ category: "RETURN", requesterType: "RETAIL_CUSTOMER", requesterUserId: users.custA, status: "OPEN" });
    const relations = await db.select().from(schema.supportCaseRelation).where(eq(schema.supportCaseRelation.caseId, filed.body.supportCaseId));
    expect(relations.map((row: any) => row.relationType).sort()).toEqual(["ORDER", "ORDER_ITEM"]);
    const itemRel = relations.find((row: any) => row.relationType === "ORDER_ITEM") as any;
    expect(itemRel).toMatchObject({ targetId: ids.D1, itemId: lineId, quantity: 1 });
    const sla = await db.select().from(schema.supportCaseSla).where(eq(schema.supportCaseSla.caseId, filed.body.supportCaseId));
    expect(sla.length).toBeGreaterThanOrEqual(1);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "retail_return_request"), eq(schema.auditLog.entityId, ids.R1)));
    expect(audit.map((row: any) => row.action)).toContain("retail_return.filed");
  });

  it("fails filing closed: state gates, line math, ownership", async () => {
    await checkoutAs("P2");
    const preHandoff = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.P2}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: "roi_x", quantity: 1 }], reason: "OTHER" })
      .expect(422);
    expect(preHandoff.body.error).toBe("RETAIL_RETURN_ORDER_NOT_DELIVERED");

    const inTransit = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.T1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: "roi_x", quantity: 1 }], reason: "OTHER" })
      .expect(422);
    expect(inTransit.body.error).toBe("RETAIL_RETURN_ORDER_NOT_DELIVERED");

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.C1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: "roi_x", quantity: 1 }], reason: "OTHER" })
      .expect(422);
    expect(cancelled.body.error).toBe("RETAIL_RETURN_ORDER_NOT_DELIVERED");

    // D1 delivered 2 units; R1 encumbers 1. Unknown line, over-qty, bad
    // reason, empty lines, and foreign ownership all fail closed.
    const unknown = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: "roi_ghost", quantity: 1 }], reason: "OTHER" })
      .expect(400);
    expect(unknown.body.error).toBe("RETAIL_RETURN_LINE_INVALID");

    const over = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: ids.lineD1, quantity: 2 }], reason: "OTHER" })
      .expect(422);
    expect(over.body.error).toBe("RETAIL_RETURN_QUANTITY_EXCEEDED");

    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: ids.lineD1, quantity: 1 }], reason: "BOGUS" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [], reason: "OTHER" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({ lines: [{ orderItemId: ids.lineD1, quantity: 1 }], reason: "OTHER" })
      .expect(403);
  });

  it("runs the full lifecycle to RESTOCKED: single restock, order returned", async () => {
    const before = await stockOf(ids.v1);
    const approved = await returns.transitionRetailReturn(ids.R1, "APPROVED", admin());
    expect(approved).toMatchObject({ status: "APPROVED", version: 1 });
    const received = await returns.transitionRetailReturn(ids.R1, "RECEIVED", admin());
    expect(received.status).toBe("RECEIVED");
    expect(typeof received.receivedAt).toBe("string");
    const inspected = await returns.transitionRetailReturn(ids.R1, "INSPECTED", { ...admin(), inspectionDecision: "RESTOCKABLE" });
    expect(inspected).toMatchObject({ status: "INSPECTED", inspectionDecision: "RESTOCKABLE" });
    expect(typeof inspected.inspectedAt).toBe("string");
    const restocked = await returns.transitionRetailReturn(ids.R1, "RESTOCKED", admin());
    expect(restocked).toMatchObject({ status: "RESTOCKED", version: 4 });
    expect(restocked.history.map((event) => event.toStatus)).toEqual(["REQUESTED", "APPROVED", "RECEIVED", "INSPECTED", "RESTOCKED"]);

    const after = await stockOf(ids.v1);
    expect(after.onHand).toBe(before.onHand + 1);
    const order = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.D1);
    expect(order.status).toBe("returned");

    // Terminal: no second restock, no further transitions.
    await expect(returns.transitionRetailReturn(ids.R1, "RESTOCKED", admin())).rejects.toThrow();
    expect((await stockOf(ids.v1)).onHand).toBe(after.onHand);
  });

  it("refuses restock without RESTOCKABLE; reject needs a reason", async () => {
    await checkoutAs("D2");
    await payOrderGateway("D2");
    await driveToDelivered("D2");
    const [lineId] = await orderItemIds("D2");
    const filed = await returns.fileRetailReturn(buyerA(), ids.D2, { lines: [{ orderItemId: lineId, quantity: 2 }], reason: "QUALITY_ISSUE" });
    ids.R2 = filed.id;
    await returns.transitionRetailReturn(ids.R2, "APPROVED", admin());
    await returns.transitionRetailReturn(ids.R2, "RECEIVED", admin());
    await returns.transitionRetailReturn(ids.R2, "INSPECTED", { ...admin(), inspectionDecision: "DAMAGED" });

    const before = await stockOf(ids.v1);
    await expectCode(returns.transitionRetailReturn(ids.R2, "RESTOCKED", admin()), "RETAIL_RETURN_NOT_RESTOCKABLE");
    await expectCode(returns.transitionRetailReturn(ids.R2, "REJECTED", admin()), "RETAIL_RETURN_REJECT_REASON_REQUIRED");
    const rejected = await returns.transitionRetailReturn(ids.R2, "REJECTED", { ...admin(), reason: "physically damaged beyond resale" });
    expect(rejected.status).toBe("REJECTED");
    expect((await stockOf(ids.v1)).onHand).toBe(before.onHand);
    const order = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.D2);
    expect(order.status).toBe("delivered");
    // Rejected quantities are freed: the customer may re-file honestly.
    const refiled = await returns.fileRetailReturn(buyerA(), ids.D2, { lines: [{ orderItemId: lineId, quantity: 2 }], reason: "OTHER" });
    expect(refiled.status).toBe("REQUESTED");
    ids.R2b = refiled.id;
  });

  it("withdraws pre-receipt, owner-only; received returns cannot withdraw", async () => {
    // D1's second unit: file, withdraw, re-file (encumbrance freed).
    const filed = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: ids.lineD1, quantity: 1 }], reason: "CHANGED_MIND" })
      .expect(201);
    ids.R3 = filed.body.id;
    const withdrawn = await request(app.getHttpServer())
      .post(`/api/v1/customer/returns/${ids.R3}/withdraw`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(201);
    expect(withdrawn.body.status).toBe("WITHDRAWN");

    const refiled = await request(app.getHttpServer())
      .post(`/api/v1/customer/orders/${ids.D1}/returns`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({ lines: [{ orderItemId: ids.lineD1, quantity: 1 }], reason: "CHANGED_MIND" })
      .expect(201);
    ids.R3b = refiled.body.id;
    await returns.transitionRetailReturn(ids.R3b, "APPROVED", admin());
    await returns.transitionRetailReturn(ids.R3b, "RECEIVED", admin());
    const tooLate = await request(app.getHttpServer())
      .post(`/api/v1/customer/returns/${ids.R3b}/withdraw`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .send({})
      .expect(400);
    expect(tooLate.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");

    await request(app.getHttpServer())
      .post(`/api/v1/customer/returns/${ids.R3b}/withdraw`)
      .set("authorization", `Bearer ${tokens.custB}`)
      .send({})
      .expect(403);
  });

  it("scopes return reads by owner with cursor pagination", async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/customer/returns/${ids.R1}`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(200);
    expect(detail.body).toMatchObject({ id: ids.R1, status: "RESTOCKED" });
    expect(detail.body.items[0]).toMatchObject({ orderItemId: ids.lineD1, quantity: 1 });
    expect(typeof detail.body.items[0].sku).toBe("string");

    await request(app.getHttpServer()).get(`/api/v1/customer/returns/${ids.R1}`).set("authorization", `Bearer ${tokens.custB}`).expect(403);
    await request(app.getHttpServer()).get("/api/v1/customer/returns/rret_missing").set("authorization", `Bearer ${tokens.custA}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/customer/returns/${ids.R1}`).expect(401);

    const empty = await request(app.getHttpServer()).get("/api/v1/customer/returns").set("authorization", `Bearer ${tokens.custB}`).expect(200);
    expect(empty.body).toEqual({ returns: [], nextCursor: null });

    const page1 = await request(app.getHttpServer()).get("/api/v1/customer/returns?limit=1").set("authorization", `Bearer ${tokens.custA}`).expect(200);
    expect(page1.body.returns).toHaveLength(1);
    expect(typeof page1.body.nextCursor).toBe("string");
    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/customer/returns?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(200);
    expect(page2.body.returns).toHaveLength(1);
    expect(page2.body.returns[0].id).not.toBe(page1.body.returns[0].id);
    await request(app.getHttpServer()).get("/api/v1/customer/returns?cursor=!!!").set("authorization", `Bearer ${tokens.custA}`).expect(400);
  });

  it("keeps the staff seam staff-only and graph-strict", async () => {
    await expectCode(returns.transitionRetailReturn(ids.R2b, "APPROVED", buyerA()), "RETAIL_RETURN_FORBIDDEN");
    await expectCode(returns.transitionRetailReturn(ids.R2b, "RECEIVED", admin()), "RETAIL_RETURN_TRANSITION_INVALID");
    await expectCode(returns.transitionRetailReturn(ids.R2b, "WITHDRAWN", admin()), "RETAIL_RETURN_TRANSITION_INVALID");
    await expectCode(returns.transitionRetailReturn(ids.R2b, "BOGUS", admin()), "RETAIL_RETURN_TRANSITION_INVALID");
    await expectCode(returns.transitionRetailReturn("rret_missing", "APPROVED", admin()), "RETAIL_RETURN_NOT_FOUND");
    await expectCode(
      returns.transitionRetailReturn(ids.R2b, "INSPECTED", { ...admin(), inspectionDecision: "BOGUS" }),
      "RETAIL_RETURN_TRANSITION_INVALID",
    );
    await expectCode(
      returns.fileRetailReturn({ actorId: users.admin, actorRole: "supplier" }, ids.D2, { lines: [{ orderItemId: "x", quantity: 1 }], reason: "OTHER" }),
      "RETAIL_RETURN_FORBIDDEN",
    );
    // R2b untouched by the attempts above.
    expect((await returns.getRetailReturn({ userId: users.custA, role: "customer" }, ids.R2b)).status).toBe("REQUESTED");
  });

  it("replays a same-key return filing once, conflicts on changed payload, and never duplicates support evidence", async () => {
    await checkoutAs("IDEMP");
    await payOrderGateway("IDEMP");
    await driveToDelivered("IDEMP");
    const [lineId] = await orderItemIds("IDEMP");
    const key = "return-replay-key-511";
    const body = { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED", note: "same request" };
    const endpoint = `/api/v1/customer/orders/${ids.IDEMP}/returns`;
    const [first, retry] = await Promise.all([
      request(app.getHttpServer()).post(endpoint).set("authorization", `Bearer ${tokens.custA}`).set("idempotency-key", key).send(body),
      request(app.getHttpServer()).post(endpoint).set("authorization", `Bearer ${tokens.custA}`).set("idempotency-key", key).send(body),
    ]);
    expect([first.status, retry.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(retry.body.id);
    expect([first.body.replayed, retry.body.replayed].sort()).toEqual([false, true]);
    const rows = await db.select().from(schema.retailReturnRequest).where(eq(schema.retailReturnRequest.orderId, ids.IDEMP));
    expect(rows).toHaveLength(1);
    const supportRows = await db.select().from(schema.supportCase).where(eq(schema.supportCase.id, (rows[0] as any).supportCaseId));
    expect(supportRows).toHaveLength(1);
    const changed = await request(app.getHttpServer())
      .post(endpoint)
      .set("authorization", `Bearer ${tokens.custA}`)
      .set("idempotency-key", key)
      .send({ ...body, reason: "OTHER" })
      .expect(409);
    expect(changed.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
  });

  it("completes a partial sibling return without double-moving the order", async () => {
    const before = await stockOf(ids.v1);
    await returns.transitionRetailReturn(ids.R3b, "INSPECTED", { ...admin(), inspectionDecision: "RESTOCKABLE" });
    const restocked = await returns.transitionRetailReturn(ids.R3b, "RESTOCKED", admin());
    expect(restocked.status).toBe("RESTOCKED");
    expect((await stockOf(ids.v1)).onHand).toBe(before.onHand + 1);
    // D1 was already returned by R1: the order stays returned, with exactly
    // one delivered → returned fact.
    const order = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.D1);
    expect(order.status).toBe("returned");
    const deliveredToReturned = order.history.filter((event: any) => event.fromStatus === "delivered" && event.toStatus === "returned");
    expect(deliveredToReturned).toHaveLength(1);
  });
});
