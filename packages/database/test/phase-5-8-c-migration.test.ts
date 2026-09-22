import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_8_c_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r58c_user', 'r58c@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('seller_kolbe', 'KOLBE', NULL, 'Kolbe', 'active') ON CONFLICT (id) DO NOTHING`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
       VALUES ('r58c_o1', 'RC-r58c_o1', 'r58c_user', 'R58C', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 59000, 'gateway', 2059000, 'unpaid', 2000000, 'IRR', 'placed')`,
    );
    await client.query(
      `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, promotion_discount, line_total)
       VALUES ('r58c_i1', 'r58c_o1', 'prod_c1', 'SKU-C1', 'C Item', 2, 1000000, 2000000, 0, 2000000)`,
    );
  });
}

describe("Phase 5.8-C migration 0036: retail shipment linkage + fulfillment relay facts", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("links shipments to retail orders with an all-or-nothing wholesale side", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO shipment (id, shipment_code, retail_order_id, seller_id, shipping_responsibility, provider, status)
         VALUES ('r58c_sh1', 'RSHP-R58C-0001', 'r58c_o1', 'seller_kolbe', 'KOLBE', 'manual', 'pending')`,
      );
      const { rows } = await client.query(
        `SELECT retail_order_id, wholesale_order_id, child_order_id FROM shipment WHERE id='r58c_sh1'`,
      );
      expect(rows[0].retail_order_id).toBe("r58c_o1");
      expect(rows[0].wholesale_order_id).toBeNull();
      expect(rows[0].child_order_id).toBeNull();
      // Neither side set: the single-side CHECK fires.
      await expect(
        client.query(`INSERT INTO shipment (id, shipment_code, seller_id) VALUES ('r58c_sh2', 'RSHP-R58C-0002', 'seller_kolbe')`),
      ).rejects.toThrow(/shipment_single_order_side/);
      // Wholesale side is all-or-nothing: order without child is rejected by the predicate itself
      // (dangling ids keep this dynamic — CHECK fires before any FK is evaluated).
      await expect(
        client.query(
          `INSERT INTO shipment (id, shipment_code, wholesale_order_id, seller_id) VALUES ('r58c_sh3', 'RSHP-R58C-0003', 'dangling_w', 'seller_kolbe')`,
        ),
      ).rejects.toThrow(/shipment_single_order_side/);
      // Both sides set: rejected by the same predicate.
      await expect(
        client.query(
          `INSERT INTO shipment (id, shipment_code, wholesale_order_id, child_order_id, retail_order_id, seller_id)
           VALUES ('r58c_sh4', 'RSHP-R58C-0004', 'dangling_w', 'dangling_c', 'r58c_o1', 'seller_kolbe')`,
        ),
      ).rejects.toThrow(/shipment_single_order_side/);
      // Dangling retail link with a valid single side: the FK fires.
      await expect(
        client.query(
          `INSERT INTO shipment (id, shipment_code, retail_order_id, seller_id) VALUES ('r58c_sh5', 'RSHP-R58C-0005', 'missing', 'seller_kolbe')`,
        ),
      ).rejects.toThrow(/shipment_retail_order_fk/);
    });
  });

  it("links shipment items to retail lines with exactly one item side", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO shipment_item (id, shipment_id, retail_order_item_id, piece_quantity)
         VALUES ('r58c_si1', 'r58c_sh1', 'r58c_i1', 2)`,
      );
      const { rows } = await client.query(`SELECT retail_order_item_id, wholesale_order_item_id FROM shipment_item WHERE id='r58c_si1'`);
      expect(rows[0].retail_order_item_id).toBe("r58c_i1");
      expect(rows[0].wholesale_order_item_id).toBeNull();
      // Neither side: CHECK fires.
      await expect(
        client.query(`INSERT INTO shipment_item (id, shipment_id, piece_quantity) VALUES ('r58c_si2', 'r58c_sh1', 1)`),
      ).rejects.toThrow(/shipment_item_single_order_side/);
      // Both sides: CHECK fires (dangling wholesale id — CHECK precedes FK).
      await expect(
        client.query(
          `INSERT INTO shipment_item (id, shipment_id, wholesale_order_item_id, retail_order_item_id, piece_quantity)
           VALUES ('r58c_si3', 'r58c_sh1', 'dangling_wi', 'r58c_i1', 1)`,
        ),
      ).rejects.toThrow(/shipment_item_single_order_side/);
      // Dangling retail link with a valid single side: the FK fires.
      await expect(
        client.query(
          `INSERT INTO shipment_item (id, shipment_id, retail_order_item_id, piece_quantity) VALUES ('r58c_si4', 'r58c_sh1', 'missing', 1)`,
        ),
      ).rejects.toThrow(/shipment_item_retail_item_fk/);
      // One row per (shipment, retail line), like the wholesale unique.
      await expect(
        client.query(
          `INSERT INTO shipment_item (id, shipment_id, retail_order_item_id, piece_quantity) VALUES ('r58c_si5', 'r58c_sh1', 'r58c_i1', 1)`,
        ),
      ).rejects.toThrow(/shipment_item_shipment_retail_unique/);
    });
  });

  it("accepts the four fulfillment relay keys on both notification twins", async () => {
    await withClient(DB, async (client) => {
      const keys = ["RETAIL_ORDER_CONFIRMED", "RETAIL_SHIPMENT_CREATED", "RETAIL_SHIPMENT_HANDED_OVER", "RETAIL_SHIPMENT_DELIVERED"];
      for (const [index, key] of keys.entries()) {
        await client.query(
          `INSERT INTO notification_event (id, event_key, source_domain, source_entity_type, source_entity_id, source_event_id, occurred_at, recipient_scope)
           VALUES ('r58c_ne${index}', '${key}', 'retail', 'retail_order', 'r58c_o1', 'r58c_se${index}', now(), 'ACCOUNT_USER')`,
        );
        await client.query(
          `INSERT INTO notification_template (id, template_key, name, event_key, channel)
           VALUES ('r58c_nt${index}', 'TPL_R58C_${index}', 'R58C ${index}', '${key}', 'IN_APP')`,
        );
      }
      const events = await client.query(`SELECT COUNT(*)::int AS n FROM notification_event WHERE id LIKE 'r58c_ne%'`);
      expect(events.rows[0].n).toBe(4);
      const templates = await client.query(`SELECT COUNT(*)::int AS n FROM notification_template WHERE id LIKE 'r58c_nt%'`);
      expect(templates.rows[0].n).toBe(4);
      await expect(
        client.query(
          `INSERT INTO notification_event (id, event_key, source_domain, source_entity_type, source_entity_id, source_event_id, occurred_at, recipient_scope)
           VALUES ('r58c_ne_bad', 'RETAIL_SHIPMENT_PACKED', 'retail', 'retail_order', 'r58c_o1', 'r58c_se_bad', now(), 'ACCOUNT_USER')`,
        ),
      ).rejects.toThrow(/notification_event_key_allowed/);
    });
  });

  it("accepts the four fulfillment fact types on order_event", async () => {
    await withClient(DB, async (client) => {
      const facts = [
        "retail_order.confirmed",
        "retail_order.shipment_created",
        "retail_order.shipment_handed_over",
        "retail_order.shipment_delivered",
      ];
      for (const [index, type] of facts.entries()) {
        await client.query(
          `INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ('r58c_oe${index}', 'retail_order', 'r58c_o1', '${type}', '{}'::jsonb)`,
        );
      }
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM order_event WHERE id LIKE 'r58c_oe%'`);
      expect(rows[0].n).toBe(4);
      await expect(
        client.query(
          `INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ('r58c_oe_bad', 'retail_order', 'r58c_o1', 'retail_order.packed', '{}'::jsonb)`,
        ),
      ).rejects.toThrow(/order_event_event_type_allowed/);
    });
  });
});
