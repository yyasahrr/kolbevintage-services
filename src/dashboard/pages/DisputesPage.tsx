import { useMemo, useState } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { StatusBarChart, CHART_COLORS } from "../components/charts";
import { DISPUTE_STATUS_LABEL, DISPUTE_STATUS_TONE } from "../domain/labels";
import { formatDateDual, formatDurationHours, formatMoneyCompact, formatNumber, hoursBetween } from "../lib/format";
import { useDashboard } from "../state";
import type { Dispute, DisputeResolution, DisputeStatus } from "../domain/types";

const RESOLUTION_LABEL: Record<DisputeResolution, string> = {
  full_supplier_payment: "پرداخت کامل به تأمین‌کننده",
  partial_settlement: "تسویه جزئی",
  refund: "بازپرداخت به مشتری",
  replacement: "جایگزینی / مرجوعی",
};

export function DisputesPage({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { index, filtered, now, dispatch } = useDashboard();
  const [resolving, setResolving] = useState<Dispute | null>(null);

  const open = filtered.disputes.filter((d) => d.status !== "resolved");
  const frozen = open.reduce((s, d) => s + d.amountFrozen, 0);
  const avgAge = open.length
    ? open.reduce((s, d) => s + hoursBetween(d.openedAt, now), 0) / open.length
    : 0;

  const chart = useMemo(() => {
    const counts = new Map<DisputeStatus, number>();
    for (const d of filtered.disputes) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
    const palette: Record<DisputeStatus, string> = {
      open: CHART_COLORS.rose,
      waiting_customer: CHART_COLORS.amber,
      waiting_supplier: CHART_COLORS.violet,
      under_review: CHART_COLORS.indigo,
      resolved: CHART_COLORS.emerald,
    };
    return Array.from(counts.entries()).map(([k, v]) => ({ label: DISPUTE_STATUS_LABEL[k], value: v, color: palette[k] }));
  }, [filtered.disputes]);

  const columns: Array<Column<Dispute>> = [
    { key: "code", header: "کد اختلاف", value: (d) => d.code },
    { key: "order", header: "سفارش", value: (d) => index.orderById.get(d.orderId)?.code ?? d.orderId },
    { key: "customer", header: "مشتری", value: (d) => index.customerById.get(d.customerId)?.company ?? d.customerId },
    { key: "supplier", header: "تأمین‌کننده", value: (d) => index.supplierById.get(d.supplierId)?.name ?? d.supplierId },
    { key: "reason", header: "دلیل", value: (d) => d.reason, secondary: true },
    { key: "amount", header: "مبلغ مسدود", value: (d) => d.amountFrozen, align: "end", render: (d) => <MoneyValue amount={d.amountFrozen} /> },
    { key: "opened", header: "زمان ثبت", value: (d) => d.openedAt, secondary: true, render: (d) => formatDateDual(d.openedAt) },
    {
      key: "age",
      header: "سن",
      value: (d) => hoursBetween(d.openedAt, now),
      align: "end",
      render: (d) => formatDurationHours(hoursBetween(d.openedAt, now)),
    },
    {
      key: "status",
      header: "وضعیت",
      value: (d) => d.status,
      render: (d) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge label={DISPUTE_STATUS_LABEL[d.status]} tone={DISPUTE_STATUS_TONE[d.status]} />
          {d.resolution ? (
            <span className="text-[10px] text-slate-400">{RESOLUTION_LABEL[d.resolution]}</span>
          ) : null}
        </span>
      ),
    },
    { key: "admin", header: "کارشناس", value: (d) => d.assignedAdmin, secondary: true },
    {
      key: "actions",
      header: "اقدام",
      render: (d) =>
        d.status === "resolved" ? (
          <span className="text-[11px] text-slate-400">—</span>
        ) : (
          <div className="flex justify-end">
            <ActionButton variant="primary" onClick={() => setResolving(d)} testId={`resolve-${d.id}`}>
              حل اختلاف
            </ActionButton>
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="مشتری اختلاف را با کلبه وینتیج مطرح می‌کند؛ تأمین‌کننده فقط مدرک ارائه می‌دهد">
          پایش اختلافات
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="اختلافات باز" value={formatNumber(open.length)} tone="danger" />
          <MetricCard label="مبلغ مسدود" value={formatMoneyCompact(frozen)} tone="warning" />
          <MetricCard label="میانگین سن اختلاف" value={formatDurationHours(avgAge)} tone="progress" />
          <MetricCard label="کل اختلافات بازه" value={formatNumber(filtered.disputes.length)} tone="info" />
        </div>
      </section>

      <Card>
        <CardHeader title="توزیع وضعیت اختلافات" subtitle="تعداد بر اساس وضعیت" />
        {chart.length === 0 ? null : <StatusBarChart data={chart} colorKey="chart-disputes" />}
      </Card>

      <Card>
        <CardHeader title="فهرست اختلافات" subtitle={`${filtered.disputes.length} مورد`} />
        <DataTable
          rows={filtered.disputes}
          columns={columns}
          rowKey={(d) => d.id}
          onRowClick={(d) => onOpenOrder(d.orderId)}
          initialSortKey="opened"
          pageSize={12}
          testId="disputes-table"
          emptyTitle="اختلافی در بازه انتخابی ثبت نشده"
          mobileCard={(d) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{d.code}</span>
                <StatusBadge label={DISPUTE_STATUS_LABEL[d.status]} tone={DISPUTE_STATUS_TONE[d.status]} />
              </div>
              <span className="text-slate-500">{d.reason}</span>
              <span className="tabular-nums text-slate-500">{formatMoneyCompact(d.amountFrozen)}</span>
            </div>
          )}
        />
      </Card>

      {resolving ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="حل اختلاف">
          <button type="button" aria-label="انصراف" onClick={() => setResolving(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900" data-testid="resolve-dialog">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">حل اختلاف {resolving.code}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {resolving.reason} · مبلغ مسدود: {formatMoneyCompact(resolving.amountFrozen)}
            </p>
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              بازپرداخت از مبلغ قابل پرداخت تأمین‌کننده کسر می‌شود، نه از مبلغ سفارش مشتری. پس از حل اختلاف، وجه امانی از حالت مسدود خارج می‌شود.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {(Object.keys(RESOLUTION_LABEL) as DisputeResolution[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`resolution-${r}`}
                  onClick={() => {
                    dispatch({ type: "dispute/resolve", disputeId: resolving.id, resolution: r });
                    setResolving(null);
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-right text-xs text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {RESOLUTION_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-start">
              <ActionButton onClick={() => setResolving(null)}>انصراف</ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
