import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { DataTable, type Column } from "../components/DataTable";
import { DonutChart, CHART_COLORS } from "../components/charts";
import { InspectionQueueCard } from "../components/modules";
import { ESCROW_STATUS_LABEL, ESCROW_STATUS_TONE } from "../domain/labels";
import { escrowByStatus } from "../domain/selectors";
import { formatDateDual, formatMoneyCompact } from "../lib/format";
import { useDashboard } from "../state";
import type { EscrowStatus, EscrowTransaction } from "../domain/types";

export function EscrowPage({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { index, filtered, kpis } = useDashboard();

  const byStatus = useMemo(() => escrowByStatus(filtered), [filtered]);
  const frozen = filtered.escrows.filter((e) => e.status === "frozen").reduce((s, e) => s + e.amountHeld, 0);
  const released = filtered.escrows.reduce((s, e) => s + e.amountReleased, 0);

  const palette: Record<string, string> = {
    held: CHART_COLORS.sky,
    frozen: CHART_COLORS.rose,
    ready: CHART_COLORS.emerald,
    partially_released: CHART_COLORS.amber,
    released: CHART_COLORS.slate,
    refunded: CHART_COLORS.violet,
  };
  const donut = byStatus.map((b) => ({
    label: ESCROW_STATUS_LABEL[b.status as EscrowStatus],
    value: Math.round(b.amount / 1_000_000),
    color: palette[b.status] ?? CHART_COLORS.navy,
  }));

  const columns: Array<Column<EscrowTransaction>> = [
    { key: "order", header: "سفارش", value: (e) => index.orderById.get(e.orderId)?.code ?? e.orderId },
    {
      key: "customer",
      header: "مشتری VIP",
      value: (e) => {
        const o = index.orderById.get(e.orderId);
        return o ? (index.customerById.get(o.customerId)?.company ?? "—") : "—";
      },
    },
    {
      key: "status",
      header: "وضعیت امانی",
      value: (e) => e.status,
      render: (e) => <StatusBadge label={ESCROW_STATUS_LABEL[e.status]} tone={ESCROW_STATUS_TONE[e.status]} />,
    },
    { key: "held", header: "نگهداری‌شده", value: (e) => e.amountHeld, align: "end", render: (e) => <MoneyValue amount={e.amountHeld} /> },
    { key: "released", header: "آزادشده", value: (e) => e.amountReleased, align: "end", secondary: true, render: (e) => <MoneyValue amount={e.amountReleased} /> },
    { key: "refunded", header: "بازپرداخت", value: (e) => e.amountRefunded, align: "end", secondary: true, render: (e) => <MoneyValue amount={e.amountRefunded} /> },
    { key: "heldAt", header: "تاریخ نگهداری", value: (e) => e.heldAt, secondary: true, render: (e) => formatDateDual(e.heldAt) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="پرداخت مشتری ≠ تسویه تأمین‌کننده">وضعیت وجوه امانی</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="موجودی امانی" value={formatMoneyCompact(kpis.escrowBalance.value)} delta={kpis.escrowBalance.delta} tone="info" />
          <MetricCard label="آماده تسویه" value={formatMoneyCompact(kpis.readyForSettlement.value)} tone="success" />
          <MetricCard label="مسدود به دلیل اختلاف" value={formatMoneyCompact(frozen)} tone="danger" />
          <MetricCard label="آزادشده" value={formatMoneyCompact(released)} tone="neutral" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="توزیع وجوه امانی" subtitle="میلیون تومان" />
          {donut.length === 0 ? null : (
            <DonutChart data={donut} centerLabel="امانی" centerValue={formatMoneyCompact(kpis.escrowBalance.value)} />
          )}
        </Card>
        <div className="lg:col-span-2">
          <InspectionQueueCard onOpenOrder={onOpenOrder} />
        </div>
      </div>

      <Card>
        <CardHeader title="تراکنش‌های امانی" subtitle={`${filtered.escrows.length} تراکنش`} />
        <DataTable
          rows={filtered.escrows}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => onOpenOrder(e.orderId)}
          initialSortKey="held"
          pageSize={12}
          testId="escrow-table"
          mobileCard={(e) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {index.orderById.get(e.orderId)?.code}
                </span>
                <StatusBadge label={ESCROW_STATUS_LABEL[e.status]} tone={ESCROW_STATUS_TONE[e.status]} />
              </div>
              <span className="text-slate-500">{formatMoneyCompact(e.amountHeld)}</span>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
