/**
 * ماشین‌های حالت دامنه.
 *
 * قاعدهٔ حاکم (PROMPT 0): «Do not directly overwrite state-machine statuses.
 * All critical transitions must be validated server-side.»
 *
 * چرا اینجا و نه در دیتابیس/کنترلر؟ چون گذارها یک **قانون دامنه** هستند، نه یک
 * جزئیات ذخیره‌سازی. بیرون‌کشیدن‌شان به یک تابع خالص باعث می‌شود:
 *   ۱) همهٔ سطح‌های API (فعلاً Next.js، بعداً NestJS) دقیقاً یک قاعده را اجرا کنند؛
 *   ۲) گذارهای مجاز با تست قابل اثبات باشند، نه با خواندن کد.
 *
 * الگوی سفارش‌ها (طبق تصمیم محصول):
 *   سفارش مشتری/VIP → Parent Order → Child Order به تفکیک تأمین‌کننده → Shipment
 * هر Supplier Order وضعیت تحقق، محموله‌ها و کد رهگیری مستقل دارد.
 */

export class TransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`INVALID_STATUS_TRANSITION: ${machine} ${from} → ${to}`);
    this.name = "TransitionError";
  }
}

export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/** گذار مجاز است؟ */
export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  if (from === to) return false;
  return (table[from] ?? []).includes(to);
}

/** گذار را اعتبارسنجی می‌کند و در غیر این صورت خطا می‌دهد (۴۰۹ در لایهٔ HTTP). */
export function assertTransition<S extends string>(
  machine: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (from === to) return; // بی‌اثر: نوشتن مجدد همان وضعیت خطا نیست، فقط تغییر نیست.
  if (!canTransition(table, from, to)) throw new TransitionError(machine, from, to);
}

/** وضعیت‌های پایانی: هیچ گذاری از آن‌ها بیرون نمی‌رود. */
export function isTerminal<S extends string>(table: TransitionTable<S>, status: S): boolean {
  return (table[status] ?? []).length === 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   چرخهٔ سفارش عمده (Parent Order) — Phase 4.2 canonical per status-machines.md
   draft → confirmed → awaiting_payment → processing → fulfillment → shipped → completed
   cancelled از draft/confirmed/awaiting_payment/processing/fulfillment مجاز است.
   این چرخه با سند منجمد status-machines.md همگام است؛ مقدارهای قدیمی
   pending/approved/fulfilling/fulfilled به draft/confirmed/fulfillment/completed نگاشت می‌شوند.
   ──────────────────────────────────────────────────────────────────────────── */
export const WHOLESALE_ORDER_STATUSES = [
  "draft",
  "confirmed",
  "awaiting_payment",
  "processing",
  "fulfillment",
  "shipped",
  "completed",
  "cancelled",
] as const;
export type WholesaleOrderStatus = (typeof WHOLESALE_ORDER_STATUSES)[number];

export const WHOLESALE_ORDER_TRANSITIONS: TransitionTable<WholesaleOrderStatus> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["awaiting_payment", "processing", "cancelled"],
  awaiting_payment: ["processing", "cancelled"],
  processing: ["fulfillment", "cancelled"],
  fulfillment: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

/* ─────────────────────────────────────────────────────────────────────────────
   چرخهٔ سفارش فرزند (تأمین‌کننده) — همان Purchase Order فعلی
   ──────────────────────────────────────────────────────────────────────────── */
export const CHILD_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type ChildOrderStatus = (typeof CHILD_ORDER_STATUSES)[number];

export const CHILD_ORDER_TRANSITIONS: TransitionTable<ChildOrderStatus> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

/** پیش‌شرط‌های گذار: بدون کد رهگیری، ارسال ثبت نمی‌شود. */
export function childOrderTransitionRequirements(
  to: ChildOrderStatus,
  context: { trackingCode?: string | null },
): string[] {
  const missing: string[] = [];
  if (to === "shipped" && !context.trackingCode?.trim()) missing.push("TRACKING_CODE_REQUIRED");
  return missing;
}

/* ─────────────────────────────────────────────────────────────────────────────
   سفارش خرده‌فروشی
   placed → confirmed → packed → shipped → delivered
   ──────────────────────────────────────────────────────────────────────────── */
export const RETAIL_ORDER_STATUSES = [
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;
export type RetailOrderStatus = (typeof RETAIL_ORDER_STATUSES)[number];

export const RETAIL_ORDER_TRANSITIONS: TransitionTable<RetailOrderStatus> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

/* ─────────────────────────────────────────────────────────────────────────────
   Phase 5.9-B — مرجوعی خرده‌فروشی (first-class return aggregate)
   REQUESTED → APPROVED → RECEIVED → INSPECTED → RESTOCKED
   received ≠ inspected ≠ restocked; WITHDRAWN is customer-only (enforced by
   the withdrawing seam, not by this table alone).
   ──────────────────────────────────────────────────────────────────────────── */
export const RETAIL_RETURN_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "RECEIVED",
  "INSPECTED",
  "RESTOCKED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type RetailReturnStatus = (typeof RETAIL_RETURN_STATUSES)[number];

export const RETAIL_RETURN_TRANSITIONS: TransitionTable<RetailReturnStatus> = {
  REQUESTED: ["APPROVED", "REJECTED", "WITHDRAWN"],
  APPROVED: ["RECEIVED", "REJECTED", "WITHDRAWN"],
  RECEIVED: ["INSPECTED"],
  INSPECTED: ["RESTOCKED", "REJECTED"],
  RESTOCKED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/** Customer-facing return reasons (filing-time, immutable). */
export const RETAIL_RETURN_REASONS = [
  "DAMAGED",
  "WRONG_ITEM",
  "SIZE_FIT",
  "QUALITY_ISSUE",
  "CHANGED_MIND",
  "OTHER",
] as const;
export type RetailReturnReason = (typeof RETAIL_RETURN_REASONS)[number];

/** Staff inspection decisions; only RESTOCKABLE may proceed to RESTOCKED. */
export const RETAIL_INSPECTION_DECISIONS = [
  "RESTOCKABLE",
  "DAMAGED",
  "INCOMPLETE",
  "NOT_AS_DESCRIBED",
] as const;
export type RetailInspectionDecision = (typeof RETAIL_INSPECTION_DECISIONS)[number];

/* ─────────────────────────────────────────────────────────────────────────────
   پرداخت — مستقل از سفارش (قاعدهٔ A11: دامنه‌های جدا)
   ──────────────────────────────────────────────────────────────────────────── */
export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "captured",
  "failed",
  "partially_refunded",
  "refunded",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TRANSITIONS: TransitionTable<PaymentStatus> = {
  pending: ["authorized", "captured", "failed", "cancelled"],
  authorized: ["captured", "cancelled", "failed"],
  captured: ["partially_refunded", "refunded"],
  failed: ["pending"],
  partially_refunded: ["refunded"],
  refunded: [],
  cancelled: [],
};

/* ─────────────────────────────────────────────────────────────────────────────
   محموله — یک سفارش فرزند می‌تواند چند محمولهٔ مستقل داشته باشد
   ──────────────────────────────────────────────────────────────────────────── */
export const SHIPMENT_STATUSES = [
  "pending",
  "label_created",
  "dispatched",
  "in_transit",
  "delivered",
  "failed",
  "returned",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TRANSITIONS: TransitionTable<ShipmentStatus> = {
  pending: ["label_created", "failed"],
  label_created: ["dispatched", "failed"],
  dispatched: ["in_transit", "failed"],
  in_transit: ["delivered", "failed", "returned"],
  delivered: ["returned"],
  failed: ["pending", "returned"],
  returned: [],
};

/* ─────────────────────────────────────────────────────────────────────────────
   تسویه و برداشت (خزانهٔ تأمین‌کننده)
   ──────────────────────────────────────────────────────────────────────────── */
export const SETTLEMENT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
  "reversed",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_TRANSITIONS: TransitionTable<SettlementStatus> = {
  draft: ["pending_approval", "rejected"],
  pending_approval: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  paid: ["reversed"],
  rejected: [],
  reversed: [],
};

export const WITHDRAWAL_STATUSES = [
  "requested",
  "approved",
  "processing",
  "paid",
  "rejected",
  "cancelled",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_TRANSITIONS: TransitionTable<WithdrawalStatus> = {
  requested: ["approved", "rejected", "cancelled"],
  approved: ["processing", "rejected", "cancelled"],
  processing: ["paid", "rejected"],
  paid: [],
  rejected: [],
  cancelled: [],
};

/** نگاشت نام ماشین به جدول گذار — برای استفادهٔ عمومی در سرویس‌ها و تست‌ها. */
export const STATE_MACHINES = {
  wholesale_order: WHOLESALE_ORDER_TRANSITIONS,
  child_order: CHILD_ORDER_TRANSITIONS,
  retail_order: RETAIL_ORDER_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  shipment: SHIPMENT_TRANSITIONS,
  settlement: SETTLEMENT_TRANSITIONS,
  withdrawal: WITHDRAWAL_TRANSITIONS,
} as const;

export type StateMachineName = keyof typeof STATE_MACHINES;
