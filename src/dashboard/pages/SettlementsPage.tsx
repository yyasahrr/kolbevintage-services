import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { DataTable, type Column } from "../components/DataTable";
import { SettlementStatusMini } from "../components/modules";
import { SETTLEMENT_STATUS_LABEL, SETTLEMENT_STATUS_TONE } from "../domain/labels";
import { formatDateDual, formatMoneyCompact } from "../lib/format";
import { useDashboard } from "../state";
import type { SupplierSettlement } from "../domain/types";

const DAY = 86_400_000;

export function SettlementsPage({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { index, filtered, kpis, now } = useDashboard();

  const dueToday = useMemo(
    () =>
      filtered.settlements.filter((s) => {
        if (s.status === "paid" || s.status === "failed") return false;
        const due = new Date(s.dueAt).getTime();
        return due >= now && due <= now + DAY;
      }),
    [filtered.settlements, now],
  );
  const dueWeek = useMemo(
    () =>
      filtered.settlements.filter((s) => {
        if (s.status === "paid" || s.status === "failed") return false;
        const due = new Date(s.dueAt).getTime();
        return due >= now && due <= now + 7 * DAY;
      }),
    [filtered.settlements, now],
  );

  const columns: Array<Column<SupplierSettlement>> = [
    { key: "code", header: "کد تسویه", value: (s) => s.code },
    { key: "order", header: "سفارش", value: (s) => index.orderById.get(s.orderId)?.code ?? s.orderId },
    { key: "supplier", header: "تأمین‌کننده", value: (s) => index.supplierById.get(s.supplierId)?.name ?? s.supplierId },
    { key: "fulfilled", header: "مبلغ تأمین‌شده", value: (s) => s.fulfilledAmount, align: "end", render: (s) => <MoneyValue amount={s.fulfilledAmount} /> },
    { key: "commission", header: "کمیسیون کلبه", value: (s) => s.commissionAmount, align: "end", render: (s) => <MoneyValue amount={s.commissionAmount} /> },
    { key: "refund", header: "بازپرداخت", value: (s) => s.refundAmount, align: "end", secondary: true, render: (s) => <MoneyValue amount={s.refundAmount} /> },
    { key: "adj", header: "تعدیل‌ها", value: (s) => s.adjustmentTotal, align: "end", secondary: true, render: (s) => <MoneyValue amount={s.adjustmentTotal} /> },
    { key: "payable", header: "قابل پرداخت", value: (s) => s.payableAmount, align: "end", render: (s) => <MoneyValue amount={s.payableAmount} /> },
    { key: "due", header: "سررسید", value: (s) => s.dueAt, render: (s) => formatDateDual(s.dueAt) },
    {
      key: "status",
      header: "وضعیت",
      value: (s) => s.status,
      render: (s) => <StatusBadge label={SETTLEMENT_STATUS_LABEL[s.status]} tone={SETTLEMENT_STATUS_TONE[s.status]} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="مبلغ قابل پرداخت = مبلغ تأمین‌شده − کمیسیون − بازپرداخت − تعدیل‌ها">
          تسویه تأمین‌کنندگان
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="مجموع تسویه‌شده" value={formatMoneyCompact(kpis.totalSettled)} tone="success" />
          <MetricCard label="در انتظار تسویه" value={formatMoneyCompact(kpis.pendingSettlement)} tone="warning" />
          <MetricCard
            label="سررسید امروز"
            value={formatMoneyCompact(dueToday.reduce((s, x) => s + x.payableAmount, 0))}
            hint={`${dueToday.length} تسویه`}
            tone="danger"
          />
          <MetricCard
            label="سررسید این هفته"
            value={formatMoneyCompact(dueWeek.reduce((s, x) => s + x.payableAmount, 0))}
            hint={`${dueWeek.length} تسویه`}
            tone="progress"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MetricCard label="کمیسیون کسب‌شده" value={formatMoneyCompact(kpis.commission.value)} delta={kpis.commission.delta} tone="info" />
          <MetricCard label="تعدیل‌ها" value={formatMoneyCompact(kpis.adjustments)} tone="warning" />
          <MetricCard label="بازپرداخت‌ها" value={formatMoneyCompact(kpis.refunds)} tone="danger" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SettlementStatusMini />
        <Card className="lg:col-span-2">
          <CardHeader title="فرمول تسویه" subtitle="تفکیک روشن پول مشتری از پول تأمین‌کننده" />
          <div className="p-5 text-sm leading-7 text-slate-600 dark:text-slate-300">
            <p className="rounded-xl bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Supplier Payable
              <br />= Fulfilled Order Amount
              <br />− Kolbe Vintage Commission (8–12%)
              <br />− Refunds
              <br />− Damage Adjustments
              <br />− Other Authorized Adjustments
            </p>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              مبلغ سفارش مشتری هرگز برابر مبلغ قابل پرداخت تأمین‌کننده نیست؛ تسویه تنها پس از پایان
              بازه بازرسی ۷۲ ساعته و نبود اختلاف باز انجام می‌شود.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="فهرست تسویه‌ها" subtitle={`${filtered.settlements.length} تسویه مطابق فیلترها`} />
        <DataTable
          rows={filtered.settlements}
          columns={columns}
          rowKey={(s) => s.id}
          onRowClick={(s) => onOpenOrder(s.orderId)}
          initialSortKey="due"
          initialSortDir="asc"
          pageSize={12}
          testId="settlements-table"
          mobileCard={(s) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{s.code}</span>
                <StatusBadge label={SETTLEMENT_STATUS_LABEL[s.status]} tone={SETTLEMENT_STATUS_TONE[s.status]} />
              </div>
              <span className="text-slate-500">{index.supplierById.get(s.supplierId)?.name}</span>
              <span className="tabular-nums text-slate-500">{formatMoneyCompact(s.payableAmount)}</span>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
