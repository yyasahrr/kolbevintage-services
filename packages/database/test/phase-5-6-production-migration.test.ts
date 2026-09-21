import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient, urlFor } from "./helpers";
import { Client } from "pg";

const DB = "kolbe_phase_5_6_production_migration_test";

async function seedCore() {
  await withClient(DB, async (client) => {
    await client.query(`
      INSERT INTO account_user (id, email, password_hash, salt, role, status)
      VALUES ('p56_admin', 'p56-admin@test.invalid', 'hash', 'salt', 'admin', 'active'),
             ('p56_maker', 'p56-maker@test.invalid', 'hash', 'salt', 'supplier', 'active'),
             ('p56_checker', 'p56-checker@test.invalid', 'hash', 'salt', 'admin', 'active')
    `);
    await client.query(`INSERT INTO supplier (id, legal_name, display_name, status) VALUES ('p56_supplier', 'P56 Supplier', 'P56 Supplier', 'approved')`);
    await client.query(`INSERT INTO seller (id, type, supplier_id, display_name, status) VALUES ('p56_seller', 'SUPPLIER', 'p56_supplier', 'P56 Seller', 'active')`);
    await client.query(`INSERT INTO purchase_order (id, order_code, seller_id, supplier_id, status, currency) VALUES ('p56_po', 'P56-PO', 'p56_seller', 'p56_supplier', 'confirmed', 'IRR')`);
    await client.query(`INSERT INTO production_job (id, purchase_order_id, supplier_id, seller_id, purchase_order_version, status, target_units, created_by) VALUES ('p56_job', 'p56_po', 'p56_supplier', 'p56_seller', 0, 'draft', 10, 'p56_admin')`);
  });
}

describe("Phase 5.6 PostgreSQL migration and invariants", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedCore();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("creates the bounded production surface and the recall approval state", async () => {
    const result = await withClient(DB, (client) => client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND (table_name LIKE 'production_%' OR table_name LIKE 'quality_%' OR table_name LIKE 'supplier_capability' OR table_name LIKE 'supplier_capacity_period' OR table_name LIKE 'supplier_closure')
       ORDER BY table_name`,
    ));
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "production_artifact",
      "production_capacity_reservation",
      "production_change_decision",
      "production_change_request",
      "production_command",
      "production_event",
      "production_job",
      "production_job_history",
      "production_job_milestone",
      "production_lot",
      "production_lot_trace",
      "production_milestone_definition",
      "production_recall",
      "production_recall_approval",
      "production_recall_scope",
      "production_sample",
      "production_sample_review",
      "production_sample_revision",
      "quality_checklist",
      "quality_checklist_item",
      "quality_defect",
      "quality_inspection",
      "quality_inspection_item",
      "quality_release",
      "quality_rework",
      "supplier_capability",
      "supplier_capacity_period",
      "supplier_closure",
    ]);
    await withClient(DB, (client) => client.query(
      `INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, payload, idempotency_key)
       VALUES ('p56_approval', 'PRODUCTION_RECALL', 'production_recall', 'p56_recall', 'p56_maker', '{}'::jsonb, 'p56-approval-key')`,
    ));
  });

  it("keeps recall maker-checker approval append-only and checker-distinct", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO production_recall (id, supplier_id, job_id, severity, scope_type, status, reason, approval_request_id, maker_id) VALUES ('p56_recall', 'p56_supplier', 'p56_job', 'critical', 'lot', 'pending_approval', 'P56 test recall', 'p56_approval', 'p56_maker')`);
      await expect(client.query(`INSERT INTO production_recall_approval (id, recall_id, approval_request_id, decision, maker_id, checker_id) VALUES ('p56_bad_approval', 'p56_recall', 'p56_approval', 'approved', 'p56_maker', 'p56_maker')`)).rejects.toThrow();
      await client.query(`INSERT INTO production_recall_approval (id, recall_id, approval_request_id, decision, maker_id, checker_id) VALUES ('p56_good_approval', 'p56_recall', 'p56_approval', 'rejected', 'p56_maker', 'p56_checker')`);
      await expect(client.query(`UPDATE production_recall_approval SET notes = 'tampered' WHERE id = 'p56_good_approval'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM production_recall_approval WHERE id = 'p56_good_approval'`)).rejects.toThrow();
    });
  });

  it("enforces integer capacity bounds and serializes a real concurrent over-reservation", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO supplier_capacity_period (id, supplier_id, starts_at, ends_at, declared_units, created_by) VALUES ('p56_period', 'p56_supplier', now(), now() + interval '1 day', 10, 'p56_admin')`);
      await expect(client.query(`UPDATE supplier_capacity_period SET reserved_units = 11 WHERE id = 'p56_period'`)).rejects.toThrow();
      await client.query(`UPDATE supplier_capacity_period SET reserved_units = 0 WHERE id = 'p56_period'`);
    });

    const first = new Client({ connectionString: urlFor(DB) });
    const second = new Client({ connectionString: urlFor(DB) });
    await first.connect();
    await second.connect();
    try {
      await first.query("BEGIN");
      await first.query(`UPDATE supplier_capacity_period SET reserved_units = reserved_units + 6 WHERE id = 'p56_period'`);
      await second.query("BEGIN");
      const secondUpdate = second.query(`UPDATE supplier_capacity_period SET reserved_units = reserved_units + 6 WHERE id = 'p56_period'`);
      await first.query("COMMIT");
      await expect(secondUpdate).rejects.toThrow();
      await second.query("ROLLBACK");
    } finally {
      await first.end();
      await second.end();
    }
  });

  it("rejects unsafe artifacts and mutating approved sample evidence at PostgreSQL", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`INSERT INTO production_artifact (id, job_id, artifact_type, object_key, mime_type, byte_size, checksum_sha256, created_by) VALUES ('p56_artifact', 'p56_job', 'other', 'production/p56/evidence', 'application/x-executable', 10, repeat('a', 64), 'p56_admin')`)).rejects.toThrow();
      await client.query(`INSERT INTO production_sample (id, job_id, sample_type, title, created_by) VALUES ('p56_sample', 'p56_job', 'final', 'Final', 'p56_maker')`);
      await client.query(`INSERT INTO production_sample_revision (id, sample_id, revision_number, submitted_by) VALUES ('p56_revision', 'p56_sample', 1, 'p56_maker')`);
      await client.query(`UPDATE production_sample_revision SET status = 'approved', approved_at = now() WHERE id = 'p56_revision'`);
      await expect(client.query(`UPDATE production_sample_revision SET notes = 'tampered' WHERE id = 'p56_revision'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM production_sample_revision WHERE id = 'p56_revision'`)).rejects.toThrow();
      await client.query(`INSERT INTO production_sample_review (id, sample_revision_id, decision, reviewed_by) VALUES ('p56_review', 'p56_revision', 'approved', 'p56_admin')`);
      await expect(client.query(`UPDATE production_sample_review SET notes = 'tampered' WHERE id = 'p56_review'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM production_sample_review WHERE id = 'p56_review'`)).rejects.toThrow();
    });
  });

  it("enforces QC arithmetic and immutable append-only evidence rows", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO production_lot (id, job_id, purchase_order_id, lot_code, planned_units, created_by) VALUES ('p56_lot', 'p56_job', 'p56_po', 'P56-LOT', 10, 'p56_admin')`);
      await expect(client.query(`INSERT INTO production_recall_scope (id, recall_id) VALUES ('p56_scope_bad', 'p56_recall')`)).rejects.toThrow();
      await client.query(`INSERT INTO production_recall_scope (id, recall_id, lot_id, quantity) VALUES ('p56_scope', 'p56_recall', 'p56_lot', 10)`);
      await client.query(`INSERT INTO quality_checklist (id, checklist_key, version, name, status, created_by) VALUES ('p56_checklist', 'p56-checklist', 1, 'P56 checklist', 'published', 'p56_admin')`);
      await client.query(`INSERT INTO quality_checklist_item (id, checklist_id, item_key, label, sequence, measurement_type) VALUES ('p56_check_item', 'p56_checklist', 'count', 'Count', 1, 'integer')`);
      await expect(client.query(`UPDATE quality_checklist SET name = 'tampered' WHERE id = 'p56_checklist'`)).rejects.toThrow();
      await expect(client.query(`UPDATE quality_checklist_item SET label = 'tampered' WHERE id = 'p56_check_item'`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO quality_inspection (id, job_id, lot_id, checklist_id, checklist_version, status, sample_size, accepted_units, defect_units, rework_units, rejected_units, created_by) VALUES ('p56_inspection_bad', 'p56_job', 'p56_lot', 'p56_checklist', 1, 'accepted', 10, 10, 1, 0, 0, 'p56_admin')`)).rejects.toThrow();
      await client.query(`INSERT INTO quality_inspection (id, job_id, lot_id, checklist_id, checklist_version, status, sample_size, accepted_units, defect_units, rework_units, rejected_units, defect_rate_bps, pass_rate_bps, decision, submitted_by, created_by) VALUES ('p56_inspection', 'p56_job', 'p56_lot', 'p56_checklist', 1, 'accepted', 1, 1, 0, 0, 0, 0, 10000, 'accepted', 'p56_admin', 'p56_admin')`);
      await client.query(`INSERT INTO quality_inspection_item (id, inspection_id, checklist_item_id, item_key_snapshot, measurement_type_snapshot, observed_integer, passed) VALUES ('p56_inspection_item', 'p56_inspection', 'p56_check_item', 'count', 'integer', 1, true)`);
      await expect(client.query(`UPDATE quality_inspection SET updated_at = now() WHERE id = 'p56_inspection'`)).rejects.toThrow();
      await client.query(`INSERT INTO production_event (id, event_type, source_entity_type, source_entity_id, job_id, supplier_id, payload) VALUES ('p56_event', 'JOB_CREATED', 'production_job', 'p56_job', 'p56_job', 'p56_supplier', '{}'::jsonb)`);
      await expect(client.query(`UPDATE production_event SET payload = '{"changed":true}'::jsonb WHERE id = 'p56_event'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM production_event WHERE id = 'p56_event'`)).rejects.toThrow();
    });
  });
});
