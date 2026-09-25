/**
 * helpersِ نمایشیِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * اینجا فقط «نمایش» است: برچسبِ فارسیِ وضعیت‌ها، قالب‌بندیِ پول/تاریخ/مقدار و
 * لحنِ رنگ. هیچ مقداری اینجا ساخته یا تغییر نمی‌کند — به‌ویژه:
 *
 *  - پول فقط با `@shared/money` قالب‌بندی می‌شود (رشتهٔ ده‌دهی، بدون float)؛
 *  - وضعیتِ سفارش صرفاً یک «راهنماییِ UX» است؛ مرجعِ انتقال‌ها سرور است.
 */

import { formatMoney, type MoneyString } from "../money/money";
import { formatQuantity } from "../money/quantity";
import type {
  ChildOrderStatus,
  OrderTransition,
  ProductionJobStatus,
  RfqStatus,
  SupplierSubmissionStatus,
  WithdrawalStatus,
} from "./contracts";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/* ── وضعیت‌ها ──────────────────────────────────────────────────────────────── */

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "در انتظار تأیید",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  ready: "آمادهٔ ارسال",
  shipped: "ارسال شده",
  delivered: "تحویل شده",
  cancelled: "لغو شده",
};

const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  submitted: "در بررسی",
  pending_review: "در بررسی",
  approved: "تأیید شده",
  changes_requested: "نیازمند اصلاح",
  rejected: "رد شده",
};

const RFQ_STATUS_LABEL: Record<string, string> = {
  open: "نیازمند پیشنهاد",
  quoted: "پیشنهاد ارسال شد",
  awarded: "واگذار شد",
  closed: "بسته شده",
  cancelled: "لغو شده",
};

const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  requested: "در انتظار بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
  paid: "پرداخت شده",
  failed: "ناموفق",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  planned: "برنامه‌ریزی شده",
  in_progress: "در حال تولید",
  blocked: "متوقف",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
};

export function orderStatusLabel(status: ChildOrderStatus | null | undefined): string {
  if (!status) return "نامشخص";
  return ORDER_STATUS_LABEL[status] ?? status;
}

export function submissionStatusLabel(status: SupplierSubmissionStatus | null | undefined): string {
  if (!status) return "نامشخص";
  return SUBMISSION_STATUS_LABEL[status] ?? status;
}

export function rfqStatusLabel(status: RfqStatus | null | undefined): string {
  if (!status) return "نامشخص";
  return RFQ_STATUS_LABEL[status] ?? status;
}

export function withdrawalStatusLabel(status: WithdrawalStatus | null | undefined): string {
  if (!status) return "نامشخص";
  return WITHDRAWAL_STATUS_LABEL[status] ?? status;
}

export function jobStatusLabel(status: ProductionJobStatus | null | undefined): string {
  if (!status) return "نامشخص";
  return JOB_STATUS_LABEL[status] ?? status;
}

export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "approved":
    case "delivered":
    case "paid":
    case "completed":
    case "awarded":
      return "success";
    case "pending":
    case "submitted":
    case "pending_review":
    case "open":
    case "requested":
    case "planned":
    case "ready":
      return "info";
    case "preparing":
    case "in_progress":
    case "changes_requested":
    case "quoted":
      return "warning";
    case "rejected":
    case "cancelled":
    case "failed":
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

/* ── پول و مقدار ──────────────────────────────────────────────────────────── */

export function money(value: MoneyString | null | undefined, options?: { suffix?: string }): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value, { suffix: options?.suffix ?? " تومان" });
}

export function moneyPlain(value: MoneyString | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatMoney(value, { suffix: "" });
}

export function quantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatQuantity(String(value));
}

/* ── تاریخ ────────────────────────────────────────────────────────────────── */

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function intlFormat(value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions): string | null {
  const date = toDate(value);
  if (!date) return null;
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") {
    return date.toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat("fa-IR", options).format(date);
}

export function formatDate(value: string | number | Date | null | undefined): string {
  return intlFormat(value, { year: "numeric", month: "2-digit", day: "2-digit" }) ?? "—";
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  return (
    intlFormat(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) ?? "—"
  );
}

/* ── متفرقه ───────────────────────────────────────────────────────────────── */

export function initials(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "—";
}

export function reference(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "—";
}

/**
 * انتقال‌های پیشنهادیِ سفارش برای نمایشِ دکمه‌ها.
 * این فقط یک راهنماست: سرور می‌تواند با ۴۰۹/۴۲۲ پاسخ دهد و UI باید آن را نمایش دهد.
 */
export function suggestedOrderTransitions(status: ChildOrderStatus | null | undefined): OrderTransition[] {
  switch (status) {
    case "pending":
      return ["confirm", "cancel"];
    case "confirmed":
      return ["start-preparation", "cancel"];
    case "preparing":
      return ["ready", "cancel"];
    case "ready":
      return ["dispatch"];
    case "shipped":
      return ["deliver"];
    default:
      return [];
  }
}

export const ORDER_TRANSITION_LABEL: Record<string, string> = {
  confirm: "تأیید سفارش",
  "start-preparation": "شروع آماده‌سازی",
  ready: "آمادهٔ ارسال",
  dispatch: "ثبت ارسال",
  deliver: "ثبت تحویل",
  cancel: "لغو سفارش",
};

export function orderTransitionLabel(action: string): string {
  return ORDER_TRANSITION_LABEL[action] ?? action;
}

/** آیا این انتقال به ورودیِ اپراتور (مثل کد رهگیری) نیاز دارد؟ */
export function transitionRequiresTracking(action: string): boolean {
  return action === "dispatch";
}

export function transitionRequiresReason(action: string): boolean {
  return action === "cancel";
}
