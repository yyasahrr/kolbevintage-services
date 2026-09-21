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

/* ───────────────────────── Phase 4.7.5 — Legal, compliance, privacy & tax readiness ───────────────────────── */

/** Versioned legal/policy document types. Not every type is mandatory for every actor. */
export const LEGAL_POLICY_TYPES = [
  "TERMS_OF_SERVICE",
  "PRIVACY_POLICY",
  "RETAIL_RETURN_POLICY",
  "WHOLESALE_TERMS",
  "SUPPLIER_AGREEMENT",
  "MARKETING_NOTICE",
  "COOKIE_NOTICE",
] as const;
export const LEGAL_POLICY_SCOPES = ["RETAIL", "WHOLESALE_VIP", "SUPPLIER", "PUBLIC"] as const;
export const LEGAL_POLICY_STATUSES = ["draft", "published", "retired"] as const;
export const LEGAL_ACCEPTANCE_SUBJECT_TYPES = ["user", "guest", "supplier_member"] as const;
export const LEGAL_ACCEPTANCE_CONTEXTS = ["registration", "portal", "checkout", "wholesale_confirm", "supplier_onboarding", "api"] as const;
export const CONSENT_PURPOSES = ["MARKETING_EMAIL", "MARKETING_SMS", "MARKETING_PUSH", "PERSONALIZATION"] as const;
export const CONSENT_EVENT_TYPES = ["granted", "withdrawn"] as const;
export const CONSENT_SOURCES = ["portal", "checkout", "account_settings", "admin", "api"] as const;
export const BUSINESS_ENTITY_TYPES = ["individual", "company", "cooperative", "other"] as const;
export const BUSINESS_CREDENTIAL_TYPES = ["ENAMAD", "BUSINESS_LICENSE", "TAX_REGISTRATION", "INDUSTRY_LICENSE", "OTHER"] as const;
export const BUSINESS_CREDENTIAL_STATUSES = ["unverified", "verified", "expired", "revoked"] as const;
export const SUPPLIER_COMPLIANCE_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "suspended", "expired"] as const;
export const SUPPLIER_COMPLIANCE_REVIEW_DECISIONS = ["under_review", "needs_information", "approved", "rejected", "suspended", "reinstated", "expired"] as const;
export const REPRESENTATIVE_AUTHORITY_STATUSES = ["unverified", "declared", "verified"] as const;
export const COMPLIANCE_DOCUMENT_TYPES = [
  "business_license",
  "tax_certificate",
  "registration_certificate",
  "representative_authorization",
  "identity_document",
  "bank_document",
  "purchase_invoice",
  "import_document",
  "conformity_certificate",
  "authenticity_proof",
  "other",
] as const;
export const COMPLIANCE_DOCUMENT_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export const COMPLIANCE_DOCUMENT_SCAN_STATUSES = ["pending", "clean", "rejected", "unavailable"] as const;
export const COMPLIANCE_STORAGE_PROVIDERS = ["local_private", "s3_private"] as const;
export const COMPLIANCE_HOLD_REASON_CODES = ["kyb_incomplete", "document_rejected", "fraud_suspected", "legal_request", "manual_review", "other"] as const;
export const HOLD_STATUSES = ["active", "released"] as const;
export const BANK_DESTINATION_KINDS = ["iban", "card", "account"] as const;
export const BANK_VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;
export const HOLDER_MATCH_STATUSES = ["unknown", "matched", "mismatched"] as const;
export const PRODUCT_ORIGIN_TYPES = ["domestic", "imported", "mixed", "unknown"] as const;
export const PRODUCT_CONDITION_CLASSES = ["new", "used", "vintage", "refurbished", "unknown"] as const;
export const PRODUCT_COMPLIANCE_STATUSES = ["unknown", "pending_review", "verified", "rejected", "restricted"] as const;
export const RETENTION_ACTIONS = ["review", "anonymize", "delete", "retain"] as const;
export const RETENTION_POLICY_STATUSES = ["draft", "active", "retired"] as const;
export const LEGAL_VERIFICATION_STATUSES = ["NEEDS_LEGAL_VERIFICATION", "VERIFIED"] as const;
export const DATA_SUBJECT_REQUEST_TYPES = ["access", "correction", "deletion", "restriction"] as const;
export const DATA_SUBJECT_REQUEST_STATUSES = [
  "submitted",
  "identity_verification_required",
  "under_review",
  "approved",
  "rejected",
  "processing",
  "completed",
] as const;
export const LEGAL_HOLD_SCOPE_TYPES = ["user", "supplier", "wholesale_order", "retail_order", "payment", "product", "other"] as const;
export const TRANSACTION_SNAPSHOT_SCOPES = ["RETAIL", "WHOLESALE", "SUPPLIER"] as const;
export const COMMERCIAL_INVOICE_SCOPES = ["retail", "wholesale"] as const;
export const COMMERCIAL_INVOICE_STATUSES = ["draft", "issued", "voided"] as const;
export const INVOICE_TAX_STATUSES = ["not_assessed", "exempt", "assessed"] as const;
export const FISCAL_DOCUMENT_STATUSES = ["draft", "ready", "submission_pending", "submitted", "accepted", "rejected", "cancelled"] as const;
export const FISCAL_EVENT_TYPES = ["prepare", "validate", "submit", "status_query", "cancel"] as const;
export const FISCAL_EVENT_OUTCOMES = ["ok", "rejected", "failed", "replayed"] as const;
export const TAX_CONFIG_REVIEW_STATUSES = ["NEEDS_TAX_ACCOUNTANT_REVIEW", "VERIFIED"] as const;
export const TAX_CONFIG_STATUSES = ["draft", "active", "retired"] as const;

// Phase 4.8 — Supplier Financial Account, Settlement & Payout
export const SETTLEMENT_ACCOUNT_TYPES = [
  "PLATFORM_COLLECTION_CLEARING",
  "SUPPLIER_PENDING_PAYABLE",
  "SUPPLIER_AVAILABLE_PAYABLE",
  "SUPPLIER_HOLD",
  "PAYOUT_CLEARING",
  "PLATFORM_FEE",
  "SUPPLIER_RECOVERY",
  "REFUND_CLEARING",
  "ROUNDING_RESIDUE",
  "ADJUSTMENT_CLEARING",
] as const;
export const SETTLEMENT_ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;

export const SETTLEMENT_JOURNAL_TYPES = [
  "FUNDS_HELD",
  "ENTITLEMENT",
  "COMMISSION",
  "AVAILABILITY",
  "HOLD_PLACED",
  "HOLD_RELEASED",
  "REFUND_ADJUSTMENT",
  "POST_SETTLEMENT_ADJUSTMENT",
  "WITHDRAWAL_RESERVED",
  "PAYOUT_SETTLED",
  "PAYOUT_REVERSED",
  "MANUAL_ADJUSTMENT",
  "RECOVERY_OFFSET",
] as const;

export const SETTLEMENT_SOURCE_EVENT_TYPES = [
  "ChildPaymentCovered",
  "ChildQuantityDelivered",
  "ChildQuantityRefunded",
  "SettlementBatchRelease",
  "FinancialHoldPlaced",
  "FinancialHoldReleased",
  "WithdrawalAccepted",
  "PayoutProviderResult",
  "AdminAdjustment",
] as const;

export const SETTLEMENT_POSTING_DIRECTIONS = ["DEBIT", "CREDIT"] as const;

export const COMMISSION_BASIS_TYPES = [
  "MERCHANDISE_ENTITLED_NET",
  "GROSS_ORDERED",
] as const;
export const COMMISSION_ROUNDING_MODES = ["HALF_UP", "DOWN"] as const;
export const COMMISSION_POLICY_STATUSES = ["active", "retired"] as const;

export const SHIPPING_ECONOMIC_RECIPIENTS = [
  "SUPPLIER",
  "KOLBE",
  "CARRIER_PASS_THROUGH",
  "NONE",
  "UNDEFINED",
] as const;
export const SHIPPING_COST_BEARERS = [
  "SUPPLIER",
  "KOLBE",
  "BUYER",
  "UNDEFINED",
] as const;
export const SHIPPING_ECONOMICS_STATUSES = ["draft", "finalized"] as const;

export const SETTLEMENT_HOLD_SCOPES = ["SUPPLIER", "CHILD_ORDER", "PAYOUT"] as const;
export const SETTLEMENT_HOLD_REASONS = [
  "RETURN_WINDOW",
  "REFUND_PENDING",
  "DISPUTE",
  "CHARGEBACK_RISK",
  "PROVIDER_UNCERTAINTY",
  "MANUAL_FINANCE_HOLD",
] as const;
export const SETTLEMENT_HOLD_STATUSES = ["active", "released"] as const;
export const SETTLEMENT_HOLD_POLICY_STATUSES = ["active", "retired"] as const;

export const SETTLEMENT_BATCH_STATUSES = [
  "draft",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export const SETTLEMENT_BATCH_ITEM_STATUSES = ["released"] as const;

export const WITHDRAWAL_REQUEST_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "cancelled",
  "converted_to_payout",
] as const;

export const PAYOUT_STATUSES = [
  "pending",
  "processing",
  "provider_pending",
  "succeeded",
  "failed",
  "reconciliation_required",
] as const;
export const PAYOUT_PROVIDERS = ["fake", "manual"] as const;
export const PAYOUT_PROVIDER_EVENT_TYPES = [
  "PAYOUT_COMPLETED",
  "PAYOUT_FAILED",
  "PAYOUT_REVERSED",
] as const;
export const PAYOUT_PROVIDER_EVENT_STATUSES = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
] as const;

export const SETTLEMENT_RECONCILIATION_TYPES = [
  "SETTLEMENT_PROJECTION",
  "PAYOUT_STATUS",
] as const;
export const SETTLEMENT_RECONCILIATION_STATUSES = [
  "running",
  "completed",
  "failed",
  "mismatch_detected",
] as const;

/* ── Phase 5.0 — Business Control Plane & Wholesale Plans ───────────────────── */

export const WHOLESALE_PLAN_STATUSES = ["draft", "active", "archived"] as const;
export const WHOLESALE_PLAN_VERSION_STATUSES = [
  "draft",
  "published",
  "superseded",
  "archived",
] as const;
export const WHOLESALE_PLAN_BILLING_PERIODS = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "custom",
] as const;
export const WHOLESALE_PLAN_FEATURE_TYPES = [
  "boolean",
  "limit",
  "config",
] as const;
export const WHOLESALE_PLAN_LIMIT_PERIODS = [
  "order",
  "day",
  "month",
  "year",
  "lifetime",
] as const;
export const WHOLESALE_PLAN_LIMIT_KEYS = [
  "min_order_amount",
  "max_order_amount",
  "max_monthly_order_amount",
  "max_order_units",
  "max_team_members",
  "max_shipping_addresses",
  "max_branches",
  "max_open_rfqs",
] as const;

export const WHOLESALE_MEMBERSHIP_STATUSES = [
  "pending",
  "active",
  "suspended",
  "expired",
  "cancelled",
  "scheduled_change",
] as const;
export const WHOLESALE_MEMBERSHIP_EVENT_TYPES = [
  "activated",
  "renewed",
  "upgraded",
  "downgraded",
  "plan_change_scheduled",
  "suspended",
  "resumed",
  "cancelled",
  "expired",
] as const;

/** Phase 5.4 — CMS content, publication and public media state machines. */
export const CMS_PAGE_TYPES = ["HOME", "STATIC", "LANDING", "EDITORIAL"] as const;
export type CmsPageType = (typeof CMS_PAGE_TYPES)[number];

export const CMS_PAGE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const CMS_REVISION_STATUSES = ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "SUPERSEDED", "ARCHIVED"] as const;
export type CmsRevisionStatus = (typeof CMS_REVISION_STATUSES)[number];

export const CMS_DOCUMENT_TYPES = [
  "HOME_CONFIGURATION",
  "HEADER_CONFIGURATION",
  "FOOTER_CONFIGURATION",
  "HERO_CONFIGURATION",
  "PROMOTIONAL_CONTENT_CONFIGURATION",
] as const;
export const CMS_DOCUMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const CMS_DOCUMENT_REVISION_STATUSES = CMS_REVISION_STATUSES;

export const CMS_NAVIGATION_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const CMS_TAXONOMY_KINDS = ["CATEGORY", "TAG"] as const;
export const CMS_TAXONOMY_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const CMS_MEDIA_PROVIDERS = ["LOCAL_PUBLIC"] as const;
export const CMS_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"] as const;
export const CMS_SCHEDULE_STATUSES = ["SCHEDULED", "PROCESSING", "EXECUTED", "CANCELLED", "FAILED"] as const;
export const CMS_SCHEDULE_TARGET_TYPES = ["PAGE_REVISION", "CONTENT_REVISION", "NAVIGATION_REVISION", "ARTICLE_REVISION"] as const;

export const ADMIN_PERMISSION_ACTIONS = [
  "wholesale:plan:view",
  "wholesale:plan:manage",
  "wholesale:membership:view",
  "wholesale:membership:manage",
  "wholesale:membership:override",
  "wholesale:approval:view",
  "wholesale:approval:create",
  "wholesale:approval:decide",
  "wholesale:settings:view",
  "wholesale:settings:manage",
  "wholesale:notes:view",
  "wholesale:notes:create",
  "wholesale:control_tower:view",
  "crm:customer:view",
  "crm:customer:manage",
  "crm:stage:manage",
  "crm:assign:manage",
  "crm:activity:create",
  "crm:task:manage",
  "crm:tag:manage",
  "crm:export",
  "crm:sensitive:view",
  "support:case:view",
  "support:case:reply",
  "support:case:assign",
  "support:case:priority",
  "support:case:resolve",
  "support:internal_note:create",
  "support:attachment:view",
  "support:sla:manage",
  "support:report:view",
  "support:sensitive:view",
  "notification:template:view",
  "notification:template:manage",
  "notification:outbox:view",
  "notification:outbox:retry",
  "notification:provider:view",
  "notification:preference:manage",
  "notification:report:view",
  // Phase 5.4 — CMS / Content Management
  "cms:content:view",
  "cms:content:create",
  "cms:content:edit",
  "cms:content:publish",
  "cms:content:archive",
  "cms:navigation:manage",
  "cms:media:manage",
  "cms:seo:manage",
  "cms:blog:manage",
  // Phase 5.5 — Analytics & Reporting (read-only bounded context)
  "analytics:dashboard:view",
  "analytics:report:view",
  "analytics:report:manage",
  "analytics:export",
  "analytics:reconciliation:view",
] as const;

/* ── Phase 5.1 — CRM & Customer Operations ──────────────────────────────────── */

export const CRM_STAGES = [
  "LEAD",
  "CONTACTED",
  "NEGOTIATION",
  "ACTIVE_CUSTOMER",
  "LOYAL",
  "CHURNED",
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export const CRM_LINK_TYPES = [
  "account_user",
  "wholesale_account",
] as const;
export type CrmLinkType = (typeof CRM_LINK_TYPES)[number];

export const CRM_STAGE_SOURCES = [
  "manual",
  "system_rule",
  "import",
] as const;
export type CrmStageSource = (typeof CRM_STAGE_SOURCES)[number];

export const CRM_ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "MESSAGE",
  "EMAIL",
  "MEETING",
  "SYSTEM",
] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export const CRM_ACTIVITY_SOURCES = [
  "MANUAL_ACTIVITY",
  "SYSTEM_EVENT",
  "PROVIDER_EVENT",
] as const;
export type CrmActivitySource = (typeof CRM_ACTIVITY_SOURCES)[number];

export const CRM_TASK_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

export const CRM_TASK_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type CrmTaskPriority = (typeof CRM_TASK_PRIORITIES)[number];

export const APPROVAL_REQUEST_TYPES = [
  "MEMBERSHIP_OVERRIDE",
  "MEMBERSHIP_PLAN_CHANGE",
  "PLAN_VERSION_PUBLISH",
  "BUSINESS_SETTING_CHANGE",
  "MEMBERSHIP_MANUAL_ACTIVATE",
  "MEMBERSHIP_TERMINATE",
] as const;
export const APPROVAL_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "cancelled",
] as const;

export const BUSINESS_SETTING_CATEGORIES = [
  "wholesale",
  "membership",
  "operations",
  "security",
  "financial",
] as const;

export const ADMIN_NOTE_TARGET_TYPES = [
  "wholesale_account",
  "wholesale_membership",
  "wholesale_order",
  "wholesale_request",
  "supplier",
] as const;

/* ── Phase 5.2 — Support / Ticket / Case Management ──────────────────────────── */

export const SUPPORT_REQUESTER_TYPES = [
  "RETAIL_CUSTOMER",
  "VIP_BUYER",
  "SUPPLIER",
  "ADMIN_CREATED",
] as const;
export type SupportRequesterType = (typeof SUPPORT_REQUESTER_TYPES)[number];

export const SUPPORT_CATEGORIES = [
  "ORDER",
  "PAYMENT",
  "SHIPPING",
  "RETURN",
  "REFUND",
  "MEMBERSHIP",
  "WHOLESALE",
  "SUPPLIER",
  "PRODUCT",
  "QUALITY",
  "CUSTOM_PRODUCTION",
  "FINANCE",
  "SETTLEMENT",
  "ACCOUNT",
  "OTHER",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_CASE_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_INTERNAL",
  "RESOLVED",
  "CLOSED",
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export const SUPPORT_SOURCES = [
  "PORTAL",
  "VIP_PORTAL",
  "SUPPLIER_PORTAL",
  "ADMIN_MANUAL",
  "EMAIL",
  "API",
] as const;
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

export const SUPPORT_TEAMS = [
  "RETAIL_SUPPORT",
  "VIP_SUPPORT",
  "SUPPLIER_OPERATIONS",
  "PAYMENTS",
  "SHIPPING",
  "FINANCE",
  "COMPLIANCE",
  "QUALITY",
] as const;
export type SupportTeam = (typeof SUPPORT_TEAMS)[number];

export const SUPPORT_RELATION_TYPES = [
  "ORDER",
  "ORDER_ITEM",
  "SHIPMENT",
  "PAYMENT",
  "REFUND",
  "WHOLESALE_REQUEST",
  "PURCHASE_ORDER",
  "SUPPLIER",
  "VIP_ACCOUNT",
  "CRM_CONTACT",
  "SETTLEMENT_WITHDRAWAL",
  "PAYOUT",
] as const;
export type SupportRelationType = (typeof SUPPORT_RELATION_TYPES)[number];

export const SUPPORT_AUTHOR_TYPES = [
  "CUSTOMER",
  "VIP_BUYER",
  "SUPPLIER",
  "ADMIN",
  "SYSTEM",
] as const;
export type SupportAuthorType = (typeof SUPPORT_AUTHOR_TYPES)[number];

export const SUPPORT_VISIBILITIES = [
  "PUBLIC",
  "INTERNAL",
] as const;
export type SupportVisibility = (typeof SUPPORT_VISIBILITIES)[number];

export const SUPPORT_ATTACHMENT_SCAN_STATUSES = [
  "PENDING_SCAN",
  "CLEAN",
  "SUSPICIOUS",
  "REJECTED",
] as const;
export type SupportAttachmentScanStatus = (typeof SUPPORT_ATTACHMENT_SCAN_STATUSES)[number];

export const SUPPORT_ESCALATION_SOURCES = [
  "MANUAL_ADMIN",
  "SLA_BREACH",
  "SYSTEM_RULE",
] as const;
export type SupportEscalationSource = (typeof SUPPORT_ESCALATION_SOURCES)[number];

export const SUPPORT_ACTION_TYPES = [
  "REFUND_REQUEST",
  "SHIPMENT_INVESTIGATION",
  "PAYMENT_RECONCILIATION",
  "COMPLIANCE_ESCALATION",
  "SUPPLIER_FINANCE_INVESTIGATION",
] as const;
export type SupportActionType = (typeof SUPPORT_ACTION_TYPES)[number];

export const SUPPORT_ACTION_STATUSES = [
  "REQUESTED",
  "IN_REVIEW",
  "EXECUTED",
  "REJECTED",
] as const;
export type SupportActionStatus = (typeof SUPPORT_ACTION_STATUSES)[number];

/* ── Phase 5.3 — Notifications & Messaging ──────────────────────────────────── */

export const NOTIFICATION_CHANNELS = [
  "IN_APP",
  "EMAIL",
  "SMS",
  "PUSH",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_RECIPIENT_TYPES = [
  "ACCOUNT_USER",
  "VIP_ACCOUNT_MEMBER",
  "SUPPLIER_MEMBER",
  "ADMIN_USER",
] as const;
export type NotificationRecipientType = (typeof NOTIFICATION_RECIPIENT_TYPES)[number];

export const NOTIFICATION_CATEGORIES = [
  "TRANSACTIONAL",
  "MARKETING",
  "OPERATIONAL",
  "SECURITY",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_TEMPLATE_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;
export type NotificationTemplateStatus = (typeof NOTIFICATION_TEMPLATE_STATUSES)[number];

export const NOTIFICATION_TEMPLATE_VERSION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export type NotificationTemplateVersionStatus = (typeof NOTIFICATION_TEMPLATE_VERSION_STATUSES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = [
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "SENT",
  "DELIVERED",
  "FAILED_RETRYABLE",
  "FAILED_PERMANENT",
  "SUPPRESSED",
  "CANCELLED",
] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_DELIVERY_ATTEMPT_STATUSES = [
  "SUCCESS",
  "RETRYABLE_ERROR",
  "PERMANENT_ERROR",
] as const;
export type NotificationDeliveryAttemptStatus = (typeof NOTIFICATION_DELIVERY_ATTEMPT_STATUSES)[number];

export const NOTIFICATION_PROVIDER_CONFIG_STATUSES = [
  "DISABLED",
  "MISSING_CONFIGURATION",
  "SANDBOX",
  "CONFIGURED",
  "PRODUCTION",
] as const;
export type NotificationProviderConfigStatus = (typeof NOTIFICATION_PROVIDER_CONFIG_STATUSES)[number];

export const NOTIFICATION_PROVIDER_EVENT_STATUSES = [
  "RECEIVED",
  "PROCESSED",
  "IGNORED",
  "FAILED",
] as const;
export type NotificationProviderEventStatus = (typeof NOTIFICATION_PROVIDER_EVENT_STATUSES)[number];

export const NOTIFICATION_EVENT_KEYS = [
  "AUTH_SECURITY_ALERT",
  "ORDER_CREATED",
  "ORDER_CONFIRMED",
  "ORDER_CANCELLED",
  "ORDER_FULFILLMENT_UPDATED",
  "SHIPMENT_CREATED",
  "SHIPMENT_SHIPPED",
  "SHIPMENT_DELIVERED",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "PAYMENT_FAILED",
  "REFUND_REQUESTED",
  "REFUND_COMPLETED",
  "VIP_MEMBERSHIP_ACTIVATED",
  "VIP_MEMBERSHIP_EXPIRING",
  "VIP_MEMBERSHIP_SUSPENDED",
  "SUPPLIER_ORDER_CREATED",
  "SUPPLIER_ORDER_ACTION_REQUIRED",
  "SUPPORT_CASE_CREATED",
  "SUPPORT_CASE_REPLIED",
  "SUPPORT_CASE_STATUS_CHANGED",
  "SETTLEMENT_AVAILABLE",
  "WITHDRAWAL_REQUESTED",
  "WITHDRAWAL_APPROVED",
  "PAYOUT_SUBMITTED",
  "PAYOUT_RECONCILIATION_REQUIRED",
  "COMPLIANCE_ACTION_REQUIRED",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];
/* ── Phase 5.5 — Analytics & Reporting ─────────────────────────────────────── */

export const ANALYTICS_SCOPES = [
  "PLATFORM",
  "RETAIL",
  "WHOLESALE",
  "SUPPLIER",
  "VIP_ACCOUNT",
] as const;
export type AnalyticsScope = (typeof ANALYTICS_SCOPES)[number];

export const ANALYTICS_REPORT_TYPES = ["METRIC_SET", "SAVED_REPORT"] as const;
export type AnalyticsReportType = (typeof ANALYTICS_REPORT_TYPES)[number];

export const ANALYTICS_REPORT_RUN_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export const ANALYTICS_EXPORT_FORMATS = ["CSV"] as const;
export const ANALYTICS_EXPORT_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"] as const;
export const ANALYTICS_SOURCE_MODES = ["AUTHORITATIVE_LIVE"] as const;

