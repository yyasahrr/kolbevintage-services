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
 * Phase 5.11-C — staff reads over HTTP (Nest e2e).
 *
 * Order search/list with filters and keyset pages, order detail +
 * timeline, return queue + detail, refund queue. Shapes, filters,
 * pagination, degradation, and the admin-only guard are pinned.
 * Real PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_c_reads_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let returns: RetailReturnsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511c_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "admin", string>;
const tokens = {} as Record<"custA" | "admin" | "financeHat", string>;
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

async function driveToDelivered(tag: string) {
  await retailOrders.confirmRetailOrder(ids[tag], admin());
  await retailOrders.packRetailOrder(ids[tag], admin());
  const created = await retailOrders.createRetailShipment(ids[tag], admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(created.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  return retailOrders.recordRetailManualTracking(created.shipment.id, admin(), { state: "delivered" });
}

async function orderItemIds(tag: string): Promise<string[]> {
  const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids[tag]));
  return rows.map((row) => row.id);
}

const staffGet = (url: string, token: string) => request(app.getHttpServer()).get(url).set("authorization", `Bearer ${token}`);

describe("Phase 5.11-C staff reads", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511c-reads";
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

    for (const [name, role] of [["custA", "customer"], ["admin", "admin"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Phase 5.11-C (setup-only): this suite's staff actor is TOTP-enrolled;
    // the C-tranche gate refuses paid cancels for unenrolled staff.
    // Assertions unchanged.
    await db.update(schema.accountUser).set({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true, totpEnrolledAt: new Date() }).where(eq(schema.accountUser.id, users.admin));
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    tokens.custA = verifier.issue(users.custA, "customer", 0);
    tokens.admin = verifier.issue(users.admin, "admin", 0);
    tokens.financeHat = verifier.issue(users.admin, "finance", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Reads Product", slug: `reads-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });

    // Shared queue scenery: one placed, one cancelled, one delivered.
    await checkoutAs("Q1");
    await checkoutAs("Q2");
    await payOrderGateway("Q2");
    await retailOrders.cancelRetailOrder(ids.Q2, admin());
    await checkoutAs("Q3");
    await payOrderGateway("Q3");
    await driveToDelivered("Q3");
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

  it("lists orders newest-first with slim money-string rows", async () => {
    const res = await staffGet("/api/v1/admin/retail/orders", tokens.admin).expect(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
    const found = res.body.orders.map((row: any) => row.id).sort();
    expect(found).toEqual([ids.Q1, ids.Q2, ids.Q3].sort());
    const delivered = res.body.orders.find((row: any) => row.id === ids.Q3);
    expect(delivered.status).toBe("delivered");
    expect(delivered.paymentStatus).toBe("paid");
    expect(delivered.totals.grandTotal).toBe(totals.Q3);
    expect(typeof delivered.totals.grandTotal).toBe("string");
    expect(delivered.customerId).toBe(users.custA);
  });

  it("filters orders by status, payment, code, and customer", async () => {
    const byStatus = await staffGet("/api/v1/admin/retail/orders?status=delivered", tokens.admin).expect(200);
    expect(byStatus.body.orders.map((row: any) => row.id)).toEqual([ids.Q3]);
    const byPayment = await staffGet("/api/v1/admin/retail/orders?paymentStatus=paid", tokens.admin).expect(200);
    expect(byPayment.body.orders.map((row: any) => row.id).sort()).toEqual([ids.Q2, ids.Q3].sort());
    const [codeRow] = await db.select({ orderCode: schema.retailOrder.orderCode }).from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.Q1));
    const byCode = await staffGet(`/api/v1/admin/retail/orders?orderCode=${codeRow.orderCode}`, tokens.admin).expect(200);
    expect(byCode.body.orders.map((row: any) => row.id)).toEqual([ids.Q1]);
    const byCustomer = await staffGet(`/api/v1/admin/retail/orders?customerId=${users.custA}`, tokens.admin).expect(200);
    expect(byCustomer.body.orders).toHaveLength(3);
    // Unknown filters match nothing; they never error.
    const unknown = await staffGet("/api/v1/admin/retail/orders?status=bogus", tokens.admin).expect(200);
    expect(unknown.body.orders).toEqual([]);
    expect(unknown.body.hasMore).toBe(false);
  });

  it("walks the order queue page by page without dupes", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const url = cursor ? `/api/v1/admin/retail/orders?limit=1&cursor=${cursor}` : "/api/v1/admin/retail/orders?limit=1";
      const res = await staffGet(url, tokens.admin).expect(200);
      expect(res.body.orders).toHaveLength(1);
      seen.push(res.body.orders[0].id);
      cursor = res.body.nextCursor;
      expect(res.body.hasMore).toBe(page < 2);
    }
    expect(cursor).toBeNull();
    expect([...seen].sort()).toEqual([ids.Q1, ids.Q2, ids.Q3].sort());
  });

  it("degrades hostile pagination input to safe defaults", async () => {
    const garbage = await staffGet("/api/v1/admin/retail/orders?cursor=!!!not-a-cursor!!!", tokens.admin).expect(200);
    expect(garbage.body.orders).toHaveLength(3);
    const zero = await staffGet("/api/v1/admin/retail/orders?limit=0", tokens.admin).expect(200);
    expect(zero.body.orders).toHaveLength(1);
    expect(zero.body.hasMore).toBe(true);
    const banana = await staffGet("/api/v1/admin/retail/orders?limit=banana", tokens.admin).expect(200);
    expect(banana.body.orders).toHaveLength(3);
    const huge = await staffGet("/api/v1/admin/retail/orders?limit=500", tokens.admin).expect(200);
    expect(huge.body.orders).toHaveLength(3);
    expect(huge.body.hasMore).toBe(false);
  });

  it("reads staff order detail with guard parity (403/401/404)", async () => {
    await staffGet(`/api/v1/admin/retail/orders/${ids.Q3}`, tokens.custA).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/admin/retail/orders/${ids.Q3}`).expect(401);
    await staffGet("/api/v1/admin/retail/orders/ghost-order", tokens.admin).expect(404);
    const staff = await staffGet(`/api/v1/admin/retail/orders/${ids.Q3}`, tokens.admin).expect(200);
    const customer = await staffGet(`/api/v1/retail/orders/${ids.Q3}`, tokens.custA).expect(200);
    expect(staff.body).toEqual(customer.body);
  });

  it("reads the version-ordered timeline with 404 on missing orders", async () => {
    await staffGet("/api/v1/admin/retail/orders/ghost-order/timeline", tokens.admin).expect(404);
    const res = await staffGet(`/api/v1/admin/retail/orders/${ids.Q3}/timeline`, tokens.admin).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const versions = res.body.map((event: any) => event.orderVersion);
    expect([...versions].sort((a: number, b: number) => a - b)).toEqual(versions);
    const last = res.body[res.body.length - 1];
    expect(last.toStatus).toBe("delivered");
    // Creation starts from nothing; every later link continues the chain.
    expect(res.body[0].fromStatus).toBeNull();
    expect(res.body[0].toStatus).toBe("placed");
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].fromStatus).toBe(res.body[i - 1].toStatus);
    }
  });

  it("queues returns with status filter and keyset walk", async () => {
    const [lineId] = await orderItemIds("Q3");
    const first = await returns.fileRetailReturn(buyerA(), ids.Q3, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED" });
    await returns.transitionRetailReturn(first.id, "APPROVED", admin());
    await checkoutAs("Q4");
    await payOrderGateway("Q4");
    await driveToDelivered("Q4");
    const [line4] = await orderItemIds("Q4");
    const second = await returns.fileRetailReturn(buyerA(), ids.Q4, { lines: [{ orderItemId: line4, quantity: 1 }], reason: "DAMAGED" });
    const all = await staffGet("/api/v1/admin/retail/returns", tokens.admin).expect(200);
    expect(all.body.returns.map((row: any) => row.id).sort()).toEqual([first.id, second.id].sort());
    const requested = await staffGet("/api/v1/admin/retail/returns?status=REQUESTED", tokens.admin).expect(200);
    expect(requested.body.returns.map((row: any) => row.id)).toEqual([second.id]);
    // Newest-first: the later filing leads page one.
    const page1 = await staffGet("/api/v1/admin/retail/returns?limit=1", tokens.admin).expect(200);
    expect(page1.body.returns[0].id).toBe(second.id);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await staffGet(`/api/v1/admin/retail/returns?limit=1&cursor=${page1.body.nextCursor}`, tokens.admin).expect(200);
    expect(page2.body.returns[0].id).toBe(first.id);
    expect(page2.body.hasMore).toBe(false);
  });

  it("reads staff return detail with 404 parity", async () => {
    await staffGet("/api/v1/admin/retail/returns/ghost-return", tokens.admin).expect(404);
    const queue = await staffGet("/api/v1/admin/retail/returns?limit=1", tokens.admin).expect(200);
    const detail = await staffGet(`/api/v1/admin/retail/returns/${queue.body.returns[0].id}`, tokens.admin).expect(200);
    expect(detail.body.id).toBe(queue.body.returns[0].id);
    expect(detail.body.orderId).toBeTruthy();
  });

  it("queues retail refunds with status filter and retail-only rows", async () => {
    const filed = await retailOrders.requestRetailRefund(ids.Q2, admin(), { amount: totals.Q2, idempotencyKey: makeId("req") });
    await retailOrders.approveRetailRefund(filed.refund.id, admin(), { idempotencyKey: makeId("appr") });
    await retailOrders.completeRetailRefund(filed.refund.id, admin(), {
      externalReference: `BANK-Q2-${filed.refund.id.slice(-8)}`,
      idempotencyKey: makeId("comp"),
    });
    await checkoutAs("Q5");
    await payOrderGateway("Q5");
    await retailOrders.cancelRetailOrder(ids.Q5, admin());
    const pending = await retailOrders.requestRetailRefund(ids.Q5, admin(), { amount: totals.Q5, idempotencyKey: makeId("req") });
    const all = await staffGet("/api/v1/admin/retail/refunds", tokens.admin).expect(200);
    expect(all.body.refunds.map((row: any) => row.id).sort()).toEqual([filed.refund.id, pending.refund.id].sort());
    for (const row of all.body.refunds) {
      expect(row.retailOrderId).toBeTruthy();
      expect(typeof row.amount).toBe("string");
    }
    const completed = await staffGet("/api/v1/admin/retail/refunds?status=completed", tokens.admin).expect(200);
    expect(completed.body.refunds.map((row: any) => row.id)).toEqual([filed.refund.id]);
    const requested = await staffGet("/api/v1/admin/retail/refunds?status=requested", tokens.admin).expect(200);
    expect(requested.body.refunds.map((row: any) => row.id)).toEqual([pending.refund.id]);
  });

  it("keeps staff reads admin-only (customer 403, finance-hat 401)", async () => {
    await staffGet("/api/v1/admin/retail/orders", tokens.custA).expect(403);
    await staffGet("/api/v1/admin/retail/returns", tokens.custA).expect(403);
    await staffGet("/api/v1/admin/retail/refunds", tokens.custA).expect(403);
    await staffGet("/api/v1/admin/retail/orders", tokens.financeHat).expect(401);
    await staffGet("/api/v1/admin/retail/refunds", tokens.financeHat).expect(401);
  });
});
