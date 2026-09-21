/**
 * اسکیمای Drizzle — تنها مرجع اسکیمای PostgreSQL کلبه.
 *
 * ── جایگاه این فایل پس از گام ۱.۲ ───────────────────────────────────────────
 * پیش از گام ۱.۲، `frontend-next/server/database.ts` یک رشتهٔ DDL داشت که در هر
 * بالا آمدن اجرا می‌شد و «اسکیمای واقعی» بود؛ این فایل صرفاً باید با آن هم‌ارز
 * می‌ماند. آن DDL **حذف شد** و اکنون مسیر اسکیما یک‌طرفه است:
 *
 *     این فایل (اسکیمای Drizzle) → drizzle-kit generate → مهاجرت نسخه‌دار → PostgreSQL
 *
 * هیچ کد زمان اجرایی اسکیما نمی‌سازد یا تغییر نمی‌دهد؛ فقط سازگاری را بررسی
 * می‌کند (`packages/database/src/verify.ts`). هر تغییر اسکیما باید با مهاجرت
 * بیاید، نه با «ترمیم خودکار» در زمان راه‌اندازی.
 *
 * ── قواعد رعایت‌شده ──────────────────────────────────────────────────────────
 *  - A10: مبالغ `bigint` هستند و قید `CHECK` بازهٔ مجاز را تحمیل می‌کند
 *    (`>= 0 AND <= MAX_MONEY`). هیچ ستون پولی float/real/double وجود ندارد.
 *  - A14: وضعیت‌ها قید `CHECK` دارند و مجموعهٔ مقادیر از `state-values.ts`
 *    می‌آید (همان ماشین‌های حالت `@kolbe/shared` یا فهرست اعتبارسنجی سرور).
 *  - همهٔ کلیدهای خارجی `ON DELETE RESTRICT` هستند: تاریخچهٔ سفارش، مالکیت
 *    تأمین‌کننده و رکوردهای مالی هرگز با حذف والد پاک نمی‌شوند. `audit_log` و
 *    `system_log` عمداً FK روی `actor_id` ندارند تا حذف/تغییر حساب، تاریخچهٔ
 *    حسابرسی را از بین نبرد یا به آن گره نخورد.
 *  - موجودی: `on_hand >= 0`, `reserved >= 0` و `reserved <= on_hand` — این
 *    ناوردایی با گردش‌کار رزرو همراستاست (رزرو زیر `FOR UPDATE` فقط تا سقف
 *    `on_hand - reserved` انجام می‌شود، تحقق و لغو هر دو کاهشی‌اند).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  ALL_ORDER_STATUSES,
  BRAND_STATUSES,
  BRAND_VERIFICATION_STATUSES,
  CATEGORY_STATUSES,
  COMMAND_IDEMPOTENCY_STATES,
  COMMAND_TYPES,
  CURRENCIES,
  FINANCIAL_LEDGER_DIRECTIONS,
  FINANCIAL_LEDGER_ENTRY_TYPES,
  FINANCIAL_RELEASE_TYPES,
  FULFILLMENT_EXCEPTION_BUYER_RESOLUTIONS,
  FULFILLMENT_EXCEPTION_STATUSES,
  FULFILLMENT_EXCEPTION_TYPES,
  INVENTORY_LEDGER_CHANGE_TYPES,
  INVENTORY_RESERVATION_STATUSES,
  LEGAL_POLICY_TYPES,
  LEGAL_POLICY_SCOPES,
  LEGAL_POLICY_STATUSES,
  LEGAL_ACCEPTANCE_SUBJECT_TYPES,
  LEGAL_ACCEPTANCE_CONTEXTS,
  CONSENT_PURPOSES,
  CONSENT_EVENT_TYPES,
  CONSENT_SOURCES,
  BUSINESS_ENTITY_TYPES,
  BUSINESS_CREDENTIAL_TYPES,
  BUSINESS_CREDENTIAL_STATUSES,
  SUPPLIER_COMPLIANCE_STATUSES,
  SUPPLIER_COMPLIANCE_REVIEW_DECISIONS,
  REPRESENTATIVE_AUTHORITY_STATUSES,
  COMPLIANCE_DOCUMENT_TYPES,
  COMPLIANCE_DOCUMENT_REVIEW_STATUSES,
  COMPLIANCE_DOCUMENT_SCAN_STATUSES,
  COMPLIANCE_STORAGE_PROVIDERS,
  COMPLIANCE_HOLD_REASON_CODES,
  HOLD_STATUSES,
  BANK_DESTINATION_KINDS,
  BANK_VERIFICATION_STATUSES,
  HOLDER_MATCH_STATUSES,
  PRODUCT_ORIGIN_TYPES,
  PRODUCT_CONDITION_CLASSES,
  PRODUCT_COMPLIANCE_STATUSES,
  RETENTION_ACTIONS,
  RETENTION_POLICY_STATUSES,
  LEGAL_VERIFICATION_STATUSES,
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_STATUSES,
  LEGAL_HOLD_SCOPE_TYPES,
  TRANSACTION_SNAPSHOT_SCOPES,
  COMMERCIAL_INVOICE_SCOPES,
  COMMERCIAL_INVOICE_STATUSES,
  INVOICE_TAX_STATUSES,
  FISCAL_DOCUMENT_STATUSES,
  FISCAL_EVENT_TYPES,
  FISCAL_EVENT_OUTCOMES,
  TAX_CONFIG_REVIEW_STATUSES,
  TAX_CONFIG_STATUSES,
  SETTLEMENT_ACCOUNT_TYPES,
  SETTLEMENT_ACCOUNT_STATUSES,
  SETTLEMENT_JOURNAL_TYPES,
  SETTLEMENT_SOURCE_EVENT_TYPES,
  SETTLEMENT_POSTING_DIRECTIONS,
  COMMISSION_BASIS_TYPES,
  COMMISSION_ROUNDING_MODES,
  COMMISSION_POLICY_STATUSES,
  SHIPPING_ECONOMIC_RECIPIENTS,
  SHIPPING_COST_BEARERS,
  SHIPPING_ECONOMICS_STATUSES,
  SETTLEMENT_HOLD_SCOPES,
  SETTLEMENT_HOLD_REASONS,
  SETTLEMENT_HOLD_STATUSES,
  SETTLEMENT_HOLD_POLICY_STATUSES,
  SETTLEMENT_BATCH_STATUSES,
  SETTLEMENT_BATCH_ITEM_STATUSES,
  WITHDRAWAL_REQUEST_STATUSES,
  PAYOUT_STATUSES,
  PAYOUT_PROVIDERS,
  PAYOUT_PROVIDER_EVENT_TYPES,
  PAYOUT_PROVIDER_EVENT_STATUSES,
  SETTLEMENT_RECONCILIATION_TYPES,
  SETTLEMENT_RECONCILIATION_STATUSES,
  WHOLESALE_PLAN_STATUSES,
  WHOLESALE_PLAN_VERSION_STATUSES,
  WHOLESALE_PLAN_BILLING_PERIODS,
  WHOLESALE_PLAN_FEATURE_TYPES,
  WHOLESALE_PLAN_LIMIT_PERIODS,
  WHOLESALE_PLAN_LIMIT_KEYS,
  WHOLESALE_MEMBERSHIP_STATUSES,
  WHOLESALE_MEMBERSHIP_EVENT_TYPES,
  ADMIN_PERMISSION_ACTIONS,
  APPROVAL_REQUEST_TYPES,
  APPROVAL_REQUEST_STATUSES,
  BUSINESS_SETTING_CATEGORIES,
  ADMIN_NOTE_TARGET_TYPES,
  CRM_STAGES,
  CRM_LINK_TYPES,
  CRM_STAGE_SOURCES,
  CRM_ACTIVITY_TYPES,
  CRM_ACTIVITY_SOURCES,
  CRM_TASK_STATUSES,
  CRM_TASK_PRIORITIES,
  MAX_MONEY_RIAL,
  MOQ_UNITS,
  OFFER_STATUSES,
  ORDER_ACTOR_ROLES,
  ORDER_AGGREGATE_TYPES,
  ORDER_EVENT_TYPES,
  PACKAGE_TYPES,
  PAYMENT_ALLOCATION_STATUS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER_EVENT_STATUSES,
  PAYMENT_PROVIDER_EVENT_TYPES,
  PAYMENT_STATUSES,
  PRICING_UNITS,
  PRODUCT_STATUSES,
  PRODUCT_VARIANT_STATUSES,
  PURCHASE_ORDER_STATUS_VALUES,
  QUOTE_STATUSES,
  RATING_STATUSES,
  REFUND_STATUSES,
  RETAIL_ORDER_STATUS_VALUES,
  RETAIL_PAYMENT_METHODS,
  RETAIL_PAYMENT_STATUSES,
  RFQ_STATUSES,
  SELLER_TYPES,
  SHIPMENT_EVENT_STATUSES,
  SHIPMENT_EVENT_TYPES,
  SHIPMENT_STATUSES,
  SHIPPING_METHOD_IDS,
  SHIPPING_QUOTE_STATUSES,
  SHIPPING_RESPONSIBILITIES,
  SUPPLIER_APPLICATION_STATUSES,
  SUPPLIER_MEMBER_ROLES,
  SUPPLIER_PERMISSION_ACTIONS,
  SUPPLIER_PRODUCT_SUBMISSION_STATUSES,
  SUPPLIER_STATUSES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_REQUESTER_TYPES,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_SOURCES,
  SUPPORT_TEAMS,
  SUPPORT_RELATION_TYPES,
  SUPPORT_AUTHOR_TYPES,
  SUPPORT_VISIBILITIES,
  SUPPORT_ATTACHMENT_SCAN_STATUSES,
  SUPPORT_ESCALATION_SOURCES,
  SUPPORT_ACTION_TYPES,
  SUPPORT_ACTION_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TEMPLATE_STATUSES,
  NOTIFICATION_TEMPLATE_VERSION_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_DELIVERY_ATTEMPT_STATUSES,
  NOTIFICATION_PROVIDER_CONFIG_STATUSES,
  NOTIFICATION_PROVIDER_EVENT_STATUSES,
  NOTIFICATION_EVENT_KEYS,
  VARIANT_INVENTORY_STATUS,
  VIP_PLAN_STATUSES,
  VIP_SUBSCRIPTION_STATUSES,
  WHOLESALE_ACCOUNT_STATUSES,
  WHOLESALE_ORDER_STATUS_VALUES,
  WHOLESALE_PAYMENT_MODES,
  WHOLESALE_PROFORMA_STATUSES,
  WHOLESALE_REQUEST_STATUSES,
  WHOLESALE_REVISION_BUYER_RESPONSES,
  CMS_PAGE_TYPES,
  CMS_PAGE_STATUSES,
  CMS_REVISION_STATUSES,
  CMS_DOCUMENT_TYPES,
  CMS_DOCUMENT_STATUSES,
  CMS_DOCUMENT_REVISION_STATUSES,
  CMS_NAVIGATION_STATUSES,
  CMS_TAXONOMY_KINDS,
  CMS_TAXONOMY_STATUSES,
  CMS_MEDIA_PROVIDERS,
  CMS_MEDIA_MIME_TYPES,
  CMS_SCHEDULE_STATUSES,
  CMS_SCHEDULE_TARGET_TYPES,
  ANALYTICS_SCOPES,
  ANALYTICS_REPORT_TYPES,
  ANALYTICS_REPORT_RUN_STATUSES,
  ANALYTICS_EXPORT_FORMATS,
  ANALYTICS_EXPORT_STATUSES,
  ANALYTICS_SOURCE_MODES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_HISTORY_EVENT_TYPES,
  PRODUCTION_MILESTONE_STATUSES,
  PRODUCTION_MILESTONE_DEFINITION_STATUSES,
  SUPPLIER_CAPABILITY_STATUSES,
  SUPPLIER_CAPACITY_PERIOD_STATUSES,
  SUPPLIER_CLOSURE_STATUSES,
  PRODUCTION_CAPACITY_RESERVATION_STATUSES,
  PRODUCTION_COMMAND_STATES,
  PRODUCTION_EVENT_TYPES,
  PRODUCTION_SAMPLE_TYPES,
  PRODUCTION_SAMPLE_STATUSES,
  PRODUCTION_SAMPLE_REVIEW_DECISIONS,
  PRODUCTION_ARTIFACT_TYPES,
  PRODUCTION_ARTIFACT_PROVIDERS,
  PRODUCTION_ARTIFACT_MIME_TYPES,
  PRODUCTION_CHANGE_TYPES,
  PRODUCTION_CHANGE_STATUSES,
  PRODUCTION_CHANGE_DECISIONS,
  PRODUCTION_CHANGE_OWNER_DOMAINS,
  QUALITY_CHECKLIST_STATUSES,
  QUALITY_MEASUREMENT_TYPES,
  QUALITY_INSPECTION_STATUSES,
  QUALITY_INSPECTION_DECISIONS,
  QUALITY_DEFECT_SEVERITIES,
  QUALITY_DEFECT_STATUSES,
  QUALITY_REWORK_STATUSES,
  PRODUCTION_LOT_STATUSES,
  PRODUCTION_LOT_TRACE_TYPES,
  QUALITY_RELEASE_STATUSES,
  PRODUCTION_RECALL_SEVERITIES,
  PRODUCTION_RECALL_STATUSES,
  PRODUCTION_RECALL_SCOPE_TYPES,
  PROMOTION_BENEFIT_SCOPES,
  PROMOTION_BENEFIT_TYPES,
  PROMOTION_CHANNELS,
  PROMOTION_COUPON_STATUSES,
  PROMOTION_REVISION_STATUSES,
  PROMOTION_SCHEDULE_ACTIONS,
  PROMOTION_SCHEDULE_STATUSES,
  PROMOTION_STACKING_POLICIES,
  PROMOTION_STATUSES,
  PROMOTION_TARGET_TYPES,
} from "./state-values";

/** ستون‌های زمانی تکراری — یک‌بار تعریف می‌شوند تا همهٔ جداول یکدست بمانند. */
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ── سازنده‌های قید ────────────────────────────────────────────────────────── */

const stateCheck = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(", ")})`));

const moneyCheck = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" >= 0 AND "${column}" <= ${MAX_MONEY_RIAL.toString()}`));

const quantityCheck = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" >= 0`));

const positiveQuantityCheck = (name: string, column: string) =>
  check(name, sql.raw(`"${column}" > 0`));

/* ── هویت ──────────────────────────────────────────────────────────────────── */

export const accountUser = pgTable(
  "account_user",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    salt: text("salt").notNull(),
    role: text("role").notNull().default("customer"),
    displayName: text("display_name"),
    phone: text("phone"),
    status: text("status").notNull().default("active"),
    tokenVersion: integer("token_version").notNull().default(0),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpEnrolledAt: timestamp("totp_enrolled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("account_user_role_allowed", "role", ACCOUNT_ROLES),
    stateCheck("account_user_status_allowed", "status", ACCOUNT_STATUSES),
    quantityCheck("account_user_token_version_non_negative", "token_version"),
    quantityCheck("account_user_failed_attempts_non_negative", "failed_login_attempts"),
  ],
);

/* ── تأمین‌کنندگان ─────────────────────────────────────────────────────────── */

export const supplier = pgTable(
  "supplier",
  {
    id: text("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    city: text("city"),
    phone: text("phone"),
    category: text("category"),
    monthlyCapacity: integer("monthly_capacity"),
    capabilities: jsonb("capabilities").default([]),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [stateCheck("supplier_status_allowed", "status", SUPPLIER_STATUSES)],
);

export const supplierApplication = pgTable(
  "supplier_application",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    companyName: text("company_name").notNull(),
    representativeName: text("representative_name").notNull(),
    phone: text("phone").notNull(),
    category: text("category").notNull(),
    monthlyCapacity: integer("monthly_capacity"),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_application_status_allowed", "status", SUPPLIER_APPLICATION_STATUSES),
    foreignKey({
      name: "supplier_application_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const supplierMember = pgTable(
  "supplier_member",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    userId: text("user_id").notNull().unique(),
    title: text("title").notNull().default("عضو تیم"),
    role: text("role").notNull().default("owner"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_member_role_allowed", "role", SUPPLIER_MEMBER_ROLES),
    foreignKey({
      name: "supplier_member_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "supplier_member_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── عمده‌فروشی / VIP ──────────────────────────────────────────────────────── */

export const wholesaleAccount = pgTable(
  "wholesale_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    memberName: text("member_name").notNull(),
    storeName: text("store_name").notNull(),
    phone: text("phone").notNull(),
    city: text("city").notNull(),
    planName: text("plan_name").notNull().default("وی‌آی‌پی"),
    status: text("status").notNull().default("pending"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_account_status_allowed", "status", WHOLESALE_ACCOUNT_STATUSES),
    foreignKey({
      name: "wholesale_account_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.2 — Wholesale Order canonical foundation ───────────────────────
 * Evolved existing wholesale_order, wholesale_order_item, purchase_order,
 * purchase_order_item to canonical foundation.
 *
 * Goals:
 *  - buyer_user_id, originating_request_id, currency split totals,
 *    pricing_version, payment_mode, address snapshots JSONB,
 *    version optimistic, lifecycle timestamps, cancellation fields
 *  - scoped idempotency (account_id, idempotency_key) unique partial
 *  - order_code immutable unique human KV-W-*
 *  - No ON DELETE CASCADE, FK RESTRICT for historical data
 *  - Money bigint, CHECK >=0, <= MAX_MONEY, no float
 *  - Status new states draft/confirmed/awaiting_payment/processing/fulfillment/shipped/completed/cancelled
 */

export const wholesaleOrder = pgTable(
  "wholesale_order",
  {
    id: text("id").primaryKey(),
    orderCode: text("order_code").notNull().unique(),
    accountId: text("account_id").notNull(),
    /** Phase 4.2 — authenticated buyer user */
    buyerUserId: text("buyer_user_id").notNull(),
    /** Phase 4.2 — originating wholesale request for conversion uniqueness */
    originatingRequestId: text("originating_request_id"),
    status: text("status").notNull().default("draft"),
    /** Phase 4.2 — currency, split totals */
    currency: text("currency").notNull().default("IRR"),
    itemsTotal: bigint("items_total", { mode: "bigint" }).notNull().default(sql`0`),
    shippingTotal: bigint("shipping_total", { mode: "bigint" }).notNull().default(sql`0`),
    grandTotal: bigint("grand_total", { mode: "bigint" }).notNull().default(sql`0`),
    /** Legacy total_amount kept for compatibility during cutover */
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(sql`0`),
    totalUnits: integer("total_units").notNull().default(0),
    pricingVersion: text("pricing_version"),
    paymentMode: text("payment_mode"),
    /** Immutable snapshots */
    shippingAddressSnapshot: jsonb("shipping_address_snapshot").notNull().default({}),
    billingAddressSnapshot: jsonb("billing_address_snapshot").notNull().default({}),
    /** Scoped idempotency */
    idempotencyKey: text("idempotency_key"),
    /** Phase 4.3 — canonical creation request hash for idempotency payload detection */
    creationRequestHash: text("creation_request_hash"),
    /** Optimistic version */
    version: integer("version").notNull().default(0),
    /** Lifecycle timestamps */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    cancelledBy: text("cancelled_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Phase 4.2 — scoped idempotency unique (account_id, idempotency_key) where key not null
    uniqueIndex("wholesale_order_account_idempotency_unique")
      .on(table.accountId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // Phase 4.2 — one conversion per request version (partial unique)
    uniqueIndex("wholesale_order_originating_request_unique")
      .on(table.originatingRequestId)
      .where(sql`${table.originatingRequestId} IS NOT NULL`),
    index("wholesale_order_account_created").on(table.accountId, table.createdAt),
    index("wholesale_order_status_created").on(table.status, table.createdAt),
    index("wholesale_order_buyer_created").on(table.buyerUserId, table.createdAt),
    stateCheck("wholesale_order_status_allowed", "status", WHOLESALE_ORDER_STATUS_VALUES),
    stateCheck("wholesale_order_currency_allowed", "currency", CURRENCIES),
    stateCheck("wholesale_order_payment_mode_allowed", "payment_mode", WHOLESALE_PAYMENT_MODES),
    moneyCheck("wholesale_order_total_amount_range", "total_amount"),
    moneyCheck("wholesale_order_items_total_range", "items_total"),
    moneyCheck("wholesale_order_shipping_total_range", "shipping_total"),
    moneyCheck("wholesale_order_grand_total_range", "grand_total"),
    quantityCheck("wholesale_order_total_units_non_negative", "total_units"),
    quantityCheck("wholesale_order_version_non_negative", "version"),
    check("wholesale_order_grand_total_equation", sql.raw(`"grand_total" >= "items_total" AND "grand_total" >= "shipping_total"`)),
    foreignKey({
      name: "wholesale_order_account_fk",
      columns: [table.accountId],
      foreignColumns: [wholesaleAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_buyer_user_fk",
      columns: [table.buyerUserId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_originating_request_fk",
      columns: [table.originatingRequestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_cancelled_by_fk",
      columns: [table.cancelledBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const wholesaleOrderItem = pgTable(
  "wholesale_order_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    productId: text("product_id").notNull(),
    /** Phase 4.2.2 — variant vs package selector: one line = PACKAGE, not six variant lines */
    variantId: text("variant_id"),
    sellerOfferId: text("seller_offer_id"),
    /** Phase 4.2 — canonical seller/supplier/package/pricing references */
    sellerId: text("seller_id").notNull(),
    supplierId: text("supplier_id"),
    packageId: text("package_id"),
    pricingTierId: text("pricing_tier_id"),
    /** Phase 4.2.2 — traceability to accepted request */
    sourceRequestId: text("source_request_id"),
    /** Phase 4.2 — immutable snapshots */
    productName: text("product_name").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull().default(""),
    sku: text("sku").notNull(),
    skuSnapshot: text("sku_snapshot"),
    variantSnapshot: jsonb("variant_snapshot").notNull().default({}),
    sellerSnapshot: jsonb("seller_snapshot").notNull().default({}),
    packageTypeSnapshot: text("package_type_snapshot"),
    packageNameSnapshot: text("package_name_snapshot"),
    packageCompositionSnapshot: jsonb("package_composition_snapshot"),
    moqUnitSnapshot: text("moq_unit_snapshot"),
    pricingUnit: text("pricing_unit").notNull().default("PIECE"),
    quantity: integer("quantity").notNull().default(1),
    packageQuantity: integer("package_quantity"),
    pieceQuantity: integer("piece_quantity").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull().default(sql`0`),
    lineTotal: bigint("line_total", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("wholesale_order_item_order").on(table.orderId),
    index("wholesale_order_item_seller_order").on(table.sellerId, table.orderId),
    index("wholesale_order_item_product").on(table.productId),
    stateCheck("wholesale_order_item_package_type_allowed", "package_type_snapshot", PACKAGE_TYPES),
    stateCheck("wholesale_order_item_moq_unit_allowed", "moq_unit_snapshot", MOQ_UNITS),
    stateCheck("wholesale_order_item_pricing_unit_allowed", "pricing_unit", PRICING_UNITS),
    stateCheck("wholesale_order_item_currency_allowed", "currency", CURRENCIES),
    positiveQuantityCheck("wholesale_order_item_quantity_positive", "quantity"),
    quantityCheck("wholesale_order_item_package_quantity_non_negative", "package_quantity"),
    positiveQuantityCheck("wholesale_order_item_piece_quantity_positive", "piece_quantity"),
    moneyCheck("wholesale_order_item_unit_price_range", "unit_price"),
    moneyCheck("wholesale_order_item_line_total_range", "line_total"),
    check(
      "wholesale_order_item_selector_check",
      sql.raw(
        `(("variant_id" IS NOT NULL AND "package_id" IS NULL) OR ("variant_id" IS NULL AND "package_id" IS NOT NULL) OR ("variant_id" IS NULL AND "package_id" IS NULL))`,
      ),
    ),
    check(
      "wholesale_order_item_seller_supplier_consistency",
      sql.raw(`("supplier_id" IS NULL) OR ("supplier_id" IS NOT NULL AND "seller_id" IS NOT NULL)`),
    ),
    foreignKey({
      name: "wholesale_order_item_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_seller_offer_fk",
      columns: [table.sellerOfferId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_package_fk",
      columns: [table.packageId],
      foreignColumns: [wholesalePackage.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_pricing_tier_fk",
      columns: [table.pricingTierId],
      foreignColumns: [wholesalePricingTier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_item_source_request_fk",
      columns: [table.sourceRequestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
  ],
);

/* ── سفارش فرزند تأمین‌کننده (Purchase Order فعلی) — Phase 4.2 evolved ───────
 *  - seller_id NOT NULL + supplier_id NULLABLE + consistency CHECK
 *  - order_code child KV-W-10482-01 pattern, unique
 *  - wholesale_order_id, status, currency, items_total/grand_total,
 *    shipping_responsibility, version, lifecycle timestamps
 */

export const purchaseOrder = pgTable(
  "purchase_order",
  {
    id: text("id").primaryKey(),
    orderCode: text("order_code").notNull().unique(),
    /** Phase 4.2 — seller_id NOT NULL, supplier_id NULLABLE for KOLBE */
    sellerId: text("seller_id").notNull(),
    supplierId: text("supplier_id"),
    wholesaleOrderId: text("wholesale_order_id"),
    status: text("status").notNull().default("pending"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    trackingCode: text("tracking_code"),
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(sql`0`),
    itemsTotal: bigint("items_total", { mode: "bigint" }).notNull().default(sql`0`),
    grandTotal: bigint("grand_total", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    shippingResponsibility: text("shipping_responsibility").notNull().default("SUPPLIER"),
    notes: text("notes"),
    version: integer("version").notNull().default(0),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    preparationStartedAt: timestamp("preparation_started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("purchase_order_status_allowed", "status", PURCHASE_ORDER_STATUS_VALUES),
    stateCheck("purchase_order_shipping_responsibility_allowed", "shipping_responsibility", SHIPPING_RESPONSIBILITIES),
    moneyCheck("purchase_order_total_amount_range", "total_amount"),
    moneyCheck("purchase_order_items_total_range", "items_total"),
    moneyCheck("purchase_order_grand_total_range", "grand_total"),
    stateCheck("purchase_order_currency_allowed", "currency", CURRENCIES),
    quantityCheck("purchase_order_version_non_negative", "version"),
    // Phase 4.2 — unique parent + seller for initial single-child-per-seller scope
    uniqueIndex("purchase_order_wholesale_seller_unique")
      .on(table.wholesaleOrderId, table.sellerId)
      .where(sql`${table.wholesaleOrderId} IS NOT NULL`),
    index("purchase_order_seller_status_created").on(table.sellerId, table.status, table.createdAt),
    index("purchase_order_wholesale_created").on(table.wholesaleOrderId, table.createdAt),
    foreignKey({
      name: "purchase_order_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_wholesale_order_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
  ],
);

export const purchaseOrderItem = pgTable(
  "purchase_order_item",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    /** Phase 4.2 — link to parent wholesale order item for single commercial truth */
    wholesaleOrderItemId: text("wholesale_order_item_id"),
    productId: text("product_id").notNull(),
    /** Phase 4.3 — nullable for package lines: one commercial line per package, reservations own variants */
    variantId: text("variant_id"),
    sellerOfferId: text("seller_offer_id"),
    productName: text("product_name").notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull().default(sql`0`),
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(sql`0`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("purchase_order_item_purchase_order").on(table.purchaseOrderId),
    uniqueIndex("purchase_order_item_parent_child_unique")
      .on(table.wholesaleOrderItemId, table.purchaseOrderId)
      .where(sql`${table.wholesaleOrderItemId} IS NOT NULL`),
    quantityCheck("purchase_order_item_quantity_non_negative", "quantity"),
    moneyCheck("purchase_order_item_unit_price_range", "unit_price"),
    moneyCheck("purchase_order_item_total_amount_range", "total_amount"),
    foreignKey({
      name: "purchase_order_item_purchase_order_fk",
      columns: [table.purchaseOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_item_wholesale_order_item_fk",
      columns: [table.wholesaleOrderItemId],
      foreignColumns: [wholesaleOrderItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_item_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_item_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "purchase_order_item_seller_offer_fk",
      columns: [table.sellerOfferId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.2 — Order status history (append-only) ──────────────────────── */

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id"),
    childOrderId: text("child_order_id"),
    /** Phase 4.3 — NULL means ABSENT→draft/pending creation */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    orderVersion: integer("order_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_status_history_order_created").on(table.orderId, table.createdAt),
    index("order_status_history_child_created").on(table.childOrderId, table.createdAt),
    index("order_status_history_actor_created").on(table.actorId, table.createdAt),
    uniqueIndex("order_status_history_order_version_unique")
      .on(table.orderId, table.orderVersion)
      .where(sql`${table.orderId} IS NOT NULL`),
    uniqueIndex("order_status_history_child_version_unique")
      .on(table.childOrderId, table.orderVersion)
      .where(sql`${table.childOrderId} IS NOT NULL`),
    check(
      "order_status_history_from_status_allowed",
      sql.raw(`"from_status" IS NULL OR "from_status" IN (${ALL_ORDER_STATUSES.map((v) => `'${v}'`).join(", ")})`),
    ),
    stateCheck("order_status_history_to_status_allowed", "to_status", ALL_ORDER_STATUSES),
    stateCheck("order_status_history_actor_role_allowed", "actor_role", ORDER_ACTOR_ROLES),
    quantityCheck("order_status_history_order_version_non_negative", "order_version"),
    check(
      "order_status_history_exactly_one_order_fk",
      sql.raw(`(("order_id" IS NOT NULL AND "child_order_id" IS NULL) OR ("order_id" IS NULL AND "child_order_id" IS NOT NULL))`),
    ),
    foreignKey({
      name: "order_status_history_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_status_history_child_order_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_status_history_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.2 — Order event (append-only) ───────────────────────────────── */

export const orderEvent = pgTable(
  "order_event",
  {
    id: text("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_event_aggregate_created").on(table.aggregateType, table.aggregateId, table.createdAt),
    index("order_event_type_created").on(table.eventType, table.createdAt),
    uniqueIndex("order_event_aggregate_idempotency_unique")
      .on(table.aggregateType, table.aggregateId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    stateCheck("order_event_aggregate_type_allowed", "aggregate_type", ORDER_AGGREGATE_TYPES),
    stateCheck("order_event_event_type_allowed", "event_type", ORDER_EVENT_TYPES),
    stateCheck("order_event_actor_role_allowed", "actor_role", ORDER_ACTOR_ROLES),
    foreignKey({
      name: "order_event_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── RFQ و پیشنهاد قیمت ────────────────────────────────────────────────────── */

export const rfq = pgTable(
  "rfq",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    productId: text("product_id").notNull(),
    sellerOfferId: text("seller_offer_id"),
    referenceCode: text("reference_code").notNull().unique(),
    title: text("title").notNull(),
    customerName: text("customer_name").notNull(),
    quantity: integer("quantity").notNull().default(0),
    requestedDeliveryDate: timestamp("requested_delivery_date", { withTimezone: true }),
    specifications: jsonb("specifications").default({}),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("rfq_status_allowed", "status", RFQ_STATUSES),
    quantityCheck("rfq_quantity_non_negative", "quantity"),
    foreignKey({
      name: "rfq_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "rfq_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "rfq_seller_offer_fk",
      columns: [table.sellerOfferId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
  ],
);

export const quote = pgTable(
  "quote",
  {
    id: text("id").primaryKey(),
    rfqId: text("rfq_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    sellerOfferId: text("seller_offer_id"),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull().default(sql`0`),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    notes: text("notes"),
    status: text("status").notNull().default("submitted"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quote_status_allowed", "status", QUOTE_STATUSES),
    moneyCheck("quote_unit_price_range", "unit_price"),
    quantityCheck("quote_lead_time_days_non_negative", "lead_time_days"),
    foreignKey({
      name: "quote_rfq_fk",
      columns: [table.rfqId],
      foreignColumns: [rfq.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "quote_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "quote_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "quote_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "quote_seller_offer_fk",
      columns: [table.sellerOfferId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
  ],
);

/* ── پشتیبانی ──────────────────────────────────────────────────────────────── */

export const supportTicket = pgTable(
  "support_ticket",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id"),
    subject: text("subject").notNull(),
    category: text("category").notNull().default("عمومی"),
    message: text("message").notNull(),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    adminReply: text("admin_reply"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("support_ticket_status_allowed", "status", SUPPORT_TICKET_STATUSES),
    stateCheck("support_ticket_priority_allowed", "priority", SUPPORT_TICKET_PRIORITIES),
    foreignKey({
      name: "support_ticket_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
  ],
);

/* ── خرده‌فروشی ────────────────────────────────────────────────────────────── */

export const retailOrder = pgTable(
  "retail_order",
  {
    id: text("id").primaryKey(),
    orderCode: text("order_code").notNull().unique(),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    lines: jsonb("lines").notNull().default([]),
    address: jsonb("address").notNull().default({}),
    shippingMethod: text("shipping_method").notNull().default("post"),
    shippingPrice: bigint("shipping_price", { mode: "bigint" }).notNull().default(sql`0`),
    payMethod: text("pay_method").notNull().default("gateway"),
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(sql`0`),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("processing"),
    itemsTotal: bigint("items_total", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    priceBookVersion: text("price_book_version"),
    paymentMethod: text("payment_method"),
    amountSource: text("amount_source").notNull().default("server"),
    customerId: text("customer_id"),
    orderStatus: text("order_status").notNull().default("placed"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("retail_order_idempotency").on(table.idempotencyKey),
    stateCheck("retail_order_status_allowed", "order_status", RETAIL_ORDER_STATUS_VALUES),
    stateCheck("retail_order_payment_status_allowed", "payment_status", RETAIL_PAYMENT_STATUSES),
    stateCheck("retail_order_pay_method_allowed", "pay_method", RETAIL_PAYMENT_METHODS),
    stateCheck("retail_order_payment_method_allowed", "payment_method", RETAIL_PAYMENT_METHODS),
    stateCheck("retail_order_shipping_method_allowed", "shipping_method", SHIPPING_METHOD_IDS),
    stateCheck("retail_order_currency_allowed", "currency", CURRENCIES),
    moneyCheck("retail_order_total_amount_range", "total_amount"),
    moneyCheck("retail_order_items_total_range", "items_total"),
    moneyCheck("retail_order_shipping_price_range", "shipping_price"),
    foreignKey({
      name: "retail_order_customer_fk",
      columns: [table.customerId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const retailOrderItem = pgTable(
  "retail_order_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    productId: text("product_id").notNull(),
    sku: text("sku").notNull(),
    productName: text("product_name").notNull(),
    colour: text("colour"),
    size: text("size"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull().default(sql`0`),
    lineTotal: bigint("line_total", { mode: "bigint" }).notNull().default(sql`0`),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("retail_order_item_order").on(table.orderId),
    quantityCheck("retail_order_item_quantity_non_negative", "quantity"),
    moneyCheck("retail_order_item_unit_price_range", "unit_price"),
    moneyCheck("retail_order_item_line_total_range", "line_total"),
    foreignKey({
      name: "retail_order_item_order_fk",
      columns: [table.orderId],
      foreignColumns: [retailOrder.id],
    }).onDelete("restrict"),
  ],
);

/* ── رصد و حسابرسی ─────────────────────────────────────────────────────────── */

export const systemLog = pgTable(
  "system_log",
  {
    id: text("id").primaryKey(),
    level: text("level").notNull().default("error"),
    source: text("source").notNull().default("system"),
    eventType: text("event_type").notNull().default("application.error"),
    message: text("message").notNull(),
    errorName: text("error_name"),
    stack: text("stack"),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull().default("open"),
    httpMethod: text("http_method"),
    path: text("path"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    requestId: text("request_id"),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    environment: text("environment").notNull().default("development"),
    release: text("release"),
    metadata: jsonb("metadata"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("system_log_open_fingerprint")
      .on(table.fingerprint)
      .where(sql`"status" = 'open'`),
    index("system_log_last_seen").on(table.lastSeenAt.desc()),
  ],
);

export const siteSetting = pgTable("site_setting", {
  settingKey: text("setting_key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedBy: text("updated_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    actorIp: text("actor_ip"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity").on(table.entityType, table.entityId, table.createdAt),
    index("audit_log_created").on(table.createdAt),
    index("audit_log_actor").on(table.actorId, table.createdAt),
  ],
);

/* ── احراز هویت — فاز ۲ ──────────────────────────────────────────────────── */

export const loginAttempt = pgTable(
  "login_attempt",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    email: text("email").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("login_attempt_user_created").on(table.userId, table.createdAt),
    index("login_attempt_email_created").on(table.email, table.createdAt),
    index("login_attempt_ip_created").on(table.ip, table.createdAt),
    foreignKey({
      name: "login_attempt_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const userSession = pgTable(
  "user_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_session_user_created").on(table.userId, table.createdAt),
    index("user_session_token_hash").on(table.tokenHash),
    index("user_session_expires").on(table.expiresAt),
    foreignKey({
      name: "user_session_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── فاز ۳ — کاتالوگ و بازار عمده ────────────────────────────────────────── */

export const brand = pgTable(
  "brand",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logoUrl: text("logo_url"),
    verificationStatus: text("verification_status").notNull().default("pending"),
    creatorId: text("creator_id"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("brand_verification_status_allowed", "verification_status", BRAND_VERIFICATION_STATUSES),
    stateCheck("brand_status_allowed", "status", BRAND_STATUSES),
    foreignKey({
      name: "brand_creator_fk",
      columns: [table.creatorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const category = pgTable(
  "category",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    attributesSchema: jsonb("attributes_schema").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("category_status_allowed", "status", CATEGORY_STATUSES),
    foreignKey({
      name: "category_parent_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
  ],
);

export const product = pgTable(
  "product",
  {
    id: text("id").primaryKey(),
    sku: text("sku").unique(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    brandId: text("brand_id"),
    categoryId: text("category_id"),
    ownerType: text("owner_type").notNull().default("KOLBE"),
    isKolbeExclusive: boolean("is_kolbe_exclusive").notNull().default(false),
    status: text("status").notNull().default("draft"),
    salesCount: integer("sales_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    searchRank: integer("search_rank").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("product_owner_type_allowed", "owner_type", SELLER_TYPES),
    stateCheck("product_status_allowed", "status", PRODUCT_STATUSES),
    quantityCheck("product_sales_count_non_negative", "sales_count"),
    quantityCheck("product_view_count_non_negative", "view_count"),
    foreignKey({
      name: "product_brand_fk",
      columns: [table.brandId],
      foreignColumns: [brand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_category_fk",
      columns: [table.categoryId],
      foreignColumns: [category.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const productMedia = pgTable(
  "product_media",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull().default("image"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "product_media_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    index("product_media_product_position").on(table.productId, table.position),
  ],
);

export const productVariant = pgTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    sku: text("sku").notNull().unique(),
    attributes: jsonb("attributes").notNull().default({}),
    status: text("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("product_variant_status_allowed", "status", PRODUCT_VARIANT_STATUSES),
    foreignKey({
      name: "product_variant_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    index("product_variant_product").on(table.productId),
  ],
);

export const productVariantMedia = pgTable(
  "product_variant_media",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull().default("image"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "product_variant_media_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
  ],
);

export const seller = pgTable(
  "seller",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    supplierId: text("supplier_id"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("seller_type_allowed", "type", SELLER_TYPES),
    stateCheck("seller_status_allowed", "status", BRAND_STATUSES),
    foreignKey({
      name: "seller_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    uniqueIndex("seller_supplier_unique").on(table.supplierId),
    uniqueIndex("seller_kolbe_singleton").on(table.type).where(sql`${table.type} = 'KOLBE'`),
    check(
      "seller_type_supplier_consistency",
      sql.raw(`("type" = 'KOLBE' AND "supplier_id" IS NULL) OR ("type" = 'SUPPLIER' AND "supplier_id" IS NOT NULL)`),
    ),
  ],
);

export const supplierProductSubmission = pgTable(
  "supplier_product_submission",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    sellerId: text("seller_id").notNull(),
    proposedName: text("proposed_name").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    proposedDescription: text("proposed_description").notNull().default(""),
    brandId: text("brand_id"),
    proposedBrandId: text("proposed_brand_id"),
    categoryId: text("category_id"),
    attributes: jsonb("attributes").notNull().default({}),
    variants: jsonb("variants").notNull().default([]),
    media: jsonb("media").notNull().default([]),
    commercial: jsonb("commercial").notNull().default({}),
    status: text("status").notNull().default("pending_review"),
    matchedProductId: text("matched_product_id"),
    approvedProductId: text("approved_product_id"),
    adminReviewNote: text("admin_review_note"),
    createdBy: text("created_by").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_product_submission_status_allowed", "status", SUPPLIER_PRODUCT_SUBMISSION_STATUSES),
    foreignKey({ name: "supplier_product_submission_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_seller_fk", columns: [table.sellerId], foreignColumns: [seller.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_brand_fk", columns: [table.brandId], foreignColumns: [brand.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_proposed_brand_fk", columns: [table.proposedBrandId], foreignColumns: [brand.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_category_fk", columns: [table.categoryId], foreignColumns: [category.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_matched_product_fk", columns: [table.matchedProductId], foreignColumns: [product.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_approved_product_fk", columns: [table.approvedProductId], foreignColumns: [product.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_product_submission_reviewed_by_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    index("supplier_product_submission_supplier_status").on(table.supplierId, table.status),
  ],
);

export const sellerOffer = pgTable(
  "seller_offer",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    sellerId: text("seller_id").notNull(),
    variantId: text("variant_id"),
    sku: text("sku").notNull().unique(),
    status: text("status").notNull().default("draft"),
    wholesalePrice: bigint("wholesale_price", { mode: "bigint" }).notNull().default(sql`0`),
    retailPrice: bigint("retail_price", { mode: "bigint" }),
    currency: text("currency").notNull().default("IRR"),
    moq: integer("moq").notNull().default(1),
    moqUnit: text("moq_unit").notNull().default("PIECE"),
    /** Phase 4.2.2 — explicit pricing unit */
    pricingUnit: text("pricing_unit").notNull().default("PIECE"),
    packageType: text("package_type"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("seller_offer_status_allowed", "status", OFFER_STATUSES),
    stateCheck("seller_offer_moq_unit_allowed", "moq_unit", MOQ_UNITS),
    stateCheck("seller_offer_pricing_unit_allowed", "pricing_unit", PRICING_UNITS),
    check("seller_offer_package_type_allowed", sql.raw(`"package_type" IS NULL OR "package_type" IN ('SIZE_RUN','FIXED_QUANTITY','COLOR_MIX','CUSTOM_BUNDLE')`)),
    moneyCheck("seller_offer_wholesale_price_range", "wholesale_price"),
    positiveQuantityCheck("seller_offer_moq_positive", "moq"),
    foreignKey({
      name: "seller_offer_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "seller_offer_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "seller_offer_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    stateCheck("seller_offer_currency_allowed", "currency", CURRENCIES),
    index("seller_offer_product_seller").on(table.productId, table.sellerId),
  ],
);

export const offerMedia = pgTable(
  "offer_media",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull(),
    url: text("url").notNull(),
    type: text("type").notNull().default("image"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "offer_media_offer_fk",
      columns: [table.offerId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
  ],
);

export const wholesalePackage = pgTable(
  "wholesale_package",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull(),
    packageType: text("package_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    totalPieces: integer("total_pieces").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_package_type_allowed", "package_type", PACKAGE_TYPES),
    positiveQuantityCheck("wholesale_package_total_pieces_positive", "total_pieces"),
    foreignKey({
      name: "wholesale_package_offer_fk",
      columns: [table.offerId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
  ],
);

export const wholesalePackageItem = pgTable(
  "wholesale_package_item",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id").notNull(),
    variantId: text("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    positiveQuantityCheck("wholesale_package_item_quantity_positive", "quantity"),
    uniqueIndex("wholesale_package_item_package_variant_unique").on(table.packageId, table.variantId),
    foreignKey({
      name: "wholesale_package_item_package_fk",
      columns: [table.packageId],
      foreignColumns: [wholesalePackage.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_package_item_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
  ],
);

export const wholesalePricingTier = pgTable(
  "wholesale_pricing_tier",
  {
    id: text("id").primaryKey(),
    offerId: text("offer_id").notNull(),
    minQuantity: integer("min_quantity").notNull(),
    maxQuantity: integer("max_quantity"),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    moqUnit: text("moq_unit").notNull().default("PACKAGE"),
    /** Phase 4.2.2 — explicit pricing unit */
    pricingUnit: text("pricing_unit").notNull().default("PACKAGE"),
    createdAt: createdAt(),
  },
  (table) => [
    positiveQuantityCheck("wholesale_pricing_tier_min_quantity_positive", "min_quantity"),
    moneyCheck("wholesale_pricing_tier_unit_price_range", "unit_price"),
    check("wholesale_pricing_tier_range_valid", sql.raw(`"max_quantity" IS NULL OR "max_quantity" >= "min_quantity"`)),
    stateCheck("wholesale_pricing_tier_moq_unit_allowed", "moq_unit", MOQ_UNITS),
    stateCheck("wholesale_pricing_tier_pricing_unit_allowed", "pricing_unit", PRICING_UNITS),
    stateCheck("wholesale_pricing_tier_currency_allowed", "currency", CURRENCIES),
    foreignKey({
      name: "wholesale_pricing_tier_offer_fk",
      columns: [table.offerId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
    index("wholesale_pricing_tier_offer_min").on(table.offerId, table.minQuantity),
  ],
);

export const supplierPermissionConfig = pgTable(
  "supplier_permission_config",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull().unique(),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_permission_action_allowed", "action", SUPPLIER_PERMISSION_ACTIONS),
  ],
);

export const vipPlan = pgTable(
  "vip_plan",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    price: bigint("price", { mode: "bigint" }).notNull().default(sql`0`),
    durationDays: integer("duration_days").notNull().default(365),
    features: jsonb("features").notNull().default({}),
    limits: jsonb("limits").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("vip_plan_status_allowed", "status", VIP_PLAN_STATUSES),
    moneyCheck("vip_plan_price_range", "price"),
    positiveQuantityCheck("vip_plan_duration_days_positive", "duration_days"),
  ],
);

export const vipSubscription = pgTable(
  "vip_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    planId: text("plan_id").notNull(),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("vip_subscription_status_allowed", "status", VIP_SUBSCRIPTION_STATUSES),
    foreignKey({
      name: "vip_subscription_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "vip_subscription_plan_fk",
      columns: [table.planId],
      foreignColumns: [vipPlan.id],
    }).onDelete("restrict"),
    index("vip_subscription_user_status").on(table.userId, table.status),
  ],
);

export const wholesaleRequest = pgTable(
  "wholesale_request",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    offerId: text("offer_id").notNull(),
    vipAccountId: text("vip_account_id").notNull(),
    /** Phase 4.2.2 — variant vs package selector */
    variantId: text("variant_id"),
    packageId: text("package_id"),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    /** Phase 4.2.2 — versioning and accepted terms snapshot */
    version: integer("version").notNull().default(0),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by"),
    acceptedTermsSnapshot: jsonb("accepted_terms_snapshot"),
    acceptedTermsHash: text("accepted_terms_hash"),
    acceptanceExpiresAt: timestamp("acceptance_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_request_status_allowed", "status", WHOLESALE_REQUEST_STATUSES),
    positiveQuantityCheck("wholesale_request_quantity_positive", "quantity"),
    quantityCheck("wholesale_request_version_non_negative", "version"),
    check(
      "wholesale_request_selector_check",
      sql.raw(
        `(("variant_id" IS NOT NULL AND "package_id" IS NULL) OR ("variant_id" IS NULL AND "package_id" IS NOT NULL) OR ("variant_id" IS NULL AND "package_id" IS NULL))`,
      ),
    ),
    foreignKey({
      name: "wholesale_request_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_offer_fk",
      columns: [table.offerId],
      foreignColumns: [sellerOffer.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_vip_account_fk",
      columns: [table.vipAccountId],
      foreignColumns: [wholesaleAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_package_fk",
      columns: [table.packageId],
      foreignColumns: [wholesalePackage.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_accepted_by_fk",
      columns: [table.acceptedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("wholesale_request_account_status").on(table.vipAccountId, table.status),
    index("wholesale_request_status_created").on(table.status, table.createdAt),
  ],
);

export const productRating = pgTable(
  "product_rating",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    raterId: text("rater_id").notNull(),
    rating: integer("rating").notNull(),
    review: text("review"),
    status: text("status").notNull().default("visible"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("product_rating_status_allowed", "status", RATING_STATUSES),
    quantityCheck("product_rating_rating_range", "rating"),
    check("product_rating_rating_1_5", sql.raw(`"rating" >= 1 AND "rating" <= 5`)),
    foreignKey({
      name: "product_rating_product_fk",
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_rating_rater_fk",
      columns: [table.raterId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const supplierRating = pgTable(
  "supplier_rating",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    raterId: text("rater_id").notNull(),
    rating: integer("rating").notNull(),
    review: text("review"),
    status: text("status").notNull().default("visible"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("supplier_rating_status_allowed", "status", RATING_STATUSES),
    check("supplier_rating_rating_1_5", sql.raw(`"rating" >= 1 AND "rating" <= 5`)),
    foreignKey({
      name: "supplier_rating_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "supplier_rating_rater_fk",
      columns: [table.raterId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const transactionRating = pgTable(
  "transaction_rating",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    orderType: text("order_type").notNull().default("wholesale"),
    raterId: text("rater_id").notNull(),
    rating: integer("rating").notNull(),
    review: text("review"),
    status: text("status").notNull().default("visible"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("transaction_rating_status_allowed", "status", RATING_STATUSES),
    check("transaction_rating_rating_1_5", sql.raw(`"rating" >= 1 AND "rating" <= 5`)),
    foreignKey({
      name: "transaction_rating_rater_fk",
      columns: [table.raterId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── فاز ۳.۸ — موجودی کانونیکال ────────────────────────────────────────── */

export const productVariantInventory = pgTable(
  "product_variant_inventory",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull(),
    sellerId: text("seller_id").notNull(),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("product_variant_inventory_status_allowed", "status", VARIANT_INVENTORY_STATUS),
    quantityCheck("product_variant_inventory_on_hand_non_negative", "on_hand"),
    quantityCheck("product_variant_inventory_reserved_non_negative", "reserved"),
    check("product_variant_inventory_reserved_within_on_hand", sql.raw(`"reserved" <= "on_hand"`)),
    foreignKey({
      name: "product_variant_inventory_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "product_variant_inventory_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    uniqueIndex("product_variant_inventory_variant_seller_unique").on(table.variantId, table.sellerId),
    index("product_variant_inventory_seller").on(table.sellerId),
  ],
);

export const inventoryReservation = pgTable(
  "inventory_reservation",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull(),
    sellerId: text("seller_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    requestId: text("request_id"),
    createdBy: text("created_by"),
    idempotencyKey: text("idempotency_key"),
    allocationId: text("allocation_id"),
    /** Phase 4.2 — linkage to orders */
    orderId: text("order_id"),
    orderItemId: text("order_item_id"),
    /** Phase 4.4 — linkage to child order for isolated release/consume */
    childOrderId: text("child_order_id"),
    /**
     * Phase 4.7.1 — exact partial consumption. A shipment handoff consumes a
     * portion of the *order* reservation (no second reservation); the sum of
     * consumed pieces can never exceed the reserved quantity (CHECK below).
     */
    consumedQuantity: integer("consumed_quantity").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("inventory_reservation_status_allowed", "status", INVENTORY_RESERVATION_STATUSES),
    positiveQuantityCheck("inventory_reservation_quantity_positive", "quantity"),
    check("inventory_reservation_consumed_within_quantity", sql.raw(`"consumed_quantity" >= 0 AND "consumed_quantity" <= "quantity"`)),
    foreignKey({
      name: "inventory_reservation_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_request_fk",
      columns: [table.requestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_order_item_fk",
      columns: [table.orderItemId],
      foreignColumns: [wholesaleOrderItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_reservation_child_order_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    index("inventory_reservation_variant_seller").on(table.variantId, table.sellerId),
    index("inventory_reservation_status_expires").on(table.status, table.expiresAt),
    index("inventory_reservation_allocation").on(table.allocationId),
    index("inventory_reservation_order").on(table.orderId),
    index("inventory_reservation_order_item").on(table.orderItemId),
    index("inventory_reservation_child_order").on(table.childOrderId),
    uniqueIndex("inventory_reservation_idempotency_unique").on(table.sellerId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("inventory_reservation_allocation_unique").on(table.allocationId, table.sellerId, table.variantId).where(sql`${table.allocationId} IS NOT NULL`),
    // Phase 4.2 — invariant (order_item_id, variant_id, seller_id) unique for active canonical allocation
    uniqueIndex("inventory_reservation_order_item_variant_seller_unique")
      .on(table.orderItemId, table.variantId, table.sellerId)
      .where(sql`${table.orderItemId} IS NOT NULL`),
  ],
);

export const inventoryLedger = pgTable(
  "inventory_ledger",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id").notNull(),
    sellerId: text("seller_id").notNull(),
    changeType: text("change_type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    beforeOnHand: integer("before_on_hand").notNull().default(0),
    afterOnHand: integer("after_on_hand").notNull().default(0),
    beforeReserved: integer("before_reserved").notNull().default(0),
    afterReserved: integer("after_reserved").notNull().default(0),
    reason: text("reason"),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    stateCheck("inventory_ledger_change_type_allowed", "change_type", INVENTORY_LEDGER_CHANGE_TYPES),
    foreignKey({
      name: "inventory_ledger_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_ledger_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "inventory_ledger_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("inventory_ledger_variant_created").on(table.variantId, table.createdAt),
    index("inventory_ledger_seller_created").on(table.sellerId, table.createdAt),
  ],
);

/* ── فاز ۴.۱ — Idempotency ───────────────────────────────────────────────── */


/* ── Phase 4.2.2 — Multi-request → one parent order link (Orders-owned) ────
 *  - request_id UNIQUE: one request may convert to at most one canonical order
 *  - UNIQUE(order_id, request_id)
 *  - FKs RESTRICT, no CASCADE
 *  - wholesale_order.originating_request_id remains as legacy compatibility pointer
 *  - canonical engine MUST use this table as authoritative relation
 */
export const wholesaleOrderRequest = pgTable(
  "wholesale_order_request",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    requestId: text("request_id").notNull(),
    requestVersion: integer("request_version").notNull().default(0),
    acceptedTermsHash: text("accepted_terms_hash"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "wholesale_order_request_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_order_request_request_fk",
      columns: [table.requestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
    uniqueIndex("wholesale_order_request_request_unique").on(table.requestId),
    uniqueIndex("wholesale_order_request_order_request_unique").on(table.orderId, table.requestId),
    index("wholesale_order_request_order").on(table.orderId),
    index("wholesale_order_request_request").on(table.requestId),
  ],
);

export const commandIdempotency = pgTable(
  "command_idempotency",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").notNull().default("pending"),
    resultResourceId: text("result_resource_id"),
    resultPayload: jsonb("result_payload"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    stateCheck("command_idempotency_state_allowed", "state", COMMAND_IDEMPOTENCY_STATES),
    stateCheck("command_idempotency_command_type_allowed", "command_type", COMMAND_TYPES),
    uniqueIndex("command_idempotency_scope_key_unique").on(table.scopeType, table.scopeId, table.commandType, table.idempotencyKey),
    index("command_idempotency_expires").on(table.expiresAt),
    index("command_idempotency_created").on(table.createdAt),
  ],
);

/* ── Phase 4.4 — Wholesale request revision (VIP-owned, append-only) ─────── */
export const wholesaleRequestRevision = pgTable(
  "wholesale_request_revision",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    requestVersion: integer("request_version").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    proposedByUserId: text("proposed_by_user_id").notNull(),
    proposedByRole: text("proposed_by_role").notNull(),
    reason: text("reason"),
    proposedQuantity: integer("proposed_quantity"),
    proposedVariantId: text("proposed_variant_id"),
    proposedPackageId: text("proposed_package_id"),
    pricingUnit: text("pricing_unit"),
    proposedUnitPrice: bigint("proposed_unit_price", { mode: "bigint" }),
    currency: text("currency").notNull().default("IRR"),
    proposedTermsSnapshot: jsonb("proposed_terms_snapshot").notNull().default({}),
    proposedTermsHash: text("proposed_terms_hash"),
    buyerRespondedAt: timestamp("buyer_responded_at", { withTimezone: true }),
    buyerRespondedBy: text("buyer_responded_by"),
    buyerResponse: text("buyer_response"),
    createdAt: createdAt(),
  },
  (table) => [
    quantityCheck("wholesale_request_revision_request_version_non_negative", "request_version"),
    positiveQuantityCheck("wholesale_request_revision_revision_number_positive", "revision_number"),
    quantityCheck("wholesale_request_revision_proposed_quantity_non_negative", "proposed_quantity"),
    stateCheck("wholesale_request_revision_pricing_unit_allowed", "pricing_unit", PRICING_UNITS),
    stateCheck("wholesale_request_revision_currency_allowed", "currency", CURRENCIES),
    stateCheck("wholesale_request_revision_buyer_response_allowed", "buyer_response", WHOLESALE_REVISION_BUYER_RESPONSES),
    stateCheck("wholesale_request_revision_proposed_by_role_allowed", "proposed_by_role", ORDER_ACTOR_ROLES),
    moneyCheck("wholesale_request_revision_proposed_unit_price_range", "proposed_unit_price"),
    check(
      "wholesale_request_revision_selector_check",
      sql.raw(
        `(("proposed_variant_id" IS NULL AND "proposed_package_id" IS NULL) OR ("proposed_variant_id" IS NOT NULL AND "proposed_package_id" IS NULL) OR ("proposed_variant_id" IS NULL AND "proposed_package_id" IS NOT NULL))`,
      ),
    ),
    uniqueIndex("wholesale_request_revision_request_revision_unique").on(table.requestId, table.revisionNumber),
    index("wholesale_request_revision_request_created").on(table.requestId, table.createdAt),
    foreignKey({
      name: "wholesale_request_revision_request_fk",
      columns: [table.requestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_revision_proposed_by_fk",
      columns: [table.proposedByUserId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_revision_buyer_responded_by_fk",
      columns: [table.buyerRespondedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_revision_proposed_variant_fk",
      columns: [table.proposedVariantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_request_revision_proposed_package_fk",
      columns: [table.proposedPackageId],
      foreignColumns: [wholesalePackage.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.4 — Fulfillment exception (Fulfillment-owned) ───────────────── */
export const fulfillmentException = pgTable(
  "fulfillment_exception",
  {
    id: text("id").primaryKey(),
    childOrderId: text("child_order_id").notNull(),
    sellerId: text("seller_id").notNull(),
    wholesaleOrderId: text("wholesale_order_id"),
    type: text("type").notNull(),
    reasonCode: text("reason_code"),
    reason: text("reason"),
    status: text("status").notNull().default("open"),
    reportedBy: text("reported_by").notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    affectedAmount: bigint("affected_amount", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    affectedItemsSnapshot: jsonb("affected_items_snapshot").notNull().default([]),
    buyerResolution: text("buyer_resolution"),
    buyerResolvedAt: timestamp("buyer_resolved_at", { withTimezone: true }),
    buyerResolvedBy: text("buyer_resolved_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("fulfillment_exception_type_allowed", "type", FULFILLMENT_EXCEPTION_TYPES),
    stateCheck("fulfillment_exception_status_allowed", "status", FULFILLMENT_EXCEPTION_STATUSES),
    stateCheck("fulfillment_exception_buyer_resolution_allowed", "buyer_resolution", FULFILLMENT_EXCEPTION_BUYER_RESOLUTIONS),
    stateCheck("fulfillment_exception_currency_allowed", "currency", CURRENCIES),
    moneyCheck("fulfillment_exception_affected_amount_range", "affected_amount"),
    index("fulfillment_exception_child_status").on(table.childOrderId, table.status),
    index("fulfillment_exception_seller_status").on(table.sellerId, table.status),
    index("fulfillment_exception_wholesale_status").on(table.wholesaleOrderId, table.status),
    foreignKey({
      name: "fulfillment_exception_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_exception_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_exception_wholesale_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_exception_reported_by_fk",
      columns: [table.reportedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_exception_buyer_resolved_by_fk",
      columns: [table.buyerResolvedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.5 — Fulfillment replacement request (Fulfillment-owned link) ──
 *  - Fulfillment-owned, not VIP-owned
 *  - Links exception_id → replacement_request_id
 *  - RESTRICT FKs, no CASCADE
 *  - Unique indexes prevent one exception replacing multiple, or one replacement linked to multiple exceptions
 */
export const fulfillmentReplacementRequest = pgTable(
  "fulfillment_replacement_request",
  {
    id: text("id").primaryKey(),
    exceptionId: text("exception_id").notNull(),
    replacementRequestId: text("replacement_request_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fulfillment_replacement_request_exception_fk",
      columns: [table.exceptionId],
      foreignColumns: [fulfillmentException.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_replacement_request_replacement_fk",
      columns: [table.replacementRequestId],
      foreignColumns: [wholesaleRequest.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fulfillment_replacement_request_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("fulfillment_replacement_request_exception_unique").on(table.exceptionId),
    uniqueIndex("fulfillment_replacement_request_replacement_unique").on(table.replacementRequestId),
    index("fulfillment_replacement_request_exception_created").on(table.exceptionId, table.createdAt),
    index("fulfillment_replacement_request_created").on(table.createdAt),
  ],
);

/* ── Phase 4.6 — Wholesale Finance Foundation ────────────────────────────
 *  - Proforma per seller child
 *  - Payment aggregate (manual transfer first)
 *  - Payment allocation per proforma
 *  - Financial release evidence (payment_verified, credit_approved, cod_policy_approved, manual_authorized_release)
 *  - Financial ledger append-only (IN/OUT)
 *  - Refund aggregate partial refunds per child isolation
 *  - All FKs RESTRICT, no CASCADE historical destruction, BIGINT money, immutable snapshots
 */

export const wholesaleProforma = pgTable(
  "wholesale_proforma",
  {
    id: text("id").primaryKey(),
    proformaNumber: text("proforma_number").notNull().unique(),
    wholesaleOrderId: text("wholesale_order_id").notNull(),
    childOrderId: text("child_order_id").notNull(),
    sellerId: text("seller_id").notNull(),
    supplierId: text("supplier_id"),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("IRR"),
    itemsTotal: bigint("items_total", { mode: "bigint" }).notNull().default(sql`0`),
    shippingTotal: bigint("shipping_total", { mode: "bigint" }).notNull().default(sql`0`),
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull().default(sql`0`),
    termsSnapshot: jsonb("terms_snapshot").notNull().default({}),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: text("superseded_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_proforma_status_allowed", "status", WHOLESALE_PROFORMA_STATUSES),
    stateCheck("wholesale_proforma_currency_allowed", "currency", CURRENCIES),
    moneyCheck("wholesale_proforma_items_total_range", "items_total"),
    moneyCheck("wholesale_proforma_shipping_total_range", "shipping_total"),
    moneyCheck("wholesale_proforma_total_amount_range", "total_amount"),
    quantityCheck("wholesale_proforma_version_non_negative", "version"),
    uniqueIndex("wholesale_proforma_number_unique").on(table.proformaNumber),
    // One current active issued version per child: partial unique where status=issued
    uniqueIndex("wholesale_proforma_child_issued_unique")
      .on(table.childOrderId, table.status)
      .where(sql`${table.status} = 'issued'`),
    index("wholesale_proforma_order_created").on(table.wholesaleOrderId, table.createdAt),
    index("wholesale_proforma_child_created").on(table.childOrderId, table.createdAt),
    index("wholesale_proforma_seller_created").on(table.sellerId, table.createdAt),
    foreignKey({
      name: "wholesale_proforma_order_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_superseded_by_fk",
      columns: [table.supersededBy],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
  ],
);

export const wholesaleProformaLine = pgTable(
  "wholesale_proforma_line",
  {
    id: text("id").primaryKey(),
    proformaId: text("proforma_id").notNull(),
    wholesaleOrderItemId: text("wholesale_order_item_id").notNull(),
    purchaseOrderItemId: text("purchase_order_item_id"),
    descriptionSnapshot: text("description_snapshot").notNull().default(""),
    skuSnapshot: text("sku_snapshot").notNull().default(""),
    quantity: integer("quantity").notNull().default(1),
    pricingUnit: text("pricing_unit").notNull().default("PIECE"),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull().default(sql`0`),
    lineTotal: bigint("line_total", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("wholesale_proforma_line_pricing_unit_allowed", "pricing_unit", PRICING_UNITS),
    stateCheck("wholesale_proforma_line_currency_allowed", "currency", CURRENCIES),
    moneyCheck("wholesale_proforma_line_unit_price_range", "unit_price"),
    moneyCheck("wholesale_proforma_line_line_total_range", "line_total"),
    positiveQuantityCheck("wholesale_proforma_line_quantity_positive", "quantity"),
    index("wholesale_proforma_line_proforma").on(table.proformaId),
    index("wholesale_proforma_line_order_item").on(table.wholesaleOrderItemId),
    foreignKey({
      name: "wholesale_proforma_line_proforma_fk",
      columns: [table.proformaId],
      foreignColumns: [wholesaleProforma.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_line_wholesale_item_fk",
      columns: [table.wholesaleOrderItemId],
      foreignColumns: [wholesaleOrderItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_proforma_line_purchase_item_fk",
      columns: [table.purchaseOrderItemId],
      foreignColumns: [purchaseOrderItem.id],
    }).onDelete("restrict"),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: text("id").primaryKey(),
    paymentReference: text("payment_reference").notNull().unique(),
    wholesaleOrderId: text("wholesale_order_id").notNull(),
    method: text("method").notNull(),
    provider: text("provider").notNull().default("manual"),
    status: text("status").notNull().default("pending"),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    externalReference: text("external_reference"),
    submittedBy: text("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    version: integer("version").notNull().default(0),
    // Phase 4.7 — provider-ready fields generic
    providerReference: text("provider_reference"),
    providerState: text("provider_state"),
    redirectUrl: text("redirect_url"),
    providerPayloadHash: text("provider_payload_hash"),
    lastProviderCallAt: timestamp("last_provider_call_at", { withTimezone: true }),
    providerAttempts: integer("provider_attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("payment_status_allowed", "status", PAYMENT_STATUSES),
    stateCheck("payment_method_allowed", "method", PAYMENT_METHODS),
    stateCheck("payment_currency_allowed", "currency", CURRENCIES),
    moneyCheck("payment_amount_range", "amount"),
    quantityCheck("payment_version_non_negative", "version"),
    uniqueIndex("payment_reference_unique").on(table.paymentReference),
    uniqueIndex("payment_order_idempotency_unique")
      .on(table.wholesaleOrderId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    /** Phase 4.7.1 (A5) — a provider reference identifies exactly one payment per provider. */
    uniqueIndex("payment_provider_reference_unique")
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} IS NOT NULL`),
    index("payment_order_created").on(table.wholesaleOrderId, table.createdAt),
    index("payment_status_created").on(table.status, table.createdAt),
    foreignKey({
      name: "payment_order_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_submitted_by_fk",
      columns: [table.submittedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_verified_by_fk",
      columns: [table.verifiedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    proformaId: text("proforma_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("payment_allocation_currency_allowed", "currency", CURRENCIES),
    stateCheck("payment_allocation_status_allowed", "status", PAYMENT_ALLOCATION_STATUS),
    moneyCheck("payment_allocation_amount_range", "amount"),
    check("payment_allocation_amount_positive", sql.raw(`"amount" > 0`)),
    uniqueIndex("payment_allocation_payment_proforma_unique").on(table.paymentId, table.proformaId),
    index("payment_allocation_payment_created").on(table.paymentId, table.createdAt),
    index("payment_allocation_proforma_created").on(table.proformaId, table.createdAt),
    foreignKey({
      name: "payment_allocation_payment_fk",
      columns: [table.paymentId],
      foreignColumns: [payment.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_allocation_proforma_fk",
      columns: [table.proformaId],
      foreignColumns: [wholesaleProforma.id],
    }).onDelete("restrict"),
  ],
);

export const orderFinancialRelease = pgTable(
  "order_financial_release",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    releaseType: text("release_type").notNull(),
    evidenceReference: text("evidence_reference"),
    amount: bigint("amount", { mode: "bigint" }),
    currency: text("currency").default("IRR"),
    actorId: text("actor_id"),
    actorRole: text("actor_role"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("order_financial_release_type_allowed", "release_type", FINANCIAL_RELEASE_TYPES),
    stateCheck("order_financial_release_currency_allowed", "currency", CURRENCIES),
    index("order_financial_release_order_created").on(table.orderId, table.createdAt),
    index("order_financial_release_type_created").on(table.releaseType, table.createdAt),
    // Phase 4.6.1 — one payment_verified release per order gate transition
    uniqueIndex("order_financial_release_payment_verified_once").on(table.orderId).where(sql`${table.releaseType} = 'payment_verified'`),
    foreignKey({
      name: "order_financial_release_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_financial_release_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const financialLedgerEntry = pgTable(
  "financial_ledger_entry",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    childOrderId: text("child_order_id"),
    paymentId: text("payment_id"),
    refundId: text("refund_id"),
    entryType: text("entry_type").notNull(),
    direction: text("direction").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    externalReference: text("external_reference"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    stateCheck("financial_ledger_entry_type_allowed", "entry_type", FINANCIAL_LEDGER_ENTRY_TYPES),
    stateCheck("financial_ledger_direction_allowed", "direction", FINANCIAL_LEDGER_DIRECTIONS),
    stateCheck("financial_ledger_currency_allowed", "currency", CURRENCIES),
    // amount >0 enforced via CHECK raw
    check("financial_ledger_amount_positive", sql.raw(`"amount" > 0`)),
    index("financial_ledger_order_created").on(table.orderId, table.createdAt),
    index("financial_ledger_child_created").on(table.childOrderId, table.createdAt),
    index("financial_ledger_payment_created").on(table.paymentId, table.createdAt),
    index("financial_ledger_refund_created").on(table.refundId, table.createdAt),
    foreignKey({
      name: "financial_ledger_order_fk",
      columns: [table.orderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "financial_ledger_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "financial_ledger_payment_fk",
      columns: [table.paymentId],
      foreignColumns: [payment.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "financial_ledger_refund_fk",
      columns: [table.refundId],
      foreignColumns: [refund.id],
    }).onDelete("restrict"),
  ],
);

export const refund = pgTable(
  "refund",
  {
    id: text("id").primaryKey(),
    refundReference: text("refund_reference").notNull().unique(),
    wholesaleOrderId: text("wholesale_order_id").notNull(),
    childOrderId: text("child_order_id"),
    fulfillmentExceptionId: text("fulfillment_exception_id"),
    paymentId: text("payment_id"),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    reasonCode: text("reason_code"),
    reason: text("reason"),
    status: text("status").notNull().default("requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    externalReference: text("external_reference"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("refund_status_allowed", "status", REFUND_STATUSES),
    stateCheck("refund_currency_allowed", "currency", CURRENCIES),
    moneyCheck("refund_amount_range", "amount"),
    quantityCheck("refund_version_non_negative", "version"),
    uniqueIndex("refund_reference_unique").on(table.refundReference),
    uniqueIndex("refund_order_idempotency_unique")
      .on(table.wholesaleOrderId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("refund_order_created").on(table.wholesaleOrderId, table.createdAt),
    index("refund_child_created").on(table.childOrderId, table.createdAt),
    index("refund_status_created").on(table.status, table.createdAt),
    foreignKey({
      name: "refund_order_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refund_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refund_exception_fk",
      columns: [table.fulfillmentExceptionId],
      foreignColumns: [fulfillmentException.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refund_payment_fk",
      columns: [table.paymentId],
      foreignColumns: [payment.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.7.1 — Refund source mapping & exact item basis ────────────────
 *  - refund_allocation: which verified payment(s) a refund is drawn from
 *    (SUM(refund_allocation.amount) == refund.amount, enforced by the writer
 *    under the payment row lock; a refund can never exceed what its source
 *    payments actually allocated to the child).
 *  - refund_line: exact item/quantity basis of a partial refund
 *    (unit_price × quantity from the immutable proforma line; refunded
 *    quantity per order item can never exceed the ordered quantity).
 */

export const refundAllocation = pgTable(
  "refund_allocation",
  {
    id: text("id").primaryKey(),
    refundId: text("refund_id").notNull(),
    paymentId: text("payment_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
  },
  (table) => [
    check("refund_allocation_amount_positive", sql.raw(`"amount" > 0 AND "amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    stateCheck("refund_allocation_currency_allowed", "currency", CURRENCIES),
    uniqueIndex("refund_allocation_refund_payment_unique").on(table.refundId, table.paymentId),
    index("refund_allocation_payment").on(table.paymentId),
    foreignKey({
      name: "refund_allocation_refund_fk",
      columns: [table.refundId],
      foreignColumns: [refund.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refund_allocation_payment_fk",
      columns: [table.paymentId],
      foreignColumns: [payment.id],
    }).onDelete("restrict"),
  ],
);

export const refundLine = pgTable(
  "refund_line",
  {
    id: text("id").primaryKey(),
    refundId: text("refund_id").notNull(),
    wholesaleOrderItemId: text("wholesale_order_item_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    lineTotal: bigint("line_total", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
  },
  (table) => [
    positiveQuantityCheck("refund_line_quantity_positive", "quantity"),
    moneyCheck("refund_line_unit_price_range", "unit_price"),
    check("refund_line_total_matches", sql.raw(`"line_total" = "unit_price" * "quantity"`)),
    stateCheck("refund_line_currency_allowed", "currency", CURRENCIES),
    uniqueIndex("refund_line_refund_item_unique").on(table.refundId, table.wholesaleOrderItemId),
    index("refund_line_item").on(table.wholesaleOrderItemId),
    foreignKey({
      name: "refund_line_refund_fk",
      columns: [table.refundId],
      foreignColumns: [refund.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "refund_line_item_fk",
      columns: [table.wholesaleOrderItemId],
      foreignColumns: [wholesaleOrderItem.id],
    }).onDelete("restrict"),
  ],
);

/* ── Phase 4.7 — Provider-ready Payment & Shipping Foundation ──────────────
 *  - payment_provider_event inbox for webhook/callback idempotency
 *  - shipping_quote immutable snapshot
 *  - shipment + shipment_item + shipment_event for provider-ready shipping
 *  - All FKs RESTRICT, BIGINT money, no CASCADE
 */

export const paymentProviderEvent = pgTable(
  "payment_provider_event",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    externalPaymentReference: text("external_payment_reference"),
    eventType: text("event_type").notNull().default("unknown"),
    payloadHash: text("payload_hash"),
    safeMetadata: jsonb("safe_metadata").notNull().default({}),
    status: text("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("payment_provider_event_status_allowed", "status", PAYMENT_PROVIDER_EVENT_STATUSES),
    stateCheck("payment_provider_event_type_allowed", "event_type", PAYMENT_PROVIDER_EVENT_TYPES),
    uniqueIndex("payment_provider_event_provider_external_unique").on(table.provider, table.externalEventId),
    index("payment_provider_event_provider_created").on(table.provider, table.createdAt),
    index("payment_provider_event_status_created").on(table.status, table.createdAt),
    index("payment_provider_event_external_ref").on(table.externalPaymentReference),
  ],
);

export const shippingQuote = pgTable(
  "shipping_quote",
  {
    id: text("id").primaryKey(),
    quoteReference: text("quote_reference").notNull().unique(),
    provider: text("provider").notNull().default("manual"),
    childOrderId: text("child_order_id").notNull(),
    serviceLevel: text("service_level"),
    amount: bigint("amount", { mode: "bigint" }).notNull().default(sql`0`),
    currency: text("currency").notNull().default("IRR"),
    estimatedFrom: timestamp("estimated_from", { withTimezone: true }),
    estimatedTo: timestamp("estimated_to", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    snapshot: jsonb("snapshot").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("shipping_quote_status_allowed", "status", SHIPPING_QUOTE_STATUSES),
    stateCheck("shipping_quote_currency_allowed", "currency", CURRENCIES),
    moneyCheck("shipping_quote_amount_range", "amount"),
    uniqueIndex("shipping_quote_reference_unique").on(table.quoteReference),
    index("shipping_quote_child_created").on(table.childOrderId, table.createdAt),
    index("shipping_quote_provider_created").on(table.provider, table.createdAt),
    index("shipping_quote_status_created").on(table.status, table.createdAt),
    foreignKey({
      name: "shipping_quote_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
  ],
);

export const shipment = pgTable(
  "shipment",
  {
    id: text("id").primaryKey(),
    shipmentCode: text("shipment_code").notNull().unique(),
    wholesaleOrderId: text("wholesale_order_id").notNull(),
    childOrderId: text("child_order_id").notNull(),
    sellerId: text("seller_id").notNull(),
    provider: text("provider").notNull().default("manual"),
    shippingResponsibility: text("shipping_responsibility").notNull().default("SUPPLIER"),
    externalReference: text("external_reference"),
    status: text("status").notNull().default("pending"),
    addressSnapshot: jsonb("address_snapshot").notNull().default({}),
    quoteSnapshot: jsonb("quote_snapshot").notNull().default({}),
    trackingCode: text("tracking_code"),
    trackingUrl: text("tracking_url"),
    /** Phase 4.7.1 (B14) — why a shipment ended in `failed` (pre- or post-handoff). */
    failureReason: text("failure_reason"),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("shipment_status_allowed", "status", SHIPMENT_STATUSES),
    stateCheck("shipment_shipping_responsibility_allowed", "shipping_responsibility", SHIPPING_RESPONSIBILITIES),
    uniqueIndex("shipment_code_unique").on(table.shipmentCode),
    index("shipment_wholesale_created").on(table.wholesaleOrderId, table.createdAt),
    index("shipment_child_created").on(table.childOrderId, table.createdAt),
    index("shipment_seller_created").on(table.sellerId, table.createdAt),
    index("shipment_status_created").on(table.status, table.createdAt),
    index("shipment_tracking_code").on(table.trackingCode),
    foreignKey({
      name: "shipment_wholesale_fk",
      columns: [table.wholesaleOrderId],
      foreignColumns: [wholesaleOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_child_fk",
      columns: [table.childOrderId],
      foreignColumns: [purchaseOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_seller_fk",
      columns: [table.sellerId],
      foreignColumns: [seller.id],
    }).onDelete("restrict"),
  ],
);

export const shipmentItem = pgTable(
  "shipment_item",
  {
    id: text("id").primaryKey(),
    shipmentId: text("shipment_id").notNull(),
    wholesaleOrderItemId: text("wholesale_order_item_id").notNull(),
    purchaseOrderItemId: text("purchase_order_item_id"),
    variantId: text("variant_id"),
    pieceQuantity: integer("piece_quantity").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    positiveQuantityCheck("shipment_item_piece_quantity_positive", "piece_quantity"),
    uniqueIndex("shipment_item_shipment_wholesale_unique").on(table.shipmentId, table.wholesaleOrderItemId),
    index("shipment_item_shipment_created").on(table.shipmentId, table.createdAt),
    index("shipment_item_wholesale_item").on(table.wholesaleOrderItemId),
    foreignKey({
      name: "shipment_item_shipment_fk",
      columns: [table.shipmentId],
      foreignColumns: [shipment.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_item_wholesale_item_fk",
      columns: [table.wholesaleOrderItemId],
      foreignColumns: [wholesaleOrderItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_item_purchase_item_fk",
      columns: [table.purchaseOrderItemId],
      foreignColumns: [purchaseOrderItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_item_variant_fk",
      columns: [table.variantId],
      foreignColumns: [productVariant.id],
    }).onDelete("restrict"),
  ],
);

export const shipmentEvent = pgTable(
  "shipment_event",
  {
    id: text("id").primaryKey(),
    /** Phase 4.7.1 (B16/B17) — nullable: a carrier event that cannot be mapped to a shipment is persisted and `ignored`, never dropped. */
    shipmentId: text("shipment_id"),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull().default("unknown"),
    payloadHash: text("payload_hash"),
    safeMetadata: jsonb("safe_metadata").notNull().default({}),
    status: text("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("shipment_event_status_allowed", "status", SHIPMENT_EVENT_STATUSES),
    stateCheck("shipment_event_type_allowed", "event_type", SHIPMENT_EVENT_TYPES),
    uniqueIndex("shipment_event_provider_external_unique").on(table.provider, table.externalEventId),
    index("shipment_event_shipment_created").on(table.shipmentId, table.createdAt),
    index("shipment_event_provider_created").on(table.provider, table.createdAt),
    index("shipment_event_status_created").on(table.status, table.createdAt),
    foreignKey({
      name: "shipment_event_shipment_fk",
      columns: [table.shipmentId],
      foreignColumns: [shipment.id],
    }).onDelete("restrict"),
  ],
);

/* ═══════════════════════════════════════════════════════════════════════════
 * Phase 4.7.5 — Iran legal, compliance, privacy & tax-readiness foundation.
 *
 * Owner: `compliance` module (legal_*, consent_event, business_*, supplier_compliance_*,
 * supplier_contract_acceptance, supplier_bank_verification, product_compliance_*,
 * data_retention_policy, data_subject_request, legal_hold, transaction_compliance_snapshot)
 * and `invoicing` module (commercial_invoice*, fiscal_*, tax_configuration).
 *
 * Evidence tables are append-only and legal text is immutable once published —
 * enforced by triggers in migration 0022, not only by TypeScript.
 * No wallet / settlement / payout table exists here (Phase 4.8).
 * ═══════════════════════════════════════════════════════════════════════════ */

export const legalPolicyDocument = pgTable(
  "legal_policy_document",
  {
    id: text("id").primaryKey(),
    policyType: text("policy_type").notNull(),
    scope: text("scope").notNull(),
    locale: text("locale").notNull().default("fa-IR"),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary"),
    /** Canonical legal text (immutable after publish). */
    contentText: text("content_text").notNull(),
    /** sha256 of the canonical content; proves exactly what was accepted. */
    contentHash: text("content_hash").notNull(),
    /** Optional external immutable artifact reference (object key / URI). */
    contentLocation: text("content_location"),
    /** Structured, versioned business rules carried by this version (e.g. return window). Frozen after publish. */
    ruleParameters: jsonb("rule_parameters").notNull().default({}),
    /** Business policy (not statute): does this document require explicit acceptance in its scope? */
    acceptanceRequired: boolean("acceptance_required").notNull().default(false),
    /** When a new version is published, do older acceptances stop satisfying the requirement? */
    reacceptanceRequired: boolean("reacceptance_required").notNull().default(true),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("legal_policy_document_type_allowed", "policy_type", LEGAL_POLICY_TYPES),
    stateCheck("legal_policy_document_scope_allowed", "scope", LEGAL_POLICY_SCOPES),
    stateCheck("legal_policy_document_status_allowed", "status", LEGAL_POLICY_STATUSES),
    check("legal_policy_document_version_positive", sql.raw(`"version" > 0`)),
    check("legal_policy_document_hash_format", sql.raw(`length("content_hash") = 64`)),
    check(
      "legal_policy_document_published_consistency",
      sql.raw(`("status" <> 'published') OR ("published_at" IS NOT NULL AND "effective_at" IS NOT NULL)`),
    ),
    uniqueIndex("legal_policy_document_type_scope_locale_version_unique").on(table.policyType, table.scope, table.locale, table.version),
    uniqueIndex("legal_policy_document_single_published")
      .on(table.policyType, table.scope, table.locale)
      .where(sql`"status" = 'published'`),
    index("legal_policy_document_scope_status").on(table.scope, table.status),
    foreignKey({ name: "legal_policy_document_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "legal_policy_document_published_by_fk", columns: [table.publishedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const legalPolicyAcceptance = pgTable(
  "legal_policy_acceptance",
  {
    id: text("id").primaryKey(),
    policyDocumentId: text("policy_document_id").notNull(),
    subjectType: text("subject_type").notNull(),
    userId: text("user_id"),
    /** HMAC of the subject identity (user id or guest contact) — never the raw contact. */
    subjectHash: text("subject_hash").notNull(),
    supplierId: text("supplier_id"),
    /** Transaction reference when the acceptance is transaction-specific (order code / wholesale order id). */
    orderRef: text("order_ref"),
    context: text("context").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    /** sha256(subject_hash | policy id | content_hash | context | accepted_at). */
    evidenceHash: text("evidence_hash").notNull(),
    /** sha256 of sanitized request metadata (no raw IP / UA persisted). */
    requestMetadataHash: text("request_metadata_hash"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("legal_policy_acceptance_subject_type_allowed", "subject_type", LEGAL_ACCEPTANCE_SUBJECT_TYPES),
    stateCheck("legal_policy_acceptance_context_allowed", "context", LEGAL_ACCEPTANCE_CONTEXTS),
    check("legal_policy_acceptance_hash_format", sql.raw(`length("evidence_hash") = 64`)),
    check("legal_policy_acceptance_user_subject", sql.raw(`("subject_type" <> 'user') OR ("user_id" IS NOT NULL)`)),
    index("legal_policy_acceptance_subject").on(table.subjectHash, table.policyDocumentId),
    index("legal_policy_acceptance_user").on(table.userId),
    foreignKey({ name: "legal_policy_acceptance_document_fk", columns: [table.policyDocumentId], foreignColumns: [legalPolicyDocument.id] }).onDelete("restrict"),
    foreignKey({ name: "legal_policy_acceptance_user_fk", columns: [table.userId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "legal_policy_acceptance_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
  ],
);

export const consentEvent = pgTable(
  "consent_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    /** MARKETING_NOTICE version shown when consent was collected (optional). */
    noticeDocumentId: text("notice_document_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("consent_event_purpose_allowed", "purpose", CONSENT_PURPOSES),
    stateCheck("consent_event_type_allowed", "event_type", CONSENT_EVENT_TYPES),
    stateCheck("consent_event_source_allowed", "source", CONSENT_SOURCES),
    index("consent_event_user_purpose").on(table.userId, table.purpose, table.occurredAt),
    foreignKey({ name: "consent_event_user_fk", columns: [table.userId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "consent_event_notice_fk", columns: [table.noticeDocumentId], foreignColumns: [legalPolicyDocument.id] }).onDelete("restrict"),
  ],
);

export const businessLegalProfile = pgTable(
  "business_legal_profile",
  {
    id: text("id").primaryKey(),
    /** Single canonical operator profile: 'kolbe'. */
    profileKey: text("profile_key").notNull().unique(),
    legalName: text("legal_name"),
    tradeName: text("trade_name"),
    entityType: text("entity_type"),
    registrationIdentifier: text("registration_identifier"),
    taxIdentifier: text("tax_identifier"),
    businessAddress: jsonb("business_address"),
    supportEmail: text("support_email"),
    supportPhone: text("support_phone"),
    complaintContact: text("complaint_contact"),
    /** Admin-only; never exposed publicly. */
    internalNotes: text("internal_notes"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("business_legal_profile_entity_type_allowed", sql.raw(`"entity_type" IS NULL OR "entity_type" IN (${BUSINESS_ENTITY_TYPES.map((v) => `'${v}'`).join(", ")})`)),
    foreignKey({ name: "business_legal_profile_updated_by_fk", columns: [table.updatedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const businessComplianceCredential = pgTable(
  "business_compliance_credential",
  {
    id: text("id").primaryKey(),
    credentialType: text("credential_type").notNull(),
    issuer: text("issuer").notNull(),
    publicReference: text("public_reference"),
    verificationUrl: text("verification_url"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("unverified"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    verificationSource: text("verification_source"),
    /** Admin-only notes. */
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("business_compliance_credential_type_allowed", "credential_type", BUSINESS_CREDENTIAL_TYPES),
    stateCheck("business_compliance_credential_status_allowed", "status", BUSINESS_CREDENTIAL_STATUSES),
    check("business_compliance_credential_verified_consistency", sql.raw(`("status" <> 'verified') OR ("verified_at" IS NOT NULL AND "verified_by" IS NOT NULL)`)),
    foreignKey({ name: "business_compliance_credential_verified_by_fk", columns: [table.verifiedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "business_compliance_credential_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierComplianceProfile = pgTable(
  "supplier_compliance_profile",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull().unique(),
    status: text("status").notNull().default("draft"),
    entityType: text("entity_type"),
    legalName: text("legal_name"),
    registrationIdentifier: text("registration_identifier"),
    taxIdentifier: text("tax_identifier"),
    representativeName: text("representative_name"),
    representativeAuthorityStatus: text("representative_authority_status").notNull().default("unverified"),
    /** Non-sensitive flags set by admin review (e.g. ["high_value_goods"]). */
    riskFlags: jsonb("risk_flags").notNull().default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_compliance_profile_status_allowed", "status", SUPPLIER_COMPLIANCE_STATUSES),
    stateCheck("supplier_compliance_profile_rep_status_allowed", "representative_authority_status", REPRESENTATIVE_AUTHORITY_STATUSES),
    check("supplier_compliance_profile_entity_type_allowed", sql.raw(`"entity_type" IS NULL OR "entity_type" IN (${BUSINESS_ENTITY_TYPES.map((v) => `'${v}'`).join(", ")})`)),
    check("supplier_compliance_profile_version_positive", sql.raw(`"version" > 0`)),
    foreignKey({ name: "supplier_compliance_profile_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_profile_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierComplianceReview = pgTable(
  "supplier_compliance_review",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    profileId: text("profile_id").notNull(),
    profileVersion: integer("profile_version").notNull(),
    decision: text("decision").notNull(),
    /** Internal reviewer notes — admin only. */
    notes: text("notes"),
    reviewedBy: text("reviewed_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("supplier_compliance_review_decision_allowed", "decision", SUPPLIER_COMPLIANCE_REVIEW_DECISIONS),
    index("supplier_compliance_review_supplier").on(table.supplierId, table.createdAt),
    foreignKey({ name: "supplier_compliance_review_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_review_profile_fk", columns: [table.profileId], foreignColumns: [supplierComplianceProfile.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_review_reviewer_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierComplianceDocument = pgTable(
  "supplier_compliance_document",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    documentType: text("document_type").notNull(),
    storageProvider: text("storage_provider").notNull().default("local_private"),
    /** Private object key — never returned by any API. */
    objectKey: text("object_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    originalFilename: text("original_filename"),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    scanStatus: text("scan_status").notNull().default("unavailable"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_compliance_document_type_allowed", "document_type", COMPLIANCE_DOCUMENT_TYPES),
    stateCheck("supplier_compliance_document_storage_allowed", "storage_provider", COMPLIANCE_STORAGE_PROVIDERS),
    stateCheck("supplier_compliance_document_review_status_allowed", "review_status", COMPLIANCE_DOCUMENT_REVIEW_STATUSES),
    stateCheck("supplier_compliance_document_scan_status_allowed", "scan_status", COMPLIANCE_DOCUMENT_SCAN_STATUSES),
    check("supplier_compliance_document_size_positive", sql.raw(`"size_bytes" > 0`)),
    check("supplier_compliance_document_checksum_format", sql.raw(`length("checksum_sha256") = 64`)),
    index("supplier_compliance_document_supplier").on(table.supplierId, table.uploadedAt),
    foreignKey({ name: "supplier_compliance_document_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_document_uploader_fk", columns: [table.uploadedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_document_reviewer_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierContractAcceptance = pgTable(
  "supplier_contract_acceptance",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    policyDocumentId: text("policy_document_id").notNull(),
    acceptedByUserId: text("accepted_by_user_id").notNull(),
    memberRole: text("member_role").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    evidenceHash: text("evidence_hash").notNull(),
    requestMetadataHash: text("request_metadata_hash"),
    createdAt: createdAt(),
  },
  (table) => [
    check("supplier_contract_acceptance_hash_format", sql.raw(`length("evidence_hash") = 64`)),
    uniqueIndex("supplier_contract_acceptance_unique").on(table.supplierId, table.policyDocumentId),
    foreignKey({ name: "supplier_contract_acceptance_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_contract_acceptance_document_fk", columns: [table.policyDocumentId], foreignColumns: [legalPolicyDocument.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_contract_acceptance_user_fk", columns: [table.acceptedByUserId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierComplianceHold = pgTable(
  "supplier_compliance_hold",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseNotes: text("release_notes"),
  },
  (table) => [
    stateCheck("supplier_compliance_hold_reason_allowed", "reason_code", COMPLIANCE_HOLD_REASON_CODES),
    stateCheck("supplier_compliance_hold_status_allowed", "status", HOLD_STATUSES),
    check("supplier_compliance_hold_release_consistency", sql.raw(`("status" = 'active' AND "released_at" IS NULL AND "released_by" IS NULL) OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL)`)),
    index("supplier_compliance_hold_supplier_status").on(table.supplierId, table.status),
    foreignKey({ name: "supplier_compliance_hold_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_hold_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_compliance_hold_released_by_fk", columns: [table.releasedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierBankVerification = pgTable(
  "supplier_bank_verification",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    destinationKind: text("destination_kind").notNull(),
    /** Masked display value only (e.g. IR** **** **** **** **** 1234). */
    maskedValue: text("masked_value").notNull(),
    /** Keyed hash of the normalized destination — no plaintext IBAN/card persisted. */
    normalizedHash: text("normalized_hash").notNull(),
    holderNameDeclared: text("holder_name_declared"),
    status: text("status").notNull().default("pending"),
    holderMatchStatus: text("holder_match_status").notNull().default("unknown"),
    isCurrent: boolean("is_current").notNull().default(true),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    verificationSource: text("verification_source"),
    providerReference: text("provider_reference"),
    rejectionReason: text("rejection_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_bank_verification_kind_allowed", "destination_kind", BANK_DESTINATION_KINDS),
    stateCheck("supplier_bank_verification_status_allowed", "status", BANK_VERIFICATION_STATUSES),
    stateCheck("supplier_bank_verification_holder_match_allowed", "holder_match_status", HOLDER_MATCH_STATUSES),
    check("supplier_bank_verification_hash_format", sql.raw(`length("normalized_hash") = 64`)),
    check("supplier_bank_verification_verified_consistency", sql.raw(`("status" <> 'verified') OR ("verified_at" IS NOT NULL AND "verified_by" IS NOT NULL)`)),
    uniqueIndex("supplier_bank_verification_current_unique").on(table.supplierId).where(sql`"is_current" = true`),
    foreignKey({ name: "supplier_bank_verification_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_bank_verification_submitted_by_fk", columns: [table.submittedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_bank_verification_verified_by_fk", columns: [table.verifiedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productComplianceRecord = pgTable(
  "product_compliance_record",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().unique(),
    sellerId: text("seller_id"),
    originType: text("origin_type").notNull().default("unknown"),
    originCountry: text("origin_country"),
    conditionClass: text("condition_class").notNull().default("unknown"),
    manufacturerOrImporter: text("manufacturer_or_importer"),
    /** e.g. {"goodsId": "...", "importDeclaration": "..."} — only when applicable. */
    regulatoryIdentifiers: jsonb("regulatory_identifiers").notNull().default({}),
    /** Source-register ids that make a field mandatory (empty = business policy only). */
    sourceRegisterRefs: jsonb("source_register_refs").notNull().default([]),
    status: text("status").notNull().default("unknown"),
    declaredBy: text("declared_by"),
    declaredAt: timestamp("declared_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    /** Internal reviewer notes — admin only. */
    reviewNotes: text("review_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("product_compliance_record_origin_allowed", "origin_type", PRODUCT_ORIGIN_TYPES),
    stateCheck("product_compliance_record_condition_allowed", "condition_class", PRODUCT_CONDITION_CLASSES),
    stateCheck("product_compliance_record_status_allowed", "status", PRODUCT_COMPLIANCE_STATUSES),
    check("product_compliance_record_country_format", sql.raw(`"origin_country" IS NULL OR length("origin_country") = 2`)),
    check("product_compliance_record_verified_consistency", sql.raw(`("status" NOT IN ('verified', 'rejected', 'restricted')) OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)`)),
    foreignKey({ name: "product_compliance_record_product_fk", columns: [table.productId], foreignColumns: [product.id] }).onDelete("restrict"),
    foreignKey({ name: "product_compliance_record_seller_fk", columns: [table.sellerId], foreignColumns: [seller.id] }).onDelete("restrict"),
    foreignKey({ name: "product_compliance_record_declared_by_fk", columns: [table.declaredBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "product_compliance_record_reviewed_by_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productComplianceDocument = pgTable(
  "product_compliance_document",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id").notNull(),
    documentType: text("document_type").notNull(),
    storageProvider: text("storage_provider").notNull().default("local_private"),
    objectKey: text("object_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    originalFilename: text("original_filename"),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    scanStatus: text("scan_status").notNull().default("unavailable"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("product_compliance_document_type_allowed", "document_type", COMPLIANCE_DOCUMENT_TYPES),
    stateCheck("product_compliance_document_storage_allowed", "storage_provider", COMPLIANCE_STORAGE_PROVIDERS),
    stateCheck("product_compliance_document_review_status_allowed", "review_status", COMPLIANCE_DOCUMENT_REVIEW_STATUSES),
    stateCheck("product_compliance_document_scan_status_allowed", "scan_status", COMPLIANCE_DOCUMENT_SCAN_STATUSES),
    check("product_compliance_document_size_positive", sql.raw(`"size_bytes" > 0`)),
    check("product_compliance_document_checksum_format", sql.raw(`length("checksum_sha256") = 64`)),
    index("product_compliance_document_record").on(table.recordId),
    foreignKey({ name: "product_compliance_document_record_fk", columns: [table.recordId], foreignColumns: [productComplianceRecord.id] }).onDelete("restrict"),
    foreignKey({ name: "product_compliance_document_uploader_fk", columns: [table.uploadedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "product_compliance_document_reviewer_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const dataRetentionPolicy = pgTable(
  "data_retention_policy",
  {
    id: text("id").primaryKey(),
    dataCategory: text("data_category").notNull(),
    scope: text("scope").notNull().default("platform"),
    /** NULL = not yet determined (never a guessed statutory duration). */
    retentionDays: integer("retention_days"),
    retentionBasis: text("retention_basis").notNull(),
    action: text("action").notNull().default("review"),
    legalSourceReference: text("legal_source_reference"),
    verificationStatus: text("verification_status").notNull().default("NEEDS_LEGAL_VERIFICATION"),
    status: text("status").notNull().default("draft"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("data_retention_policy_action_allowed", "action", RETENTION_ACTIONS),
    stateCheck("data_retention_policy_status_allowed", "status", RETENTION_POLICY_STATUSES),
    stateCheck("data_retention_policy_verification_allowed", "verification_status", LEGAL_VERIFICATION_STATUSES),
    check("data_retention_policy_days_positive", sql.raw(`"retention_days" IS NULL OR "retention_days" > 0`)),
    check("data_retention_policy_destructive_requires_verification", sql.raw(`("action" NOT IN ('delete', 'anonymize')) OR ("status" <> 'active') OR ("verification_status" = 'VERIFIED' AND "retention_days" IS NOT NULL)`)),
    uniqueIndex("data_retention_policy_category_scope_active").on(table.dataCategory, table.scope).where(sql`"status" = 'active'`),
    foreignKey({ name: "data_retention_policy_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const dataSubjectRequest = pgTable(
  "data_subject_request",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("submitted"),
    /** Free text supplied by the subject (sanitized, length-limited). */
    subjectNote: text("subject_note"),
    /** Admin-only decision rationale. */
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** What was retained (and why) when a deletion completes — e.g. [{"category":"financial_ledger","basis":"..."}]. */
    retainedCategories: jsonb("retained_categories").notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("data_subject_request_type_allowed", "request_type", DATA_SUBJECT_REQUEST_TYPES),
    stateCheck("data_subject_request_status_allowed", "status", DATA_SUBJECT_REQUEST_STATUSES),
    check("data_subject_request_decision_consistency", sql.raw(`("status" NOT IN ('approved', 'rejected', 'processing', 'completed')) OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)`)),
    index("data_subject_request_user").on(table.userId, table.createdAt),
    index("data_subject_request_status").on(table.status),
    foreignKey({ name: "data_subject_request_user_fk", columns: [table.userId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "data_subject_request_decided_by_fk", columns: [table.decidedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const legalHold = pgTable(
  "legal_hold",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseNotes: text("release_notes"),
  },
  (table) => [
    stateCheck("legal_hold_scope_type_allowed", "scope_type", LEGAL_HOLD_SCOPE_TYPES),
    stateCheck("legal_hold_status_allowed", "status", HOLD_STATUSES),
    check("legal_hold_release_consistency", sql.raw(`("status" = 'active' AND "released_at" IS NULL AND "released_by" IS NULL) OR ("status" = 'released' AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL)`)),
    index("legal_hold_scope").on(table.scopeType, table.scopeId, table.status),
    foreignKey({ name: "legal_hold_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "legal_hold_released_by_fk", columns: [table.releasedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const transactionComplianceSnapshot = pgTable(
  "transaction_compliance_snapshot",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    wholesaleOrderId: text("wholesale_order_id"),
    /** Retail order code (retail checkout still lives in the legacy Next handler). */
    retailOrderRef: text("retail_order_ref"),
    supplierId: text("supplier_id"),
    userId: text("user_id"),
    subjectHash: text("subject_hash").notNull(),
    /** [{policyType, documentId, version, contentHash}] — exact legal bundle in force. */
    policyBundle: jsonb("policy_bundle").notNull().default([]),
    policyBundleHash: text("policy_bundle_hash").notNull(),
    /** Server-derived pre-contract disclosure (retail) — never client supplied. */
    disclosure: jsonb("disclosure"),
    disclosureHash: text("disclosure_hash"),
    /** Hash of the commercial snapshot the transaction was bound to (order financial snapshot). */
    commercialSnapshotHash: text("commercial_snapshot_hash"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("transaction_compliance_snapshot_scope_allowed", "scope", TRANSACTION_SNAPSHOT_SCOPES),
    check("transaction_compliance_snapshot_hash_format", sql.raw(`length("policy_bundle_hash") = 64`)),
    check("transaction_compliance_snapshot_reference_present", sql.raw(`"wholesale_order_id" IS NOT NULL OR "retail_order_ref" IS NOT NULL OR "supplier_id" IS NOT NULL`)),
    uniqueIndex("transaction_compliance_snapshot_wholesale_unique").on(table.wholesaleOrderId).where(sql`"wholesale_order_id" IS NOT NULL`),
    uniqueIndex("transaction_compliance_snapshot_retail_unique").on(table.retailOrderRef).where(sql`"retail_order_ref" IS NOT NULL`),
    foreignKey({ name: "transaction_compliance_snapshot_wholesale_order_fk", columns: [table.wholesaleOrderId], foreignColumns: [wholesaleOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "transaction_compliance_snapshot_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "transaction_compliance_snapshot_user_fk", columns: [table.userId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

/* ───────────── Invoicing: proforma ≠ commercial invoice ≠ fiscal (tax) document ───────────── */

export const commercialInvoice = pgTable(
  "commercial_invoice",
  {
    id: text("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    scope: text("scope").notNull(),
    wholesaleOrderId: text("wholesale_order_id"),
    childOrderId: text("child_order_id"),
    retailOrderRef: text("retail_order_ref"),
    sellerId: text("seller_id"),
    sellerSnapshot: jsonb("seller_snapshot").notNull(),
    buyerSnapshot: jsonb("buyer_snapshot").notNull(),
    currency: text("currency").notNull().default("IRR"),
    subtotal: bigint("subtotal", { mode: "bigint" }).notNull().default(sql`0`),
    shippingTotal: bigint("shipping_total", { mode: "bigint" }).notNull().default(sql`0`),
    taxTotal: bigint("tax_total", { mode: "bigint" }).notNull().default(sql`0`),
    taxStatus: text("tax_status").notNull().default("not_assessed"),
    /** tax_configuration key/version that produced tax_total (NULL = not assessed). */
    taxBasisReference: text("tax_basis_reference"),
    grandTotal: bigint("grand_total", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").notNull().default("draft"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: text("issued_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    /** sha256 of the canonical invoice document (header + lines). */
    documentHash: text("document_hash"),
    /** Hash of the immutable order snapshot the invoice was derived from. */
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("commercial_invoice_scope_allowed", "scope", COMMERCIAL_INVOICE_SCOPES),
    stateCheck("commercial_invoice_status_allowed", "status", COMMERCIAL_INVOICE_STATUSES),
    stateCheck("commercial_invoice_tax_status_allowed", "tax_status", INVOICE_TAX_STATUSES),
    stateCheck("commercial_invoice_currency_allowed", "currency", CURRENCIES),
    moneyCheck("commercial_invoice_subtotal_range", "subtotal"),
    moneyCheck("commercial_invoice_shipping_total_range", "shipping_total"),
    moneyCheck("commercial_invoice_tax_total_range", "tax_total"),
    moneyCheck("commercial_invoice_grand_total_range", "grand_total"),
    check("commercial_invoice_grand_total_matches", sql.raw(`"grand_total" = "subtotal" + "shipping_total" + "tax_total"`)),
    check("commercial_invoice_issued_consistency", sql.raw(`("status" = 'draft') OR ("issued_at" IS NOT NULL AND "document_hash" IS NOT NULL)`)),
    check("commercial_invoice_reference_present", sql.raw(`"wholesale_order_id" IS NOT NULL OR "retail_order_ref" IS NOT NULL`)),
    uniqueIndex("commercial_invoice_child_issued_unique").on(table.childOrderId).where(sql`"child_order_id" IS NOT NULL AND "status" = 'issued'`),
    index("commercial_invoice_wholesale_order").on(table.wholesaleOrderId),
    foreignKey({ name: "commercial_invoice_wholesale_order_fk", columns: [table.wholesaleOrderId], foreignColumns: [wholesaleOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "commercial_invoice_child_order_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "commercial_invoice_seller_fk", columns: [table.sellerId], foreignColumns: [seller.id] }).onDelete("restrict"),
    foreignKey({ name: "commercial_invoice_issued_by_fk", columns: [table.issuedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const commercialInvoiceLine = pgTable(
  "commercial_invoice_line",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    lineNo: integer("line_no").notNull(),
    orderItemRef: text("order_item_ref"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: bigint("unit_price", { mode: "bigint" }).notNull(),
    lineTotal: bigint("line_total", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
  },
  (table) => [
    check("commercial_invoice_line_quantity_positive", sql.raw(`"quantity" > 0`)),
    moneyCheck("commercial_invoice_line_unit_price_range", "unit_price"),
    moneyCheck("commercial_invoice_line_line_total_range", "line_total"),
    check("commercial_invoice_line_total_matches", sql.raw(`"line_total" = "unit_price" * "quantity"`)),
    stateCheck("commercial_invoice_line_currency_allowed", "currency", CURRENCIES),
    uniqueIndex("commercial_invoice_line_no_unique").on(table.invoiceId, table.lineNo),
    foreignKey({ name: "commercial_invoice_line_invoice_fk", columns: [table.invoiceId], foreignColumns: [commercialInvoice.id] }).onDelete("restrict"),
  ],
);

export const fiscalDocument = pgTable(
  "fiscal_document",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("draft"),
    payloadHash: text("payload_hash"),
    providerReference: text("provider_reference"),
    lastError: text("last_error"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("fiscal_document_status_allowed", "status", FISCAL_DOCUMENT_STATUSES),
    uniqueIndex("fiscal_document_provider_reference_unique").on(table.provider, table.providerReference).where(sql`"provider_reference" IS NOT NULL`),
    uniqueIndex("fiscal_document_invoice_open_unique").on(table.invoiceId).where(sql`"status" NOT IN ('rejected', 'cancelled')`),
    foreignKey({ name: "fiscal_document_invoice_fk", columns: [table.invoiceId], foreignColumns: [commercialInvoice.id] }).onDelete("restrict"),
  ],
);

export const fiscalSubmissionEvent = pgTable(
  "fiscal_submission_event",
  {
    id: text("id").primaryKey(),
    fiscalDocumentId: text("fiscal_document_id").notNull(),
    eventType: text("event_type").notNull(),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    outcome: text("outcome").notNull(),
    providerReference: text("provider_reference"),
    safeMetadata: jsonb("safe_metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("fiscal_submission_event_type_allowed", "event_type", FISCAL_EVENT_TYPES),
    stateCheck("fiscal_submission_event_outcome_allowed", "outcome", FISCAL_EVENT_OUTCOMES),
    index("fiscal_submission_event_document").on(table.fiscalDocumentId, table.createdAt),
    foreignKey({ name: "fiscal_submission_event_document_fk", columns: [table.fiscalDocumentId], foreignColumns: [fiscalDocument.id] }).onDelete("restrict"),
  ],
);

export const taxConfiguration = pgTable(
  "tax_configuration",
  {
    id: text("id").primaryKey(),
    configKey: text("config_key").notNull(),
    configValue: jsonb("config_value").notNull(),
    sourceReference: text("source_reference"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    version: integer("version").notNull(),
    reviewStatus: text("review_status").notNull().default("NEEDS_TAX_ACCOUNTANT_REVIEW"),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("tax_configuration_review_status_allowed", "review_status", TAX_CONFIG_REVIEW_STATUSES),
    stateCheck("tax_configuration_status_allowed", "status", TAX_CONFIG_STATUSES),
    check("tax_configuration_version_positive", sql.raw(`"version" > 0`)),
    check("tax_configuration_active_requires_review", sql.raw(`("status" <> 'active') OR ("review_status" = 'VERIFIED')`)),
    uniqueIndex("tax_configuration_key_version_unique").on(table.configKey, table.version),
    uniqueIndex("tax_configuration_key_active_unique").on(table.configKey).where(sql`"status" = 'active'`),
    foreignKey({ name: "tax_configuration_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

/* ── Phase 4.8 — Supplier Financial Account, Settlement & Payout ───────────── */

export const settlementAccount = pgTable(
  "settlement_account",
  {
    id: text("id").primaryKey(),
    accountType: text("account_type").notNull(),
    supplierId: text("supplier_id"),
    sellerId: text("seller_id"),
    childOrderId: text("child_order_id"),
    currency: text("currency").notNull().default("IRR"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("settlement_account_type_allowed", "account_type", SETTLEMENT_ACCOUNT_TYPES),
    stateCheck("settlement_account_currency_allowed", "currency", CURRENCIES),
    stateCheck("settlement_account_status_allowed", "status", SETTLEMENT_ACCOUNT_STATUSES),
    check(
      "settlement_account_supplier_bound",
      sql.raw(
        `("account_type" NOT IN ('SUPPLIER_PENDING_PAYABLE', 'SUPPLIER_AVAILABLE_PAYABLE', 'SUPPLIER_HOLD', 'SUPPLIER_RECOVERY', 'PAYOUT_CLEARING')) OR ("supplier_id" IS NOT NULL)`,
      ),
    ),
    foreignKey({ name: "settlement_account_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_account_seller_fk", columns: [table.sellerId], foreignColumns: [seller.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_account_child_order_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    uniqueIndex("settlement_account_supplier_type_currency_unique").on(table.supplierId, table.accountType, table.currency).where(sql`"supplier_id" IS NOT NULL`),
    uniqueIndex("settlement_account_platform_type_currency_unique").on(table.accountType, table.currency).where(sql`"supplier_id" IS NULL AND "child_order_id" IS NULL`),
    uniqueIndex("settlement_account_child_type_currency_unique").on(table.childOrderId, table.accountType, table.currency).where(sql`"child_order_id" IS NOT NULL`),
    index("settlement_account_supplier").on(table.supplierId),
    index("settlement_account_type").on(table.accountType),
  ],
);

export const settlementJournal = pgTable(
  "settlement_journal",
  {
    id: text("id").primaryKey(),
    journalType: text("journal_type").notNull(),
    sourceEventType: text("source_event_type").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    childOrderId: text("child_order_id"),
    orderItemId: text("order_item_id"),
    supplierId: text("supplier_id"),
    currency: text("currency").notNull().default("IRR"),
    totalAmount: bigint("total_amount", { mode: "bigint" }).notNull(),
    snapshotData: jsonb("snapshot_data").notNull().default({}),
    postedBy: text("posted_by"),
    reason: text("reason"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("settlement_journal_type_allowed", "journal_type", SETTLEMENT_JOURNAL_TYPES),
    stateCheck("settlement_journal_source_type_allowed", "source_event_type", SETTLEMENT_SOURCE_EVENT_TYPES),
    stateCheck("settlement_journal_currency_allowed", "currency", CURRENCIES),
    moneyCheck("settlement_journal_total_amount_range", "total_amount"),
    foreignKey({ name: "settlement_journal_child_order_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_journal_order_item_fk", columns: [table.orderItemId], foreignColumns: [wholesaleOrderItem.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_journal_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_journal_posted_by_fk", columns: [table.postedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    uniqueIndex("settlement_journal_source_event_unique").on(table.sourceEventType, table.sourceEventId),
    index("settlement_journal_supplier").on(table.supplierId),
    index("settlement_journal_child_order").on(table.childOrderId),
    index("settlement_journal_effective").on(table.effectiveAt),
  ],
);

export const settlementPosting = pgTable(
  "settlement_posting",
  {
    id: text("id").primaryKey(),
    journalId: text("journal_id").notNull(),
    accountId: text("account_id").notNull(),
    direction: text("direction").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("settlement_posting_direction_allowed", "direction", SETTLEMENT_POSTING_DIRECTIONS),
    moneyCheck("settlement_posting_amount_range", "amount"),
    check("settlement_posting_amount_positive", sql.raw(`"amount" > 0`)),
    stateCheck("settlement_posting_currency_allowed", "currency", CURRENCIES),
    foreignKey({ name: "settlement_posting_journal_fk", columns: [table.journalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_posting_account_fk", columns: [table.accountId], foreignColumns: [settlementAccount.id] }).onDelete("restrict"),
    index("settlement_posting_journal").on(table.journalId),
    index("settlement_posting_account_created").on(table.accountId, table.createdAt),
  ],
);

export const commissionPolicy = pgTable(
  "commission_policy",
  {
    id: text("id").primaryKey(),
    policyVersion: integer("policy_version").notNull(),
    name: text("name").notNull(),
    basis: text("basis").notNull(),
    rateBps: integer("rate_bps").notNull().default(0),
    fixedAmount: bigint("fixed_amount", { mode: "bigint" }).notNull().default(0n),
    roundingMode: text("rounding_mode").notNull().default("HALF_UP"),
    status: text("status").notNull().default("active"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("commission_policy_basis_allowed", "basis", COMMISSION_BASIS_TYPES),
    check("commission_policy_rate_bps_range", sql.raw(`"rate_bps" >= 0 AND "rate_bps" <= 10000`)),
    moneyCheck("commission_policy_fixed_amount_range", "fixed_amount"),
    stateCheck("commission_policy_rounding_mode_allowed", "rounding_mode", COMMISSION_ROUNDING_MODES),
    stateCheck("commission_policy_status_allowed", "status", COMMISSION_POLICY_STATUSES),
    check("commission_policy_version_positive", sql.raw(`"policy_version" > 0`)),
    uniqueIndex("commission_policy_version_unique").on(table.policyVersion),
  ],
);

export const commissionSnapshot = pgTable(
  "commission_snapshot",
  {
    id: text("id").primaryKey(),
    childOrderId: text("child_order_id").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    basis: text("basis").notNull(),
    rateBps: integer("rate_bps").notNull(),
    fixedAmount: bigint("fixed_amount", { mode: "bigint" }).notNull(),
    roundingMode: text("rounding_mode").notNull(),
    snapshottedAt: timestamp("snapshotted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    stateCheck("commission_snapshot_basis_allowed", "basis", COMMISSION_BASIS_TYPES),
    check("commission_snapshot_rate_bps_range", sql.raw(`"rate_bps" >= 0 AND "rate_bps" <= 10000`)),
    moneyCheck("commission_snapshot_fixed_amount_range", "fixed_amount"),
    stateCheck("commission_snapshot_rounding_mode_allowed", "rounding_mode", COMMISSION_ROUNDING_MODES),
    foreignKey({ name: "commission_snapshot_child_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "commission_snapshot_policy_fk", columns: [table.policyId], foreignColumns: [commissionPolicy.id] }).onDelete("restrict"),
    uniqueIndex("commission_snapshot_child_unique").on(table.childOrderId),
  ],
);

export const shippingEconomicsPolicy = pgTable(
  "shipping_economics_policy",
  {
    id: text("id").primaryKey(),
    childOrderId: text("child_order_id").notNull(),
    shippingChargeToBuyer: bigint("shipping_charge_to_buyer", { mode: "bigint" }).notNull().default(0n),
    shippingEconomicRecipient: text("shipping_economic_recipient").notNull().default("UNDEFINED"),
    shippingCostBearer: text("shipping_cost_bearer").notNull().default("UNDEFINED"),
    shippingProvider: text("shipping_provider"),
    currency: text("currency").notNull().default("IRR"),
    status: text("status").notNull().default("finalized"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("shipping_economics_recipient_allowed", "shipping_economic_recipient", SHIPPING_ECONOMIC_RECIPIENTS),
    stateCheck("shipping_economics_bearer_allowed", "shipping_cost_bearer", SHIPPING_COST_BEARERS),
    stateCheck("shipping_economics_status_allowed", "status", SHIPPING_ECONOMICS_STATUSES),
    stateCheck("shipping_economics_currency_allowed", "currency", CURRENCIES),
    moneyCheck("shipping_economics_charge_range", "shipping_charge_to_buyer"),
    foreignKey({ name: "shipping_economics_child_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    uniqueIndex("shipping_economics_child_unique").on(table.childOrderId),
  ],
);

export const settlementHoldPolicy = pgTable(
  "settlement_hold_policy",
  {
    id: text("id").primaryKey(),
    policyVersion: integer("policy_version").notNull(),
    name: text("name").notNull(),
    holdDurationDays: integer("hold_duration_days").notNull(),
    status: text("status").notNull().default("active"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("settlement_hold_policy_status_allowed", "status", SETTLEMENT_HOLD_POLICY_STATUSES),
    check("settlement_hold_policy_duration_range", sql.raw(`"hold_duration_days" >= 0 AND "hold_duration_days" <= 365`)),
    check("settlement_hold_policy_version_positive", sql.raw(`"policy_version" > 0`)),
    uniqueIndex("settlement_hold_policy_version_unique").on(table.policyVersion),
  ],
);

export const settlementHold = pgTable(
  "settlement_hold",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    reason: text("reason").notNull(),
    amount: bigint("amount", { mode: "bigint" }),
    currency: text("currency").notNull().default("IRR"),
    status: text("status").notNull().default("active"),
    placedBy: text("placed_by"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    releasedBy: text("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("settlement_hold_scope_allowed", "scope", SETTLEMENT_HOLD_SCOPES),
    stateCheck("settlement_hold_reason_allowed", "reason", SETTLEMENT_HOLD_REASONS),
    stateCheck("settlement_hold_status_allowed", "status", SETTLEMENT_HOLD_STATUSES),
    stateCheck("settlement_hold_currency_allowed", "currency", CURRENCIES),
    check("settlement_hold_amount_range", sql.raw(`"amount" IS NULL OR ("amount" >= 0 AND "amount" <= ${MAX_MONEY_RIAL.toString()})`)),
    foreignKey({ name: "settlement_hold_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_hold_placed_by_fk", columns: [table.placedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_hold_released_by_fk", columns: [table.releasedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    index("settlement_hold_supplier_status").on(table.supplierId, table.status),
  ],
);

export const settlementBatch = pgTable(
  "settlement_batch",
  {
    id: text("id").primaryKey(),
    batchCode: text("batch_code").notNull(),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("IRR"),
    totalReleasedAmount: bigint("total_released_amount", { mode: "bigint" }).notNull().default(0n),
    totalItemsCount: integer("total_items_count").notNull().default(0),
    executedBy: text("executed_by"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("settlement_batch_status_allowed", "status", SETTLEMENT_BATCH_STATUSES),
    stateCheck("settlement_batch_currency_allowed", "currency", CURRENCIES),
    moneyCheck("settlement_batch_amount_range", "total_released_amount"),
    check("settlement_batch_items_count_non_negative", sql.raw(`"total_items_count" >= 0`)),
    foreignKey({ name: "settlement_batch_executed_by_fk", columns: [table.executedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    uniqueIndex("settlement_batch_code_unique").on(table.batchCode),
    uniqueIndex("settlement_batch_idempotency_unique").on(table.idempotencyKey),
  ],
);

export const settlementBatchItem = pgTable(
  "settlement_batch_item",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    childOrderId: text("child_order_id").notNull(),
    journalId: text("journal_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("released"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("settlement_batch_item_status_allowed", "status", SETTLEMENT_BATCH_ITEM_STATUSES),
    moneyCheck("settlement_batch_item_amount_range", "amount"),
    check("settlement_batch_item_amount_positive", sql.raw(`"amount" > 0`)),
    foreignKey({ name: "settlement_batch_item_batch_fk", columns: [table.batchId], foreignColumns: [settlementBatch.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_batch_item_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_batch_item_child_fk", columns: [table.childOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_batch_item_journal_fk", columns: [table.journalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    index("settlement_batch_item_batch").on(table.batchId),
    index("settlement_batch_item_supplier").on(table.supplierId),
    index("settlement_batch_item_child").on(table.childOrderId),
  ],
);

export const withdrawalRequest = pgTable(
  "withdrawal_request",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    bankDestinationId: text("bank_destination_id").notNull(),
    bankDestinationSnapshot: jsonb("bank_destination_snapshot").notNull(),
    status: text("status").notNull().default("requested"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    rejectedByUserId: text("rejected_by_user_id"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    reservationJournalId: text("reservation_journal_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    moneyCheck("withdrawal_request_amount_range", "amount"),
    check("withdrawal_request_amount_positive", sql.raw(`"amount" > 0`)),
    stateCheck("withdrawal_request_currency_allowed", "currency", CURRENCIES),
    stateCheck("withdrawal_request_status_allowed", "status", WITHDRAWAL_REQUEST_STATUSES),
    foreignKey({ name: "withdrawal_request_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "withdrawal_request_requested_by_fk", columns: [table.requestedByUserId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "withdrawal_request_bank_destination_fk", columns: [table.bankDestinationId], foreignColumns: [supplierBankVerification.id] }).onDelete("restrict"),
    foreignKey({ name: "withdrawal_request_approved_by_fk", columns: [table.approvedByUserId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "withdrawal_request_rejected_by_fk", columns: [table.rejectedByUserId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "withdrawal_request_reservation_journal_fk", columns: [table.reservationJournalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    uniqueIndex("withdrawal_request_supplier_idempotency_unique").on(table.supplierId, table.idempotencyKey),
    index("withdrawal_request_supplier_status").on(table.supplierId, table.status),
  ],
);

export const payout = pgTable(
  "payout",
  {
    id: text("id").primaryKey(),
    withdrawalRequestId: text("withdrawal_request_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("IRR"),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    status: text("status").notNull().default("pending"),
    bankDestinationSnapshot: jsonb("bank_destination_snapshot").notNull(),
    initiatedBy: text("initiated_by").notNull(),
    externalEvidence: jsonb("external_evidence"),
    errorMessage: text("error_message"),
    reconciliationNotes: text("reconciliation_notes"),
    successJournalId: text("success_journal_id"),
    failureReversalJournalId: text("failure_reversal_journal_id"),
    createdAt: createdAt(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    moneyCheck("payout_amount_range", "amount"),
    check("payout_amount_positive", sql.raw(`"amount" > 0`)),
    stateCheck("payout_currency_allowed", "currency", CURRENCIES),
    stateCheck("payout_status_allowed", "status", PAYOUT_STATUSES),
    stateCheck("payout_provider_allowed", "provider", PAYOUT_PROVIDERS),
    foreignKey({ name: "payout_withdrawal_request_fk", columns: [table.withdrawalRequestId], foreignColumns: [withdrawalRequest.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_initiated_by_fk", columns: [table.initiatedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_success_journal_fk", columns: [table.successJournalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    foreignKey({ name: "payout_failure_reversal_journal_fk", columns: [table.failureReversalJournalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    uniqueIndex("payout_withdrawal_unique").on(table.withdrawalRequestId),
    index("payout_supplier_status").on(table.supplierId, table.status),
    index("payout_provider_reference").on(table.provider, table.providerReference),
  ],
);

export const payoutProviderEvent = pgTable(
  "payout_provider_event",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payoutId: text("payout_id").notNull(),
    status: text("status").notNull().default("received"),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    stateCheck("payout_provider_event_type_allowed", "event_type", PAYOUT_PROVIDER_EVENT_TYPES),
    stateCheck("payout_provider_event_status_allowed", "status", PAYOUT_PROVIDER_EVENT_STATUSES),
    stateCheck("payout_provider_event_provider_allowed", "provider", PAYOUT_PROVIDERS),
    foreignKey({ name: "payout_provider_event_payout_fk", columns: [table.payoutId], foreignColumns: [payout.id] }).onDelete("restrict"),
    uniqueIndex("payout_provider_event_unique").on(table.provider, table.externalEventId),
    index("payout_provider_event_payout").on(table.payoutId),
  ],
);

export const settlementReconciliationRun = pgTable(
  "settlement_reconciliation_run",
  {
    id: text("id").primaryKey(),
    runType: text("run_type").notNull(),
    status: text("status").notNull().default("running"),
    triggeredBy: text("triggered_by").notNull(),
    targetId: text("target_id"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    stateCheck("settlement_reconciliation_type_allowed", "run_type", SETTLEMENT_RECONCILIATION_TYPES),
    stateCheck("settlement_reconciliation_status_allowed", "status", SETTLEMENT_RECONCILIATION_STATUSES),
    foreignKey({ name: "settlement_reconciliation_triggered_by_fk", columns: [table.triggeredBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    index("settlement_reconciliation_run_type_status").on(table.runType, table.status),
  ],
);

export const settlementAdjustment = pgTable(
  "settlement_adjustment",
  {
    id: text("id").primaryKey(),
    journalId: text("journal_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    accountId: text("account_id").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    direction: text("direction").notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonDescription: text("reason_description").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    moneyCheck("settlement_adjustment_amount_range", "amount"),
    check("settlement_adjustment_amount_positive", sql.raw(`"amount" > 0`)),
    stateCheck("settlement_adjustment_direction_allowed", "direction", SETTLEMENT_POSTING_DIRECTIONS),
    foreignKey({ name: "settlement_adjustment_journal_fk", columns: [table.journalId], foreignColumns: [settlementJournal.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_adjustment_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_adjustment_account_fk", columns: [table.accountId], foreignColumns: [settlementAccount.id] }).onDelete("restrict"),
    foreignKey({ name: "settlement_adjustment_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    uniqueIndex("settlement_adjustment_journal_unique").on(table.journalId),
    uniqueIndex("settlement_adjustment_idempotency_unique").on(table.idempotencyKey),
    index("settlement_adjustment_supplier").on(table.supplierId),
  ],
);

/* ── Phase 5.0 — Business Control Plane, Wholesale Plans & Memberships ───────── */

export const wholesalePlan = pgTable(
  "wholesale_plan",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    tierLevel: integer("tier_level").notNull().default(1),
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("IRR"),
    sortOrder: integer("sort_order").notNull().default(0),
    currentPublishedVersionId: text("current_published_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_plan_status_allowed", "status", WHOLESALE_PLAN_STATUSES),
    stateCheck("wholesale_plan_currency_allowed", "currency", CURRENCIES),
    positiveQuantityCheck("wholesale_plan_tier_level_positive", "tier_level"),
  ],
);

export const wholesalePlanVersion = pgTable(
  "wholesale_plan_version",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    billingPeriod: text("billing_period").notNull().default("annual"),
    durationDays: integer("duration_days").notNull().default(365),
    baseFee: bigint("base_fee", { mode: "bigint" }).notNull().default(sql`0`),
    depositRequirement: bigint("deposit_requirement", { mode: "bigint" }).notNull().default(sql`0`),
    status: text("status").notNull().default("draft"),
    changeSummary: text("change_summary"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_plan_version_status_allowed", "status", WHOLESALE_PLAN_VERSION_STATUSES),
    stateCheck("wholesale_plan_version_billing_period_allowed", "billing_period", WHOLESALE_PLAN_BILLING_PERIODS),
    positiveQuantityCheck("wholesale_plan_version_duration_positive", "duration_days"),
    positiveQuantityCheck("wholesale_plan_version_number_positive", "version_number"),
    moneyCheck("wholesale_plan_version_base_fee_range", "base_fee"),
    moneyCheck("wholesale_plan_version_deposit_range", "deposit_requirement"),
    foreignKey({
      name: "wholesale_plan_version_plan_fk",
      columns: [table.planId],
      foreignColumns: [wholesalePlan.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_plan_version_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("wholesale_plan_version_plan_ver_unique").on(table.planId, table.versionNumber),
    index("wholesale_plan_version_plan_status").on(table.planId, table.status),
  ],
);

export const wholesalePlanFeature = pgTable(
  "wholesale_plan_feature",
  {
    id: text("id").primaryKey(),
    planVersionId: text("plan_version_id").notNull(),
    featureKey: text("feature_key").notNull(),
    featureType: text("feature_type").notNull().default("boolean"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    configValue: jsonb("config_value").notNull().default({}),
    description: text("description"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("wholesale_plan_feature_type_allowed", "feature_type", WHOLESALE_PLAN_FEATURE_TYPES),
    foreignKey({
      name: "wholesale_plan_feature_version_fk",
      columns: [table.planVersionId],
      foreignColumns: [wholesalePlanVersion.id],
    }).onDelete("restrict"),
    uniqueIndex("wholesale_plan_feature_version_key_unique").on(table.planVersionId, table.featureKey),
    index("wholesale_plan_feature_version_idx").on(table.planVersionId),
  ],
);

export const wholesalePlanLimit = pgTable(
  "wholesale_plan_limit",
  {
    id: text("id").primaryKey(),
    planVersionId: text("plan_version_id").notNull(),
    limitKey: text("limit_key").notNull(),
    limitValue: bigint("limit_value", { mode: "bigint" }).notNull(),
    period: text("period").notNull().default("order"),
    isEnforced: boolean("is_enforced").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("wholesale_plan_limit_period_allowed", "period", WHOLESALE_PLAN_LIMIT_PERIODS),
    check("wholesale_plan_limit_value_positive", sql.raw(`"limit_value" >= 0`)),
    foreignKey({
      name: "wholesale_plan_limit_version_fk",
      columns: [table.planVersionId],
      foreignColumns: [wholesalePlanVersion.id],
    }).onDelete("restrict"),
    uniqueIndex("wholesale_plan_limit_version_key_unique").on(table.planVersionId, table.limitKey),
    index("wholesale_plan_limit_version_idx").on(table.planVersionId),
  ],
);

export const wholesaleMembership = pgTable(
  "wholesale_membership",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    planId: text("plan_id").notNull(),
    planVersionId: text("plan_version_id").notNull(),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledReason: text("cancelled_reason"),
    scheduledPlanId: text("scheduled_plan_id"),
    scheduledPlanVersionId: text("scheduled_plan_version_id"),
    scheduledEffectiveAt: timestamp("scheduled_effective_at", { withTimezone: true }),
    snapshotFeatures: jsonb("snapshot_features").notNull().default({}),
    snapshotLimits: jsonb("snapshot_limits").notNull().default({}),
    currentVersion: integer("current_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("wholesale_membership_status_allowed", "status", WHOLESALE_MEMBERSHIP_STATUSES),
    positiveQuantityCheck("wholesale_membership_version_positive", "current_version"),
    foreignKey({
      name: "wholesale_membership_account_fk",
      columns: [table.accountId],
      foreignColumns: [wholesaleAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_plan_fk",
      columns: [table.planId],
      foreignColumns: [wholesalePlan.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_plan_version_fk",
      columns: [table.planVersionId],
      foreignColumns: [wholesalePlanVersion.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_sched_plan_fk",
      columns: [table.scheduledPlanId],
      foreignColumns: [wholesalePlan.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_sched_version_fk",
      columns: [table.scheduledPlanVersionId],
      foreignColumns: [wholesalePlanVersion.id],
    }).onDelete("restrict"),
    index("wholesale_membership_account_status_idx").on(table.accountId, table.status),
    index("wholesale_membership_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

export const wholesaleMembershipHistory = pgTable(
  "wholesale_membership_history",
  {
    id: text("id").primaryKey(),
    membershipId: text("membership_id").notNull(),
    accountId: text("account_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    fromPlanVersionId: text("from_plan_version_id"),
    toPlanVersionId: text("to_plan_version_id"),
    actorId: text("actor_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("wholesale_membership_history_event_allowed", "event_type", WHOLESALE_MEMBERSHIP_EVENT_TYPES),
    foreignKey({
      name: "wholesale_membership_history_membership_fk",
      columns: [table.membershipId],
      foreignColumns: [wholesaleMembership.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_history_account_fk",
      columns: [table.accountId],
      foreignColumns: [wholesaleAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "wholesale_membership_history_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("wholesale_membership_history_membership_idx").on(table.membershipId, table.createdAt),
    index("wholesale_membership_history_account_idx").on(table.accountId, table.createdAt),
  ],
);

/* ── Phase 5.0 — Admin RBAC, Approvals, Settings & Internal Notes ───────────── */

export const adminRole = pgTable(
  "admin_role",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export const adminRolePermission = pgTable(
  "admin_role_permission",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    action: text("action").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("admin_role_permission_action_allowed", "action", ADMIN_PERMISSION_ACTIONS),
    foreignKey({
      name: "admin_role_permission_role_fk",
      columns: [table.roleId],
      foreignColumns: [adminRole.id],
    }).onDelete("restrict"),
    uniqueIndex("admin_role_permission_role_action_unique").on(table.roleId, table.action),
  ],
);

export const adminUserRole = pgTable(
  "admin_user_role",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    assignedBy: text("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "admin_user_role_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "admin_user_role_role_fk",
      columns: [table.roleId],
      foreignColumns: [adminRole.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "admin_user_role_assigned_by_fk",
      columns: [table.assignedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("admin_user_role_user_role_unique").on(table.userId, table.roleId),
  ],
);

export const approvalRequest = pgTable(
  "approval_request",
  {
    id: text("id").primaryKey(),
    requestType: text("request_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    makerId: text("maker_id").notNull(),
    checkerId: text("checker_id"),
    status: text("status").notNull().default("pending"),
    makerNotes: text("maker_notes"),
    checkerNotes: text("checker_notes"),
    payload: jsonb("payload").notNull().default({}),
    executionResult: jsonb("execution_result"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("approval_request_type_allowed", "request_type", APPROVAL_REQUEST_TYPES),
    stateCheck("approval_request_status_allowed", "status", APPROVAL_REQUEST_STATUSES),
    check("maker_checker_distinct", sql.raw(`"checker_id" IS NULL OR "checker_id" <> "maker_id"`)),
    foreignKey({
      name: "approval_request_maker_fk",
      columns: [table.makerId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "approval_request_checker_fk",
      columns: [table.checkerId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("approval_request_status_type_idx").on(table.status, table.requestType),
    index("approval_request_maker_idx").on(table.makerId),
    index("approval_request_checker_idx").on(table.checkerId),
    index("approval_request_target_idx").on(table.targetType, table.targetId),
  ],
);

export const businessSetting = pgTable(
  "business_setting",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull().default("wholesale"),
    key: text("key").notNull().unique(),
    value: jsonb("value").notNull().default({}),
    valueType: text("value_type").notNull().default("string"),
    description: text("description"),
    isSecret: boolean("is_secret").notNull().default(false),
    isReadOnly: boolean("is_read_only").notNull().default(false),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("business_setting_category_allowed", "category", BUSINESS_SETTING_CATEGORIES),
    positiveQuantityCheck("business_setting_version_positive", "version"),
    foreignKey({
      name: "business_setting_updated_by_fk",
      columns: [table.updatedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("business_setting_category_idx").on(table.category),
  ],
);

export const businessSettingHistory = pgTable(
  "business_setting_history",
  {
    id: text("id").primaryKey(),
    settingId: text("setting_id").notNull(),
    key: text("key").notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value").notNull(),
    version: integer("version").notNull(),
    reason: text("reason"),
    changedBy: text("changed_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    positiveQuantityCheck("business_setting_history_version_positive", "version"),
    foreignKey({
      name: "business_setting_history_setting_fk",
      columns: [table.settingId],
      foreignColumns: [businessSetting.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "business_setting_history_changed_by_fk",
      columns: [table.changedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("business_setting_history_setting_ver_idx").on(table.settingId, table.version),
  ],
);

export const adminInternalNote = pgTable(
  "admin_internal_note",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    authorId: text("author_id").notNull(),
    noteText: text("note_text").notNull(),
    isPinned: boolean("is_pinned").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("admin_internal_note_target_type_allowed", "target_type", ADMIN_NOTE_TARGET_TYPES),
    foreignKey({
      name: "admin_internal_note_author_fk",
      columns: [table.authorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("admin_internal_note_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("admin_internal_note_author_idx").on(table.authorId),
  ],
);

/* ── Phase 5.1 — CRM & Customer Operations ──────────────────────────────────── */

export const crmContact = pgTable(
  "crm_contact",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    stage: text("stage").notNull().default("LEAD"),
    assignedAdminId: text("assigned_admin_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("crm_contact_stage_allowed", "stage", CRM_STAGES),
    foreignKey({
      name: "crm_contact_assigned_admin_fk",
      columns: [table.assignedAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_contact_phone_idx").on(table.phone),
    index("crm_contact_email_idx").on(table.email),
    index("crm_contact_stage_idx").on(table.stage),
    index("crm_contact_assigned_admin_idx").on(table.assignedAdminId),
    index("crm_contact_created_at_idx").on(table.createdAt),
  ],
);

export const crmContactIdentityLink = pgTable(
  "crm_contact_identity_link",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    userId: text("user_id").notNull(),
    linkType: text("link_type").notNull().default("account_user"),
    linkedBy: text("linked_by").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    stateCheck("crm_link_type_allowed", "link_type", CRM_LINK_TYPES),
    foreignKey({
      name: "crm_contact_identity_link_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_contact_identity_link_user_fk",
      columns: [table.userId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_contact_identity_link_linked_by_fk",
      columns: [table.linkedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("crm_contact_identity_link_user_unique").on(table.userId),
    index("crm_contact_identity_link_contact_idx").on(table.contactId),
  ],
);

export const crmStageHistory = pgTable(
  "crm_stage_history",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text("reason"),
    source: text("source").notNull().default("manual"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("crm_stage_history_to_stage_allowed", "to_stage", CRM_STAGES),
    stateCheck("crm_stage_history_source_allowed", "source", CRM_STAGE_SOURCES),
    foreignKey({
      name: "crm_stage_history_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_stage_history_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_stage_history_contact_idx").on(table.contactId, table.createdAt),
  ],
);

export const crmAssignmentHistory = pgTable(
  "crm_assignment_history",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    fromAdminId: text("from_admin_id"),
    toAdminId: text("to_admin_id"),
    assignedBy: text("assigned_by").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "crm_assignment_history_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_assignment_history_from_admin_fk",
      columns: [table.fromAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_assignment_history_to_admin_fk",
      columns: [table.toAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_assignment_history_assigned_by_fk",
      columns: [table.assignedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_assignment_history_contact_idx").on(table.contactId, table.createdAt),
  ],
);

export const crmTag = pgTable(
  "crm_tag",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    color: text("color"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "crm_tag_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_tag_is_active_idx").on(table.isActive),
  ],
);

export const crmContactTag = pgTable(
  "crm_contact_tag",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    tagId: text("tag_id").notNull(),
    assignedBy: text("assigned_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "crm_contact_tag_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_contact_tag_tag_fk",
      columns: [table.tagId],
      foreignColumns: [crmTag.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_contact_tag_assigned_by_fk",
      columns: [table.assignedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("crm_contact_tag_unique").on(table.contactId, table.tagId),
  ],
);

export const crmActivity = pgTable(
  "crm_activity",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    activityType: text("activity_type").notNull(),
    body: text("body").notNull(),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type").notNull().default("admin"),
    source: text("source").notNull().default("MANUAL_ACTIVITY"),
    visibility: text("visibility").notNull().default("internal"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("crm_activity_type_allowed", "activity_type", CRM_ACTIVITY_TYPES),
    stateCheck("crm_activity_source_allowed", "source", CRM_ACTIVITY_SOURCES),
    foreignKey({
      name: "crm_activity_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_activity_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_activity_contact_occurred_idx").on(table.contactId, table.occurredAt),
  ],
);

export const crmTask = pgTable(
  "crm_task",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    assigneeId: text("assignee_id"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("OPEN"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    createdBy: text("created_by").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("crm_task_status_allowed", "status", CRM_TASK_STATUSES),
    stateCheck("crm_task_priority_allowed", "priority", CRM_TASK_PRIORITIES),
    foreignKey({
      name: "crm_task_contact_fk",
      columns: [table.contactId],
      foreignColumns: [crmContact.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_task_assignee_fk",
      columns: [table.assigneeId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_task_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_task_completed_by_fk",
      columns: [table.completedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "crm_task_cancelled_by_fk",
      columns: [table.cancelledBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("crm_task_contact_idx").on(table.contactId),
    index("crm_task_assignee_status_idx").on(table.assigneeId, table.status),
    index("crm_task_due_at_idx").on(table.dueAt),
  ],
);

/* ── Phase 5.2 — Support / Ticket / Case Management ──────────────────────────── */

export const supportCase = pgTable(
  "support_case",
  {
    id: text("id").primaryKey(),
    publicReference: text("public_reference").notNull().unique(),
    requesterType: text("requester_type").notNull(),
    requesterUserId: text("requester_user_id"),
    wholesaleAccountId: text("wholesale_account_id"),
    supplierId: text("supplier_id"),
    category: text("category").notNull(),
    subject: text("subject").notNull(),
    priority: text("priority").notNull().default("NORMAL"),
    status: text("status").notNull().default("OPEN"),
    source: text("source").notNull().default("PORTAL"),
    assignedAdminId: text("assigned_admin_id"),
    assignedTeamKey: text("assigned_team_key"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("support_case_requester_type_allowed", "requester_type", SUPPORT_REQUESTER_TYPES),
    stateCheck("support_case_category_allowed", "category", SUPPORT_CATEGORIES),
    stateCheck("support_case_priority_allowed", "priority", SUPPORT_PRIORITIES),
    stateCheck("support_case_status_allowed", "status", SUPPORT_CASE_STATUSES),
    stateCheck("support_case_source_allowed", "source", SUPPORT_SOURCES),
    foreignKey({
      name: "support_case_requester_user_fk",
      columns: [table.requesterUserId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_wholesale_account_fk",
      columns: [table.wholesaleAccountId],
      foreignColumns: [wholesaleAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_supplier_fk",
      columns: [table.supplierId],
      foreignColumns: [supplier.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_assigned_admin_fk",
      columns: [table.assignedAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_status_idx").on(table.status),
    index("support_case_category_idx").on(table.category),
    index("support_case_priority_idx").on(table.priority),
    index("support_case_requester_type_idx").on(table.requesterType),
    index("support_case_assigned_admin_idx").on(table.assignedAdminId),
    index("support_case_wholesale_account_idx").on(table.wholesaleAccountId),
    index("support_case_supplier_idx").on(table.supplierId),
    index("support_case_created_at_idx").on(table.createdAt),
  ],
);

export const supportCaseStatusHistory = pgTable(
  "support_case_status_history",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    reason: text("reason"),
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_case_status_history_from_allowed", "from_status", SUPPORT_CASE_STATUSES),
    stateCheck("support_case_status_history_to_allowed", "to_status", SUPPORT_CASE_STATUSES),
    stateCheck("support_case_status_history_actor_allowed", "actor_type", SUPPORT_AUTHOR_TYPES),
    foreignKey({
      name: "support_case_status_history_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_status_history_actor_fk",
      columns: [table.actorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_status_history_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const supportCasePriorityHistory = pgTable(
  "support_case_priority_history",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    fromPriority: text("from_priority").notNull(),
    toPriority: text("to_priority").notNull(),
    changedByAdminId: text("changed_by_admin_id").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_case_priority_history_from_allowed", "from_priority", SUPPORT_PRIORITIES),
    stateCheck("support_case_priority_history_to_allowed", "to_priority", SUPPORT_PRIORITIES),
    foreignKey({
      name: "support_case_priority_history_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_priority_history_admin_fk",
      columns: [table.changedByAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_priority_history_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const supportCaseAssignmentHistory = pgTable(
  "support_case_assignment_history",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    fromAdminId: text("from_admin_id"),
    toAdminId: text("to_admin_id"),
    fromTeamKey: text("from_team_key"),
    toTeamKey: text("to_team_key"),
    assignedByAdminId: text("assigned_by_admin_id").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: "support_case_assign_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_assign_from_admin_fk",
      columns: [table.fromAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_assign_to_admin_fk",
      columns: [table.toAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_assign_by_admin_fk",
      columns: [table.assignedByAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_assign_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const supportCaseRelation = pgTable(
  "support_case_relation",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    relationType: text("relation_type").notNull(),
    targetId: text("target_id").notNull(),
    itemId: text("item_id"),
    quantity: integer("quantity"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_case_relation_type_allowed", "relation_type", SUPPORT_RELATION_TYPES),
    foreignKey({
      name: "support_case_relation_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    index("support_case_relation_target_idx").on(table.relationType, table.targetId),
    index("support_case_relation_case_idx").on(table.caseId),
  ],
);

export const supportMessage = pgTable(
  "support_message",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    authorType: text("author_type").notNull(),
    authorId: text("author_id"),
    authorDisplayName: text("author_display_name").notNull(),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("PUBLIC"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("support_message_author_type_allowed", "author_type", SUPPORT_AUTHOR_TYPES),
    stateCheck("support_message_visibility_allowed", "visibility", SUPPORT_VISIBILITIES),
    foreignKey({
      name: "support_message_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_message_author_fk",
      columns: [table.authorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_message_case_idx").on(table.caseId, table.createdAt),
    index("support_message_idempotency_idx").on(table.idempotencyKey),
  ],
);

export const supportInternalNote = pgTable(
  "support_internal_note",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    authorAdminId: text("author_admin_id").notNull(),
    authorDisplayName: text("author_display_name").notNull(),
    body: text("body").notNull(),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "support_internal_note_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_internal_note_author_fk",
      columns: [table.authorAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_internal_note_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const supportAttachment = pgTable(
  "support_attachment",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    messageId: text("message_id"),
    uploaderType: text("uploader_type").notNull(),
    uploaderId: text("uploader_id"),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    visibility: text("visibility").notNull().default("PUBLIC"),
    scanStatus: text("scan_status").notNull().default("PENDING_SCAN"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_attachment_uploader_type_allowed", "uploader_type", SUPPORT_AUTHOR_TYPES),
    stateCheck("support_attachment_visibility_allowed", "visibility", SUPPORT_VISIBILITIES),
    stateCheck("support_attachment_scan_status_allowed", "scan_status", SUPPORT_ATTACHMENT_SCAN_STATUSES),
    foreignKey({
      name: "support_attachment_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_attachment_message_fk",
      columns: [table.messageId],
      foreignColumns: [supportMessage.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_attachment_uploader_fk",
      columns: [table.uploaderId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_attachment_case_idx").on(table.caseId),
  ],
);

export const supportSlaPolicy = pgTable(
  "support_sla_policy",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    policyCode: text("policy_code").notNull(),
    name: text("name").notNull(),
    requesterType: text("requester_type"),
    category: text("category"),
    priority: text("priority").notNull(),
    firstResponseTargetMinutes: integer("first_response_target_minutes").notNull(),
    resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_sla_priority_allowed", "priority", SUPPORT_PRIORITIES),
    index("support_sla_policy_code_version_idx").on(table.policyCode, table.version),
  ],
);

export const supportCaseSla = pgTable(
  "support_case_sla",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull().unique(),
    policyId: text("policy_id"),
    policyVersion: integer("policy_version").notNull().default(1),
    firstResponseTargetMinutes: integer("first_response_target_minutes").notNull(),
    resolutionTargetMinutes: integer("resolution_target_minutes").notNull(),
    firstResponseDueAt: timestamp("first_response_due_at", { withTimezone: true }).notNull(),
    resolutionDueAt: timestamp("resolution_due_at", { withTimezone: true }).notNull(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "support_case_sla_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_sla_policy_fk",
      columns: [table.policyId],
      foreignColumns: [supportSlaPolicy.id],
    }).onDelete("restrict"),
    index("support_case_sla_first_response_due_idx").on(table.firstResponseDueAt),
    index("support_case_sla_resolution_due_idx").on(table.resolutionDueAt),
  ],
);

export const supportCaseEscalationHistory = pgTable(
  "support_case_escalation_history",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    fromPriority: text("from_priority").notNull(),
    toPriority: text("to_priority").notNull(),
    fromTeamKey: text("from_team_key"),
    toTeamKey: text("to_team_key"),
    actorAdminId: text("actor_admin_id"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("support_escalation_source_allowed", "source", SUPPORT_ESCALATION_SOURCES),
    stateCheck("support_escalation_from_priority_allowed", "from_priority", SUPPORT_PRIORITIES),
    stateCheck("support_escalation_to_priority_allowed", "to_priority", SUPPORT_PRIORITIES),
    foreignKey({
      name: "support_case_escalation_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_escalation_admin_fk",
      columns: [table.actorAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_escalation_case_idx").on(table.caseId, table.createdAt),
  ],
);

export const supportCaseAction = pgTable(
  "support_case_action",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    actionType: text("action_type").notNull(),
    targetDomain: text("target_domain").notNull(),
    targetId: text("target_id").notNull(),
    requestedByAdminId: text("requested_by_admin_id").notNull(),
    resultingReference: text("resulting_reference"),
    status: text("status").notNull().default("REQUESTED"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    stateCheck("support_action_type_allowed", "action_type", SUPPORT_ACTION_TYPES),
    stateCheck("support_action_status_allowed", "status", SUPPORT_ACTION_STATUSES),
    foreignKey({
      name: "support_case_action_case_fk",
      columns: [table.caseId],
      foreignColumns: [supportCase.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "support_case_action_admin_fk",
      columns: [table.requestedByAdminId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("support_case_action_case_idx").on(table.caseId),
    index("support_case_action_target_idx").on(table.targetDomain, table.targetId),
  ],
);

/* ── Phase 5.3 — Notifications & Messaging ──────────────────────────────────── */

export const notificationEvent = pgTable(
  "notification_event",
  {
    id: text("id").primaryKey(),
    eventKey: text("event_key").notNull(),
    sourceDomain: text("source_domain").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recipientScope: text("recipient_scope").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("notification_event_key_allowed", "event_key", NOTIFICATION_EVENT_KEYS),
    stateCheck("notification_event_recipient_scope_allowed", "recipient_scope", NOTIFICATION_RECIPIENT_TYPES),
    uniqueIndex("notification_event_source_unique_idx").on(table.sourceDomain, table.sourceEventId),
    index("notification_event_key_idx").on(table.eventKey),
    index("notification_event_source_idx").on(table.sourceDomain, table.sourceEntityType, table.sourceEntityId),
    index("notification_event_occurred_idx").on(table.occurredAt),
  ],
);

export const notificationTemplate = pgTable(
  "notification_template",
  {
    id: text("id").primaryKey(),
    templateKey: text("template_key").notNull(),
    name: text("name").notNull(),
    eventKey: text("event_key").notNull(),
    channel: text("channel").notNull(),
    locale: text("locale").notNull().default("fa-IR"),
    category: text("category").notNull().default("TRANSACTIONAL"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("notification_template_event_key_allowed", "event_key", NOTIFICATION_EVENT_KEYS),
    stateCheck("notification_template_channel_allowed", "channel", NOTIFICATION_CHANNELS),
    stateCheck("notification_template_category_allowed", "category", NOTIFICATION_CATEGORIES),
    stateCheck("notification_template_status_allowed", "status", NOTIFICATION_TEMPLATE_STATUSES),
    uniqueIndex("notification_template_key_idx").on(table.templateKey),
    index("notification_template_event_idx").on(table.eventKey, table.channel, table.status),
  ],
);

export const notificationTemplateVersion = pgTable(
  "notification_template_version",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    variablesSchema: jsonb("variables_schema").notNull().default([]),
    status: text("status").notNull().default("DRAFT"),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("notification_template_version_status_allowed", "status", NOTIFICATION_TEMPLATE_VERSION_STATUSES),
    foreignKey({
      name: "notification_template_version_template_fk",
      columns: [table.templateId],
      foreignColumns: [notificationTemplate.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "notification_template_version_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "notification_template_version_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    uniqueIndex("notification_template_version_unique_idx").on(table.templateId, table.version),
    index("notification_template_version_status_idx").on(table.templateId, table.status),
  ],
);

export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: text("id").primaryKey(),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    category: text("category").notNull(),
    eventKey: text("event_key").notNull().default("*"),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("notification_preference_recipient_type_allowed", "recipient_type", NOTIFICATION_RECIPIENT_TYPES),
    stateCheck("notification_preference_category_allowed", "category", NOTIFICATION_CATEGORIES),
    stateCheck("notification_preference_channel_allowed", "channel", NOTIFICATION_CHANNELS),
    uniqueIndex("notification_preference_unique_idx").on(
      table.recipientType,
      table.recipientId,
      table.category,
      table.eventKey,
      table.channel,
    ),
    index("notification_preference_recipient_idx").on(table.recipientType, table.recipientId),
  ],
);

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    channel: text("channel").notNull(),
    templateVersionId: text("template_version_id"),
    renderedSubject: text("rendered_subject"),
    renderedBody: text("rendered_body").notNull(),
    destinationMasked: text("destination_masked").notNull(),
    destinationHash: text("destination_hash"),
    status: text("status").notNull().default("PENDING"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    providerKey: text("provider_key"),
    providerMessageId: text("provider_message_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    failureCategory: text("failure_category"),
    failureDetail: text("failure_detail"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("notification_delivery_channel_allowed", "channel", NOTIFICATION_CHANNELS),
    stateCheck("notification_delivery_recipient_type_allowed", "recipient_type", NOTIFICATION_RECIPIENT_TYPES),
    stateCheck("notification_delivery_status_allowed", "status", NOTIFICATION_DELIVERY_STATUSES),
    foreignKey({
      name: "notification_delivery_event_fk",
      columns: [table.eventId],
      foreignColumns: [notificationEvent.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "notification_delivery_template_version_fk",
      columns: [table.templateVersionId],
      foreignColumns: [notificationTemplateVersion.id],
    }).onDelete("restrict"),
    uniqueIndex("notification_delivery_idempotency_idx").on(table.idempotencyKey),
    index("notification_delivery_event_idx").on(table.eventId),
    index("notification_delivery_recipient_idx").on(table.recipientType, table.recipientId),
    index("notification_delivery_status_idx").on(table.status, table.scheduledAt),
    index("notification_delivery_retry_idx").on(table.status, table.nextRetryAt),
  ],
);

export const notificationDeliveryAttempt = pgTable(
  "notification_delivery_attempt",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    providerKey: text("provider_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    externalMessageId: text("external_message_id"),
    errorCategory: text("error_category"),
    errorDetail: text("error_detail"),
    retryAfterSeconds: integer("retry_after_seconds"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("notification_delivery_attempt_status_allowed", "status", NOTIFICATION_DELIVERY_ATTEMPT_STATUSES),
    foreignKey({
      name: "notification_delivery_attempt_delivery_fk",
      columns: [table.deliveryId],
      foreignColumns: [notificationDelivery.id],
    }).onDelete("restrict"),
    uniqueIndex("notification_delivery_attempt_unique_idx").on(table.deliveryId, table.attemptNumber),
    index("notification_delivery_attempt_delivery_idx").on(table.deliveryId),
    index("notification_delivery_attempt_provider_idx").on(table.providerKey, table.startedAt),
  ],
);

export const inAppNotification = pgTable(
  "in_app_notification",
  {
    id: text("id").primaryKey(),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    deliveryId: text("delivery_id"),
    eventId: text("event_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: text("related_entity_id"),
    actionUrl: text("action_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("in_app_notification_recipient_type_allowed", "recipient_type", NOTIFICATION_RECIPIENT_TYPES),
    foreignKey({
      name: "in_app_notification_delivery_fk",
      columns: [table.deliveryId],
      foreignColumns: [notificationDelivery.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "in_app_notification_event_fk",
      columns: [table.eventId],
      foreignColumns: [notificationEvent.id],
    }).onDelete("restrict"),
    index("in_app_notification_recipient_idx").on(table.recipientType, table.recipientId, table.readAt),
    index("in_app_notification_created_idx").on(table.createdAt),
  ],
);

export const notificationProviderEvent = pgTable(
  "notification_provider_event",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    processingStatus: text("processing_status").notNull().default("RECEIVED"),
    deliveryId: text("delivery_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("notification_provider_event_status_allowed", "processing_status", NOTIFICATION_PROVIDER_EVENT_STATUSES),
    foreignKey({
      name: "notification_provider_event_delivery_fk",
      columns: [table.deliveryId],
      foreignColumns: [notificationDelivery.id],
    }).onDelete("restrict"),
    uniqueIndex("notification_provider_event_unique_idx").on(table.providerKey, table.externalEventId),
    index("notification_provider_event_status_idx").on(table.providerKey, table.processingStatus),
    index("notification_provider_event_delivery_idx").on(table.deliveryId),
  ],
);

export const notificationProviderConfig = pgTable(
  "notification_provider_config",
  {
    id: text("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    channel: text("channel").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("DISABLED"),
    senderIdentity: text("sender_identity"),
    isDefault: boolean("is_default").notNull().default(false),
    publicSettings: jsonb("public_settings").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("notification_provider_config_channel_allowed", "channel", NOTIFICATION_CHANNELS),
    stateCheck("notification_provider_config_status_allowed", "status", NOTIFICATION_PROVIDER_CONFIG_STATUSES),
    uniqueIndex("notification_provider_config_key_idx").on(table.providerKey),
    index("notification_provider_config_channel_idx").on(table.channel, table.status, table.isDefault),
  ],
);







/* ── Phase 5.5 — Analytics & Reporting (read-only operational metadata) ─────── */

/**
 * Analytics never owns business facts. These tables contain only validated
 * report definitions and rebuildable execution/export metadata. All business
 * metrics are read live from their authoritative bounded contexts.
 */
export const analyticsSavedReport = pgTable(
  "analytics_saved_report",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    reportType: text("report_type").notNull().default("SAVED_REPORT"),
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    definition: jsonb("definition").notNull().default({}),
    ownerId: text("owner_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("analytics_saved_report_type_allowed", "report_type", ANALYTICS_REPORT_TYPES),
    stateCheck("analytics_saved_report_scope_allowed", "scope", ANALYTICS_SCOPES),
    foreignKey({
      name: "analytics_saved_report_owner_fk",
      columns: [table.ownerId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("analytics_saved_report_owner_idx").on(table.ownerId, table.updatedAt),
    index("analytics_saved_report_scope_idx").on(table.scope, table.scopeId),
  ],
);

export const analyticsReportRun = pgTable(
  "analytics_report_run",
  {
    id: text("id").primaryKey(),
    reportType: text("report_type").notNull().default("METRIC_SET"),
    scope: text("scope").notNull(),
    scopeId: text("scope_id"),
    definition: jsonb("definition").notNull().default({}),
    status: text("status").notNull().default("QUEUED"),
    sourceMode: text("source_mode").notNull().default("AUTHORITATIVE_LIVE"),
    dataAsOf: timestamp("data_as_of", { withTimezone: true }),
    result: jsonb("result"),
    errorCode: text("error_code"),
    requestedBy: text("requested_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("analytics_report_run_type_allowed", "report_type", ANALYTICS_REPORT_TYPES),
    stateCheck("analytics_report_run_scope_allowed", "scope", ANALYTICS_SCOPES),
    stateCheck("analytics_report_run_status_allowed", "status", ANALYTICS_REPORT_RUN_STATUSES),
    stateCheck("analytics_report_run_source_mode_allowed", "source_mode", ANALYTICS_SOURCE_MODES),
    foreignKey({
      name: "analytics_report_run_requested_by_fk",
      columns: [table.requestedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("analytics_report_run_requested_idx").on(table.requestedBy, table.createdAt),
    index("analytics_report_run_status_idx").on(table.status, table.createdAt),
  ],
);

export const analyticsExportJob = pgTable(
  "analytics_export_job",
  {
    id: text("id").primaryKey(),
    reportRunId: text("report_run_id").notNull(),
    format: text("format").notNull().default("CSV"),
    status: text("status").notNull().default("QUEUED"),
    rowLimit: integer("row_limit").notNull().default(10000),
    rowCount: integer("row_count"),
    fileName: text("file_name").notNull(),
    outputText: text("output_text"),
    failureReason: text("failure_reason"),
    requestedBy: text("requested_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("analytics_export_job_format_allowed", "format", ANALYTICS_EXPORT_FORMATS),
    stateCheck("analytics_export_job_status_allowed", "status", ANALYTICS_EXPORT_STATUSES),
    check("analytics_export_job_row_limit_positive", sql.raw(`"row_limit" > 0 AND "row_limit" <= 10000`)),
    check("analytics_export_job_row_count_non_negative", sql.raw(`"row_count" IS NULL OR "row_count" >= 0`)),
    foreignKey({
      name: "analytics_export_job_run_fk",
      columns: [table.reportRunId],
      foreignColumns: [analyticsReportRun.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "analytics_export_job_requested_by_fk",
      columns: [table.requestedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("analytics_export_job_requested_idx").on(table.requestedBy, table.createdAt),
    index("analytics_export_job_status_expiry_idx").on(table.status, table.expiresAt),
  ],
);

/* ── Phase 5.4 — CMS / Content Management ────────────────────────────────────
 * CMS owns editorial content and publication state only. It deliberately does
 * not copy Catalog products, prices, inventory, orders, legal acceptance or
 * promotion rules into these documents. Cross-domain references are strings in
 * validated block payloads and are resolved by the owning service at read time.
 */

export const cmsPage = pgTable(
  "cms_page",
  {
    id: text("id").primaryKey(),
    stableKey: text("stable_key").notNull().unique(),
    pageType: text("page_type").notNull(),
    routePath: text("route_path").notNull().unique(),
    currentPublishedRevisionId: text("current_published_revision_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_page_type_allowed", "page_type", CMS_PAGE_TYPES),
    stateCheck("cms_page_status_allowed", "status", CMS_PAGE_STATUSES),
    index("cms_page_type_status_idx").on(table.pageType, table.status),
    index("cms_page_route_idx").on(table.routePath),
    foreignKey({
      name: "cms_page_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const cmsPageRevision = pgTable(
  "cms_page_revision",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    blocks: jsonb("blocks").notNull().default([]),
    seoMetadata: jsonb("seo_metadata").notNull().default({}),
    contentSchemaVersion: integer("content_schema_version").notNull().default(1),
    status: text("status").notNull().default("DRAFT"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    unpublishAt: timestamp("unpublish_at", { withTimezone: true }),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sourceRevisionId: text("source_revision_id"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("cms_page_revision_status_allowed", "status", CMS_REVISION_STATUSES),
    check("cms_page_revision_version_positive", sql.raw(`"version" > 0`)),
    check("cms_page_revision_schema_version_positive", sql.raw(`"content_schema_version" > 0`)),
    uniqueIndex("cms_page_revision_page_version_unique").on(table.pageId, table.version),
    uniqueIndex("cms_page_revision_one_published").on(table.pageId).where(sql`"status" = 'PUBLISHED'`),
    index("cms_page_revision_page_status_idx").on(table.pageId, table.status),
    index("cms_page_revision_publish_at_idx").on(table.status, table.publishAt),
    foreignKey({
      name: "cms_page_revision_page_fk",
      columns: [table.pageId],
      foreignColumns: [cmsPage.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_page_revision_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_page_revision_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_page_revision_source_fk",
      columns: [table.sourceRevisionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
  ],
);

export const cmsContentDocument = pgTable(
  "cms_content_document",
  {
    id: text("id").primaryKey(),
    documentKey: text("document_key").notNull().unique(),
    documentType: text("document_type").notNull(),
    currentPublishedRevisionId: text("current_published_revision_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_content_document_type_allowed", "document_type", CMS_DOCUMENT_TYPES),
    stateCheck("cms_content_document_status_allowed", "status", CMS_DOCUMENT_STATUSES),
    foreignKey({
      name: "cms_content_document_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("cms_content_document_type_status_idx").on(table.documentType, table.status),
  ],
);

export const cmsContentRevision = pgTable(
  "cms_content_revision",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("DRAFT"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sourceRevisionId: text("source_revision_id"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("cms_content_revision_status_allowed", "status", CMS_DOCUMENT_REVISION_STATUSES),
    check("cms_content_revision_version_positive", sql.raw(`"version" > 0`)),
    uniqueIndex("cms_content_revision_document_version_unique").on(table.documentId, table.version),
    uniqueIndex("cms_content_revision_one_published").on(table.documentId).where(sql`"status" = 'PUBLISHED'`),
    index("cms_content_revision_document_status_idx").on(table.documentId, table.status),
    index("cms_content_revision_publish_at_idx").on(table.status, table.publishAt),
    foreignKey({
      name: "cms_content_revision_document_fk",
      columns: [table.documentId],
      foreignColumns: [cmsContentDocument.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_content_revision_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_content_revision_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_content_revision_source_fk",
      columns: [table.sourceRevisionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
  ],
);

export const cmsNavigation = pgTable(
  "cms_navigation",
  {
    id: text("id").primaryKey(),
    navigationKey: text("navigation_key").notNull().unique(),
    label: text("label").notNull(),
    currentPublishedRevisionId: text("current_published_revision_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_navigation_status_allowed", "status", CMS_NAVIGATION_STATUSES),
    foreignKey({
      name: "cms_navigation_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("cms_navigation_status_idx").on(table.status),
  ],
);

export const cmsNavigationRevision = pgTable(
  "cms_navigation_revision",
  {
    id: text("id").primaryKey(),
    navigationId: text("navigation_id").notNull(),
    version: integer("version").notNull(),
    items: jsonb("items").notNull().default([]),
    status: text("status").notNull().default("DRAFT"),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sourceRevisionId: text("source_revision_id"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("cms_navigation_revision_status_allowed", "status", CMS_REVISION_STATUSES),
    check("cms_navigation_revision_version_positive", sql.raw(`"version" > 0`)),
    uniqueIndex("cms_navigation_revision_navigation_version_unique").on(table.navigationId, table.version),
    uniqueIndex("cms_navigation_revision_one_published").on(table.navigationId).where(sql`"status" = 'PUBLISHED'`),
    index("cms_navigation_revision_navigation_status_idx").on(table.navigationId, table.status),
    foreignKey({
      name: "cms_navigation_revision_navigation_fk",
      columns: [table.navigationId],
      foreignColumns: [cmsNavigation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_navigation_revision_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_navigation_revision_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_navigation_revision_source_fk",
      columns: [table.sourceRevisionId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
  ],
);

export const cmsMediaAsset = pgTable(
  "cms_media_asset",
  {
    id: text("id").primaryKey(),
    storageProvider: text("storage_provider").notNull(),
    objectKey: text("object_key").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    altText: text("alt_text"),
    caption: text("caption"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    stateCheck("cms_media_asset_provider_allowed", "storage_provider", CMS_MEDIA_PROVIDERS),
    stateCheck("cms_media_asset_mime_allowed", "mime_type", CMS_MEDIA_MIME_TYPES),
    check("cms_media_asset_size_positive", sql.raw(`"byte_size" > 0`)),
    check("cms_media_asset_checksum_format", sql.raw(`length("checksum_sha256") = 64`)),
    check("cms_media_asset_dimensions_positive", sql.raw(`("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0) AND ("duration_ms" IS NULL OR "duration_ms" > 0)`)),
    index("cms_media_asset_created_idx").on(table.createdAt),
    index("cms_media_asset_archived_idx").on(table.archivedAt),
    foreignKey({
      name: "cms_media_asset_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const cmsMediaUsage = pgTable(
  "cms_media_usage",
  {
    id: text("id").primaryKey(),
    mediaAssetId: text("media_asset_id").notNull(),
    revisionType: text("revision_type").notNull(),
    revisionId: text("revision_id").notNull(),
    fieldPath: text("field_path").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("cms_media_usage_unique").on(table.mediaAssetId, table.revisionType, table.revisionId, table.fieldPath),
    index("cms_media_usage_revision_idx").on(table.revisionType, table.revisionId),
    foreignKey({
      name: "cms_media_usage_asset_fk",
      columns: [table.mediaAssetId],
      foreignColumns: [cmsMediaAsset.id],
    }).onDelete("restrict"),
  ],
);

export const cmsArticle = pgTable(
  "cms_article",
  {
    id: text("id").primaryKey(),
    articleKey: text("article_key").notNull().unique(),
    currentPublishedRevisionId: text("current_published_revision_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_article_status_allowed", "status", CMS_PAGE_STATUSES),
    foreignKey({
      name: "cms_article_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    index("cms_article_status_idx").on(table.status),
  ],
);

export const cmsArticleTaxonomy = pgTable(
  "cms_article_taxonomy",
  {
    id: text("id").primaryKey(),
    taxonomyKey: text("taxonomy_key").notNull().unique(),
    slug: text("slug").notNull().unique(),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("CATEGORY"),
    parentId: text("parent_id"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_article_taxonomy_kind_allowed", "kind", CMS_TAXONOMY_KINDS),
    stateCheck("cms_article_taxonomy_status_allowed", "status", CMS_TAXONOMY_STATUSES),
    foreignKey({ name: "cms_article_taxonomy_parent_fk", columns: [table.parentId], foreignColumns: [table.id] }).onDelete("restrict"),
    foreignKey({ name: "cms_article_taxonomy_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    index("cms_article_taxonomy_kind_status_idx").on(table.kind, table.status),
  ],
);

export const cmsArticleRevision = pgTable(
  "cms_article_revision",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id").notNull(),
    version: integer("version").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    category: text("category"),
    coverMediaId: text("cover_media_id"),
    structuredBody: jsonb("structured_body").notNull().default([]),
    authorDisplayName: text("author_display_name"),
    authorId: text("author_id"),
    readTimeMinutes: integer("read_time_minutes"),
    isPinned: boolean("is_pinned").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    seoMetadata: jsonb("seo_metadata").notNull().default({}),
    status: text("status").notNull().default("DRAFT"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    unpublishAt: timestamp("unpublish_at", { withTimezone: true }),
    createdBy: text("created_by"),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("cms_article_revision_status_allowed", "status", CMS_REVISION_STATUSES),
    check("cms_article_revision_version_positive", sql.raw(`"version" > 0`)),
    check("cms_article_revision_read_time_positive", sql.raw(`"read_time_minutes" IS NULL OR "read_time_minutes" > 0`)),
    uniqueIndex("cms_article_revision_article_version_unique").on(table.articleId, table.version),
    uniqueIndex("cms_article_revision_one_published").on(table.articleId).where(sql`"status" = 'PUBLISHED'`),
    uniqueIndex("cms_article_revision_published_slug_unique").on(table.slug).where(sql`"status" = 'PUBLISHED'`),
    index("cms_article_revision_article_status_idx").on(table.articleId, table.status),
    index("cms_article_revision_slug_idx").on(table.slug),
    index("cms_article_revision_publish_at_idx").on(table.status, table.publishAt),
    foreignKey({
      name: "cms_article_revision_article_fk",
      columns: [table.articleId],
      foreignColumns: [cmsArticle.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_article_revision_cover_media_fk",
      columns: [table.coverMediaId],
      foreignColumns: [cmsMediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_article_revision_author_fk",
      columns: [table.authorId],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_article_revision_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_article_revision_published_by_fk",
      columns: [table.publishedBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

export const cmsArticleRevisionTaxonomy = pgTable(
  "cms_article_revision_taxonomy",
  {
    id: text("id").primaryKey(),
    articleRevisionId: text("article_revision_id").notNull(),
    taxonomyId: text("taxonomy_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("cms_article_revision_taxonomy_unique").on(table.articleRevisionId, table.taxonomyId),
    index("cms_article_revision_taxonomy_term_idx").on(table.taxonomyId),
    foreignKey({ name: "cms_article_revision_taxonomy_revision_fk", columns: [table.articleRevisionId], foreignColumns: [cmsArticleRevision.id] }).onDelete("restrict"),
    foreignKey({ name: "cms_article_revision_taxonomy_term_fk", columns: [table.taxonomyId], foreignColumns: [cmsArticleTaxonomy.id] }).onDelete("restrict"),
  ],
);

export const cmsPublicationSchedule = pgTable(
  "cms_publication_schedule",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type").notNull(),
    pageRevisionId: text("page_revision_id"),
    contentRevisionId: text("content_revision_id"),
    navigationRevisionId: text("navigation_revision_id"),
    articleRevisionId: text("article_revision_id"),
    publishAt: timestamp("publish_at", { withTimezone: true }).notNull(),
    unpublishAt: timestamp("unpublish_at", { withTimezone: true }),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("SCHEDULED"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("cms_publication_schedule_target_allowed", "target_type", CMS_SCHEDULE_TARGET_TYPES),
    stateCheck("cms_publication_schedule_status_allowed", "status", CMS_SCHEDULE_STATUSES),
    check("cms_publication_schedule_attempt_non_negative", sql.raw(`"attempt_count" >= 0`)),
    check("cms_publication_schedule_unpublish_after_publish", sql.raw(`"unpublish_at" IS NULL OR "unpublish_at" > "publish_at"`)),
    check("cms_publication_schedule_one_target", sql.raw(`(("page_revision_id" IS NOT NULL)::int + ("content_revision_id" IS NOT NULL)::int + ("navigation_revision_id" IS NOT NULL)::int + ("article_revision_id" IS NOT NULL)::int) = 1`)),
    uniqueIndex("cms_publication_schedule_page_target_unique").on(table.pageRevisionId).where(sql`"page_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING')`),
    uniqueIndex("cms_publication_schedule_content_target_unique").on(table.contentRevisionId).where(sql`"content_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING')`),
    uniqueIndex("cms_publication_schedule_navigation_target_unique").on(table.navigationRevisionId).where(sql`"navigation_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING')`),
    uniqueIndex("cms_publication_schedule_article_target_unique").on(table.articleRevisionId).where(sql`"article_revision_id" IS NOT NULL AND "status" IN ('SCHEDULED','PROCESSING')`),
    index("cms_publication_schedule_due_idx").on(table.status, table.publishAt),
    foreignKey({
      name: "cms_publication_schedule_page_fk",
      columns: [table.pageRevisionId],
      foreignColumns: [cmsPageRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_publication_schedule_content_fk",
      columns: [table.contentRevisionId],
      foreignColumns: [cmsContentRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_publication_schedule_navigation_fk",
      columns: [table.navigationRevisionId],
      foreignColumns: [cmsNavigationRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_publication_schedule_article_fk",
      columns: [table.articleRevisionId],
      foreignColumns: [cmsArticleRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "cms_publication_schedule_created_by_fk",
      columns: [table.createdBy],
      foreignColumns: [accountUser.id],
    }).onDelete("restrict"),
  ],
);

// The four published pointers are intentionally represented as nullable scalar
// columns above and constrained by migration 0028 after all tables exist. This
// avoids a TypeScript declaration cycle while retaining explicit database FKs.

/* ── Phase 5.6 — Supplier Production / Samples / QC ───────────────────────── */

export const productionJob = pgTable(
  "production_job",
  {
    id: text("id").primaryKey(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    supplierId: text("supplier_id").notNull(),
    sellerId: text("seller_id").notNull(),
    purchaseOrderVersion: integer("purchase_order_version").notNull(),
    status: text("status").notNull().default("draft"),
    targetUnits: integer("target_units").notNull(),
    actualUnits: integer("actual_units").notNull().default(0),
    requiresSampleApproval: boolean("requires_sample_approval").notNull().default(true),
    requiresQualityRelease: boolean("requires_quality_release").notNull().default(true),
    plannedStartAt: timestamp("planned_start_at", { withTimezone: true }),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    version: integer("version").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_job_status_allowed", "status", PRODUCTION_JOB_STATUSES),
    positiveQuantityCheck("production_job_target_units_positive", "target_units"),
    quantityCheck("production_job_actual_units_non_negative", "actual_units"),
    quantityCheck("production_job_actual_units_within_target", "actual_units"),
    quantityCheck("production_job_version_non_negative", "version"),
    check("production_job_actual_units_not_over_target", sql.raw(`"actual_units" <= "target_units"`)),
    check("production_job_planned_window_valid", sql.raw(`"planned_end_at" IS NULL OR "planned_start_at" IS NULL OR "planned_end_at" > "planned_start_at"`)),
    uniqueIndex("production_job_purchase_order_unique").on(table.purchaseOrderId),
    index("production_job_supplier_status_created").on(table.supplierId, table.status, table.createdAt),
    index("production_job_seller_status").on(table.sellerId, table.status),
    foreignKey({ name: "production_job_purchase_order_fk", columns: [table.purchaseOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_seller_fk", columns: [table.sellerId], foreignColumns: [seller.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionJobHistory = pgTable(
  "production_job_history",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    milestoneId: text("milestone_id"),
    metadata: jsonb("metadata").notNull().default({}),
    actorId: text("actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    stateCheck("production_job_history_event_allowed", "event_type", PRODUCTION_HISTORY_EVENT_TYPES),
    index("production_job_history_job_created").on(table.jobId, table.createdAt),
    foreignKey({ name: "production_job_history_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_history_actor_fk", columns: [table.actorId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionMilestoneDefinition = pgTable(
  "production_milestone_definition",
  {
    id: text("id").primaryKey(),
    milestoneKey: text("milestone_key").notNull(),
    label: text("label").notNull(),
    sequence: integer("sequence").notNull(),
    required: boolean("required").notNull().default(true),
    defaultDurationDays: integer("default_duration_days"),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_milestone_definition_status_allowed", "status", PRODUCTION_MILESTONE_DEFINITION_STATUSES),
    positiveQuantityCheck("production_milestone_definition_sequence_positive", "sequence"),
    quantityCheck("production_milestone_definition_duration_non_negative", "default_duration_days"),
    uniqueIndex("production_milestone_definition_key_unique").on(table.milestoneKey),
    index("production_milestone_definition_status_sequence").on(table.status, table.sequence),
    foreignKey({ name: "production_milestone_definition_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionJobMilestone = pgTable(
  "production_job_milestone",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    definitionId: text("definition_id"),
    milestoneKey: text("milestone_key").notNull(),
    labelSnapshot: text("label_snapshot").notNull(),
    sequence: integer("sequence").notNull(),
    required: boolean("required").notNull().default(true),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    reason: text("reason"),
    version: integer("version").notNull().default(0),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_job_milestone_status_allowed", "status", PRODUCTION_MILESTONE_STATUSES),
    positiveQuantityCheck("production_job_milestone_sequence_positive", "sequence"),
    quantityCheck("production_job_milestone_version_non_negative", "version"),
    uniqueIndex("production_job_milestone_job_key_unique").on(table.jobId, table.milestoneKey),
    index("production_job_milestone_job_sequence").on(table.jobId, table.sequence),
    foreignKey({ name: "production_job_milestone_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_milestone_definition_fk", columns: [table.definitionId], foreignColumns: [productionMilestoneDefinition.id] }).onDelete("restrict"),
    foreignKey({ name: "production_job_milestone_updated_by_fk", columns: [table.updatedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierCapability = pgTable(
  "supplier_capability",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    capabilityCode: text("capability_code").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    declaredUnitsPerPeriod: integer("declared_units_per_period"),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_capability_status_allowed", "status", SUPPLIER_CAPABILITY_STATUSES),
    quantityCheck("supplier_capability_units_non_negative", "declared_units_per_period"),
    uniqueIndex("supplier_capability_supplier_code_unique").on(table.supplierId, table.capabilityCode),
    index("supplier_capability_supplier_status").on(table.supplierId, table.status),
    foreignKey({ name: "supplier_capability_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_capability_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierCapacityPeriod = pgTable(
  "supplier_capacity_period",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    declaredUnits: integer("declared_units").notNull(),
    reservedUnits: integer("reserved_units").notNull().default(0),
    unavailableUnits: integer("unavailable_units").notNull().default(0),
    actualUnits: integer("actual_units").notNull().default(0),
    status: text("status").notNull().default("open"),
    version: integer("version").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_capacity_period_status_allowed", "status", SUPPLIER_CAPACITY_PERIOD_STATUSES),
    positiveQuantityCheck("supplier_capacity_period_declared_positive", "declared_units"),
    quantityCheck("supplier_capacity_period_reserved_non_negative", "reserved_units"),
    quantityCheck("supplier_capacity_period_unavailable_non_negative", "unavailable_units"),
    quantityCheck("supplier_capacity_period_actual_non_negative", "actual_units"),
    quantityCheck("supplier_capacity_period_version_non_negative", "version"),
    check("supplier_capacity_period_window_valid", sql.raw(`"ends_at" > "starts_at"`)),
    check("supplier_capacity_period_reserved_within_available", sql.raw(`"reserved_units" + "unavailable_units" <= "declared_units"`)),
    check("supplier_capacity_period_unavailable_within_declared", sql.raw(`"unavailable_units" <= "declared_units"`)),
    uniqueIndex("supplier_capacity_period_supplier_window_unique").on(table.supplierId, table.startsAt, table.endsAt),
    index("supplier_capacity_period_supplier_status_window").on(table.supplierId, table.status, table.startsAt, table.endsAt),
    foreignKey({ name: "supplier_capacity_period_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_capacity_period_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const supplierClosure = pgTable(
  "supplier_closure",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    capacityPeriodId: text("capacity_period_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    unavailableUnits: integer("unavailable_units").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("scheduled"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("supplier_closure_status_allowed", "status", SUPPLIER_CLOSURE_STATUSES),
    positiveQuantityCheck("supplier_closure_units_positive", "unavailable_units"),
    check("supplier_closure_window_valid", sql.raw(`"ends_at" > "starts_at"`)),
    index("supplier_closure_supplier_window").on(table.supplierId, table.startsAt, table.endsAt),
    foreignKey({ name: "supplier_closure_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_closure_period_fk", columns: [table.capacityPeriodId], foreignColumns: [supplierCapacityPeriod.id] }).onDelete("restrict"),
    foreignKey({ name: "supplier_closure_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionCapacityReservation = pgTable(
  "production_capacity_reservation",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    capacityPeriodId: text("capacity_period_id").notNull(),
    jobId: text("job_id").notNull(),
    units: integer("units").notNull(),
    status: text("status").notNull().default("reserved"),
    idempotencyKey: text("idempotency_key").notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_capacity_reservation_status_allowed", "status", PRODUCTION_CAPACITY_RESERVATION_STATUSES),
    positiveQuantityCheck("production_capacity_reservation_units_positive", "units"),
    uniqueIndex("production_capacity_reservation_job_unique").on(table.jobId),
    uniqueIndex("production_capacity_reservation_idempotency_unique").on(table.supplierId, table.idempotencyKey),
    index("production_capacity_reservation_period_status").on(table.capacityPeriodId, table.status),
    foreignKey({ name: "production_capacity_reservation_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "production_capacity_reservation_period_fk", columns: [table.capacityPeriodId], foreignColumns: [supplierCapacityPeriod.id] }).onDelete("restrict"),
    foreignKey({ name: "production_capacity_reservation_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_capacity_reservation_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionCommand = pgTable(
  "production_command",
  {
    id: text("id").primaryKey(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: text("state").notNull().default("pending"),
    resultResourceId: text("result_resource_id"),
    resultPayload: jsonb("result_payload"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_command_state_allowed", "state", PRODUCTION_COMMAND_STATES),
    uniqueIndex("production_command_scope_key_unique").on(table.scopeType, table.scopeId, table.commandType, table.idempotencyKey),
    index("production_command_state_created").on(table.state, table.createdAt),
  ],
);

export const productionEvent = pgTable(
  "production_event",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: text("source_entity_id").notNull(),
    jobId: text("job_id"),
    supplierId: text("supplier_id").notNull(),
    recipientScope: text("recipient_scope"),
    recipientId: text("recipient_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_event_type_allowed", "event_type", PRODUCTION_EVENT_TYPES),
    uniqueIndex("production_event_source_unique").on(table.sourceEntityType, table.sourceEntityId, table.eventType),
    index("production_event_supplier_created").on(table.supplierId, table.createdAt),
    index("production_event_job_created").on(table.jobId, table.createdAt),
    foreignKey({ name: "production_event_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_event_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
  ],
);

export const productionSample = pgTable(
  "production_sample",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    sampleType: text("sample_type").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    finalReviewRequired: boolean("final_review_required").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_sample_type_allowed", "sample_type", PRODUCTION_SAMPLE_TYPES),
    stateCheck("production_sample_status_allowed", "status", PRODUCTION_SAMPLE_STATUSES),
    uniqueIndex("production_sample_job_type_unique").on(table.jobId, table.sampleType),
    index("production_sample_job_status").on(table.jobId, table.status),
    foreignKey({ name: "production_sample_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_sample_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionSampleRevision = pgTable(
  "production_sample_revision",
  {
    id: text("id").primaryKey(),
    sampleId: text("sample_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    specificationSnapshot: jsonb("specification_snapshot").notNull().default({}),
    notes: text("notes"),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("submitted"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_sample_revision_status_allowed", "status", PRODUCTION_SAMPLE_STATUSES),
    positiveQuantityCheck("production_sample_revision_number_positive", "revision_number"),
    uniqueIndex("production_sample_revision_number_unique").on(table.sampleId, table.revisionNumber),
    index("production_sample_revision_sample_created").on(table.sampleId, table.createdAt),
    foreignKey({ name: "production_sample_revision_sample_fk", columns: [table.sampleId], foreignColumns: [productionSample.id] }).onDelete("restrict"),
    foreignKey({ name: "production_sample_revision_submitted_by_fk", columns: [table.submittedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionSampleReview = pgTable(
  "production_sample_review",
  {
    id: text("id").primaryKey(),
    sampleRevisionId: text("sample_revision_id").notNull(),
    decision: text("decision").notNull(),
    notes: text("notes"),
    reviewedBy: text("reviewed_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_sample_review_decision_allowed", "decision", PRODUCTION_SAMPLE_REVIEW_DECISIONS),
    index("production_sample_review_revision_created").on(table.sampleRevisionId, table.createdAt),
    foreignKey({ name: "production_sample_review_revision_fk", columns: [table.sampleRevisionId], foreignColumns: [productionSampleRevision.id] }).onDelete("restrict"),
    foreignKey({ name: "production_sample_review_reviewed_by_fk", columns: [table.reviewedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionArtifact = pgTable(
  "production_artifact",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    sampleRevisionId: text("sample_revision_id"),
    artifactType: text("artifact_type").notNull(),
    storageProvider: text("storage_provider").notNull().default("metadata_only"),
    objectKey: text("object_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    private: boolean("private").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_artifact_type_allowed", "artifact_type", PRODUCTION_ARTIFACT_TYPES),
    stateCheck("production_artifact_provider_allowed", "storage_provider", PRODUCTION_ARTIFACT_PROVIDERS),
    stateCheck("production_artifact_mime_allowed", "mime_type", PRODUCTION_ARTIFACT_MIME_TYPES),
    check("production_artifact_byte_size_positive", sql.raw(`"byte_size" > 0 AND "byte_size" <= 5242880`)),
    check("production_artifact_private_required", sql.raw(`"private" = true`)),
    check("production_artifact_checksum_shape", sql.raw(`"checksum_sha256" ~ '^[0-9a-f]{64}$'`)),
    uniqueIndex("production_artifact_object_key_unique").on(table.objectKey),
    index("production_artifact_job_created").on(table.jobId, table.createdAt),
    foreignKey({ name: "production_artifact_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_artifact_revision_fk", columns: [table.sampleRevisionId], foreignColumns: [productionSampleRevision.id] }).onDelete("restrict"),
    foreignKey({ name: "production_artifact_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionChangeRequest = pgTable(
  "production_change_request",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    changeType: text("change_type").notNull(),
    status: text("status").notNull().default("draft"),
    ownerDomain: text("owner_domain").notNull(),
    requestedFields: jsonb("requested_fields").notNull().default({}),
    reason: text("reason").notNull(),
    commercialImpact: boolean("commercial_impact").notNull().default(false),
    deliveryImpact: boolean("delivery_impact").notNull().default(false),
    ownerDecisionReference: text("owner_decision_reference"),
    supportCaseReference: text("support_case_reference"),
    requestedBy: text("requested_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_change_type_allowed", "change_type", PRODUCTION_CHANGE_TYPES),
    stateCheck("production_change_status_allowed", "status", PRODUCTION_CHANGE_STATUSES),
    stateCheck("production_change_owner_domain_allowed", "owner_domain", PRODUCTION_CHANGE_OWNER_DOMAINS),
    check("production_change_commercial_owner_bound", sql.raw(`("commercial_impact" = false) OR ("owner_domain" IN ('orders', 'offers'))`)),
    check("production_change_delivery_owner_bound", sql.raw(`("delivery_impact" = false) OR ("owner_domain" = 'shipping')`)),
    index("production_change_job_status_created").on(table.jobId, table.status, table.createdAt),
    foreignKey({ name: "production_change_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_change_requested_by_fk", columns: [table.requestedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionChangeDecision = pgTable(
  "production_change_decision",
  {
    id: text("id").primaryKey(),
    changeRequestId: text("change_request_id").notNull(),
    decision: text("decision").notNull(),
    decisionReference: text("decision_reference"),
    notes: text("notes"),
    decidedBy: text("decided_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_change_decision_allowed", "decision", PRODUCTION_CHANGE_DECISIONS),
    index("production_change_decision_request_created").on(table.changeRequestId, table.createdAt),
    foreignKey({ name: "production_change_decision_request_fk", columns: [table.changeRequestId], foreignColumns: [productionChangeRequest.id] }).onDelete("restrict"),
    foreignKey({ name: "production_change_decision_decided_by_fk", columns: [table.decidedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const qualityChecklist = pgTable(
  "quality_checklist",
  {
    id: text("id").primaryKey(),
    checklistKey: text("checklist_key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quality_checklist_status_allowed", "status", QUALITY_CHECKLIST_STATUSES),
    positiveQuantityCheck("quality_checklist_version_positive", "version"),
    uniqueIndex("quality_checklist_key_version_unique").on(table.checklistKey, table.version),
    index("quality_checklist_key_status").on(table.checklistKey, table.status),
    foreignKey({ name: "quality_checklist_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const qualityChecklistItem = pgTable(
  "quality_checklist_item",
  {
    id: text("id").primaryKey(),
    checklistId: text("checklist_id").notNull(),
    itemKey: text("item_key").notNull(),
    label: text("label").notNull(),
    sequence: integer("sequence").notNull(),
    measurementType: text("measurement_type").notNull(),
    required: boolean("required").notNull().default(true),
    minInteger: integer("min_integer"),
    maxInteger: integer("max_integer"),
    unit: text("unit"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("quality_checklist_item_measurement_allowed", "measurement_type", QUALITY_MEASUREMENT_TYPES),
    positiveQuantityCheck("quality_checklist_item_sequence_positive", "sequence"),
    check("quality_checklist_item_integer_bounds_ordered", sql.raw(`"min_integer" IS NULL OR "max_integer" IS NULL OR "max_integer" >= "min_integer"`)),
    uniqueIndex("quality_checklist_item_key_unique").on(table.checklistId, table.itemKey),
    index("quality_checklist_item_sequence_idx").on(table.checklistId, table.sequence),
    foreignKey({ name: "quality_checklist_item_checklist_fk", columns: [table.checklistId], foreignColumns: [qualityChecklist.id] }).onDelete("restrict"),
  ],
);

export const productionLot = pgTable(
  "production_lot",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull(),
    lotCode: text("lot_code").notNull(),
    status: text("status").notNull().default("open"),
    plannedUnits: integer("planned_units").notNull(),
    producedUnits: integer("produced_units").notNull().default(0),
    acceptedUnits: integer("accepted_units").notNull().default(0),
    rejectedUnits: integer("rejected_units").notNull().default(0),
    reworkUnits: integer("rework_units").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_lot_status_allowed", "status", PRODUCTION_LOT_STATUSES),
    positiveQuantityCheck("production_lot_planned_units_positive", "planned_units"),
    quantityCheck("production_lot_produced_non_negative", "produced_units"),
    quantityCheck("production_lot_accepted_non_negative", "accepted_units"),
    quantityCheck("production_lot_rejected_non_negative", "rejected_units"),
    quantityCheck("production_lot_rework_non_negative", "rework_units"),
    check("production_lot_accepted_rejected_within_produced", sql.raw(`"accepted_units" + "rejected_units" <= "produced_units"`)),
    check("production_lot_disposition_within_produced", sql.raw(`"accepted_units" + "rejected_units" + "rework_units" <= "produced_units"`)),
    check("production_lot_rework_within_produced", sql.raw(`"rework_units" <= "produced_units"`)),
    uniqueIndex("production_lot_code_unique").on(table.lotCode),
    index("production_lot_job_status").on(table.jobId, table.status),
    foreignKey({ name: "production_lot_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_purchase_order_fk", columns: [table.purchaseOrderId], foreignColumns: [purchaseOrder.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);


export const qualityInspection = pgTable(
  "quality_inspection",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    lotId: text("lot_id").notNull(),
    checklistId: text("checklist_id").notNull(),
    checklistVersion: integer("checklist_version").notNull(),
    status: text("status").notNull().default("draft"),
    sampleSize: integer("sample_size").notNull(),
    acceptedUnits: integer("accepted_units").notNull().default(0),
    defectUnits: integer("defect_units").notNull().default(0),
    reworkUnits: integer("rework_units").notNull().default(0),
    rejectedUnits: integer("rejected_units").notNull().default(0),
    defectRateBps: integer("defect_rate_bps").notNull().default(0),
    passRateBps: integer("pass_rate_bps").notNull().default(0),
    decision: text("decision"),
    submittedBy: text("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quality_inspection_status_allowed", "status", QUALITY_INSPECTION_STATUSES),
    stateCheck("quality_inspection_decision_allowed", "decision", QUALITY_INSPECTION_DECISIONS),
    positiveQuantityCheck("quality_inspection_sample_size_positive", "sample_size"),
    quantityCheck("quality_inspection_accepted_non_negative", "accepted_units"),
    quantityCheck("quality_inspection_defect_non_negative", "defect_units"),
    quantityCheck("quality_inspection_rework_non_negative", "rework_units"),
    quantityCheck("quality_inspection_rejected_non_negative", "rejected_units"),
    check("quality_inspection_arithmetic_invariant", sql.raw(`"status" IN ('draft', 'in_progress') OR "sample_size" = "accepted_units" + "defect_units" + "rework_units" + "rejected_units"`)),
    check("quality_inspection_defect_rate_bounds", sql.raw(`"defect_rate_bps" >= 0 AND "defect_rate_bps" <= 10000`)),
    check("quality_inspection_pass_rate_bounds", sql.raw(`"pass_rate_bps" >= 0 AND "pass_rate_bps" <= 10000`)),
    check("quality_inspection_rates_not_over_total", sql.raw(`"defect_rate_bps" + "pass_rate_bps" <= 10000`)),
    index("quality_inspection_job_status_created").on(table.jobId, table.status, table.createdAt),
    index("quality_inspection_lot_status").on(table.lotId, table.status),
    foreignKey({ name: "quality_inspection_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_inspection_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_inspection_checklist_fk", columns: [table.checklistId], foreignColumns: [qualityChecklist.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_inspection_submitted_by_fk", columns: [table.submittedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_inspection_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const qualityInspectionItem = pgTable(
  "quality_inspection_item",
  {
    id: text("id").primaryKey(),
    inspectionId: text("inspection_id").notNull(),
    checklistItemId: text("checklist_item_id").notNull(),
    itemKeySnapshot: text("item_key_snapshot").notNull(),
    measurementTypeSnapshot: text("measurement_type_snapshot").notNull(),
    observedInteger: integer("observed_integer"),
    observedBoolean: boolean("observed_boolean"),
    observedText: text("observed_text"),
    passed: boolean("passed"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("quality_inspection_item_measurement_allowed", "measurement_type_snapshot", QUALITY_MEASUREMENT_TYPES),
    uniqueIndex("quality_inspection_item_unique").on(table.inspectionId, table.checklistItemId),
    index("quality_inspection_item_inspection").on(table.inspectionId),
    foreignKey({ name: "quality_inspection_item_inspection_fk", columns: [table.inspectionId], foreignColumns: [qualityInspection.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_inspection_item_checklist_item_fk", columns: [table.checklistItemId], foreignColumns: [qualityChecklistItem.id] }).onDelete("restrict"),
  ],
);

export const qualityDefect = pgTable(
  "quality_defect",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    lotId: text("lot_id").notNull(),
    inspectionId: text("inspection_id"),
    defectCode: text("defect_code").notNull(),
    description: text("description").notNull(),
    severity: text("severity").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("open"),
    dispositionNote: text("disposition_note"),
    detectedBy: text("detected_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quality_defect_severity_allowed", "severity", QUALITY_DEFECT_SEVERITIES),
    stateCheck("quality_defect_status_allowed", "status", QUALITY_DEFECT_STATUSES),
    positiveQuantityCheck("quality_defect_quantity_positive", "quantity"),
    index("quality_defect_job_status_severity").on(table.jobId, table.status, table.severity),
    index("quality_defect_lot_status").on(table.lotId, table.status),
    foreignKey({ name: "quality_defect_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_defect_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_defect_inspection_fk", columns: [table.inspectionId], foreignColumns: [qualityInspection.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_defect_detected_by_fk", columns: [table.detectedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const qualityRework = pgTable(
  "quality_rework",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    lotId: text("lot_id").notNull(),
    defectId: text("defect_id").notNull(),
    quantity: integer("quantity").notNull(),
    instructions: text("instructions").notNull(),
    status: text("status").notNull().default("requested"),
    requestedBy: text("requested_by").notNull(),
    completedBy: text("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quality_rework_status_allowed", "status", QUALITY_REWORK_STATUSES),
    positiveQuantityCheck("quality_rework_quantity_positive", "quantity"),
    index("quality_rework_job_status").on(table.jobId, table.status),
    foreignKey({ name: "quality_rework_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_rework_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_rework_defect_fk", columns: [table.defectId], foreignColumns: [qualityDefect.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_rework_requested_by_fk", columns: [table.requestedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_rework_completed_by_fk", columns: [table.completedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionLotTrace = pgTable(
  "production_lot_trace",
  {
    id: text("id").primaryKey(),
    lotId: text("lot_id").notNull(),
    traceType: text("trace_type").notNull(),
    purchaseOrderItemId: text("purchase_order_item_id"),
    variantId: text("variant_id"),
    sourceLotId: text("source_lot_id"),
    quantity: integer("quantity").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_lot_trace_type_allowed", "trace_type", PRODUCTION_LOT_TRACE_TYPES),
    positiveQuantityCheck("production_lot_trace_quantity_positive", "quantity"),
    check("production_lot_trace_target_present", sql.raw(`("trace_type" = 'purchase_order_item' AND "purchase_order_item_id" IS NOT NULL AND "variant_id" IS NULL AND "source_lot_id" IS NULL) OR ("trace_type" = 'variant' AND "variant_id" IS NOT NULL AND "purchase_order_item_id" IS NULL AND "source_lot_id" IS NULL) OR ("trace_type" = 'source_lot' AND "source_lot_id" IS NOT NULL AND "purchase_order_item_id" IS NULL AND "variant_id" IS NULL)`)),
    uniqueIndex("production_lot_trace_unique").on(table.lotId, table.traceType, table.purchaseOrderItemId, table.variantId, table.sourceLotId),
    index("production_lot_trace_po_item").on(table.purchaseOrderItemId),
    index("production_lot_trace_variant").on(table.variantId),
    foreignKey({ name: "production_lot_trace_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_trace_purchase_order_item_fk", columns: [table.purchaseOrderItemId], foreignColumns: [purchaseOrderItem.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_trace_variant_fk", columns: [table.variantId], foreignColumns: [productVariant.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_trace_source_lot_fk", columns: [table.sourceLotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "production_lot_trace_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const qualityRelease = pgTable(
  "quality_release",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    lotId: text("lot_id").notNull(),
    status: text("status").notNull().default("pending"),
    readinessSnapshot: jsonb("readiness_snapshot").notNull().default({}),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("quality_release_status_allowed", "status", QUALITY_RELEASE_STATUSES),
    uniqueIndex("quality_release_job_lot_unique").on(table.jobId, table.lotId),
    index("quality_release_status_created").on(table.status, table.createdAt),
    foreignKey({ name: "quality_release_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_release_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_release_requested_by_fk", columns: [table.requestedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "quality_release_decided_by_fk", columns: [table.decidedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionRecall = pgTable(
  "production_recall",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id").notNull(),
    jobId: text("job_id"),
    severity: text("severity").notNull(),
    scopeType: text("scope_type").notNull(),
    status: text("status").notNull().default("draft"),
    reason: text("reason").notNull(),
    approvalRequestId: text("approval_request_id"),
    makerId: text("maker_id").notNull(),
    checkerId: text("checker_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    containedAt: timestamp("contained_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("production_recall_severity_allowed", "severity", PRODUCTION_RECALL_SEVERITIES),
    stateCheck("production_recall_scope_type_allowed", "scope_type", PRODUCTION_RECALL_SCOPE_TYPES),
    stateCheck("production_recall_status_allowed", "status", PRODUCTION_RECALL_STATUSES),
    check("production_recall_checker_distinct", sql.raw(`"checker_id" IS NULL OR "checker_id" <> "maker_id"`)),
    uniqueIndex("production_recall_approval_request_unique").on(table.approvalRequestId).where(sql`"approval_request_id" IS NOT NULL`),
    index("production_recall_supplier_status_created").on(table.supplierId, table.status, table.createdAt),
    foreignKey({ name: "production_recall_supplier_fk", columns: [table.supplierId], foreignColumns: [supplier.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_job_fk", columns: [table.jobId], foreignColumns: [productionJob.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_approval_request_fk", columns: [table.approvalRequestId], foreignColumns: [approvalRequest.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_maker_fk", columns: [table.makerId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_checker_fk", columns: [table.checkerId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const productionRecallScope = pgTable(
  "production_recall_scope",
  {
    id: text("id").primaryKey(),
    recallId: text("recall_id").notNull(),
    lotId: text("lot_id"),
    purchaseOrderItemId: text("purchase_order_item_id"),
    variantId: text("variant_id"),
    quantity: integer("quantity"),
    createdAt: createdAt(),
  },
  (table) => [
    quantityCheck("production_recall_scope_quantity_non_negative", "quantity"),
    check("production_recall_scope_target_exactly_one", sql.raw(`(("lot_id" IS NOT NULL)::integer + ("purchase_order_item_id" IS NOT NULL)::integer + ("variant_id" IS NOT NULL)::integer) = 1`)),
    uniqueIndex("production_recall_scope_target_unique").on(table.recallId, table.lotId, table.purchaseOrderItemId, table.variantId),
    index("production_recall_scope_recall").on(table.recallId),
    foreignKey({ name: "production_recall_scope_recall_fk", columns: [table.recallId], foreignColumns: [productionRecall.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_scope_lot_fk", columns: [table.lotId], foreignColumns: [productionLot.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_scope_purchase_order_item_fk", columns: [table.purchaseOrderItemId], foreignColumns: [purchaseOrderItem.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_scope_variant_fk", columns: [table.variantId], foreignColumns: [productVariant.id] }).onDelete("restrict"),
  ],
);

export const productionRecallApproval = pgTable(
  "production_recall_approval",
  {
    id: text("id").primaryKey(),
    recallId: text("recall_id").notNull(),
    approvalRequestId: text("approval_request_id").notNull(),
    decision: text("decision").notNull(),
    makerId: text("maker_id").notNull(),
    checkerId: text("checker_id").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("production_recall_approval_decision_allowed", "decision", ["approved", "rejected"]),
    check("production_recall_approval_distinct", sql.raw(`"maker_id" <> "checker_id"`)),
    uniqueIndex("production_recall_approval_request_row_unique").on(table.approvalRequestId),
    index("production_recall_approval_recall_created").on(table.recallId, table.createdAt),
    foreignKey({ name: "production_recall_approval_recall_fk", columns: [table.recallId], foreignColumns: [productionRecall.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_approval_request_fk", columns: [table.approvalRequestId], foreignColumns: [approvalRequest.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_approval_maker_fk", columns: [table.makerId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "production_recall_approval_checker_fk", columns: [table.checkerId], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

/* ── Phase 5.7 — Promotions / Campaign / Commercial Engine ────────────────────
 *
 * Promotions decides commercial eligibility + benefit. Identity (promotion) is
 * separate from versioned commercial terms (promotion_revision): publishing
 * freezes a revision (service + trigger), and every redemption/usage row
 * points at the exact revision applied. Money is BIGINT IRR, percents are
 * integer basis points. Targets are allowlisted (type, reference) rows —
 * there is no executable rule language anywhere in this model.
 */

export const promotion = pgTable(
  "promotion",
  {
    id: text("id").primaryKey(),
    promotionKey: text("promotion_key").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("DRAFT"),
    currentPublishedRevisionId: text("current_published_revision_id"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("promotion_channel_allowed", "channel", PROMOTION_CHANNELS),
    stateCheck("promotion_status_allowed", "status", PROMOTION_STATUSES),
    check("promotion_key_format", sql.raw(`"promotion_key" ~ '^[A-Z0-9][A-Z0-9._-]{2,63}$'`)),
    uniqueIndex("promotion_key_unique").on(table.promotionKey),
    index("promotion_channel_status").on(table.channel, table.status),
    // NOTE (CMS precedent): the current_published_revision_id → promotion_revision
    // FK exists in SQL + snapshot but is omitted from the Drizzle model to avoid a
    // circular type-inference cycle (promotion ↔ promotion_revision).
    foreignKey({ name: "promotion_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const promotionRevision = pgTable(
  "promotion_revision",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    status: text("status").notNull().default("DRAFT"),
    stackingPolicy: text("stacking_policy").notNull().default("STACKABLE"),
    priority: integer("priority").notNull().default(100),
    couponRequired: boolean("coupon_required").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimitTotal: integer("usage_limit_total"),
    usageLimitPerCustomer: integer("usage_limit_per_customer"),
    approvalRequestId: text("approval_request_id"),
    termsHash: text("terms_hash").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("promotion_revision_status_allowed", "status", PROMOTION_REVISION_STATUSES),
    stateCheck("promotion_revision_stacking_allowed", "stacking_policy", PROMOTION_STACKING_POLICIES),
    positiveQuantityCheck("promotion_revision_number_positive", "revision_number"),
    quantityCheck("promotion_revision_priority_non_negative", "priority"),
    check("promotion_revision_window_valid", sql.raw(`"ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"`)),
    check("promotion_revision_usage_limit_total_positive", sql.raw(`"usage_limit_total" IS NULL OR "usage_limit_total" > 0`)),
    check("promotion_revision_usage_limit_per_customer_positive", sql.raw(`"usage_limit_per_customer" IS NULL OR "usage_limit_per_customer" > 0`)),
    check("promotion_revision_terms_hash_format", sql.raw(`"terms_hash" ~ '^[0-9a-f]{64}$'`)),
    uniqueIndex("promotion_revision_number_unique").on(table.promotionId, table.revisionNumber),
    index("promotion_revision_promotion_status").on(table.promotionId, table.status),
    foreignKey({ name: "promotion_revision_promotion_fk", columns: [table.promotionId], foreignColumns: [promotion.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_revision_approval_request_fk", columns: [table.approvalRequestId], foreignColumns: [approvalRequest.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_revision_published_by_fk", columns: [table.publishedBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_revision_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const promotionTarget = pgTable(
  "promotion_target",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id").notNull(),
    targetType: text("target_type").notNull(),
    referenceId: text("reference_id"),
    minSubtotal: bigint("min_subtotal", { mode: "bigint" }),
    minQuantity: integer("min_quantity"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("promotion_target_type_allowed", "target_type", PROMOTION_TARGET_TYPES),
    check(
      "promotion_target_shape_valid",
      sql.raw(
        `("target_type" IN ('PRODUCT', 'CATEGORY', 'OFFER', 'VIP_PLAN', 'VIP_ACCOUNT', 'CUSTOMER_SEGMENT', 'CHANNEL') AND "reference_id" IS NOT NULL AND "min_subtotal" IS NULL AND "min_quantity" IS NULL AND "starts_at" IS NULL AND "ends_at" IS NULL)` +
          ` OR ("target_type" = 'MIN_SUBTOTAL' AND "min_subtotal" IS NOT NULL AND "reference_id" IS NULL AND "min_quantity" IS NULL AND "starts_at" IS NULL AND "ends_at" IS NULL)` +
          ` OR ("target_type" = 'MIN_QUANTITY' AND "min_quantity" IS NOT NULL AND "reference_id" IS NULL AND "min_subtotal" IS NULL AND "starts_at" IS NULL AND "ends_at" IS NULL)` +
          ` OR ("target_type" = 'DATE_WINDOW' AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL AND "ends_at" > "starts_at" AND "reference_id" IS NULL AND "min_subtotal" IS NULL AND "min_quantity" IS NULL)`,
      ),
    ),
    check("promotion_target_channel_reference_valid", sql.raw(`"target_type" <> 'CHANNEL' OR "reference_id" IN ('RETAIL', 'WHOLESALE')`)),
    check("promotion_target_min_subtotal_range", sql.raw(`"min_subtotal" IS NULL OR ("min_subtotal" >= 0 AND "min_subtotal" <= ${MAX_MONEY_RIAL.toString()})`)),
    check("promotion_target_min_quantity_positive", sql.raw(`"min_quantity" IS NULL OR "min_quantity" > 0`)),
    index("promotion_target_revision").on(table.revisionId),
    foreignKey({ name: "promotion_target_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
  ],
);

export const promotionBenefit = pgTable(
  "promotion_benefit",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id").notNull(),
    benefitType: text("benefit_type").notNull(),
    scope: text("scope").notNull(),
    percentBps: integer("percent_bps"),
    amount: bigint("amount", { mode: "bigint" }),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("promotion_benefit_type_allowed", "benefit_type", PROMOTION_BENEFIT_TYPES),
    stateCheck("promotion_benefit_scope_allowed", "scope", PROMOTION_BENEFIT_SCOPES),
    check(
      "promotion_benefit_shape_valid",
      sql.raw(
        `("benefit_type" = 'PERCENT_DISCOUNT' AND "scope" IN ('LINE', 'ORDER') AND "percent_bps" >= 1 AND "percent_bps" <= 10000 AND "amount" IS NULL)` +
          ` OR ("benefit_type" = 'FIXED_AMOUNT_DISCOUNT' AND "scope" = 'ORDER' AND "amount" > 0 AND "amount" <= ${MAX_MONEY_RIAL.toString()} AND "percent_bps" IS NULL)` +
          ` OR ("benefit_type" = 'FREE_SHIPPING' AND "scope" = 'SHIPPING' AND "percent_bps" IS NULL AND "amount" IS NULL)`,
      ),
    ),
    index("promotion_benefit_revision").on(table.revisionId),
    foreignKey({ name: "promotion_benefit_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
  ],
);

export const promotionCoupon = pgTable(
  "promotion_coupon",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id").notNull(),
    revisionId: text("revision_id"),
    code: text("code").notNull(),
    codeNormalized: text("code_normalized").notNull(),
    status: text("status").notNull().default("ENABLED"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    stateCheck("promotion_coupon_status_allowed", "status", PROMOTION_COUPON_STATUSES),
    check("promotion_coupon_window_valid", sql.raw(`"ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"`)),
    check("promotion_coupon_usage_limit_positive", sql.raw(`"usage_limit" IS NULL OR "usage_limit" > 0`)),
    check("promotion_coupon_per_customer_limit_positive", sql.raw(`"per_customer_limit" IS NULL OR "per_customer_limit" > 0`)),
    quantityCheck("promotion_coupon_redeemed_count_non_negative", "redeemed_count"),
    check("promotion_coupon_code_normalized_format", sql.raw(`"code_normalized" ~ '^[A-Z0-9][A-Z0-9._-]{1,63}$'`)),
    uniqueIndex("promotion_coupon_code_unique").on(table.codeNormalized),
    index("promotion_coupon_promotion_status").on(table.promotionId, table.status),
    index("promotion_coupon_revision").on(table.revisionId),
    foreignKey({ name: "promotion_coupon_promotion_fk", columns: [table.promotionId], foreignColumns: [promotion.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_coupon_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_coupon_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);

export const promotionCouponRedemption = pgTable(
  "promotion_coupon_redemption",
  {
    id: text("id").primaryKey(),
    couponId: text("coupon_id").notNull(),
    promotionId: text("promotion_id").notNull(),
    revisionId: text("revision_id").notNull(),
    channel: text("channel").notNull(),
    customerKey: text("customer_key").notNull(),
    orderReference: text("order_reference"),
    baseAmount: bigint("base_amount", { mode: "bigint" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "bigint" }).notNull(),
    finalAmount: bigint("final_amount", { mode: "bigint" }).notNull(),
    evaluationHash: text("evaluation_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("promotion_coupon_redemption_channel_allowed", "channel", PROMOTION_CHANNELS),
    check("promotion_coupon_redemption_base_amount_range", sql.raw(`"base_amount" >= 0 AND "base_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_coupon_redemption_discount_amount_range", sql.raw(`"discount_amount" >= 0 AND "discount_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_coupon_redemption_final_amount_range", sql.raw(`"final_amount" >= 0 AND "final_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_coupon_redemption_amounts_consistent", sql.raw(`"discount_amount" <= "base_amount" AND "final_amount" = "base_amount" - "discount_amount"`)),
    check("promotion_coupon_redemption_evaluation_hash_format", sql.raw(`"evaluation_hash" ~ '^[0-9a-f]{64}$'`)),
    uniqueIndex("promotion_coupon_redemption_idempotency_unique").on(table.couponId, table.idempotencyKey),
    index("promotion_coupon_redemption_coupon_created").on(table.couponId, table.createdAt),
    index("promotion_coupon_redemption_promotion_customer").on(table.promotionId, table.customerKey),
    index("promotion_coupon_redemption_revision").on(table.revisionId),
    foreignKey({ name: "promotion_coupon_redemption_coupon_fk", columns: [table.couponId], foreignColumns: [promotionCoupon.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_coupon_redemption_promotion_fk", columns: [table.promotionId], foreignColumns: [promotion.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_coupon_redemption_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
  ],
);

export const promotionUsage = pgTable(
  "promotion_usage",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id").notNull(),
    revisionId: text("revision_id").notNull(),
    channel: text("channel").notNull(),
    customerKey: text("customer_key").notNull(),
    orderReference: text("order_reference"),
    baseAmount: bigint("base_amount", { mode: "bigint" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "bigint" }).notNull(),
    finalAmount: bigint("final_amount", { mode: "bigint" }).notNull(),
    evaluationHash: text("evaluation_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("promotion_usage_channel_allowed", "channel", PROMOTION_CHANNELS),
    check("promotion_usage_base_amount_range", sql.raw(`"base_amount" >= 0 AND "base_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_usage_discount_amount_range", sql.raw(`"discount_amount" >= 0 AND "discount_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_usage_final_amount_range", sql.raw(`"final_amount" >= 0 AND "final_amount" <= ${MAX_MONEY_RIAL.toString()}`)),
    check("promotion_usage_amounts_consistent", sql.raw(`"discount_amount" <= "base_amount" AND "final_amount" = "base_amount" - "discount_amount"`)),
    check("promotion_usage_evaluation_hash_format", sql.raw(`"evaluation_hash" ~ '^[0-9a-f]{64}$'`)),
    uniqueIndex("promotion_usage_idempotency_unique").on(table.promotionId, table.idempotencyKey),
    index("promotion_usage_promotion_customer").on(table.promotionId, table.customerKey),
    index("promotion_usage_revision").on(table.revisionId),
    foreignKey({ name: "promotion_usage_promotion_fk", columns: [table.promotionId], foreignColumns: [promotion.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_usage_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
  ],
);

export const promotionSchedule = pgTable(
  "promotion_schedule",
  {
    id: text("id").primaryKey(),
    promotionId: text("promotion_id").notNull(),
    revisionId: text("revision_id").notNull(),
    action: text("action").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("SCHEDULED"),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    stateCheck("promotion_schedule_action_allowed", "action", PROMOTION_SCHEDULE_ACTIONS),
    stateCheck("promotion_schedule_status_allowed", "status", PROMOTION_SCHEDULE_STATUSES),
    quantityCheck("promotion_schedule_attempt_count_non_negative", "attempt_count"),
    uniqueIndex("promotion_schedule_idempotency_unique").on(table.idempotencyKey),
    index("promotion_schedule_status_scheduled").on(table.status, table.scheduledAt),
    index("promotion_schedule_promotion").on(table.promotionId),
    foreignKey({ name: "promotion_schedule_promotion_fk", columns: [table.promotionId], foreignColumns: [promotion.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_schedule_revision_fk", columns: [table.revisionId], foreignColumns: [promotionRevision.id] }).onDelete("restrict"),
    foreignKey({ name: "promotion_schedule_created_by_fk", columns: [table.createdBy], foreignColumns: [accountUser.id] }).onDelete("restrict"),
  ],
);
