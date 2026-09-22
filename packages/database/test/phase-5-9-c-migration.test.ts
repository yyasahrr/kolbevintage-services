import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_9_c_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r59c_user', 'r59c@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
       VALUES ('r59c_o1', 'RC-r59c_o1', 'r59c_user', 'R59C', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'gateway', 2000000, 'paid', 2000000, 'IRR', 'delivered')`,
    );
    await client.query(
      `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, line_total)
       VALUES ('r59c_oi1', 'r59c_o1', 'prod_x', 'SKU-X', 'X', 2, 1000000, 2000000, 2000000)`,
    );
  });
}

describe("Phase 5.9-C migration 0039: retail side of the generic refund engine", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("stores a retail-sided refund: exactly one order side, retail FK + partial unique", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO refund (id, refund_reference, retail_order_id, amount, idempotency_key)
         VALUES ('r59c_f1', 'RF-r59c-f1', 'r59c_o1', 1000000, 'idem-1')`,
      );
      const { rows } = await client.query(`SELECT wholesale_order_id, retail_order_id, status, version FROM refund WHERE id='r59c_f1'`);
      expect(rows[0]).toMatchObject({ wholesale_order_id: null, retail_order_id: "r59c_o1", status: "requested", version: 0 });
      // Both sides set: the XOR CHECK fires.
      await expect(
        client.query(`UPDATE refund SET wholesale_order_id='ghost-w' WHERE id='r59c_f1'`),
      ).rejects.toThrow(/refund_single_order_side/);
      // Neither side set: the XOR CHECK fires.
      await expect(
        client.query(`UPDATE refund SET retail_order_id=NULL WHERE id='r59c_f1'`),
      ).rejects.toThrow(/refund_single_order_side/);
      // Dangling retail order: the FK fires.
      await expect(
        client.query(`INSERT INTO refund (id, refund_reference, retail_order_id, amount) VALUES ('r59c_fx', 'RF-r59c-fx', 'ghost', 10)`),
      ).rejects.toThrow(/refund_retail_order_fk/);
      // Same retail order + same idempotency key collides on the new partial unique.
      await expect(
        client.query(`INSERT INTO refund (id, refund_reference, retail_order_id, amount, idempotency_key) VALUES ('r59c_f2', 'RF-r59c-f2', 'r59c_o1', 10, 'idem-1')`),
      ).rejects.toThrow(/refund_retail_order_idempotency_unique/);
      // NULL idempotency keys never collide (partial unique skips them).
      await client.query(`INSERT INTO refund (id, refund_reference, retail_order_id, amount) VALUES ('r59c_f3', 'RF-r59c-f3', 'r59c_o1', 10)`);
      await client.query(`INSERT INTO refund (id, refund_reference, retail_order_id, amount) VALUES ('r59c_f4', 'RF-r59c-f4', 'r59c_o1', 10)`);
    });
  });

  it("stores retail-sided refund lines: item-side XOR + per-refund item uniqueness", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO refund_line (id, refund_id, retail_order_item_id, quantity, unit_price, line_total)
         VALUES ('r59c_fl1', 'r59c_f1', 'r59c_oi1', 1, 1000000, 1000000)`,
      );
      // Both item sides set: the XOR CHECK fires.
      await expect(
        client.query(`UPDATE refund_line SET wholesale_order_item_id='ghost-wi' WHERE id='r59c_fl1'`),
      ).rejects.toThrow(/refund_line_single_item_side/);
      // Neither item side set: the XOR CHECK fires.
      await expect(
        client.query(`UPDATE refund_line SET retail_order_item_id=NULL WHERE id='r59c_fl1'`),
      ).rejects.toThrow(/refund_line_single_item_side/);
      // Dangling retail item: the FK fires.
      await expect(
        client.query(`INSERT INTO refund_line (id, refund_id, retail_order_item_id, quantity, unit_price, line_total) VALUES ('r59c_flx', 'r59c_f1', 'ghost', 1, 1, 1)`),
      ).rejects.toThrow(/refund_line_retail_item_fk/);
      // Same item twice in one refund collides on the new partial unique.
      await expect(
        client.query(`INSERT INTO refund_line (id, refund_id, retail_order_item_id, quantity, unit_price, line_total) VALUES ('r59c_fl2', 'r59c_f1', 'r59c_oi1', 1, 1, 1)`),
      ).rejects.toThrow(/refund_line_refund_retail_item_unique/);
      // Line math still guarded: quantity × unit_price must equal line_total.
      await expect(
        client.query(`INSERT INTO refund_line (id, refund_id, retail_order_item_id, quantity, unit_price, line_total) VALUES ('r59c_fl3', 'r59c_f1', 'r59c_oi1', 1, 1000000, 999999)`),
      ).rejects.toThrow(/refund_line_total_matches/);
    });
  });

  it("posts retail-sided ledger entries: order-side XOR + retail FK", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO financial_ledger_entry (id, retail_order_id, refund_id, entry_type, direction, amount)
         VALUES ('r59c_le1', 'r59c_o1', 'r59c_f1', 'refund_completed', 'OUT', 1000000)`,
      );
      // Both sides set: the XOR CHECK fires (INSERTs — the ledger is append-only).
      await expect(
        client.query(`INSERT INTO financial_ledger_entry (id, order_id, retail_order_id, entry_type, direction, amount) VALUES ('r59c_lex1', 'ghost-w', 'r59c_o1', 'refund_completed', 'OUT', 1)`),
      ).rejects.toThrow(/financial_ledger_single_order_side/);
      // Neither side set: the XOR CHECK fires.
      await expect(
        client.query(`INSERT INTO financial_ledger_entry (id, entry_type, direction, amount) VALUES ('r59c_lex2', 'refund_completed', 'OUT', 1)`),
      ).rejects.toThrow(/financial_ledger_single_order_side/);
      // Dangling retail order: the FK fires.
      await expect(
        client.query(`INSERT INTO financial_ledger_entry (id, retail_order_id, entry_type, direction, amount) VALUES ('r59c_lex', 'ghost', 'refund_completed', 'OUT', 1)`),
      ).rejects.toThrow(/financial_ledger_retail_order_fk/);
    });
  });

  it("records the retail refund facts and refuses to delete a refunded order", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, actor_role)
         VALUES ('r59c_e1', 'retail_order', 'r59c_o1', 'retail_order.refund_requested', 'admin')`,
      );
      await client.query(
        `INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, actor_role)
         VALUES ('r59c_e2', 'retail_order', 'r59c_o1', 'retail_order.refund_completed', 'system')`,
      );
      await expect(
        client.query(`INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, actor_role) VALUES ('r59c_e3', 'retail_order', 'r59c_o1', 'retail_order.refund_bogus', 'admin')`),
      ).rejects.toThrow(/order_event_event_type_allowed/);
      // The refunded line is pinned by the retail item FK (restrict).
      await expect(client.query(`DELETE FROM retail_order_item WHERE id='r59c_oi1'`)).rejects.toThrow(/refund_line_retail_item_fk/);
      // Item-less orders prove the header-side pins independently (a bare
      // order DELETE would otherwise trip the item FK first).
      await client.query(
        `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
         VALUES ('r59c_o2', 'RC-r59c_o2', 'r59c_user', 'R59C', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'cod', 500000, 'unpaid', 500000, 'IRR', 'cancelled')`,
      );
      await client.query(`INSERT INTO refund (id, refund_reference, retail_order_id, amount) VALUES ('r59c_f5', 'RF-r59c-f5', 'r59c_o2', 10)`);
      await expect(client.query(`DELETE FROM retail_order WHERE id='r59c_o2'`)).rejects.toThrow(/refund_retail_order_fk/);
      await client.query(
        `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
         VALUES ('r59c_o3', 'RC-r59c_o3', 'r59c_user', 'R59C', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'cod', 500000, 'unpaid', 500000, 'IRR', 'cancelled')`,
      );
      await client.query(`INSERT INTO financial_ledger_entry (id, retail_order_id, entry_type, direction, amount) VALUES ('r59c_le2', 'r59c_o3', 'refund_completed', 'OUT', 1)`);
      await expect(client.query(`DELETE FROM retail_order WHERE id='r59c_o3'`)).rejects.toThrow(/financial_ledger_retail_order_fk/);
    });
  });
});
