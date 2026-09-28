import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_5_analytics_migration_test";

describe("Phase 5.5 — analytics metadata migration", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("adds only the three analytics-owned operational tables and leaves earlier migration files untouched", async () => {
    const rows = await withClient(DB, (client) => client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'analytics_%'
       ORDER BY table_name`,
    ));
    expect(rows.rows.map((row) => row.table_name)).toEqual([
      "analytics_export_job",
      "analytics_report_run",
      "analytics_saved_report",
    ]);
  });

  it("enforces allowlisted scopes/statuses and bounded export rows at PostgreSQL", async () => {
    await expect(withClient(DB, (client) => client.query(
      `INSERT INTO analytics_saved_report (id, name, report_type, scope, definition, owner_id)
       VALUES ('bad_report', 'bad', 'SAVED_REPORT', 'CROSS_TENANT', '{}'::jsonb, 'missing_user')`,
    ))).rejects.toThrow();

    await withClient(DB, async (client) => {
      await client.query(
        `INSERT INTO account_user (id, email, password_hash, salt, role, status)
         VALUES ('analytics_owner', 'analytics-owner@test.invalid', 'hash', 'salt', 'admin', 'active')`,
      );
      await client.query(
        `INSERT INTO analytics_saved_report (id, name, report_type, scope, definition, owner_id)
         VALUES ('valid_report', 'valid', 'SAVED_REPORT', 'PLATFORM', '{}'::jsonb, 'analytics_owner')`,
      );
      await expect(client.query(
        `INSERT INTO analytics_export_job
         (id, report_run_id, format, status, row_limit, file_name, requested_by, expires_at)
         VALUES ('bad_export', 'missing_run', 'CSV', 'QUEUED', 10001, 'bad.csv', 'analytics_owner', now() + interval '1 hour')`,
      )).rejects.toThrow();
    });
  });

  it("keeps report and export metadata foreign-keyed with RESTRICT semantics", async () => {
    const rows = await withClient(DB, (client) => client.query<{ table_name: string; conname: string; delete_rule: string }>(
      `SELECT cls.relname AS table_name, con.conname, con.confdeltype
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       WHERE con.contype = 'f'
         AND cls.relname LIKE 'analytics_%'
       ORDER BY cls.relname, con.conname`,
    ));
    expect(rows.rows.length).toBe(4);
    expect(rows.rows.every((row) => row.conname.startsWith("analytics_"))).toBe(true);
  });
});
