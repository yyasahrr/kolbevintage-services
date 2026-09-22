/**
 * قراردادهای ارسال خرده‌فروشی (Retail shipping) — فاز ۵.۸-C.
 *
 * چرا اینجا؟ نرخ‌های ارسال و چرخهٔ وضعیت مرسولهٔ خرده، مثل گذارهای سفارش،
 * **قانون دامنه** هستند نه جزئیات ذخیره‌سازی: هم صدور (Pricing) و هم اجرا
 * (Shipping) باید دقیقاً یک جدول را بخوانند. نسخهٔ جدول (`version`) در
 * `price_book_version` سفارش پین می‌شود تا هر تغییری روی قاعده‌ها، روی
 * تاریخچهٔ سفارش قابل مشاهده باشد.
 *
 * تفکیک آگاهانه از چرخهٔ عمده (`SHIPMENT_TRANSITIONS`): وضعیت‌های معتبر
 * ستون دیتابیس هفت‌تایی است
 * (pending/ready/handed_over/in_transit/delivered/cancelled/failed) و گذار
 * خرده فقط روی همین‌ها تعریف می‌شود؛ چرخهٔ عمده دست‌نخورده می‌ماند.
 */

import type { TransitionTable } from "./order-status";

/**
 * قواعد ارسال خرده — منتقل‌شده از `retail-pricing.service.ts` (مقادیر
 * بایت‌به‌بایت همان‌اند؛ فقط مالکیت به Shared منتقل شد تا Shipping هم
 * بدون وابستگی به Pricing همان جدول را بخواند).
 */
export const RETAIL_SHIPPING_RULES = {
  version: "retail-ship-v1",
  methods: { post: 59_000n, pishtaz: 89_000n, tipax: 145_000n } as Record<string, bigint>,
  freeThreshold: 3_000_000n,
} as const;

/** شناسه‌های معتبر روش ارسال خرده (کلیدهای جدول نرخ). */
export const RETAIL_SHIPPING_METHOD_IDS = ["post", "pishtaz", "tipax"] as const;
export type RetailShippingMethodId = (typeof RETAIL_SHIPPING_METHOD_IDS)[number];

/** وضعیت‌های مرسولهٔ خرده — دقیقاً برابر CHECK دیتابیس. */
export const RETAIL_SHIPMENT_STATUSES = [
  "pending",
  "ready",
  "handed_over",
  "in_transit",
  "delivered",
  "cancelled",
  "failed",
] as const;
export type RetailShipmentStatus = (typeof RETAIL_SHIPMENT_STATUSES)[number];

/**
 * چرخهٔ مرسولهٔ خرده:
 *   pending → ready → handed_over → in_transit → delivered
 *   pending/ready → cancelled (لغو پیش از تحویل به حامل)
 *   handed_over/in_transit → failed (استثنای عملیاتی پس از تحویل؛ برگشتی نیست)
 *   handed_over → delivered (حامل ممکن است اسکن میانی را رد کند؛ عمده هم همین را اجازه می‌دهد)
 *
 * آگاهانه **بدون پرش به عقب و بدون دورزدن تحویل**: حامل نمی‌تواند
 * مرسوله‌ای را که تحویلش ثبت نشده «در راه» اعلام کند
 * (handoff_not_recorded) و هیچ گذاری از وضعیت‌های پایانی بیرون نمی‌رود.
 */
export const RETAIL_SHIPMENT_TRANSITIONS: TransitionTable<RetailShipmentStatus> = {
  pending: ["ready", "cancelled"],
  ready: ["handed_over", "cancelled"],
  handed_over: ["in_transit", "delivered", "failed"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  cancelled: [],
  failed: [],
};

/** پیشوند کد مرسولهٔ خرده (`RSHP-<hash12>`) در برابر عمده (`SHP-<hash12>`). */
export const RETAIL_SHIPMENT_CODE_PREFIX = "RSHP";
