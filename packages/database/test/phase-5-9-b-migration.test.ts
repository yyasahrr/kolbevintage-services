import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_9_b_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r59b_user', 'r59b@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
       VALUES ('r59b_o1', 'RC-r59b_o1', 'r59b_user', 'R59B', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'gateway', 2000000, 'unpaid', 2000000, 'IRR', 'delivered')`,
    );
    await client.query(
      `INSERT INTO retail_order_item (id, order_id, product_id, sku, product_name, quantity, unit_price, base_line_total, line_total)
       VALUES ('r59b_oi1', 'r59b_o1', 'prod_x', 'SKU-X', 'X', 2, 1000000, 2000000, 2000000)`,
    );
  });
}

describe("Phase 5.9-B migration 0038: first-class retail returns", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("stores a typed return request scoped to its order and customer", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO retail_return_request (id, order_id, customer_id, status, reason, note)
         VALUES ('r59b_r1', 'r59b_o1', 'r59b_user', 'REQUESTED', 'DAMAGED', 'note')`,
      );
      const { rows } = await client.query(
        `SELECT order_id, customer_id, status, support_case_id, inspection_decision, version FROM retail_return_request WHERE id='r59b_r1'`,
      );
      expect(rows[0]).toMatchObject({
        order_id: "r59b_o1",
        customer_id: "r59b_user",
        status: "REQUESTED",
        support_case_id: null,
        inspection_decision: null,
        version: 0,
      });
      // Dangling order and customer: both FKs fire.
      await expect(
        client.query(`INSERT INTO retail_return_request (id, order_id, customer_id, status, reason) VALUES ('r59b_rx', 'ghost', 'r59b_user', 'REQUESTED', 'OTHER')`),
      ).rejects.toThrow(/retail_return_request_order_fk/);
      await expect(
        client.query(`INSERT INTO retail_return_request (id, order_id, customer_id, status, reason) VALUES ('r59b_ry', 'r59b_o1', 'ghost', 'REQUESTED', 'OTHER')`),
      ).rejects.toThrow(/retail_return_request_customer_fk/);
      // Unknown status/reason/decision: the CHECKs fire.
      await expect(
        client.query(`INSERT INTO retail_return_request (id, order_id, customer_id, status, reason) VALUES ('r59b_rz', 'r59b_o1', 'r59b_user', 'BOGUS', 'OTHER')`),
      ).rejects.toThrow(/retail_return_request_status_allowed/);
      await expect(
        client.query(`INSERT INTO retail_return_request (id, order_id, customer_id, status, reason) VALUES ('r59b_rz', 'r59b_o1', 'r59b_user', 'REQUESTED', 'BOGUS')`),
      ).rejects.toThrow(/retail_return_request_reason_allowed/);
      await expect(
        client.query(`UPDATE retail_return_request SET inspection_decision='BOGUS' WHERE id='r59b_r1'`),
      ).rejects.toThrow(/retail_return_request_inspection_allowed/);
      await expect(client.query(`UPDATE retail_return_request SET version=-1 WHERE id='r59b_r1'`)).rejects.toThrow(
        /retail_return_request_version_non_negative/,
      );
    });
  });

  it("holds one positive-quantity row per order line per request", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO retail_return_item (id, return_id, order_item_id, quantity) VALUES ('r59b_ri1', 'r59b_r1', 'r59b_oi1', 1)`);
      // Same line twice in one request collides.
      await expect(
        client.query(`INSERT INTO retail_return_item (id, return_id, order_item_id, quantity) VALUES ('r59b_ri2', 'r59b_r1', 'r59b_oi1', 1)`),
      ).rejects.toThrow(/retail_return_item_return_line_unique/);
      // Zero quantity is rejected.
      await expect(
        client.query(`INSERT INTO retail_return_item (id, return_id, order_item_id, quantity) VALUES ('r59b_ri3', 'r59b_r1', 'r59b_oi1', 0)`),
      ).rejects.toThrow(/retail_return_item_quantity_positive/);
      // Dangling parents: both FKs fire.
      await expect(
        client.query(`INSERT INTO retail_return_item (id, return_id, order_item_id, quantity) VALUES ('r59b_ri4', 'ghost', 'r59b_oi1', 1)`),
      ).rejects.toThrow(/retail_return_item_return_fk/);
      await expect(
        client.query(`INSERT INTO retail_return_item (id, return_id, order_item_id, quantity) VALUES ('r59b_ri5', 'r59b_r1', 'ghost', 1)`),
      ).rejects.toThrow(/retail_return_item_order_item_fk/);
    });
  });

  it("appends versioned transition events, one per version", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO retail_return_event (id, return_id, from_status, to_status, actor_id, actor_role, return_version)
         VALUES ('r59b_re1', 'r59b_r1', NULL, 'REQUESTED', 'r59b_user', 'customer', 0)`,
      );
      await client.query(
        `INSERT INTO retail_return_event (id, return_id, from_status, to_status, actor_id, actor_role, return_version)
         VALUES ('r59b_re2', 'r59b_r1', 'REQUESTED', 'APPROVED', 'r59b_user', 'admin', 1)`,
      );
      // Same version twice collides.
      await expect(
        client.query(
          `INSERT INTO retail_return_event (id, return_id, from_status, to_status, return_version)
           VALUES ('r59b_re3', 'r59b_r1', 'REQUESTED', 'APPROVED', 1)`,
        ),
      ).rejects.toThrow(/retail_return_event_return_version_unique/);
      // Unknown target status: the CHECK fires.
      await expect(
        client.query(
          `INSERT INTO retail_return_event (id, return_id, from_status, to_status, return_version)
           VALUES ('r59b_re4', 'r59b_r1', 'APPROVED', 'BOGUS', 2)`,
        ),
      ).rejects.toThrow(/retail_return_event_to_status_allowed/);
      // Dangling actor: the FK fires (NULL actor stays allowed for system rows).
      await expect(
        client.query(
          `INSERT INTO retail_return_event (id, return_id, to_status, actor_id, return_version)
           VALUES ('r59b_re5', 'r59b_r1', 'APPROVED', 'ghost', 2)`,
        ),
      ).rejects.toThrow(/retail_return_event_actor_fk/);
    });
  });

  it("refuses to delete an order, line, or customer with returns (restrict)", async () => {
    await withClient(DB, async (client) => {
      // A returned order line cannot go while its return line exists.
      await expect(client.query(`DELETE FROM retail_order_item WHERE id='r59b_oi1'`)).rejects.toThrow(/retail_return_item_order_item_fk/);
      // Clear lines + events but keep the request: the request FK then fires.
      await client.query(`DELETE FROM retail_return_item WHERE return_id='r59b_r1'`);
      await client.query(`DELETE FROM retail_return_event WHERE return_id='r59b_r1'`);
      await client.query(`DELETE FROM retail_order_item WHERE id='r59b_oi1'`);
      await expect(client.query(`DELETE FROM retail_order WHERE id='r59b_o1'`)).rejects.toThrow(/retail_return_request_order_fk/);
      // Detach the order's customer pointer but keep the request: the
      // customer FK fires (proves the request independently pins the user).
      await client.query(`UPDATE retail_order SET customer_id=NULL WHERE id='r59b_o1'`);
      await expect(client.query(`DELETE FROM account_user WHERE id='r59b_user'`)).rejects.toThrow(/retail_return_request_customer_fk/);
    });
  });
});
