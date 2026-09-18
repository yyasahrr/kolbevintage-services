import { execFileSync } from "node:child_process";
import path from "node:path";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../packages/database/src/schema/tables";
import { hashAcceptedTerms } from "../src/modules/pricing/pricing.logic";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = "postgres://postgres:postgres@127.0.0.1:55432/postgres";
const TEST_DB = "kolbe_orders_43_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let pool: Pool;
let app: any;
let ordersService: any;
let vipService: any;
let inventoryService: any;

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

describe("Phase 4.3 — Canonical Wholesale Order Engine", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-orders-43";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const { OrdersService } = await import("../src/modules/orders/orders.service");
    const { VipService } = await import("../src/modules/vip/vip.service");
    const { InventoryService } = await import("../src/modules/inventory/inventory.service");
    ordersService = app.get(OrdersService);
    vipService = app.get(VipService);
    inventoryService = app.get(InventoryService);

    const cs = TEST_URL;
    pool = new Pool({ connectionString: cs });
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

  async function setupSellerAndProduct() {
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
    await db.insert(schema.supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Seller", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "Product", slug: `prod-${Date.now()}-${Math.random()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
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

    // Inventory
    await db.insert(schema.productVariantInventory).values({
      id: makeId("inv"),
      variantId: varId,
      sellerId,
      onHand: 100,
      reserved: 0,
      status: "active",
    });

    // Package for package tests
    await db.insert(schema.wholesalePackage).values({ id: pkgId, offerId, packageType: "SIZE_RUN", name: "Full Series", totalPieces: 12 });
    const variants = [makeId("var_s"), makeId("var_m"), makeId("var_l"), makeId("var_xl"), makeId("var_2xl"), makeId("var_3xl")];
    for (const vId of variants) {
      await db.insert(schema.productVariant).values({ id: vId, productId: prodId, sku: `SKU-${vId}`, status: "active", attributes: {} as any });
      await db.insert(schema.productVariantInventory).values({
        id: makeId("inv_pkg"),
        variantId: vId,
        sellerId,
        onHand: 100,
        reserved: 0,
        status: "active",
      });
    }
    // Package items S x2, M x2, L x2, XL x2, 2XL x2, 3XL x2 = 12
    for (const vId of variants) {
      await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item"), packageId: pkgId, variantId: vId, quantity: 2 });
    }

    return { supId, sellerId, prodId, varId, offerId, userId, accountId, pkgId, variants };
  }

  it("PIECE order creates correct variant reservation", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 5,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 5,
      lineTotal: "50000",
    };
    const hash = hashAcceptedTerms(snapshot as any);

    const reqId = makeId("wreq_piece");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      packageId: null,
      quantity: 5,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Test St" },
      billingAddress: { city: "Tehran", street: "Test St" },
      idempotencyKey: `idem_piece_${Date.now()}`,
      buyerUserId: userId,
      actorRole: "vip",
    });

    expect(result.order.status).toBe("draft");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].variantId).toBe(varId);
    expect(result.items[0].packageId).toBeNull();
    expect(result.items[0].pieceQuantity).toBe(5);
    expect(result.children).toHaveLength(1);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].requestVersion).toBe(1); // not post-ordered version

    // Inventory: on_hand NOT decreased, reserved increased
    const [inv] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, varId), eq(schema.productVariantInventory.sellerId, sellerId))).limit(1);
    expect(inv.onHand).toBe(100);
    expect(inv.reserved).toBe(5);

    // Reservation traceability
    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.orderId, result.order.id));
    expect(reservations).toHaveLength(1);
    expect(reservations[0].variantId).toBe(varId);
    expect(reservations[0].quantity).toBe(5);
    expect(reservations[0].orderItemId).toBe(result.items[0].id);
    expect(reservations[0].requestId).toBe(reqId);
  });

  it("PACKAGE order creates one commercial line, multiple reservations", async () => {
    const { sellerId, prodId, offerId, userId, accountId, pkgId, variants } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const composition = variants.map((vId) => ({ variantId: vId, quantity: 2 }));
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: null,
      packageId: pkgId,
      quantity: 2,
      saleUnit: "SERIES",
      pricingUnit: "SERIES",
      pricingTierId: null,
      unitPrice: "120000",
      currency: "IRR",
      package: {
        type: "SIZE_RUN",
        name: "Full Series",
        piecesPerPackage: 12,
        composition,
      },
      pieceQuantity: 24,
      lineTotal: "240000",
    };
    const hash = hashAcceptedTerms(snapshot as any);

    const reqId = makeId("wreq_pkg");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: null,
      packageId: pkgId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_pkg_${Date.now()}`,
      buyerUserId: userId,
      actorRole: "vip",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].variantId).toBeNull();
    expect(result.items[0].packageId).toBe(pkgId);
    expect(result.items[0].packageQuantity).toBe(2);
    expect(result.items[0].pieceQuantity).toBe(24);

    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.orderId, result.order.id));
    expect(reservations).toHaveLength(6); // 6 variants
    for (const res of reservations) {
      expect(res.quantity).toBe(4); // 2 packages * 2 per variant
    }
  });

  it("idempotency replay returns same order even though requests now ordered", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "10000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_idem");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_replay_${Date.now()}`;
    const first = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    expect(first.replayed).toBe(false);

    // Second call with same key and same payload — should replay even though request is now ordered
    const second = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
  });

  it("same Idempotency-Key different payload → 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "10000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_idem_diff");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_diff_${Date.now()}`;
    await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    // Create another request for different payload
    const reqId2 = makeId("wreq_idem_diff2");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId2,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: { ...snapshot, quantity: 2, pieceQuantity: 2, lineTotal: "20000" } as any,
      acceptedTermsHash: hashAcceptedTerms({ ...snapshot, quantity: 2, pieceQuantity: 2, lineTotal: "20000" } as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId2, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran", street: "Different" }, // different address → different hash
        billingAddress: { city: "Tehran" },
        idempotencyKey: idemKey,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("IDEMPOTENCY_KEY_REUSED");
    }
    expect(failed).toBe(true);
  });

  it("same request different Idempotency-Keys → one succeeds, other 409 REQUEST_ALREADY_CONVERTED", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "10000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_double");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const first = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_first_${Date.now()}`,
      buyerUserId: userId,
    });

    expect(first.order.id).toBeDefined();

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_second_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(["REQUEST_ALREADY_CONVERTED", "REQUEST_NOT_ACCEPTED"]).toContain(e.code);
    }
    expect(failed).toBe(true);
  });

  it("stock race: available 10, Order A 7 and Order B 7 → only one succeeds", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const supId = makeId("sup_race");
    const sellerId = makeId("seller_race");
    const prodId = makeId("prod_race");
    const varId = makeId("var_race");
    const offerId = makeId("offer_race");
    const userId1 = makeId("user_race1");
    const userId2 = makeId("user_race2");
    const accountId1 = makeId("acc_race1");
    const accountId2 = makeId("acc_race2");

    await db.insert(schema.accountUser).values({ id: userId1, email: `${userId1}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    await db.insert(schema.accountUser).values({ id: userId2, email: `${userId2}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    await db.insert(schema.supplier).values({ id: supId, legalName: "Race Sup", displayName: "Race Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Race Seller", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "Race Product", slug: `race-${Date.now()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
    await db.insert(schema.sellerOffer).values({
      id: offerId,
      productId: prodId,
      sellerId,
      variantId: varId,
      sku: `OFFER-${offerId}`,
      status: "published",
      wholesalePrice: 1000n as any,
      currency: "IRR",
      moq: 1,
      moqUnit: "PIECE",
      pricingUnit: "PIECE" as any,
    });
    await db.insert(schema.wholesaleAccount).values({ id: accountId1, userId: userId1, memberName: "Race1", storeName: "Race Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.wholesaleAccount).values({ id: accountId2, userId: userId2, memberName: "Race2", storeName: "Race Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.productVariantInventory).values({
      id: makeId("inv_race"),
      variantId: varId,
      sellerId,
      onHand: 10,
      reserved: 0,
      status: "active",
    });

    const makeSnapshot = (qty: number) => ({
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: supId,
      variantId: varId,
      packageId: null,
      quantity: qty,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      package: null,
      pieceQuantity: qty,
      lineTotal: (qty * 1000).toString(),
    });

    const req1Id = makeId("wreq_race1");
    const req2Id = makeId("wreq_race2");
    await db.insert(schema.wholesaleRequest).values({
      id: req1Id,
      productId: prodId,
      offerId,
      vipAccountId: accountId1,
      variantId: varId,
      quantity: 7,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: makeSnapshot(7) as any,
      acceptedTermsHash: hashAcceptedTerms(makeSnapshot(7) as any),
      acceptedAt: new Date(),
      acceptedBy: userId1,
    });
    await db.insert(schema.wholesaleRequest).values({
      id: req2Id,
      productId: prodId,
      offerId,
      vipAccountId: accountId2,
      variantId: varId,
      quantity: 7,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: makeSnapshot(7) as any,
      acceptedTermsHash: hashAcceptedTerms(makeSnapshot(7) as any),
      acceptedAt: new Date(),
      acceptedBy: userId2,
    });

    // Run concurrently
    const p1 = ordersService.createWholesaleOrder({
      requests: [{ requestId: req1Id, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_race1_${Date.now()}`,
      buyerUserId: userId1,
    });

    const p2 = ordersService.createWholesaleOrder({
      requests: [{ requestId: req2Id, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_race2_${Date.now()}`,
      buyerUserId: userId2,
    });

    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // Check no oversell: reserved should be 7, not 14
    const [inv] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, varId), eq(schema.productVariantInventory.sellerId, sellerId))).limit(1);
    expect(inv.reserved).toBe(7);
    expect(inv.onHand).toBe(10);
  });

  it("accepted snapshot mutation: change live offer price/package, order uses frozen accepted values", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId, pkgId, variants } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const composition = variants.map((vId) => ({ variantId: vId, quantity: 2 }));
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: null,
      packageId: pkgId,
      quantity: 1,
      saleUnit: "SERIES",
      pricingUnit: "SERIES",
      pricingTierId: null,
      unitPrice: "120000",
      currency: "IRR",
      package: {
        type: "SIZE_RUN",
        name: "Original Full Series",
        piecesPerPackage: 12,
        composition,
      },
      pieceQuantity: 12,
      lineTotal: "120000",
    };
    const hash = hashAcceptedTerms(snapshot as any);

    const reqId = makeId("wreq_mut");
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

    // Mutate live sources
    await db.update(schema.sellerOffer).set({ wholesalePrice: 99999n as any }).where(eq(schema.sellerOffer.id, offerId));
    await db.update(schema.wholesalePackage).set({ name: "Mutated Package Name" }).where(eq(schema.wholesalePackage.id, pkgId));
    await db.update(schema.product).set({ name: "Mutated Product Name" }).where(eq(schema.product.id, prodId));

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_mut_${Date.now()}`,
      buyerUserId: userId,
    });

    // Order must use frozen accepted values, not mutated live
    expect(result.items[0].unitPrice.toString()).toBe("120000");
    expect(result.items[0].lineTotal.toString()).toBe("120000");
    expect(result.items[0].packageNameSnapshot).toBe("Original Full Series");
  });

  it("multi-seller order: KOLBE + Supplier A + Supplier B", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const supAId = makeId("sup_a");
    const supBId = makeId("sup_b");
    const sellerAId = makeId("seller_a");
    const sellerBId = makeId("seller_b");
    const prodId = makeId("prod_multi");
    const varId = makeId("var_multi");
    const userId = makeId("user_multi");
    const accountId = makeId("acc_multi");

    await db.insert(schema.accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    await db.insert(schema.supplier).values({ id: supAId, legalName: "Sup A", displayName: "Sup A", status: "approved" });
    await db.insert(schema.supplier).values({ id: supBId, legalName: "Sup B", displayName: "Sup B", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerAId, type: "SUPPLIER", supplierId: supAId, displayName: "Seller A", status: "active" });
    await db.insert(schema.seller).values({ id: sellerBId, type: "SUPPLIER", supplierId: supBId, displayName: "Seller B", status: "active" });
    const [existingKolbe] = await db.select().from(schema.seller).where(eq(schema.seller.type, "KOLBE")).limit(1);
    let kolbeId = existingKolbe?.id;
    if (!existingKolbe) {
      const sid = makeId("seller_kolbe_multi");
      await db.insert(schema.seller).values({ id: sid, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" });
      kolbeId = sid;
    }
    await db.insert(schema.product).values({ id: prodId, name: "Multi Product", slug: `multi-${Date.now()}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
    const offerAId = makeId("offer_a");
    const offerBId = makeId("offer_b");
    const offerKolbeId = makeId("offer_kolbe");
    await db.insert(schema.sellerOffer).values({ id: offerAId, productId: prodId, sellerId: sellerAId, variantId: varId, sku: `OFFER-${offerAId}`, status: "published", wholesalePrice: 1000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any });
    await db.insert(schema.sellerOffer).values({ id: offerBId, productId: prodId, sellerId: sellerBId, variantId: varId, sku: `OFFER-${offerBId}`, status: "published", wholesalePrice: 2000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any });
    await db.insert(schema.sellerOffer).values({ id: offerKolbeId, productId: prodId, sellerId: kolbeId!, variantId: varId, sku: `OFFER-${offerKolbeId}`, status: "published", wholesalePrice: 3000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any });
    await db.insert(schema.wholesaleAccount).values({ id: accountId, userId, memberName: "Multi", storeName: "Multi Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_a"), variantId: varId, sellerId: sellerAId, onHand: 100, reserved: 0, status: "active" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_b"), variantId: varId, sellerId: sellerBId, onHand: 100, reserved: 0, status: "active" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_k"), variantId: varId, sellerId: kolbeId!, onHand: 100, reserved: 0, status: "active" });

    const makeSnap = (offerId: string, sellerId: string, supplierId: string | null, price: string) => ({
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: price,
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: price,
    });

    const reqAId = makeId("wreq_a");
    const reqBId = makeId("wreq_b");
    const reqKolbeId = makeId("wreq_k");
    await db.insert(schema.wholesaleRequest).values({
      id: reqAId,
      productId: prodId,
      offerId: offerAId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: makeSnap(offerAId, sellerAId, supAId, "1000") as any,
      acceptedTermsHash: hashAcceptedTerms(makeSnap(offerAId, sellerAId, supAId, "1000") as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });
    await db.insert(schema.wholesaleRequest).values({
      id: reqBId,
      productId: prodId,
      offerId: offerBId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: makeSnap(offerBId, sellerBId, supBId, "2000") as any,
      acceptedTermsHash: hashAcceptedTerms(makeSnap(offerBId, sellerBId, supBId, "2000") as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });
    await db.insert(schema.wholesaleRequest).values({
      id: reqKolbeId,
      productId: prodId,
      offerId: offerKolbeId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: makeSnap(offerKolbeId, kolbeId!, null, "3000") as any,
      acceptedTermsHash: hashAcceptedTerms(makeSnap(offerKolbeId, kolbeId!, null, "3000") as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [
        { requestId: reqAId, expectedVersion: 1 },
        { requestId: reqBId, expectedVersion: 1 },
        { requestId: reqKolbeId, expectedVersion: 1 },
      ],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_multi_${Date.now()}`,
      buyerUserId: userId,
    });

    expect(result.order).toBeDefined();
    expect(result.children).toHaveLength(3);
    expect(result.items).toHaveLength(3);
    expect(result.links).toHaveLength(3);

    // Parent totals must equal sum of all line totals
    const sum = result.items.reduce((acc: bigint, it: any) => acc + BigInt(it.lineTotal), 0n);
    expect(BigInt(result.order.itemsTotal)).toBe(sum);

    // Child totals must reconcile by seller
    for (const child of result.children) {
      const childItems = result.items.filter((it: any) => it.sellerId === child.sellerId);
      const childSum = childItems.reduce((acc: bigint, it: any) => acc + BigInt(it.lineTotal), 0n);
      expect(BigInt(child.itemsTotal)).toBe(childSum);
    }

    // KOLBE child has NULL supplier_id
    const kolbeChild = result.children.find((c: any) => c.sellerId === kolbeId);
    expect(kolbeChild.supplierId).toBeNull();
    expect(kolbeChild.shippingResponsibility).toBe("KOLBE");

    // Supplier children have NOT NULL supplier_id
    const supAChild = result.children.find((c: any) => c.sellerId === sellerAId);
    expect(supAChild.supplierId).toBe(supAId);
    expect(supAChild.shippingResponsibility).toBe("SUPPLIER");
  });

  it("package insufficient: S enough, M enough, L insufficient → NO ORDER, NO RESERVATIONS, requests remain accepted", async () => {
    const db = drizzle(pool, { schema: schema as any });
    const supId = makeId("sup_insuf");
    const sellerId = makeId("seller_insuf");
    const prodId = makeId("prod_insuf");
    const offerId = makeId("offer_insuf");
    const userId = makeId("user_insuf");
    const accountId = makeId("acc_insuf");
    const pkgId = makeId("pkg_insuf");

    await db.insert(schema.accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
    await db.insert(schema.supplier).values({ id: supId, legalName: "Insuf Sup", displayName: "Insuf Sup", status: "approved" });
    await db.insert(schema.seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Insuf Seller", status: "active" });
    await db.insert(schema.product).values({ id: prodId, name: "Insuf Product", slug: `insuf-${Date.now()}`, status: "published" });
    await db.insert(schema.sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: null as any, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 10000n as any, currency: "IRR", moq: 1, moqUnit: "SERIES", pricingUnit: "SERIES" as any });
    await db.insert(schema.wholesaleAccount).values({ id: accountId, userId, memberName: "Insuf", storeName: "Insuf Store", phone: "0912", city: "Tehran", status: "approved" });

    await db.insert(schema.wholesalePackage).values({ id: pkgId, offerId, packageType: "SIZE_RUN", name: "Insuf Package", totalPieces: 6 });
    const varS = makeId("var_insuf_s");
    const varM = makeId("var_insuf_m");
    const varL = makeId("var_insuf_l");
    for (const vId of [varS, varM, varL]) {
      await db.insert(schema.productVariant).values({ id: vId, productId: prodId, sku: `SKU-${vId}`, status: "active", attributes: {} as any });
    }
    // S enough (100), M enough (100), L insufficient (1 onHand but need 4)
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_s"), variantId: varS, sellerId, onHand: 100, reserved: 0, status: "active" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_m"), variantId: varM, sellerId, onHand: 100, reserved: 0, status: "active" });
    await db.insert(schema.productVariantInventory).values({ id: makeId("inv_l"), variantId: varL, sellerId, onHand: 1, reserved: 0, status: "active" });

    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item_s"), packageId: pkgId, variantId: varS, quantity: 2 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item_m"), packageId: pkgId, variantId: varM, quantity: 2 });
    await db.insert(schema.wholesalePackageItem).values({ id: makeId("pkg_item_l"), packageId: pkgId, variantId: varL, quantity: 2 });

    const composition = [
      { variantId: varS, quantity: 2 },
      { variantId: varM, quantity: 2 },
      { variantId: varL, quantity: 2 },
    ];
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: supId,
      variantId: null,
      packageId: pkgId,
      quantity: 2, // needs 4 of each variant, L only has 1
      saleUnit: "SERIES",
      pricingUnit: "SERIES",
      pricingTierId: null,
      unitPrice: "60000",
      currency: "IRR",
      package: { type: "SIZE_RUN", name: "Insuf Package", piecesPerPackage: 6, composition },
      pieceQuantity: 12,
      lineTotal: "120000",
    };

    const reqId = makeId("wreq_insuf");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: null,
      packageId: pkgId,
      quantity: 2,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hashAcceptedTerms(snapshot as any),
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_insuf_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("INVENTORY_SHORTAGE");
    }
    expect(failed).toBe(true);

    // Ensure NO ORDER created
    const orders = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.accountId, accountId));
    expect(orders).toHaveLength(0);

    // Ensure NO RESERVATIONS
    const reservations = await db.select().from(schema.inventoryReservation).where(eq(schema.inventoryReservation.requestId, reqId));
    expect(reservations).toHaveLength(0);

    // Ensure inventory unchanged
    const [invL] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, varL), eq(schema.productVariantInventory.sellerId, sellerId))).limit(1);
    expect(invL.onHand).toBe(1);
    expect(invL.reserved).toBe(0);

    // Ensure request still accepted
    const [req] = await db.select().from(schema.wholesaleRequest).where(eq(schema.wholesaleRequest.id, reqId)).limit(1);
    expect(req.status).toBe("accepted");
  });

  it("address normalization: same key with trimmed vs untrimmed should be same hash → replay, different city → 409", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "10000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_addr");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const idemKey = `idem_addr_${Date.now()}`;
    const first = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran", street: "Valiasr" },
      billingAddress: { city: "Tehran", street: "Valiasr" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    // Same key, same payload but with trimmed spaces → should be replay (hash same after normalization)
    const second = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "  Tehran  ", street: "  Valiasr  " },
      billingAddress: { city: "Tehran", street: "Valiasr" },
      idempotencyKey: idemKey,
      buyerUserId: userId,
    });

    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    // Now test same key with different city → should be 409, even though request already converted, idempotency check comes first
    const reqId2 = makeId("wreq_addr2");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId2,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId2, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Isfahan", street: "Valiasr" }, // different city → different hash
        billingAddress: { city: "Tehran", street: "Valiasr" },
        idempotencyKey: idemKey,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("IDEMPOTENCY_KEY_REUSED");
    }
    expect(failed).toBe(true);
  });

  it("failure injection: inventory shortage after parent creation must rollback entirely", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    // Create request that will fail inventory check
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 200, // more than onHand 100
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "10000",
      currency: "IRR",
      package: null,
      pieceQuantity: 200,
      lineTotal: "2000000",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_fail");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 200,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const countBeforeOrders = (await db.select().from(schema.wholesaleOrder)).length;
    const countBeforeItems = (await db.select().from(schema.wholesaleOrderItem)).length;
    const countBeforeChildren = (await db.select().from(schema.purchaseOrder)).length;
    const countBeforeReservations = (await db.select().from(schema.inventoryReservation)).length;
    const countBeforeLinks = (await db.select().from(schema.wholesaleOrderRequest)).length;
    const countBeforeHistory = (await db.select().from(schema.orderStatusHistory)).length;
    const countBeforeEvents = (await db.select().from(schema.orderEvent)).length;

    let failed = false;
    try {
      await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqId, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_fail_${Date.now()}`,
        buyerUserId: userId,
      });
    } catch (e: any) {
      failed = true;
      expect(e.code).toBe("INVENTORY_SHORTAGE");
    }
    expect(failed).toBe(true);

    // Verify no partial writes
    expect((await db.select().from(schema.wholesaleOrder)).length).toBe(countBeforeOrders);
    expect((await db.select().from(schema.wholesaleOrderItem)).length).toBe(countBeforeItems);
    expect((await db.select().from(schema.purchaseOrder)).length).toBe(countBeforeChildren);
    expect((await db.select().from(schema.inventoryReservation)).length).toBe(countBeforeReservations);
    expect((await db.select().from(schema.wholesaleOrderRequest)).length).toBe(countBeforeLinks);
    expect((await db.select().from(schema.orderStatusHistory)).length).toBe(countBeforeHistory);
    expect((await db.select().from(schema.orderEvent)).length).toBe(countBeforeEvents);

    // Request still accepted
    const [req] = await db.select().from(schema.wholesaleRequest).where(eq(schema.wholesaleRequest.id, reqId)).limit(1);
    expect(req.status).toBe("accepted");
  });

  it("bigint totals: parent and child totals must be bigint and reconcile", async () => {
    const { sellerId, prodId, varId, offerId, userId, accountId } = await setupSellerAndProduct();
    const db = drizzle(pool, { schema: schema as any });

    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: (await db.select().from(schema.seller).where(eq(schema.seller.id, sellerId)).limit(1).then(r => r[0].supplierId)) as any,
      variantId: varId,
      packageId: null,
      quantity: 3,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "123456789012",
      currency: "IRR",
      package: null,
      pieceQuantity: 3,
      lineTotal: "370370367036",
    };
    const hash = hashAcceptedTerms(snapshot as any);
    const reqId = makeId("wreq_bigint");
    await db.insert(schema.wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 3,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: hash,
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const result = await ordersService.createWholesaleOrder({
      requests: [{ requestId: reqId, expectedVersion: 1 }],
      paymentMode: "transfer",
      shippingAddress: { city: "Tehran" },
      billingAddress: { city: "Tehran" },
      idempotencyKey: `idem_bigint_${Date.now()}`,
      buyerUserId: userId,
    });

    // drizzle may return string for bigint, but ensure it's parseable as bigint
    expect(() => BigInt(result.order.itemsTotal as any)).not.toThrow();
    // But we ensure totals are correct bigint math
    const expected = BigInt("370370367036");
    expect(BigInt(result.order.itemsTotal as any)).toBe(expected);
    expect(BigInt(result.order.grandTotal as any)).toBe(expected);
  });
});
