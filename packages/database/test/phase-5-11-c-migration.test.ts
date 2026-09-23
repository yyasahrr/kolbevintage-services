import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";

const DB = "kolbe_phase_5_11_c_migration_test";

describe("Phase 5.11-C migration 0043: staff queue indexes", () => {
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
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("adds no tables (198, staff queues are index-only)", async () => {
    await withClient(DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(198);
    });
  });

  it("creates the order status/payment queue btrees with keyset tails", async () => {
    await withClient(DB, async (client) => {
      for (const [name, head] of [["retail_order_status_created", "order_status"], ["retail_order_payment_created", "payment_status"]] as const) {
        const { rows } = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [name]);
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toMatch(/USING btree/);
        expect(rows[0].indexdef).toMatch(new RegExp(`${head}.*created_at.*\\bid\\b`));
      }
    });
  });

  it("creates the return status queue btree with a keyset tail", async () => {
    await withClient(DB, async (client) => {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'retail_return_request_status_created'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/USING btree/);
      expect(rows[0].indexdef).toMatch(/status.*created_at.*\bid\b/);
    });
  });

  it("creates the retail-only partial refund queue btree", async () => {
    await withClient(DB, async (client) => {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'refund_retail_status_created'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/USING btree/);
      expect(rows[0].indexdef).toMatch(/status.*created_at.*\bid\b/);
      expect(rows[0].indexdef).toMatch(/WHERE.*retail_order_id IS NOT NULL/);
    });
  });
});
