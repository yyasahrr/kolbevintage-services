import fs from "node:fs";
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
import { RatingsService } from "../src/modules/ratings/ratings.service";

/**
 * Phase 5.11-A (admin tranche) — retail admin control plane over HTTP.
 *
 * The 23 console-tranche routes keep their paths and seam behavior and
 * gain granular `retail:*` gates; reviews and customers are new bounded
 * surfaces. Each test drives HTTP and pins the seam behind it. Real
 * PostgreSQL, full Nest application, real domain services.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_11_admin_a_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let app: INestApplication;
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let retailOrders: RetailOrdersService;
let retailReturns: RetailReturnsService;
let ratings: RatingsService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_r511aa_${Date.now()}_${seq++}`;

type UserKey = "custA" | "custB" | "adminFull" | "adminOrderView" | "adminOrderCancel" | "adminRefundView" | "adminReturnManage" | "adminReviewView" | "adminCustomerView";
const users = {} as Record<UserKey, string>;
const tokens = {} as Record<UserKey | "financeHat", string>;
const ids = {} as Record<string, string>;
const totals = {} as Record<string, string>;

const buyerA = () => ({ actorId: users.custA, actorRole: "customer" });
const buyerB = () => ({ actorId: users.custB, actorRole: "customer" });
const admin = () => ({ actorId: users.adminFull, actorRole: "admin" });

function orderBody(productId: string, variantId: string) {
  return {
    customer: { name: "سارا آزمون", phone: "09121234567", email: "sara@example.test" },
    lines: [{ productId, variantId, quantity: 2 }],
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
  };
}

async function checkoutAs(buyer: string, productTag: string, variantTag: string, orderTag: string) {
  const created = await retailOrders.createRetailOrder(
    { kind: "customer", userId: users[buyer as UserKey] },
    orderBody(ids[productTag], ids[variantTag]) as any,
  );
  ids[orderTag] = created.id;
  totals[orderTag] = created.totals.grandTotal;
  return created;
}

async function payOrderGateway(orderTag: string, buyer: string) {
  const { payment } = await retailOrders.submitPaymentEvidence(
    ids[orderTag],
    { actorId: users[buyer as UserKey], actorRole: "customer" },
    { rail: "manual_transfer", amount: totals[orderTag], evidenceReference: `BANK-${orderTag}`, idempotencyKey: makeId("ev") },
  );
  const { view } = await retailOrders.verifyPayment(payment.id, admin(), {
    externalReference: `BANK-${orderTag}-VERIFY`,
    idempotencyKey: makeId("verify"),
  });
  expect(view.payment.status).toBe("paid");
  return view;
}

async function buyAndDeliver(buyer: string, productTag: string, variantTag: string, orderTag: string) {
  const created = await checkoutAs(buyer, productTag, variantTag, orderTag);
  await payOrderGateway(orderTag, buyer);
  await retailOrders.confirmRetailOrder(created.id, admin());
  await retailOrders.packRetailOrder(created.id, admin());
  const shipment = await retailOrders.createRetailShipment(created.id, admin(), { idempotencyKey: makeId("ship"), providerName: "manual" });
  await retailOrders.markRetailShipmentHandoff(shipment.shipment.id, admin(), { idempotencyKey: makeId("hand") });
  await retailOrders.recordRetailManualTracking(shipment.shipment.id, admin(), { state: "delivered" });
  return created.id;
}

async function fileReturnFor(buyer: () => { actorId: string; actorRole: string }, orderTag: string, quantity = 1) {
  const items = await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids[orderTag]));
  expect(items.length).toBeGreaterThan(0);
  return retailReturns.fileRetailReturn(buyer(), ids[orderTag], {
    lines: [{ orderItemId: (items[0] as any).id, quantity }],
    reason: "QUALITY_ISSUE",
  });
}

const get = (url: string, token?: string) => {
  const req = request(app.getHttpServer()).get(url);
  return token ? req.set("authorization", `Bearer ${token}`) : req;
};
const post = (url: string, token?: string, body: unknown = {}) => {
  const req = request(app.getHttpServer()).post(url);
  return (token ? req.set("authorization", `Bearer ${token}`) : req).send(body as any);
};

describe("Phase 5.11-A admin control plane", () => {
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
    process.env.KOLBE_SESSION_SECRET = "test-secret-p511a-admin";
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
    ratings = app.get(RatingsService);

    const roles: Array<[UserKey, "customer" | "admin"]> = [
      ["custA", "customer"],
      ["custB", "customer"],
      ["adminFull", "admin"],
      ["adminOrderView", "admin"],
      ["adminOrderCancel", "admin"],
      ["adminRefundView", "admin"],
      ["adminReturnManage", "admin"],
      ["adminReviewView", "admin"],
      ["adminCustomerView", "admin"],
    ];
    for (const [name, role] of roles) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    // Least-privilege grants: one role per limited admin, nothing more.
    const grants: Array<[UserKey, string[]]> = [
      ["adminOrderView", ["retail:order:view"]],
      ["adminOrderCancel", ["retail:order:cancel"]],
      ["adminRefundView", ["retail:refund:view"]],
      ["adminReturnManage", ["retail:return:view", "retail:return:manage"]],
      ["adminReviewView", ["retail:review:view"]],
      ["adminCustomerView", ["retail:customer:view"]],
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
    tokens.financeHat = verifier.issue(users.adminFull, "finance", 0);

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    for (const tag of ["p1", "p2"] as const) {
      ids[tag] = makeId("prod");
      await db.insert(schema.product).values({ id: ids[tag], name: `Admin Product ${tag}`, slug: `admin-${ids[tag]}`, ownerType: "KOLBE", status: "published" });
      ids[`${tag}v`] = makeId("var");
      await db.insert(schema.productVariant).values({ id: ids[`${tag}v`], productId: ids[tag], sku: `SKU-${ids[`${tag}v`]}`, status: "active", attributes: { size: "M" } as any });
      await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids[tag], sellerId: kolbeSellerId, variantId: ids[`${tag}v`], sku: `OFFER-${ids[`${tag}v`]}`, status: "published", retailPrice: 250000n as any });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids[`${tag}v`], sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });
    }
    // Review fixtures: custA owns delivered p1, custB owns delivered p1+p2.
    await buyAndDeliver("custA", "p1", "p1v", "revSeedA");
    await buyAndDeliver("custB", "p1", "p1v", "revSeedB1");
    await buyAndDeliver("custB", "p2", "p2v", "revSeedB2");
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

  it("enforces the read-permission matrix: view power is per-surface", async () => {
    await get("/api/v1/admin/retail/orders", tokens.adminOrderView).expect(200);
    await get("/api/v1/admin/retail/returns", tokens.adminOrderView).expect(403);
    await get("/api/v1/admin/retail/refunds", tokens.adminOrderView).expect(403);
    await get("/api/v1/admin/retail/reviews", tokens.adminOrderView).expect(403);
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.adminOrderView).expect(403);
    await get("/api/v1/admin/retail/refunds", tokens.adminRefundView).expect(200);
    await get("/api/v1/admin/retail/orders", tokens.adminRefundView).expect(403);
    await get("/api/v1/admin/retail/reviews", tokens.adminReviewView).expect(200);
    await get("/api/v1/admin/retail/orders", tokens.adminReviewView).expect(403);
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.adminCustomerView).expect(200);
    await get("/api/v1/admin/retail/orders", tokens.adminCustomerView).expect(403);
    // Bootstrap full admin keeps every surface.
    await get("/api/v1/admin/retail/orders", tokens.adminFull).expect(200);
    await get("/api/v1/admin/retail/returns", tokens.adminFull).expect(200);
    await get("/api/v1/admin/retail/refunds", tokens.adminFull).expect(200);
    await get("/api/v1/admin/retail/reviews", tokens.adminFull).expect(200);
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.adminFull).expect(200);
  });

  it("denies non-admins and anonymous callers on every new surface", async () => {
    for (const url of ["/api/v1/admin/retail/orders", "/api/v1/admin/retail/returns", "/api/v1/admin/retail/refunds", "/api/v1/admin/retail/reviews", `/api/v1/admin/retail/customers/${users.custA}`]) {
      await get(url).expect(401);
      await get(url, tokens.custA).expect(403);
    }
    await post(`/api/v1/admin/retail/reviews/whatever/hide`).expect(401);
    await post(`/api/v1/admin/retail/reviews/whatever/hide`, tokens.custA).expect(403);
  });

  it("gates writes separately from reads, including the cancel/manage split", async () => {
    await checkoutAs("custA", "p1", "p1v", "W1");
    await payOrderGateway("W1", "custA");
    // View power is not manage power.
    await post(`/api/v1/admin/retail/orders/${ids.W1}/confirm`, tokens.adminOrderView).expect(403);
    await post(`/api/v1/admin/retail/orders/${ids.W1}/cancel`, tokens.adminOrderView).expect(403);
    // Cancel power is not manage power, and manage-via-view is denied.
    await post(`/api/v1/admin/retail/orders/${ids.W1}/confirm`, tokens.adminOrderCancel).expect(403);
    const cancelled = await post(`/api/v1/admin/retail/orders/${ids.W1}/cancel`, tokens.adminOrderCancel).expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    // Review view power is not moderate power.
    await post(`/api/v1/admin/retail/reviews/whatever/hide`, tokens.adminReviewView).expect(403);
  });

  it("exposes no arbitrary status mutation: PATCH/PUT are 404, legal/illegal transitions keep their codes", async () => {
    await checkoutAs("custA", "p1", "p1v", "M1");
    await payOrderGateway("M1", "custA");
    await request(app.getHttpServer()).patch(`/api/v1/admin/retail/orders/${ids.M1}`).set("authorization", `Bearer ${tokens.adminFull}`).send({ status: "delivered" }).expect(404);
    await request(app.getHttpServer()).put(`/api/v1/admin/retail/orders/${ids.M1}`).set("authorization", `Bearer ${tokens.adminFull}`).send({ status: "delivered" }).expect(404);
    const illegal = await post(`/api/v1/admin/retail/orders/${ids.M1}/pack`, tokens.adminFull).expect(400);
    expect(illegal.body.error).toBe("RETAIL_TRANSITION_INVALID");
    const legal = await post(`/api/v1/admin/retail/orders/${ids.M1}/confirm`, tokens.adminFull).expect(200);
    expect(legal.body.status).toBe("confirmed");
  });

  it("runs the full return chain over HTTP and refuses the double restock", async () => {
    await buyAndDeliver("custA", "p1", "p1v", "R1");
    const filed = await fileReturnFor(buyerA, "R1");
    // Manage power without view is still denied at the gate shape we granted (view+manage granted together).
    await post(`/api/v1/admin/retail/returns/${filed.id}/approve`, tokens.adminOrderView).expect(403);
    await post(`/api/v1/admin/retail/returns/${filed.id}/approve`, tokens.adminReturnManage).expect(200);
    await post(`/api/v1/admin/retail/returns/${filed.id}/receive`, tokens.adminReturnManage).expect(200);
    const noDecision = await post(`/api/v1/admin/retail/returns/${filed.id}/inspect`, tokens.adminReturnManage, {}).expect(400);
    expect(noDecision.body.error).toBe("RETAIL_RETURN_INSPECTION_REQUIRED");
    await post(`/api/v1/admin/retail/returns/${filed.id}/inspect`, tokens.adminReturnManage, { inspectionDecision: "RESTOCKABLE" }).expect(200);
    const restocked = await post(`/api/v1/admin/retail/returns/${filed.id}/restock`, tokens.adminReturnManage).expect(200);
    expect(restocked.body.status).toBe("RESTOCKED");
    const double = await post(`/api/v1/admin/retail/returns/${filed.id}/restock`, tokens.adminReturnManage).expect(400);
    expect(double.body.error).toBe("RETAIL_RETURN_TRANSITION_INVALID");
    const detail = await get(`/api/v1/admin/retail/returns/${filed.id}`, tokens.adminFull).expect(200);
    expect(detail.body.status).toBe("RESTOCKED");
  });

  it("rejects returns only with a reason", async () => {
    await buyAndDeliver("custB", "p2", "p2v", "R2");
    const filed = await fileReturnFor(buyerB, "R2");
    const noReason = await post(`/api/v1/admin/retail/returns/${filed.id}/reject`, tokens.adminFull, {}).expect(400);
    expect(noReason.body.error).toBe("RETAIL_RETURN_REJECT_REASON_REQUIRED");
    const rejected = await post(`/api/v1/admin/retail/returns/${filed.id}/reject`, tokens.adminFull, { reason: "outside policy window" }).expect(200);
    expect(rejected.body.status).toBe("REJECTED");
  });

  it("isolates refund operators: view reads, manage acts, customers and finance hats stop at the gate", async () => {
    await checkoutAs("custA", "p1", "p1v", "F1");
    await payOrderGateway("F1", "custA");
    await retailOrders.cancelRetailOrder(ids.F1, admin());
    await post(`/api/v1/admin/retail/orders/${ids.F1}/refunds`, tokens.custA, { amount: totals.F1, idempotencyKey: makeId("k") }).expect(403);
    await post(`/api/v1/admin/retail/orders/${ids.F1}/refunds`, tokens.financeHat, { amount: totals.F1, idempotencyKey: makeId("k") }).expect(401);
    await post(`/api/v1/admin/retail/orders/${ids.F1}/refunds`, tokens.adminRefundView, { amount: totals.F1, idempotencyKey: makeId("k") }).expect(403);
    const filed = await post(`/api/v1/admin/retail/orders/${ids.F1}/refunds`, tokens.adminFull, { amount: totals.F1, idempotencyKey: makeId("k") }).expect(201);
    const refundId = filed.body.refund?.id ?? filed.body.id;
    expect(refundId).toBeTruthy();
    await post(`/api/v1/admin/retail/refunds/${refundId}/approve`, tokens.adminRefundView, { idempotencyKey: makeId("k") }).expect(403);
    await post(`/api/v1/admin/retail/refunds/${refundId}/approve`, tokens.adminFull, { idempotencyKey: makeId("k") }).expect(201);
    const completed = await post(`/api/v1/admin/retail/refunds/${refundId}/complete`, tokens.adminFull, { externalReference: "BANK-F1-OUT", idempotencyKey: makeId("k") }).expect(201);
    expect(completed.body.refund?.status ?? completed.body.status).toBe("completed");
  });

  it("serves the moderation queue: all statuses, filters, honest empties, keyset walks", async () => {
    const a1 = await ratings.fileReview(buyerA(), ids.p1, { rating: 5, review: "عالی" });
    const b1 = await ratings.fileReview(buyerB(), ids.p1, { rating: 2, review: "ضعیف" });
    const b2 = await ratings.fileReview(buyerB(), ids.p2, { rating: 4, review: "خوب" });
    await ratings.flagReview(buyerA(), b1.id as string);
    await post(`/api/v1/admin/retail/reviews/${b2.id}/hide`, tokens.adminFull).expect(200);

    const all = await get("/api/v1/admin/retail/reviews?limit=50", tokens.adminFull).expect(200);
    expect(all.body.reviews).toHaveLength(3);
    expect(all.body.hasMore).toBe(false);
    const flagged = await get("/api/v1/admin/retail/reviews?status=flagged", tokens.adminFull).expect(200);
    expect(flagged.body.reviews.map((r: any) => r.id)).toEqual([b1.id]);
    const hidden = await get("/api/v1/admin/retail/reviews?status=hidden", tokens.adminFull).expect(200);
    expect(hidden.body.reviews.map((r: any) => r.id)).toEqual([b2.id]);
    const visible = await get("/api/v1/admin/retail/reviews?status=visible", tokens.adminFull).expect(200);
    expect(visible.body.reviews.map((r: any) => r.id)).toEqual([a1.id]);
    const byProduct = await get(`/api/v1/admin/retail/reviews?productId=${ids.p2}`, tokens.adminFull).expect(200);
    expect(byProduct.body.reviews.map((r: any) => r.id)).toEqual([b2.id]);
    const bogus = await get("/api/v1/admin/retail/reviews?status=bogus", tokens.adminFull).expect(200);
    expect(bogus.body.reviews).toEqual([]);
    const ghost = await get("/api/v1/admin/retail/reviews?productId=ghost", tokens.adminFull).expect(200);
    expect(ghost.body.reviews).toEqual([]);

    // Keyset walk terminates with every row exactly once.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page = await get(`/api/v1/admin/retail/reviews?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, tokens.adminFull).expect(200);
      for (const row of page.body.reviews as Array<{ id: string }>) seen.push(row.id);
      cursor = page.body.nextCursor;
      expect(page.body.hasMore).toBe(cursor !== null);
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen.sort()).toEqual([a1.id, b1.id, b2.id].sort());

    const bad = await get("/api/v1/admin/retail/reviews?cursor=not-a-cursor", tokens.adminFull).expect(400);
    expect(bad.body.error).toBe("REVIEW_CURSOR_INVALID");
  });

  it("hide/show over admin HTTP is idempotent and audits only on change", async () => {
    await buyAndDeliver("custA", "p2", "p2v", "revSeedA2");
    const filed = await ratings.fileReview(buyerA(), ids.p2, { rating: 3, review: "متوسط" });
    const reviewId = filed.id as string;
    const auditCount = async () =>
      (await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, reviewId))).length;
    const before = await auditCount();
    const hidden = await post(`/api/v1/admin/retail/reviews/${reviewId}/hide`, tokens.adminFull).expect(200);
    expect(hidden.body.status).toBe("hidden");
    expect(await auditCount()).toBe(before + 1);
    await post(`/api/v1/admin/retail/reviews/${reviewId}/hide`, tokens.adminFull).expect(200);
    expect(await auditCount()).toBe(before + 1);
    const shown = await post(`/api/v1/admin/retail/reviews/${reviewId}/show`, tokens.adminFull).expect(200);
    expect(shown.body.status).toBe("visible");
    expect(await auditCount()).toBe(before + 2);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, reviewId));
    expect(rows.map((r: any) => r.action).sort()).toEqual(["product_review.hidden", "product_review.shown"]);
    expect(rows[0]).toMatchObject({ actorId: users.adminFull, actorRole: "admin", entityType: "product_rating" });
  });

  it("serves the redacted customer view with order/return/refund/support relations", async () => {
    const res = await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.adminFull).expect(200);
    expect(res.body.customer).toEqual({ id: users.custA, email: expect.any(String), displayName: null, phone: null, role: "customer", status: "active" });
    expect(res.body.orders.length).toBeGreaterThan(0);
    expect(res.body.returns.length).toBeGreaterThan(0);
    expect(res.body.refunds.length).toBeGreaterThan(0);
    expect(res.body.supportTotal).toBeGreaterThan(0);
    expect(res.body.supportCases[0]).toMatchObject({ status: expect.any(String) });
    // Redaction: the wire carries no credential or secret material.
    const wire = JSON.stringify(res.body);
    for (const token of ["passwordHash", "password_hash", "totpSecret", "totp_secret", "totpEnabled", "salt", "capability", "secret"]) {
      expect(wire).not.toContain(token);
    }
    expect(Object.keys(res.body.customer).sort()).toEqual(["displayName", "email", "id", "phone", "role", "status"]);
  });

  it("customer view 404s unknown customers and refuses under-powered callers", async () => {
    const missing = await get("/api/v1/admin/retail/customers/ghost", tokens.adminFull).expect(404);
    expect(missing.body.error).toBe("CUSTOMER_PROFILE_NOT_FOUND");
    await get(`/api/v1/admin/retail/customers/${users.custA}`).expect(401);
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.custA).expect(403);
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.adminOrderView).expect(403);
    // Even the subject themself is refused: this surface is admin-only.
    await get(`/api/v1/admin/retail/customers/${users.custA}`, tokens.custA).expect(403);
  });

  it("audits operator commands with actor and outcome", async () => {
    await buyAndDeliver("custB", "p1", "p1v", "R3");
    const filed = await fileReturnFor(buyerB, "R3");
    await post(`/api/v1/admin/retail/returns/${filed.id}/approve`, tokens.adminFull).expect(200);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, filed.id));
    const transition = rows.find((r: any) => r.action === "retail_return.status_changed");
    expect(transition).toMatchObject({ actorId: users.adminFull, actorRole: "admin", entityType: "retail_return_request" });
  });

  it("pins the admin retail controllers as pure shells with cataloged gates", () => {
    const files = [
      "apps/api/src/modules/orders/retail/admin-retail-ops.controller.ts",
      "apps/api/src/modules/ratings/admin-retail-reviews.controller.ts",
      "apps/api/src/modules/customer-account/admin-retail-customers.controller.ts",
    ];
    let gateCount = 0;
    for (const file of files) {
      const code = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const token of ["KOLBE_DB", ".execute(", ".insert(", ".update(", ".delete(", "sql`"]) {
        expect(code, `${file} must not contain ${token}`).not.toContain(token);
      }
      expect(code, `${file} must use the permission guard`).toContain("AdminPermissionGuard");
      gateCount += (code.match(/@RequireAdminPermission\("retail:[a-z_:]+"\)/g) ?? []).length;
    }
    // 23 ops routes + 3 review routes + 1 customer route, every one gated.
    expect(gateCount).toBe(27);
  });
});
