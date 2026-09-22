import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as sets from "../src/schema/state-values";
import {
  checkValuesFromDefinition,
  readActualConstraints,
  readExpectedShape,
  readMigrationPlan,
} from "../src/verify";
import { MIGRATIONS_DIR, dropDatabase, ensurePostgres, migrateOrFail, recreateDatabase, withClient } from "./helpers";

/**
 * آزمون «رانش» (drift) بین سه لایه‌ای که باید یک مجموعهٔ مقادیر داشته باشند:
 *
 *     state-values.ts  →  snapshot/مهاجرت Drizzle  →  دیتابیس مهاجرت‌شده
 *
 * اگر کسی یک وضعیت را در کد اضافه کند و در مهاجرت نه (یا برعکس)، این آزمون
 * می‌شکند. هدف قاعدهٔ #۶ گام ۱.۲: «مجموعهٔ مقادیر مجاز یک منبع دارد؛ کد و
 * دیتابیس دو حقیقت رقیب نمی‌شوند.»
 */

const DB = "kolbe_phase12_state_test";

/** نگاشت «جدول.ستون» به مجموعهٔ مورد انتظار کد. */
const STATE_COLUMNS: Array<{ table: string; column: string; values: readonly string[]; check: string }> = [
  { table: "account_user", column: "role", values: sets.ACCOUNT_ROLES, check: "account_user_role_allowed" },
  { table: "account_user", column: "status", values: sets.ACCOUNT_STATUSES, check: "account_user_status_allowed" },
  { table: "supplier", column: "status", values: sets.SUPPLIER_STATUSES, check: "supplier_status_allowed" },
  {
    table: "supplier_application",
    column: "status",
    values: sets.SUPPLIER_APPLICATION_STATUSES,
    check: "supplier_application_status_allowed",
  },
  {
    table: "wholesale_account",
    column: "status",
    values: sets.WHOLESALE_ACCOUNT_STATUSES,
    check: "wholesale_account_status_allowed",
  },
  {
    table: "wholesale_order",
    column: "status",
    values: sets.WHOLESALE_ORDER_STATUS_VALUES,
    check: "wholesale_order_status_allowed",
  },
  {
    table: "wholesale_order",
    column: "currency",
    values: sets.CURRENCIES,
    check: "wholesale_order_currency_allowed",
  },
  {
    table: "wholesale_order",
    column: "payment_mode",
    values: sets.WHOLESALE_PAYMENT_MODES,
    check: "wholesale_order_payment_mode_allowed",
  },
  {
    table: "purchase_order",
    column: "status",
    values: sets.PURCHASE_ORDER_STATUS_VALUES,
    check: "purchase_order_status_allowed",
  },
  {
    table: "purchase_order",
    column: "shipping_responsibility",
    values: sets.SHIPPING_RESPONSIBILITIES,
    check: "purchase_order_shipping_responsibility_allowed",
  },
  { table: "rfq", column: "status", values: sets.RFQ_STATUSES, check: "rfq_status_allowed" },
  { table: "quote", column: "status", values: sets.QUOTE_STATUSES, check: "quote_status_allowed" },
  {
    table: "support_ticket",
    column: "status",
    values: sets.SUPPORT_TICKET_STATUSES,
    check: "support_ticket_status_allowed",
  },
  {
    table: "support_ticket",
    column: "priority",
    values: sets.SUPPORT_TICKET_PRIORITIES,
    check: "support_ticket_priority_allowed",
  },
  {
    table: "retail_order",
    column: "order_status",
    values: sets.RETAIL_ORDER_STATUS_VALUES,
    check: "retail_order_status_allowed",
  },
  {
    table: "retail_order",
    column: "payment_status",
    values: sets.RETAIL_PAYMENT_STATUSES,
    check: "retail_order_payment_status_allowed",
  },
  { table: "retail_order", column: "pay_method", values: sets.RETAIL_PAYMENT_METHODS, check: "retail_order_pay_method_allowed" },
  {
    table: "retail_order",
    column: "payment_method",
    values: sets.RETAIL_PAYMENT_METHODS,
    check: "retail_order_payment_method_allowed",
  },
  {
    table: "retail_order",
    column: "shipping_method",
    values: sets.SHIPPING_METHOD_IDS,
    check: "retail_order_shipping_method_allowed",
  },
  { table: "retail_order", column: "currency", values: sets.CURRENCIES, check: "retail_order_currency_allowed" },
  { table: "purchase_order", column: "currency", values: sets.CURRENCIES, check: "purchase_order_currency_allowed" },
  // Phase 3 — marketplace foundation
  { table: "brand", column: "verification_status", values: sets.BRAND_VERIFICATION_STATUSES, check: "brand_verification_status_allowed" },
  { table: "brand", column: "status", values: sets.BRAND_STATUSES, check: "brand_status_allowed" },
  { table: "category", column: "status", values: sets.CATEGORY_STATUSES, check: "category_status_allowed" },
  { table: "product", column: "owner_type", values: sets.SELLER_TYPES, check: "product_owner_type_allowed" },
  { table: "product", column: "status", values: sets.PRODUCT_STATUSES, check: "product_status_allowed" },
  { table: "product_variant", column: "status", values: sets.PRODUCT_VARIANT_STATUSES, check: "product_variant_status_allowed" },
  { table: "seller", column: "type", values: sets.SELLER_TYPES, check: "seller_type_allowed" },
  { table: "seller", column: "status", values: sets.BRAND_STATUSES, check: "seller_status_allowed" },
  { table: "seller_offer", column: "status", values: sets.OFFER_STATUSES, check: "seller_offer_status_allowed" },
  { table: "seller_offer", column: "moq_unit", values: sets.MOQ_UNITS, check: "seller_offer_moq_unit_allowed" },
  { table: "wholesale_package", column: "package_type", values: sets.PACKAGE_TYPES, check: "wholesale_package_type_allowed" },
  { table: "wholesale_pricing_tier", column: "moq_unit", values: sets.MOQ_UNITS, check: "wholesale_pricing_tier_moq_unit_allowed" },
  { table: "supplier_permission_config", column: "action", values: sets.SUPPLIER_PERMISSION_ACTIONS, check: "supplier_permission_action_allowed" },
  { table: "supplier_member", column: "role", values: sets.SUPPLIER_MEMBER_ROLES, check: "supplier_member_role_allowed" },
  { table: "vip_plan", column: "status", values: sets.VIP_PLAN_STATUSES, check: "vip_plan_status_allowed" },
  { table: "vip_subscription", column: "status", values: sets.VIP_SUBSCRIPTION_STATUSES, check: "vip_subscription_status_allowed" },
  { table: "wholesale_request", column: "status", values: sets.WHOLESALE_REQUEST_STATUSES, check: "wholesale_request_status_allowed" },
  { table: "product_rating", column: "status", values: sets.RATING_STATUSES, check: "product_rating_status_allowed" },
  { table: "supplier_rating", column: "status", values: sets.RATING_STATUSES, check: "supplier_rating_status_allowed" },
  { table: "transaction_rating", column: "status", values: sets.RATING_STATUSES, check: "transaction_rating_status_allowed" },
  // Phase 3.5 — inventory authority
  { table: "product_variant_inventory", column: "status", values: sets.VARIANT_INVENTORY_STATUS, check: "product_variant_inventory_status_allowed" },
  { table: "inventory_reservation", column: "status", values: sets.INVENTORY_RESERVATION_STATUSES, check: "inventory_reservation_status_allowed" },
  { table: "inventory_ledger", column: "change_type", values: sets.INVENTORY_LEDGER_CHANGE_TYPES, check: "inventory_ledger_change_type_allowed" },
  // Phase 4.2 — order foundation
  { table: "wholesale_order_item", column: "package_type_snapshot", values: sets.PACKAGE_TYPES, check: "wholesale_order_item_package_type_allowed" },
  { table: "wholesale_order_item", column: "moq_unit_snapshot", values: sets.MOQ_UNITS, check: "wholesale_order_item_moq_unit_allowed" },
  { table: "wholesale_order_item", column: "pricing_unit", values: sets.PRICING_UNITS, check: "wholesale_order_item_pricing_unit_allowed" },
  { table: "wholesale_order_item", column: "currency", values: sets.CURRENCIES, check: "wholesale_order_item_currency_allowed" },
  { table: "order_status_history", column: "from_status", values: sets.ALL_ORDER_STATUSES, check: "order_status_history_from_status_allowed" },
  { table: "order_status_history", column: "to_status", values: sets.ALL_ORDER_STATUSES, check: "order_status_history_to_status_allowed" },
  { table: "order_status_history", column: "actor_role", values: sets.ORDER_ACTOR_ROLES, check: "order_status_history_actor_role_allowed" },
  { table: "order_event", column: "aggregate_type", values: sets.ORDER_AGGREGATE_TYPES, check: "order_event_aggregate_type_allowed" },
  { table: "order_event", column: "event_type", values: sets.ORDER_EVENT_TYPES, check: "order_event_event_type_allowed" },
  { table: "order_event", column: "actor_role", values: sets.ORDER_ACTOR_ROLES, check: "order_event_actor_role_allowed" },
  { table: "promotion", column: "channel", values: sets.PROMOTION_CHANNELS, check: "promotion_channel_allowed" },
  { table: "promotion", column: "status", values: sets.PROMOTION_STATUSES, check: "promotion_status_allowed" },
  { table: "promotion_revision", column: "status", values: sets.PROMOTION_REVISION_STATUSES, check: "promotion_revision_status_allowed" },
  { table: "promotion_revision", column: "benefit_type", values: sets.PROMOTION_BENEFIT_TYPES, check: "promotion_revision_benefit_type_allowed" },
  { table: "promotion_revision", column: "benefit_scope", values: sets.PROMOTION_BENEFIT_SCOPES, check: "promotion_revision_benefit_scope_allowed" },
  { table: "promotion_revision", column: "currency", values: sets.CURRENCIES, check: "promotion_revision_currency_allowed" },
  { table: "promotion_revision", column: "stacking_policy", values: sets.PROMOTION_STACKING_POLICIES, check: "promotion_revision_stacking_allowed" },
  { table: "promotion_target", column: "target_type", values: sets.PROMOTION_TARGET_TYPES, check: "promotion_target_type_allowed" },
  { table: "promotion_coupon_redemption", column: "actor_type", values: sets.PROMOTION_REDEMPTION_ACTOR_TYPES, check: "promotion_coupon_redemption_actor_type_allowed" },
  { table: "promotion_usage", column: "actor_type", values: sets.PROMOTION_REDEMPTION_ACTOR_TYPES, check: "promotion_usage_actor_type_allowed" },
  { table: "promotion_schedule", column: "action", values: sets.PROMOTION_SCHEDULE_ACTIONS, check: "promotion_schedule_action_allowed" },
  { table: "promotion_schedule", column: "status", values: sets.PROMOTION_SCHEDULE_STATUSES, check: "promotion_schedule_status_allowed" },
  { table: "admin_role_permission", column: "action", values: sets.ADMIN_PERMISSION_ACTIONS, check: "admin_role_permission_action_allowed" },
  { table: "approval_request", column: "request_type", values: sets.APPROVAL_REQUEST_TYPES, check: "approval_request_type_allowed" },
  { table: "approval_request", column: "status", values: sets.APPROVAL_REQUEST_STATUSES, check: "approval_request_status_allowed" },
];

const sorted = (values: readonly string[]) => [...values].sort();

describe("رانش مجموعهٔ مقادیر وضعیت‌ها (کد ↔ مهاجرت ↔ دیتابیس)", () => {
  beforeAll(async () => {
    ensurePostgres();
    await recreateDatabase(DB);
    migrateOrFail(DB);
  }, 180_000);

  afterAll(async () => {
    await dropDatabase(DB);
  });

  it("قیدهای CHECK دیتابیس، همان مجموعهٔ state-values.ts هستند", async () => {
    const actual = await withClient(DB, (client) => readActualConstraints(client));
    for (const entry of STATE_COLUMNS) {
      const found = actual.checks.find((check) => check.table === entry.table && check.name === entry.check);
      expect(found, `قید ${entry.check} در دیتابیس نیست`).toBeDefined();
      expect(checkValuesFromDefinition(String(found?.definition)), entry.check).toEqual(sorted(entry.values));
    }
  });

  it("snapshot مهاجرت (خروجی drizzle-kit از مدل) هم همان مجموعه را دارد", () => {
    const plan = readMigrationPlan(MIGRATIONS_DIR);
    const expected = readExpectedShape(plan);
    for (const entry of STATE_COLUMNS) {
      const found = expected.checks.find((check) => check.table === entry.table && check.name === entry.check);
      expect(found, `قید ${entry.check} در snapshot نیست`).toBeDefined();
      expect(checkValuesFromDefinition(String(found?.value)), entry.check).toEqual(sorted(entry.values));
    }
  });

  it("قیدهای پول و موجودی وجود دارند و از همان MAX_MONEY دامنه استفاده می‌کنند", async () => {
    const plan = readMigrationPlan(MIGRATIONS_DIR);
    const expected = readExpectedShape(plan);
    const actual = await withClient(DB, (client) => readActualConstraints(client));
    const max = sets.MAX_MONEY_RIAL.toString();

    const moneyChecks = expected.checks.filter(
      (check) =>
        check.name.endsWith("_range") &&
        !check.name.includes("rating") &&
        (check.name.includes("price") || check.name.includes("amount") || check.name.includes("cost") || check.name.includes("total") || check.name.includes("unit_price")),
    );
    expect(moneyChecks.length).toBeGreaterThanOrEqual(12);
    for (const check of moneyChecks) {
      expect(check.value, check.name).toContain(max);
      expect(check.value, check.name).toContain(">= 0");
    }
    // در دیتابیس هم واقعاً همین متن نشسته است (نه فقط در snapshot).
    const appliedMoneyChecks = actual.checks.filter(
      (check) =>
        check.name.endsWith("_range") &&
        !check.name.includes("rating") &&
        (check.name.includes("price") || check.name.includes("amount") || check.name.includes("cost") || check.name.includes("total") || check.name.includes("unit_price")),
    );
    for (const check of appliedMoneyChecks) expect(check.definition).toContain(max);

    // ناوردایی موجودی: رزرو نباید از موجودی فیزیکی بیشتر شود — canonical inventory
    const inventoryChecks = actual.checks.filter((check) => check.table === "product_variant_inventory" && check.name.includes("non_negative") || check.table === "product_variant_inventory" && check.name.includes("within_on_hand"));
    // Actually filter for the three specific checks
    const relevant = actual.checks.filter((check) => check.table === "product_variant_inventory" && (check.name.includes("on_hand") || check.name.includes("reserved"))).map((c)=>c.name).sort();
    expect(relevant).toEqual([
      "product_variant_inventory_on_hand_non_negative",
      "product_variant_inventory_reserved_non_negative",
      "product_variant_inventory_reserved_within_on_hand",
    ].sort());
    const reservedCheck = actual.checks.find((check) => check.name === "product_variant_inventory_reserved_within_on_hand");
    expect(String(reservedCheck?.definition)).toMatch(/"?(reserved|on_hand)"?\s*<=\s*"?(on_hand|reserved)"?/);
  });

  it("هیچ ستون پولی از نوع اعشاری وجود ندارد (bigint/numeric صحیح)", async () => {
    const { rows } = await withClient(DB, (client) =>
      client.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema='public' AND data_type IN ('real','double precision')
         ORDER BY table_name, column_name`,
      ),
    );
    expect(rows).toEqual([]);
    // ستون‌های پولی باید bigint باشند.
    const money = await withClient(DB, (client) =>
      client.query<{ table_name: string; column_name: string; data_type: string }>(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema='public'
           AND column_name IN ('total_amount','items_total','shipping_price','unit_price','line_total','wholesale_price','cost')
         ORDER BY table_name, column_name`,
      ),
    );
    expect(money.rows.length).toBeGreaterThanOrEqual(12);
    for (const column of money.rows) expect(column.data_type, `${column.table_name}.${column.column_name}`).toBe("bigint");
  });

  it("کلیدهای خارجی خواسته‌شده همه با ON DELETE RESTRICT وجود دارند", async () => {
    const expectedFks = [
      ["supplier_member", "supplier_id", "supplier"],
      ["supplier_member", "user_id", "account_user"],
      ["supplier_application", "user_id", "account_user"],
      ["product_variant", "product_id", "product"],
      ["product_variant_inventory", "variant_id", "product_variant"],
      ["product_variant_inventory", "seller_id", "seller"],
      ["wholesale_account", "user_id", "account_user"],
      ["wholesale_order", "account_id", "wholesale_account"],
      ["wholesale_order", "buyer_user_id", "account_user"],
      ["wholesale_order", "originating_request_id", "wholesale_request"],
      ["wholesale_order", "cancelled_by", "account_user"],
      ["wholesale_order_item", "order_id", "wholesale_order"],
      ["wholesale_order_item", "product_id", "product"],
      ["wholesale_order_item", "variant_id", "product_variant"],
      ["wholesale_order_item", "seller_id", "seller"],
      ["wholesale_order_item", "supplier_id", "supplier"],
      ["wholesale_order_item", "package_id", "wholesale_package"],
      ["wholesale_order_item", "pricing_tier_id", "wholesale_pricing_tier"],
      ["purchase_order", "supplier_id", "supplier"],
      ["purchase_order", "seller_id", "seller"],
      ["purchase_order", "wholesale_order_id", "wholesale_order"],
      ["purchase_order_item", "purchase_order_id", "purchase_order"],
      ["purchase_order_item", "wholesale_order_item_id", "wholesale_order_item"],
      ["purchase_order_item", "product_id", "product"],
      ["purchase_order_item", "variant_id", "product_variant"],
      ["inventory_reservation", "order_id", "wholesale_order"],
      ["inventory_reservation", "order_item_id", "wholesale_order_item"],
      ["order_status_history", "order_id", "wholesale_order"],
      ["order_status_history", "child_order_id", "purchase_order"],
      ["order_status_history", "actor_id", "account_user"],
      ["order_event", "actor_id", "account_user"],
      ["rfq", "supplier_id", "supplier"],
      ["rfq", "product_id", "product"],
      ["quote", "rfq_id", "rfq"],
      ["quote", "supplier_id", "supplier"],
      ["quote", "product_id", "product"],
      ["quote", "variant_id", "product_variant"],
      ["support_ticket", "supplier_id", "supplier"],
      ["retail_order", "customer_id", "account_user"],
      ["retail_order_item", "order_id", "retail_order"],
      ["login_attempt", "user_id", "account_user"],
      ["user_session", "user_id", "account_user"],
    ] as const;

    const actual = await withClient(DB, (client) => readActualConstraints(client));
    for (const [table, column, referenced] of expectedFks) {
      const found = actual.foreignKeys.find(
        (fk) => fk.table === table && fk.columns.join(",") === column && fk.referencedTable === referenced,
      );
      expect(found, `${table}.${column} → ${referenced}`).toBeDefined();
      expect(found?.deleteRule, `${table}.${column}`).toBe("restrict");
    }
    expect(actual.foreignKeys.length).toBeGreaterThanOrEqual(expectedFks.length);
  });

  it("یکتایی‌های تجاری الزامی وجود دارند", async () => {
    const actual = await withClient(DB, (client) => readActualConstraints(client));
    const key = (table: string, columns: string[]) => `${table}(${[...columns].sort().join(",")})`;
    const present = new Set(actual.uniques.map((item) => key(item.table, item.columns)));
    const required: Array<[string, string[]]> = [
      ["account_user", ["email"]],
      ["supplier_member", ["user_id"]],
      ["product", ["slug"]],
      ["product_variant", ["sku"]],
      ["product_variant_inventory", ["variant_id", "seller_id"]],
      ["wholesale_order", ["order_code"]],
      // Phase 4.2 scoped idempotency
      ["wholesale_order", ["account_id", "idempotency_key"]],
      ["wholesale_order", ["originating_request_id"]],
      ["retail_order", ["order_code"]],
      ["retail_order", ["idempotency_key"]],
      ["purchase_order", ["order_code"]],
      ["purchase_order", ["wholesale_order_id", "seller_id"]],
      ["rfq", ["reference_code"]],
      ["seller_offer", ["sku"]],
      ["inventory_reservation", ["order_item_id", "variant_id", "seller_id"]],
    ];
    for (const [table, columns] of required) {
      expect(present.has(key(table, columns)), `${table}(${columns.join(",")})`).toBe(true);
    }
    // ایندکس یکتای جزئی system_log برای upsert خطا لازم است.
    const fingerprint = actual.uniques.find((item) => item.table === "system_log");
    expect(fingerprint?.columns).toEqual(["fingerprint"]);
    expect(fingerprint?.partial).toBe(true);
  });

  it("گفتار «وضعیت‌های پرداخت عمده» با روش‌های خرده‌فروشی قاطی نشده است", () => {
    // BNPL (installment) فقط خرده‌فروشی است: در فهرست عمده جایی ندارد (قاعدهٔ A20).
    expect(sets.WHOLESALE_PAYMENT_METHODS).not.toContain("installment");
    expect(sets.RETAIL_PAYMENT_METHODS).toContain("installment");
  });
});
