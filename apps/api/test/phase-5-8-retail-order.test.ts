import path from "node:path";
import { execFileSync } from "node:child_process";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client, Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../packages/database/src/schema/tables";
import { RETAIL_NEST_ERROR_MAP } from "../../frontend-next/server/retail-pricing";
import { PromotionService } from "../src/modules/promotions/promotion.service";
import { PromotionCouponService } from "../src/modules/promotions/promotion-coupon.service";
import { ComplianceService } from "../src/modules/compliance/compliance.service";
import { OffersService } from "../src/modules/offers/offers.service";
import { RetailOrdersService } from "../src/modules/orders/retail/retail-orders.service";

/**
 * Phase 5.8-A — canonical retail checkout over HTTP (Nest e2e).
 *
 * POST /api/v1/retail/orders creates the immutable commercial snapshot
 * (pricing -> promotions -> legal -> inventory -> order -> redemption ->
 * history -> audit) in one transaction; GET is customer-scoped. Real
 * PostgreSQL, full Nest application, real domain services.
 *
 * A24 coverage: 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
 * 28, 29, 30, 31, 32, 40.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_phase_5_8_retail_order_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;
const INTERNAL_TOKEN = "p58-order-test-token";

let app: INestApplication;
let pool: Pool;
let retailOrders: RetailOrdersService;

let seq = 0;
const makeId = (prefix: string) => `${prefix}_o58_${Date.now()}_${seq++}`;

const users = {} as Record<"custA" | "custB" | "vip" | "admin" | "supplier", string>;
const tokens = {} as Record<"custA" | "custB" | "vip" | "admin" | "supplier", string>;
const ids = {} as Record<string, string>;
let policyIds: string[] = [];

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

const postOrder = (body: unknown, init: { token?: string; key?: string; internalToken?: string | null } = {}) =>
  request(app.getHttpServer())
    .post("/api/v1/retail/orders")
    .set("authorization", init.token ? `Bearer ${init.token}` : "")
    .set("Idempotency-Key", init.key ?? makeId("key"))
    .set("x-kolbe-internal-token", init.internalToken === undefined ? "" : (init.internalToken as string))
    .send(body);

describe("Phase 5.8-A retail order checkout", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-p58-retail-order";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.KOLBE_INTERNAL_API_TOKEN = INTERNAL_TOKEN;

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_URL });
    const db = drizzle(pool, { schema: schema as any });
    retailOrders = app.get(RetailOrdersService);

    for (const [name, role] of [["custA", "customer"], ["custB", "customer"], ["vip", "vip"], ["admin", "admin"], ["supplier", "supplier"]] as const) {
      const userId = makeId(`user_${name}`);
      users[name] = userId;
      await db.insert(schema.accountUser).values({
        id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role, status: "active", tokenVersion: 0, failedLoginAttempts: 0,
      });
    }
    const { SessionVerifier } = await import("../src/common/session");
    const verifier = new SessionVerifier(process.env.KOLBE_SESSION_SECRET);
    for (const name of ["custA", "custB", "vip", "admin", "supplier"] as const) {
      tokens[name] = verifier.issue(users[name], name === "custA" || name === "custB" ? "customer" : name, 0);
    }

    const offers = app.get(OffersService);
    const kolbeSellerId = await offers.ensureSeller(null, "KOLBE");
    const supId = makeId("sup");
    await db.insert(schema.supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });

    const addProduct = async (slug: string, name: string) => {
      const productId = makeId("prod");
      await db.insert(schema.product).values({ id: productId, name, slug: `${slug}-${productId}`, ownerType: "KOLBE", status: "published" });
      return productId;
    };
    ids.p1 = await addProduct("p1", "Order Product One");
    ids.v1 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v1, productId: ids.p1, sku: `SKU-${ids.v1}`, status: "active", attributes: { size: "M", color: "Black" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v1, sku: `OFFER-${ids.v1}`, status: "published", retailPrice: 250000n as any });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v1, sellerId: kolbeSellerId, onHand: 100, reserved: 0, status: "active" });

    // No KOLBE stock row at all (availability fail-closed).
    ids.p2 = await addProduct("p2", "Order Product Two");
    ids.v2 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v2, productId: ids.p2, sku: `SKU-${ids.v2}`, status: "active", attributes: { size: "L" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p2, sellerId: kolbeSellerId, variantId: ids.v2, sku: `OFFER-${ids.v2}`, status: "published", retailPrice: 100000n as any });

    // Supplier stock only (must never satisfy retail).
    ids.v3 = makeId("var");
    await db.insert(schema.productVariant).values({ id: ids.v3, productId: ids.p1, sku: `SKU-${ids.v3}`, status: "active", attributes: { size: "XL" } as any });
    await db.insert(schema.sellerOffer).values({ id: makeId("offer"), productId: ids.p1, sellerId: kolbeSellerId, variantId: ids.v3, sku: `OFFER-${ids.v3}`, status: "published", retailPrice: 300000n as any });
    const supSeller = makeId("seller_sup");
    await db.insert(schema.seller).values({ id: supSeller, type: "SUPPLIER", supplierId: supId, displayName: "Sup Seller", status: "active" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv"), variantId: ids.v3, sellerId: supSeller, onHand: 500, reserved: 0, status: "active" });

    // Coupon-gated 10% retail promos (one reusable, one single-use).
    const auditStub = { record: async () => "p58-audit" };
    const factsStub = {
      getProductFacts: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
      assertRetailProduct: async (productId: string) => ({ productId, categoryId: "cat_a", status: "published", ownerType: "KOLBE" }),
      getOfferFacts: async () => null,
      listPricingTiers: async () => [],
      getPackageFacts: async () => null,
      resolveWholesaleLineBase: async () => { throw new Error("not used"); },
      getVipFacts: async () => null,
      vipPlanExists: async () => true,
      wholesaleAccountExists: async () => true,
      getSegmentFacts: async () => ({ contactId: null, stage: null, tagKeys: [] }),
      tagExists: async () => true,
    };
    const promotions = new PromotionService(db as any, factsStub as any, auditStub as any);
    const couponSvc = new PromotionCouponService(db as any, auditStub as any);
    for (const [code, couponCode, usageLimit] of [["P58ORD10", "WELCOME10", 1000], ["P58ORD1", "ONEUSE1", 1]] as const) {
      const promo = await promotions.createPromotion("p58_admin", { code, title: code, channel: "RETAIL" });
      const revision = await promotions.createRevision(promo.id, "p58_admin", {
        benefitType: "PERCENT_DISCOUNT", benefitScope: "ORDER", percentBps: 1000, stackingPolicy: "STACKABLE", couponRequired: true,
      });
      await promotions.publishRevision(revision.id, "p58_admin");
      await couponSvc.createCoupon(promo.id, "p58_admin", { code: couponCode, usageLimit });
      await promotions.submitForReview(promo.id, "p58_admin");
      await promotions.activate(promo.id, "p58_admin");
    }

    // RETAIL legal bundle for enforce-mode tests.
    const compliance = app.get(ComplianceService);
    const adminActor = { userId: users.admin, role: "admin" };
    for (const policyType of ["TERMS_OF_SERVICE", "PRIVACY_POLICY"]) {
      const draft = await compliance.createPolicyDraft(adminActor, { policyType, scope: "RETAIL", title: policyType, contentText: "legal text" });
      const published = await compliance.publishPolicy(adminActor, draft.id);
      policyIds.push(published.id);
    }
  }, 180_000);

  afterAll(async () => {
    delete process.env.KOLBE_RETAIL_LEGAL_GATE;
    await app?.close();
    await pool?.end();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("creates an order with the full canonical shape (201)", async () => {
    const response = await postOrder(orderBody(), { token: tokens.custA }).expect(201);
    const body = response.body;
    expect(body.orderCode).toMatch(/^RT-\d{4}-[A-Z0-9]{6}$/);
    expect(body.status).toBe("placed");
    expect(body.replayed).toBe(false);
    expect(body.currency).toBe("IRR");
    // 2 x 250000, no coupon, below the free-shipping threshold.
    expect(body.totals).toEqual({ itemsTotal: "500000", promotionDiscountTotal: "0", shippingTotal: "89000", grandTotal: "589000" });
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ productId: ids.p1, variantId: ids.v1, quantity: 2, unitPrice: "250000", baseLineTotal: "500000", promotionDiscount: "0", lineTotal: "500000" });
    expect(body.payment).toEqual({ method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true });
    expect(body.legal).toEqual({ mode: "off", snapshotId: null });
    expect(body.priceVersion).toMatch(/^rpv1\.[0-9a-f]{16}$/);
    expect(body.promotionTermsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ fromStatus: null, toStatus: "placed", actorRole: "customer", reason: "checkout", orderVersion: 0 });
    expect(typeof body.createdAt).toBe("string");
    ids.order1 = body.id;
    ids.order1Code = body.orderCode;
  });

  it("persists the immutable snapshot + history + fact + audit rows", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const [order] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, ids.order1));
    expect(order.customerId).toBe(users.custA);
    expect(BigInt(order.totalAmount)).toBe(BigInt(order.itemsTotal) - BigInt(order.promotionDiscountTotal) + BigInt(order.shippingPrice));
    expect(order.version).toBe(0);
    expect(order.creationRequestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.amountSource).toBe("server");
    // Frozen legacy mirrors.
    expect(order.paymentMethod).toBe(order.payMethod);
    expect(order.payMethod).toBe("gateway");
    expect(order.paymentStatus).toBe("unpaid");
    expect(order.fulfillmentStatus).toBe("processing");
    expect(Array.isArray(order.lines)).toBe(true);
    const items = await db.select().from(schema.retailOrderItem).where(eq(schema.retailOrderItem.orderId, ids.order1));
    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(ids.v1);
    expect(items[0].productId).toBe(ids.p1);
    expect(items[0].productName).toBe("Order Product One");
    expect(String(items[0].unitPrice)).toBe("250000");
    expect(BigInt(items[0].baseLineTotal)).toBe(BigInt(items[0].unitPrice) * BigInt(items[0].quantity));
    expect(BigInt(items[0].lineTotal)).toBe(BigInt(items[0].baseLineTotal) - BigInt(items[0].promotionDiscount));
    const events = await db.select().from(schema.retailOrderEvent).where(eq(schema.retailOrderEvent.orderId, ids.order1));
    expect(events).toHaveLength(1);
    expect(events[0].fromStatus).toBeNull();
    expect(events[0].toStatus).toBe("placed");
    const facts = await db.select().from(schema.orderEvent).where(eq(schema.orderEvent.aggregateId, ids.order1));
    expect(facts).toHaveLength(1);
    expect(facts[0].aggregateType).toBe("retail_order");
    expect(facts[0].eventType).toBe("retail_order.created");
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, ids.order1));
    expect(audits.some((row: any) => row.action === "retail_order.created")).toBe(true);
  });

  it("replays the same key + same payload without duplicating anything (200)", async () => {
    const key = makeId("replay");
    const body = orderBody();
    const first = await postOrder(body, { token: tokens.custA, key }).expect(201);
    const second = await postOrder(JSON.parse(JSON.stringify(body)), { token: tokens.custA, key }).expect(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.orderCode).toBe(first.body.orderCode);
    const db = drizzle(pool, { schema: schema as any });
    const orders = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.idempotencyKey, key));
    expect(orders).toHaveLength(1);
    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.allocationId, first.body.id));
    expect(reservations).toHaveLength(1);
  });

  it("rejects the same key + different payload with an idempotency conflict (409)", async () => {
    const key = makeId("conflict");
    await postOrder(orderBody(), { token: tokens.custA, key }).expect(201);
    const response = await postOrder(orderBody({ lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1 }] }), { token: tokens.custA, key }).expect(409);
    expect(response.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
  });

  it("rejects the same key from another customer (409)", async () => {
    const key = makeId("owner");
    await postOrder(orderBody(), { token: tokens.custA, key }).expect(201);
    const response = await postOrder(orderBody(), { token: tokens.custB, key }).expect(409);
    expect(response.body.error).toBe("RETAIL_IDEMPOTENCY_CONFLICT");
  });

  it("serves guests only via the internal-token proxy path (NULL customer, contact preserved)", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const guest = await postOrder(orderBody(), { internalToken: INTERNAL_TOKEN }).expect(201);
    expect(guest.body.customer).toMatchObject({ name: "سارا آزمون", phone: "09121234567" });
    const [stored] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, guest.body.id));
    expect(stored.customerId).toBeNull();
    ids.guestOrder = guest.body.id;
    await postOrder(orderBody(), { internalToken: "wrong-token" }).expect(401);
    await postOrder(orderBody(), { internalToken: null }).expect(401);
  });

  it("applies a coupon order: discounted totals + recorded redemption + attribution", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const before = await db.select().from(schema.promotionCouponRedemption);
    const response = await postOrder(orderBody({ couponCodes: ["WELCOME10"] }), { token: tokens.custA }).expect(201);
    // 10% of 500000 = 50000; shipping pishtaz 89000 (below threshold).
    expect(response.body.totals).toEqual({ itemsTotal: "500000", promotionDiscountTotal: "50000", shippingTotal: "89000", grandTotal: "539000" });
    // ORDER-scope discounts live at order level (5.7 lineDiscounts semantics);
    // the item equation still holds: lineTotal = base - lineDiscount.
    expect(response.body.lines[0].promotionDiscount).toBe("0");
    expect(response.body.lines[0].lineTotal).toBe("500000");
    const after = await db.select().from(schema.promotionCouponRedemption);
    expect(after.length).toBe(before.length + 1);
    const mine = after.find((row: any) => row.orderReference === response.body.orderCode);
    expect(mine).toBeDefined();
    expect(BigInt(mine.discountAmount)).toBe(50000n);
    expect(BigInt(mine.baseAmount)).toBe(500000n);
    expect(mine.evaluationVersion).toBe("promo-eval-v1");
    expect(mine.termsHash).toBe(response.body.promotionTermsHash);
  });

  it("failed orders consume no coupon and leave no partial rows", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const [couponBefore] = await db.select().from(schema.promotionCoupon).where(eq(schema.promotionCoupon.codeNormalized, "WELCOME10"));
    const ordersBefore = await db.select().from(schema.retailOrder);
    const response = await postOrder(
      orderBody({ lines: [{ productId: ids.p2, variantId: ids.v2, quantity: 1 }], couponCodes: ["WELCOME10"] }),
      { token: tokens.custA },
    ).expect(409);
    expect(response.body.error).toBe("RETAIL_INSUFFICIENT_STOCK");
    const [couponAfter] = await db.select().from(schema.promotionCoupon).where(eq(schema.promotionCoupon.codeNormalized, "WELCOME10"));
    expect(couponAfter.usedCount).toBe(couponBefore.usedCount);
    expect(await db.select().from(schema.retailOrder)).toHaveLength(ordersBefore.length);
  });

  it("an exhausted coupon fails the order closed: no phantom discount, no partial order", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const first = await postOrder(orderBody({ couponCodes: ["ONEUSE1"] }), { token: tokens.custA }).expect(201);
    expect(first.body.totals.promotionDiscountTotal).toBe("50000");
    const ordersBefore = await db.select().from(schema.retailOrder);
    // The engine still evaluates the discount, but redemption re-checks the
    // cap under lock and the whole checkout rolls back (A7 invariant).
    const second = await postOrder(orderBody({ couponCodes: ["ONEUSE1"] }), { token: tokens.custB }).expect(409);
    expect(second.body.error).toBe("PROMOTION_COUPON_EXHAUSTED");
    expect(await db.select().from(schema.retailOrder)).toHaveLength(ordersBefore.length);
    const redemptions = await db.select().from(schema.promotionCouponRedemption);
    expect(redemptions.filter((row: any) => row.orderReference === first.body.orderCode)).toHaveLength(1);
  });

  it("fails closed when KOLBE has no stock record (409, nothing persisted)", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const ordersBefore = await db.select().from(schema.retailOrder);
    const response = await postOrder(orderBody({ lines: [{ productId: ids.p2, variantId: ids.v2, quantity: 1 }] }), { token: tokens.custA }).expect(409);
    expect(response.body.error).toBe("RETAIL_INSUFFICIENT_STOCK");
    expect(await db.select().from(schema.retailOrder)).toHaveLength(ordersBefore.length);
  });

  it("never satisfies retail from supplier stock (409 despite 500 supplier units)", async () => {
    const response = await postOrder(orderBody({ lines: [{ productId: ids.p1, variantId: ids.v3, quantity: 1 }] }), { token: tokens.custA }).expect(409);
    expect(response.body.error).toBe("RETAIL_INSUFFICIENT_STOCK");
  });

  it("reserves KOLBE inventory with the order allocation link", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.allocationId, ids.order1));
    expect(reservations).toHaveLength(1);
    expect(reservations[0].quantity).toBe(2);
    expect(reservations[0].variantId).toBe(ids.v1);
    expect(reservations[0].status).toBe("active");
    const [inventory] = await db.select().from(schema.productVariantInventory).where(eq(schema.productVariantInventory.variantId, ids.v1));
    expect(inventory.reserved).toBeGreaterThanOrEqual(2);
  });

  it("legal enforce mode fails closed without ids and binds with valid ids", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    try {
      const db = drizzle(pool, { schema: schema as any });
      const ordersBefore = await db.select().from(schema.retailOrder);
      const rejected = await postOrder(orderBody(), { token: tokens.custA }).expect(409);
      expect(rejected.body.error).toBe("LEGAL_POLICY_ACCEPTANCE_REQUIRED");
      expect(await db.select().from(schema.retailOrder)).toHaveLength(ordersBefore.length);
      const bound = await postOrder(orderBody({ acceptedPolicyDocumentIds: policyIds }), { token: tokens.custA }).expect(201);
      expect(bound.body.legal.mode).toBe("enforce");
      expect(typeof bound.body.legal.snapshotId).toBe("string");
      const [stored] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, bound.body.id));
      expect(stored.legalSnapshotId).toBe(bound.body.legal.snapshotId);
      // Audit records the gate outcome (re-homed 4.7.5 pin).
      const [created] = await db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, "retail_order.created"), eq(schema.auditLog.entityId, bound.body.id)));
      expect((created.after as any).legal_gate).toBe("enforce");
      expect((created.after as any).legal_snapshot_id).toBe(bound.body.legal.snapshotId);
      // Snapshot + per-document acceptances are bound to the order code.
      const [snap] = await db
        .select()
        .from(schema.transactionComplianceSnapshot)
        .where(eq(schema.transactionComplianceSnapshot.retailOrderRef, bound.body.orderCode));
      expect(snap.id).toBe(bound.body.legal.snapshotId);
      expect(snap.userId).toBe(users.custA);
      const acceptances = await db
        .select()
        .from(schema.legalPolicyAcceptance)
        .where(eq(schema.legalPolicyAcceptance.orderRef, bound.body.orderCode));
      expect(acceptances).toHaveLength(policyIds.length);
    } finally {
      delete process.env.KOLBE_RETAIL_LEGAL_GATE;
    }
  });

  it("binds the server-priced facts: tampered browser money never reaches the legal snapshot", async () => {
    process.env.KOLBE_RETAIL_LEGAL_GATE = "enforce";
    const compliance = app.get(ComplianceService);
    const seen: any[] = [];
    const original = compliance.bindRetailCheckout.bind(compliance);
    const spy = vi.spyOn(compliance, "bindRetailCheckout").mockImplementation(async (input: any, executor?: any) => {
      seen.push(input);
      return original(input, executor);
    });
    try {
      const res = await postOrder(
        orderBody({
          acceptedPolicyDocumentIds: policyIds,
          lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 2, presentedUnitPrice: 1, presentedName: "جعلی" }],
        }),
        { token: tokens.custA },
      ).expect(201);
      expect(res.body.totals.itemsTotal).toBe("500000");
      expect(seen).toHaveLength(1);
      const facts = seen[0].facts;
      expect(facts.orderRef).toBe(res.body.orderCode);
      expect(facts.lines).toHaveLength(1);
      expect(facts.lines[0].unitPrice).toBe("250000");
      expect(facts.lines[0].lineTotal).toBe("500000");
      expect(facts.totals).toMatchObject({ items: "500000", grand: res.body.totals.grandTotal });
      expect(seen[0].subject).toMatchObject({ userId: users.custA });
      expect(seen[0].acceptedPolicyDocumentIds).toEqual(policyIds);
    } finally {
      spy.mockRestore();
      delete process.env.KOLBE_RETAIL_LEGAL_GATE;
    }
  });

  it("off (default): checkout succeeds with no binding and no legal rows", async () => {
    delete process.env.KOLBE_RETAIL_LEGAL_GATE;
    const res = await postOrder(orderBody(), { token: tokens.custA }).expect(201);
    expect(res.body.legal).toEqual({ mode: "off", snapshotId: null });
    const db = drizzle(pool, { schema: schema as any });
    const [stored] = await db.select().from(schema.retailOrder).where(eq(schema.retailOrder.id, res.body.id));
    expect(stored.legalSnapshotId).toBeNull();
    expect(
      await db.select().from(schema.transactionComplianceSnapshot).where(eq(schema.transactionComplianceSnapshot.retailOrderRef, res.body.orderCode)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.legalPolicyAcceptance).where(eq(schema.legalPolicyAcceptance.orderRef, res.body.orderCode)),
    ).toHaveLength(0);
  });

  it("scopes GET by ownership: owner and admin read, others are forbidden", async () => {
    await request(app.getHttpServer()).get(`/api/v1/retail/orders/${ids.order1}`).set("authorization", `Bearer ${tokens.custA}`).expect(200);
    const forbidden = await request(app.getHttpServer()).get(`/api/v1/retail/orders/${ids.order1}`).set("authorization", `Bearer ${tokens.custB}`).expect(403);
    expect(forbidden.body.error).toBe("RETAIL_ORDER_FORBIDDEN");
    await request(app.getHttpServer()).get(`/api/v1/retail/orders/${ids.order1}`).set("authorization", `Bearer ${tokens.admin}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/retail/orders/${ids.guestOrder}`).set("authorization", `Bearer ${tokens.custA}`).expect(403);
    await request(app.getHttpServer()).get(`/api/v1/retail/orders/${ids.guestOrder}`).set("authorization", `Bearer ${tokens.admin}`).expect(200);
    const missing = await request(app.getHttpServer()).get("/api/v1/retail/orders/rord_missing").set("authorization", `Bearer ${tokens.custA}`).expect(404);
    expect(missing.body.error).toBe("RETAIL_ORDER_NOT_FOUND");
  });

  it("transitions forward-only with versioned history (service-level, Checkpoint D owns the HTTP surface)", async () => {
    const confirmed = await retailOrders.transitionOrder(ids.order1, "confirmed", { actorId: users.admin, actorRole: "admin", reason: "review" });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.history).toHaveLength(2);
    await expect(retailOrders.transitionOrder(ids.order1, "shipped", { actorId: users.admin, actorRole: "admin" })).rejects.toMatchObject({
      code: "RETAIL_TRANSITION_INVALID",
    });
    await expect(retailOrders.transitionOrder(ids.order1, "teleported", { actorId: users.admin, actorRole: "admin" })).rejects.toMatchObject({
      code: "RETAIL_TRANSITION_INVALID",
    });
    for (const next of ["packed", "shipped", "delivered"]) {
      await retailOrders.transitionOrder(ids.order1, next, { actorId: users.admin, actorRole: "admin" });
    }
    const delivered = await retailOrders.getRetailOrder({ userId: users.custA, role: "customer" }, ids.order1);
    expect(delivered.status).toBe("delivered");
    expect(delivered.history.map((row) => row.toStatus)).toEqual(["placed", "confirmed", "packed", "shipped", "delivered"]);
    expect(delivered.history.map((row) => row.orderVersion)).toEqual([0, 1, 2, 3, 4]);
    // Order state never implies payment state.
    expect(delivered.payment).toMatchObject({ status: "unpaid", collected: false });
  });

  it("keeps payment honest: COD is pending (never collected), providers stay unpaid", async () => {
    const cod = await postOrder(orderBody({ payMethod: "cod" }), { token: tokens.custA }).expect(201);
    expect(cod.body.payment).toEqual({ method: "cod", status: "pending_cod", collected: false, requiresManualSettlement: false });
    expect(cod.body.totals.shippingTotal).toBe("0");
    const gateway = await postOrder(orderBody({ payMethod: "gateway" }), { token: tokens.custA }).expect(201);
    expect(gateway.body.payment).toEqual({ method: "gateway", status: "unpaid", collected: false, requiresManualSettlement: true });
    const db = drizzle(pool, { schema: schema as any });
    expect(await db.select().from(schema.payment)).toHaveLength(0);
    expect(await db.select().from(schema.shipment)).toHaveLength(0);
  });

  it("ignores browser money and resolves everything from the server", async () => {
    const response = await postOrder(
      orderBody({
        lines: [{ productId: ids.p1, variantId: ids.v1, quantity: 1, presentedUnitPrice: 1, presentedName: "جعلی" }],
        totals: { items: 1, shipping: 1, total: 2 },
      }),
      { token: tokens.custA },
    ).expect(201);
    expect(response.body.lines[0].unitPrice).toBe("250000");
    expect(response.body.lines[0].productName).toBe("Order Product One");
    expect(response.body.totals.itemsTotal).toBe("250000");
  });

  it("validates contact, address, pay method, key and identifiers with stable codes", async () => {
    const badPhone = await postOrder(orderBody({ customer: { name: "x", phone: "12345" } }), { token: tokens.custA }).expect(400);
    expect(badPhone.body.error).toBe("RETAIL_CUSTOMER_PHONE_INVALID");
    const badAddress = await postOrder(orderBody({ address: { province: "تهران" } }), { token: tokens.custA }).expect(400);
    expect(badAddress.body.error).toBe("RETAIL_ADDRESS_INCOMPLETE");
    const badPay = await postOrder(orderBody({ payMethod: "barter" }), { token: tokens.custA }).expect(400);
    expect(badPay.body.error).toBe("RETAIL_PAYMENT_METHOD_INVALID");
    const noKey = await request(app.getHttpServer()).post("/api/v1/retail/orders").set("authorization", `Bearer ${tokens.custA}`).send(orderBody()).expect(400);
    expect(noKey.body.error).toBe("RETAIL_IDEMPOTENCY_KEY_REQUIRED");
    const badProduct = await postOrder(orderBody({ lines: [{ productId: "prod_missing", quantity: 1 }] }), { token: tokens.custA }).expect(404);
    expect(badProduct.body.error).toBe("RETAIL_PRODUCT_NOT_FOUND");
  });

  it("pins the compat error map: every mapped key is a real Nest retail code", async () => {
    const emitted = new Set([
      "RETAIL_CUSTOMER_NAME_REQUIRED", "RETAIL_CUSTOMER_PHONE_INVALID", "RETAIL_CUSTOMER_EMAIL_INVALID",
      "RETAIL_ADDRESS_INCOMPLETE", "RETAIL_LINES_REQUIRED", "RETAIL_TOO_MANY_LINES", "RETAIL_LINE_PRODUCT_REQUIRED",
      "RETAIL_QUANTITY_INVALID", "RETAIL_PRODUCT_NOT_FOUND", "RETAIL_PRODUCT_NOT_KOLBE", "RETAIL_PRODUCT_NOT_PUBLISHED",
      "RETAIL_VARIANT_NOT_FOUND", "RETAIL_VARIANT_MISMATCH", "RETAIL_VARIANT_INACTIVE", "RETAIL_VARIANT_UNRESOLVED",
      "RETAIL_VARIANT_AMBIGUOUS", "RETAIL_OFFER_MISSING", "RETAIL_OFFER_AMBIGUOUS", "RETAIL_MONETARY_OVERFLOW",
      "RETAIL_SHIPPING_METHOD_INVALID", "RETAIL_PAYMENT_METHOD_INVALID", "RETAIL_COUPON_CODE_INVALID", "RETAIL_POLICY_ID_INVALID",
      "RETAIL_IDEMPOTENCY_KEY_REQUIRED", "RETAIL_IDEMPOTENCY_KEY_INVALID", "RETAIL_IDEMPOTENCY_CONFLICT",
      "RETAIL_ORDER_CODE_COLLISION", "RETAIL_PROMOTION_BASE_MISMATCH", "RETAIL_TOTALS_MISMATCH", "RETAIL_INSUFFICIENT_STOCK",
      "RETAIL_ORDER_NOT_FOUND", "RETAIL_ORDER_FORBIDDEN", "RETAIL_TRANSITION_INVALID", "RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED",
    ]);
    const passThrough = new Set([
      "RETAIL_MONETARY_OVERFLOW", "RETAIL_COUPON_CODE_INVALID", "RETAIL_POLICY_ID_INVALID", "RETAIL_IDEMPOTENCY_CONFLICT",
      "RETAIL_ORDER_CODE_COLLISION", "RETAIL_PROMOTION_BASE_MISMATCH", "RETAIL_TOTALS_MISMATCH", "RETAIL_INSUFFICIENT_STOCK",
      "RETAIL_ORDER_NOT_FOUND", "RETAIL_ORDER_FORBIDDEN", "RETAIL_TRANSITION_INVALID", "RETAIL_INTERNAL_TOKEN_NOT_CONFIGURED",
    ]);
    for (const key of Object.keys(RETAIL_NEST_ERROR_MAP)) {
      expect(emitted.has(key), `map key ${key} is not an emitted code`).toBe(true);
      expect(RETAIL_NEST_ERROR_MAP[key].status).toBe(422);
    }
    for (const code of emitted) {
      const covered = code in RETAIL_NEST_ERROR_MAP || passThrough.has(code);
      expect(covered, `emitted code ${code} is neither mapped nor an intentional pass-through`).toBe(true);
    }
  });

  it("retail checkout never writes wholesale, settlement, payment or shipment aggregates", async () => {
    const db = drizzle(pool, { schema: schema as any });
    expect(await db.select().from(schema.wholesaleOrder)).toHaveLength(0);
    expect(await db.select().from(schema.payment)).toHaveLength(0);
    expect(await db.select().from(schema.shipment)).toHaveLength(0);
    expect(await db.select().from(schema.settlementHold)).toHaveLength(0);
  });
});
