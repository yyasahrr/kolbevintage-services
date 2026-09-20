/**
 * Phase 5.0 — Checkpoint A: Business Control Plane & Versioned Wholesale Plans Test Suite
 *
 * Verifies:
 * 1. Architecture & Domain Ownership Integrity (113 tables, 25 migrations, snapshot consistency).
 * 2. Versioned Wholesale Plan Model (Plan Identity vs Immutable Plan Versions).
 * 3. Feature Matrix with stable keys, typed representations, and JSON configs.
 * 4. Plan Limits with stable keys, BigInt Rial amounts/counts, periods, and enforcement flags.
 * 5. Plan Immutability: Once published, a version cannot be mutated; new versioning works as expected.
 * 6. Database Safety: Check constraints, foreign keys ON DELETE RESTRICT, BIGINT IRR money bounds.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@kolbe/database";
import {
  wholesalePlan,
  wholesalePlanVersion,
  wholesalePlanFeature,
  wholesalePlanLimit,
  accountUser,
} from "@kolbe/database";
import { MODULES } from "../src/modules/registry";
import { WholesalePlanService } from "../src/modules/vip/wholesale-plan.service";
import {
  WholesalePlanNotFoundError,
  WholesalePlanVersionNotFoundError,
  WholesalePlanImmutableError,
  WholesalePlanCodeConflictError,
} from "../src/modules/vip/wholesale-plan.errors";
import {
  bootHarness,
  makeId,
  seedTwoSuppliers,
  type Harness,
  type SupplierContext,
} from "./helpers/phase-4-7-1.harness";

const TEST_DB = "kolbe_phase_5_0_control_plane_test";

let h: Harness;
let ctx: SupplierContext;
let planService: WholesalePlanService;

beforeAll(async () => {
  h = await bootHarness(TEST_DB);
  ctx = await seedTwoSuppliers(h.db, { priceA: 1_000_000n, priceB: 2_000_000n, onHand: 50 });
  planService = h.app.get(WholesalePlanService);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe("Phase 5.0 — Checkpoint A: Domain Ownership & Schema Integrity", () => {
  it("registry assigns exactly the new control plane tables to vip and admin modules", () => {
    const vipMod = MODULES.find((m) => m.name === "vip")!;
    const adminMod = MODULES.find((m) => m.name === "admin")!;

    expect(vipMod.tables).toContain("wholesale_plan");
    expect(vipMod.tables).toContain("wholesale_plan_version");
    expect(vipMod.tables).toContain("wholesale_plan_feature");
    expect(vipMod.tables).toContain("wholesale_plan_limit");
    expect(vipMod.tables).toContain("wholesale_membership");
    expect(vipMod.tables).toContain("wholesale_membership_history");

    expect(adminMod.tables).toContain("admin_role");
    expect(adminMod.tables).toContain("admin_role_permission");
    expect(adminMod.tables).toContain("admin_user_role");
    expect(adminMod.tables).toContain("approval_request");
    expect(adminMod.tables).toContain("business_setting");
    expect(adminMod.tables).toContain("business_setting_history");
    expect(adminMod.tables).toContain("admin_internal_note");
  });

  it("database contains all base tables and migrations are applied", async () => {
    const { rows } = await h.pool.query(
      `SELECT count(*)::int AS cnt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    expect(rows[0].cnt).toBeGreaterThanOrEqual(113);

    const { rows: migRows } = await h.pool.query(
      `SELECT count(*)::int AS cnt FROM drizzle.__drizzle_migrations`,
    );
    expect(migRows[0].cnt).toBeGreaterThanOrEqual(25);
  });

  it("all foreign keys on the new control plane tables enforce ON DELETE RESTRICT", async () => {
    const targetTables = [
      "wholesale_plan_version",
      "wholesale_plan_feature",
      "wholesale_plan_limit",
      "wholesale_membership",
      "wholesale_membership_history",
      "admin_role_permission",
      "admin_user_role",
      "approval_request",
      "business_setting",
      "business_setting_history",
      "admin_internal_note",
    ];

    const { rows } = await h.pool.query(
      `SELECT con.conname, cls.relname AS tbl, con.confdeltype
       FROM pg_constraint con
       JOIN pg_class cls ON cls.oid = con.conrelid
       WHERE con.contype = 'f' AND cls.relname = ANY($1::text[])`,
      [targetTables],
    );

    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) {
      expect(r.confdeltype, `FK ${r.conname} on ${r.tbl} must be RESTRICT (r)`).toBe("r");
    }
  });
});

describe("Phase 5.0 — Versioned Wholesale Plan Creation & Validation", () => {
  it("creates a wholesale plan identity in draft status and prevents duplicate plan codes", async () => {
    const plan = await planService.createPlan(
      {
        code: "pro_partner",
        name: "همکار حرفه‌ای",
        description: "پلن مناسب خرده‌فروشان با حجم خرید متوسط",
        tierLevel: 2,
        sortOrder: 10,
      },
      ctx.userAdmin,
    );

    expect(plan.id).toBeDefined();
    expect(plan.code).toBe("pro_partner");
    expect(plan.name).toBe("همکار حرفه‌ای");
    expect(plan.tierLevel).toBe(2);
    expect(plan.status).toBe("draft");
    expect(plan.currency).toBe("IRR");
    expect(plan.currentPublishedVersionId).toBeNull();

    // Prevent duplicate plan code
    await expect(
      planService.createPlan({ code: "pro_partner", name: "Duplicate" }, ctx.userAdmin),
    ).rejects.toThrow(WholesalePlanCodeConflictError);
  });

  it("creates a draft plan version with base fee, deposit, features and limits", async () => {
    const plan = await planService.createPlan(
      {
        code: "enterprise_vip",
        name: "ویژه VIP سازمانی",
        description: "پلن سطح بالای فروشگاهی و زنجیره‌ای",
        tierLevel: 3,
        sortOrder: 20,
      },
      ctx.userAdmin,
    );

    const version = await planService.createPlanVersion(
      plan.id,
      {
        name: "ویژه VIP سازمانی نسخه تابستان",
        description: "شرایط تجاری سالانه با تخفیف کاتالوگ و تسویه چکی",
        billingPeriod: "annual",
        durationDays: 365,
        baseFee: 240_000_000n, // 24 million Toman = 240M IRR
        depositRequirement: 50_000_000n, // 50M IRR deposit
        changeSummary: "راه‌اندازی نسخه اولیه",
        features: [
          {
            key: "catalog.vip_pricing",
            type: "config",
            isEnabled: true,
            configValue: { discount_pct: 45, exclusive_brands_access: true },
            description: "۴۵ درصد تخفیف کل کاتالوگ و برندهای انحصاری",
          },
          {
            key: "order.rfq_access",
            type: "boolean",
            isEnabled: true,
            description: "امکان ثبت و مذاکره مستقیم روی سفارش‌های کلان",
          },
          {
            key: "support.dedicated_rep",
            type: "boolean",
            isEnabled: true,
            description: "کارشناس و مدیر حساب اختصاصی",
          },
        ],
        limits: [
          {
            key: "min_order_amount",
            value: 100_000_000n, // 10M Toman min order
            period: "order",
            isEnforced: true,
          },
          {
            key: "max_order_amount",
            value: 2_000_000_000n, // 200M Toman max order
            period: "order",
            isEnforced: true,
          },
          {
            key: "max_order_units",
            value: 500n,
            period: "order",
            isEnforced: true,
          },
          {
            key: "max_open_rfqs",
            value: 10n,
            period: "lifetime",
            isEnforced: true,
          },
        ],
      },
      ctx.userAdmin,
    );

    expect(version.id).toBeDefined();
    expect(version.planId).toBe(plan.id);
    expect(version.versionNumber).toBe(1);
    expect(version.status).toBe("draft");
    expect(version.baseFee).toBe(240_000_000n);
    expect(version.depositRequirement).toBe(50_000_000n);
    expect(version.durationDays).toBe(365);
    expect(version.features).toHaveLength(3);
    expect(version.limits).toHaveLength(4);

    const featVip = version.features.find((f: any) => f.featureKey === "catalog.vip_pricing");
    expect(featVip).toBeDefined();
    expect(featVip.configValue.discount_pct).toBe(45);

    const limMin = version.limits.find((l: any) => l.limitKey === "min_order_amount");
    expect(limMin).toBeDefined();
    expect(limMin.limitValue).toBe(100_000_000n);
  });

  it("enforces uniqueness of feature key and limit key within a plan version", async () => {
    const plan = await planService.createPlan({ code: "unique_test", name: "Unique Test" }, ctx.userAdmin);
    const version = await planService.createPlanVersion(
      plan.id,
      {
        features: [{ key: "shipping.free_standard", type: "boolean", isEnabled: true }],
        limits: [{ key: "max_branches", value: 3n, period: "lifetime" }],
      },
      ctx.userAdmin,
    );

    // Adding duplicate feature key must fail
    await expect(
      planService.addFeature(version.id, { key: "shipping.free_standard", type: "boolean" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    // Adding duplicate limit key must fail
    await expect(
      planService.addLimit(version.id, { key: "max_branches", value: 5n }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});

describe("Phase 5.0 — Plan Immutability & Version Separation", () => {
  it("publishing a plan version activates the plan and sets published metadata", async () => {
    const plan = await planService.createPlan(
      { code: "basic_partner", name: "همکار پایه", tierLevel: 1 },
      ctx.userAdmin,
    );
    const version = await planService.createPlanVersion(
      plan.id,
      {
        baseFee: 60_000_000n, // 6M Toman
        features: [{ key: "catalog.vip_pricing", type: "boolean", isEnabled: true }],
        limits: [{ key: "min_order_amount", value: 20_000_000n, period: "order" }],
      },
      ctx.userAdmin,
    );

    expect(version.status).toBe("draft");

    const published = await planService.publishPlanVersion(plan.id, version.id, ctx.userAdmin);
    expect(published.status).toBe("published");
    expect(published.publishedBy).toBe(ctx.userAdmin);
    expect(published.publishedAt).toBeDefined();
    expect(published.effectiveFrom).toBeDefined();

    const planAfter = await planService.getPlan(plan.id);
    expect(planAfter.status).toBe("active");
    expect(planAfter.currentPublishedVersionId).toBe(version.id);
    expect(planAfter.currentPublishedVersion.id).toBe(version.id);
  });

  it("modifying a published version directly is strictly rejected (immutability)", async () => {
    const plan = await planService.createPlan({ code: "immutable_test", name: "Immutable Test" }, ctx.userAdmin);
    const version = await planService.createPlanVersion(
      plan.id,
      {
        features: [{ key: "support.email", type: "boolean" }],
        limits: [{ key: "max_order_units", value: 100n }],
      },
      ctx.userAdmin,
    );

    await planService.publishPlanVersion(plan.id, version.id, ctx.userAdmin);

    // Publishing again fails
    await expect(
      planService.publishPlanVersion(plan.id, version.id, ctx.userAdmin),
    ).rejects.toThrow(WholesalePlanImmutableError);

    // Adding feature to published version fails
    await expect(
      planService.addFeature(version.id, { key: "new_feature", type: "boolean" }),
    ).rejects.toThrow(WholesalePlanImmutableError);

    // Adding limit to published version fails
    await expect(
      planService.addLimit(version.id, { key: "new_limit", value: 200n }),
    ).rejects.toThrow(WholesalePlanImmutableError);
  });

  it("editing a live plan creates a new version; published v1 transitions to superseded upon v2 publication", async () => {
    const plan = await planService.createPlan(
      { code: "evolution_test", name: "پلن رو به رشد" },
      ctx.userAdmin,
    );
    const v1 = await planService.createPlanVersion(
      plan.id,
      {
        name: "نسخه اول",
        baseFee: 100_000_000n,
        features: [{ key: "catalog.vip_pricing", type: "boolean", isEnabled: true }],
        limits: [{ key: "min_order_amount", value: 30_000_000n }],
      },
      ctx.userAdmin,
    );
    await planService.publishPlanVersion(plan.id, v1.id, ctx.userAdmin);

    // Fork a new version v2 from published v1
    const v2Draft = await planService.createNewVersionFromPublished(
      plan.id,
      "افزایش حداقل سفارش و ارتقای خدمات پشتیبانی",
      ctx.userAdmin,
    );

    expect(v2Draft.versionNumber).toBe(2);
    expect(v2Draft.status).toBe("draft");
    expect(v2Draft.changeSummary).toBe("افزایش حداقل سفارش و ارتقای خدمات پشتیبانی");
    expect(v2Draft.features).toHaveLength(1);
    expect(v2Draft.limits).toHaveLength(1);

    // Add new feature and limit to v2 draft
    await planService.addFeature(v2Draft.id, {
      key: "support.dedicated_rep",
      type: "boolean",
      isEnabled: true,
    });
    await planService.addLimit(v2Draft.id, {
      key: "max_order_amount",
      value: 500_000_000n,
      period: "order",
    });

    const v2Updated = await planService.getPlanVersion(v2Draft.id);
    expect(v2Updated.features).toHaveLength(2);
    expect(v2Updated.limits).toHaveLength(2);

    // Publish v2
    const v2Published = await planService.publishPlanVersion(plan.id, v2Draft.id, ctx.userAdmin);
    expect(v2Published.status).toBe("published");

    // Check v1 is now superseded and historical record is preserved
    const v1Checked = await planService.getPlanVersion(v1.id);
    expect(v1Checked.status).toBe("superseded");
    expect(v1Checked.effectiveTo).toBeDefined();
    expect(v1Checked.features).toHaveLength(1); // v1 untouched!

    // Plan now points to v2
    const planUpdated = await planService.getPlan(plan.id);
    expect(planUpdated.currentPublishedVersionId).toBe(v2Draft.id);
    expect(planUpdated.currentPublishedVersion.versionNumber).toBe(2);

    // Listing versions lists both v2 and v1
    const versions = await planService.listVersions(plan.id);
    expect(versions).toHaveLength(2);
    expect(versions[0].versionNumber).toBe(2);
    expect(versions[0].status).toBe("published");
    expect(versions[1].versionNumber).toBe(1);
    expect(versions[1].status).toBe("superseded");
  });
});

describe("Phase 5.0 — Database Constraints & Money Safety", () => {
  it("rejects negative or overflow money values in base_fee and deposit_requirement", async () => {
    const plan = await planService.createPlan({ code: "money_check", name: "Money Check" }, ctx.userAdmin);

    // Negative base_fee rejected by CHECK constraint
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, base_fee)
         VALUES ('wpver_neg_test', $1, 1, 'Bad Fee', -1000)`,
        [plan.id],
      ),
    ).rejects.toMatchObject({ code: "23514" }); // check constraint violation

    // Base fee exceeding MAX_MONEY_RIAL (10^15) rejected
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, base_fee)
         VALUES ('wpver_overflow_test', $1, 1, 'Overflow Fee', 1000000000000001)`,
        [plan.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Negative deposit rejected
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, deposit_requirement)
         VALUES ('wpver_neg_dep', $1, 1, 'Bad Dep', -500)`,
        [plan.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects invalid status values on plan, version, feature type, and limit period", async () => {
    const plan = await planService.createPlan({ code: "enum_check", name: "Enum Check" }, ctx.userAdmin);

    // Invalid plan status
    await expect(
      h.pool.query(`UPDATE wholesale_plan SET status='non_existent' WHERE id=$1`, [plan.id]),
    ).rejects.toMatchObject({ code: "23514" });

    // Invalid version billing_period
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, billing_period)
         VALUES ('wpver_bad_period', $1, 1, 'Bad', 'bi_weekly')`,
        [plan.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Invalid duration_days (0 or negative)
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_version (id, plan_id, version_number, name, duration_days)
         VALUES ('wpver_zero_dur', $1, 1, 'Zero', 0)`,
        [plan.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const version = await planService.createPlanVersion(plan.id, { name: "v1" }, ctx.userAdmin);

    // Invalid feature type
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_feature (id, plan_version_id, feature_key, feature_type)
         VALUES ('wpfeat_bad_type', $1, 'some_key', 'unsupported_type')`,
        [version.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Invalid limit period
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_limit (id, plan_version_id, limit_key, limit_value, period)
         VALUES ('wplim_bad_per', $1, 'min_order', 1000, 'decade')`,
        [version.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // Negative limit value
    await expect(
      h.pool.query(
        `INSERT INTO wholesale_plan_limit (id, plan_version_id, limit_key, limit_value)
         VALUES ('wplim_neg_val', $1, 'min_order', -10)`,
        [version.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces ON DELETE RESTRICT preventing deletion of parent plan or version with children", async () => {
    const plan = await planService.createPlan({ code: "restrict_test", name: "Restrict Test" }, ctx.userAdmin);
    const version = await planService.createPlanVersion(
      plan.id,
      {
        features: [{ key: "test_feat", type: "boolean" }],
        limits: [{ key: "test_lim", value: 10n }],
      },
      ctx.userAdmin,
    );

    // Deleting plan with child version fails
    await expect(
      h.pool.query(`DELETE FROM wholesale_plan WHERE id=$1`, [plan.id]),
    ).rejects.toMatchObject({ code: "23503" }); // Foreign key violation

    // Deleting version with child feature/limit fails
    await expect(
      h.pool.query(`DELETE FROM wholesale_plan_version WHERE id=$1`, [version.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
