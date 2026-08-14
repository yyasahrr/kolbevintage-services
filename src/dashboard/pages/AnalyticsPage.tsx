import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle } from "../components/primitives";
import {
  BusinessFlowCard,
  FulfillmentStatusChart,
  OrderFunnelCard,
  OrderStatusDonut,
  OrderVolumeCard,
  RevenueAnalytics,
  SlaCard,
  SupplierPerformanceTable,
} from "../components/modules";
import { buildCatalogueAnalytics, buildProductAnalytics } from "../domain/selectors";
import { formatMoneyCompact, formatNumber, formatPercent } from "../lib/format";
import { useDashboard } from "../state";

export function AnalyticsPage({ onNavigate }: { onNavigate: (path: string, params?: Record<string, string>) => void }) {
  const { data, index, filtered, kpis } = useDashboard();
  const catalogues = useMemo(() => buildCatalogueAnalytics(data, filtered), [data, filtered]);
  const products = useMemo(() => buildProductAnalytics(index, filtered), [index, filtered]);

  const onTime = useMemo(() => {
    const shipped = filtered.fulfillments.filter((f) => f.shippedAt);
    const late = shipped.filter((f) => f.delayed).length;
    return shipped.length ? ((shipped.length - late) / shipped.length) * 100 : 0;
  }, [filtered.fulfillments]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="نمای تحلیلی ترکیبی از سمت مشتری و سمت تأمین">تحلیل‌های کسب‌وکار</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="میانگین ارزش سفارش" value={formatMoneyCompact(kpis.averageOrderValue.value)} delta={kpis.averageOrderValue.delta} tone="info" />
          <MetricCard label="نرخ ارسال به‌موقع" value={formatPercent(onTime, 1)} tone="success" />
          <MetricCard label="سفارش‌های بازه" value={formatNumber(filtered.orders.length)} tone="progress" />
          <MetricCard label="کمیسیون / GMV" value={formatPercent(kpis.grossRevenue.value ? (kpis.commission.value / kpis.grossRevenue.value) * 100 : 0, 1)} tone="warning" />
        </div>
      </section>

      <RevenueAnalytics />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrderVolumeCard />
        <OrderStatusDonut />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrderFunnelCard />
        <BusinessFlowCard />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FulfillmentStatusChart />
        <SlaCard />
      </div>

      <SupplierPerformanceTable onSelect={(id) => onNavigate("/suppliers", { supplier: id })} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="کاتالوگ‌های برتر" subtitle="بر اساس GMV" />
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {catalogues.slice(0, 6).map((c) => (
              <li key={c.catalogueId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{c.name}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <span className="tabular-nums">{formatPercent(c.conversion, 2)}</span>
                  <MoneyValue amount={c.gmv} compact className="text-slate-800 dark:text-slate-100" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="محصولات برتر" subtitle="بر اساس GMV" />
          <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {products.slice(0, 6).map((p) => (
              <li key={p.productId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{p.name}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                  <span className="tabular-nums">{formatNumber(p.units)}</span>
                  <MoneyValue amount={p.gmv} compact className="text-slate-800 dark:text-slate-100" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
