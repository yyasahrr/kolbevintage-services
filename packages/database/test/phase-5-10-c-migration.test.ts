import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";

const DB = "kolbe_phase_5_10_c_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r510c_user', 'r510c@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('r510c_user2', 'r510c2@test.invalid', 'h', 's', 'customer', 'active')`);
    await client.query(`INSERT INTO product (id, name, slug, status, owner_type) VALUES ('r510c_prod', 'کالای آزمون', 'r510c-prod', 'published', 'KOLBE')`);
    await client.query(
      `INSERT INTO retail_order (id, order_code, customer_id, customer_name, phone, order_status) VALUES ('r510c_ro', 'RC-r510c', 'r510c_user', 'R', '09120000000', 'delivered')`,
    );
    await client.query(
      `INSERT INTO wholesale_account (id, user_id, member_name, store_name, phone, city) VALUES ('r510c_acc', 'r510c_user', 'M', 'S', '09120000000', 'تهران')`,
    );
    await client.query(
      `INSERT INTO wholesale_order (id, order_code, account_id, buyer_user_id, total_units, version, status) VALUES ('r510c_wo', 'WO-r510c', 'r510c_acc', 'r510c_user', 1, 0, 'completed')`,
    );
  });
}

describe("Phase 5.10-C migration 0042: verified-purchase proof on reviews", () => {
  beforeAll(async () => {
    ensurePostgres();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0 LC_COLLATE 'C.utf8' LC_CTYPE 'C.utf8'`);
    } finally {
      await admin.end();
    }
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("adds no tables (199, proof is columns-only)", async () => {
    await withClient(DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(199);
    });
  });

  it("stores a retail-proven review; the XOR fires both ways, FKs fire on ghosts", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO product_rating (id, product_id, rater_id, rating, verified_retail_order_id) VALUES ('r510c_r1', 'r510c_prod', 'r510c_user', 5, 'r510c_ro')`,
      );
      const { rows } = await client.query(`SELECT status, updated_at FROM product_rating WHERE id='r510c_r1'`);
      expect(rows[0].status).toBe("visible");
      expect(rows[0].updated_at).not.toBeNull();
      // Both proofs set: XOR fires.
      await expect(client.query(`UPDATE product_rating SET verified_wholesale_order_id='r510c_wo' WHERE id='r510c_r1'`)).rejects.toThrow(
        /product_rating_single_proof_side/,
      );
      // Neither proof set: XOR fires.
      await expect(client.query(`UPDATE product_rating SET verified_retail_order_id=NULL WHERE id='r510c_r1'`)).rejects.toThrow(
        /product_rating_single_proof_side/,
      );
      // Ghost proofs: the FKs fire (fresh rater so the unique stays out).
      await expect(
        client.query(`INSERT INTO product_rating (id, product_id, rater_id, rating, verified_retail_order_id) VALUES ('r510c_rx', 'r510c_prod', 'r510c_user2', 4, 'ghost')`),
      ).rejects.toThrow(/product_rating_retail_order_fk/);
      await expect(
        client.query(`INSERT INTO product_rating (id, product_id, rater_id, rating, verified_wholesale_order_id) VALUES ('r510c_ry', 'r510c_prod', 'r510c_user2', 4, 'ghost')`),
      ).rejects.toThrow(/product_rating_wholesale_order_fk/);
    });
  });

  it("bounds ratings 1..5, statuses to the trio, and one review per (product, rater)", async () => {
    await withClient(DB, async (client) => {
      await expect(
        client.query(`INSERT INTO product_rating (id, product_id, rater_id, rating, verified_wholesale_order_id) VALUES ('r510c_r2', 'r510c_prod', 'r510c_user2', 0, 'r510c_wo')`),
      ).rejects.toThrow(/product_rating_rating_1_5/);
      await expect(
        client.query(`INSERT INTO product_rating (id, product_id, rater_id, rating, verified_wholesale_order_id) VALUES ('r510c_r3', 'r510c_prod', 'r510c_user2', 6, 'r510c_wo')`),
      ).rejects.toThrow(/product_rating_rating_1_5/);
      await expect(
        client.query(`UPDATE product_rating SET status='pending' WHERE id='r510c_r1'`),
      ).rejects.toThrow(/product_rating_status_allowed/);
      // Second review, same (product, rater), other proof side: the unique fires.
      await expect(
        client.query(`INSERT INTO product_rating (id, product_id, rater_id, rating, verified_wholesale_order_id) VALUES ('r510c_r4', 'r510c_prod', 'r510c_user', 5, 'r510c_wo')`),
      ).rejects.toThrow(/product_rating_product_rater_unique/);
    });
  });
});
