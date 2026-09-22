import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";

const DB = "kolbe_phase_5_10_a_migration_test";

describe("Phase 5.10-A migration 0040: trigram search foundation", () => {
  beforeAll(async () => {
    ensurePostgres();
    // Unicode CTYPE: pg_trgm cannot tokenize Persian under a C locale
    // (deployment requirement, pinned here so the suite proves the engine).
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

  it("enables pg_trgm and adds no tables (198, search is index-only)", async () => {
    await withClient(DB, async (client) => {
      const ext = await client.query(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`);
      expect(ext.rows).toHaveLength(1);
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(198);
    });
  });

  it("creates the four trigram GIN indexes with the trgm opclass", async () => {
    await withClient(DB, async (client) => {
      for (const name of ["product_name_trgm", "product_slug_trgm", "brand_name_trgm", "category_name_trgm"]) {
        const { rows } = await client.query(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
          [name],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].indexdef).toMatch(/USING gin/);
        expect(rows[0].indexdef).toMatch(/gin_trgm_ops/);
      }
    });
  });

  it("creates the channel-fence btree on (status, owner_type)", async () => {
    await withClient(DB, async (client) => {
      const { rows } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'product_status_owner_channel'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toMatch(/USING btree/);
      expect(rows[0].indexdef).toMatch(/status.*owner_type/);
    });
  });

  it("similarity() works over Persian text (script-agnostic recall)", async () => {
    await withClient(DB, async (client) => {
      const { rows } = await client.query(
        `SELECT similarity(v.s, v.s) AS exact, similarity('کتری', v.s) AS part FROM (VALUES ('کتری مسی')) AS v(s)`,
      );
      expect(Number(rows[0].exact)).toBe(1);
      expect(Number(rows[0].part)).toBeGreaterThan(0.18);
    });
  });
});
