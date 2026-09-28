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
} from "../src/schema/tables";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "./helpers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/schema/tables";

const DB = "kolbe_phase42_test";
function makeId(prefix: string): string { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

describe("Phase 4.2 — Order foundation DB constraints", () => {
  let pool: Pool;
  beforeAll(async () => { ensurePostgres(); await recreateDatabase(DB); migrateOrFail(DB); const cs = urlFor(DB); pool = new Pool({ connectionString: cs }); }, 180_000);
  afterAll(async () => { await pool?.end(); await dropDatabase(DB); });

  it("wholesale_order has canonical columns", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order' ORDER BY column_name`);
      const cols = rows.map((r: any) => r.column_name);
      const required = ["id","order_code","account_id","buyer_user_id","originating_request_id","status","currency","items_total","shipping_total","grand_total","pricing_version","payment_mode","shipping_address_snapshot","billing_address_snapshot","idempotency_key","version","confirmed_at","cancelled_at","completed_at","cancellation_reason","cancelled_by","created_at","updated_at"];
      for (const col of required) { expect(cols, `missing ${col}`).toContain(col); }
    } finally { client.release(); }
  });

  it("wholesale_order_item has snapshot columns", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order_item' ORDER BY column_name`);
      const cols = rows.map((r: any) => r.column_name);
      const required = ["seller_id","supplier_id","package_id","pricing_tier_id","product_name_snapshot","variant_snapshot","seller_snapshot","package_type_snapshot","package_composition_snapshot","moq_unit_snapshot","pricing_unit","package_quantity","piece_quantity","line_total","currency"];
      for (const col of required) { expect(cols, `missing ${col}`).toContain(col); }
    } finally { client.release(); }
  });

  it("purchase_order supports KOLBE null supplier and supplier requires supplier", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user"); const accountId = makeId("acc"); const sellerKolbeId = makeId("seller_kolbe"); const sellerSupId = makeId("seller_sup"); const supId = makeId("sup"); const prodId = makeId("prod"); const varId = makeId("var"); const offerKolbeId = makeId("offer_kolbe"); const offerSupId = makeId("offer_sup");
    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "hash", salt: "salt", role: "customer" });
    await db.insert(supplier).values({ id: supId, legalName: "Test Supplier", displayName: "Test Supplier", status: "approved" });
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeSellerId = existingKolbe?.id || sellerKolbeId;
    if (!existingKolbe) { await db.insert(seller).values({ id: sellerKolbeId, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" }); } else { kolbeSellerId = existingKolbe.id; }
    await db.insert(seller).values({ id: sellerSupId, type: "SUPPLIER", supplierId: supId, displayName: "Supplier Seller", status: "active" });
    await db.insert(product).values({ id: prodId, name: "Test Product", slug: `test-prod-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerKolbeId, productId: prodId, sellerId: kolbeSellerId, variantId: varId, sku: `OFFER-${offerKolbeId}`, status: "published", wholesalePrice: 10000n as any });
    await db.insert(sellerOffer).values({ id: offerSupId, productId: prodId, sellerId: sellerSupId, variantId: varId, sku: `OFFER-${offerSupId}`, status: "published", wholesalePrice: 10000n as any });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Test", storeName: "Store", phone: "09120000000", city: "Tehran", status: "approved" });
    const orderId = makeId("wo");
    await db.insert(wholesaleOrder).values({ id: orderId, orderCode: `KV-W-${Date.now()}`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 10000n as any, shippingTotal: 0n as any, grandTotal: 10000n as any, version: 0 });
    const itemKolbeId = makeId("woi_kolbe");
    await db.insert(wholesaleOrderItem).values({ id: itemKolbeId, orderId, productId: prodId, variantId: varId, sellerOfferId: offerKolbeId, sellerId: kolbeSellerId, supplierId: null, productName: "Test Product", productNameSnapshot: "Test Product", sku: `SKU-${varId}`, quantity: 2, pieceQuantity: 2, unitPrice: 5000n as any, lineTotal: 10000n as any, currency: "IRR" });
    const itemSupId = makeId("woi_sup");
    await db.insert(wholesaleOrderItem).values({ id: itemSupId, orderId, productId: prodId, variantId: varId, sellerOfferId: offerSupId, sellerId: sellerSupId, supplierId: supId, productName: "Test Product", productNameSnapshot: "Test Product", sku: `SKU-${varId}`, quantity: 1, pieceQuantity: 1, unitPrice: 10000n as any, lineTotal: 10000n as any, currency: "IRR" });
    const childKolbeId = makeId("po_kolbe");
    await db.insert(purchaseOrder).values({ id: childKolbeId, orderCode: `KV-W-${Date.now()}-01`, sellerId: kolbeSellerId, supplierId: null, wholesaleOrderId: orderId, status: "pending", currency: "IRR", itemsTotal: 10000n as any, grandTotal: 10000n as any, shippingResponsibility: "KOLBE", version: 0 });
    const childSupId = makeId("po_sup");
    await db.insert(purchaseOrder).values({ id: childSupId, orderCode: `KV-W-${Date.now()}-02`, sellerId: sellerSupId, supplierId: supId, wholesaleOrderId: orderId, status: "pending", currency: "IRR", itemsTotal: 10000n as any, grandTotal: 10000n as any, shippingResponsibility: "SUPPLIER", version: 0 });
    const dupChildId = makeId("po_dup"); let dupFailed = false;
    try { await db.insert(purchaseOrder).values({ id: dupChildId, orderCode: `KV-W-${Date.now()}-03`, sellerId: kolbeSellerId, supplierId: null, wholesaleOrderId: orderId, status: "pending", currency: "IRR", itemsTotal: 0n as any, grandTotal: 0n as any, shippingResponsibility: "KOLBE", version: 0 }); } catch (e: any) { dupFailed = true; const code = e?.code || e?.cause?.code || e?.cause?.cause?.code; expect(code).toBe("23505"); } expect(dupFailed).toBe(true);
    const poiId = makeId("poi");
    await db.insert(purchaseOrderItem).values({ id: poiId, purchaseOrderId: childKolbeId, wholesaleOrderItemId: itemKolbeId, productId: prodId, variantId: varId, productName: "Test Product", quantity: 2, unitPrice: 5000n as any, totalAmount: 10000n as any });
    const poiDupId = makeId("poi_dup"); let poiDupFailed = false;
    try { await db.insert(purchaseOrderItem).values({ id: poiDupId, purchaseOrderId: childKolbeId, wholesaleOrderItemId: itemKolbeId, productId: prodId, variantId: varId, productName: "Test Product", quantity: 1, unitPrice: 5000n as any, totalAmount: 5000n as any }); } catch (e: any) { poiDupFailed = true; const code = e?.code || e?.cause?.code || e?.cause?.cause?.code; expect(code).toBe("23505"); } expect(poiDupFailed).toBe(true);
  });

  it("scoped idempotency (account_id, idempotency_key) prevents double order from retried request", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user2"); const accountId = makeId("acc2");
    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "hash", salt: "salt", role: "customer" });
    const [existingKolbe2] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    if (!existingKolbe2) { const sellerId = makeId("seller"); await db.insert(seller).values({ id: sellerId, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" }); }
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Test", storeName: "Store", phone: "09120000000", city: "Tehran", status: "approved" });
    const orderId1 = makeId("wo1"); const idemKey = `idem_${Date.now()}`;
    await db.insert(wholesaleOrder).values({ id: orderId1, orderCode: `KV-W-${Date.now()}-10`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 0n as any, shippingTotal: 0n as any, grandTotal: 0n as any, idempotencyKey: idemKey, version: 0 });
    const orderId2 = makeId("wo2"); let failed = false;
    try { await db.insert(wholesaleOrder).values({ id: orderId2, orderCode: `KV-W-${Date.now()}-11`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 0n as any, shippingTotal: 0n as any, grandTotal: 0n as any, idempotencyKey: idemKey, version: 0 }); } catch (e: any) { failed = true; const code = e?.code || e?.cause?.code || e?.cause?.cause?.code; expect(code).toBe("23505"); } expect(failed).toBe(true);
    const userId3 = makeId("user3"); const accountId3 = makeId("acc3");
    await db.insert(accountUser).values({ id: userId3, email: `${userId3}@test.com`, passwordHash: "hash", salt: "salt", role: "customer" });
    await db.insert(wholesaleAccount).values({ id: accountId3, userId: userId3, memberName: "Test3", storeName: "Store3", phone: "09120000000", city: "Tehran", status: "approved" });
    const orderId3 = makeId("wo3");
    await db.insert(wholesaleOrder).values({ id: orderId3, orderCode: `KV-W-${Date.now()}-12`, accountId: accountId3, buyerUserId: userId3, status: "draft", currency: "IRR", itemsTotal: 0n as any, shippingTotal: 0n as any, grandTotal: 0n as any, idempotencyKey: idemKey, version: 0 });
    await db.delete(wholesaleOrder).where(eq(wholesaleOrder.id, orderId1));
    await db.delete(wholesaleOrder).where(eq(wholesaleOrder.id, orderId3));
  });

  it("order_status_history is append-only and requires exactly one FK", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='order_status_history_append_only'`);
      expect(rows.length).toBe(1);
      const { rows: checks } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='order_status_history_exactly_one_order_fk'`);
      expect(checks.length).toBe(1);
    } finally { client.release(); }
  });

  it("order_event has idempotency unique and append-only trigger", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='order_event_append_only'`);
      expect(rows.length).toBe(1);
      const { rows: idx } = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname='order_event_aggregate_idempotency_unique'`);
      expect(idx.length).toBe(1);
    } finally { client.release(); }
  });

  it("no ON DELETE CASCADE for orders/history/events", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT conname, confdeltype FROM pg_constraint WHERE contype='f' AND conname LIKE 'order_%'`);
      for (const row of rows) { expect(row.confdeltype, `${row.conname} should be RESTRICT`).not.toBe("c"); }
    } finally { client.release(); }
  });

  it("order_code immutability: wholesale_order and purchase_order triggers", async () => {
    const client = await pool.connect();
    try {
      const { rows: woTrigger } = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='wholesale_order_code_immutable'`);
      expect(woTrigger.length, "wholesale_order_code_immutable trigger should exist").toBe(1);
      const { rows: poTrigger } = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='purchase_order_code_immutable'`);
      expect(poTrigger.length, "purchase_order_code_immutable trigger should exist").toBe(1);
    } finally { client.release(); }
    const db = drizzle(pool, { schema });
    const userId = makeId("user_immut"); const accountId = makeId("acc_immut");
    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "hash", salt: "salt", role: "customer" });
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeSellerId = existingKolbe?.id;
    if (!existingKolbe) { const sid = makeId("seller_kolbe_immut"); await db.insert(seller).values({ id: sid, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" }); kolbeSellerId = sid; }
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Test", storeName: "Store", phone: "09120000000", city: "Tehran", status: "approved" });
    const orderId = makeId("wo_immut"); const originalCode = `KV-W-${Date.now()}-IMMUT`;
    await db.insert(wholesaleOrder).values({ id: orderId, orderCode: originalCode, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 0n as any, shippingTotal: 0n as any, grandTotal: 0n as any, version: 0 });
    let mutationFailed = false;
    try { await db.update(wholesaleOrder).set({ orderCode: `KV-W-${Date.now()}-MUTATED` }).where(eq(wholesaleOrder.id, orderId)); } catch (e: any) { mutationFailed = true; const full = `${e?.message || ""} ${e?.cause?.message || ""} ${e?.cause?.cause?.message || ""} ${e?.cause?.cause?.cause?.message || ""} ${JSON.stringify(e?.cause || {})}`; expect(full.toLowerCase()).toContain("immutable"); }
    expect(mutationFailed, "wholesale_order.order_code mutation should be rejected").toBe(true);
    const [orderAfter] = await db.select().from(wholesaleOrder).where(eq(wholesaleOrder.id, orderId)).limit(1);
    expect(orderAfter.orderCode).toBe(originalCode);
    const childId = makeId("po_immut"); const childOriginalCode = `KV-W-${Date.now()}-01-IMMUT`;
    await db.insert(purchaseOrder).values({ id: childId, orderCode: childOriginalCode, sellerId: kolbeSellerId!, supplierId: null, wholesaleOrderId: orderId, status: "pending", currency: "IRR", itemsTotal: 0n as any, grandTotal: 0n as any, shippingResponsibility: "KOLBE", version: 0 });
    let childMutationFailed = false;
    try { await db.update(purchaseOrder).set({ orderCode: `KV-W-${Date.now()}-01-MUT` }).where(eq(purchaseOrder.id, childId)); } catch (e: any) { childMutationFailed = true; const full = `${e?.message || ""} ${e?.cause?.message || ""} ${e?.cause?.cause?.message || ""} ${e?.cause?.cause?.cause?.message || ""} ${JSON.stringify(e?.cause || {})}`; expect(full.toLowerCase()).toContain("immutable"); }
    expect(childMutationFailed, "purchase_order.order_code mutation should be rejected").toBe(true);
    const [childAfter] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, childId)).limit(1);
    expect(childAfter.orderCode).toBe(childOriginalCode);
  });

  it("snapshot immutability: persisted snapshots unchanged after live source mutations", async () => {
    const db = drizzle(pool, { schema });
    const prodId = makeId("prod_snap"); const varId = makeId("var_snap"); const sellerId = makeId("seller_snap"); const supId = makeId("sup_snap"); const packageId = makeId("pkg_snap"); const userId = makeId("user_snap"); const accountId = makeId("acc_snap"); const offerId = makeId("offer_snap");
    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "hash", salt: "salt", role: "customer" });
    await db.insert(supplier).values({ id: supId, legalName: "Snap Supplier", displayName: "Snap Supplier Original", status: "approved" });
    await db.insert(seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Original Seller Display", status: "active" });
    await db.insert(product).values({ id: prodId, name: "Original Product Name", slug: `snap-prod-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SNAP-SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 50000n as any });
    await db.insert(wholesalePackage).values({ id: packageId, offerId, packageType: "SIZE_RUN", name: "Original Full Series", totalPieces: 2 });
    await db.insert(wholesalePackageItem).values({ id: makeId("pkg_item"), packageId, variantId: varId, quantity: 2 });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Snap Test", storeName: "Snap Store", phone: "09120000000", city: "Tehran", status: "approved" });
    const orderId = makeId("wo_snap");
    await db.insert(wholesaleOrder).values({ id: orderId, orderCode: `KV-W-${Date.now()}-SNAP`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 100000n as any, shippingTotal: 0n as any, grandTotal: 100000n as any, version: 0 });
    const itemId = makeId("woi_snap");
    const originalSnapshots = { productNameSnapshot: "Original Product Name", skuSnapshot: `SNAP-SKU-${varId}`, variantSnapshot: { color: "red", size: "M", original: true }, sellerSnapshot: { displayName: "Original Seller Display", type: "SUPPLIER" }, packageTypeSnapshot: "SIZE_RUN", packageNameSnapshot: "Original Full Series", packageCompositionSnapshot: [{ variantId: varId, quantity: 2, name: "M" }], moqUnitSnapshot: "PACKAGE", pricingUnit: "PACKAGE", unitPrice: 50000n, pieceQuantity: 2, packageQuantity: 1, lineTotal: 50000n, currency: "IRR" };
    // Phase 4.2.2 — selector: one commercial line = PACKAGE, not six variant lines. So variantId null, packageId present.
    await db.insert(wholesaleOrderItem).values({ id: itemId, orderId, productId: prodId, variantId: null, sellerOfferId: offerId, sellerId, supplierId: supId, packageId, pricingTierId: null, productName: "Original Product Name", productNameSnapshot: originalSnapshots.productNameSnapshot, sku: originalSnapshots.skuSnapshot, skuSnapshot: originalSnapshots.skuSnapshot, variantSnapshot: originalSnapshots.variantSnapshot as any, sellerSnapshot: originalSnapshots.sellerSnapshot as any, packageTypeSnapshot: originalSnapshots.packageTypeSnapshot as any, packageNameSnapshot: originalSnapshots.packageNameSnapshot, packageCompositionSnapshot: originalSnapshots.packageCompositionSnapshot as any, moqUnitSnapshot: originalSnapshots.moqUnitSnapshot as any, pricingUnit: originalSnapshots.pricingUnit as any, quantity: 1, packageQuantity: originalSnapshots.packageQuantity, pieceQuantity: originalSnapshots.pieceQuantity, unitPrice: originalSnapshots.unitPrice as any, lineTotal: originalSnapshots.lineTotal as any, currency: originalSnapshots.currency });
    await db.update(product).set({ name: "Mutated Product Name" }).where(eq(product.id, prodId));
    await db.update(productVariant).set({ sku: `MUTATED-SKU-${varId}` }).where(eq(productVariant.id, varId));
    await db.update(seller).set({ displayName: "Mutated Seller Display" }).where(eq(seller.id, sellerId));
    await db.update(supplier).set({ displayName: "Mutated Supplier Display" }).where(eq(supplier.id, supId));
    await db.update(wholesalePackage).set({ name: "Mutated Half Series" }).where(eq(wholesalePackage.id, packageId));
    await db.update(sellerOffer).set({ wholesalePrice: 99999n as any }).where(eq(sellerOffer.id, offerId));
    const [storedItem] = await db.select().from(wholesaleOrderItem).where(eq(wholesaleOrderItem.id, itemId)).limit(1);
    expect(storedItem.productNameSnapshot).toBe(originalSnapshots.productNameSnapshot);
    expect(storedItem.skuSnapshot).toBe(originalSnapshots.skuSnapshot);
    expect(storedItem.variantSnapshot).toEqual(originalSnapshots.variantSnapshot);
    expect(storedItem.sellerSnapshot).toEqual(originalSnapshots.sellerSnapshot);
    expect(storedItem.packageTypeSnapshot).toBe(originalSnapshots.packageTypeSnapshot);
    expect(storedItem.packageNameSnapshot).toBe(originalSnapshots.packageNameSnapshot);
    expect(storedItem.packageCompositionSnapshot).toEqual(originalSnapshots.packageCompositionSnapshot);
    expect(storedItem.unitPrice.toString()).toBe(originalSnapshots.unitPrice.toString());
    expect(storedItem.pieceQuantity).toBe(originalSnapshots.pieceQuantity);
    expect(storedItem.packageQuantity).toBe(originalSnapshots.packageQuantity);
    expect(storedItem.lineTotal.toString()).toBe(originalSnapshots.lineTotal.toString());
    expect(storedItem.currency).toBe(originalSnapshots.currency);
    const [liveProduct] = await db.select().from(product).where(eq(product.id, prodId)).limit(1);
    expect(liveProduct.name).toBe("Mutated Product Name");
    expect(liveProduct.name).not.toBe(storedItem.productNameSnapshot);
  });

  it("migration semantics: legacy fulfilled handling is pre-launch dev-only, no fulfilled remains", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT status, COUNT(*) as count FROM wholesale_order WHERE status IN ('pending','approved','fulfilling','fulfilled') GROUP BY status`);
      expect(rows.length, "No legacy wholesale_order statuses should remain after migrations").toBe(0);
      const { rows: checkRows } = await client.query(`SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conname='wholesale_order_status_allowed'`);
      expect(checkRows.length).toBe(1);
      const def = checkRows[0].def as string;
      expect(def).toContain("draft");
      expect(def).toContain("completed");
      expect(def).not.toContain("fulfilled");
      expect(def).not.toContain("pending");
    } finally { client.release(); }
  });

  it("order code uniqueness and immutability mechanism documented", async () => {
    const client = await pool.connect();
    try {
      const { rows: woIdx } = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='wholesale_order' AND indexname LIKE '%order_code%unique%'`);
      expect(woIdx.length, "wholesale_order order_code unique index should exist").toBeGreaterThanOrEqual(1);
      const { rows: poIdx } = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='purchase_order' AND indexname LIKE '%order_code%unique%'`);
      expect(poIdx.length, "purchase_order order_code unique index should exist").toBeGreaterThanOrEqual(1);
      const { rows: woCols } = await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='wholesale_order' AND column_name='order_code'`);
      expect(woCols[0].is_nullable).toBe("NO");
      const { rows: poCols } = await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='purchase_order' AND column_name='order_code'`);
      expect(poCols[0].is_nullable).toBe("NO");
    } finally { client.release(); }
  });
});
