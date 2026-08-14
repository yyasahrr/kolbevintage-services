import { useMemo } from "react";
import { cn } from "@/utils/cn";
import {
  FULFILLMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_TONE,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
} from "../domain/labels";
import {
  buildAlerts,
  buildFunnel,
  buildInspectionQueue,
  buildOrderRows,
  buildSlaMetrics,
  buildSupplierPerformance,
  buildTimeSeries,
  type OrderRow,
} from "../domain/selectors";
import { FULFILLMENT_STATUS_ORDER, ORDER_STATUS_ORDER } from "../domain/generate";
import {
  formatDateDual,
  formatDurationHours,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatPercent,
  toCsvValue,
} from "../lib/format";
import { useDashboard } from "../state";
import { Card, CardHeader, EmptyState, MetricCard, MoneyValue, ProgressBar, StatusBadge } from "./primitives";
import { DataTable, type Column } from "./DataTable";
import { CHART_COLORS, DonutChart, FunnelChart, OrderVolumeChart, RevenueSettlementChart, SlaBars, StatusBarChart } from "./charts";

/* ------------------------------------------------------------------ KPIs */

export function KPIGrid({ onDrill }: { onDrill: (path: string, params?: Record<string, string>) => void }) {
  const { kpis } = useDashboard();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-grid">
      <MetricCard
        label="فروش ناخالص عمده"
        value={formatMoneyCompact(kpis.grossRevenue.value)}
        delta={kpis.grossRevenue.delta}
        hint="در برابر دوره قبل"
        tone="info"
        onClick={() => onDrill("/orders")}
      />
      <MetricCard
        label="موجودی امانی"
        value={formatMoneyCompact(kpis.escrowBalance.value)}
        delta={kpis.escrowBalance.delta}
        hint="اسنپ‌شات فعلی"
        tone="progress"
        onClick={() => onDrill("/escrow")}
      />
      <MetricCard
        label="آماده تسویه"
        value={formatMoneyCompact(kpis.readyForSettlement.value)}
        delta={kpis.readyForSettlement.delta}
        tone="success"
        onClick={() => onDrill("/settlements")}
      />
      <MetricCard
        label="کمیسیون کلبه وینتیج"
        value={formatMoneyCompact(kpis.commission.value)}
        delta={kpis.commission.delta}
        tone="warning"
        onClick={() => onDrill("/settlements")}
      />
      <MetricCard
        label="سفارش‌های فعال"
        value={formatNumber(kpis.activeOrders.value)}
        delta={kpis.activeOrders.delta}
        tone="info"
        onClick={() => onDrill("/orders")}
      />
      <MetricCard
        label="تأمین‌های باز"
        value={formatNumber(kpis.openFulfillments.value)}
        delta={kpis.openFulfillments.delta}
        tone="progress"
        onClick={() => onDrill("/fulfillment")}
      />
      <MetricCard
        label="تأمین‌های تأخیردار"
        value={formatNumber(kpis.delayedFulfillments.value)}
        delta={kpis.delayedFulfillments.delta}
        invertTrend
        tone="danger"
        onClick={() => onDrill("/fulfillment", { ff_status: "requested" })}
      />
      <MetricCard
        label="اختلافات باز"
        value={formatNumber(kpis.openDisputes.value)}
        delta={kpis.openDisputes.delta}
        invertTrend
        tone="danger"
        onClick={() => onDrill("/disputes")}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Alerts */

export function OperationalAlerts({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { index, filtered, now } = useDashboard();
  const alerts = useMemo(() => buildAlerts(index, filtered, now), [index, filtered, now]);

  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader title="هشدارهای عملیاتی" subtitle="وضعیت پایدار است" />
        <EmptyState title="هیچ هشدار فعالی وجود ندارد" detail="همه SLAها در محدوده مجاز هستند" />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="هشدارهای عملیاتی" subtitle={`${alerts.length} مورد نیازمند اقدام`} />
      <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800" data-testid="alerts">
        {alerts.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onNavigate(a.href)}
              className="flex w-full items-start gap-3 px-5 py-3 text-right hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy dark:hover:bg-slate-800/40"
            >
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  a.severity === "critical" ? "bg-rose-500" : a.severity === "warning" ? "bg-amber-500" : "bg-sky-500",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-800 dark:text-slate-100">{a.title}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{a.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------------------------------------------------------- Charts */

export function RevenueAnalytics() {
  const { index, filtered, filters } = useDashboard();
  const series = useMemo(() => buildTimeSeries(index, filtered, filters), [index, filtered, filters]);
  return (
    <Card>
      <CardHeader title="درآمد در برابر تسویه" subtitle="فروش ناخالص، امانی، تسویه، کمیسیون و بازپرداخت" />
      <div className="p-2">
        <RevenueSettlementChart data={series} />
      </div>
    </Card>
  );
}

export function OrderVolumeCard() {
  const { index, filtered, filters } = useDashboard();
  const series = useMemo(() => buildTimeSeries(index, filtered, filters), [index, filtered, filters]);
  return (
    <Card>
      <CardHeader title="حجم سفارش" subtitle="تعداد سفارش‌های ثبت‌شده در بازه" />
      <div className="p-2">
        <OrderVolumeChart data={series} />
      </div>
    </Card>
  );
}

export function OrderFunnelCard() {
  const { index, filtered } = useDashboard();
  const stages = useMemo(() => buildFunnel(index, filtered), [index, filtered]);
  return (
    <Card>
      <CardHeader title="قیف چرخه عمده‌فروشی" subtitle="از ثبت سفارش تا تسویه تأمین‌کننده" />
      <FunnelChart stages={stages} />
    </Card>
  );
}

export function OrderStatusDonut() {
  const { filtered } = useDashboard();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of filtered.orders) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    const palette = [
      CHART_COLORS.slate,
      CHART_COLORS.sky,
      CHART_COLORS.indigo,
      CHART_COLORS.violet,
      CHART_COLORS.navy,
      CHART_COLORS.emerald,
      CHART_COLORS.amber,
      "#059669",
      CHART_COLORS.rose,
      "#64748b",
    ];
    return ORDER_STATUS_ORDER.map((s, i) => ({
      label: ORDER_STATUS_LABEL[s],
      value: counts.get(s) ?? 0,
      color: palette[i % palette.length],
    })).filter((d) => d.value > 0);
  }, [filtered.orders]);

  return (
    <Card>
      <CardHeader title="توزیع وضعیت سفارش" subtitle="سمت مشتری" />
      {data.length === 0 ? (
        <EmptyState title="سفارشی در بازه انتخابی نیست" />
      ) : (
        <DonutChart data={data} centerLabel="سفارش" centerValue={formatNumber(filtered.orders.length)} />
      )}
    </Card>
  );
}

export function FulfillmentStatusChart() {
  const { filtered } = useDashboard();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of filtered.fulfillments) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
    const delayed = filtered.fulfillments.filter((f) => f.delayed).length;
    const colours: Record<string, string> = {
      requested: CHART_COLORS.amber,
      accepted: CHART_COLORS.sky,
      preparing: CHART_COLORS.indigo,
      ready_to_ship: CHART_COLORS.violet,
      shipped: CHART_COLORS.navy,
      delivered: CHART_COLORS.emerald,
      rejected: CHART_COLORS.rose,
      cancelled: CHART_COLORS.slate,
    };
    const base = FULFILLMENT_STATUS_ORDER.map((s) => ({
      label: FULFILLMENT_STATUS_LABEL[s],
      value: counts.get(s) ?? 0,
      color: colours[s],
    }));
    base.push({ label: "تأخیردار", value: delayed, color: "#be123c" });
    return base.filter((d) => d.value > 0);
  }, [filtered.fulfillments]);

  return (
    <Card>
      <CardHeader title="وضعیت درخواست‌های تأمین" subtitle="سمت تأمین‌کننده — مستقل از وضعیت سفارش مشتری" />
      {data.length === 0 ? <EmptyState title="درخواست تأمینی موجود نیست" /> : <StatusBarChart data={data} colorKey="chart-fulfillment" />}
    </Card>
  );
}

export function SlaCard() {
  const { index, filtered } = useDashboard();
  const metrics = useMemo(() => buildSlaMetrics(index, filtered), [index, filtered]);
  return (
    <Card>
      <CardHeader title="شاخص‌های SLA تأمین" subtitle="میانگین زمان واقعی در برابر هدف" />
      <SlaBars items={metrics} />
    </Card>
  );
}

/* --------------------------------------------------- Supplier performance */

export function SupplierPerformanceTable({ onSelect }: { onSelect?: (supplierId: string) => void }) {
  const { index, filtered } = useDashboard();
  const rows = useMemo(() => buildSupplierPerformance(index, filtered), [index, filtered]);

  const columns: Array<Column<(typeof rows)[number]>> = [
    { key: "supplier", header: "تأمین‌کننده", value: (r) => r.supplierName },
    { key: "fulfillments", header: "تأمین‌ها", value: (r) => r.fulfillments, align: "end" },
    {
      key: "acceptance",
      header: "نرخ پذیرش",
      value: (r) => r.acceptanceRate,
      align: "end",
      render: (r) => formatPercent(r.acceptanceRate, 0),
    },
    {
      key: "acceptTime",
      header: "میانگین پذیرش",
      value: (r) => r.avgAcceptanceHours,
      align: "end",
      secondary: true,
      render: (r) => formatDurationHours(r.avgAcceptanceHours),
    },
    {
      key: "prepTime",
      header: "میانگین آماده‌سازی",
      value: (r) => r.avgPreparationHours,
      align: "end",
      secondary: true,
      render: (r) => formatDurationHours(r.avgPreparationHours),
    },
    {
      key: "onTime",
      header: "ارسال به‌موقع",
      value: (r) => r.onTimeShippingRate,
      align: "end",
      render: (r) => formatPercent(r.onTimeShippingRate, 0),
    },
    {
      key: "cancel",
      header: "نرخ لغو",
      value: (r) => r.cancellationRate,
      align: "end",
      secondary: true,
      render: (r) => formatPercent(r.cancellationRate, 0),
    },
    {
      key: "dispute",
      header: "نرخ اختلاف",
      value: (r) => r.disputeRate,
      align: "end",
      secondary: true,
      render: (r) => formatPercent(r.disputeRate, 0),
    },
    { key: "gmv", header: "GMV تأمین‌شده", value: (r) => r.gmvSupplied, align: "end", render: (r) => <MoneyValue amount={r.gmvSupplied} compact /> },
    {
      key: "settlement",
      header: "مبلغ تسویه",
      value: (r) => r.settlementAmount,
      align: "end",
      secondary: true,
      render: (r) => <MoneyValue amount={r.settlementAmount} compact />,
    },
    {
      key: "score",
      header: "امتیاز عملکرد",
      value: (r) => r.score,
      align: "end",
      render: (r) => (
        <div className="flex w-24 flex-col gap-1">
          <span className="tabular-nums">{r.score.toFixed(0)}</span>
          <ProgressBar value={r.score} max={100} tone={r.score > 75 ? "success" : r.score > 55 ? "warning" : "danger"} />
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader title="عملکرد تأمین‌کنندگان" subtitle="وزن یکسان ۲۵٪ برای پذیرش، سرعت، ارسال به‌موقع و کیفیت" />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.supplierId}
        initialSortKey="score"
        pageSize={8}
        testId="supplier-performance"
        onRowClick={onSelect ? (r) => onSelect(r.supplierId) : undefined}
        mobileCard={(r) => (
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.supplierName}</span>
              <span className="tabular-nums text-slate-500">{r.score.toFixed(0)}/100</span>
            </div>
            <span className="text-slate-500">
              {r.fulfillments} تأمین · پذیرش {formatPercent(r.acceptanceRate, 0)} · GMV {formatMoneyCompact(r.gmvSupplied)}
            </span>
          </div>
        )}
      />
    </Card>
  );
}

/* ------------------------------------------------------ Inspection queue */

export function InspectionQueueCard({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { index, filtered, now } = useDashboard();
  const rows = useMemo(() => buildInspectionQueue(index, filtered, now), [index, filtered, now]);

  const urgencyTone = { safe: "success", soon: "warning", critical: "danger", expired: "neutral" } as const;
  const urgencyLabel = { safe: ">24h", soon: "<24h", critical: "<6h", expired: "منقضی" } as const;

  const columns: Array<Column<(typeof rows)[number]>> = [
    { key: "order", header: "سفارش", value: (r) => r.orderCode },
    { key: "customer", header: "مشتری VIP", value: (r) => r.customer },
    { key: "delivered", header: "تحویل", value: (r) => r.deliveredAt, secondary: true, render: (r) => formatDateDual(r.deliveredAt) },
    { key: "deadline", header: "مهلت بازرسی", value: (r) => r.deadline, render: (r) => formatDateDual(r.deadline) },
    {
      key: "remaining",
      header: "زمان باقی‌مانده",
      value: (r) => r.hoursRemaining,
      align: "end",
      render: (r) => (
        <span className="flex items-center justify-end gap-2">
          <StatusBadge label={urgencyLabel[r.urgency]} tone={urgencyTone[r.urgency]} />
          <span className="tabular-nums">{r.hoursRemaining > 0 ? formatDurationHours(r.hoursRemaining) : "—"}</span>
        </span>
      ),
    },
    { key: "value", header: "مبلغ نگهداری‌شده", value: (r) => r.valueHeld, align: "end", render: (r) => <MoneyValue amount={r.valueHeld} /> },
    { key: "suppliers", header: "تأمین‌کنندگان", value: (r) => r.suppliers, secondary: true },
  ];

  return (
    <Card>
      <CardHeader title="صف بازرسی ۷۲ ساعته" subtitle={`${rows.length} سفارش در بازه بازرسی`} />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.orderId}
        onRowClick={(r) => onOpenOrder(r.orderId)}
        pageSize={8}
        testId="inspection-queue"
        emptyTitle="سفارشی در بازه بازرسی نیست"
        mobileCard={(r) => (
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.orderCode}</span>
              <StatusBadge label={urgencyLabel[r.urgency]} tone={urgencyTone[r.urgency]} />
            </div>
            <span className="text-slate-500">{r.customer}</span>
            <span className="text-slate-500">{formatMoney(r.valueHeld)}</span>
          </div>
        )}
      />
    </Card>
  );
}

/* --------------------------------------------------------- Orders table */

export function buildOrdersCsv(rows: OrderRow[]): string {
  const header = [
    "Order ID",
    "VIP Customer",
    "Order Date",
    "Catalogue",
    "Items",
    "Total Amount",
    "Escrow",
    "Fulfillment",
    "Shipment",
    "Settlement",
    "Status",
  ];
  const lines = rows.map((r) =>
    [
      r.order.code,
      r.customerName,
      r.order.createdAt.slice(0, 10),
      r.catalogueName,
      r.order.itemCount,
      r.order.total,
      r.escrow?.status ?? "",
      r.fulfillmentSummary,
      r.shipmentSummary,
      r.settlementSummary,
      r.order.status,
    ]
      .map(toCsvValue)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function WholesaleOrdersTable({
  onOpenOrder,
  pageSize = 10,
}: {
  onOpenOrder: (orderId: string) => void;
  pageSize?: number;
}) {
  const { index, filtered, now } = useDashboard();
  const rows = useMemo(() => buildOrderRows(index, filtered, now), [index, filtered, now]);

  const download = () => {
    const csv = buildOrdersCsv(rows);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kolbe-vintage-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Array<Column<OrderRow>> = [
    { key: "code", header: "شناسه سفارش", value: (r) => r.order.code },
    { key: "customer", header: "مشتری VIP", value: (r) => r.customerName },
    { key: "date", header: "تاریخ", value: (r) => r.order.createdAt, render: (r) => formatDateDual(r.order.createdAt) },
    { key: "catalogue", header: "کاتالوگ", value: (r) => r.catalogueName, secondary: true },
    { key: "items", header: "اقلام", value: (r) => r.order.itemCount, align: "end" },
    { key: "total", header: "مبلغ کل", value: (r) => r.order.total, align: "end", render: (r) => <MoneyValue amount={r.order.total} /> },
    {
      key: "payment",
      header: "پرداخت/امانی",
      value: (r) => r.escrow?.status ?? "",
      secondary: true,
      render: (r) => (r.escrow ? <StatusBadge label={r.escrow.status} tone="info" /> : "—"),
    },
    { key: "fulfillment", header: "تأمین", value: (r) => r.fulfillmentSummary, align: "end" },
    { key: "shipment", header: "ارسال", value: (r) => r.shipmentSummary, align: "end", secondary: true },
    {
      key: "inspection",
      header: "بازرسی",
      value: (r) => r.inspectionHoursRemaining ?? 9999,
      align: "end",
      secondary: true,
      render: (r) =>
        r.inspectionHoursRemaining === undefined
          ? "—"
          : r.inspectionHoursRemaining > 0
            ? formatDurationHours(r.inspectionHoursRemaining)
            : "پایان‌یافته",
    },
    { key: "settlement", header: "تسویه", value: (r) => r.settlementSummary, align: "end" },
    {
      key: "status",
      header: "وضعیت",
      value: (r) => r.order.status,
      render: (r) => <StatusBadge label={ORDER_STATUS_LABEL[r.order.status]} tone={ORDER_STATUS_TONE[r.order.status]} />,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="سفارش‌های عمده‌فروشی"
        subtitle={`${rows.length} سفارش مطابق فیلترها`}
        action={
          <button
            type="button"
            onClick={download}
            data-testid="export-csv"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            خروجی CSV
          </button>
        }
      />
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.order.id}
        onRowClick={(r) => onOpenOrder(r.order.id)}
        pageSize={pageSize}
        initialSortKey="date"
        testId="orders-table"
        mobileCard={(r) => (
          <div className="flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.order.code}</span>
              <StatusBadge label={ORDER_STATUS_LABEL[r.order.status]} tone={ORDER_STATUS_TONE[r.order.status]} />
            </div>
            <span className="text-slate-500">{r.customerName}</span>
            <div className="flex items-center justify-between text-slate-500">
              <span>{formatDateDual(r.order.createdAt)}</span>
              <span className="tabular-nums">{formatMoney(r.order.total)}</span>
            </div>
          </div>
        )}
      />
    </Card>
  );
}

/* ------------------------------------------------------- Business flow */

export function BusinessFlowCard() {
  const { filtered } = useDashboard();
  const orders = filtered.orders.length;
  const fulfillments = filtered.fulfillments.length;
  const settlements = filtered.settlements.length;

  const node = (title: string, subtitle: string, tone: string) => (
    <div className={cn("rounded-xl border px-3 py-2 text-center", tone)}>
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[11px] opacity-70">{subtitle}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="جریان کسب‌وکار"
        subtitle="مشتری VIP ↔ کلبه وینتیج ↔ تأمین‌کننده — مشتری هرگز مستقیم با تأمین‌کننده در ارتباط نیست"
      />
      <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          {node("مشتری VIP", `${formatNumber(orders)} سفارش`, "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200")}
          <p className="text-center text-[11px] text-slate-400">↓ ثبت سفارش و پرداخت</p>
          {node("پرداخت در امانی", "نگهداری تا تأیید تحویل", "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200")}
        </div>
        <div className="flex flex-col gap-2">
          {node("کلبه وینتیج", "اعتبارسنجی و تفکیک اقلام", "border-navy/30 bg-navy/5 text-navy dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200")}
          <p className="text-center text-[11px] text-slate-400">↓ تولید درخواست تأمین</p>
          {node("درخواست‌های تأمین", `${formatNumber(fulfillments)} درخواست`, "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200")}
        </div>
        <div className="flex flex-col gap-2">
          {node("تأمین‌کنندگان", "آماده‌سازی، بسته‌بندی، ارسال", "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200")}
          <p className="text-center text-[11px] text-slate-400">↓ تحویل، بازرسی، کمیسیون</p>
          {node("تسویه تأمین‌کننده", `${formatNumber(settlements)} تسویه`, "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200")}
        </div>
      </div>
      <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        ۱ سفارش ← N درخواست تأمین ← N تسویه تأمین‌کننده · مبلغ سفارش ≠ مبلغ قابل پرداخت به تأمین‌کننده
      </p>
    </Card>
  );
}

/* --------------------------------------------------------- Small tables */

export function SettlementStatusMini() {
  const { filtered } = useDashboard();
  const rows = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const s of filtered.settlements) {
      const e = map.get(s.status) ?? { count: 0, amount: 0 };
      e.count += 1;
      e.amount += s.payableAmount;
      map.set(s.status, e);
    }
    return Array.from(map.entries());
  }, [filtered.settlements]);

  return (
    <Card>
      <CardHeader title="وضعیت تسویه‌ها" subtitle="سمت تأمین‌کننده" />
      {rows.length === 0 ? (
        <EmptyState title="تسویه‌ای در بازه انتخابی نیست" />
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(([status, v]) => (
            <li key={status} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <StatusBadge
                label={SETTLEMENT_STATUS_LABEL[status as keyof typeof SETTLEMENT_STATUS_LABEL]}
                tone={SETTLEMENT_STATUS_TONE[status as keyof typeof SETTLEMENT_STATUS_TONE]}
              />
              <span className="flex items-center gap-3 text-slate-600 dark:text-slate-300">
                <span className="tabular-nums text-xs text-slate-400">{v.count} مورد</span>
                <MoneyValue amount={v.amount} compact />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FulfillmentStatusMini() {
  const { filtered } = useDashboard();
  const rows = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of filtered.fulfillments) map.set(f.status, (map.get(f.status) ?? 0) + 1);
    return Array.from(map.entries());
  }, [filtered.fulfillments]);
  return (
    <Card>
      <CardHeader title="خلاصه تأمین" subtitle="تعداد درخواست‌ها بر اساس وضعیت" />
      <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map(([status, count]) => (
          <li key={status} className="flex items-center justify-between px-5 py-2.5 text-sm">
            <StatusBadge
              label={FULFILLMENT_STATUS_LABEL[status as keyof typeof FULFILLMENT_STATUS_LABEL]}
              tone={FULFILLMENT_STATUS_TONE[status as keyof typeof FULFILLMENT_STATUS_TONE]}
            />
            <span className="tabular-nums text-slate-600 dark:text-slate-300">{formatNumber(count)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
