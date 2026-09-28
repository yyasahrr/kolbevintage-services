import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_9_a_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r59a_user', 'r59a@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
       VALUES ('r59a_o1', 'RC-r59a_o1', 'r59a_user', 'R59A', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'gateway', 2000000, 'unpaid', 2000000, 'IRR', 'placed')`,
    );
  });
}

describe("Phase 5.9-A migration 0037: customer addresses + guest capability columns", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("stores a typed saved address scoped to its owner", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO customer_address (id, user_id, label, recipient_name, recipient_phone, province, city, address_line, plaque, unit, postal_code, is_default)
         VALUES ('r59a_a1', 'r59a_user', 'خانه', 'R59A', '09120000000', 'تهران', 'تهران', 'خیابان آزمون', '۱', '۲', '1234567890', true)`,
      );
      const { rows } = await client.query(`SELECT user_id, is_default, version, archived_at FROM customer_address WHERE id='r59a_a1'`);
      expect(rows[0].user_id).toBe("r59a_user");
      expect(rows[0].is_default).toBe(true);
      expect(rows[0].version).toBe(0);
      expect(rows[0].archived_at).toBeNull();
      // Dangling owner: the FK fires.
      await expect(
        client.query(
          `INSERT INTO customer_address (id, user_id, recipient_name, recipient_phone, province, city, address_line, postal_code)
           VALUES ('r59a_ax', 'ghost', 'G', '09120000000', 'تهران', 'تهران', 'x', '1234567890')`,
        ),
      ).rejects.toThrow(/customer_address_user_fk/);
      // Owner with an address cannot be deleted (restrict): drop the seed
      // order first so the address FK is the one that fires.
      await client.query(`DELETE FROM retail_order WHERE id='r59a_o1'`);
      await expect(client.query(`DELETE FROM account_user WHERE id='r59a_user'`)).rejects.toThrow(/customer_address_user_fk/);
    });
  });

  it("enforces exactly one active default per user, ignoring archived rows", async () => {
    await withClient(DB, async (client) => {
      // A second active default for the same user collides.
      await expect(
        client.query(
          `INSERT INTO customer_address (id, user_id, recipient_name, recipient_phone, province, city, address_line, postal_code, is_default)
           VALUES ('r59a_a2', 'r59a_user', 'R59A', '09120000000', 'تهران', 'تهران', 'y', '1234567890', true)`,
        ),
      ).rejects.toThrow(/customer_address_single_default/);
      // Non-defaults coexist freely.
      await client.query(
        `INSERT INTO customer_address (id, user_id, recipient_name, recipient_phone, province, city, address_line, postal_code, is_default)
         VALUES ('r59a_a3', 'r59a_user', 'R59A', '09120000000', 'تهران', 'تهران', 'z', '1234567890', false)`,
      );
      // Archiving the default frees the slot.
      await client.query(`UPDATE customer_address SET archived_at = now(), is_default = false WHERE id='r59a_a1'`);
      await client.query(`UPDATE customer_address SET is_default = true WHERE id='r59a_a3'`);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM customer_address WHERE user_id='r59a_user' AND is_default AND archived_at IS NULL`);
      expect(rows[0].n).toBe(1);
    });
  });

  it("rejects a negative address version", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`UPDATE customer_address SET version = -1 WHERE id='r59a_a3'`)).rejects.toThrow(
        /customer_address_version_non_negative/,
      );
    });
  });

  it("keeps guest capability columns nullable so legacy orders stay honest NULLs", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
         VALUES ('r59a_o2', 'RC-r59a_o2', 'r59a_user', 'R59A', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'gateway', 2000000, 'unpaid', 2000000, 'IRR', 'placed')`,
      );
      const { rows } = await client.query(
        `SELECT guest_capability_hash, guest_capability_issued_at, guest_capability_revoked_at FROM retail_order WHERE id='r59a_o2'`,
      );
      expect(rows[0].guest_capability_hash).toBeNull();
      expect(rows[0].guest_capability_issued_at).toBeNull();
      expect(rows[0].guest_capability_revoked_at).toBeNull();
      // New guest orders may carry a hash + issuance timestamp.
      await client.query(
        `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status, guest_capability_hash, guest_capability_issued_at)
         VALUES ('r59a_g1', 'RC-r59a_g1', NULL, 'Guest', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 0, 'gateway', 2000000, 'unpaid', 2000000, 'IRR', 'placed', 'abc123hash', now())`,
      );
      const { rows: guest } = await client.query(`SELECT guest_capability_hash FROM retail_order WHERE id='r59a_g1'`);
      expect(guest[0].guest_capability_hash).toBe("abc123hash");
    });
  });
});
