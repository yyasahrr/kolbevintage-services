import { useMemo } from "react";
import { cn } from "@/utils/cn";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle, StatusBadge } from "../components/primitives";
import { SlaBars } from "../components/charts";
import { nextStepLabel } from "../domain/actions";
import {
  FULFILLMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_TONE,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "../domain/labels";
import { SLA } from "../domain/generate";
import { formatDateDual, formatDurationHours, formatMoneyCompact, formatNumber, hoursBetween } from "../lib/format";
import { useDashboard } from "../state";
import type { FulfillmentRequest, Shipment, SupplierSettlement } from "../domain/types";

/**
 * Supplier-facing portal.
 *
 * Hard domain boundary: this view may ONLY read fulfillment requests, shipments
 * and settlements belonging to the selected supplier. It must never surface the
 * VIP customer, the customer order total, escrow balances or disputes raised by
 * the customer — the supplier's counterparty is Kolbe Vintage, nothing else.
 */
export function SupplierPortalPage({
  supplierId,
  onSelectSupplier,
}: {
  supplierId: string;
  onSelectSupplier: (supplierId: string) => void;
}) {
  const { data, now, dispatch } = useDashboard();

  const supplier = data.suppliers.find((s) => s.id === supplierId) ?? data.suppliers[0];
  const activeId = supplier?.id;

  const fulfillments = useMemo(
    () => data.fulfillments.filter((f) => f.supplierId === activeId),
    [data.fulfillments, activeId],
  );
  const shipments = useMemo(
    () => data.shipments.filter((s) => s.supplierId === activeId),
    [data.shipments, activeId],
  );
  const settlements = useMemo(
    () => data.settlements.filter((s) => s.supplierId === activeId),
    [data.settlements, activeId],
  );

  const pending = fulfillments.filter((f) => f.status === "requested");
  const inProgress = fulfillments.filter((f) =>
    ["accepted", "preparing", "ready_to_ship", "shipped"].includes(f.status),
  );
  const earned = settlements.filter((s) => s.status === "paid").reduce((a, s) => a + s.payableAmount, 0);
  const awaiting = settlements
    .filter((s) => s.status !== "paid" && s.status !== "failed")
    .reduce((a, s) => a + s.payableAmount, 0);

  const slaItems = useMemo(() => {
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const accept = fulfillments.filter((f) => f.acceptedAt).map((f) => hoursBetween(f.requestedAt, f.acceptedAt!));
    const prep = fulfillments
      .filter((f) => f.preparingAt && f.readyAt)
      .map((f) => hoursBetween(f.preparingAt!, f.readyAt!));
    const ship = fulfillments.filter((f) => f.readyAt && f.shippedAt).map((f) => hoursBetween(f.readyAt!, f.shippedAt!));
    return [
      { label: "درخواست ← پذیرش", avgHours: avg(accept), targetHours: SLA.acceptHours, samples: accept.length },
      { label: "پذیرش ← آماده‌سازی", avgHours: avg(prep), targetHours: SLA.prepareHours, samples: prep.length },
      { label: "آماده‌سازی ← ارسال", avgHours: avg(ship), targetHours: SLA.shipHours, samples: ship.length },
    ];
  }, [fulfillments]);

  const ffColumns: Array<Column<FulfillmentRequest>> = [
    { key: "code", header: "درخواست", value: (f) => f.code },
    { key: "items", header: "اقلام", value: (f) => f.items.length, align: "end" },
    {
      key: "units",
      header: "تعداد",
      value: (f) => f.items.reduce((s, i) => s + i.quantity, 0),
      align: "end",
      render: (f) => formatNumber(f.items.reduce((s, i) => s + i.quantity, 0)),
    },
    {
      key: "payout",
      header: "مبلغ تأمین (بهای شما)",
      value: (f) => f.supplierCostTotal,
      align: "end",
      render: (f) => <MoneyValue amount={f.supplierCostTotal} />,
    },
    { key: "requested", header: "زمان درخواست", value: (f) => f.requestedAt, render: (f) => formatDateDual(f.requestedAt) },
    {
      key: "age",
      header: "سن",
      value: (f) => hoursBetween(f.requestedAt, now),
      align: "end",
      secondary: true,
      render: (f) => formatDurationHours(hoursBetween(f.requestedAt, now)),
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
                <ActionButton
                  variant="primary"
                  testId={`portal-accept-${f.id}`}
                  onClick={() => dispatch({ type: "fulfillment/accept", fulfillmentId: f.id })}
                >
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
          </div>
        );
      },
    },
  ];

  const shipColumns: Array<Column<Shipment>> = [
    { key: "tracking", header: "کد رهگیری", value: (s) => s.trackingCode },
    { key: "carrier", header: "حامل", value: (s) => s.carrier },
    { key: "shipped", header: "ارسال", value: (s) => s.shippedAt, render: (s) => formatDateDual(s.shippedAt) },
    { key: "eta", header: "تخمین تحویل", value: (s) => s.etaAt, secondary: true, render: (s) => formatDateDual(s.etaAt) },
    {
      key: "status",
      header: "وضعیت",
      value: (s) => s.status,
      render: (s) => <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />,
    },
  ];

  const setColumns: Array<Column<SupplierSettlement>> = [
    { key: "code", header: "کد تسویه", value: (s) => s.code },
    { key: "fulfilled", header: "مبلغ تأمین‌شده", value: (s) => s.fulfilledAmount, align: "end", render: (s) => <MoneyValue amount={s.fulfilledAmount} /> },
    { key: "commission", header: "کارمزد کلبه وینتیج", value: (s) => s.commissionAmount, align: "end", render: (s) => <MoneyValue amount={s.commissionAmount} /> },
    { key: "adj", header: "کسورات", value: (s) => s.adjustmentTotal + s.refundAmount, align: "end", secondary: true, render: (s) => <MoneyValue amount={s.adjustmentTotal + s.refundAmount} /> },
    { key: "payable", header: "پرداختی به شما", value: (s) => s.payableAmount, align: "end", render: (s) => <MoneyValue amount={s.payableAmount} /> },
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
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-semibold">نمای تأمین‌کننده.</strong> این صفحه دقیقاً همان چیزی را
        نشان می‌دهد که یک تأمین‌کننده می‌بیند: فقط درخواست‌های تأمین، مرسولات و تسویه‌های خودش.
        هویت مشتری VIP، مبلغ سفارش مشتری، موجودی امانی و اختلافات مشتری در این نما وجود ندارند —
        طرف حساب تأمین‌کننده فقط کلبه وینتیج است.
      </div>

      <section>
        <SectionTitle hint="برای شبیه‌سازی، تأمین‌کننده را انتخاب کنید">
          پورتال تأمین‌کننده — {supplier?.name}
        </SectionTitle>

        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="انتخاب تأمین‌کننده">
          {data.suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSupplier(s.id)}
              aria-pressed={s.id === activeId}
              data-testid={`portal-supplier-${s.id}`}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs transition-colors motion-reduce:transition-none",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
                s.id === activeId
                  ? "bg-navy text-white dark:bg-sky-500/20 dark:text-sky-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="درخواست‌های در انتظار پاسخ" value={formatNumber(pending.length)} tone="warning" />
          <MetricCard label="در جریان" value={formatNumber(inProgress.length)} tone="progress" />
          <MetricCard label="دریافتی تا امروز" value={formatMoneyCompact(earned)} tone="success" />
          <MetricCard label="در انتظار دریافت" value={formatMoneyCompact(awaiting)} tone="info" />
        </div>
      </section>

      <Card>
        <CardHeader title="عملکرد SLA شما" subtitle="میانگین زمان‌های شما در برابر تعهد قرارداد" />
        <SlaBars items={slaItems} />
      </Card>

      <Card>
        <CardHeader
          title="درخواست‌های تأمین"
          subtitle={`${fulfillments.length} درخواست از سوی کلبه وینتیج`}
        />
        <DataTable
          rows={fulfillments}
          columns={ffColumns}
          rowKey={(f) => f.id}
          initialSortKey="requested"
          pageSize={10}
          testId="portal-fulfillments"
          emptyTitle="درخواست تأمینی برای این تأمین‌کننده ثبت نشده"
          mobileCard={(f) => (
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800 dark:text-slate-100">{f.code}</span>
                <StatusBadge label={FULFILLMENT_STATUS_LABEL[f.status]} tone={FULFILLMENT_STATUS_TONE[f.status]} />
              </div>
              <span className="tabular-nums text-slate-500">{formatMoneyCompact(f.supplierCostTotal)}</span>
            </div>
          )}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="مرسولات شما" subtitle={`${shipments.length} مرسوله`} />
          <DataTable
            rows={shipments}
            columns={shipColumns}
            rowKey={(s) => s.id}
            initialSortKey="shipped"
            pageSize={8}
            testId="portal-shipments"
            emptyTitle="مرسوله‌ای ثبت نشده"
            mobileCard={(s) => (
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-800 dark:text-slate-100">{s.trackingCode}</span>
                <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />
              </div>
            )}
          />
        </Card>

        <Card>
          <CardHeader title="تسویه‌های شما" subtitle={`${settlements.length} تسویه`} />
          <DataTable
            rows={settlements}
            columns={setColumns}
            rowKey={(s) => s.id}
            initialSortKey="due"
            initialSortDir="asc"
            pageSize={8}
            testId="portal-settlements"
            emptyTitle="تسویه‌ای ثبت نشده"
            mobileCard={(s) => (
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800 dark:text-slate-100">{s.code}</span>
                  <StatusBadge label={SETTLEMENT_STATUS_LABEL[s.status]} tone={SETTLEMENT_STATUS_TONE[s.status]} />
                </div>
                <span className="tabular-nums text-slate-500">{formatMoneyCompact(s.payableAmount)}</span>
              </div>
            )}
          />
        </Card>
      </div>
    </div>
  );
}
