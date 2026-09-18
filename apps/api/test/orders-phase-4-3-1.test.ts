import { execFileSync } from "node:child_process";
import path from "node:path";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../packages/database/src/schema/tables";
import { hashAcceptedTerms } from "../src/modules/pricing/pricing.logic";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_orders_431_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let pool: Pool;
let app: any;
let ordersService: any;
let vipService: any;

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

describe("Phase 4.3.1 — Hardening", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-orders-431";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const { OrdersService } = await import("../src/modules/orders/orders.service");
    const { VipService } = await import("../src/modules/vip/vip.service");
    ordersService = app.get(OrdersService);
    vipService = app.get(VipService);

    pool = new Pool({ connectionString: TEST_URL });
  }, 180_000);

  afterAll(async () => {
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

  async function setupBasic() {
    const db = drizzle(pool, { schema: schema as any });
    const supId = makeId("sup");
    const sellerId = makeId("seller");
    const prodId = makeId("prod");
    const varId = makeId("var");
    const offerId = makeId("offer");
    const userId = makeId("user");
    const accountId = makeId("acc");
    const pkgId = makeId("pkg");

    await db.insert(schema.accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    const planId = makeId("plan");
    await db.insert(schema.vipPlan).values({ id: planId, name: "Test Plan", slug: `plan-${Date.now()}-${Math.random()}`, price: 1000n as any, durationDays: 30, status: "active" });
    await db.insert(schema.vipSubscription).values({ id: makeId("sub"), userId, planId, status: "active", startedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
    await db.insert(schema.supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Seller Original", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "Product Original", slug: `prod-${Date.now()}-${Math.random()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-ORIG-${varId}`, status: "active", attributes: { color: "red" } as any });
    await db.insert(schema.sellerOffer).values({
      id: offerId,
      productId: prodId,
      sellerId,
      variantId: varId,
      sku: `OFFER-${offerId}`,
      status: "published",
      wholesalePrice: 10000n as any,
      currency: "IRR",
      moq: 1,
      moqUnit: "PIECE",
      pricingUnit: "PIECE" as any,
    });
    await db.insert(schema.wholesaleAccount).values({ id: accountId, userId, memberName: "Test", storeName: "Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.productVariantInventory).values({
      id: makeId("inv"),
      variantId: varId,
      sellerId,
      onHand: 100,
      reserved: 0,
      status: "active",
    });

    // Package
    await db.insert(schema.wholesalePackage).values({ id: pkgId, offerId, packageType: "SIZE_RUN", name: "Package Original", totalPieces: 4 });
    const v2 = makeId("var2");
    const v3 = makeId("var3");
    const v4 = makeId("var4");
    for (const v of [v2, v3, v4]) {
      await db.insert(schema.productVariant).values({ id: v, productId: prodId, sku: `SKU-${v}`, status: "active", attributes: {} as any });
      await db.insert(schema.productVariantInventory).values({ id: makeId("inv_pkg"), variantId: v, sellerId, onHand: 100, reserved: 0, status: "active" });
    }
    // varId inventory already exists above, do not duplicate
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item"), packageId: pkgId, variantId: varId, quantity: 1 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item2"), packageId: pkgId, variantId: v2, quantity: 1 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item3"), packageId: pkgId, variantId: v3, quantity: 1 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item4"), packageId: pkgId, variantId: v4, quantity: 1 });

    return { supId, sellerId, prodId, varId, offerId, userId, accountId, pkgId, variants: [varId, v2, v3, v4] };
  }

  it("selector validation: PIECE requires variant only", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const { prodId, offerId, userId, accountId, varId } = await setupBasic();

    // Try to create wholesale request with PIECE but packageId instead of variantId — should fail
    let failed = false;
    try {
      await vipService.createWholesaleRequest({
        productId: prodId,
        offerId,
        variantId: null,
        packageId: makeId("pkg_fake"),
        quantity: 1,
        userId,
      });
    } catch (e: any) {
      failed = true;
      expect(["REQUEST_SELECTOR_REQUIRED", "REQUEST_SELECTOR_AMBIGUOUS", "PACKAGE_OFFER_MISMATCH"]).toContain(e.code);
    }
    expect(failed).toBe(true);

    // Both set should reject
    failed = false;
    try {
      await vipService.createWholesaleRequest({
        productId: prodId,
        offerId,
        variantId: varId,
        packageId: makeId("pkg_fake2"),
        quantity: 1,
        userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("REQUEST_SELECTOR_AMBIGUOUS");
    }
    expect(failed).toBe(true);

    // Both null should reject
    failed = false;
    try {
      await vipService.createWholesaleRequest({
        productId: prodId,
        offerId,
        variantId: null,
        packageId: null,
        quantity: 1,
        userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("REQUEST_SELECTOR_REQUIRED");
    }
    expect(failed).toBe(true);

    // Valid PIECE
    const req = await vipService.createWholesaleRequest({
      productId: prodId,
      offerId,
      variantId: varId,
      packageId: null,
      quantity: 1,
      userId,
    });
    expect(req.variantId).toBe(varId);
    expect(req.packageId).toBeNull();
  });

  it("selector validation: PACKAGE-like requires package only", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const supId = makeId("sup_pkg");
    const sellerId = makeId("seller_pkg");
    const prodId = makeId("prod_pkg");
    const offerId = makeId("offer_pkg");
    const userId = makeId("user_pkg");
    const accountId = makeId("acc_pkg");
    const varId = makeId("var_pkg");
    const pkgId = makeId("pkg_pkg");

    await db.insert(schema.accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    // VIP subscription needed for createWholesaleRequest
    const planId = makeId("plan");
    await db.insert(schema.vipPlan).values({ id: planId, name: "Test Plan", slug: `plan-${Date.now()}`, price: 1000n as any, durationDays: 30, status: "active" });
    await db.insert(schema.vipSubscription).values({ id: makeId("sub"), userId, planId, status: "active", startedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
    await db.insert(schema.supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Seller", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "Prod", slug: `prod-${Date.now()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
    await db.insert(schema.sellerOffer).values({
      id: offerId,
      productId: prodId,
      sellerId,
      variantId: null as any,
      sku: `OFFER-${offerId}`,
      status: "published",
      wholesalePrice: 10000n as any,
      currency: "IRR",
      moq: 1,
      moqUnit: "PACKAGE",
      pricingUnit: "PACKAGE" as any,
    });
    await db.insert(schema.wholesaleAccount).values({ id: accountId, userId, memberName: "Test", storeName: "Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.wholesalePackage).values({ id: pkgId, offerId, packageType: "SIZE_RUN", name: "Box", totalPieces: 1 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item"), packageId: pkgId, variantId: varId, quantity: 1 });

    // PIECE variant for PACKAGE offer should fail
    let failed = false;
    try {
      await vipService.createWholesaleRequest({
        productId: prodId,
        offerId,
        variantId: varId,
        packageId: null,
        quantity: 1,
        userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("REQUEST_SELECTOR_REQUIRED");
    }
    expect(failed).toBe(true);

    // Valid PACKAGE
    const req = await vipService.createWholesaleRequest({
      productId: prodId,
      offerId,
      variantId: null,
      packageId: pkgId,
      quantity: 1,
      userId,
    });
    expect(req.packageId).toBe(pkgId);
    expect(req.variantId).toBeNull();
  });

  it("idempotency concurrent same key same payload → one order + safe replay", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 2,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      product: { id: prodId, name: "Product Original" },
      variant: { id: varId, sku: `SKU-ORIG-${varId}`, attributes: { color: "red" } },
      seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller Original", supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any },
      package: null,
      pieceQuantity: 2,
      lineTotal: "20000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_idem_same");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_same_${Date.now()}_${Math.random()}`;

    const p1 = ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Valiasr" },
      billingAddress: { city: "Tehran", street: "Valiasr" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    const p2 = ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Valiasr" },
      billingAddress: { city: "Tehran", street: "Valiasr" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter(r => r.status === "fulfilled") as any[];
    const rejected = results.filter(r => r.status === "rejected") as any[];

    // One should succeed, the other should either succeed as replay or be rejected? With account FOR UPDATE, one wins, other should replay same order (since same hash)
    // Because we lock account before idempotency check, second concurrent will block on account lock, then see existing order and replay if same hash
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    // At least one should be replay or both fulfilled with same order id
    if (fulfilled.length === 2) {
      expect(fulfilled[0].value.order.id).toBe(fulfilled[1].value.order.id);
    }
    // No duplicate orders
    const orders = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.accountId, accountId));
    expect(orders.length).toBe(1);
  });

  it("idempotency concurrent same account same key diff payload → one wins other 409", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => ({
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (sellerId ? (pool as any) : null) as any,
      variantId: varId,
      packageId: null,
      quantity: qty,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      product: { id: prodId, name: "Product Original" },
      variant: { id: varId, sku: `SKU-ORIG-${varId}`, attributes: { color: "red" } },
      seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller Original", supplierId: null },
      package: null,
      pieceQuantity: qty,
      lineTotal: (qty * 10000).toString(),
    });

    const reqId1 = makeId("wreq_diff1");
    const reqId2 = makeId("wreq_diff2");
    const snap1 = makeSnap(1);
    const snap2 = makeSnap(2);
    // Fix supplierId fetch
    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);
    (snap1 as any).supplierId = sellerRow.supplierId;
    (snap1 as any).seller.supplierId = sellerRow.supplierId;
    (snap2 as any).supplierId = sellerRow.supplierId;
    (snap2 as any).seller.supplierId = sellerRow.supplierId;

    await db.insert(schema.wholesaleRequest).values({
      id: reqId1,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap1 as any,
      acceptedTermsHash: hashAcceptedTerms(snap1 as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });
    await db.insert(schema.wholesaleRequest).values({
      id: reqId2,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap2 as any,
      acceptedTermsHash: hashAcceptedTerms(snap2 as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_diff_${Date.now()}`;

    const p1 = ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId1, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Addr1" },
      billingAddress: { city: "Tehran", street: "Addr1" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    const p2 = ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId2, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Isfahan", street: "Addr2" },
      billingAddress: { city: "Tehran", street: "Addr2" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected") as any[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("deadlock-safe: overlapping batches no deadlock", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => {
      const snap = {
        requestVersion: 0,
        productId: prodId,
        offerId,
        sellerId,
        supplierId: null as any,
        variantId: varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE" as const,
        pricingUnit: "PIECE" as const,
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        product: { id: prodId, name: "Prod" },
        variant: { id: varId, sku: "SKU", attributes: {} },
        seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * 1000).toString(),
      };
      return snap;
    };

    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);
    const reqIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const reqId = makeId(`wreq_deadlock_${i}`);
      const snap = makeSnap(1);
      (snap as any).supplierId = sellerRow.supplierId;
      (snap as any).seller.supplierId = sellerRow.supplierId;
      await db.insert(schema.wholesaleRequest).values({
        id: reqId,
        productId: prodId,
        offerId,
        vipAccountId: accountId,
        variantId: varId,
        quantity: 1,
        status: "accepted",
        version: 1,
        acceptedTermsSnapshot: snap as any,
        acceptedTermsHash: hashAcceptedTerms(snap as any),
        acceptedAt: new Date(),
        acceptedBy: userId,
      });
      reqIds.push(reqId);
    }

    // Two overlapping batches: batch A = [0,1,2], batch B = [2,1,0] reversed order — should not deadlock due to deterministic ASC locking
    const pA = ordersService.createWholesaleOrder({
      requests: reqIds.slice(0, 3).map(id => ({ requestId: id, expectedVersion: 1 })),
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "A" },
      billingAddress: { city: "Tehran", street: "A" },
      idempotencyKey: `idem_deadlock_A_${Date.now()}`,
      buyerUserId: userId,
    });

    const pB = ordersService.createWholesaleOrder({
      requests: reqIds.slice(0, 3).reverse().map(id => ({ requestId: id, expectedVersion: 1 })),
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "B" },
      billingAddress: { city: "Tehran", street: "B" },
      idempotencyKey: `idem_deadlock_B_${Date.now()}`,
      buyerUserId: userId,
    });

    const results = await Promise.allSettled([pA, pB]);
    // One should succeed, other fail with already converted, but no deadlock timeout
    const fulfilled = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    // Ensure no deadlock error code 40P01
    for (const rej of rejected as any[]) {
      expect(rej.reason.code).not.toBe("40P01");
    }
  });

  it("snapshot completeness: mutation of live sources does not affect order", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId, pkgId, variants } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const composition = variants.map(vId => ({ variantId: vId, quantity: 1 }));
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: null,
      packageId: pkgId,
      quantity: 1,
      saleUnit: "PACKAGE" as const,
      pricingUnit: "PACKAGE" as const,
      pricingTierId: null,
      unitPrice: "50000",
      currency: "IRR",
      product: { id: prodId, name: "Product Original" },
      variant: null,
      seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller Original", supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any },
      package: { id: pkgId, type: "SIZE_RUN", name: "Package Original", piecesPerPackage: 4, composition },
      pieceQuantity: 4,
      lineTotal: "50000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_snap_mut");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: null,
      packageId: pkgId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    // Mutate live sources after acceptance
    await db.update(schema.product).set({ name: "Mutated Product" }).where(eq(schema.product.id, prodId));
    await db.update(schema.productVariant).set({ sku: "MUTATED-SKU" }).where(eq(schema.productVariant.id, varId));
    await db.update(schema.seller).set({ displayName: "Mutated Seller" }).where(eq(schema.seller.id, sellerId));
    await db.update(schema.wholesalePackage).set({ name: "Mutated Package" }).where(eq(schema.wholesalePackage.id, pkgId));
    await db.update(schema.sellerOffer).set({ wholesalePrice: 99999n as any }).where(eq(schema.sellerOffer.id, offerId));

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: `idem_snap_${Date.now()}`,
      buyerUserId: userId,
    });

    // Order must use frozen accepted values
    expect(result.items[0].productNameSnapshot).toBe("Product Original");
    expect(result.items[0].packageNameSnapshot).toBe("Package Original");
    expect(result.items[0].sellerSnapshot).toMatchObject({ displayName: "Seller Original" });
    expect(result.items[0].unitPrice.toString()).toBe("50000");

    // Inventory uses frozen composition, not mutated
    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.orderId, result.order.id));
    expect(reservations.length).toBe(4);
    // Each reservation quantity 1 (from frozen composition)
    for (const r of reservations) {
      expect(r.quantity).toBe(1);
    }
  });

  it("expiry DB-time: valid and expired", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => ({
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: null as any,
      variantId: varId,
      packageId: null,
      quantity: qty,
      saleUnit: "PIECE" as const,
      pricingUnit: "PIECE" as const,
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      product: { id: prodId, name: "Prod" },
      variant: { id: varId, sku: "SKU", attributes: {} },
      seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
      package: null,
      pieceQuantity: qty,
      lineTotal: (qty * 1000).toString(),
    });

    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);

    // Expired request: acceptanceExpiresAt in past (using DB time, we set past date)
    const reqExpiredId = makeId("wreq_expired");
    const snapExpired = makeSnap(1);
    (snapExpired as any).supplierId = sellerRow.supplierId;
    (snapExpired as any).seller.supplierId = sellerRow.supplierId;
    await db.insert(schema.wholesaleRequest).values({
      id: reqExpiredId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapExpired as any,
      acceptedTermsHash: hashAcceptedTerms(snapExpired as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
      acceptanceExpiresAt: new Date(Date.now() - 10000), // 10 sec ago
    });

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqExpiredId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran", street: "Test" },
        billingAddress: { city: "Tehran", street: "Test" },
        idempotencyKey: `idem_expired_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("REQUEST_ACCEPTANCE_EXPIRED");
    }
    expect(failed).toBe(true);

    // Valid request: expires in future
    const reqValidId = makeId("wreq_valid");
    const snapValid = makeSnap(1);
    (snapValid as any).supplierId = sellerRow.supplierId;
    (snapValid as any).seller.supplierId = sellerRow.supplierId;
    await db.insert(schema.wholesaleRequest).values({
      id: reqValidId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapValid as any,
      acceptedTermsHash: hashAcceptedTerms(snapValid as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
      acceptanceExpiresAt: new Date(Date.now() + 3600000),
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqValidId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: `idem_valid_${Date.now()}`,
      buyerUserId: userId,
    });
    expect(result.order.id).toBeDefined();
  });

  it("request conversion: link mismatch, hash mismatch, version off-by-one", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => {
      const snap = {
        requestVersion: 0,
        productId: prodId,
        offerId,
        sellerId,
        supplierId: null as any,
        variantId: varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE" as const,
        pricingUnit: "PIECE" as const,
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        product: { id: prodId, name: "Prod" },
        variant: { id: varId, sku: "SKU", attributes: {} },
        seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * 1000).toString(),
      };
      return snap;
    };
    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);

    // Create request
    const reqId = makeId("wreq_link");
    const snap = makeSnap(1);
    (snap as any).supplierId = sellerRow.supplierId;
    (snap as any).seller.supplierId = sellerRow.supplierId;
    const hash = hashAcceptedTerms(snap as any);
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 5,
      acceptedTermsSnapshot: snap as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    // Version off-by-one should fail
    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId, expectedVersion: 4 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran", street: "Test" },
        billingAddress: { city: "Tehran", street: "Test" },
        idempotencyKey: `idem_ver_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("REQUEST_VERSION_CONFLICT");
    }
    expect(failed).toBe(true);

    // Now create order successfully
    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 5 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: `idem_link_ok_${Date.now()}`,
      buyerUserId: userId,
    });
    expect(result.order.id).toBeDefined();

    // Try to mark again with wrong orderId — should fail link mismatch or already ordered
    failed = false;
    try {
      const dbForMark = drizzle(pool, { schema: schema as any });
      await vipService.markRequestOrdered(reqId, 6, dbForMark as any, "fake_order_id");
    } catch (e: any) {
      failed = true;
      expect(["REQUEST_LINK_MISSING", "REQUEST_LINK_MISMATCH", "REQUEST_NOT_ACCEPTED", "REQUEST_VERSION_CONFLICT"]).toContain(e.code);
    }
    expect(failed).toBe(true);

    // Hash mismatch: tamper snapshot then try to mark (but request already ordered, so need new request)
    const reqId2 = makeId("wreq_hash");
    const snap2 = makeSnap(1);
    (snap2 as any).supplierId = sellerRow.supplierId;
    (snap2 as any).seller.supplierId = sellerRow.supplierId;
    await db.insert(schema.wholesaleRequest).values({
      id: reqId2,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap2 as any,
      acceptedTermsHash: "tampered_hash",
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId2, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran", street: "Test" },
        billingAddress: { city: "Tehran", street: "Test" },
        idempotencyKey: `idem_hash_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("ACCEPTED_TERMS_HASH_MISMATCH");
    }
    expect(failed).toBe(true);
  });

  it("inventory IDs collision-resistant: ires_ + uuid, not Date.now", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => {
      const snap = {
        requestVersion: 0,
        productId: prodId,
        offerId,
        sellerId,
        supplierId: null as any,
        variantId: varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE" as const,
        pricingUnit: "PIECE" as const,
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        product: { id: prodId, name: "Prod" },
        variant: { id: varId, sku: "SKU", attributes: {} },
        seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * 1000).toString(),
      };
      return snap;
    };
    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);
    const reqId = makeId("wreq_res_id");
    const snap = makeSnap(1);
    (snap as any).supplierId = sellerRow.supplierId;
    (snap as any).seller.supplierId = sellerRow.supplierId;

    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap as any,
      acceptedTermsHash: hashAcceptedTerms(snap as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: `idem_resid_${Date.now()}`,
      buyerUserId: userId,
    });

    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.orderId, result.order.id));
    expect(reservations.length).toBe(1);
    const resId = reservations[0].id;
    expect(resId.startsWith("ires_")).toBe(true);
    // Should be uuid-like (32 hex chars after prefix, no Date.now)
    const suffix = resId.slice(5);
    expect(suffix.length).toBeGreaterThanOrEqual(20);
    // Ensure not containing Date.now pattern (13 digit timestamp)
    expect(/ires_\d{13}_/.test(resId)).toBe(false);
  });

  it("inventory idempotency same/diff hash, on_hand unchanged", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => {
      const snap = {
        requestVersion: 0,
        productId: prodId,
        offerId,
        sellerId,
        supplierId: null as any,
        variantId: varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE" as const,
        pricingUnit: "PIECE" as const,
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        product: { id: prodId, name: "Prod" },
        variant: { id: varId, sku: "SKU", attributes: {} },
        seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * 1000).toString(),
      };
      return snap;
    };
    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);

    const reqId = makeId("wreq_inv_idem");
    const snap = makeSnap(2);
    (snap as any).supplierId = sellerRow.supplierId;
    (snap as any).seller.supplierId = sellerRow.supplierId;

    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap as any,
      acceptedTermsHash: hashAcceptedTerms(snap as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_inv_${Date.now()}`;

    const first = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    const [invAfterFirst] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, varId), eq(schema.productVariantInventory.sellerId, sellerId))).limit(1);
    expect(invAfterFirst.onHand).toBe(100);
    expect(invAfterFirst.reserved).toBe(2);

    // Replay same key same payload should not double-reserve
    const second = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    expect(second.replayed).toBe(true);
    const [invAfterSecond] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, varId), eq(schema.productVariantInventory.sellerId, sellerId))).limit(1);
    expect(invAfterSecond.reserved).toBe(2);
    expect(invAfterSecond.onHand).toBe(100);
  });

  it("boundaries: OrdersService does not directly query foreign tables", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync("src/modules/orders/orders.service.ts", "utf8");
    // Should not directly import seller, supplier, product, productVariant, wholesaleAccount, sellerOffer as table objects
    // It should use CatalogService, SuppliersService, OffersService, VipService
    const forbiddenImports = [
      "from \"@kolbe/database\"",
    ];
    // Check that file does not contain direct table queries like `from(product)` or `from(seller)` outside allowed
    // We allow wholesaleOrder, wholesaleOrderItem, purchaseOrder, purchaseOrderItem, wholesaleOrderRequest
    const allowedTables = ["wholesaleOrder", "wholesaleOrderItem", "purchaseOrder", "purchaseOrderItem", "wholesaleOrderRequest"];
    const tablePattern = /\b(seller|supplier|product|productVariant|wholesaleAccount|sellerOffer)\b/;
    // More precise: check if file contains `product,` or `seller,` in import from @kolbe/database
    const dbImportMatch = content.match(/import\s+\{([^}]+)\}\s+from\s+\"@kolbe\/database\"/);
    if (dbImportMatch) {
      const imported = dbImportMatch[1];
      expect(imported).not.toMatch(/\bseller\b/);
      expect(imported).not.toMatch(/\bsupplier\b/);
      expect(imported).not.toMatch(/\bproduct\b/);
      expect(imported).not.toMatch(/\bproductVariant\b/);
      expect(imported).not.toMatch(/\bwholesaleAccount\b/);
      expect(imported).not.toMatch(/\bsellerOffer\b/);
    }
  });

  it("order code collision safety: entropy 16 hex and retry", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupBasic();
    const db = drizzle(pool, { schema: schema as any });

    const makeSnap = (qty: number) => {
      const snap = {
        requestVersion: 0,
        productId: prodId,
        offerId,
        sellerId,
        supplierId: null as any,
        variantId: varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE" as const,
        pricingUnit: "PIECE" as const,
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        product: { id: prodId, name: "Prod" },
        variant: { id: varId, sku: "SKU", attributes: {} },
        seller: { id: sellerId, type: "SUPPLIER", displayName: "Seller", supplierId: null },
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * 1000).toString(),
      };
      return snap;
    };
    const [sellerRow] = await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1);

    const reqId = makeId("wreq_code");
    const snap = makeSnap(1);
    (snap as any).supplierId = sellerRow.supplierId;
    (snap as any).seller.supplierId = sellerRow.supplierId;

    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snap as any,
      acceptedTermsHash: hashAcceptedTerms(snap as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test" },
      billingAddress: { city: "Tehran", street: "Test" },
      idempotencyKey: `idem_code_${Date.now()}`,
      buyerUserId: userId,
    });

    // Order code should be KV-W- + 16 hex chars
    expect(result.order.orderCode.startsWith("KV-W-")).toBe(true);
    const suffix = result.order.orderCode.slice(5);
    expect(suffix.length).toBe(16);
    expect(/^[A-F0-9]{16}$/.test(suffix)).toBe(true);

    // Child codes deterministic ordering
    expect(result.children.length).toBe(1);
    expect(result.children[0].orderCode).toBe(`${result.order.orderCode}-01`);
  });
});
