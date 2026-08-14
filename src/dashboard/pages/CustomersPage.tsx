import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { DataTable, type Column } from "../components/DataTable";
import { DonutChart, CHART_COLORS } from "../components/charts";
import { SEGMENT_LABEL } from "../domain/labels";
import { buildCustomerAnalytics, type CustomerRow } from "../domain/selectors";
import { formatDateDual, formatMoneyCompact, formatNumber, formatPercent } from "../lib/format";
import { useDashboard } from "../state";
import type { CustomerSegment } from "../domain/types";

const SEGMENT_TONE = {
  new: "info",
  active: "success",
  high_value: "progress",
  at_risk: "warning",
  dormant: "neutral",
} as const;

export function CustomersPage({ onSelectCustomer }: { onSelectCustomer: (customerId: string) => void }) {
  const { data, index, filtered } = useDashboard();
  const rows = useMemo(() => buildCustomerAnalytics(data, index, filtered), [data, index, filtered]);

  const totalGmv = rows.reduce((s, r) => s + r.gmv, 0);
  const repeat = rows.filter((r) => r.orders > 1).length;
  const newCustomers = data.customers.filter((c) => c.segment === "new").length;
  const avgOrderValue = rows.length ? totalGmv / rows.reduce((s, r) => s + r.orders, 0) : 0;

  const segmentData = useMemo(() => {
    const counts = new Map<CustomerSegment, number>();
    for (const c of data.customers) counts.set(c.segment, (counts.get(c.segment) ?? 0) + 1);
    const palette: Record<CustomerSegment, string> = {
      new: CHART_COLORS.sky,
      active: CHART_COLORS.emerald,
      high_value: CHART_COLORS.navy,
      at_risk: CHART_COLORS.amber,
      dormant: CHART_COLORS.slate,
    };
    return Array.from(counts.entries()).map(([k, v]) => ({ label: SEGMENT_LABEL[k], value: v, color: palette[k] }));
  }, [data.customers]);

  const columns: Array<Column<CustomerRow>> = [
    { key: "company", header: "مشتری VIP", value: (r) => r.company },
    { key: "name", header: "شخص رابط", value: (r) => r.name, secondary: true },
    { key: "city", header: "شهر", value: (r) => r.city, secondary: true },
    { key: "tier", header: "سطح", value: (r) => r.tier },
    {
      key: "segment",
      header: "بخش‌بندی",
      value: (r) => r.segment,
      render: (r) => (
        <StatusBadge
          label={SEGMENT_LABEL[r.segment as CustomerSegment]}
          tone={SEGMENT_TONE[r.segment as CustomerSegment]}
        />
      ),
    },
    { key: "orders", header: "سفارش‌ها", value: (r) => r.orders, align: "end" },
    { key: "gmv", header: "GMV", value: (r) => r.gmv, align: "end", render: (r) => <MoneyValue amount={r.gmv} compact /> },
    { key: "aov", header: "میانگین سفارش", value: (r) => r.aov, align: "end", render: (r) => <MoneyValue amount={r.aov} compact /> },
    {
      key: "last",
      header: "آخرین سفارش",
      value: (r) => r.lastOrderAt ?? "",
      secondary: true,
      render: (r) => (r.lastOrderAt ? formatDateDual(r.lastOrderAt) : "—"),
    },
    { key: "disputes", header: "اختلاف باز", value: (r) => r.openDisputes, align: "end" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="مشتریان VIP فقط با کلبه وینتیج معامله می‌کنند">تحلیل مشتریان VIP</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="مشتریان فعال در بازه" value={formatNumber(rows.length)} tone="info" />
          <MetricCard label="مشتریان جدید" value={formatNumber(newCustomers)} tone="success" />
          <MetricCard
            label="نرخ خرید مجدد"
            value={formatPercent(rows.length ? (repeat / rows.length) * 100 : 0, 0)}
            tone="progress"
          />
          <MetricCard label="میانگین ارزش سفارش" value={formatMoneyCompact(avgOrderValue)} tone="warning" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="بخش‌بندی مشتریان" subtitle="بر اساس رفتار خرید" />
          <DonutChart data={segmentData} centerLabel="مشتری" centerValue={formatNumber(data.customers.length)} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="برترین مشتریان بر اساس GMV" subtitle="۱۰ مشتری اول" />
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {rows.slice(0, 10).map((r) => (
              <li key={r.customerId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{r.company}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <span className="tabular-nums">{r.orders} سفارش</span>
                  <MoneyValue amount={r.gmv} compact className="text-slate-800 dark:text-slate-100" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="فهرست مشتریان VIP" subtitle={`${rows.length} مشتری در بازه`} />
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.customerId}
          onRowClick={(r) => onSelectCustomer(r.customerId)}
          initialSortKey="gmv"
          pageSize={12}
          testId="customers-table"
          mobileCard={(r) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{r.company}</span>
                <StatusBadge label={SEGMENT_LABEL[r.segment as CustomerSegment]} tone={SEGMENT_TONE[r.segment as CustomerSegment]} />
              </div>
              <span className="text-slate-500">
                {r.orders} سفارش · {formatMoneyCompact(r.gmv)}
              </span>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
