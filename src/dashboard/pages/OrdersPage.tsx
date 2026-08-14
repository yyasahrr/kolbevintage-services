import { useMemo } from "react";
import { MetricCard, SectionTitle } from "../components/primitives";
import { OrderStatusDonut, OrderVolumeCard, WholesaleOrdersTable } from "../components/modules";
import { formatMoneyCompact, formatNumber } from "../lib/format";
import { useDashboard } from "../state";

export function OrdersPage({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { kpis, filtered } = useDashboard();
  const disputed = useMemo(() => filtered.orders.filter((o) => o.status === "disputed").length, [filtered.orders]);
  const inspection = useMemo(() => filtered.orders.filter((o) => o.status === "inspection").length, [filtered.orders]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="سمت مشتری: قرارداد میان مشتری VIP و کلبه وینتیج">خلاصه سفارش‌ها</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="تعداد سفارش" value={formatNumber(filtered.orders.length)} tone="info" />
          <MetricCard
            label="میانگین ارزش سفارش"
            value={formatMoneyCompact(kpis.averageOrderValue.value)}
            delta={kpis.averageOrderValue.delta}
            tone="progress"
          />
          <MetricCard label="در بازه بازرسی" value={formatNumber(inspection)} tone="warning" />
          <MetricCard label="دارای اختلاف" value={formatNumber(disputed)} tone="danger" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrderVolumeCard />
        <OrderStatusDonut />
      </div>

      <WholesaleOrdersTable onOpenOrder={onOpenOrder} pageSize={15} />
    </div>
  );
}
