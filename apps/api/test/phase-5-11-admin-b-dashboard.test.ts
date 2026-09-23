import { execFileSync } from "node:child_process";
import path from "node:path";
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
import { AnalyticsQueryService } from "../src/modules/analytics/analytics-query.service";

/**
 * Phase 5.11-B (admin tranche) — retail dashboard, inventory, exceptions.
 *
 * Sales KPIs come from the analytics engine (canonical 5.5 semantics),
 * operational queues aggregate owner tables read-only, and every figure
 * is asserted against seeded source truth. Tests run in file order and
 * share one database: T1 pins the empty board, T2 builds the commerce
 * fixtures, later tests assert deltas or isolated CUSTOM windows.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_admin_b_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let retailReturns: RetailReturnsService;
let analytics: AnalyticsQueryService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511ab_${Date.now()}_${seq++}`;

type UserKey = "custA" | "adminFull" | "adminDashboard" | "adminInventory" | "adminFinance" | "adminOrderView";
const users = {} as Record<UserKey, string>;
const tokens = {} as Record<UserKey, string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const admin = () => ({ actorId: users.adminFull, actorRole: "admin" });

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

async function checkoutAs(orderTag: string, productTag = "p1", variantTag = "p1v", quantity = 2, extra: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users.custA },
    orderBody(ids[productTag], ids[variantTag], quantity, extra) as any,
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

const get = (url: string, token?: string) => {
  const req = request(app.getHttpServer()).get(url);
  return token ? req.set("authorization", `Bearer ${token}`) : req;
};

describe("Phase 5.11-B retail dashboard", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511b-dash";
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
    retailReturns = app.get(RetailReturnsService);
    analytics = app.get(AnalyticsQueryService);

    const roles: Array<[UserKey, "customer" | "admin"]> = [
      ["custA", "customer"],
      ["adminFull", "admin"],
      ["adminDashboard", "admin"],
      ["adminInventory", "admin"],
      ["adminFinance", "admin"],
      ["adminOrderView", "admin"],
    ];
    for (const [name, role] of roles) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const grants: Array<[UserKey, string[]]> = [
      ["adminDashboard", ["retail:dashboard:view"]],
      ["adminInventory", ["retail:inventory:view"]],
      ["adminFinance", ["retail:finance:view"]],
      ["adminOrderView", ["retail:order:view"]],
    ];
    for (const [name, actions] of grants) {
      const roleId = makeId(`role_${name}`);
      await db.insert(schema.adminRole).values({ id: roleId, name: roleId, displayName: roleId });
      for (const action of actions) {
        await db.insert(schema.adminRolePermission).values({ id: makeId("perm"), roleId, action });
      }
      await db.insert(schema.adminUserRole).values({ id: makeId("aur"), userId: users[name], roleId, assignedBy: users.adminFull });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const [name, role] of roles) {
      tokens[name] = verifier.issue(users[name], role, 0);
    }

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.kolbeSeller = kolbeSellerId;
    for (const tag of ["p1", "p2"] as const) {
      ids[tag] = makeId("prod");
      await db.insert(schema.product).values({ id: ids[tag], name: `Dash Product ${tag}`, slug: `dash-${ids[tag]}`, ownerType: "KOLBE", status: "published" });
      ids[`${tag}v`] = makeId("var");
      await db.insert(schema.productVariant).values({ id: ids[`${tag}v`], productId: ids[tag], sku: `SKU-${ids[`${tag}v`]}`, status: "active", attributes: { size: "M" } as any });
      await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids[tag], sellerId: kolbeSellerId, variantId: ids[`${tag}v`], sku: `OFFER-${ids[`${tag}v`]}`, status: "published", retailPrice: 250000n as any });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids[`${tag}v`], sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
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

  it("T1 reports the empty board honestly: zeros, empty maps, two seeded stock rows", async () => {
    const res = await get("/api/v1/admin/retail/dashboard", tokens.adminFull).expect(200);
    expect(res.body.sales).toMatchObject({ ordersCount: "0", unitsOrdered: "0", orderedGmv: "0", paidOrdersCount: "0", orderStatusCount: {} });
    expect(res.body.operations).toMatchObject({
      awaitingPayment: 0,
      fulfillmentBacklog: 0,
      shipmentBacklog: 0,
      returnsByStatus: {},
      refundsByStatus: {},
      flaggedReviews: 0,
    });
    expect(res.body.operations.inventory).toEqual({ tracked: 2, stockout: 0 });
    expect(res.body.exceptions.payments).toEqual([]);
    expect(res.body.exceptions.shipments).toEqual([]);
    expect(res.body.range.preset).toBe("LAST_30_DAYS");
    expect(typeof res.body.generatedAt).toBe("string");
  });

  it("T2 matches every figure to seeded source truth exactly", async () => {
    // O1 paid + confirmed (fulfillment backlog), O2 unpaid (awaiting payment).
    await checkoutAs("O1");
    await payOrderGateway("O1");
    await retailOrders.confirmRetailOrder(ids.O1, admin());
    await checkoutAs("O2");
    // O3 delivered (return filed), O4 paid then cancelled (refund approved).
    await checkoutAs("O3");
    await payOrderGateway("O3");
    await retailOrders.confirmRetailOrder(ids.O3, admin());
    await retailOrders.packRetailOrder(ids.O3, admin());
    const ship3 = await retailOrders.createRetailShipment(ids.O3, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
    await retailOrders.markRetailShipmentHandoff(ship3.shipment.id, admin(), { idempotencyKey: makeId("hand") });
    await retailOrders.recordRetailManualTracking(ship3.shipment.id, admin(), { state: "delivered" });
    const items3 = await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids.O3));
    await retailReturns.fileRetailReturn(buyer(), ids.O3, { lines: [{ orderItemId: (items3[0] as any).id, quantity: 1 }], reason: "DAMAGED" });
    await checkoutAs("O4");
    await payOrderGateway("O4");
    await retailOrders.cancelRetailOrder(ids.O4, admin());
    const filed = await retailOrders.requestRetailRefund(ids.O4, admin(), { amount: totals.O4, idempotencyKey: makeId("rf") });
    const refundRows = await db.select().from(schema.refund).where(eq(schema.refund.retailOrderId, ids.O4));
    expect(refundRows).toHaveLength(1);
    await retailOrders.approveRetailRefund((refundRows[0] as any).id, admin(), { idempotencyKey: makeId("ra") });
    expect((filed as any).refund).toBeTruthy();
    // O5 packed with a pending shipment (fulfillment + shipment backlog).
    await checkoutAs("O5");
    await payOrderGateway("O5");
    await retailOrders.confirmRetailOrder(ids.O5, admin());
    await retailOrders.packRetailOrder(ids.O5, admin());
    await retailOrders.createRetailShipment(ids.O5, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });

    const gmv = ["O1", "O2", "O3", "O4", "O5"].reduce((sum, t) => sum + BigInt(totals[t]), 0n).toString();
    const res = await get("/api/v1/admin/retail/dashboard", tokens.adminFull).expect(200);
    expect(res.body.sales).toMatchObject({
      ordersCount: "5",
      unitsOrdered: "10",
      orderedGmv: gmv,
      paidOrdersCount: "4",
      orderStatusCount: { confirmed: "1", placed: "1", delivered: "1", cancelled: "1", packed: "1" },
    });
    expect(res.body.operations).toMatchObject({
      awaitingPayment: 1,
      fulfillmentBacklog: 2,
      shipmentBacklog: 1,
      returnsByStatus: { REQUESTED: 1 },
      refundsByStatus: { approved: 1 },
      flaggedReviews: 0,
    });
  });

  it("T3 resolves date windows honestly and refuses bad ranges with the analytics code", async () => {
    // Isolate O1 in 2020 by backdating its creation instant.
    await db.update(schema.retailOrder).set({ createdAt: new Date("2020-01-15T12:00:00Z") }).where(eq(schema.retailOrder.id, ids.O1));
    const jan = await get("/api/v1/admin/retail/dashboard?preset=CUSTOM&startDate=2020-01-01&endDate=2020-01-31", tokens.adminFull).expect(200);
    expect(jan.body.sales).toMatchObject({ ordersCount: "1", orderedGmv: totals.O1, paidOrdersCount: "1" });
    expect(jan.body.range).toMatchObject({ preset: "CUSTOM", timezone: "Asia/Tehran" });
    const janUtc = await get("/api/v1/admin/retail/dashboard?preset=CUSTOM&startUtc=2020-01-01T00:00:00Z&endUtc=2020-02-01T00:00:00Z&timezone=UTC", tokens.adminFull).expect(200);
    expect(janUtc.body.sales.ordersCount).toBe("1");
    expect(janUtc.body.range.timezone).toBe("UTC");
    const today = await get("/api/v1/admin/retail/dashboard?preset=TODAY", tokens.adminFull).expect(200);
    expect(today.body.sales.ordersCount).toBe("4");
    for (const bad of [
      "preset=BOGUS",
      "preset=CUSTOM",
      "preset=CUSTOM&startUtc=2020-02-01T00:00:00Z&endUtc=2020-01-01T00:00:00Z",
      "preset=TODAY&startUtc=2020-01-01T00:00:00Z&endUtc=2020-02-01T00:00:00Z",
      "preset=TODAY&timezone=Mars/Olympus",
    ]) {
      const refused = await get(`/api/v1/admin/retail/dashboard?${bad}`, tokens.adminFull).expect(400);
      expect(refused.body.error).toBe("ANALYTICS_INVALID_REQUEST");
    }
  });

  it("T9 counts multi-line orders once per order and once per unit, never doubled", async () => {
    const before = await get("/api/v1/admin/retail/dashboard?preset=TODAY", tokens.adminFull).expect(200);
    await checkoutAs("O6", "p1", "p1v", 1, {
      lines: [
        { productId: ids.p1, variantId: ids.p1v, quantity: 1 },
        { productId: ids.p2, variantId: ids.p2v, quantity: 3 },
      ],
    });
    const after = await get("/api/v1/admin/retail/dashboard?preset=TODAY", tokens.adminFull).expect(200);
    expect(BigInt(after.body.sales.ordersCount) - BigInt(before.body.sales.ordersCount)).toBe(1n);
    expect(BigInt(after.body.sales.unitsOrdered) - BigInt(before.body.sales.unitsOrdered)).toBe(4n);
    expect(BigInt(after.body.sales.orderedGmv) - BigInt(before.body.sales.orderedGmv)).toBe(BigInt(totals.O6));
  });

  it("T4 shows KOLBE stock only: supplier rows never appear, filters and walks stay honest", async () => {
    // v2 row goes zero-stock; a supplier-held row shadows v1 with 999 units.
    const [v2row] = await db.select().from(schema.productVariantInventory).where(eq(schema.productVariantInventory.variantId, ids.p2v));
    await db.update(schema.productVariantInventory).set({ onHand: 5, reserved: 5 }).where(eq(schema.productVariantInventory.id, (v2row as any).id));
    const supId = makeId("supplier");
    await db.insert(schema.supplier).values({ id: supId, legalName: "Supplier Co", displayName: "Supplier" });
    await db.insert(schema.seller).values({ id: makeId("sup_seller"), type: "SUPPLIER", supplierId: supId, displayName: "Supplier", status: "active" });
    const [sup] = await db.select().from(schema.seller).where(eq(schema.seller.type, "SUPPLIER"));
    await db.insert(schema.productVariantInventory).values({ id: makeId("sup_inv"), variantId: ids.p1v, sellerId: (sup as any).id, onHand: 999, reserved: 0, status: "active" });

    const all = await get("/api/v1/admin/retail/inventory?limit=50", tokens.adminFull).expect(200);
    expect(all.body.hasMore).toBe(false);
    expect(all.body.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of all.body.rows as Array<Record<string, unknown>>) {
      expect(row.onHand).not.toBe(999);
      expect(row.sellable).toBe((row.onHand as number) - (row.reserved as number));
      expect(row.stockout).toBe((row.sellable as number) <= 0);
    }
    const stockout = await get("/api/v1/admin/retail/inventory?stockoutOnly=true", tokens.adminFull).expect(200);
    expect(stockout.body.rows).toHaveLength(1);
    expect(stockout.body.rows[0]).toMatchObject({ variantId: ids.p2v, onHand: 5, reserved: 5, sellable: 0, stockout: true });
    const byProduct = await get(`/api/v1/admin/retail/inventory?productId=${ids.p2}`, tokens.adminFull).expect(200);
    expect(byProduct.body.rows.map((r: any) => r.productId)).toEqual([ids.p2]);
    const ghost = await get("/api/v1/admin/retail/inventory?productId=ghost", tokens.adminFull).expect(200);
    expect(ghost.body.rows).toEqual([]);

    // Keyset walk terminates with every row exactly once.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page = await get(`/api/v1/admin/retail/inventory?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, tokens.adminFull).expect(200);
      for (const row of page.body.rows as Array<{ id: string }>) seen.push(row.id);
      cursor = page.body.nextCursor;
      expect(page.body.hasMore).toBe(cursor !== null);
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(all.body.rows.length);

    const bad = await get("/api/v1/admin/retail/inventory?cursor=not-a-cursor", tokens.adminFull).expect(400);
    expect(bad.body.error).toBe("ANALYTICS_INVALID_REQUEST");
  });

  it("T5 exposes payment/shipping exceptions with provider truth and failure reasons", async () => {
    // One honest awaiting-verification payment via the seam (p1 has stock).
    await checkoutAs("O7");
    await retailOrders.submitPaymentEvidence(ids.O7, { actorId: users.custA, actorRole: "customer" }, {
      rail: "manual_transfer",
      amount: totals.O7,
      evidenceReference: "BANK-O7",
      idempotencyKey: makeId("ev"),
    });
    // Failed fixtures carry references, rails, reasons, and ages.
    await db.insert(schema.payment).values({
      id: makeId("pay"), paymentReference: `REF-FAIL-${ids.O7}`, retailOrderId: ids.O7, method: "manual_transfer", provider: "manual",
      status: "failed", amount: 1000n as any, currency: "IRR", failureReason: "bank rejected the transfer",
    } as any);
    await db.insert(schema.shipment).values({
      id: makeId("shp"), shipmentCode: `SHP-FAIL-${ids.O7}`, retailOrderId: ids.O7, sellerId: ids.kolbeSeller, provider: "manual",
      status: "failed", failureReason: "carrier lost the parcel",
    } as any);

    const res = await get("/api/v1/admin/retail/exceptions", tokens.adminFull).expect(200);
    const failedPay = (res.body.payments as any[]).find((p) => p.failureReason === "bank rejected the transfer");
    expect(failedPay).toMatchObject({ status: "failed", method: "manual_transfer", provider: "manual", orderCode: expect.any(String) });
    expect(failedPay.retailOrderId).toBe(ids.O7);
    const awaiting = (res.body.payments as any[]).find((p) => p.status === "evidence_submitted" && p.retailOrderId === ids.O7);
    expect(awaiting).toMatchObject({ provider: "manual", failureReason: null });
    const failedShp = (res.body.shipments as any[]).find((s) => s.failureReason === "carrier lost the parcel");
    expect(failedShp).toMatchObject({ status: "failed", provider: "manual", orderCode: expect.any(String) });
    // Verified payments and delivered shipments never appear as exceptions.
    for (const p of res.body.payments as any[]) expect(["pending", "evidence_submitted", "failed"]).toContain(p.status);
    for (const s of res.body.shipments as any[]) expect(["pending", "ready", "handed_over", "in_transit", "failed"]).toContain(s.status);
    expect(res.body.paymentCounts.failed).toBeGreaterThanOrEqual(1);
    expect(res.body.shipmentCounts.failed).toBeGreaterThanOrEqual(1);
    // Offset paging is stable.
    const p1 = await get("/api/v1/admin/retail/exceptions?limit=1&offset=0", tokens.adminFull).expect(200);
    expect(p1.body.limit).toBe(1);
    expect(p1.body.offset).toBe(0);
  });

  it("T6 adds no math: dashboard sales equal a direct engine run on the same range", async () => {
    const range = { preset: "CUSTOM", startUtc: "2020-01-01T00:00:00Z", endUtc: "2020-02-01T00:00:00Z", timezone: "UTC" } as any;
    const direct = await analytics.run(
      { metricKeys: ["retail.orders_count", "retail.units_ordered", "retail.ordered_gmv", "retail.paid_orders_count", "retail.order_status_count"], scope: "RETAIL", range },
      undefined,
    );
    const viaHttp = await get("/api/v1/admin/retail/dashboard?preset=CUSTOM&startUtc=2020-01-01T00:00:00Z&endUtc=2020-02-01T00:00:00Z&timezone=UTC", tokens.adminFull).expect(200);
    const value = (key: string) => String(direct.metrics.find((m) => m.key === key)?.value ?? "0");
    expect(viaHttp.body.sales).toMatchObject({
      ordersCount: value("retail.orders_count"),
      unitsOrdered: value("retail.units_ordered"),
      orderedGmv: value("retail.ordered_gmv"),
      paidOrdersCount: value("retail.paid_orders_count"),
    });
    const statusMap: Record<string, string> = {};
    for (const item of direct.metrics.find((m) => m.key === "retail.order_status_count")?.breakdown ?? []) {
      statusMap[item.key] = String(item.value);
    }
    expect(viaHttp.body.sales.orderStatusCount).toEqual(statusMap);
    expect(viaHttp.body.range.startUtc).toBe(direct.range.startUtc);
  });

  it("T7 gates each B surface on its own permission", async () => {
    await get("/api/v1/admin/retail/dashboard", tokens.adminDashboard).expect(200);
    await get("/api/v1/admin/retail/inventory", tokens.adminDashboard).expect(403);
    await get("/api/v1/admin/retail/exceptions", tokens.adminDashboard).expect(403);
    await get("/api/v1/admin/retail/inventory", tokens.adminInventory).expect(200);
    await get("/api/v1/admin/retail/dashboard", tokens.adminInventory).expect(403);
    await get("/api/v1/admin/retail/exceptions", tokens.adminFinance).expect(200);
    await get("/api/v1/admin/retail/dashboard", tokens.adminFinance).expect(403);
    await get("/api/v1/admin/retail/dashboard", tokens.adminOrderView).expect(403);
    for (const url of ["/api/v1/admin/retail/dashboard", "/api/v1/admin/retail/inventory", "/api/v1/admin/retail/exceptions"]) {
      await get(url).expect(401);
      await get(url, tokens.custA).expect(403);
    }
  });

  it("T8 treats injection-shaped filters as inert data, never errors or leaks", async () => {
    const evil = encodeURIComponent(`' OR '1'='1`);
    const res = await get(`/api/v1/admin/retail/inventory?productId=${evil}`, tokens.adminFull).expect(200);
    expect(res.body.rows).toEqual([]);
    await get(`/api/v1/admin/retail/inventory?stockoutOnly=${encodeURIComponent("true' OR '1'='1")}`, tokens.adminFull).expect(200);
    const preset = await get(`/api/v1/admin/retail/dashboard?preset=${encodeURIComponent("TODAY' OR 1=1--")}`, tokens.adminFull).expect(400);
    expect(preset.body.error).toBe("ANALYTICS_INVALID_REQUEST");
    // The database survives: the board still answers after hostile input.
    await get("/api/v1/admin/retail/dashboard", tokens.adminFull).expect(200);
    const tables = await db.execute(`SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'`);
    expect((tables as any).rows[0].c).toBe(198);
  });

  function buyer() {
    return { actorId: users.custA, actorRole: "customer" };
  }
});
