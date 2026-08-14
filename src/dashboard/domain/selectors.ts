import { hoursBetween } from "../lib/format";
import { SLA } from "./generate";
import { previousBounds, rangeBounds, type DashboardFilters } from "./filters";
import type {
  Dispute,
  EscrowTransaction,
  FulfillmentRequest,
  Order,
  Shipment,
  Supplier,
  SupplierSettlement,
  WholesaleDataset,
} from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface DatasetIndex {
  orderById: Map<string, Order>;
  supplierById: Map<string, Supplier>;
  customerById: Map<string, { id: string; name: string; company: string }>;
  catalogueById: Map<string, { id: string; name: string }>;
  productById: Map<string, { id: string; name: string; sku: string; category: string; catalogueId: string }>;
  fulfillmentsByOrder: Map<string, FulfillmentRequest[]>;
  shipmentsByOrder: Map<string, Shipment[]>;
  escrowByOrder: Map<string, EscrowTransaction>;
  disputesByOrder: Map<string, Dispute[]>;
  settlementsByOrder: Map<string, SupplierSettlement[]>;
}

export function buildIndex(data: WholesaleDataset): DatasetIndex {
  const fulfillmentsByOrder = new Map<string, FulfillmentRequest[]>();
  for (const f of data.fulfillments) {
    const list = fulfillmentsByOrder.get(f.orderId);
    if (list) list.push(f);
    else fulfillmentsByOrder.set(f.orderId, [f]);
  }
  const shipmentsByOrder = new Map<string, Shipment[]>();
  for (const s of data.shipments) {
    const list = shipmentsByOrder.get(s.orderId);
    if (list) list.push(s);
    else shipmentsByOrder.set(s.orderId, [s]);
  }
  const disputesByOrder = new Map<string, Dispute[]>();
  for (const d of data.disputes) {
    const list = disputesByOrder.get(d.orderId);
    if (list) list.push(d);
    else disputesByOrder.set(d.orderId, [d]);
  }
  const settlementsByOrder = new Map<string, SupplierSettlement[]>();
  for (const s of data.settlements) {
    const list = settlementsByOrder.get(s.orderId);
    if (list) list.push(s);
    else settlementsByOrder.set(s.orderId, [s]);
  }
  return {
    orderById: new Map(data.orders.map((o) => [o.id, o])),
    supplierById: new Map(data.suppliers.map((s) => [s.id, s])),
    customerById: new Map(data.customers.map((c) => [c.id, c])),
    catalogueById: new Map(data.catalogues.map((c) => [c.id, c])),
    productById: new Map(data.products.map((p) => [p.id, p])),
    fulfillmentsByOrder,
    shipmentsByOrder,
    escrowByOrder: new Map(data.escrows.map((e) => [e.orderId, e])),
    disputesByOrder,
    settlementsByOrder,
  };
}

export interface FilteredData {
  orders: Order[];
  fulfillments: FulfillmentRequest[];
  settlements: SupplierSettlement[];
  disputes: Dispute[];
  escrows: EscrowTransaction[];
  shipments: Shipment[];
  previousOrders: Order[];
}

/**
 * A customer order is the unit of truth for the customer side; fulfillments are
 * the supplier side. Filters are applied to orders first, then propagated.
 */
export function applyFilters(
  data: WholesaleDataset,
  index: DatasetIndex,
  filters: DashboardFilters,
): FilteredData {
  const { start, end } = rangeBounds(filters);
  const prev = previousBounds(filters);

  const inRange = (iso: string, s: number, e: number) => {
    const t = new Date(iso).getTime();
    return t >= s && t <= e;
  };

  const matchOrderBase = (o: Order): boolean => {
    if (filters.customerId !== "all" && o.customerId !== filters.customerId) return false;
    if (filters.catalogueId !== "all" && o.catalogueId !== filters.catalogueId) return false;
    if (filters.orderStatus !== "all" && o.status !== filters.orderStatus) return false;
    if (filters.category !== "all") {
      const hasCategory = o.items.some(
        (it) => index.productById.get(it.productId)?.category === filters.category,
      );
      if (!hasCategory) return false;
    }
    if (filters.supplierId !== "all") {
      const fs = index.fulfillmentsByOrder.get(o.id) ?? [];
      if (!fs.some((f) => f.supplierId === filters.supplierId)) return false;
    }
    if (filters.fulfillmentStatus !== "all") {
      const fs = index.fulfillmentsByOrder.get(o.id) ?? [];
      if (!fs.some((f) => f.status === filters.fulfillmentStatus)) return false;
    }
    if (filters.settlementStatus !== "all") {
      const ss = index.settlementsByOrder.get(o.id) ?? [];
      if (!ss.some((s) => s.status === filters.settlementStatus)) return false;
    }
    return true;
  };

  const orders: Order[] = [];
  const previousOrders: Order[] = [];
  for (const o of data.orders) {
    if (!matchOrderBase(o)) continue;
    if (inRange(o.createdAt, start, end)) orders.push(o);
    else if (inRange(o.createdAt, prev.start, prev.end)) previousOrders.push(o);
  }

  const orderIds = new Set(orders.map((o) => o.id));
  const supplierFilter = filters.supplierId;
  const fulfillments = data.fulfillments.filter(
    (f) =>
      orderIds.has(f.orderId) &&
      (supplierFilter === "all" || f.supplierId === supplierFilter) &&
      (filters.fulfillmentStatus === "all" || f.status === filters.fulfillmentStatus),
  );
  const settlements = data.settlements.filter(
    (s) =>
      orderIds.has(s.orderId) &&
      (supplierFilter === "all" || s.supplierId === supplierFilter) &&
      (filters.settlementStatus === "all" || s.status === filters.settlementStatus),
  );
  const disputes = data.disputes.filter(
    (d) => orderIds.has(d.orderId) && (supplierFilter === "all" || d.supplierId === supplierFilter),
  );
  const escrows = data.escrows.filter((e) => orderIds.has(e.orderId));
  const shipments = data.shipments.filter(
    (s) => orderIds.has(s.orderId) && (supplierFilter === "all" || s.supplierId === supplierFilter),
  );

  return { orders, fulfillments, settlements, disputes, escrows, shipments, previousOrders };
}

export interface KpiValue {
  value: number;
  previous: number;
  delta: number; // percent
}

function delta(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

export function makeKpi(value: number, previous: number): KpiValue {
  return { value, previous, delta: delta(value, previous) };
}

export interface DashboardKpis {
  grossRevenue: KpiValue;
  escrowBalance: KpiValue;
  readyForSettlement: KpiValue;
  commission: KpiValue;
  activeOrders: KpiValue;
  openFulfillments: KpiValue;
  delayedFulfillments: KpiValue;
  openDisputes: KpiValue;
  averageOrderValue: KpiValue;
  totalSettled: number;
  pendingSettlement: number;
  refunds: number;
  adjustments: number;
}

const ACTIVE_ORDER_STATUSES = new Set([
  "paid",
  "processing",
  "partially_fulfilled",
  "shipped",
  "delivered",
  "inspection",
]);
const OPEN_FULFILLMENT_STATUSES = new Set(["requested", "accepted", "preparing", "ready_to_ship", "shipped"]);

export function computeKpis(
  data: WholesaleDataset,
  index: DatasetIndex,
  filtered: FilteredData,
): DashboardKpis {
  const gross = filtered.orders.reduce((s, o) => s + o.total, 0);
  const prevGross = filtered.previousOrders.reduce((s, o) => s + o.total, 0);

  const escrowBalance = filtered.escrows.reduce((s, e) => s + e.amountHeld, 0);
  const prevEscrow = filtered.previousOrders.reduce(
    (s, o) => s + (index.escrowByOrder.get(o.id)?.amountHeld ?? 0),
    0,
  );

  const ready = filtered.escrows
    .filter((e) => e.status === "ready")
    .reduce((s, e) => s + e.amountHeld, 0);
  const prevReady = filtered.previousOrders.reduce((s, o) => {
    const e = index.escrowByOrder.get(o.id);
    return s + (e && e.status === "ready" ? e.amountHeld : 0);
  }, 0);

  const commission = filtered.settlements.reduce((s, x) => s + x.commissionAmount, 0);
  const prevCommission = filtered.previousOrders.reduce(
    (s, o) => s + (index.settlementsByOrder.get(o.id) ?? []).reduce((a, x) => a + x.commissionAmount, 0),
    0,
  );

  const activeOrders = filtered.orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length;
  const prevActive = filtered.previousOrders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status)).length;

  const openFf = filtered.fulfillments.filter((f) => OPEN_FULFILLMENT_STATUSES.has(f.status)).length;
  const prevOpenFf = filtered.previousOrders.reduce(
    (s, o) =>
      s + (index.fulfillmentsByOrder.get(o.id) ?? []).filter((f) => OPEN_FULFILLMENT_STATUSES.has(f.status)).length,
    0,
  );

  const delayed = filtered.fulfillments.filter((f) => f.delayed).length;
  const prevDelayed = filtered.previousOrders.reduce(
    (s, o) => s + (index.fulfillmentsByOrder.get(o.id) ?? []).filter((f) => f.delayed).length,
    0,
  );

  const openDisputes = filtered.disputes.filter((d) => d.status !== "resolved").length;
  const prevDisputes = filtered.previousOrders.reduce(
    (s, o) => s + (index.disputesByOrder.get(o.id) ?? []).filter((d) => d.status !== "resolved").length,
    0,
  );

  const aov = filtered.orders.length ? gross / filtered.orders.length : 0;
  const prevAov = filtered.previousOrders.length ? prevGross / filtered.previousOrders.length : 0;

  const totalSettled = filtered.settlements
    .filter((s) => s.status === "paid")
    .reduce((s, x) => s + x.payableAmount, 0);
  const pendingSettlement = filtered.settlements
    .filter((s) => s.status !== "paid" && s.status !== "failed")
    .reduce((s, x) => s + x.payableAmount, 0);
  const refunds = filtered.orders.reduce((s, o) => s + o.refundTotal, 0);
  const adjustments = filtered.settlements.reduce((s, x) => s + x.adjustmentTotal, 0);

  void data;

  return {
    grossRevenue: makeKpi(gross, prevGross),
    escrowBalance: makeKpi(escrowBalance, prevEscrow),
    readyForSettlement: makeKpi(ready, prevReady),
    commission: makeKpi(commission, prevCommission),
    activeOrders: makeKpi(activeOrders, prevActive),
    openFulfillments: makeKpi(openFf, prevOpenFf),
    delayedFulfillments: makeKpi(delayed, prevDelayed),
    openDisputes: makeKpi(openDisputes, prevDisputes),
    averageOrderValue: makeKpi(aov, prevAov),
    totalSettled,
    pendingSettlement,
    refunds,
    adjustments,
  };
}

export interface TimeSeriesPoint {
  date: string;
  label: string;
  orders: number;
  gross: number;
  escrowHeld: number;
  settlement: number;
  commission: number;
  refunds: number;
}

export function buildTimeSeries(
  index: DatasetIndex,
  filtered: FilteredData,
  filters: DashboardFilters,
): TimeSeriesPoint[] {
  const { start, end } = rangeBounds(filters);
  const days = Math.max(1, Math.ceil((end - start) / DAY));
  const buckets = new Map<string, TimeSeriesPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * DAY);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      label: key.slice(5),
      orders: 0,
      gross: 0,
      escrowHeld: 0,
      settlement: 0,
      commission: 0,
      refunds: 0,
    });
  }
  for (const o of filtered.orders) {
    const key = o.createdAt.slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    b.orders += 1;
    b.gross += o.total;
    b.refunds += o.refundTotal;
    const e = index.escrowByOrder.get(o.id);
    if (e) b.escrowHeld += e.amountHeld;
    for (const s of index.settlementsByOrder.get(o.id) ?? []) {
      b.settlement += s.payableAmount;
      b.commission += s.commissionAmount;
    }
  }
  return Array.from(buckets.values());
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export function buildFunnel(index: DatasetIndex, filtered: FilteredData): FunnelStage[] {
  let created = 0;
  let paid = 0;
  let requested = 0;
  let accepted = 0;
  let preparing = 0;
  let shipped = 0;
  let delivered = 0;
  let inspection = 0;
  let completed = 0;
  let settled = 0;

  const reached = (f: FulfillmentRequest, stage: string): boolean => {
    switch (stage) {
      case "accepted":
        return Boolean(f.acceptedAt);
      case "preparing":
        return Boolean(f.preparingAt);
      case "shipped":
        return Boolean(f.shippedAt);
      case "delivered":
        return Boolean(f.deliveredAt);
      default:
        return true;
    }
  };

  for (const o of filtered.orders) {
    created++;
    if (o.status !== "cancelled") paid++;
    const fs = index.fulfillmentsByOrder.get(o.id) ?? [];
    if (fs.length > 0) requested++;
    if (fs.some((f) => reached(f, "accepted"))) accepted++;
    if (fs.some((f) => reached(f, "preparing"))) preparing++;
    if (fs.some((f) => reached(f, "shipped"))) shipped++;
    if (fs.some((f) => reached(f, "delivered"))) delivered++;
    if (o.inspectionEndsAt) inspection++;
    if (o.status === "completed") completed++;
    const ss = index.settlementsByOrder.get(o.id) ?? [];
    if (ss.length > 0 && ss.every((s) => s.status === "paid")) settled++;
  }

  return [
    { key: "created", label: "ثبت سفارش", count: created },
    { key: "paid", label: "پرداخت در امانی", count: paid },
    { key: "requested", label: "درخواست تأمین", count: requested },
    { key: "accepted", label: "پذیرش تأمین‌کننده", count: accepted },
    { key: "preparing", label: "آماده‌سازی", count: preparing },
    { key: "shipped", label: "ارسال", count: shipped },
    { key: "delivered", label: "تحویل", count: delivered },
    { key: "inspection", label: "بازرسی", count: inspection },
    { key: "completed", label: "تکمیل", count: completed },
    { key: "settled", label: "تسویه", count: settled },
  ];
}

export interface SupplierPerformanceRow {
  supplierId: string;
  supplierName: string;
  fulfillments: number;
  acceptanceRate: number;
  avgAcceptanceHours: number;
  avgPreparationHours: number;
  onTimeShippingRate: number;
  cancellationRate: number;
  disputeRate: number;
  gmvSupplied: number;
  settlementAmount: number;
  score: number;
}

export function buildSupplierPerformance(
  index: DatasetIndex,
  filtered: FilteredData,
): SupplierPerformanceRow[] {
  const byId = new Map<string, FulfillmentRequest[]>();
  for (const f of filtered.fulfillments) {
    const l = byId.get(f.supplierId);
    if (l) l.push(f);
    else byId.set(f.supplierId, [f]);
  }
  const disputeCount = new Map<string, number>();
  for (const d of filtered.disputes) {
    disputeCount.set(d.supplierId, (disputeCount.get(d.supplierId) ?? 0) + 1);
  }
  const settlementBySupplier = new Map<string, number>();
  for (const s of filtered.settlements) {
    settlementBySupplier.set(s.supplierId, (settlementBySupplier.get(s.supplierId) ?? 0) + s.payableAmount);
  }

  const rows: SupplierPerformanceRow[] = [];
  for (const [supplierId, list] of byId) {
    const supplier = index.supplierById.get(supplierId);
    const accepted = list.filter((f) => f.acceptedAt);
    const rejected = list.filter((f) => f.status === "rejected");
    const cancelled = list.filter((f) => f.status === "cancelled");
    const acceptanceRate = list.length ? (accepted.length / list.length) * 100 : 0;
    const acceptTimes = accepted.map((f) => hoursBetween(f.requestedAt, f.acceptedAt!));
    const prepTimes = list
      .filter((f) => f.preparingAt && f.readyAt)
      .map((f) => hoursBetween(f.preparingAt!, f.readyAt!));
    const shipped = list.filter((f) => f.shippedAt);
    const onTime = shipped.filter(
      (f) => hoursBetween(f.requestedAt, f.shippedAt!) <= SLA.acceptHours + SLA.prepareHours + SLA.shipHours,
    );
    const gmv = list.reduce((s, f) => s + f.customerValue, 0);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const acceptanceScore = acceptanceRate;
    const speedScore = Math.max(0, 100 - (avg(acceptTimes) / SLA.acceptHours) * 50);
    const onTimeScore = shipped.length ? (onTime.length / shipped.length) * 100 : 0;
    const qualityScore = Math.max(
      0,
      100 - ((disputeCount.get(supplierId) ?? 0) / Math.max(1, list.length)) * 400,
    );
    // equal weights: 25% each
    const score = acceptanceScore * 0.25 + speedScore * 0.25 + onTimeScore * 0.25 + qualityScore * 0.25;

    rows.push({
      supplierId,
      supplierName: supplier?.name ?? supplierId,
      fulfillments: list.length,
      acceptanceRate,
      avgAcceptanceHours: avg(acceptTimes),
      avgPreparationHours: avg(prepTimes),
      onTimeShippingRate: onTimeScore,
      cancellationRate: list.length ? ((rejected.length + cancelled.length) / list.length) * 100 : 0,
      disputeRate: list.length ? ((disputeCount.get(supplierId) ?? 0) / list.length) * 100 : 0,
      gmvSupplied: gmv,
      settlementAmount: settlementBySupplier.get(supplierId) ?? 0,
      score,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

export interface SlaMetric {
  key: string;
  label: string;
  avgHours: number;
  targetHours: number;
  samples: number;
}

export function buildSlaMetrics(index: DatasetIndex, filtered: FilteredData): SlaMetric[] {
  const collect = (fn: (f: FulfillmentRequest) => number | null): number[] => {
    const out: number[] = [];
    for (const f of filtered.fulfillments) {
      const v = fn(f);
      if (v !== null && Number.isFinite(v)) out.push(v);
    }
    return out;
  };
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  const accept = collect((f) => (f.acceptedAt ? hoursBetween(f.requestedAt, f.acceptedAt) : null));
  const prepare = collect((f) => (f.acceptedAt && f.readyAt ? hoursBetween(f.acceptedAt, f.readyAt) : null));
  const ship = collect((f) => (f.readyAt && f.shippedAt ? hoursBetween(f.readyAt, f.shippedAt) : null));
  const deliver = collect((f) => (f.shippedAt && f.deliveredAt ? hoursBetween(f.shippedAt, f.deliveredAt) : null));

  const settleHours: number[] = [];
  for (const o of filtered.orders) {
    if (!o.deliveredAt) continue;
    for (const s of index.settlementsByOrder.get(o.id) ?? []) {
      if (s.paidAt) settleHours.push(hoursBetween(o.deliveredAt, s.paidAt));
    }
  }

  return [
    { key: "accept", label: "درخواست ← پذیرش", avgHours: avg(accept), targetHours: SLA.acceptHours, samples: accept.length },
    { key: "prepare", label: "پذیرش ← آماده‌سازی", avgHours: avg(prepare), targetHours: SLA.prepareHours, samples: prepare.length },
    { key: "ship", label: "آماده‌سازی ← ارسال", avgHours: avg(ship), targetHours: SLA.shipHours, samples: ship.length },
    { key: "deliver", label: "ارسال ← تحویل", avgHours: avg(deliver), targetHours: 96, samples: deliver.length },
    { key: "settle", label: "تحویل ← تسویه", avgHours: avg(settleHours), targetHours: 72 + 72, samples: settleHours.length },
  ];
}

export interface InspectionRow {
  orderId: string;
  orderCode: string;
  customer: string;
  deliveredAt: string;
  deadline: string;
  hoursRemaining: number;
  valueHeld: number;
  suppliers: string;
  urgency: "safe" | "soon" | "critical" | "expired";
}

export function buildInspectionQueue(
  index: DatasetIndex,
  filtered: FilteredData,
  now = Date.now(),
): InspectionRow[] {
  const rows: InspectionRow[] = [];
  for (const o of filtered.orders) {
    if (!o.inspectionEndsAt || !o.deliveredAt) continue;
    if (o.status !== "inspection" && o.status !== "disputed") continue;
    const deadline = new Date(o.inspectionEndsAt).getTime();
    const hoursRemaining = (deadline - now) / HOUR;
    const escrow = index.escrowByOrder.get(o.id);
    const suppliers = (index.fulfillmentsByOrder.get(o.id) ?? [])
      .map((f) => index.supplierById.get(f.supplierId)?.name ?? f.supplierId)
      .join("، ");
    rows.push({
      orderId: o.id,
      orderCode: o.code,
      customer: index.customerById.get(o.customerId)?.company ?? o.customerId,
      deliveredAt: o.deliveredAt,
      deadline: o.inspectionEndsAt,
      hoursRemaining,
      valueHeld: escrow?.amountHeld ?? o.total,
      suppliers,
      urgency:
        hoursRemaining <= 0 ? "expired" : hoursRemaining < 6 ? "critical" : hoursRemaining < 24 ? "soon" : "safe",
    });
  }
  rows.sort((a, b) => a.hoursRemaining - b.hoursRemaining);
  return rows;
}

export interface AlertItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
}

export function buildAlerts(
  index: DatasetIndex,
  filtered: FilteredData,
  now = Date.now(),
): AlertItem[] {
  const alerts: AlertItem[] = [];

  const waitingAccept = filtered.fulfillments.filter(
    (f) => f.status === "requested" && (now - new Date(f.requestedAt).getTime()) / HOUR > SLA.acceptHours,
  );
  if (waitingAccept.length) {
    alerts.push({
      id: "alert-accept",
      severity: "critical",
      title: `${waitingAccept.length} درخواست تأمین بیش از ${SLA.acceptHours} ساعت بی‌پاسخ مانده`,
      detail: "SLA پذیرش نقض شده است؛ تماس با تأمین‌کننده یا تخصیص مجدد لازم است",
      href: "#/admin/fulfillment?ff_status=requested",
    });
  }

  const lateShipments = filtered.shipments.filter((s) => s.status === "delayed");
  if (lateShipments.length) {
    alerts.push({
      id: "alert-ship",
      severity: "warning",
      title: `${lateShipments.length} مرسوله از SLA ارسال عبور کرده`,
      detail: "زمان حمل بیش از ۷۲ ساعت شده است",
      href: "#/admin/fulfillment",
    });
  }

  const frozen = filtered.disputes
    .filter((d) => d.status !== "resolved")
    .reduce((s, d) => s + d.amountFrozen, 0);
  if (frozen > 0) {
    alerts.push({
      id: "alert-frozen",
      severity: "critical",
      title: `${Math.round(frozen / 1_000_000).toLocaleString("en-US")}M تومان به دلیل اختلاف مسدود شده`,
      detail: "تسویه این تأمین‌کنندگان تا رفع اختلاف متوقف است",
      href: "#/admin/disputes",
    });
  }

  const inspection = buildInspectionQueue(index, filtered, now);
  const endingSoon = inspection.filter((r) => r.urgency === "critical");
  if (endingSoon.length) {
    alerts.push({
      id: "alert-inspection",
      severity: "warning",
      title: `${endingSoon.length} سفارش کمتر از ۶ ساعت تا پایان بازرسی دارد`,
      detail: "پس از پایان بازه، وجه امانی آماده تسویه می‌شود",
      href: "#/admin/escrow",
    });
  }

  const failed = filtered.settlements.filter((s) => s.status === "failed");
  if (failed.length) {
    alerts.push({
      id: "alert-settlement",
      severity: "critical",
      title: `${failed.length} تسویه تأمین‌کننده ناموفق بوده`,
      detail: "نیازمند بررسی اطلاعات بانکی و اجرای مجدد پرداخت",
      href: "#/admin/settlements?settlement_status=failed",
    });
  }

  const perf = buildSupplierPerformance(index, filtered);
  const weak = perf.filter((p) => p.fulfillments >= 3 && p.acceptanceRate < 70)[0];
  if (weak) {
    alerts.push({
      id: "alert-supplier",
      severity: "warning",
      title: `نرخ پذیرش ${weak.supplierName} به ${weak.acceptanceRate.toFixed(0)}٪ رسیده`,
      detail: "عملکرد پایین‌تر از آستانه قابل قبول است",
      href: `#/admin/suppliers?supplier=${weak.supplierId}`,
    });
  }

  return alerts;
}

export interface CatalogueRow {
  catalogueId: string;
  name: string;
  season: string;
  views: number;
  orders: number;
  gmv: number;
  units: number;
  aov: number;
  conversion: number;
}

export function buildCatalogueAnalytics(
  data: WholesaleDataset,
  filtered: FilteredData,
): CatalogueRow[] {
  const rows = new Map<string, CatalogueRow>();
  for (const c of data.catalogues) {
    rows.set(c.id, {
      catalogueId: c.id,
      name: c.name,
      season: c.season,
      views: c.views,
      orders: 0,
      gmv: 0,
      units: 0,
      aov: 0,
      conversion: 0,
    });
  }
  for (const o of filtered.orders) {
    const r = rows.get(o.catalogueId);
    if (!r) continue;
    r.orders += 1;
    r.gmv += o.total;
    r.units += o.itemCount;
  }
  const out = Array.from(rows.values());
  for (const r of out) {
    r.aov = r.orders ? r.gmv / r.orders : 0;
    r.conversion = r.views ? (r.orders / r.views) * 100 : 0;
  }
  out.sort((a, b) => b.gmv - a.gmv);
  return out;
}

export interface ProductRow {
  productId: string;
  name: string;
  sku: string;
  category: string;
  catalogue: string;
  units: number;
  gmv: number;
  orders: number;
  supplier: string;
}

export function buildProductAnalytics(index: DatasetIndex, filtered: FilteredData): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const o of filtered.orders) {
    for (const it of o.items) {
      const p = index.productById.get(it.productId);
      if (!p) continue;
      let row = map.get(it.productId);
      if (!row) {
        row = {
          productId: it.productId,
          name: p.name,
          sku: p.sku,
          category: p.category,
          catalogue: index.catalogueById.get(p.catalogueId)?.name ?? "—",
          units: 0,
          gmv: 0,
          orders: 0,
          supplier: index.supplierById.get(it.supplierId)?.name ?? "—",
        };
        map.set(it.productId, row);
      }
      row.units += it.quantity;
      row.gmv += it.lineTotal;
      row.orders += 1;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.gmv - a.gmv);
}

export interface CustomerRow {
  customerId: string;
  name: string;
  company: string;
  city: string;
  tier: string;
  segment: string;
  orders: number;
  gmv: number;
  aov: number;
  lastOrderAt?: string;
  openDisputes: number;
}

export function buildCustomerAnalytics(
  data: WholesaleDataset,
  index: DatasetIndex,
  filtered: FilteredData,
): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const c of data.customers) {
    map.set(c.id, {
      customerId: c.id,
      name: c.name,
      company: c.company,
      city: c.city,
      tier: c.tier,
      segment: c.segment,
      orders: 0,
      gmv: 0,
      aov: 0,
      openDisputes: 0,
    });
  }
  for (const o of filtered.orders) {
    const r = map.get(o.customerId);
    if (!r) continue;
    r.orders += 1;
    r.gmv += o.total;
    if (!r.lastOrderAt || o.createdAt > r.lastOrderAt) r.lastOrderAt = o.createdAt;
    r.openDisputes += (index.disputesByOrder.get(o.id) ?? []).filter((d) => d.status !== "resolved").length;
  }
  const out = Array.from(map.values()).filter((r) => r.orders > 0);
  for (const r of out) r.aov = r.orders ? r.gmv / r.orders : 0;
  out.sort((a, b) => b.gmv - a.gmv);
  return out;
}

export interface OrderRow {
  order: Order;
  customerName: string;
  catalogueName: string;
  fulfillments: FulfillmentRequest[];
  fulfillmentSummary: string;
  shipmentSummary: string;
  escrow?: EscrowTransaction;
  settlements: SupplierSettlement[];
  settlementSummary: string;
  inspectionHoursRemaining?: number;
  disputes: Dispute[];
}

export function buildOrderRows(index: DatasetIndex, filtered: FilteredData, now = Date.now()): OrderRow[] {
  return filtered.orders
    .map((order) => {
      const fulfillments = index.fulfillmentsByOrder.get(order.id) ?? [];
      const shipments = index.shipmentsByOrder.get(order.id) ?? [];
      const settlements = index.settlementsByOrder.get(order.id) ?? [];
      const delivered = fulfillments.filter((f) => f.status === "delivered").length;
      const paidSettlements = settlements.filter((s) => s.status === "paid").length;
      return {
        order,
        customerName: index.customerById.get(order.customerId)?.company ?? order.customerId,
        catalogueName: index.catalogueById.get(order.catalogueId)?.name ?? "—",
        fulfillments,
        fulfillmentSummary: `${delivered}/${fulfillments.length}`,
        shipmentSummary: shipments.length
          ? `${shipments.filter((s) => s.status === "delivered").length}/${shipments.length}`
          : "—",
        escrow: index.escrowByOrder.get(order.id),
        settlements,
        settlementSummary: settlements.length ? `${paidSettlements}/${settlements.length}` : "—",
        inspectionHoursRemaining: order.inspectionEndsAt
          ? (new Date(order.inspectionEndsAt).getTime() - now) / HOUR
          : undefined,
        disputes: index.disputesByOrder.get(order.id) ?? [],
      };
    })
    .sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
}

export function escrowByStatus(filtered: FilteredData): Array<{ status: string; amount: number; count: number }> {
  const map = new Map<string, { status: string; amount: number; count: number }>();
  for (const e of filtered.escrows) {
    const entry = map.get(e.status) ?? { status: e.status, amount: 0, count: 0 };
    entry.amount += e.amountHeld + (e.status === "released" ? e.amountReleased : 0);
    entry.count += 1;
    map.set(e.status, entry);
  }
  return Array.from(map.values());
}
