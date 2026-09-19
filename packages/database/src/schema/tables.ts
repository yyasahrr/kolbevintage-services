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
  VARIANT_INVENTORY_STATUS,
  VIP_PLAN_STATUSES,
  VIP_SUBSCRIPTION_STATUSES,
  WHOLESALE_ACCOUNT_STATUSES,
  WHOLESALE_ORDER_STATUS_VALUES,
  WHOLESALE_PAYMENT_MODES,
  WHOLESALE_PROFORMA_STATUSES,
  WHOLESALE_REQUEST_STATUSES,
  WHOLESALE_REVISION_BUYER_RESPONSES,
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
