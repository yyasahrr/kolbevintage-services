import {
  BusinessFlowCard,
  FulfillmentStatusChart,
  InspectionQueueCard,
  KPIGrid,
  OperationalAlerts,
  OrderFunnelCard,
  OrderStatusDonut,
  OrderVolumeCard,
  RevenueAnalytics,
  SettlementStatusMini,
  SlaCard,
  SupplierPerformanceTable,
  WholesaleOrdersTable,
} from "../components/modules";
import { SectionTitle } from "../components/primitives";

export function DashboardPage({
  onOpenOrder,
  onNavigate,
}: {
  onOpenOrder: (orderId: string) => void;
  onNavigate: (path: string, params?: Record<string, string>) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="روی هر کارت کلیک کنید تا به صفحه مربوطه بروید">شاخص‌های کلیدی</SectionTitle>
        <KPIGrid onDrill={onNavigate} />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <OperationalAlerts onNavigate={(href) => (window.location.hash = href.replace(/^#/, ""))} />
        </div>
        <div className="xl:col-span-2">
          <RevenueAnalytics />
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InspectionQueueCard onOpenOrder={onOpenOrder} />
        </div>
        <SettlementStatusMini />
      </div>

      <WholesaleOrdersTable onOpenOrder={onOpenOrder} />
    </div>
  );
}
