import { SLA } from "./generate";
import type {
  Commission,
  Dispute,
  DisputeResolution,
  EscrowStatus,
  FulfillmentRequest,
  Order,
  SettlementAdjustment,
  Shipment,
  SupplierSettlement,
  TimelineEvent,
  WholesaleDataset,
} from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type DashboardAction =
  | { type: "fulfillment/accept"; fulfillmentId: string }
  | { type: "fulfillment/reject"; fulfillmentId: string; reason?: string }
  | { type: "fulfillment/advance"; fulfillmentId: string }
  | { type: "fulfillment/reassign"; fulfillmentId: string; supplierId: string }
  | { type: "dispute/resolve"; disputeId: string; resolution: DisputeResolution }
  | { type: "escrow/release"; orderId: string }
  | { type: "settlement/pay"; settlementId: string }
  | { type: "settlement/retry"; settlementId: string }
  | { type: "data/reset" };

export interface ActionResult {
  dataset: WholesaleDataset;
  message: string;
  tone: "success" | "warning" | "danger";
}

const CARRIERS = ["Tipax", "Chapar", "DHL Wholesale", "Post Express", "Mahex"];

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function nextTimelineId(dataset: WholesaleDataset, orderId: string): string {
  return `${orderId}-tl-m${dataset.timeline.filter((t) => t.orderId === orderId).length + 1}`;
}

function pushEvent(
  dataset: WholesaleDataset,
  event: Omit<TimelineEvent, "id">,
): TimelineEvent[] {
  const withId: TimelineEvent = { ...event, id: nextTimelineId(dataset, event.orderId) };
  return [...dataset.timeline, withId].sort((a, b) => a.at.localeCompare(b.at));
}

/** tiered commission 8..12% — mirrors the generator so manual actions stay consistent */
function commissionRateFor(dataset: WholesaleDataset, supplierId: string, value: number): number {
  const supplier = dataset.suppliers.find((s) => s.id === supplierId);
  const base = supplier?.commissionTier ?? 10;
  if (value > 900_000_000) return Math.max(8, base - 1);
  if (value < 200_000_000) return Math.min(12, base + 1);
  return base;
}

/**
 * Recomputes the customer-side state of an order from its supplier-side
 * fulfillments. This is the single place where the two domains meet, and it
 * never leaks supplier data into the order itself.
 */
function recomputeOrder(dataset: WholesaleDataset, orderId: string, now: number): WholesaleDataset {
  const order = dataset.orders.find((o) => o.id === orderId);
  if (!order || order.status === "cancelled") return dataset;

  const fulfillments = dataset.fulfillments.filter((f) => f.orderId === orderId);
  const active = fulfillments.filter((f) => f.status !== "rejected" && f.status !== "cancelled");
  const openDisputes = dataset.disputes.filter((d) => d.orderId === orderId && d.status !== "resolved");

  const deliveredAll = active.length > 0 && active.every((f) => f.status === "delivered");
  const anyDelivered = active.some((f) => f.status === "delivered");
  const anyShipped = active.some((f) => f.status === "shipped" || f.status === "delivered");
  const anyAccepted = active.some((f) => f.status !== "requested");

  const next: Order = { ...order };
  let timeline = dataset.timeline;
  let escrowStatus: EscrowStatus | null = null;

  if (deliveredAll) {
    const lastDelivery = Math.max(...active.map((f) => new Date(f.deliveredAt!).getTime()));
    if (!next.deliveredAt) {
      next.deliveredAt = iso(lastDelivery);
      next.inspectionEndsAt = iso(lastDelivery + SLA.inspectionHours * HOUR);
      timeline = pushEvent(
        { ...dataset, timeline },
        {
          orderId,
          at: iso(lastDelivery),
          actor: "system",
          label: "شروع بازه بازرسی ۷۲ ساعته",
          detail: "همه بسته‌های سفارش تحویل شد",
        },
      );
    }
    const inspectionEnds = new Date(next.inspectionEndsAt!).getTime();
    if (openDisputes.length > 0) {
      next.status = "disputed";
      escrowStatus = "frozen";
    } else if (now < inspectionEnds) {
      next.status = "inspection";
      escrowStatus = "held";
    } else {
      next.status = "completed";
      if (!next.completedAt) next.completedAt = iso(inspectionEnds);
      escrowStatus = "ready";
    }
  } else if (openDisputes.length > 0) {
    next.status = "disputed";
    escrowStatus = "frozen";
  } else if (anyDelivered) next.status = "partially_fulfilled";
  else if (anyShipped) next.status = "shipped";
  else if (anyAccepted) next.status = "processing";
  else next.status = "paid";

  let escrows = dataset.escrows;
  if (escrowStatus) {
    escrows = dataset.escrows.map((e) => {
      if (e.orderId !== orderId) return e;
      if (e.status === "released" || e.status === "refunded" || e.status === "partially_released") return e;
      return {
        ...e,
        status: escrowStatus,
        readyAt: escrowStatus === "ready" ? (e.readyAt ?? next.completedAt) : e.readyAt,
        frozenAt: escrowStatus === "frozen" ? (e.frozenAt ?? iso(now)) : e.frozenAt,
      };
    });
  }

  // Settlement generation: a completed order becomes eligible, one settlement
  // per fulfillment request (1 Order -> N Fulfillments -> N Settlements).
  let settlements = dataset.settlements;
  let commissions = dataset.commissions;
  if (next.status === "completed") {
    const existing = new Set(dataset.settlements.filter((s) => s.orderId === orderId).map((s) => s.fulfillmentId));
    const created: SupplierSettlement[] = [];
    const createdCommissions: Commission[] = [];
    const completedMs = new Date(next.completedAt ?? iso(now)).getTime();
    for (const f of active) {
      if (existing.has(f.id)) continue;
      const rate = commissionRateFor(dataset, f.supplierId, f.customerValue);
      const commissionAmount = Math.round((f.customerValue * rate) / 100);
      const refundShare = Math.round(next.refundTotal / active.length);
      const adjustments: SettlementAdjustment[] = [];
      const payable = Math.max(0, f.customerValue - commissionAmount - refundShare);
      created.push({
        id: `set-${f.id}`,
        code: `ST-${7000 + dataset.settlements.length + created.length}`,
        orderId,
        fulfillmentId: f.id,
        supplierId: f.supplierId,
        status: "pending",
        fulfilledAmount: f.customerValue,
        commissionAmount,
        refundAmount: refundShare,
        adjustments,
        adjustmentTotal: 0,
        payableAmount: payable,
        dueAt: iso(completedMs + 3 * DAY),
        createdAt: iso(completedMs),
      });
      createdCommissions.push({
        id: `com-${f.id}`,
        orderId,
        fulfillmentId: f.id,
        supplierId: f.supplierId,
        rate,
        base: f.customerValue,
        amount: commissionAmount,
        calculatedAt: iso(completedMs),
      });
    }
    if (created.length > 0) {
      settlements = [...dataset.settlements, ...created];
      commissions = [...dataset.commissions, ...createdCommissions];
      timeline = pushEvent(
        { ...dataset, timeline },
        {
          orderId,
          at: iso(now),
          actor: "finance",
          label: "محاسبه کمیسیون و ایجاد تسویه تأمین‌کنندگان",
          detail: `${created.length} تسویه در وضعیت «در انتظار» ایجاد شد`,
        },
      );
    }
  }

  return {
    ...dataset,
    orders: dataset.orders.map((o) => (o.id === orderId ? next : o)),
    escrows,
    settlements,
    commissions,
    timeline,
  };
}

function patchFulfillment(
  dataset: WholesaleDataset,
  id: string,
  patch: Partial<FulfillmentRequest>,
): WholesaleDataset {
  return {
    ...dataset,
    fulfillments: dataset.fulfillments.map((f) => (f.id === id ? { ...f, ...patch } : f)),
  };
}

/** Advances a fulfillment one step along its supplier-side lifecycle. */
function advance(dataset: WholesaleDataset, f: FulfillmentRequest, now: number): ActionResult {
  const at = iso(now);
  switch (f.status) {
    case "accepted": {
      const next = patchFulfillment(dataset, f.id, { status: "preparing", preparingAt: at, delayed: false });
      return { dataset: next, message: `${f.code}: آماده‌سازی آغاز شد`, tone: "success" };
    }
    case "preparing": {
      const next = patchFulfillment(dataset, f.id, { status: "ready_to_ship", readyAt: at });
      return { dataset: next, message: `${f.code}: آماده ارسال شد`, tone: "success" };
    }
    case "ready_to_ship": {
      const shipment: Shipment = {
        id: `shp-${f.id}`,
        fulfillmentId: f.id,
        orderId: f.orderId,
        supplierId: f.supplierId,
        carrier: CARRIERS[dataset.shipments.length % CARRIERS.length],
        trackingCode: `TR${1_000_000 + dataset.shipments.length * 7919}`,
        status: "in_transit",
        shippedAt: at,
        etaAt: iso(now + 72 * HOUR),
      };
      const withShipment: WholesaleDataset = {
        ...patchFulfillment(dataset, f.id, { status: "shipped", shippedAt: at, delayed: false }),
        shipments: [...dataset.shipments.filter((s) => s.fulfillmentId !== f.id), shipment],
      };
      return { dataset: withShipment, message: `${f.code}: ارسال شد — رهگیری ${shipment.trackingCode}`, tone: "success" };
    }
    case "shipped": {
      const next: WholesaleDataset = {
        ...patchFulfillment(dataset, f.id, { status: "delivered", deliveredAt: at }),
        shipments: dataset.shipments.map((s) =>
          s.fulfillmentId === f.id ? { ...s, status: "delivered" as const, deliveredAt: at } : s,
        ),
      };
      return { dataset: next, message: `${f.code}: تحویل شد`, tone: "success" };
    }
    default:
      return { dataset, message: `${f.code}: مرحله بعدی برای این وضعیت تعریف نشده است`, tone: "warning" };
  }
}

export function applyAction(
  dataset: WholesaleDataset,
  action: DashboardAction,
  now = Date.now(),
): ActionResult {
  const at = iso(now);

  switch (action.type) {
    case "fulfillment/accept": {
      const f = dataset.fulfillments.find((x) => x.id === action.fulfillmentId);
      if (!f) return { dataset, message: "درخواست تأمین یافت نشد", tone: "danger" };
      if (f.status !== "requested") return { dataset, message: `${f.code} قبلاً پذیرفته شده است`, tone: "warning" };
      let next = patchFulfillment(dataset, f.id, { status: "accepted", acceptedAt: at, delayed: false });
      next = {
        ...next,
        timeline: pushEvent(next, {
          orderId: f.orderId,
          at,
          actor: "supplier",
          label: "پذیرش درخواست تأمین",
          detail: `${dataset.suppliers.find((s) => s.id === f.supplierId)?.name ?? ""} درخواست ${f.code} را پذیرفت`,
        }),
      };
      return { dataset: recomputeOrder(next, f.orderId, now), message: `${f.code} پذیرفته شد`, tone: "success" };
    }

    case "fulfillment/reject": {
      const f = dataset.fulfillments.find((x) => x.id === action.fulfillmentId);
      if (!f) return { dataset, message: "درخواست تأمین یافت نشد", tone: "danger" };
      let next = patchFulfillment(dataset, f.id, { status: "rejected", rejectedAt: at, delayed: false });
      next = {
        ...next,
        timeline: pushEvent(next, {
          orderId: f.orderId,
          at,
          actor: "supplier",
          label: "رد درخواست تأمین",
          detail: action.reason ?? "تأمین‌کننده امکان تأمین نداشت؛ نیازمند تخصیص مجدد",
        }),
      };
      return { dataset: recomputeOrder(next, f.orderId, now), message: `${f.code} رد شد — نیازمند تخصیص مجدد`, tone: "warning" };
    }

    case "fulfillment/advance": {
      const f = dataset.fulfillments.find((x) => x.id === action.fulfillmentId);
      if (!f) return { dataset, message: "درخواست تأمین یافت نشد", tone: "danger" };
      const result = advance(dataset, f, now);
      if (result.dataset === dataset) return result;
      const updated = result.dataset.fulfillments.find((x) => x.id === f.id)!;
      const labels: Record<string, string> = {
        preparing: "آغاز آماده‌سازی",
        ready_to_ship: "آماده ارسال",
        shipped: "ارسال مرسوله",
        delivered: "تحویل به مشتری",
      };
      const withEvent: WholesaleDataset = {
        ...result.dataset,
        timeline: pushEvent(result.dataset, {
          orderId: f.orderId,
          at,
          actor: updated.status === "delivered" ? "system" : "supplier",
          label: labels[updated.status] ?? "به‌روزرسانی تأمین",
          detail: f.code,
        }),
      };
      return { ...result, dataset: recomputeOrder(withEvent, f.orderId, now) };
    }

    case "fulfillment/reassign": {
      const f = dataset.fulfillments.find((x) => x.id === action.fulfillmentId);
      if (!f) return { dataset, message: "درخواست تأمین یافت نشد", tone: "danger" };
      const supplier = dataset.suppliers.find((s) => s.id === action.supplierId);
      if (!supplier) return { dataset, message: "تأمین‌کننده یافت نشد", tone: "danger" };
      let next = patchFulfillment(dataset, f.id, {
        supplierId: action.supplierId,
        status: "requested",
        requestedAt: at,
        acceptedAt: undefined,
        preparingAt: undefined,
        readyAt: undefined,
        shippedAt: undefined,
        deliveredAt: undefined,
        rejectedAt: undefined,
        delayed: false,
      });
      next = {
        ...next,
        shipments: next.shipments.filter((s) => s.fulfillmentId !== f.id),
        timeline: pushEvent(next, {
          orderId: f.orderId,
          at,
          actor: "kolbe",
          label: "تخصیص مجدد درخواست تأمین",
          detail: `${f.code} به ${supplier.name} منتقل شد — مشتری از این تغییر بی‌اطلاع می‌ماند`,
        }),
      };
      return {
        dataset: recomputeOrder(next, f.orderId, now),
        message: `${f.code} به ${supplier.name} تخصیص یافت`,
        tone: "success",
      };
    }

    case "dispute/resolve": {
      const dispute = dataset.disputes.find((d) => d.id === action.disputeId);
      if (!dispute) return { dataset, message: "اختلاف یافت نشد", tone: "danger" };
      const resolved: Dispute = {
        ...dispute,
        status: "resolved",
        resolution: action.resolution,
        resolvedAt: at,
      };
      const refund =
        action.resolution === "refund"
          ? dispute.amountFrozen
          : action.resolution === "partial_settlement"
            ? Math.round(dispute.amountFrozen * 0.5)
            : 0;

      let next: WholesaleDataset = {
        ...dataset,
        disputes: dataset.disputes.map((d) => (d.id === dispute.id ? resolved : d)),
        orders: dataset.orders.map((o) =>
          o.id === dispute.orderId ? { ...o, refundTotal: o.refundTotal + refund } : o,
        ),
        escrows: dataset.escrows.map((e) =>
          e.orderId === dispute.orderId
            ? {
                ...e,
                status: refund > 0 ? ("partially_released" as const) : ("ready" as const),
                amountHeld: Math.max(0, e.amountHeld - refund),
                amountRefunded: e.amountRefunded + refund,
                frozenAt: undefined,
              }
            : e,
        ),
      };

      // refunds are deducted from the supplier payable, never from the customer order total
      if (refund > 0) {
        const related = next.settlements.filter((s) => s.orderId === dispute.orderId);
        if (related.length > 0) {
          const share = Math.round(refund / related.length);
          next = {
            ...next,
            settlements: next.settlements.map((s) =>
              s.orderId === dispute.orderId
                ? {
                    ...s,
                    refundAmount: s.refundAmount + share,
                    payableAmount: Math.max(0, s.payableAmount - share),
                  }
                : s,
            ),
          };
        }
      }

      const RESOLUTION_LABEL: Record<DisputeResolution, string> = {
        full_supplier_payment: "پرداخت کامل به تأمین‌کننده",
        partial_settlement: "تسویه جزئی",
        refund: "بازپرداخت کامل به مشتری",
        replacement: "جایگزینی / مرجوعی",
      };

      next = {
        ...next,
        timeline: pushEvent(next, {
          orderId: dispute.orderId,
          at,
          actor: "kolbe",
          label: "حل اختلاف",
          detail: `${dispute.code}: ${RESOLUTION_LABEL[action.resolution]}`,
        }),
      };

      return {
        dataset: recomputeOrder(next, dispute.orderId, now),
        message: `${dispute.code} حل شد — ${RESOLUTION_LABEL[action.resolution]}`,
        tone: "success",
      };
    }

    case "escrow/release": {
      const escrow = dataset.escrows.find((e) => e.orderId === action.orderId);
      if (!escrow) return { dataset, message: "تراکنش امانی یافت نشد", tone: "danger" };
      if (escrow.status === "frozen")
        return { dataset, message: "امانی به دلیل اختلاف باز مسدود است", tone: "danger" };
      if (escrow.status === "released")
        return { dataset, message: "این وجه قبلاً آزاد شده است", tone: "warning" };

      const amount = escrow.amountHeld;
      let next: WholesaleDataset = {
        ...dataset,
        escrows: dataset.escrows.map((e) =>
          e.orderId === action.orderId
            ? { ...e, status: "released" as const, amountReleased: e.amountReleased + amount, amountHeld: 0, releasedAt: at }
            : e,
        ),
        settlements: dataset.settlements.map((s) =>
          s.orderId === action.orderId && s.status === "pending" ? { ...s, status: "scheduled" as const } : s,
        ),
      };
      next = {
        ...next,
        timeline: pushEvent(next, {
          orderId: action.orderId,
          at,
          actor: "finance",
          label: "آزادسازی وجه امانی",
          detail: "تسویه‌های مرتبط زمان‌بندی شدند",
        }),
      };
      return { dataset: next, message: "وجه امانی آزاد شد و تسویه‌ها زمان‌بندی شدند", tone: "success" };
    }

    case "settlement/pay":
    case "settlement/retry": {
      const settlement = dataset.settlements.find((s) => s.id === action.settlementId);
      if (!settlement) return { dataset, message: "تسویه یافت نشد", tone: "danger" };
      if (settlement.status === "paid")
        return { dataset, message: `${settlement.code} قبلاً پرداخت شده است`, tone: "warning" };
      const blocking = dataset.disputes.some(
        (d) => d.orderId === settlement.orderId && d.status !== "resolved",
      );
      if (blocking)
        return { dataset, message: `${settlement.code} به دلیل اختلاف باز مسدود است`, tone: "danger" };

      let next: WholesaleDataset = {
        ...dataset,
        settlements: dataset.settlements.map((s) =>
          s.id === settlement.id ? { ...s, status: "paid" as const, paidAt: at } : s,
        ),
      };
      next = {
        ...next,
        timeline: pushEvent(next, {
          orderId: settlement.orderId,
          at,
          actor: "finance",
          label: action.type === "settlement/retry" ? "اجرای مجدد تسویه" : "پرداخت تسویه تأمین‌کننده",
          detail: `${settlement.code} — ${dataset.suppliers.find((s) => s.id === settlement.supplierId)?.name ?? ""}`,
        }),
      };
      return { dataset: next, message: `${settlement.code} پرداخت شد`, tone: "success" };
    }

    case "data/reset":
      return { dataset, message: "داده نمونه بازنشانی شد", tone: "success" };

    default:
      return { dataset, message: "اقدام ناشناخته", tone: "danger" };
  }
}

/** Which manual step is available next for a fulfillment, if any. */
export function nextStepLabel(status: FulfillmentRequest["status"]): string | null {
  switch (status) {
    case "accepted":
      return "شروع آماده‌سازی";
    case "preparing":
      return "علامت‌گذاری آماده ارسال";
    case "ready_to_ship":
      return "ثبت ارسال";
    case "shipped":
      return "ثبت تحویل";
    default:
      return null;
  }
}
