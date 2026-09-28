import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  wholesaleOrder,
  wholesaleOrderItem,
  purchaseOrder,
  purchaseOrderItem,
  wholesaleAccount,
  accountUser,
  seller,
  supplier,
  product,
  productVariant,
  sellerOffer,
  wholesalePackage,
  wholesalePackageItem,
  wholesaleRequest,
  wholesaleOrderRequest,
  orderStatusHistory,
  orderEvent,
} from "../src/schema/tables";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "./helpers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/schema/tables";

const DB = "kolbe_phase43_test";
function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("Phase 4.3 — Schema compatibility corrections", () => {
  let pool: Pool;
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    const cs = urlFor(DB);
    pool = new Pool({ connectionString: cs });
  }, 180_000);
  afterAll(async () => {
    await pool?.end();
    await dropDatabase(DB);
  });

  it("purchase_order_item.variant_id is now nullable for package lines", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='purchase_order_item' AND column_name='variant_id'`,
      );
      expect(rows[0].is_nullable).toBe("YES");
    } finally {
      client.release();
    }
  });

  it("order_status_history.from_status is nullable and CHECK allows NULL", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='order_status_history' AND column_name='from_status'`,
      );
      expect(rows[0].is_nullable).toBe("YES");

      const { rows: checks } = await client.query(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname='order_status_history_from_status_allowed'`,
      );
      expect(checks.length).toBe(1);
      expect(checks[0].def).toContain("IS NULL");
    } finally {
      client.release();
    }
  });

  it("wholesale_order.creation_request_hash exists", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order' AND column_name='creation_request_hash'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      client.release();
    }
  });

  it("creation history uses NULL→draft truthfully", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user_hist");
    const accountId = makeId("acc_hist");
    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Hist", storeName: "Hist Store", phone: "0912", city: "Tehran", status: "approved" });
    const orderId = makeId("wo_hist");
    await db.insert(wholesaleOrder).values({
      id: orderId,
      orderCode: `KV-W-${Date.now()}-HIST`,
      accountId,
      buyerUserId: userId,
      status: "draft",
      currency: "IRR",
      itemsTotal: 0n as any,
      shippingTotal: 0n as any,
      grandTotal: 0n as any,
      version: 0,
    });

    const histId = makeId("osh_hist");
    const [hist] = await db
      .insert(orderStatusHistory)
      .values({
        id: histId,
        orderId,
        childOrderId: null,
        fromStatus: null,
        toStatus: "draft",
        orderVersion: 0,
      })
      .returning();

    expect(hist.fromStatus).toBeNull();
    expect(hist.toStatus).toBe("draft");

    const childId = makeId("po_hist");
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeId = existingKolbe?.id;
    if (!existingKolbe) {
      const sid = makeId("seller_kolbe_hist");
      await db.insert(seller).values({ id: sid, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" });
      kolbeId = sid;
    }
    await db.insert(purchaseOrder).values({
      id: childId,
      orderCode: `KV-W-${Date.now()}-HIST-01`,
      sellerId: kolbeId!,
      supplierId: null,
      wholesaleOrderId: orderId,
      status: "pending",
      currency: "IRR",
      itemsTotal: 0n as any,
      grandTotal: 0n as any,
      shippingResponsibility: "KOLBE",
      version: 0,
    });

    const childHistId = makeId("osh_ch_hist");
    const [childHist] = await db
      .insert(orderStatusHistory)
      .values({
        id: childHistId,
        orderId: null,
        childOrderId: childId,
        fromStatus: null,
        toStatus: "pending",
        orderVersion: 0,
      })
      .returning();

    expect(childHist.fromStatus).toBeNull();
    expect(childHist.toStatus).toBe("pending");
  });

  it("no ON DELETE CASCADE for orders/history/events/request links", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT conname, confdeltype FROM pg_constraint WHERE contype='f' AND (conname LIKE 'wholesale_order_%' OR conname LIKE 'wholesale_order_request_%' OR conname LIKE 'order_%' OR conname LIKE 'purchase_order_%')`,
      );
      for (const row of rows) {
        expect(row.confdeltype, `${row.conname} should be RESTRICT not CASCADE`).not.toBe("c");
      }
    } finally {
      client.release();
    }
  });

  it("KOLBE child has NULL supplier_id, SUPPLIER child has NOT NULL supplier_id", async () => {
    const db = drizzle(pool, { schema });
    const supId = makeId("sup_kolbe_test");
    const sellerSupId = makeId("seller_sup_test");
    const userId = makeId("user_kolbe");
    const accountId = makeId("acc_kolbe");
    const orderId = makeId("wo_kolbe");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    await db.insert(supplier).values({ id: supId, legalName: "Sup", displayName: "Sup", status: "approved" });
    await db.insert(seller).values({ id: sellerSupId, type: "SUPPLIER", supplierId: supId, displayName: "Sup Seller", status: "active" });
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeId = existingKolbe?.id;
    if (!existingKolbe) {
      const sid = makeId("seller_kolbe_test");
      await db.insert(seller).values({ id: sid, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" });
      kolbeId = sid;
    }
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "K", storeName: "K Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(wholesaleOrder).values({
      id: orderId,
      orderCode: `KV-W-${Date.now()}-KOLBE`,
      accountId,
      buyerUserId: userId,
      status: "draft",
      currency: "IRR",
      itemsTotal: 0n as any,
      shippingTotal: 0n as any,
      grandTotal: 0n as any,
      version: 0,
    });

    const poKolbeId = makeId("po_kolbe");
    const [poKolbe] = await db
      .insert(purchaseOrder)
      .values({
        id: poKolbeId,
        orderCode: `KV-W-${Date.now()}-K-01`,
        sellerId: kolbeId!,
        supplierId: null,
        wholesaleOrderId: orderId,
        status: "pending",
        currency: "IRR",
        itemsTotal: 0n as any,
        grandTotal: 0n as any,
        shippingResponsibility: "KOLBE",
        version: 0,
      })
      .returning();
    expect(poKolbe.supplierId).toBeNull();

    const poSupId = makeId("po_sup");
    const [poSup] = await db
      .insert(purchaseOrder)
      .values({
        id: poSupId,
        orderCode: `KV-W-${Date.now()}-S-02`,
        sellerId: sellerSupId,
        supplierId: supId,
        wholesaleOrderId: orderId,
        status: "pending",
        currency: "IRR",
        itemsTotal: 0n as any,
        grandTotal: 0n as any,
        shippingResponsibility: "SUPPLIER",
        version: 0,
      })
      .returning();
    expect(poSup.supplierId).toBe(supId);
  });

  it("purchase_order_item nullable variant_id allows package lines", async () => {
    const db = drizzle(pool, { schema });
    const prodId = makeId("prod_pkg_child");
    const varId = makeId("var_pkg_child");
    const sellerId = makeId("seller_pkg_child");
    const userId = makeId("user_pkg_child");
    const accountId = makeId("acc_pkg_child");
    const orderId = makeId("wo_pkg_child");
    const poId = makeId("po_pkg_child");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    const [existingKolbeSeller] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let usedSellerId = existingKolbeSeller?.id;
    if (!existingKolbeSeller) {
      await db.insert(seller).values({ id: sellerId, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" });
      usedSellerId = sellerId;
    }
    await db.insert(product).values({ id: prodId, name: "Pkg Child Product", slug: `pkg-child-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    const offerIdPkg = makeId("offer_pkg_child");
    await db.insert(sellerOffer).values({ id: offerIdPkg, productId: prodId, sellerId: usedSellerId!, variantId: varId, sku: `OFFER-${offerIdPkg}`, status: "published", wholesalePrice: 1000n as any });
    const pkgIdDummy = makeId("pkg_dummy");
    await db.insert(wholesalePackage).values({ id: pkgIdDummy, offerId: offerIdPkg, packageType: "SIZE_RUN", name: "Dummy Package", totalPieces: 12 });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Pkg", storeName: "Pkg Store", phone: "0912", city: "Tehran", status: "approved" });
    await db.insert(wholesaleOrder).values({
      id: orderId,
      orderCode: `KV-W-${Date.now()}-PKGCHILD`,
      accountId,
      buyerUserId: userId,
      status: "draft",
      currency: "IRR",
      itemsTotal: 1000n as any,
      shippingTotal: 0n as any,
      grandTotal: 1000n as any,
      version: 0,
    });
    const woiId = makeId("woi_pkg_child");
    await db.insert(wholesaleOrderItem).values({
      id: woiId,
      orderId,
      productId: prodId,
      variantId: null,
      packageId: pkgIdDummy,
      productName: "Pkg Child",
      productNameSnapshot: "Pkg Child",
      sku: "PKG-SKU",
      quantity: 2,
      pieceQuantity: 12,
      unitPrice: 500n as any,
      lineTotal: 1000n as any,
      currency: "IRR",
      sellerId: usedSellerId!,
    });

    await db.insert(purchaseOrder).values({
      id: poId,
      orderCode: `KV-W-${Date.now()}-PKGCHILD-01`,
      sellerId: usedSellerId!,
      supplierId: null,
      wholesaleOrderId: orderId,
      status: "pending",
      currency: "IRR",
      itemsTotal: 1000n as any,
      grandTotal: 1000n as any,
      shippingResponsibility: "KOLBE",
      version: 0,
    });

    // Child item with NULL variant_id for package line should succeed now
    const poiId = makeId("poi_pkg_child");
    const [poi] = await db
      .insert(purchaseOrderItem)
      .values({
        id: poiId,
        purchaseOrderId: poId,
        wholesaleOrderItemId: woiId,
        productId: prodId,
        variantId: null,
        productName: "Pkg Child",
        quantity: 2,
        unitPrice: 500n as any,
        totalAmount: 1000n as any,
      })
      .returning();

    expect(poi.variantId).toBeNull();
  });

  it("wholesale_order_request request_id UNIQUE prevents double conversion", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user_req_unique");
    const accountId = makeId("acc_req_unique");
    const prodId = makeId("prod_req_unique");
    const varId = makeId("var_req_unique");
    const sellerId = makeId("seller_req_unique");
    const offerId = makeId("offer_req_unique");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    const supIdReq = makeId("sup_req_unique");
    await db.insert(supplier).values({ id: supIdReq, legalName: "Sup Req", displayName: "Sup Req", status: "approved" });
    await db.insert(seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supIdReq, displayName: "Sup Seller", status: "active" });
    await db.insert(product).values({ id: prodId, name: "Req Unique Product", slug: `req-unique-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 1000n as any });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "ReqUnique", storeName: "ReqUnique Store", phone: "0912", city: "Tehran", status: "approved" });

    const reqId = makeId("wreq_unique");
    const snapshot = {
      requestVersion: 0,
      productId: prodId,
      offerId,
      sellerId,
      supplierId: null,
      variantId: varId,
      packageId: null,
      quantity: 1,
      saleUnit: "PIECE",
      pricingUnit: "PIECE",
      pricingTierId: null,
      unitPrice: "1000",
      currency: "IRR",
      package: null,
      pieceQuantity: 1,
      lineTotal: "1000",
    };
    await db.insert(wholesaleRequest).values({
      id: reqId,
      productId: prodId,
      offerId,
      vipAccountId: accountId,
      variantId: varId,
      quantity: 1,
      status: "accepted",
      version: 1,
      acceptedTermsSnapshot: snapshot as any,
      acceptedTermsHash: "hash_unique",
      acceptedAt: new Date(),
      acceptedBy: userId,
    });

    const order1Id = makeId("wo_req_unique1");
    await db.insert(wholesaleOrder).values({
      id: order1Id,
      orderCode: `KV-W-${Date.now()}-REQUNIQ1`,
      accountId,
      buyerUserId: userId,
      status: "draft",
      currency: "IRR",
      itemsTotal: 1000n as any,
      shippingTotal: 0n as any,
      grandTotal: 1000n as any,
      version: 0,
    });

    await db.insert(wholesaleOrderRequest).values({
      id: makeId("wor_unique1"),
      orderId: order1Id,
      requestId: reqId,
      requestVersion: 1,
      acceptedTermsHash: "hash_unique",
    });

    const order2Id = makeId("wo_req_unique2");
    await db.insert(wholesaleOrder).values({
      id: order2Id,
      orderCode: `KV-W-${Date.now()}-REQUNIQ2`,
      accountId,
      buyerUserId: userId,
      status: "draft",
      currency: "IRR",
      itemsTotal: 1000n as any,
      shippingTotal: 0n as any,
      grandTotal: 1000n as any,
      version: 0,
    });

    let failed = false;
    try {
      await db.insert(wholesaleOrderRequest).values({
        id: makeId("wor_unique2"),
        orderId: order2Id,
        requestId: reqId,
        requestVersion: 1,
        acceptedTermsHash: "hash_unique",
      });
    } catch (e: any) {
      failed = true;
      const code = e?.code || e?.cause?.code;
      expect(code).toBe("23505");
    }
    expect(failed).toBe(true);
  });

  it("bigint totals and money checks", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname LIKE 'wholesale_order_%total%range' OR conname LIKE 'wholesale_order_item_%range'`,
      );
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });
});
