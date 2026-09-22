import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_7_promotions_migration_test";

async function seedBase() {
  await withClient(DB, async (client) => {
    await client.query(`INSERT INTO promotion (id, code, title, channel, status, created_by) VALUES ('p57_promo', 'P57MIG', 'Migration promo', 'RETAIL', 'ACTIVE', 'p57_seeder')`);
    await client.query(
      `INSERT INTO promotion_revision (id, promotion_id, revision_number, status, benefit_type, benefit_scope, percent_bps, stacking_policy, terms_hash, created_by)
       VALUES ('p57_rev', 'p57_promo', 1, 'PUBLISHED', 'PERCENT_DISCOUNT', 'ORDER', 1000, 'STACKABLE', 'terms', 'p57_seeder')`,
    );
    await client.query(`UPDATE promotion SET current_published_revision_id = 'p57_rev' WHERE id = 'p57_promo'`);
    await client.query(
      `INSERT INTO promotion_coupon (id, promotion_id, revision_id, code, code_normalized, usage_limit, created_by)
       VALUES ('p57_coupon', 'p57_promo', 'p57_rev', 'MIG-1', 'MIG-1', 10, 'p57_seeder')`,
    );
    await client.query(`INSERT INTO admin_role (id, name, display_name) VALUES ('p57_role', 'p57_role', 'P57 role')`);
  });
}

describe("Phase 5.7 PostgreSQL migration and invariants", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedBase();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("creates the seven promotion tables (journal idx 41 at the 5.10-B head; 0038 adds the return aggregate, 0039 alters the refund engine in place, 0040/0041 add search/browse indexes only)", async () => {
    const result = await withClient(DB, (client) => client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'promotion%'
       ORDER BY table_name`,
    ));
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "promotion",
      "promotion_coupon",
      "promotion_coupon_redemption",
      "promotion_revision",
      "promotion_schedule",
      "promotion_target",
      "promotion_usage",
    ]);
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
    expect(journal.entries).toHaveLength(42);
    expect(journal.entries[journal.entries.length - 1]).toMatchObject({
      idx: 41,
      tag: "0041_phase_5_10_b_browse_filters",
    });
  });

  it("extends the admin action catalog with the six promotion actions", async () => {
    await withClient(DB, async (client) => {
      for (const [index, action] of ["promotion:view", "promotion:create", "promotion:edit", "promotion:publish", "promotion:pause", "promotion:coupon:manage"].entries()) {
        await client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ($1, 'p57_role', $2)`, [`p57_perm_${index}`, action]);
      }
      await expect(client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ('p57_perm_bad', 'p57_role', 'promotion:nuke')`)).rejects.toThrow(/action_allowed/);
      const check = await client.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'admin_role_permission_action_allowed'`,
      );
      expect(check.rows[0].definition).toContain("promotion:coupon:manage");
    });
  });

  it("enforces benefit and target coherence at the database layer", async () => {
    await withClient(DB, async (client) => {
      // Percent with an amount is incoherent.
      await expect(client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, percent_bps, amount, stacking_policy, terms_hash)
         VALUES ('p57_bad_rev', 'p57_promo', 2, 'PERCENT_DISCOUNT', 'ORDER', 1000, 500, 'STACKABLE', 'x')`,
      )).rejects.toThrow(/benefit_coherent/);
      // Fixed amount outside ORDER scope is incoherent.
      await expect(client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, amount, stacking_policy, terms_hash)
         VALUES ('p57_bad_rev2', 'p57_promo', 2, 'FIXED_AMOUNT_DISCOUNT', 'LINE', 500, 'STACKABLE', 'x')`,
      )).rejects.toThrow(/benefit_coherent/);
      // Basis points out of range are rejected.
      await expect(client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, percent_bps, stacking_policy, terms_hash)
         VALUES ('p57_bad_rev3', 'p57_promo', 2, 'PERCENT_DISCOUNT', 'ORDER', 10001, 'STACKABLE', 'x')`,
      )).rejects.toThrow(/bps_range/);
      // Coherence negatives run against a draft revision so the published-terms
      // guard trigger does not mask the CHECK under test.
      await client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, percent_bps, stacking_policy, terms_hash)
         VALUES ('p57_draft_rev', 'p57_promo', 2, 'PERCENT_DISCOUNT', 'ORDER', 500, 'STACKABLE', 'y')`,
      );
      // Threshold target with a text value is incoherent.
      await expect(client.query(
        `INSERT INTO promotion_target (id, revision_id, target_type, value_text, value_quantity)
         VALUES ('p57_bad_tgt', 'p57_draft_rev', 'MIN_QUANTITY', 'oops', 2)`,
      )).rejects.toThrow(/target_value_coherent/);
      // A coherent target on a draft revision succeeds.
      await client.query(`INSERT INTO promotion_target (id, revision_id, target_type, value_quantity) VALUES ('p57_tgt', 'p57_draft_rev', 'MIN_QUANTITY', 2)`);
    });
  });

  it("keeps published commercial terms immutable through triggers", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`UPDATE promotion_revision SET percent_bps = 9999 WHERE id = 'p57_rev'`)).rejects.toThrow(/immutable/);
      await expect(client.query(`DELETE FROM promotion_revision WHERE id = 'p57_rev'`)).rejects.toThrow();
      // Bookkeeping columns (supersede handoff) remain writable by design, but
      // the handoff only moves forward: SUPERSEDED can never become PUBLISHED.
      await client.query(`UPDATE promotion_revision SET status = 'SUPERSEDED', superseded_at = now() WHERE id = 'p57_rev'`);
      await expect(client.query(`UPDATE promotion_revision SET status = 'PUBLISHED' WHERE id = 'p57_rev'`)).rejects.toThrow(/illegal status transition/);
      // Targets of a published revision cannot be added or removed.
      await expect(client.query(
        `INSERT INTO promotion_target (id, revision_id, target_type, value_quantity) VALUES ('p57_sneaky', 'p57_rev', 'MIN_QUANTITY', 9)`,
      )).rejects.toThrow();
      await client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, percent_bps, stacking_policy, terms_hash)
         VALUES ('p57_draft_rev2', 'p57_promo', 3, 'PERCENT_DISCOUNT', 'ORDER', 500, 'STACKABLE', 'z')`,
      );
      await client.query(`INSERT INTO promotion_target (id, revision_id, target_type, value_quantity) VALUES ('p57_tgt2', 'p57_draft_rev2', 'MIN_QUANTITY', 1)`);
      await client.query(`UPDATE promotion_revision SET status = 'PUBLISHED' WHERE id = 'p57_draft_rev2'`);
      await expect(client.query(`DELETE FROM promotion_target WHERE id = 'p57_tgt2'`)).rejects.toThrow();
    });
  });

  it("bounds money, counters, and redemption identity", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`UPDATE promotion_coupon SET used_count = 11 WHERE id = 'p57_coupon'`)).rejects.toThrow(/used_within_limit/);
      await expect(client.query(
        `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_bad_redeem', 'p57_coupon', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u1', 100, 101, 'ord_bad', 'idem_bad')`,
      )).rejects.toThrow(/discount_within_base/);
      await expect(client.query(
        `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, idempotency_key)
         VALUES ('p57_bad_redeem2', 'p57_coupon', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u1', -5, 0, 'idem_bad2')`,
      )).rejects.toThrow(/base_amount_range/);
      // Coupon path dedupes per (coupon, order).
      await client.query(
        `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_redeem_1', 'p57_coupon', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u1', 1000, 100, 'ord_1', 'idem_1')`,
      );
      await expect(client.query(
        `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_redeem_2', 'p57_coupon', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u2', 1000, 100, 'ord_1', 'idem_2')`,
      )).rejects.toThrow(/coupon_order_unique/);
      // Automatic path works without a coupon and dedupes per (revision, order).
      await client.query(
        `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_redeem_3', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u3', 1000, 100, 'ord_2', 'idem_3')`,
      );
      await expect(client.query(
        `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_redeem_4', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u4', 1000, 100, 'ord_2', 'idem_4')`,
      )).rejects.toThrow(/auto_order_unique/);
    });
  });

  it("keeps promotion history RESTRICT-linked and schedules bounded", async () => {
    await withClient(DB, async (client) => {
      await expect(client.query(`DELETE FROM promotion WHERE id = 'p57_promo'`)).rejects.toThrow(/restrict|violates foreign key/i);
      await client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, benefit_type, benefit_scope, percent_bps, stacking_policy, terms_hash)
         VALUES ('p57_restrict_rev', 'p57_promo', 9, 'PERCENT_DISCOUNT', 'ORDER', 500, 'STACKABLE', 'w')`,
      );
      await client.query(`INSERT INTO promotion_target (id, revision_id, target_type, value_quantity) VALUES ('p57_restrict_tgt', 'p57_restrict_rev', 'MIN_QUANTITY', 1)`);
      await expect(client.query(`DELETE FROM promotion_revision WHERE id = 'p57_restrict_rev'`)).rejects.toThrow(/restrict|violates foreign key/i);
      await expect(client.query(
        `INSERT INTO promotion_schedule (id, promotion_id, revision_id, action, status, run_at, idempotency_key, attempts, created_by)
         VALUES ('p57_bad_sched', 'p57_promo', 'p57_rev', 'ACTIVATE', 'SCHEDULED', now() + interval '1 hour', 'idem_sched_bad', -1, 'x')`,
      )).rejects.toThrow(/attempts_non_negative/);
      await expect(client.query(
        `INSERT INTO promotion_schedule (id, promotion_id, revision_id, action, status, run_at, idempotency_key, created_by)
         VALUES ('p57_bad_sched2', 'p57_promo', 'p57_rev', 'LAUNCH', 'SCHEDULED', now() + interval '1 hour', 'idem_sched_bad2', 'x')`,
      )).rejects.toThrow(/action_allowed/);
      await client.query(
        `INSERT INTO promotion_schedule (id, promotion_id, revision_id, action, status, run_at, idempotency_key, created_by)
         VALUES ('p57_sched_1', 'p57_promo', 'p57_rev', 'END', 'SCHEDULED', now() + interval '1 hour', 'idem_sched_dup', 'x')`,
      );
      await expect(client.query(
        `INSERT INTO promotion_schedule (id, promotion_id, revision_id, action, status, run_at, idempotency_key, created_by)
         VALUES ('p57_bad_sched3', 'p57_promo', 'p57_rev', 'END', 'SCHEDULED', now() + interval '1 hour', 'idem_sched_dup', 'x')`,
      )).rejects.toThrow(/idempotency_unique/);
    });
  });

  it("migration 0032 extends the approval catalog and binds the ledger to evaluations", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO account_user (id, email, password_hash, salt, role, status) VALUES ('p57_maker', 'p57-maker@test.invalid', 'h', 's', 'admin', 'active')`);
      await client.query(
        `INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, payload, idempotency_key)
         VALUES ('p57_appr_pub', 'PROMOTION_PUBLISH', 'promotion_revision', 'p57_rev', 'p57_maker', '{}'::jsonb, 'p57-appr-pub')`,
      );
      await client.query(
        `INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, payload, idempotency_key)
         VALUES ('p57_appr_pause', 'PROMOTION_PAUSE', 'promotion', 'p57_promo', 'p57_maker', '{}'::jsonb, 'p57-appr-pause')`,
      );
      await expect(client.query(
        `INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, payload, idempotency_key)
         VALUES ('p57_appr_bad', 'PROMOTION_NUKE', 'promotion', 'p57_promo', 'p57_maker', '{}'::jsonb, 'p57-appr-bad')`,
      )).rejects.toThrow(/approval_request_type_allowed/);

      // Evaluation binding columns exist, accept the bound shape, and reject
      // malformed hashes — while staying nullable for pre-0032 rows.
      await client.query(
        `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key, evaluation_version, terms_hash)
         VALUES ('p57_redeem_b', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u9', 1000, 100, 'ord_b', 'idem_b', 'promo-eval-v1', repeat('c', 64))`,
      );
      await expect(client.query(
        `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key, evaluation_version, terms_hash)
         VALUES ('p57_redeem_bad', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u9', 1000, 100, 'ord_bad', 'idem_bad', 'promo-eval-v1', 'ZZZ')`,
      )).rejects.toThrow(/terms_hash_format/);
      await client.query(
        `INSERT INTO promotion_coupon_redemption (id, promotion_id, revision_id, actor_type, actor_ref, base_amount, discount_amount, order_reference, idempotency_key)
         VALUES ('p57_redeem_legacy', 'p57_promo', 'p57_rev', 'RETAIL_CUSTOMER', 'u9', 1000, 100, 'ord_legacy', 'idem_legacy')`,
      );
    });
  });
});
