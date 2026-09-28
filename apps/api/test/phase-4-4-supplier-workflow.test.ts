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
const TEST_DB = "kolbe_orders_44_test";
const TEST_URL = `postgres://postgres:postgres@127.0.0.1:55432/${TEST_DB}`;

let pool: Pool;
let app: any;
let ordersService: any;
let vipService: any;
let inventoryService: any;
let fulfillmentService: any;

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

describe("Phase 4.4 — Supplier Revision, Confirmation & Exception-Safe Fulfillment (Exit Gate)", () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "pg.mjs"), "ensure"], { stdio: "inherit" });
    await recreateDatabase();
    execFileSync(process.execPath, [path.join(ROOT, "packages", "database", "migrate.mjs")], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });

    process.env.DATABASE_URL = TEST_URL;
    process.env.NODE_ENV = "test";
    process.env.KOLBE_SESSION_SECRET = "test-secret-orders-44";
    process.env.KOLBE_ALLOWED_ORIGINS = "http://localhost:3000";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const { OrdersService } = await import("../src/modules/orders/orders.service");
    const { VipService } = await import("../src/modules/vip/vip.service");
    const { InventoryService } = await import("../src/modules/inventory/inventory.service");
    const { FulfillmentService } = await import("../src/modules/fulfillment/fulfillment.service");
    ordersService = app.get(OrdersService);
    vipService = app.get(VipService);
    inventoryService = app.get(InventoryService);
    fulfillmentService = app.get(FulfillmentService);

    pool = new Pool({ connectionString: TEST_URL });
    pool.on('error', () => {});
  }, 180_000);

  afterAll(async () => {
    try { await app?.close(); } catch {}
    try { await pool?.end(); } catch {}
    await new Promise(r => setTimeout(r, 200));
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    } catch {}
    finally {
      try { await admin.end(); } catch {}
    }
  });

  async function setupTwoSuppliers() {
    const db = drizzle(pool, { schema: schema as any });
    const supA = makeId("supA");
    const supB = makeId("supB");
    const sellerA = makeId("sellerA");
    const sellerB = makeId("sellerB");
    const userBuyer = makeId("buyer");
    const userAOwner = makeId("userA_owner");
    const userASales = makeId("userA_sales");
    const userAWarehouse = makeId("userA_warehouse");
    const userAFinance = makeId("userA_finance");
    const userBOwner = makeId("userB_owner");
    const prodId = makeId("prod");
    const varId = makeId("var");
    const offerA = makeId("offerA");
    const offerB = makeId("offerB");
    const accId = makeId("acc");

    await db.insert(schema.accountUser).values([
      { id: userBuyer, email: `${userBuyer}@test.com`, passwordHash: "h", salt: "s", role: "vip", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: userAOwner, email: `${userAOwner}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: userASales, email: `${userASales}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: userAWarehouse, email: `${userAWarehouse}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: userAFinance, email: `${userAFinance}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
      { id: userBOwner, email: `${userBOwner}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 },
    ]);
    await db.insert(schema.supplier).values([
      { id: supA, legalName: "Sup A", displayName: "Sup A", status: "approved" },
      { id: supB, legalName: "Sup B", displayName: "Sup B", status: "approved" },
    ]);
    await db.insert(schema.seller).values([
      { id: sellerA, type: "SUPPLIER", supplierId: supA, displayName: "Seller A", status: "active" },
      { id: sellerB, type: "SUPPLIER", supplierId: supB, displayName: "Seller B", status: "active" },
    ]);
    await db.insert(schema.supplierMember).values([
      { id: makeId("memA_owner"), supplierId: supA, userId: userAOwner, role: "owner", title: "Owner" },
      { id: makeId("memA_sales"), supplierId: supA, userId: userASales, role: "sales", title: "Sales" },
      { id: makeId("memA_wh"), supplierId: supA, userId: userAWarehouse, role: "warehouse", title: "Warehouse" },
      { id: makeId("memA_fin"), supplierId: supA, userId: userAFinance, role: "finance", title: "Finance" },
      { id: makeId("memB_owner"), supplierId: supB, userId: userBOwner, role: "owner", title: "Owner" },
    ]);
    await db.insert(schema.product).values({ id: prodId, name: "Prod", slug: `prod-${prodId}`, status: "published" });
    await db.insert(schema.productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active", attributes: {} as any });
    await db.insert(schema.sellerOffer).values([
      { id: offerA, productId: prodId, sellerId: sellerA, variantId: varId, sku: `OFFER-${offerA}`, status: "published", wholesalePrice: 1000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any },
      { id: offerB, productId: prodId, sellerId: sellerB, variantId: varId, sku: `OFFER-${offerB}`, status: "published", wholesalePrice: 2000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any },
    ]);
    await db.insert(schema.wholesaleAccount).values({ id: accId, userId: userBuyer, memberName: "Buyer", storeName: "Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(schema.productVariantInventory).values([
      { id: makeId("invA"), variantId: varId, sellerId: sellerA, onHand: 100, reserved: 0, status: "active" },
      { id: makeId("invB"), variantId: varId, sellerId: sellerB, onHand: 100, reserved: 0, status: "active" },
    ]);

    return { supA, supB, sellerA, sellerB, userBuyer, userAOwner, userASales, userAWarehouse, userAFinance, userBOwner, prodId, varId, offerA, offerB, accId };
  }

  // ── 0.1 Revision integration proof ─────────────────────────────────────
  describe("0.1 Revision integration proof", () => {
    it("Supplier A cannot revise Supplier B request", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const snapshot = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerB,
        sellerId: ctx.sellerB,
        supplierId: ctx.supB,
        variantId: ctx.varId,
        packageId: null,
        quantity: 5,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "2000",
        currency: "IRR",
        package: null,
        pieceQuantity: 5,
        lineTotal: "10000",
      };
      const hash = hashAcceptedTerms(snapshot as any);
      const reqId = makeId("wreq_rev_cross");
      await db.insert(schema.wholesaleRequest).values({
        id: reqId,
        productId: ctx.prodId,
        offerId: ctx.offerB,
        vipAccountId: ctx.accId,
        variantId: ctx.varId,
        quantity: 5,
        status: "supplier_review",
        version: 0,
        acceptedTermsSnapshot: null as any,
        acceptedTermsHash: null as any,
      });

      let failed = false;
      try {
        await vipService.proposeRevision({
          requestId: reqId,
          supplierUserId: ctx.userAOwner, // A trying to revise B's request
          reason: "Try cross",
          proposedQuantity: 3,
          idempotencyKey: `idem_cross_${Date.now()}`,
        });
      } catch (e: any) {
        failed = true;
        expect(e.code).toBe("SUPPLIER_OWNERSHIP_VIOLATION");
      }
      expect(failed).toBe(true);
    });

    it("Owner/sales can revise, warehouse/finance cannot negotiate", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const reqId = makeId("wreq_rev_role");
      await db.insert(schema.wholesaleRequest).values({
        id: reqId,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        vipAccountId: ctx.accId,
        variantId: ctx.varId,
        quantity: 10,
        status: "supplier_review",
        version: 0,
      });

      // owner can
      const resOwner = await vipService.proposeRevision({
        requestId: reqId,
        supplierUserId: ctx.userAOwner,
        reason: "Owner revise",
        proposedQuantity: 5,
        idempotencyKey: `idem_owner_${Date.now()}`,
      });
      expect(resOwner.request.status).toBe("revision_requested");

      // reset to supplier_review for sales test
      await db.update(schema.wholesaleRequest).set({ status: "supplier_review", version: resOwner.request.version }).where(eq(schema.wholesaleRequest.id, reqId));

      const resSales = await vipService.proposeRevision({
        requestId: reqId,
        supplierUserId: ctx.userASales,
        reason: "Sales revise",
        proposedQuantity: 4,
        idempotencyKey: `idem_sales_${Date.now()}`,
      });
      expect(resSales.request.status).toBe("revision_requested");

      await db.update(schema.wholesaleRequest).set({ status: "supplier_review", version: resSales.request.version }).where(eq(schema.wholesaleRequest.id, reqId));

      // warehouse cannot
      let whFailed = false;
      try {
        await vipService.proposeRevision({
          requestId: reqId,
          supplierUserId: ctx.userAWarehouse,
          reason: "Warehouse try",
          proposedQuantity: 3,
          idempotencyKey: `idem_wh_${Date.now()}`,
        });
      } catch (e: any) {
        whFailed = true;
        expect(e.code).toBe("ROLE_NOT_ALLOWED");
      }
      expect(whFailed).toBe(true);

      // finance cannot
      let finFailed = false;
      try {
        await vipService.proposeRevision({
          requestId: reqId,
          supplierUserId: ctx.userAFinance,
          reason: "Finance try",
          proposedQuantity: 2,
          idempotencyKey: `idem_fin_${Date.now()}`,
        });
      } catch (e: any) {
        finFailed = true;
        expect(e.code).toBe("ROLE_NOT_ALLOWED");
      }
      expect(finFailed).toBe(true);
    });

    it("Buyer explicitly accepts revision, revision does NOT directly become accepted/order, stale version fails, immutable snapshot", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const reqId = makeId("wreq_rev_accept");
      await db.insert(schema.wholesaleRequest).values({
        id: reqId,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        vipAccountId: ctx.accId,
        variantId: ctx.varId,
        quantity: 10,
        status: "supplier_review",
        version: 0,
      });

      const proposed = await vipService.proposeRevision({
        requestId: reqId,
        supplierUserId: ctx.userAOwner,
        reason: "Reduce qty",
        proposedQuantity: 6,
        idempotencyKey: `idem_prop_${Date.now()}`,
      });

      const revId = proposed.revision.id;
      const originalHash = proposed.revision.proposedTermsHash;

      // Buyer accepts
      const accepted = await vipService.acceptRevision({
        requestId: reqId,
        revisionId: revId,
        buyerUserId: ctx.userBuyer,
        idempotencyKey: `idem_accept_${Date.now()}`,
      });

      expect(accepted.request.status).toBe("supplier_review"); // NOT accepted/order
      expect(accepted.revision.buyerResponse).toBe("accepted");

      // Immutable snapshot remains unchanged
      const [revAfter] = await db.select().from(schema.wholesaleRequestRevision).where(eq(schema.wholesaleRequestRevision.id, revId)).limit(1);
      expect(revAfter.proposedTermsHash).toBe(originalHash);
      expect(revAfter.proposedQuantity).toBe(6);

      // Stale version fails
      let staleFailed = false;
      try {
        await vipService.acceptRevision({
          requestId: reqId,
          revisionId: revId,
          buyerUserId: ctx.userBuyer,
          idempotencyKey: `idem_accept_stale_${Date.now()}`,
          expectedVersion: 0, // actual is higher
        });
      } catch (e: any) {
        staleFailed = true;
        expect(e.code).toBe("REQUEST_VERSION_CONFLICT");
      }
      expect(staleFailed).toBe(true);
    });

    it("Cancelled/rejected/expired/ordered requests cannot resurrect", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });

      for (const terminal of ["rejected", "cancelled", "expired", "ordered"]) {
        const reqId = makeId(`wreq_term_${terminal}`);
        await db.insert(schema.wholesaleRequest).values({
          id: reqId,
          productId: ctx.prodId,
          offerId: ctx.offerA,
          vipAccountId: ctx.accId,
          variantId: ctx.varId,
          quantity: 5,
          status: terminal as any,
          version: 0,
        });

        let failed = false;
        try {
          await vipService.proposeRevision({
            requestId: reqId,
            supplierUserId: ctx.userAOwner,
            reason: "Try resurrect",
            proposedQuantity: 3,
            idempotencyKey: `idem_term_${terminal}_${Date.now()}`,
          });
        } catch (e: any) {
          failed = true;
          expect(e.code).toBe("INVALID_REQUEST_TRANSITION");
        }
        expect(failed).toBe(true);
      }
    });

    it("Expiry uses DB time and SKIP LOCKED prevents double-process", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const now = new Date();
      const past = new Date(now.getTime() - 60_000); // 1 min ago

      const reqId1 = makeId("wreq_exp1");
      const reqId2 = makeId("wreq_exp2");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqId1, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 5, status: "accepted", version: 0, acceptanceExpiresAt: past as any },
        { id: reqId2, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 5, status: "accepted", version: 0, acceptanceExpiresAt: past as any },
      ]);

      // Two workers concurrently expire
      const w1 = vipService.expireWholesaleRequests(10);
      const w2 = vipService.expireWholesaleRequests(10);
      const [r1, r2] = await Promise.all([w1, w2]);

      const totalExpired = r1.length + r2.length;
      // Both requests should be expired exactly once across workers, no double count
      expect(totalExpired).toBe(2);

      const [check1] = await db.select().from(schema.wholesaleRequest).where(eq(schema.wholesaleRequest.id, reqId1)).limit(1);
      const [check2] = await db.select().from(schema.wholesaleRequest).where(eq(schema.wholesaleRequest.id, reqId2)).limit(1);
      expect(check1.status).toBe("expired");
      expect(check2.status).toBe("expired");
    });
  });

  // ── 0.2 Fulfillment integration proof ──────────────────────────────────
  describe("0.2 Fulfillment integration proof", () => {
    it("supplier A cannot act on B, warehouse prep auth, ready no decrement, dispatch once, delivery no second decrement, cancel releases only sibling unchanged", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });

      // Create parent order with KOLBE + A + B (simulate via direct inserts for speed, but using canonical engine for one part)
      const snapshotA = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        sellerId: ctx.sellerA,
        supplierId: ctx.supA,
        variantId: ctx.varId,
        packageId: null,
        quantity: 5,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        package: null,
        pieceQuantity: 5,
        lineTotal: "5000",
      };
      const snapshotB = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerB,
        sellerId: ctx.sellerB,
        supplierId: ctx.supB,
        variantId: ctx.varId,
        packageId: null,
        quantity: 7,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "2000",
        currency: "IRR",
        package: null,
        pieceQuantity: 7,
        lineTotal: "14000",
      };

      const reqA = makeId("wreq_ful_A");
      const reqB = makeId("wreq_ful_B");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 5, status: "accepted", version: 1, acceptedTermsSnapshot: snapshotA as any, acceptedTermsHash: hashAcceptedTerms(snapshotA as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 7, status: "accepted", version: 1, acceptedTermsSnapshot: snapshotB as any, acceptedTermsHash: hashAcceptedTerms(snapshotB as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);

      const orderResult = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA, expectedVersion: 1 }, { requestId: reqB, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_ful_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });

      expect(orderResult.children).toHaveLength(2);
      const childA = orderResult.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB = orderResult.children.find((c: any) => c.sellerId === ctx.sellerB);
      expect(childA).toBeDefined();
      expect(childB).toBeDefined();

      // Advance parent to processing to allow preparation (payment gate)
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, orderResult.order.id));

      // Supplier A cannot act on B child (ownership)
      let crossFailed = false;
      try {
        await ordersService.confirmChildOrder({
          childOrderId: childB.id,
          actorUserId: ctx.userAOwner,
          actorRole: "supplier",
          supplierRole: "owner",
          idempotencyKey: `idem_cross_confirm_${Date.now()}`,
        });
      } catch (e: any) {
        crossFailed = true;
        expect(e.code).toBe("ORDER_OWNERSHIP_VIOLATION");
      }
      expect(crossFailed).toBe(true);

      // Confirm both
      await ordersService.confirmChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_A_${Date.now()}` });
      await ordersService.confirmChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_B_${Date.now()}` });

      // Finance cannot prepare (same supplier A, before preparation)
      let finFailed = false;
      try {
        await ordersService.startChildPreparation({ childOrderId: childA.id, actorUserId: ctx.userAFinance, actorRole: "supplier", supplierRole: "finance", idempotencyKey: `idem_prep_fin_${Date.now()}` });
      } catch (e: any) {
        finFailed = true;
        expect(e.code).toBe("ROLE_NOT_ALLOWED");
      }
      expect(finFailed).toBe(true);

      // Warehouse can prepare
      await ordersService.startChildPreparation({ childOrderId: childA.id, actorUserId: ctx.userAWarehouse, actorRole: "supplier", supplierRole: "warehouse", idempotencyKey: `idem_prep_A_${Date.now()}` });

      // Prepare B via owner
      await ordersService.startChildPreparation({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_B_${Date.now()}` });

      // Ready does not decrement inventory
      const [invBeforeReady] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      await ordersService.markChildReady({ childOrderId: childA.id, actorUserId: ctx.userAWarehouse, actorRole: "supplier", supplierRole: "warehouse", idempotencyKey: `idem_ready_A_${Date.now()}` });
      const [invAfterReady] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      expect(invAfterReady.onHand).toBe(invBeforeReady.onHand);
      expect(invAfterReady.reserved).toBe(invBeforeReady.reserved);

      // Dispatch consumes exactly once
      const dispAKey = `idem_disp_A_${Date.now()}`;
      const [invBeforeDispatch] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      await ordersService.dispatchChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: dispAKey });
      const [invAfterDispatch] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      expect(invAfterDispatch.onHand).toBe(invBeforeDispatch.onHand - 5);
      expect(invAfterDispatch.reserved).toBe(invBeforeDispatch.reserved - 5);

      // Duplicate dispatch via same idempotency key should replay no double decrement (test with B)
      const dispBKey = `idem_disp_B_${Date.now()}`;

      await ordersService.dispatchChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", idempotencyKey: dispBKey });
      const [invBBeforeDup] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);
      const dupB = await ordersService.dispatchChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", idempotencyKey: dispBKey });
      expect(dupB.replayed).toBe(true);
      const [invBAfterDup] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);
      expect(invBAfterDup.onHand).toBe(invBBeforeDup.onHand);
      expect(invBAfterDup.reserved).toBe(invBBeforeDup.reserved);

      // Delivery does not consume again
      const [invBeforeDeliver] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);
      await ordersService.deliverChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", idempotencyKey: `idem_del_B_${Date.now()}` });
      const [invAfterDeliver] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);
      expect(invAfterDeliver.onHand).toBe(invBeforeDeliver.onHand);
      expect(invAfterDeliver.reserved).toBe(invBeforeDeliver.reserved);
    });

    it("pre-dispatch cancellation releases only that child, sibling unchanged", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const snapA = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        sellerId: ctx.sellerA,
        supplierId: ctx.supA,
        variantId: ctx.varId,
        packageId: null,
        quantity: 5,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        package: null,
        pieceQuantity: 5,
        lineTotal: "5000",
      };
      const snapB = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerB,
        sellerId: ctx.sellerB,
        supplierId: ctx.supB,
        variantId: ctx.varId,
        packageId: null,
        quantity: 7,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "2000",
        currency: "IRR",
        package: null,
        pieceQuantity: 7,
        lineTotal: "14000",
      };
      const reqA = makeId("wreq_cancel_A");
      const reqB = makeId("wreq_cancel_B");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 5, status: "accepted", version: 1, acceptedTermsSnapshot: snapA as any, acceptedTermsHash: hashAcceptedTerms(snapA as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 7, status: "accepted", version: 1, acceptedTermsSnapshot: snapB as any, acceptedTermsHash: hashAcceptedTerms(snapB as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);

      const orderResult = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA, expectedVersion: 1 }, { requestId: reqB, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_cancel_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });

      const childA = orderResult.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB = orderResult.children.find((c: any) => c.sellerId === ctx.sellerB);

      const [invABefore] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      const [invBBefore] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);

      // Cancel B pre-dispatch
      await ordersService.cancelChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "Buyer cancel B", idempotencyKey: `idem_cancel_B_${Date.now()}` });

      const [invAAfter] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      const [invBAfter] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);

      // A unchanged
      expect(invAAfter.reserved).toBe(invABefore.reserved);
      expect(invAAfter.onHand).toBe(invABefore.onHand);

      // B released
      expect(invBAfter.reserved).toBe(invBBefore.reserved - 7);
      expect(invBAfter.onHand).toBe(invBBefore.onHand); // on_hand never changed on release

      // Parent not auto cancelled
      const [parent] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, orderResult.order.id)).limit(1);
      expect(parent.status).not.toBe("cancelled");
    });
  });

  // ── 0.3 Concurrency proof ──────────────────────────────────────────────
  describe("0.3 Concurrency proof", () => {
    it("dispatch B vs cancel B exactly one wins, no negative", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const snap = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        sellerId: ctx.sellerA,
        supplierId: ctx.supA,
        variantId: ctx.varId,
        packageId: null,
        quantity: 10,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        package: null,
        pieceQuantity: 10,
        lineTotal: "10000",
      };
      const req = makeId("wreq_conc");
      await db.insert(schema.wholesaleRequest).values({ id: req, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 10, status: "accepted", version: 1, acceptedTermsSnapshot: snap as any, acceptedTermsHash: hashAcceptedTerms(snap as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer });

      const orderResult = await ordersService.createWholesaleOrder({
        requests: [{ requestId: req, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_conc_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });
      const child = orderResult.children[0];
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, orderResult.order.id));
      await ordersService.confirmChildOrder({ childOrderId: child.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_conc_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: child.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_conc_${Date.now()}` });

      const dispatchP = ordersService.dispatchChildOrder({ childOrderId: child.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: `idem_disp_conc_${Date.now()}` });
      const cancelP = ordersService.cancelChildOrder({ childOrderId: child.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "concurrent cancel", idempotencyKey: `idem_cancel_conc_${Date.now()}` });

      const results = await Promise.allSettled([dispatchP, cancelP]);
      const successes = results.filter(r => r.status === "fulfilled");
      const failures = results.filter(r => r.status === "rejected");
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      const [inv] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      expect(inv.reserved).toBeGreaterThanOrEqual(0);
      expect(inv.onHand).toBeGreaterThanOrEqual(0);
      expect(inv.reserved).toBeLessThanOrEqual(inv.onHand);
    });

    it("dispatch A vs cancel B both succeed safely, no sibling interference", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      const snapA = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerA,
        sellerId: ctx.sellerA,
        supplierId: ctx.supA,
        variantId: ctx.varId,
        packageId: null,
        quantity: 5,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        package: null,
        pieceQuantity: 5,
        lineTotal: "5000",
      };
      const snapB = {
        requestVersion: 0,
        productId: ctx.prodId,
        offerId: ctx.offerB,
        sellerId: ctx.sellerB,
        supplierId: ctx.supB,
        variantId: ctx.varId,
        packageId: null,
        quantity: 7,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "2000",
        currency: "IRR",
        package: null,
        pieceQuantity: 7,
        lineTotal: "14000",
      };
      const reqA = makeId("wreq_concA");
      const reqB = makeId("wreq_concB");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 5, status: "accepted", version: 1, acceptedTermsSnapshot: snapA as any, acceptedTermsHash: hashAcceptedTerms(snapA as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 7, status: "accepted", version: 1, acceptedTermsSnapshot: snapB as any, acceptedTermsHash: hashAcceptedTerms(snapB as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);

      const orderResult = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA, expectedVersion: 1 }, { requestId: reqB, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_conc_AB_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });
      const childA = orderResult.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB = orderResult.children.find((c: any) => c.sellerId === ctx.sellerB);
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, orderResult.order.id));
      await ordersService.confirmChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_A_${Date.now()}` });
      await ordersService.confirmChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_B_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_A_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childB.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_B_${Date.now()}` });

      const pDispatchA = ordersService.dispatchChildOrder({ childOrderId: childA.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: `idem_disp_A_conc_${Date.now()}` });
      const pCancelB = ordersService.cancelChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel B while dispatch A", idempotencyKey: `idem_cancel_B_conc_${Date.now()}` });

      const results = await Promise.allSettled([pDispatchA, pCancelB]);
      expect(results.filter(r => r.status === "fulfilled").length).toBe(2);

      const [invA] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerA))).limit(1);
      const [invB] = await db.select().from(schema.productVariantInventory).where(and(eq(schema.productVariantInventory.variantId, ctx.varId), eq(schema.productVariantInventory.sellerId, ctx.sellerB))).limit(1);
      expect(invA.reserved).toBeGreaterThanOrEqual(0);
      expect(invB.reserved).toBeGreaterThanOrEqual(0);
      expect(invA.onHand).toBeGreaterThanOrEqual(0);
      expect(invB.onHand).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 0.4 Parent aggregation ALL cancelled ─────────────────────────────────
  describe("0.4 Parent aggregation ALL cancelled", () => {
    it("A+B+C cancelled → parent cancelled, one child cancellation never auto cancels parent while active remains", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });
      // Add third supplier
      const supC = makeId("supC");
      const sellerC = makeId("sellerC");
      const userCOwner = makeId("userC_owner");
      await db.insert(schema.accountUser).values({ id: userCOwner, email: `${userCOwner}@test.com`, passwordHash: "h", salt: "s", role: "supplier", status: "active", tokenVersion: 0, failedLoginAttempts: 0 });
      await db.insert(schema.supplier).values({ id: supC, legalName: "Sup C", displayName: "Sup C", status: "approved" });
      await db.insert(schema.seller).values({ id: sellerC, type: "SUPPLIER", supplierId: supC, displayName: "Seller C", status: "active" });
      await db.insert(schema.supplierMember).values({ id: makeId("memC"), supplierId: supC, userId: userCOwner, role: "owner", title: "Owner" });
      await db.insert(schema.productVariantInventory).values({ id: makeId("invC"), variantId: ctx.varId, sellerId: sellerC, onHand: 100, reserved: 0, status: "active" });

      const offerC = makeId("offerC");
      await db.insert(schema.sellerOffer).values({ id: offerC, productId: ctx.prodId, sellerId: sellerC, variantId: ctx.varId, sku: `OFFER-${offerC}`, status: "published", wholesalePrice: 3000n as any, currency: "IRR", moq: 1, moqUnit: "PIECE", pricingUnit: "PIECE" as any });

      const makeSnap = (offerId: string, sellerId: string, supId: string, qty: number, price: string) => ({
        requestVersion: 0,
        productId: ctx.prodId,
        offerId,
        sellerId,
        supplierId: supId,
        variantId: ctx.varId,
        packageId: null,
        quantity: qty,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: price,
        currency: "IRR",
        package: null,
        pieceQuantity: qty,
        lineTotal: (qty * Number(price)).toString(),
      });

      const reqA = makeId("wreq_agg_A");
      const reqB = makeId("wreq_agg_B");
      const reqC = makeId("wreq_agg_C");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerA, ctx.sellerA, ctx.supA, 2, "1000") as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerA, ctx.sellerA, ctx.supA, 2, "1000") as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerB, ctx.sellerB, ctx.supB, 2, "2000") as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerB, ctx.sellerB, ctx.supB, 2, "2000") as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqC, productId: ctx.prodId, offerId: offerC, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(offerC, sellerC, supC, 2, "3000") as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(offerC, sellerC, supC, 2, "3000") as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);

      const orderResult = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA, expectedVersion: 1 }, { requestId: reqB, expectedVersion: 1 }, { requestId: reqC, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_agg_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });

      const childA = orderResult.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB = orderResult.children.find((c: any) => c.sellerId === ctx.sellerB);
      const childC = orderResult.children.find((c: any) => c.sellerId === sellerC);

      // Cancel A
      await ordersService.cancelChildOrder({ childOrderId: childA.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel A", idempotencyKey: `idem_cancel_A_${Date.now()}` });
      let [parentAfterA] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, orderResult.order.id)).limit(1);
      expect(parentAfterA.status).not.toBe("cancelled"); // one active remains

      // Cancel B
      await ordersService.cancelChildOrder({ childOrderId: childB.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel B", idempotencyKey: `idem_cancel_B_${Date.now()}` });
      let [parentAfterB] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, orderResult.order.id)).limit(1);
      expect(parentAfterB.status).not.toBe("cancelled"); // C still active

      // Cancel C → all cancelled → parent cancelled
      await ordersService.cancelChildOrder({ childOrderId: childC.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel C", idempotencyKey: `idem_cancel_C_${Date.now()}` });
      let [parentAfterC] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, orderResult.order.id)).limit(1);
      expect(parentAfterC.status).toBe("cancelled");
    });

    it("A delivered B cancelled → parent completed, A shipped B cancelled → shipped, A preparing B cancelled → fulfillment", async () => {
      const ctx = await setupTwoSuppliers();
      const db = drizzle(pool, { schema: schema as any });

      const makeSnap = (offerId: string, sellerId: string, supId: string) => ({
        requestVersion: 0,
        productId: ctx.prodId,
        offerId,
        sellerId,
        supplierId: supId,
        variantId: ctx.varId,
        packageId: null,
        quantity: 2,
        saleUnit: "PIECE",
        pricingUnit: "PIECE",
        pricingTierId: null,
        unitPrice: "1000",
        currency: "IRR",
        package: null,
        pieceQuantity: 2,
        lineTotal: "2000",
      });

      // Scenario 1: A delivered B cancelled → completed
      const reqA1 = makeId("wreq_del_A");
      const reqB1 = makeId("wreq_del_B");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA1, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB1, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);
      const order1 = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA1, expectedVersion: 1 }, { requestId: reqB1, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_del_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });
      const childA1 = order1.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB1 = order1.children.find((c: any) => c.sellerId === ctx.sellerB);
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, order1.order.id));
      await ordersService.confirmChildOrder({ childOrderId: childA1.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_A1_${Date.now()}` });
      await ordersService.confirmChildOrder({ childOrderId: childB1.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_B1_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childA1.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_A1_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childB1.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_B1_${Date.now()}` });
      await ordersService.dispatchChildOrder({ childOrderId: childA1.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: `idem_disp_A1_${Date.now()}` });
      await ordersService.deliverChildOrder({ childOrderId: childA1.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: `idem_deliv_A1_${Date.now()}` });
      await ordersService.cancelChildOrder({ childOrderId: childB1.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel B after A delivered", idempotencyKey: `idem_cancel_B1_${Date.now()}` });
      const [parent1] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, order1.order.id)).limit(1);
      expect(parent1.status).toBe("completed");

      // Scenario 2: A shipped B cancelled → shipped
      const reqA2 = makeId("wreq_ship_A");
      const reqB2 = makeId("wreq_ship_B");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA2, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB2, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);
      const order2 = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA2, expectedVersion: 1 }, { requestId: reqB2, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_ship_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });
      const childA2 = order2.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB2 = order2.children.find((c: any) => c.sellerId === ctx.sellerB);
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, order2.order.id));
      await ordersService.confirmChildOrder({ childOrderId: childA2.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_A2_${Date.now()}` });
      await ordersService.confirmChildOrder({ childOrderId: childB2.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_B2_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childA2.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_A2_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childB2.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_B2_${Date.now()}` });
      await ordersService.dispatchChildOrder({ childOrderId: childA2.id, actorUserId: ctx.userAOwner, actorRole: "supplier", idempotencyKey: `idem_disp_A2_${Date.now()}` });
      await ordersService.cancelChildOrder({ childOrderId: childB2.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel B after A shipped", idempotencyKey: `idem_cancel_B2_${Date.now()}` });
      const [parent2] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, order2.order.id)).limit(1);
      expect(parent2.status).toBe("shipped");

      // Scenario 3: A preparing B cancelled → fulfillment
      const reqA3 = makeId("wreq_prep_A");
      const reqB3 = makeId("wreq_prep_B");
      await db.insert(schema.wholesaleRequest).values([
        { id: reqA3, productId: ctx.prodId, offerId: ctx.offerA, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerA, ctx.sellerA, ctx.supA) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
        { id: reqB3, productId: ctx.prodId, offerId: ctx.offerB, vipAccountId: ctx.accId, variantId: ctx.varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any, acceptedTermsHash: hashAcceptedTerms(makeSnap(ctx.offerB, ctx.sellerB, ctx.supB) as any), acceptedAt: new Date(), acceptedBy: ctx.userBuyer },
      ]);
      const order3 = await ordersService.createWholesaleOrder({
        requests: [{ requestId: reqA3, expectedVersion: 1 }, { requestId: reqB3, expectedVersion: 1 }],
        paymentMode: "transfer",
        shippingAddress: { city: "Tehran" },
        billingAddress: { city: "Tehran" },
        idempotencyKey: `idem_prep_${Date.now()}`,
        buyerUserId: ctx.userBuyer,
      });
      const childA3 = order3.children.find((c: any) => c.sellerId === ctx.sellerA);
      const childB3 = order3.children.find((c: any) => c.sellerId === ctx.sellerB);
      await db.update(schema.wholesaleOrder).set({ status: "processing" }).where(eq(schema.wholesaleOrder.id, order3.order.id));
      await ordersService.confirmChildOrder({ childOrderId: childA3.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_A3_${Date.now()}` });
      await ordersService.confirmChildOrder({ childOrderId: childB3.id, actorUserId: ctx.userBOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_conf_B3_${Date.now()}` });
      await ordersService.startChildPreparation({ childOrderId: childA3.id, actorUserId: ctx.userAOwner, actorRole: "supplier", supplierRole: "owner", idempotencyKey: `idem_prep_A3_${Date.now()}` });
      await ordersService.cancelChildOrder({ childOrderId: childB3.id, actorUserId: ctx.userBuyer, actorRole: "buyer", reason: "cancel B while A preparing", idempotencyKey: `idem_cancel_B3_${Date.now()}` });
      const [parent3] = await db.select().from(schema.wholesaleOrder).where(eq(schema.wholesaleOrder.id, order3.order.id)).limit(1);
      expect(parent3.status).toBe("fulfillment");
    });
  });
});
