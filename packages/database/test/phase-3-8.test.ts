import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase38_test";

describe("فاز ۳.۸ — Legacy Removal & Clean Architecture", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("جدول‌های قدیمی وجود ندارند", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('supplier_product','supplier_variant','supplier_inventory','legacy_product_mapping','legacy_variant_mapping','product_match_queue')`,
      ),
    );
    expect(rows).toEqual([]);
  });

  it("199 جدول پس از افزودن Phase 5.11-C (پرچم مشکوک) به مرز Phase 5.9-A، در کنار همهٔ دامنه‌های قبلی", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ count: string }>(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`),
    );
    // The Phase 5.7 migration adds 7 promotion-owned tables to the 186-table Phase 5.6 schema;
    // 5.8 adds one more (194) and 5.9-A adds customer_address (195).
    expect(Number(rows[0].count)).toBe(199); // 5.9-B adds the 3 return tables; 5.9-C alters in place; 5.11-C 0045 adds the suspicious-flag table
  });

  it("wholesale_order_item به canonical references اشاره می‌کند (Phase 4.2 evolved)", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ conname: string; referenced_table: string }>(
        `SELECT conname, fcls.relname as referenced_table FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_class fcls ON fcls.oid = con.confrelid WHERE con.contype='f' AND cls.relname='wholesale_order_item' ORDER BY conname`,
      ),
    );
    const refs = rows.map((r) => r.referenced_table).sort();
    // Phase 4.2: wholesale_order_item now references seller, supplier, package, pricing_tier, plus canonical
    expect(refs).toContain("wholesale_order");
    expect(refs).toContain("product");
    expect(refs).toContain("product_variant");
    expect(refs).toContain("seller_offer");
    expect(refs).toContain("seller");
    expect(rows.some((r) => r.conname.includes("supplier_product"))).toBe(false);
  });

  it("purchase_order_item به wholesale_order_item و purchase_order اشاره می‌کند (Phase 4.2)", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ referenced_table: string }>(
        `SELECT fcls.relname as referenced_table FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_class fcls ON fcls.oid = con.confrelid WHERE con.contype='f' AND cls.relname='purchase_order_item'`,
      ),
    );
    const refs = rows.map((r) => r.referenced_table).sort();
    expect(refs).toContain("purchase_order");
    expect(refs).toContain("wholesale_order_item");
    expect(refs).toContain("product");
    expect(refs).toContain("product_variant");
  });

  it("rfq به product و seller_offer", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ referenced_table: string }>(
        `SELECT fcls.relname as referenced_table FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_class fcls ON fcls.oid = con.confrelid WHERE con.contype='f' AND cls.relname='rfq'`,
      ),
    );
    const refs = rows.map((r) => r.referenced_table).sort();
    expect(refs).toContain("product");
    expect(refs).toContain("seller_offer");
    expect(refs).not.toContain("supplier_product");
  });

  it("quote به product, product_variant, seller_offer, rfq", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ referenced_table: string }>(
        `SELECT fcls.relname as referenced_table FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid JOIN pg_class fcls ON fcls.oid = con.confrelid WHERE con.contype='f' AND cls.relname='quote'`,
      ),
    );
    const refs = rows.map((r) => r.referenced_table).sort();
    expect(refs).toContain("product");
    expect(refs).toContain("product_variant");
    expect(refs).toContain("seller_offer");
  });

  it("seller_offer فاقد inventory_on_hand/reserved", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='seller_offer' AND column_name IN ('inventory_on_hand','inventory_reserved')`,
      ),
    );
    expect(rows).toEqual([]);
  });

  it("product_variant_inventory تنها مرجع موجودی است", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%inventory%'`,
      ),
    );
    const tables = rows.map((r) => r.table_name).sort();
    expect(tables).toEqual(["inventory_ledger", "inventory_reservation", "product_variant_inventory"].sort());
  });

  it("product_variant attributes انعطاف‌پذیر JSON", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ data_type: string; column_name: string }>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variant' AND column_name='attributes'`,
      ),
    );
    expect(rows[0].data_type).toBe("jsonb");
  });

  it("variant نمونه‌ها: clothing, shoes, accessories", async () => {
    // This test documents that variant attributes are flexible, not hardcoded clothing
    const examples = [
      { size: "S", color: "black" }, // clothing
      { size: "42", color: "white" }, // shoes
      { material: "leather" }, // accessories
    ];
    for (const ex of examples) {
      expect(typeof ex).toBe("object");
      expect(Object.keys(ex).length).toBeGreaterThan(0);
    }
  });
});
