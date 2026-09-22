import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_8_b_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r58b_user', 'r58b@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, lines, address, shipping_method, shipping_price, pay_method, total_amount, payment_status, items_total, currency, order_status)
       VALUES ('r58b_o1', 'RC-r58b_o1', 'r58b_user', 'R58B', '09120000000', '[]'::jsonb, '{}'::jsonb, 'post', 59000, 'gateway', 1059000, 'unpaid', 1000000, 'IRR', 'placed')`,
    );
  });
}

describe("Phase 5.8-B migration 0034: retail payment linkage + paid status + relay facts", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("links payments to retail orders with exactly one order side", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO payment (id, payment_reference, retail_order_id, method, provider, status, amount, currency)
         VALUES ('r58b_pay1', 'REF-R58B-1', 'r58b_o1', 'online', 'manual', 'pending', 1059000, 'IRR')`,
      );
      const { rows } = await client.query(`SELECT retail_order_id, wholesale_order_id FROM payment WHERE id='r58b_pay1'`);
      expect(rows[0].retail_order_id).toBe("r58b_o1");
      expect(rows[0].wholesale_order_id).toBeNull();
      // Neither side set: the single-side CHECK fires (NULL FKs pass; the CHECK does not).
      await expect(
        client.query(`INSERT INTO payment (id, payment_reference, method) VALUES ('r58b_pay2', 'REF-R58B-2', 'online')`),
      ).rejects.toThrow(/payment_single_order_side/);
      // Dangling retail link: the FK fires.
      await expect(
        client.query(`INSERT INTO payment (id, payment_reference, retail_order_id, method) VALUES ('r58b_pay3', 'REF-R58B-3', 'missing', 'online')`),
      ).rejects.toThrow(/payment_retail_order_fk/);
      // Both-sides-set is rejected by the predicate itself (pinned statically: no wholesale fixture exists here).
      const def = await client.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='payment_single_order_side'`);
      expect(def.rows[0].definition).toContain("wholesale_order_id");
      expect(def.rows[0].definition).toContain("retail_order_id");
      // Retail idempotency gets the same partial-unique treatment as wholesale.
      const idx = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='payment' AND indexname='payment_retail_order_idempotency_unique'`);
      expect(idx.rows).toHaveLength(1);
    });
  });

  it("accepts the paid retail payment status (written only by verified-payment orchestration)", async () => {
    await withClient(DB, async (client) => {
      await client.query(`UPDATE retail_order SET payment_status='paid' WHERE id='r58b_o1'`);
      const { rows } = await client.query(`SELECT payment_status FROM retail_order WHERE id='r58b_o1'`);
      expect(rows[0].payment_status).toBe("paid");
      await expect(client.query(`UPDATE retail_order SET payment_status='settled' WHERE id='r58b_o1'`)).rejects.toThrow(
        /retail_order_payment_status_allowed/,
      );
    });
  });

  it("accepts the retail relay keys and the paid/cancelled facts", async () => {
    await withClient(DB, async (client) => {
      for (const key of ["RETAIL_ORDER_CREATED", "RETAIL_ORDER_PAID", "RETAIL_ORDER_CANCELLED"]) {
        await client.query(
          `INSERT INTO notification_event (id, event_key, source_domain, source_entity_type, source_entity_id, source_event_id, occurred_at, recipient_scope, payload)
           VALUES ('r58b_nev_${key}', '${key}', 'retail', 'retail_order', 'r58b_o1', 'r58b-src-${key}', now(), 'ACCOUNT_USER', '{}'::jsonb)`,
        );
      }
      for (const type of ["retail_order.paid", "retail_order.cancelled"]) {
        await client.query(
          `INSERT INTO order_event (id, aggregate_type, aggregate_id, event_type, payload) VALUES ('r58b_oev_${type}', 'retail_order', 'r58b_o1', '${type}', '{}'::jsonb)`,
        );
      }
      const facts = await client.query(`SELECT count(*) AS count FROM order_event WHERE aggregate_id='r58b_o1'`);
      expect(Number(facts.rows[0].count)).toBe(2);
    });
  });
});

describe("Phase 5.8-B migration 0035: one ACTIVE hold per (allocation, seller, variant)", () => {
  const DB35 = "kolbe_phase_5_8_b_35_migration_test";

  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB35);
    migrateOrFail(DB35);
    await withClient(DB35, async (client) => {
      // The KOLBE seller is pre-seeded by the migrator (singleton); reuse it.
      await client.query(`INSERT INTO product (id, name, slug) VALUES ('r58b35_p', 'R58B35', 'r58b35-p')`);
      await client.query(`INSERT INTO product_variant (id, product_id, sku) VALUES ('r58b35_v', 'r58b35_p', 'R58B35-V')`);
    });
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB35);
  });

  it("keeps the anti-double-hold guarantee while terminal rows coexist as history", async () => {
    await withClient(DB35, async (client) => {
      await client.query(
        `INSERT INTO inventory_reservation (id, variant_id, seller_id, quantity, status, allocation_id)
         VALUES ('r58b35_r1', 'r58b35_v', 'seller_kolbe', 2, 'active', 'alloc-1')`,
      );
      // A second ACTIVE hold for the same triple is still rejected.
      await expect(
        client.query(
          `INSERT INTO inventory_reservation (id, variant_id, seller_id, quantity, status, allocation_id)
           VALUES ('r58b35_r2', 'r58b35_v', 'seller_kolbe', 2, 'active', 'alloc-1')`,
        ),
      ).rejects.toThrow(/inventory_reservation_allocation_unique/);
      // Once the first hold is terminal, the re-reserve row is legitimate history.
      await client.query(`UPDATE inventory_reservation SET status='expired' WHERE id='r58b35_r1'`);
      await client.query(
        `INSERT INTO inventory_reservation (id, variant_id, seller_id, quantity, status, allocation_id)
         VALUES ('r58b35_r3', 'r58b35_v', 'seller_kolbe', 2, 'active', 'alloc-1')`,
      );
      const { rows } = await client.query(
        `SELECT status FROM inventory_reservation WHERE allocation_id='alloc-1' ORDER BY id`,
      );
      expect(rows.map((row) => row.status)).toEqual(["expired", "active"]);
      // The live predicate is status-scoped (not the old allocation-only predicate).
      const def = await client.query(`SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indexrelid='inventory_reservation_allocation_unique'::regclass`);
      expect(def.rows[0].def).toContain("status = 'active'::text");
    });
  });

  it("accepts the retail relay keys on notification templates (enqueue renders, not send time)", async () => {
    await withClient(DB35, async (client) => {
      for (const key of ["RETAIL_ORDER_CREATED", "RETAIL_ORDER_PAID", "RETAIL_ORDER_CANCELLED"]) {
        await client.query(
          `INSERT INTO notification_template (id, template_key, name, event_key, channel)
           VALUES ('r58b35_tpl_${key}', 'r58b35_${key}', 'R58B35 ${key}', '${key}', 'IN_APP')`,
        );
      }
      const { rows } = await client.query(`SELECT count(*) AS count FROM notification_template WHERE id LIKE 'r58b35_tpl\\_%'`);
      expect(Number(rows[0].count)).toBe(3);
    });
  });
});
