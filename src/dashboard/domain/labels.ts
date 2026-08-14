import type {
  DisputeStatus,
  EscrowStatus,
  FulfillmentStatus,
  OrderStatus,
  SettlementStatus,
  ShipmentStatus,
  CustomerSegment,
  TimelineActor,
} from "./types";

export type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  created: "ایجاد شده",
  paid: "پرداخت شده",
  processing: "در حال پردازش",
  partially_fulfilled: "تأمین جزئی",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  inspection: "بازه بازرسی",
  completed: "تکمیل شده",
  disputed: "دارای اختلاف",
  cancelled: "لغو شده",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  created: "neutral",
  paid: "info",
  processing: "progress",
  partially_fulfilled: "progress",
  shipped: "info",
  delivered: "success",
  inspection: "warning",
  completed: "success",
  disputed: "danger",
  cancelled: "neutral",
};

export const FULFILLMENT_STATUS_LABEL: Record<FulfillmentStatus, string> = {
  requested: "درخواست شده",
  accepted: "پذیرفته شده",
  preparing: "در حال آماده‌سازی",
  ready_to_ship: "آماده ارسال",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  rejected: "رد شده",
  cancelled: "لغو شده",
};

export const FULFILLMENT_STATUS_TONE: Record<FulfillmentStatus, Tone> = {
  requested: "warning",
  accepted: "info",
  preparing: "progress",
  ready_to_ship: "progress",
  shipped: "info",
  delivered: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const ESCROW_STATUS_LABEL: Record<EscrowStatus, string> = {
  held: "نگهداری شده",
  frozen: "مسدود (اختلاف)",
  ready: "آماده تسویه",
  partially_released: "آزادسازی جزئی",
  released: "آزاد شده",
  refunded: "بازپرداخت شده",
};

export const ESCROW_STATUS_TONE: Record<EscrowStatus, Tone> = {
  held: "info",
  frozen: "danger",
  ready: "success",
  partially_released: "progress",
  released: "neutral",
  refunded: "warning",
};

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: "در انتظار",
  scheduled: "زمان‌بندی شده",
  processing: "در حال پرداخت",
  paid: "پرداخت شده",
  failed: "ناموفق",
  partially_paid: "پرداخت جزئی",
};

export const SETTLEMENT_STATUS_TONE: Record<SettlementStatus, Tone> = {
  pending: "warning",
  scheduled: "info",
  processing: "progress",
  paid: "success",
  failed: "danger",
  partially_paid: "progress",
};

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: "باز",
  waiting_customer: "منتظر مشتری",
  waiting_supplier: "منتظر تأمین‌کننده",
  under_review: "در حال بررسی",
  resolved: "حل شده",
};

export const DISPUTE_STATUS_TONE: Record<DisputeStatus, Tone> = {
  open: "danger",
  waiting_customer: "warning",
  waiting_supplier: "warning",
  under_review: "progress",
  resolved: "success",
};

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: "در انتظار",
  in_transit: "در مسیر",
  out_for_delivery: "در حال تحویل",
  delivered: "تحویل شده",
  delayed: "تأخیر",
};

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, Tone> = {
  pending: "neutral",
  in_transit: "info",
  out_for_delivery: "progress",
  delivered: "success",
  delayed: "danger",
};

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  new: "جدید",
  active: "فعال",
  high_value: "پرارزش",
  at_risk: "در معرض ریزش",
  dormant: "غیرفعال",
};

export const ACTOR_LABEL: Record<TimelineActor, string> = {
  customer: "مشتری",
  kolbe: "کلبه وینتیج",
  system: "سیستم",
  supplier: "تأمین‌کننده",
  finance: "مالی",
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  info: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
  progress:
    "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-900",
  success:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  warning:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
  danger:
    "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900",
};
