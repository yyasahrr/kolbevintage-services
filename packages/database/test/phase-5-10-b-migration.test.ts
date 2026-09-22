import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";

const DB = "kolbe_phase_5_10_b_migration_test";

describe("Phase 5.10-B migration 0041: browse filter indexes", () => {
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

  it("adds no tables (198, browse is index-only)", async () => {
    await withClient(DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(198);
    });
  });

  it("creates the (status, category_id) and (status, brand_id) btrees", async () => {
    await withClient(DB, async (client) => {
      for (const [name, col] of [["product_status_category", "category_id"], ["product_status_brand", "brand_id"]] as const) {
        const { rows } = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [name]);
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toMatch(/USING btree/);
        expect(rows[0].indexdef).toMatch(new RegExp(`status.*${col}`));
      }
    });
  });
});
