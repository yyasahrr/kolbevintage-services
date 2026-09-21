import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

const DB = "kolbe_phase_5_7_promotions_migration_test";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function seedCore() {
  await withClient(DB, async (client) => {
    await client.query(`
      INSERT INTO account_user (id, email, password_hash, salt, role, status)
      VALUES ('p57_admin', 'p57-admin@test.invalid', 'hash', 'salt', 'admin', 'active')
    `);
    await client.query(`
      INSERT INTO promotion (id, promotion_key, channel, status, created_by)
      VALUES ('p57_promo', 'P57.TEST', 'RETAIL', 'DRAFT', 'p57_admin')
    `);
    await client.query(`
      INSERT INTO promotion_revision (id, promotion_id, revision_number, status, stacking_policy, priority, coupon_required, terms_hash, created_by)
      VALUES ('p57_rev1', 'p57_promo', 1, 'DRAFT', 'STACKABLE', 100, false, '${HASH_A}', 'p57_admin')
    `);
  });
}

describe("Phase 5.7 PostgreSQL migration and invariants", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
    await seedCore();
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("creates the bounded promotions surface", async () => {
    const result = await withClient(DB, (client) =>
      client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'promotion%'
         ORDER BY table_name`,
      ),
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      "promotion",
      "promotion_benefit",
      "promotion_coupon",
      "promotion_coupon_redemption",
      "promotion_revision",
      "promotion_schedule",
      "promotion_target",
      "promotion_usage",
    ]);
  });

  it("extends the admin permission and approval state checks additively", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO admin_role (id, name, display_name) VALUES ('p57_role', 'p57_role', 'P57')`);
      for (const action of ["promotion:view", "promotion:create", "promotion:edit", "promotion:publish", "promotion:pause", "promotion:coupon:manage"]) {
        await client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ('p57_perm_${action.replace(/:/g, "_")}', 'p57_role', '${action}')`);
      }
      await expect(
        client.query(`INSERT INTO admin_role_permission (id, role_id, action) VALUES ('p57_perm_bad', 'p57_role', 'promotion:nuke')`),
      ).rejects.toThrow();
      await client.query(
        `INSERT INTO approval_request (id, request_type, target_type, target_id, maker_id, payload, idempotency_key)
         VALUES ('p57_approval', 'PROMOTION_PUBLISH', 'promotion_revision', 'p57_rev1', 'p57_admin', '{}'::jsonb, 'p57-approval-key')`,
      );
    });
  });

  it("rejects malformed commercial shapes at the database layer", async () => {
    await withClient(DB, async (client) => {
      // Bad scope pairing: FIXED must be ORDER-scoped.
      await expect(
        client.query(`INSERT INTO promotion_benefit (id, revision_id, benefit_type, scope, amount) VALUES ('p57_bad_b1', 'p57_rev1', 'FIXED_AMOUNT_DISCOUNT', 'LINE', 1000)`),
      ).rejects.toThrow();
      // FREE_SHIPPING carries no amount.
      await expect(
        client.query(`INSERT INTO promotion_benefit (id, revision_id, benefit_type, scope, amount) VALUES ('p57_bad_b2', 'p57_rev1', 'FREE_SHIPPING', 'SHIPPING', 1000)`),
      ).rejects.toThrow();
      // Basis points out of range.
      await expect(
        client.query(`INSERT INTO promotion_benefit (id, revision_id, benefit_type, scope, percent_bps) VALUES ('p57_bad_b3', 'p57_rev1', 'PERCENT_DISCOUNT', 'LINE', 10001)`),
      ).rejects.toThrow();
      // Target with no value payload.
      await expect(
        client.query(`INSERT INTO promotion_target (id, revision_id, target_type) VALUES ('p57_bad_t1', 'p57_rev1', 'PRODUCT')`),
      ).rejects.toThrow();
      // Target mixing scalar payloads from two dimensions.
      await expect(
        client.query(`INSERT INTO promotion_target (id, revision_id, target_type, min_subtotal, min_quantity) VALUES ('p57_bad_t2', 'p57_rev1', 'MIN_SUBTOTAL', 1000, 2)`),
      ).rejects.toThrow();
      // CHANNEL reference outside the channel vocabulary.
      await expect(
        client.query(`INSERT INTO promotion_target (id, revision_id, target_type, reference_id) VALUES ('p57_bad_t3', 'p57_rev1', 'CHANNEL', 'SMS')`),
      ).rejects.toThrow();
      // Ledger amounts must be consistent: discount <= base, final = base - discount.
      await client.query(
        `INSERT INTO promotion_coupon (id, promotion_id, code, code_normalized, created_by) VALUES ('p57_coupon', 'p57_promo', 'P57-10', 'P57-10', 'p57_admin')`,
      );
      await expect(
        client.query(
          `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, channel, customer_key, base_amount, discount_amount, final_amount, evaluation_hash, idempotency_key)
           VALUES ('p57_bad_r1', 'p57_coupon', 'p57_promo', 'p57_rev1', 'RETAIL', 'user:x', 1000, 1500, -500, '${HASH_A}', 'k1')`,
        ),
      ).rejects.toThrow();
      // Normalized code must be globally unique.
      await expect(
        client.query(`INSERT INTO promotion_coupon (id, promotion_id, code, code_normalized, created_by) VALUES ('p57_coupon_dup', 'p57_promo', 'p57-10', 'P57-10', 'p57_admin')`),
      ).rejects.toThrow();
    });
  });

  it("freezes published revisions and their terms, and keeps ledgers append-only", async () => {
    await withClient(DB, async (client) => {
      await client.query(`INSERT INTO promotion_target (id, revision_id, target_type, reference_id) VALUES ('p57_t_product', 'p57_rev1', 'PRODUCT', 'prod_1')`);
      await client.query(`INSERT INTO promotion_benefit (id, revision_id, benefit_type, scope, percent_bps) VALUES ('p57_b_pct', 'p57_rev1', 'PERCENT_DISCOUNT', 'LINE', 1500)`);
      // Publish the revision (service would also flip the promotion pointer atomically).
      await client.query(`UPDATE promotion_revision SET status = 'PUBLISHED', published_at = now(), published_by = 'p57_admin' WHERE id = 'p57_rev1'`);
      await client.query(`UPDATE promotion SET status = 'ACTIVE', current_published_revision_id = 'p57_rev1' WHERE id = 'p57_promo'`);

      // Commercial terms can no longer be mutated…
      await expect(client.query(`UPDATE promotion_revision SET priority = 1 WHERE id = 'p57_rev1'`)).rejects.toThrow();
      await expect(client.query(`UPDATE promotion_revision SET status = 'DRAFT' WHERE id = 'p57_rev1'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM promotion_revision WHERE id = 'p57_rev1'`)).rejects.toThrow();
      // …nor can its targets/benefits…
      await expect(client.query(`INSERT INTO promotion_target (id, revision_id, target_type, reference_id) VALUES ('p57_t_late', 'p57_rev1', 'PRODUCT', 'prod_2')`)).rejects.toThrow();
      await expect(client.query(`UPDATE promotion_benefit SET percent_bps = 100 WHERE id = 'p57_b_pct'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM promotion_target WHERE id = 'p57_t_product'`)).rejects.toThrow();
      // …but supersede (publish of a successor) stays legal.
      await client.query(
        `INSERT INTO promotion_revision (id, promotion_id, revision_number, status, terms_hash, created_by) VALUES ('p57_rev2', 'p57_promo', 2, 'DRAFT', '${HASH_B}', 'p57_admin')`,
      );
      await client.query(`UPDATE promotion_revision SET status = 'SUPERSEDED' WHERE id = 'p57_rev1'`);

      // Ledger rows are append-only.
      await client.query(
        `INSERT INTO promotion_coupon_redemption (id, coupon_id, promotion_id, revision_id, channel, customer_key, base_amount, discount_amount, final_amount, evaluation_hash, idempotency_key)
         VALUES ('p57_red1', 'p57_coupon', 'p57_promo', 'p57_rev1', 'RETAIL', 'user:x', 10000, 1500, 8500, '${HASH_A}', 'p57-red-1')`,
      );
      await expect(client.query(`UPDATE promotion_coupon_redemption SET discount_amount = 0 WHERE id = 'p57_red1'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM promotion_coupon_redemption WHERE id = 'p57_red1'`)).rejects.toThrow();
      await client.query(
        `INSERT INTO promotion_usage (id, promotion_id, revision_id, channel, customer_key, base_amount, discount_amount, final_amount, evaluation_hash, idempotency_key)
         VALUES ('p57_use1', 'p57_promo', 'p57_rev1', 'RETAIL', 'user:y', 5000, 500, 4500, '${HASH_A}', 'p57-use-1')`,
      );
      await expect(client.query(`DELETE FROM promotion_usage WHERE id = 'p57_use1'`)).rejects.toThrow();

      // Coupon identity columns are immutable; operational columns stay mutable.
      await expect(client.query(`UPDATE promotion_coupon SET code_normalized = 'OTHER' WHERE id = 'p57_coupon'`)).rejects.toThrow();
      await client.query(`UPDATE promotion_coupon SET status = 'DISABLED', redeemed_count = 1 WHERE id = 'p57_coupon'`);

      // History is RESTRICT-protected.
      await expect(client.query(`DELETE FROM promotion WHERE id = 'p57_promo'`)).rejects.toThrow();
      await expect(client.query(`DELETE FROM promotion_coupon WHERE id = 'p57_coupon'`)).rejects.toThrow();
    });
  });
});
