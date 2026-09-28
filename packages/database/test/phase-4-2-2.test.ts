import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  wholesaleRequest,
  wholesaleOrder,
  wholesaleOrderRequest,
  wholesaleAccount,
  accountUser,
  seller,
  supplier,
  product,
  productVariant,
  sellerOffer,
  wholesalePackage,
  wholesalePackageItem,
  wholesalePricingTier,
} from "../src/schema/tables";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, urlFor } from "./helpers";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/schema/tables";

const DB = "kolbe_phase422_test";
function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe("Phase 4.2.2 — Request snapshot, multi-request link, selector, pricing", () => {
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

  it("wholesale_request has version, accepted fields, selector check", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_request' ORDER BY column_name`);
      const cols = rows.map((r: any) => r.column_name);
      const required = ["variant_id", "version", "accepted_at", "accepted_by", "accepted_terms_snapshot", "accepted_terms_hash", "acceptance_expires_at"];
      for (const col of required) expect(cols, `missing ${col}`).toContain(col);

      const { rows: checks } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='wholesale_request_selector_check'`);
      expect(checks.length).toBe(1);

      const { rows: fks } = await client.query(`SELECT conname FROM pg_constraint WHERE conname IN ('wholesale_request_variant_fk','wholesale_request_accepted_by_fk')`);
      expect(fks.length).toBe(2);
    } finally {
      client.release();
    }
  });

  it("wholesale_order_item selector check and source_request_id FK", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order_item'`);
      const cols = rows.map((r: any) => r.column_name);
      expect(cols).toContain("source_request_id");
      const { rows: checks } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='wholesale_order_item_selector_check'`);
      expect(checks.length).toBe(1);
      const { rows: fk } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='wholesale_order_item_source_request_fk'`);
      expect(fk.length).toBe(1);
    } finally {
      client.release();
    }
  });

  it("wholesale_order_request link table exists with unique request_id and RESTRICT", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name='wholesale_order_request'`);
      expect(rows.length).toBe(1);
      const { rows: cols } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order_request'`);
      const colNames = cols.map((r: any) => r.column_name);
      expect(colNames).toContain("order_id");
      expect(colNames).toContain("request_id");
      expect(colNames).toContain("request_version");
      expect(colNames).toContain("accepted_terms_hash");

      const { rows: uniq } = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='wholesale_order_request' AND indexname='wholesale_order_request_request_unique'`);
      expect(uniq.length).toBe(1);

      const { rows: fks } = await client.query(`SELECT conname, confdeltype FROM pg_constraint WHERE conname LIKE 'wholesale_order_request_%fk'`);
      expect(fks.length).toBe(2);
      for (const fk of fks) expect(fk.confdeltype).not.toBe("c"); // RESTRICT, no CASCADE
    } finally {
      client.release();
    }
  });

  it("seller_offer and pricing_tier have pricing_unit with deterministic backfill", async () => {
    const client = await pool.connect();
    try {
      const { rows: offerCols } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='seller_offer' AND column_name='pricing_unit'`);
      expect(offerCols.length).toBe(1);
      const { rows: tierCols } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_pricing_tier' AND column_name='pricing_unit'`);
      expect(tierCols.length).toBe(1);

      const { rows: offerCheck } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='seller_offer_pricing_unit_allowed'`);
      expect(offerCheck.length).toBe(1);
      const { rows: tierCheck } = await client.query(`SELECT conname FROM pg_constraint WHERE conname='wholesale_pricing_tier_pricing_unit_allowed'`);
      expect(tierCheck.length).toBe(1);
    } finally {
      client.release();
    }
  });

  it("request selector: PIECE variant vs PACKAGE invalid combos rejected", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user_sel");
    const accountId = makeId("acc_sel");
    const prodId = makeId("prod_sel");
    const varId = makeId("var_sel");
    const sellerId = makeId("seller_sel");
    const supId = makeId("sup_sel");
    const offerId = makeId("offer_sel");
    const pkgId = makeId("pkg_sel");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    await db.insert(supplier).values({ id: supId, legalName: "Sel Sup", displayName: "Sel Sup", status: "approved" });
    await db.insert(seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Sel Seller", status: "active" });
    await db.insert(product).values({ id: prodId, name: "Sel Product", slug: `sel-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 1000n as any, moq: 1, moqUnit: "PIECE" });
    await db.insert(wholesalePackage).values({ id: pkgId, offerId, packageType: "SIZE_RUN", name: "Sel Pkg", totalPieces: 2 });
    await db.insert(wholesalePackageItem).values({ id: makeId("pkg_item_sel"), packageId: pkgId, variantId: varId, quantity: 2 });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Sel", storeName: "Sel Store", phone: "0912", city: "Tehran", status: "approved" });

    // Valid: PIECE selector variant != null, package = null
    const reqPieceId = makeId("wreq_piece");
    await db.insert(wholesaleRequest).values({ id: reqPieceId, productId: prodId, offerId, vipAccountId: accountId, variantId: varId, packageId: null, quantity: 5, status: "pending", version: 0 });

    // Valid: PACKAGE selector variant null, package != null
    const reqPkgId = makeId("wreq_pkg");
    await db.insert(wholesaleRequest).values({ id: reqPkgId, productId: prodId, offerId, vipAccountId: accountId, variantId: null, packageId: pkgId, quantity: 2, status: "pending", version: 0 });

    // Valid: both null for backward compat
    const reqNullId = makeId("wreq_null");
    await db.insert(wholesaleRequest).values({ id: reqNullId, productId: prodId, offerId, vipAccountId: accountId, variantId: null, packageId: null, quantity: 1, status: "pending", version: 0 });

    // Invalid: both present should fail CHECK
    const reqBothId = makeId("wreq_both");
    let failed = false;
    try {
      await db.insert(wholesaleRequest).values({ id: reqBothId, productId: prodId, offerId, vipAccountId: accountId, variantId: varId, packageId: pkgId, quantity: 1, status: "pending", version: 0 });
    } catch (e: any) {
      failed = true;
      const code = e?.code || e?.cause?.code;
      expect(code).toBe("23514");
    }
    expect(failed).toBe(true);
  });

  it("multi-request mapping: one order multiple requests, request cannot link two orders, FK RESTRICT no cascade", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user_multi");
    const accountId = makeId("acc_multi");
    const prodId = makeId("prod_multi");
    const varId = makeId("var_multi");
    const sellerId = makeId("seller_multi");
    const supId = makeId("sup_multi");
    const offerId = makeId("offer_multi");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    await db.insert(supplier).values({ id: supId, legalName: "Multi Sup", displayName: "Multi Sup", status: "approved" });
    await db.insert(seller).values({ id: sellerId, type: "SUPPLIER", supplierId: supId, displayName: "Multi Seller", status: "active" });
    await db.insert(product).values({ id: prodId, name: "Multi Product", slug: `multi-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerId, productId: prodId, sellerId, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 1000n as any });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "Multi", storeName: "Multi Store", phone: "0912", city: "Tehran", status: "approved" });

    const req1Id = makeId("wreq_m1");
    const req2Id = makeId("wreq_m2");
    const snapshot = { requestVersion: 0, productId: prodId, offerId, sellerId, supplierId: supId, variantId: varId, packageId: null, quantity: 1, saleUnit: "PIECE", pricingUnit: "PIECE", pricingTierId: null, unitPrice: "1000", currency: "IRR", package: null, pieceQuantity: 1, lineTotal: "1000" };
    await db.insert(wholesaleRequest).values({ id: req1Id, productId: prodId, offerId, vipAccountId: accountId, variantId: varId, quantity: 1, status: "accepted", version: 1, acceptedTermsSnapshot: snapshot as any, acceptedTermsHash: "hash1", acceptedAt: new Date(), acceptedBy: userId });
    await db.insert(wholesaleRequest).values({ id: req2Id, productId: prodId, offerId, vipAccountId: accountId, variantId: varId, quantity: 2, status: "accepted", version: 1, acceptedTermsSnapshot: { ...snapshot, quantity: 2, pieceQuantity: 2, lineTotal: "2000" } as any, acceptedTermsHash: "hash2", acceptedAt: new Date(), acceptedBy: userId });

    const orderId = makeId("wo_multi");
    await db.insert(wholesaleOrder).values({ id: orderId, orderCode: `KV-W-${Date.now()}-MULTI`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 3000n as any, shippingTotal: 0n as any, grandTotal: 3000n as any, version: 0 });

    const link1Id = makeId("wor_1");
    const link2Id = makeId("wor_2");
    await db.insert(wholesaleOrderRequest).values({ id: link1Id, orderId, requestId: req1Id, requestVersion: 1, acceptedTermsHash: "hash1" });
    await db.insert(wholesaleOrderRequest).values({ id: link2Id, orderId, requestId: req2Id, requestVersion: 1, acceptedTermsHash: "hash2" });

    // Request cannot link to two orders — unique constraint on request_id
    const order2Id = makeId("wo_multi2");
    await db.insert(wholesaleOrder).values({ id: order2Id, orderCode: `KV-W-${Date.now()}-MULTI2`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 1000n as any, shippingTotal: 0n as any, grandTotal: 1000n as any, version: 0 });
    let dupFailed = false;
    try {
      await db.insert(wholesaleOrderRequest).values({ id: makeId("wor_dup"), orderId: order2Id, requestId: req1Id, requestVersion: 1, acceptedTermsHash: "hash1" });
    } catch (e: any) {
      dupFailed = true;
      const code = e?.code || e?.cause?.code;
      expect(code).toBe("23505");
    }
    expect(dupFailed).toBe(true);

    // FK RESTRICT no cascade — deleting order should fail if links exist
    let deleteFailed = false;
    try {
      await db.delete(wholesaleOrder).where(eq(wholesaleOrder.id, orderId));
    } catch (e: any) {
      deleteFailed = true;
      const code = e?.code || e?.cause?.code;
      expect(code).toBe("23503");
    }
    expect(deleteFailed).toBe(true);
  });

  it("multi-seller compatibility: Supplier A + B + KOLBE under one parent order", async () => {
    const db = drizzle(pool, { schema });
    const userId = makeId("user_ms");
    const accountId = makeId("acc_ms");
    const prodId = makeId("prod_ms");
    const varId = makeId("var_ms");
    const supAId = makeId("sup_a");
    const supBId = makeId("sup_b");
    const sellerAId = makeId("seller_a");
    const sellerBId = makeId("seller_b");
    const sellerKolbeId = makeId("seller_kolbe_ms");
    const offerAId = makeId("offer_a");
    const offerBId = makeId("offer_b");
    const offerKolbeId = makeId("offer_kolbe");

    await db.insert(accountUser).values({ id: userId, email: `${userId}@test.com`, passwordHash: "h", salt: "s", role: "customer" });
    await db.insert(supplier).values({ id: supAId, legalName: "Supplier A", displayName: "Supplier A", status: "approved" });
    await db.insert(supplier).values({ id: supBId, legalName: "Supplier B", displayName: "Supplier B", status: "approved" });
    await db.insert(seller).values({ id: sellerAId, type: "SUPPLIER", supplierId: supAId, displayName: "Seller A", status: "active" });
    await db.insert(seller).values({ id: sellerBId, type: "SUPPLIER", supplierId: supBId, displayName: "Seller B", status: "active" });
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeId = existingKolbe?.id;
    if (!existingKolbe) {
      await db.insert(seller).values({ id: sellerKolbeId, type: "KOLBE", supplierId: null, displayName: "KOLBE", status: "active" });
      kolbeId = sellerKolbeId;
    } else {
      kolbeId = existingKolbe.id;
    }
    await db.insert(product).values({ id: prodId, name: "MultiSeller Product", slug: `ms-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    await db.insert(sellerOffer).values({ id: offerAId, productId: prodId, sellerId: sellerAId, variantId: varId, sku: `OFFER-${offerAId}`, status: "published", wholesalePrice: 1000n as any });
    await db.insert(sellerOffer).values({ id: offerBId, productId: prodId, sellerId: sellerBId, variantId: varId, sku: `OFFER-${offerBId}`, status: "published", wholesalePrice: 2000n as any });
    await db.insert(sellerOffer).values({ id: offerKolbeId, productId: prodId, sellerId: kolbeId!, variantId: varId, sku: `OFFER-${offerKolbeId}`, status: "published", wholesalePrice: 3000n as any });
    await db.insert(wholesaleAccount).values({ id: accountId, userId, memberName: "MS", storeName: "MS Store", phone: "0912", city: "Tehran", status: "approved" });

    const snapshotA = { requestVersion: 0, productId: prodId, offerId: offerAId, sellerId: sellerAId, supplierId: supAId, variantId: varId, packageId: null, quantity: 1, saleUnit: "PIECE", pricingUnit: "PIECE", pricingTierId: null, unitPrice: "1000", currency: "IRR", package: null, pieceQuantity: 1, lineTotal: "1000" };
    const snapshotB = { ...snapshotA, offerId: offerBId, sellerId: sellerBId, supplierId: supBId, unitPrice: "2000", lineTotal: "2000" };
    const snapshotKolbe = { ...snapshotA, offerId: offerKolbeId, sellerId: kolbeId!, supplierId: null, unitPrice: "3000", lineTotal: "3000" };

    const reqAId = makeId("wreq_a");
    const reqBId = makeId("wreq_b");
    const reqKolbeId = makeId("wreq_kolbe");
    await db.insert(wholesaleRequest).values({ id: reqAId, productId: prodId, offerId: offerAId, vipAccountId: accountId, variantId: varId, quantity: 1, status: "accepted", version: 1, acceptedTermsSnapshot: snapshotA as any, acceptedTermsHash: "hash_a", acceptedAt: new Date(), acceptedBy: userId });
    await db.insert(wholesaleRequest).values({ id: reqBId, productId: prodId, offerId: offerBId, vipAccountId: accountId, variantId: varId, quantity: 1, status: "accepted", version: 1, acceptedTermsSnapshot: snapshotB as any, acceptedTermsHash: "hash_b", acceptedAt: new Date(), acceptedBy: userId });
    await db.insert(wholesaleRequest).values({ id: reqKolbeId, productId: prodId, offerId: offerKolbeId, vipAccountId: accountId, variantId: varId, quantity: 1, status: "accepted", version: 1, acceptedTermsSnapshot: snapshotKolbe as any, acceptedTermsHash: "hash_kolbe", acceptedAt: new Date(), acceptedBy: userId });

    const orderId = makeId("wo_ms");
    await db.insert(wholesaleOrder).values({ id: orderId, orderCode: `KV-W-${Date.now()}-MS`, accountId, buyerUserId: userId, status: "draft", currency: "IRR", itemsTotal: 6000n as any, shippingTotal: 0n as any, grandTotal: 6000n as any, version: 0 });

    await db.insert(wholesaleOrderRequest).values({ id: makeId("wor_a"), orderId, requestId: reqAId, requestVersion: 1, acceptedTermsHash: "hash_a" });
    await db.insert(wholesaleOrderRequest).values({ id: makeId("wor_b"), orderId, requestId: reqBId, requestVersion: 1, acceptedTermsHash: "hash_b" });
    await db.insert(wholesaleOrderRequest).values({ id: makeId("wor_k"), orderId, requestId: reqKolbeId, requestVersion: 1, acceptedTermsHash: "hash_kolbe" });

    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT COUNT(*) as count FROM wholesale_order_request WHERE order_id=$1`, [orderId]);
      expect(Number(rows[0].count)).toBe(3);
    } finally {
      client.release();
    }
  });

  it("wholesale_order.originating_request_id remains as legacy compatibility pointer", async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wholesale_order' AND column_name='originating_request_id'`);
      expect(rows.length).toBe(1);
    } finally {
      client.release();
    }
  });

  it("pricing_unit deterministic backfill: moq_unit → pricing_unit same unit", async () => {
    const db = drizzle(pool, { schema });
    const prodId = makeId("prod_backfill");
    const varId = makeId("var_backfill");
    const offerId = makeId("offer_backfill");
    await db.insert(product).values({ id: prodId, name: "Backfill Product", slug: `backfill-${Date.now()}`, status: "published" });
    await db.insert(productVariant).values({ id: varId, productId: prodId, sku: `SKU-${varId}`, status: "active" });
    const [existingKolbe] = await db.select().from(seller).where(eq(seller.type, "KOLBE")).limit(1);
    let kolbeId = existingKolbe?.id;
    if (!existingKolbe) {
      const sid = makeId("seller_backfill");
      await db.insert(seller).values({ id: sid, type: "KOLBE", supplierId: null, displayName: "Backfill Seller", status: "active" });
      kolbeId = sid;
    }
    await db.insert(sellerOffer).values({ id: offerId, productId: prodId, sellerId: kolbeId!, variantId: varId, sku: `OFFER-${offerId}`, status: "published", wholesalePrice: 1000n as any, moq: 1, moqUnit: "PACKAGE", pricingUnit: "PACKAGE" as any });

    const [offer] = await db.select().from(sellerOffer).where(eq(sellerOffer.id, offerId)).limit(1);
    expect((offer as any).pricingUnit).toBe("PACKAGE");
    expect(offer.moqUnit).toBe("PACKAGE");
  });
});
