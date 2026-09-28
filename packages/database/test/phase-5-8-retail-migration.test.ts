import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_8_retail_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r58_user', 'r58@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(`INSERT INTO product (id, sku, name, slug, owner_type, status) VALUES ('r58_prod', 'R58-SKU', 'R58 product', 'r58-product', 'KOLBE', 'published')`);
    await client.query(`INSERT INTO product_variant (id, product_id, sku, status) VALUES ('r58_var', 'r58_prod', 'R58-VAR', 'active')`);
  });
}

async function seedOrder(client: any, id: string, overrides: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    id: `'${id}'`, order_code: `'RC-${id}'`, customer_id: `'r58_user'`, customer_name: `'R58'`, phone: `'09120000000'`,
    lines: `'[]'::jsonb`, address: `'{}'::jsonb`, shipping_method: `'post'`, shipping_price: `59000`, pay_method: `'gateway'`,
    total_amount: `1059000`, payment_status: `'unpaid'`, items_total: `1000000`, currency: `'IRR'`, order_status: `'placed'`, ...overrides,
  };
  await client.query(`INSERT INTO retail_order (${Object.keys(cols).join(",")}) VALUES (${Object.values(cols).join(",")})`);
}

describe("Phase 5.8 migration 0033: canonical retail commerce columns", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("adds the canonical order columns with safe defaults", async () => {
    await withClient(DB, async (client) => {
      await seedOrder(client, "r58_o1");
      const { rows } = await client.query(
        `SELECT promotion_discount_total, legal_snapshot_id, creation_request_hash, version FROM retail_order WHERE id='r58_o1'`,
      );
      expect(rows[0].promotion_discount_total).toBe("0");
      expect(rows[0].legal_snapshot_id).toBeNull();
      expect(rows[0].creation_request_hash).toBeNull();
      expect(rows[0].version).toBe(0);
    });
  });

  it("enforces the order totals equation and discount bounds", async () => {
    await withClient(DB, async (client) => {
      // discount larger than items subtotal is rejected
      await expect(seedOrder(client, "r58_bad1", { promotion_discount_total: `2000000` })).rejects.toThrow(
        /promo_discount_within_items/,
      );
      // grand total must equal items - discount + shipping
      await expect(seedOrder(client, "r58_bad2", { total_amount: `999999` })).rejects.toThrow(/totals_equation/);
      // negative discount rejected (money range)
      await expect(seedOrder(client, "r58_bad3", { promotion_discount_total: `-1` })).rejects.toThrow(
        /promotion_discount_total_range/,
      );
      // negative version rejected
      await expect(seedOrder(client, "r58_bad4", { version: `-1` })).rejects.toThrow(/version_non_negative/);
      // a discounted order that balances is accepted
      await seedOrder(client, "r58_ok", { promotion_discount_total: `100000`, total_amount: `959000` });
      const { rows } = await client.query(`SELECT total_amount FROM retail_order WHERE id='r58_ok'`);
      expect(rows[0].total_amount).toBe("959000");
    });
  });

  it("adds item variant/base/discount columns and enforces per-line equations", async () => {
    await withClient(DB, async (client) => {
      await seedOrder(client, "r58_o2");
      await client.query(
        `INSERT INTO retail_order_item (id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
         VALUES ('r58_i1', 'r58_o2', 'r58_prod', 'r58_var', 'R58-VAR', 'R58 product', 2, 500000, 1000000, 100000, 900000)`,
      );
      // line equation violated
      await expect(
        client.query(
          `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
           VALUES ('r58_i_bad1', 'r58_o2', 'r58_prod', 'R58-VAR', 'R58 product', 2, 500000, 1000000, 100000, 950000)`,
        ),
      ).rejects.toThrow(/line_equation/);
      // base equation violated (base must equal unit * qty)
      await expect(
        client.query(
          `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
           VALUES ('r58_i_bad2', 'r58_o2', 'r58_prod', 'R58-VAR', 'R58 product', 2, 500000, 1100000, 200000, 900000)`,
        ),
      ).rejects.toThrow(/base_equation/);
      // discount larger than base rejected
      await expect(
        client.query(
          `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
           VALUES ('r58_i_bad3', 'r58_o2', 'r58_prod', 'R58-VAR', 'R58 product', 1, 500000, 500000, 500001, -1)`,
        ),
      ).rejects.toThrow(/promo_within_base|promotion_discount_amount_range|line_total_range/);
      // unknown variant rejected by FK
      await expect(
        client.query(
          `INSERT INTO retail_order_item (id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
           VALUES ('r58_i_bad4', 'r58_o2', 'r58_prod', 'nope', 'R58-VAR', 'R58 product', 1, 500000, 500000, 0, 500000)`,
        ),
      ).rejects.toThrow(/variant_fk/);
    });
  });

  it("creates retail_order_event with status/actor catalogs and version uniqueness", async () => {
    await withClient(DB, async (client) => {
      await seedOrder(client, "r58_o3");
      await client.query(
        `INSERT INTO retail_order_event (id, order_id, from_status, to_status, actor_id, actor_role, order_version)
         VALUES ('r58_e1', 'r58_o3', NULL, 'placed', 'r58_user', 'customer', 0)`,
      );
      await expect(
        client.query(
          `INSERT INTO retail_order_event (id, order_id, to_status, order_version)
           VALUES ('r58_e_bad1', 'r58_o3', 'LAUNCHED', 1)`,
        ),
      ).rejects.toThrow(/to_status_allowed/);
      await expect(
        client.query(
          `INSERT INTO retail_order_event (id, order_id, to_status, actor_role, order_version)
           VALUES ('r58_e_bad2', 'r58_o3', 'confirmed', 'intruder', 1)`,
        ),
      ).rejects.toThrow(/actor_role_allowed/);
      // same order + version twice is rejected
      await expect(
        client.query(
          `INSERT INTO retail_order_event (id, order_id, to_status, order_version)
           VALUES ('r58_e_bad3', 'r58_o3', 'confirmed', 0)`,
        ),
      ).rejects.toThrow(/order_version_unique/);
      // unknown order rejected by FK
      await expect(
        client.query(
          `INSERT INTO retail_order_event (id, order_id, to_status, order_version)
           VALUES ('r58_e_bad4', 'nope', 'placed', 0)`,
        ),
      ).rejects.toThrow(/retail_order_event_order_fk/);
    });
  });
});
