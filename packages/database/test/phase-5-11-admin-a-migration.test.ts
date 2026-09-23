import path from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";
import { ADMIN_PERMISSION_ACTIONS } from "../src/schema/state-values";

const DB = "kolbe_phase_5_11_admin_a_migration_test";

const RETAIL_ACTIONS = [
  "retail:dashboard:view",
  "retail:order:view",
  "retail:order:manage",
  "retail:order:cancel",
  "retail:inventory:view",
  "retail:inventory:manage",
  "retail:return:view",
  "retail:return:manage",
  "retail:refund:view",
  "retail:refund:manage",
  "retail:review:view",
  "retail:review:moderate",
  "retail:customer:view",
  "retail:customer:manage",
  "retail:catalog:view",
  "retail:catalog:manage",
  "retail:promotion:view",
  "retail:finance:view",
] as const;

describe("Phase 5.11-A (admin tranche) migration 0044: retail permission catalog", () => {
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

  it("adds no tables itself (199 at head: 0045 adds the suspicious-flag table; 0044 is CHECK-only)", async () => {
    await withClient(DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(199);
    });
  });

  it("catalogs exactly the 18 retail actions (83 total, drift-guarded)", async () => {
    expect(ADMIN_PERMISSION_ACTIONS).toHaveLength(83);
    for (const action of RETAIL_ACTIONS) {
      expect(ADMIN_PERMISSION_ACTIONS).toContain(action);
    }
  });

  it("admits every retail action and rejects uncataloged actions", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO admin_role (id, name, display_name) VALUES ('m44_role', 'm44', 'm44')`);
      for (const [i, action] of RETAIL_ACTIONS.entries()) {
        await client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ($1, 'm44_role', $2)`, [`m44_${i}`, action]);
      }
      const { rows } = await client.query(`SELECT count(*)::int AS c FROM admin_role_permission WHERE role_id = 'm44_role'`);
      expect(rows[0].c).toBe(18);
      await expect(client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ('m44_bogus', 'm44_role', 'retail:order:nuke')`)).rejects.toMatchObject({ code: "23514" });
      await client.query(`DELETE FROM admin_role_permission WHERE role_id = 'm44_role'`);
      await client.query(`DELETE FROM admin_role WHERE id = 'm44_role'`);
    });
  });

  it("0044 sits at journal idx 44 (head has moved to 0045)", async () => {
    const journal = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "migrations", "meta", "_journal.json"), "utf8"));
    expect(journal.entries[44]).toMatchObject({ idx: 44, tag: "0044_phase_5_11_a_retail_permissions" });
  });
});
