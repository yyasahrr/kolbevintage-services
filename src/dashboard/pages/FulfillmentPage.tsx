import { useMemo, useState } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { ActionButton } from "../components/ActionButton";
import { nextStepLabel } from "../domain/actions";
import { DataTable, type Column } from "../components/DataTable";
import { FulfillmentStatusChart, SlaCard } from "../components/modules";
import {
  FULFILLMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "../domain/labels";
import { formatDateDual, formatDurationHours, formatNumber, hoursBetween } from "../lib/format";
import { useDashboard } from "../state";
import type { FulfillmentRequest, Shipment } from "../domain/types";

export function FulfillmentPage({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { data, index, filtered, now, dispatch } = useDashboard();
  const [reassigning, setReassigning] = useState<string | null>(null);

  const delayed = useMemo(() => filtered.fulfillments.filter((f) => f.delayed).length, [filtered.fulfillments]);
  const inTransit = useMemo(
    () => filtered.shipments.filter((s) => s.status === "in_transit" || s.status === "out_for_delivery").length,
    [filtered.shipments],
  );
  const rejected = useMemo(() => filtered.fulfillments.filter((f) => f.status === "rejected").length, [filtered.fulfillments]);

  const ffColumns: Array<Column<FulfillmentRequest>> = [
    { key: "code", header: "درخواست تأمین", value: (f) => f.code },
    {
      key: "order",
      header: "سفارش مشتری",
      value: (f) => index.orderById.get(f.orderId)?.code ?? f.orderId,
    },
    { key: "supplier", header: "تأمین‌کننده", value: (f) => index.supplierById.get(f.supplierId)?.name ?? f.supplierId },
    { key: "requested", header: "زمان درخواست", value: (f) => f.requestedAt, secondary: true, render: (f) => formatDateDual(f.requestedAt) },
    {
      key: "age",
      header: "سن درخواست",
      value: (f) => hoursBetween(f.requestedAt, now),
      align: "end",
      render: (f) => formatDurationHours(hoursBetween(f.requestedAt, now)),
    },
    { key: "value", header: "ارزش مشتری", value: (f) => f.customerValue, align: "end", render: (f) => <MoneyValue amount={f.customerValue} compact /> },
    {
      key: "cost",
      header: "بهای تأمین",
      value: (f) => f.supplierCostTotal,
      align: "end",
      secondary: true,
      render: (f) => <MoneyValue amount={f.supplierCostTotal} compact />,
    },
    {
      key: "status",
      header: "وضعیت",
      value: (f) => f.status,
      render: (f) => (
        <span className="flex items-center gap-1.5">
          {f.delayed ? <StatusBadge label="تأخیر" tone="danger" /> : null}
          <StatusBadge label={FULFILLMENT_STATUS_LABEL[f.status]} tone={FULFILLMENT_STATUS_TONE[f.status]} />
        </span>
      ),
    },
    {
      key: "actions",
      header: "اقدام",
      render: (f) => {
        const step = nextStepLabel(f.status);
        return (
          <div className="flex items-center justify-end gap-1.5">
            {f.status === "requested" ? (
              <>
                <ActionButton variant="primary" onClick={() => dispatch({ type: "fulfillment/accept", fulfillmentId: f.id })}>
                  پذیرش
                </ActionButton>
                <ActionButton variant="danger" onClick={() => dispatch({ type: "fulfillment/reject", fulfillmentId: f.id })}>
                  رد
                </ActionButton>
              </>
            ) : null}
            {step ? (
              <ActionButton variant="primary" onClick={() => dispatch({ type: "fulfillment/advance", fulfillmentId: f.id })}>
                {step}
              </ActionButton>
            ) : null}
            {f.status === "rejected" || f.delayed ? (
              <ActionButton onClick={() => setReassigning(f.id)}>تخصیص مجدد</ActionButton>
            ) : null}
          </div>
        );
      },
    },
  ];

  const reassignTarget = reassigning ? filtered.fulfillments.find((f) => f.id === reassigning) : null;

  const shipColumns: Array<Column<Shipment>> = [
    { key: "tracking", header: "کد رهگیری", value: (s) => s.trackingCode },
    { key: "order", header: "سفارش", value: (s) => index.orderById.get(s.orderId)?.code ?? s.orderId },
    { key: "supplier", header: "تأمین‌کننده", value: (s) => index.supplierById.get(s.supplierId)?.name ?? s.supplierId },
    { key: "carrier", header: "حامل", value: (s) => s.carrier, secondary: true },
    { key: "shipped", header: "زمان ارسال", value: (s) => s.shippedAt, render: (s) => formatDateDual(s.shippedAt) },
    { key: "eta", header: "زمان تخمینی", value: (s) => s.etaAt, secondary: true, render: (s) => formatDateDual(s.etaAt) },
    {
      key: "status",
      header: "وضعیت",
      value: (s) => s.status,
      render: (s) => <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="سمت تأمین: درخواست‌های داخلی کلبه وینتیج به تأمین‌کنندگان">خلاصه تأمین</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="کل درخواست‌های تأمین" value={formatNumber(filtered.fulfillments.length)} tone="info" />
          <MetricCard label="تأخیردار" value={formatNumber(delayed)} tone="danger" />
          <MetricCard label="در مسیر" value={formatNumber(inTransit)} tone="progress" />
          <MetricCard label="رد شده" value={formatNumber(rejected)} tone="warning" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FulfillmentStatusChart />
        <SlaCard />
      </div>

      <Card>
        <CardHeader title="درخواست‌های تأمین" subtitle={`${filtered.fulfillments.length} درخواست مطابق فیلترها`} />
        <DataTable
          rows={filtered.fulfillments}
          columns={ffColumns}
          rowKey={(f) => f.id}
          onRowClick={(f) => onOpenOrder(f.orderId)}
          pageSize={12}
          initialSortKey="requested"
          testId="fulfillment-table"
          mobileCard={(f) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{f.code}</span>
                <StatusBadge label={FULFILLMENT_STATUS_LABEL[f.status]} tone={FULFILLMENT_STATUS_TONE[f.status]} />
              </div>
              <span className="text-slate-500">{index.supplierById.get(f.supplierId)?.name}</span>
            </div>
          )}
        />
      </Card>

      <Card>
        <CardHeader title="مرسولات" subtitle={`${filtered.shipments.length} مرسوله`} />
        <DataTable
          rows={filtered.shipments}
          columns={shipColumns}
          rowKey={(s) => s.id}
          onRowClick={(s) => onOpenOrder(s.orderId)}
          pageSize={10}
          initialSortKey="shipped"
          testId="shipments-table"
          mobileCard={(s) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{s.trackingCode}</span>
                <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />
              </div>
              <span className="text-slate-500">{s.carrier}</span>
            </div>
          )}
        />
      </Card>

      {reassignTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="تخصیص مجدد تأمین‌کننده">
          <button type="button" aria-label="انصراف" onClick={() => setReassigning(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900" data-testid="reassign-dialog">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">تخصیص مجدد {reassignTarget.code}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              تأمین‌کننده جدید انتخاب کنید. سفارش مشتری و مبلغ آن تغییری نمی‌کند و مشتری از این جابه‌جایی مطلع نمی‌شود.
            </p>
            <label className="mt-4 flex flex-col gap-1">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">تأمین‌کننده</span>
              <select
                data-testid="reassign-select"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  dispatch({ type: "fulfillment/reassign", fulfillmentId: reassignTarget.id, supplierId: e.target.value });
                  setReassigning(null);
                }}
                className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">انتخاب کنید…</option>
                {data.suppliers
                  .filter((s) => s.id !== reassignTarget.supplierId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.city}
                    </option>
                  ))}
              </select>
            </label>
            <div className="mt-4 flex justify-start">
              <ActionButton onClick={() => setReassigning(null)}>انصراف</ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
