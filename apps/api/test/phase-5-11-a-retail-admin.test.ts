import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { AdminRbacService } from "../src/modules/admin/admin-rbac.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";
import { RetailReturnsService } from "../src/modules/orders/retail/retail-returns.service";

/**
 * Phase 5.11-A — Retail Admin control plane & RBAC (Nest e2e).
 *
 * Covers the admin/retail/* view namespace end-to-end against real
 * PostgreSQL: fail-closed granular RBAC (unknown/missing retail:* denied,
 * super-admin bootstrap semantics kept), the control-tower overview from
 * authoritative facts only, every operational list (orders/payments/
 * shipments/returns/refunds/customers/reviews/products/low-stock) with
 * fixed filters + production-safe keyset pagination, safe projections
 * (BIGINT money as strings, no account secrets), and retail-vs-wholesale
 * read isolation (wholesale rows never leak into retail admin views).
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_a_retail_admin_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let retailReturns: RetailReturnsService;
let rbac: AdminRbacService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511a_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "admin" | "clerk", string>;
const tokens = {} as Record<"custA" | "custB" | "admin" | "clerk", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;
let kolbeSellerId = "";

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
const admin = () => ({ actorId: users.admin, actorRole: "admin" });

function orderBody(tag: string, overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: tag.startsWith("B") ? "Reza Test" : "Sara Test", phone: tag.startsWith("B") ? "09120000002" : "09120000001", email: `${tag.toLowerCase()}@test.com` },
    lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1 }],
    address: {
      province: "تهران",
      city: "تهران",
      address: "خیابان آزمون",
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

async function checkout(tag: string, who: "A" | "B" = "A", overrides: Record<string, unknown> = {}) {
  const created = await retailOrders.createRetailOrder(
    who === "A" ? { kind: "customer", userId: users.custA } : { kind: "customer", userId: users.custB },
    { ...(orderBody(tag, overrides) as any), idempotencyKey: makeId("key") },
  );
  ids[tag] = created.id;
  totals[tag] = created.totals.grandTotal;
  return created;
}

async function payGateway(tag: string) {
  const actor = tag === "B1" ? buyerB() : buyerA();
  const { payment } = await retailOrders.submitPaymentEvidence(ids[tag], actor, {
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

async function orderItemIds(orderId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.retailOrderItem.id }).from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, orderId));
  return rows.map((row) => row.id);
}

function walkPages(paths: Array<{ items: any[] }>): { seen: string[]; complete: boolean } {
  const seen: string[] = [];
  for (const page of paths) for (const item of page.items) seen.push(String(item.id));
  const complete = new Set(seen).size === seen.length;
  return { seen, complete };
}

describe("Phase 5.11-A retail admin control plane", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511a-retail-admin";
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
    rbac = app.get(AdminRbacService);

    // Users: two customers, the bootstrap super-admin (NO granular rows),
    // and a granular clerk (role rows only — the 5.11 failure mode this
    // test pins).
    for (const [name, role] of [
      ["custA", "customer"],
      ["custB", "customer"],
      ["admin", "admin"],
      ["clerk", "admin"],
    ] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId,
        email: `${userId}@test.com`,
        displayName: name === "custA" ? "Sara Test" : name === "custB" ? "Reza Test" : name,
        phone: name === "custA" ? "09120000001" : name === "custB" ? "09120000002" : null,
        passwordHash: "h",
        salt: "s",
        role,
        status: "active",
        tokenVersion: 0,
        failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "admin", "clerk"] as const) {
      tokens[name] = verifier.issue(users[name], name === "custA" || name === "custB" ? "customer" : "admin", 0);
    }

    // Granular clerk role: dashboard + order views ONLY.
    const clerkRole = await rbac.createRole({ name: "retail-clerk-511a", displayName: "Retail Clerk" }, users.admin);
    await rbac.assignPermissionsToRole(clerkRole.id, ["retail:dashboard:view", "retail:order:view"], users.admin);
    await rbac.assignRoleToUser(users.clerk, clerkRole.id, users.admin);

    // Catalog + stock fixtures.
    const offers = app.get(OffersService);
    kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    ids.p1 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p1, name: "Admin View Product", slug: `av-${ids.p1}`, ownerType: "KOLBE", status: "published" });
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M" } as any });
    await db.insert(schema.sellerOffer).values({
      id: makeId("offer"),
      productId: ids.p1,
      sellerId: kolbeSellerId,
      variantId: ids.v1,
      sku: `OFFER-${ids.v1}`,
      status: "published",
      retailPrice: 250000n as any,
    });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
    ids.p2 = makeId("prod");
    await db.insert(schema.product).values({ id: ids.p2, name: "Zero Stock Product", slug: `zs-${ids.p2}`, ownerType: "KOLBE", status: "published" });
    ids.v2 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v2, productId: ids.p2, sku: `SKU-${ids.v2}`, status: "active", attributes: {} as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv2"), variantId: ids.v2, sellerId: kolbeSellerId, onHand: 0, reserved: 0, status: "active" });

    // Wholesale fixture chain (account → order → child) so the isolation
    // tests can insert wholesale-side payment/refund/shipment rows: the
    // retail admin views must never surface them.
    ids.wholesaleAccount = makeId("wacc");
    await db.insert(schema.wholesaleAccount).values({
      id: ids.wholesaleAccount,
      userId: users.admin,
      memberName: "Wholesale Fixture",
      storeName: "Fixture Store",
      phone: "09125550000",
      city: "تهران",
      status: "approved",
    });
    ids.wholesaleOrder = makeId("wo");
    await db.insert(schema.wholesaleOrder).values({
      id: ids.wholesaleOrder,
      orderCode: `WO-${ids.wholesaleOrder}`,
      accountId: ids.wholesaleAccount,
      buyerUserId: users.admin,
      status: "draft",
    });
    ids.purchaseOrder = makeId("po");
    await db.insert(schema.purchaseOrder).values({
      id: ids.purchaseOrder,
      orderCode: `PO-${ids.purchaseOrder}`,
      sellerId: kolbeSellerId,
      status: "pending",
    });
  }, 240_000);

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

  it("denies the namespace without a session, and non-admins with 403 (role gate)", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/retail/overview").expect(401);
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/overview")
      .set("authorization", `Bearer ${tokens.custA}`)
      .expect(403);
  });

  it("fails closed for granular admins without the retail:* permission (no role==='admin' bypass)", async () => {
    // The clerk IS accountUser.role=admin but holds only two granular perms.
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/overview")
      .set("authorization", `Bearer ${tokens.clerk}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/orders")
      .set("authorization", `Bearer ${tokens.clerk}`)
      .expect(200);
    for (const path of [
      "/api/v1/admin/retail/payments",
      "/api/v1/admin/retail/shipments",
      "/api/v1/admin/retail/returns",
      "/api/v1/admin/retail/refunds",
      "/api/v1/admin/retail/customers",
      "/api/v1/admin/retail/reviews",
      "/api/v1/admin/retail/products",
      "/api/v1/admin/retail/inventory/low-stock",
    ]) {
      const res = await request(app.getHttpServer()).get(path).set("authorization", `Bearer ${tokens.clerk}`);
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe("ADMIN_PERMISSION_DENIED");
    }
    // Super-admin bootstrap semantics: no granular rows => full catalog.
    await request(app.getHttpServer())
      .get("/api/v1/admin/retail/payments")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
  });

  it("rejects assigning permissions outside the closed catalog (service-level fail-closed)", async () => {
    const role = await rbac.createRole({ name: "bad-perm-511a", displayName: "Bad Perm" }, users.admin);
    await expect(
      rbac.assignPermissionsToRole(role.id, ["retail:order:explode", "retail:order:view"], users.admin),
    ).rejects.toMatchObject({ code: "UNKNOWN_PERMISSION_ACTION" });
  });

  it("builds the fixture: paid+cancelled (refund), delivered (return), unpaid, COD orders", async () => {
    await checkout("O1");
    await payGateway("O1");
    await retailOrders.cancelRetailOrder(ids.O1, admin());
    await retailOrders.requestRetailRefund(ids.O1, admin(), { amount: totals.O1, idempotencyKey: makeId("req") });

    await checkout("O2");
    await payGateway("O2");
    await driveToDelivered("O2");
    const [lineId] = await orderItemIds(ids.O2);
    await retailReturns.fileRetailReturn(buyerA(), ids.O2, { lines: [{ orderItemId: lineId, quantity: 1 }], reason: "DAMAGED", note: "box crushed" });

    await checkout("O3");
    await checkout("B1", "B", { payMethod: "cod" });
    expect(ids.O1 && ids.O2 && ids.O3 && ids.B1).toBeTruthy();
  }, 120_000);

  it("overview: control tower reports authoritative facts only", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/retail/overview")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    const o = res.body.overview;
    expect(o.kolbeSellerId).toBe(kolbeSellerId);
    expect(o.orders.byStatus).toMatchObject({ cancelled: 1, delivered: 1, placed: 2 });
    expect(o.orders.total).toBe(4);
    expect(o.orders.requiringAction).toBe(2);
    expect(o.payments).toMatchObject({ paid: 2, unpaid: 1, pending_cod: 1, total: 4 });
    expect(o.shippingExceptions).toBe(0);
    expect(o.pendingReturns).toBe(1);
    expect(o.pendingRefunds).toBe(1);
    expect(o.criticalStockVariants).toBe(1); // the zero-stock variant only
    // GMV per currency, as strings, exactly the paid orders' totals.
    expect(o.period.days7.ordersCreated).toBe(4);
    const expectedGmv = (BigInt(totals.O1) + BigInt(totals.O2)).toString();
    expect(o.period.days7.paidGmvByCurrency.IRR).toBe(expectedGmv);
    expect(typeof o.generatedAt).toBe("string");
  });

  it("orders list: filters are fixed + parameterized, money is a string, keyset pages fully", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const all = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders").set(auth).expect(200);
    expect(all.body.items).toHaveLength(4);
    for (const item of all.body.items) {
      expect(typeof item.grandTotal).toBe("string");
      expect(BigInt(item.grandTotal) > 0n).toBe(true);
    }
    // status / payment / code / phone / customer filters
    const delivered = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?status=delivered").set(auth).expect(200);
    expect(delivered.body.items.map((i: any) => i.id)).toEqual([ids.O2]);
    const cod = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?paymentStatus=pending_cod").set(auth).expect(200);
    expect(cod.body.items.map((i: any) => i.id)).toEqual([ids.B1]);
    const o3row: any = (await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.O3)))[0];
    const byCode = await request(app.getHttpServer()).get(`/api/v1/admin/retail/orders?orderCode=${o3row.orderCode}`).set(auth).expect(200);
    expect(byCode.body.items).toHaveLength(1);
    const byPhone = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?customerPhone=09120000001").set(auth).expect(200);
    expect(byPhone.body.items).toHaveLength(3);
    const byCustB = await request(app.getHttpServer()).get(`/api/v1/admin/retail/orders?customerId=${users.custB}`).set(auth).expect(200);
    expect(byCustB.body.items.map((i: any) => i.id)).toEqual([ids.B1]);
    // lateral shipment status filter + annotation
    const shipped = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?shipmentStatus=delivered").set(auth).expect(200);
    expect(shipped.body.items.map((i: any) => i.id)).toEqual([ids.O2]);
    expect(shipped.body.items[0].latestShipmentStatus).toBe("delivered");
    expect(all.body.items.find((i: any) => i.id === ids.O3).latestShipmentStatus).toBeNull();
    // created range
    const future = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?dateFrom=2030-01-01T00:00:00Z").set(auth).expect(200);
    expect(future.body.items).toHaveLength(0);
    // unknown status value is rejected, not ignored
    const bad = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?status=bogus").set(auth);
    expect(bad.status).toBe(400);
    // keyset pagination: walk limit=2 to the end; no dups, no gaps
    const pages: any[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/retail/orders?limit=2${cursor ? `&cursor=${cursor}` : ""}`)
        .set(auth)
        .expect(200);
      pages.push(res.body);
      if (!res.body.hasMore) break;
      cursor = res.body.nextCursor;
    }
    expect(pages.length).toBe(2);
    const walked = walkPages(pages);
    expect(walked.seen.sort()).toEqual([ids.O1, ids.O2, ids.O3, ids.B1].sort());
    expect(walked.complete).toBe(true);
  });

  it("order detail + timeline expose the owner view, its parcels, and the event history", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const res = await request(app.getHttpServer()).get(`/api/v1/admin/retail/orders/${ids.O2}`).set(auth).expect(200);
    expect(res.body.order.status).toBe("delivered");
    expect(res.body.order.totals.grandTotal).toBe(totals.O2);
    expect(res.body.order.shipments).toHaveLength(1);
    expect(res.body.order.shipments[0].status).toBe("delivered");
    const tl = await request(app.getHttpServer()).get(`/api/v1/admin/retail/orders/${ids.O2}/timeline`).set(auth).expect(200);
    expect(tl.body.orderCode).toBe(res.body.order.orderCode);
    expect(tl.body.timeline.map((e: any) => e.toStatus)).toEqual(
      expect.arrayContaining(["confirmed", "packed", "shipped", "delivered"]),
    );
    await request(app.getHttpServer()).get("/api/v1/admin/retail/orders/does-not-exist").set(auth).expect(404);
  });

  it("payments list/detail are retail-only (wholesale rows never leak)", async () => {
    await db.insert(schema.payment).values({
      id: makeId("wpay"),
      paymentReference: `WO-PAY-${ids.wholesaleOrder}`,
      wholesaleOrderId: ids.wholesaleOrder,
      method: "bank_transfer",
      status: "verified",
      amount: 999000n as any,
    });
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/payments").set(auth).expect(200);
    const orderIds = list.body.items.map((p: any) => p.retailOrderId).sort();
    expect(orderIds).toEqual([ids.O1, ids.O2].sort());
    expect(list.body.items.every((p: any) => typeof p.amount === "string")).toBe(true);
    const byOrder = await request(app.getHttpServer()).get(`/api/v1/admin/retail/payments?retailOrderId=${ids.O2}`).set(auth).expect(200);
    expect(byOrder.body.items).toHaveLength(1);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/payments/${byOrder.body.items[0].id}`).set(auth).expect(200);
    expect(detail.body.payment.retailOrderId).toBe(ids.O2);
    expect(detail.body.payment.status).toBe("verified");
    // wholesale payment id must 404 on the retail surface
    const [wholesaleRow] = await db.select().from(schema.payment).where(eq(schema.payment.wholesaleOrderId, ids.wholesaleOrder));
    await request(app.getHttpServer()).get(`/api/v1/admin/retail/payments/${(wholesaleRow as any).id}`).set(auth).expect(404);
  });

  it("shipments list/detail are retail-only (wholesale parcels never leak)", async () => {
    await db.insert(schema.shipment).values({
      id: makeId("wshp"),
      shipmentCode: `SHP-${makeId("x")}`,
      wholesaleOrderId: ids.wholesaleOrder,
      childOrderId: ids.purchaseOrder,
      sellerId: kolbeSellerId,
      status: "delivered",
    });
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/shipments").set(auth).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].retailOrderId).toBe(ids.O2);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/shipments/${list.body.items[0].id}`).set(auth).expect(200);
    expect(detail.body.shipment.status).toBe("delivered");
    expect(detail.body.shipment.items).toHaveLength(1);
  });

  it("returns list/detail expose the staff queue (owner: orders/retail)", async () => {
    const auth = { authorization: `Bearer ${tokens.clerk}` }; // clerk lacks return:view
    await request(app.getHttpServer()).get("/api/v1/admin/retail/returns").set(auth).expect(403);
    const adminAuth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/returns").set(adminAuth).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ orderId: ids.O2, status: "REQUESTED", supportCaseId: expect.anything() });
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/returns/${list.body.items[0].id}`).set(adminAuth).expect(200);
    expect(detail.body.return.status).toBe("REQUESTED");
    expect(detail.body.return.items).toHaveLength(1);
  });

  it("refunds list/detail expose retail refund truth (BIGINT as strings)", async () => {
    await db.insert(schema.refund).values({
      id: makeId("wref"),
      refundReference: `WO-REF-${ids.wholesaleOrder}`,
      wholesaleOrderId: ids.wholesaleOrder,
      amount: 42n as any,
      status: "requested",
    });
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/refunds").set(auth).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].retailOrderId).toBe(ids.O1);
    expect(list.body.items[0].status).toBe("requested");
    expect(list.body.items[0].amount).toBe(totals.O1);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/refunds/${list.body.items[0].id}`).set(auth).expect(200);
    expect(detail.body.refund.amount).toBe(totals.O1);
  });

  it("customers list/detail: safe projection only (no secret material in the payload)", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/customers").set(auth).expect(200);
    expect(list.body.items).toHaveLength(2);
    const bySearch = await request(app.getHttpServer()).get("/api/v1/admin/retail/customers?search=Sara").set(auth).expect(200);
    expect(bySearch.body.items.map((c: any) => c.id)).toEqual([users.custA]);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/customers/${users.custA}`).set(auth).expect(200);
    expect(detail.body.customer).toMatchObject({ id: users.custA, role: "customer", status: "active" });
    const dump = JSON.stringify(detail.body);
    for (const forbidden of ["passwordHash", "password_hash", "salt", "totpSecret", "totp_secret"]) {
      expect(dump).not.toContain(forbidden);
    }
    // supplier/admin accounts are not customer profiles
    await request(app.getHttpServer()).get(`/api/v1/admin/retail/customers/${users.admin}`).set(auth).expect(403);
  });

  it("reviews moderation queue sees hidden reviews (public list does not)", async () => {
    await db.insert(schema.productRating).values({ id: makeId("rev"), productId: ids.p1, raterId: users.custA, rating: 3, review: "khajeh", status: "hidden", verifiedRetailOrderId: ids.O2 });
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const visible = await request(app.getHttpServer()).get(`/api/v1/admin/retail/reviews?productId=${ids.p1}`).set(auth).expect(200);
    expect(visible.body.items).toHaveLength(1);
    expect(visible.body.items[0].status).toBe("hidden");
    const byStatus = await request(app.getHttpServer()).get(`/api/v1/admin/retail/reviews?status=hidden`).set(auth).expect(200);
    expect(byStatus.body.items).toHaveLength(1);
    const bogus = await request(app.getHttpServer()).get(`/api/v1/admin/retail/reviews?status=bogus`).set(auth);
    expect(bogus.status).toBe(400);
  });

  it("products list/detail: ops view composes catalog+offers+inventory+ratings seams", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const list = await request(app.getHttpServer()).get("/api/v1/admin/retail/products").set(auth).expect(200);
    expect(list.body.items.map((p: any) => p.id).sort()).toEqual([ids.p1, ids.p2].sort());
    const byStatus = await request(app.getHttpServer()).get("/api/v1/admin/retail/products?status=published").set(auth).expect(200);
    expect(byStatus.body.items).toHaveLength(2);
    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/retail/products/${ids.p1}`).set(auth).expect(200);
    expect(detail.body.product.status).toBe("published");
    expect(detail.body.product.variants).toHaveLength(1);
    const stock = detail.body.product.variants[0].stock;
    expect(stock).not.toBeNull();
    expect(BigInt(stock.onHand) - BigInt(stock.reserved)).toBe(BigInt(stock.available));
    expect(detail.body.product.kolbeOffers).toHaveLength(1);
    expect(detail.body.product.kolbeOffers[0].retailPrice).toBe("250000");
    // hidden reviews are excluded from the public aggregate
    expect(detail.body.product.reviews.count).toBe(0);
  });

  it("low stock: KOLBE-seller scoped availability truth, annotated with variant facts", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const res = await request(app.getHttpServer()).get("/api/v1/admin/retail/inventory/low-stock").set(auth).expect(200);
    expect(res.body.sellerId).toBe(kolbeSellerId);
    expect(res.body.thresholdMode).toBe("availability");
    expect(res.body.items.map((v: any) => v.variantId)).toEqual([ids.v2]);
    expect(res.body.items[0]).toMatchObject({ available: "0", productId: ids.p2, sku: `SKU-${ids.v2}` });
  });

  it("keyset cursors are opaque base64url JSON pairs and are validated", async () => {
    const auth = { authorization: `Bearer ${tokens.admin}` };
    const page1: any = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?limit=2").set(auth).expect(200);
    expect(page1.body.nextCursor).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(page1.body.nextCursor, "base64url").toString("utf8"));
    expect(Array.isArray(decoded) && decoded.length).toBe(2);
    expect(Number.isFinite(Date.parse(decoded[0]))).toBe(true);
    // a garbage cursor is a client error on the self-decoding seam (orders)
    const badOrders = await request(app.getHttpServer()).get("/api/v1/admin/retail/orders?limit=2&cursor=!!!").set(auth);
    expect(badOrders.status).toBe(400);
    expect(badOrders.body.error).toBe("RETAIL_CUSTOMER_CURSOR_INVALID");
    // …and on the raw-pair seam (payments) it degrades to the first page
    const fallback = await request(app.getHttpServer()).get("/api/v1/admin/retail/payments?cursor=!!!").set(auth).expect(200);
    expect(fallback.body.items).toHaveLength(2);
  });

  it("retail/wholesale isolation: the admin/retail overview ignores wholesale aggregates entirely", async () => {
    // The overview must stay at exactly the 4 retail orders even though
    // wholesale payment/refund/shipment fixture rows now exist.
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/retail/overview")
      .set("authorization", `Bearer ${tokens.admin}`)
      .expect(200);
    expect(res.body.overview.orders.total).toBe(4);
    expect(res.body.overview.payments.total).toBe(4);
  });
});
