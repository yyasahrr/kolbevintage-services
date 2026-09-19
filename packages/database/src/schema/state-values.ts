/**
 * مجموعهٔ مقادیر مجاز وضعیت‌ها — منبع واحد برای قیدهای `CHECK`.
 *
 * ── چرا این فایل وجود دارد ───────────────────────────────────────────────────
 * قاعدهٔ A14 (PROMPT 0): «Do not directly overwrite state-machine statuses. All
 * critical transitions must be validated server-side.» گام ۱.۲ اضافه می‌کند:
 * وضعیت‌ها باید در **دیتابیس** هم قید داشته باشند، و شرط آن این است که «مجموعهٔ
 * مقادیر مجاز» یک منبع داشته باشد؛ وگرنه کد و دیتابیس دو حقیقت رقیب می‌شوند.
 *
 * این فایل آن منبع است:
 *   ۱) `tables.ts` از این آرایه‌ها قید `CHECK` می‌سازد (و مهاجرت از آن‌ها تولید می‌شود).
 *   ۲) آزمون‌های رانش (`test/state-constraints.test.ts`) این آرایه‌ها را با قیدهای
 *      واقعی دیتابیس و با فهرست‌های اعتبارسنجی سرور مقایسه می‌کنند.
 *
 * ── قاعدهٔ شاهد (evidence) ───────────────────────────────────────────────────
 * هیچ مجموعه‌ای اینجا «حدسی» یا «طبق معمول» نوشته نشده است. برای هر مجموعه،
 * منبع در کامنت ذکر شده: یا ماشین حالت `@kolbe/shared`، یا فهرست اعتبارسنجی
 * صریح در سرور، یا تنها مقداری که کد امروز می‌نویسد.
 *
 * ماشین‌های حالت (`WHOLESALE_ORDER_STATUSES`, `CHILD_ORDER_STATUSES`,
 * `RETAIL_ORDER_STATUSES`, `MAX_MONEY`) از `@kolbe/shared` خوانده می‌شوند تا
 * نسخهٔ دوم و رقیبی ساخته نشود.
 */

import {
  CHILD_ORDER_STATUSES,
  MAX_MONEY,
  RETAIL_ORDER_STATUSES,
  WHOLESALE_ORDER_STATUSES,
} from "@kolbe/shared";

/**
 * نقش‌های حساب.
 * شاهد: `account_user.role` فقط با این مقادیر نوشته می‌شود —
 * `'customer'` (ثبت‌نام/بازگشت از VIP)، `'vip'` (تأیید درخواست VIP)،
 * `'supplier'` (ساخت حساب تأمین‌کننده در تأیید درخواست)، `'admin'` (اسکریپت
 * اپراتور `scripts/create-admin.mjs`).
 */
export const ACCOUNT_ROLES = ["customer", "vip", "admin", "supplier"] as const;

/**
 * وضعیت حساب کاربری — فاز ۲.
 * شاهد: `account_user.status` در کد ورود با `active` مقایسه می‌شود؛
 * مسیرهای مسدودسازی باید `suspended`/`locked` بنویسند.
 * تا پیش از فاز ۲ قید CHECK نداشت (N12) و حالا اضافه می‌شود.
 */
export const ACCOUNT_STATUSES = ["active", "suspended", "locked"] as const;

/**
 * ── فاز ۳ — مدل فروشنده و بازار عمده ─────────────────────────────────────
 * فروشنده می‌تواند کلبه (KOLBE) یا تأمین‌کننده (SUPPLIER) باشد.
 * کلبه می‌تواند خرده و عمده بفروشد، تأمین‌کننده فقط عمده.
 */
export const SELLER_TYPES = ["KOLBE", "SUPPLIER"] as const;

/**
 * چرخهٔ عمر محصول کانونیکال و پیشنهاد فروشنده.
 * DRAFT → PENDING_REVIEW → APPROVED → PUBLISHED → SUSPENDED → ARCHIVED
 * هیچ ادغام خودکار بدون تأیید ادمین انجام نمی‌شود.
 */
export const PRODUCT_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "published",
  "suspended",
  "archived",
] as const;

export const OFFER_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "published",
  "suspended",
  "archived",
] as const;

export const PRODUCT_VARIANT_STATUSES = ["draft", "active", "archived"] as const;
export const SUPPLIER_PRODUCT_SUBMISSION_STATUSES = [
  "draft",
  "pending_review",
  "approved_new_product",
  "approved_existing_product",
  "rejected",
  "cancelled",
] as const;

/**
 * انواع بسته‌بندی عمده — generic، نه فقط پوشاک.
 * SIZE_RUN: سری سایز (S:2, M:2, L:2)
 * FIXED_QUANTITY: تعداد ثابت
 * COLOR_MIX: ترکیب رنگ
 * CUSTOM_BUNDLE: بستهٔ سفارشی
 */
export const PACKAGE_TYPES = ["SIZE_RUN", "FIXED_QUANTITY", "COLOR_MIX", "CUSTOM_BUNDLE"] as const;

/**
 * واحدهای MOQ — قطعه، بسته، سری، جعبه، کارتن، ست
 */
export const MOQ_UNITS = ["PIECE", "PACKAGE", "SERIES", "BOX", "CARTON", "SET"] as const;

/**
 * برند — تأیید و وضعیت
 */
export const BRAND_VERIFICATION_STATUSES = ["pending", "approved", "rejected"] as const;
export const BRAND_STATUSES = ["active", "suspended", "archived"] as const;

/**
 * دسته‌بندی — وضعیت
 */
export const CATEGORY_STATUSES = ["active", "archived"] as const;

/**
 * صف تطبیق محصول — تأمین‌کننده محصول پیش‌نویس می‌سازد، موتور تطبیق پیشنهاد می‌دهد، ادمین تأیید می‌کند
 */
export const PRODUCT_MATCH_STATUSES = ["pending", "approved", "rejected"] as const;

/**
 * نقش‌های اعضای شرکت تأمین‌کننده
 */
export const SUPPLIER_MEMBER_ROLES = ["owner", "sales", "warehouse", "finance"] as const;

/**
 * اقدامات قابل تنظیم برای نیاز به تأیید ادمین
 */
export const SUPPLIER_PERMISSION_ACTIONS = [
  "create_product",
  "change_images",
  "change_description",
  "add_variant",
  "change_category",
  "change_price",
] as const;

/**
 * پلن‌های VIP — وضعیت
 */
export const VIP_PLAN_STATUSES = ["active", "archived"] as const;
export const VIP_SUBSCRIPTION_STATUSES = ["pending", "active", "expired", "suspended"] as const;

/**
 * درخواست عمده — VIP محصول را انتخاب می‌کند، تأمین‌کننده بررسی می‌کند
 * Phase 4.4 — added revision_requested, cancelled, expired
 */
export const WHOLESALE_REQUEST_STATUSES = [
  "pending",
  "supplier_review",
  "revision_requested",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
  "ordered",
] as const;

/**
 * امتیازدهی — محصول، تأمین‌کننده، تراکنش
 */
export const RATING_STATUSES = ["visible", "hidden", "flagged"] as const;

/**
 * ── فاز ۳.۵ — موجودی و رزرو ───────────────────────────────────────────────
 * موجودی در سطح واریانت، مالکیت تأمین‌کننده، رزرو با انقضا، دفتر کل موجودی
 */
export const INVENTORY_RESERVATION_STATUSES = [
  "pending",
  "active",
  "released",
  "confirmed",
  "expired",
  "cancelled",
] as const;

export const INVENTORY_LEDGER_CHANGE_TYPES = [
  "INCREASE",
  "DECREASE",
  "RESERVE",
  "RELEASE",
  "ADJUSTMENT",
] as const;

export const VARIANT_INVENTORY_STATUS = ["active", "archived"] as const;

/**
 * ── فاز ۴.۱ — Idempotency ─────────────────────────────────────────────────
 * command_idempotency برای تمام دامنه‌های حساس: موجودی، سفارش، درخواست عمده
 */
export const COMMAND_IDEMPOTENCY_STATES = ["pending", "completed", "failed"] as const;
export const COMMAND_TYPES = [
  "inventory.reserve",
  "inventory.reserve_package",
  "inventory.release",
  "inventory.confirm",
  "inventory.adjust",
  "inventory.expire_batch",
  "inventory.confirm_child",
  "inventory.release_child",
  "vip.request_revision",
  "vip.revision_response",
  "vip.request_reject",
  "vip.request_cancel",
  "vip.request_expire",
  "vip.create_replacement",
  "orders.child_confirm",
  "orders.child_prepare",
  "orders.child_ready",
  "orders.child_dispatch",
  "orders.child_deliver",
  "orders.child_cancel",
  "orders.parent_cancel",
  "orders.confirm",
  "orders.payment_gate",
  "orders.processing_release",
  "fulfillment.report_exception",
  "fulfillment.resolve_exception",
  "fulfillment.link_replacement",
  "admin.wholesale_cancel",
  "admin.exception_resolve",
  "payments.issue_proforma",
  "payments.submit_transfer",
  "payments.verify",
  "payments.reject",
  "payments.allocate",
  "finance.credit_approve",
  "finance.cod_approve",
  "finance.manual_release",
  "finance.release",
  "refunds.create",
  "refunds.approve",
  "refunds.complete",
  "refunds.fail",
  "refunds.cancel",
  "payments.create_online_intent",
  "payments.provider_callback",
  "payments.provider_webhook",
  "payments.reconcile",
  "payments.refund_provider",
  "shipping.quote_create",
  "shipping.quote_select",
  "shipping.shipment_create",
  "shipping.shipment_handoff",
  "shipping.shipment_tracking",
  "shipping.shipment_deliver",
  "shipping.shipment_cancel",
  "shipping.reconcile",
] as const;

/** Phase 4.6 — Wholesale Finance */
export const WHOLESALE_PROFORMA_STATUSES = ["draft", "issued", "superseded", "voided"] as const;
export const PAYMENT_STATUSES = ["pending", "evidence_submitted", "verified", "failed", "cancelled"] as const;
/** Phase 4.7.1 — `online` = provider-driven (gateway) payment; the Phase 4.7 intent path wrote it without the CHECK allowing it. */
export const PAYMENT_METHODS = ["manual_transfer", "bank_transfer", "transfer", "credit", "cod", "on_delivery", "manual_authorized", "online"] as const;
export const REFUND_STATUSES = ["requested", "approved", "processing", "completed", "failed", "cancelled"] as const;
export const FINANCIAL_RELEASE_TYPES = ["payment_verified", "credit_approved", "cod_policy_approved", "manual_authorized_release"] as const;
export const FINANCIAL_LEDGER_ENTRY_TYPES = ["payment_verified", "refund_completed", "adjustment", "credit_release", "cod_release"] as const;
export const FINANCIAL_LEDGER_DIRECTIONS = ["IN", "OUT"] as const;
export const PAYMENT_ALLOCATION_STATUS = ["active", "voided"] as const;

/** Phase 4.7 — Provider-ready Payment & Shipping */
export const PAYMENT_PROVIDER_NAMES = ["manual", "fake"] as const;
export const PAYMENT_PROVIDER_MODES = ["disabled", "fake", "sandbox", "live"] as const;
export const PAYMENT_PROVIDER_EVENT_STATUSES = ["received", "processing", "processed", "ignored", "failed"] as const;
export const PAYMENT_PROVIDER_EVENT_TYPES = [
  "payment.created",
  "payment.pending",
  "payment.success",
  "payment.failed",
  "payment.cancelled",
  "refund.created",
  "refund.success",
  "refund.failed",
  "unknown",
] as const;
export const SHIPPING_PROVIDER_NAMES = ["manual", "fake"] as const;
export const SHIPPING_QUOTE_STATUSES = ["active", "selected", "expired", "voided"] as const;
export const SHIPMENT_STATUSES = ["pending", "ready", "handed_over", "in_transit", "delivered", "cancelled", "failed"] as const;
export const SHIPMENT_EVENT_STATUSES = ["received", "processing", "processed", "ignored", "failed"] as const;
export const SHIPMENT_EVENT_TYPES = [
  "quote.created",
  "quote.expired",
  "shipment.created",
  "shipment.ready",
  "shipment.handed_over",
  "shipment.in_transit",
  "shipment.delivered",
  "shipment.cancelled",
  "shipment.failed",
  "unknown",
] as const;

export const PAYMENT_PROVIDER_REFUND_SUPPORT = ["supported", "unsupported", "pending", "completed", "failed"] as const;

/**
 * وضعیت تأمین‌کننده و درخواست تأمین‌کننده.
 * شاهد: `INSERT INTO supplier … 'approved'` در تأیید درخواست، و مدل خواندنی
 * فرانت‌اند (`storefront/lib/wholesaleApi.ts`) که همین چهار مقدار را برای
 * `AdminSupplier.status` و `AdminSupplierApplication.status` اعلام می‌کند.
 */
export const SUPPLIER_STATUSES = ["pending", "reviewing", "approved", "rejected"] as const;
export const SUPPLIER_APPLICATION_STATUSES = ["pending", "reviewing", "approved", "rejected"] as const;

/**
 * وضعیت حساب عمده/VIP.
 * شاهد: اعتبارسنجی صریح سرور در `admin/wholesale-accounts/…`:
 * `["pending","approved","rejected","suspended","expired"]`.
 */
export const WHOLESALE_ACCOUNT_STATUSES = ["pending", "approved", "rejected", "suspended", "expired"] as const;

/**
 * وضعیت RFQ و پیشنهاد قیمت.
 * شاهد: `rfq` با پیش‌فرض `open` ساخته می‌شود و تنها گذار موجود در کد
 * `UPDATE rfq SET status='quoted'` است (ثبت پیشنهاد قیمت توسط تأمین‌کننده).
 * `quote.status` امروز فقط با پیش‌فرض `submitted` نوشته می‌شود و هیچ گذاری در کد
 * ندارد؛ پس مجموعهٔ مجاز همان یک مقدار است. افزودن وضعیت‌های تازه (مثلاً
 * «پذیرفته/ردشده») بخشی از فاز ۳ (دامنهٔ `offers`) است و باید با مهاجرت بیاید.
 */
export const RFQ_STATUSES = ["open", "quoted"] as const;
export const QUOTE_STATUSES = ["submitted"] as const;

/**
 * وضعیت و اولویت تیکت پشتیبانی.
 * شاهد: `INSERT INTO support_ticket (…) priority` با اعتبارسنجی سرور
 * `["low","normal","high"]`، و مدل خواندنی فرانت‌اند که وضعیت را به
 * «باز / پاسخ داده شده / بسته» نگاشت می‌کند.
 */
export const SUPPORT_TICKET_STATUSES = ["open", "answered", "closed"] as const;
export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high"] as const;

/**
 * وضعیت پرداخت سفارش خرده‌فروشی — مجموعهٔ اصلاح D19a.
 *
 * قاعدهٔ D19a: تا وقتی دامنهٔ پرداخت وجود ندارد، هیچ سفارشی «پرداخت‌شده» علامت
 * نمی‌خورد. تنها دو مقدار ممکن است:
 *   - `unpaid`      : هیچ پولی دریافت نشده و تسویه دستی لازم است (کارت/اقساط/کیف پول).
 *   - `pending_cod` : پرداخت در محل هنگام تحویل.
 *
 * مقدار تاریخی `pending_gateway` در همان مهاجرت گام ۱.۲ به `unpaid` تبدیل می‌شود
 * (بدهی N4) و پیش‌فرض ستون هم `unpaid` می‌شود تا هیچ ردیفی با پیش‌فرض گمراه‌کننده
 * ساخته نشود. افزودن وضعیت‌های پرداخت واقعی (captured/refunded…) کار فاز ۵ است و
 * با همان مهاجرت خواهد آمد.
 */
export const RETAIL_PAYMENT_STATUSES = ["unpaid", "pending_cod"] as const;

/**
 * روش‌های پرداخت خرده‌فروشی و عمده.
 * شاهد: `RETAIL_PAYMENT_METHODS` در `frontend-next/server/retail-pricing.ts` و
 * نگهبان `assertPaymentMethodAllowed` (BNPL فقط خرده‌فروشی).
 */
export const RETAIL_PAYMENT_METHODS = ["gateway", "installment", "cod", "wallet"] as const;
export const WHOLESALE_PAYMENT_METHODS = ["transfer", "cod"] as const;

/** روش‌های ارسال. شاهد: `SHIPPING_METHODS` در `retail-pricing.ts`. */
export const SHIPPING_METHOD_IDS = ["post", "pishtaz", "tipax"] as const;

/** واحد پول. شاهد: پیش‌فرض و تنها مقدار نوشته‌شده در `retail_order`/`purchase_order`. */
export const CURRENCIES = ["IRR"] as const;

/**
 * سقف مبلغ — همان `MAX_MONEY` دامنهٔ پول (`@kolbe/shared`، ۱۰۰۰ میلیارد ریال).
 * قید دیتابیس همان مقدار و همان واحد را تحمیل می‌کند تا اشتباه واحد (ریال/تومان)
 * و سرریز در سطح داده گرفته شود.
 */
export const MAX_MONEY_RIAL: bigint = MAX_MONEY;

/** ماشین‌های حالت مشترک، بازصادرشده برای قیدهای CHECK. */
export const WHOLESALE_ORDER_STATUS_VALUES = WHOLESALE_ORDER_STATUSES;
/** `purchase_order` همان «سفارش فرزند تأمین‌کننده» است (ADR-004). */
export const PURCHASE_ORDER_STATUS_VALUES = CHILD_ORDER_STATUSES;
export const RETAIL_ORDER_STATUS_VALUES = RETAIL_ORDER_STATUSES;

/** Phase 4.2 — مسئولیت حمل در سفارش فرزند */
export const SHIPPING_RESPONSIBILITIES = ["SUPPLIER", "KOLBE", "EXTERNAL_CARRIER"] as const;

/** Phase 4.2 — حالت‌های پرداخت عمده (payment_mode) */
export const WHOLESALE_PAYMENT_MODES = ["prepaid", "credit", "on_delivery", "transfer", "cod"] as const;

/** Phase 4.2 — واحد قیمت‌گذاری خط سفارش */
export const PRICING_UNITS = ["PIECE", "PACKAGE", "SERIES", "BOX", "CARTON", "SET", "PER_PIECE"] as const;

/** Phase 4.2 — انواع رویداد سفارش + Phase 4.4/4.5 extensions */
export const ORDER_EVENT_TYPES = [
  "order.created",
  "order.confirmed",
  "order.payment_gated",
  "order.processing_started",
  "order.fulfillment_started",
  "order.shipped",
  "order.completed",
  "order.cancelled",
  "order.parent_cancelled",
  "child.created",
  "child.confirmed",
  "child.preparing",
  "child.ready",
  "child.shipped",
  "child.delivered",
  "child.cancelled",
  "child.exception_opened",
  "child.exception_resolved",
  "child.replacement_requested",
  "request.converted",
  "request.revision_requested",
  "request.revision_accepted",
  "request.rejected",
  "request.cancelled",
  "request.expired",
  "request.replacement_created",
  "fulfillment.replacement_linked",
  "fulfillment.replacement_requested",
  "inventory.reserved",
  "inventory.released",
  "inventory.consumed",
  "proforma.issued",
  "proforma.superseded",
  "proforma.voided",
  "payment.evidence_submitted",
  "payment.verified",
  "payment.failed",
  "payment.allocated",
  "payment.overpaid",
  "financial.release_created",
  "refund.requested",
  "refund.approved",
  "refund.completed",
  "refund.failed",
  "refund.cancelled",
  "payment.provider_intent_created",
  "payment.provider_callback_received",
  "payment.provider_webhook_received",
  "payment.provider_verified",
  "payment.reconciled",
  "shipping.quote_created",
  "shipping.quote_selected",
  "shipping.quote_expired",
  "shipping.shipment_created",
  "shipping.shipment_ready",
  "shipping.shipment_handed_over",
  "shipping.shipment_in_transit",
  "shipping.shipment_delivered",
  "shipping.shipment_cancelled",
  "shipping.shipment_failed",
] as const;

/** Phase 4.2 — نقش عامل در تاریخچه/رویداد */
export const ORDER_ACTOR_ROLES = ["buyer", "admin", "supplier", "system", "fulfillment"] as const;

/** Phase 4.2 — انواع aggregate برای order_event */
export const ORDER_AGGREGATE_TYPES = ["wholesale_order", "purchase_order"] as const;

/** Phase 4.2 — ترکیب همه وضعیت‌های سفارش برای تاریخچه (یکتا) */
export const ALL_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "awaiting_payment",
  "processing",
  "fulfillment",
  "shipped",
  "completed",
  "cancelled",
  "pending",
  "preparing",
  "delivered",
] as const;

/** Phase 4.4 — Wholesale request revision buyer response */
export const WHOLESALE_REVISION_BUYER_RESPONSES = ["accepted", "rejected"] as const;

/** Phase 4.4 — Fulfillment exception types */
export const FULFILLMENT_EXCEPTION_TYPES = [
  "cannot_fulfill",
  "partial_shortage",
  "package_unavailable",
  "operational_failure",
] as const;

export const FULFILLMENT_EXCEPTION_STATUSES = [
  "open",
  "awaiting_buyer",
  "replacement_requested",
  "resolved",
  "cancelled",
] as const;

export const FULFILLMENT_EXCEPTION_BUYER_RESOLUTIONS = [
  "replacement_requested",
  "quantity_reduction",
  "cancel_portion",
] as const;

/** Phase 4.4 — extended order event types for revision and fulfillment */
export const ORDER_EVENT_TYPES_44 = [
  "request.revision_requested",
  "request.revision_accepted",
  "request.rejected",
  "request.cancelled",
  "request.expired",
  "child.confirmed",
  "child.preparing",
  "child.ready",
  "child.exception_opened",
  "child.exception_resolved",
  "child.cancelled",
  "child.shipped",
  "child.delivered",
  "inventory.released",
  "inventory.consumed",
] as const;
