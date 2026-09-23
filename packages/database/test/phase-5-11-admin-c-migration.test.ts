import path from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL } from "./helpers";
import { dropDatabase, ensurePostgres, migrateOrFail, withClient } from "./helpers";
import { ADMIN_NOTE_TARGET_TYPES } from "../src/schema/state-values";

const DB = "kolbe_phase_5_11_admin_c_migration_test";

describe("Phase 5.11-C (admin tranche) migration 0045: suspicious-flag table + retail note targets", () => {
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

  it("remains present before reconciliation migration 0046 (47 entries) with 199 tables", async () => {
    const journal = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "migrations", "meta", "_journal.json"), "utf8"));
    expect(journal.entries).toHaveLength(47);
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 45, tag: "0045_phase_5_11_c_admin_security" }));
    await withClient(DB, async (client) => {
      const tables = await client.query(
        `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      expect(tables.rows[0].c).toBe(199);
    });
  });

  it("enforces one live flag row per order, non-empty reasons, and real FK targets", async () => {
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('m45_u', 'm45@t', 'h', 's', 'admin', 'active', 0, 0)`,
      );
      await client.query(`INSERT INTO retail_order (id, order_code, customer_name, phone) VALUES ('m45_o', 'M45', 'n', 'p')`);
      await client.query(
        `INSERT INTO retail_order_suspicious_flag (id, retail_order_id, reason, flagged_by) VALUES ('m45_f1', 'm45_o', 'looks odd', 'm45_u')`,
      );
      await expect(
        client.query(`INSERT INTO retail_order_suspicious_flag (id, retail_order_id, reason, flagged_by) VALUES ('m45_f2', 'm45_o', 'again', 'm45_u')`),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        client.query(`INSERT INTO retail_order_suspicious_flag (id, retail_order_id, reason, flagged_by) VALUES ('m45_f3', 'm45_o', '', 'm45_u')`),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(`INSERT INTO retail_order_suspicious_flag (id, retail_order_id, reason, flagged_by) VALUES ('m45_f4', 'm45_ghost', 'x', 'm45_u')`),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query(`DELETE FROM retail_order_suspicious_flag WHERE id = 'm45_f1'`);
      await client.query(`DELETE FROM retail_order WHERE id = 'm45_o'`);
      await client.query(`DELETE FROM account_user WHERE id = 'm45_u'`);
    });
  });

  it("admits the two retail note targets and still rejects uncataloged ones", async () => {
    expect(ADMIN_NOTE_TARGET_TYPES).toContain("retail_order");
    expect(ADMIN_NOTE_TARGET_TYPES).toContain("retail_customer");
    expect(ADMIN_NOTE_TARGET_TYPES).toHaveLength(7);
    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO account_user (id, email, password_hash, salt, role, status, token_version, failed_login_attempts) VALUES ('m45_au', 'm45a@t', 'h', 's', 'admin', 'active', 0, 0)`,
      );
      await client.query(`INSERT INTO admin_internal_note (id, target_type, target_id, author_id, note_text) VALUES ('m45_n1', 'retail_order', 'o', 'm45_au', 'watch')`);
      await client.query(`INSERT INTO admin_internal_note (id, target_type, target_id, author_id, note_text) VALUES ('m45_n2', 'retail_customer', 'c', 'm45_au', 'vip?')`);
      await expect(
        client.query(`INSERT INTO admin_internal_note (id, target_type, target_id, author_id, note_text) VALUES ('m45_n3', 'retail_nuke', 'x', 'm45_au', 'x')`),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(`DELETE FROM admin_internal_note WHERE id IN ('m45_n1', 'm45_n2')`);
      await client.query(`DELETE FROM account_user WHERE id = 'm45_au'`);
    });
  });
});
