import { useCallback, useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { ActionButton } from "../dashboard/components/ActionButton";
import { DataTable, type Column } from "../dashboard/components/DataTable";
import { SlaBars } from "../dashboard/components/charts";
import { Card, CardHeader, MetricCard, MoneyValue, StatusBadge } from "../dashboard/components/primitives";
import { applyAction, nextStepLabel } from "../dashboard/domain/actions";
import { generateDataset, SLA } from "../dashboard/domain/generate";
import {
  FULFILLMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_TONE,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
  SHIPMENT_STATUS_LABEL,
  SHIPMENT_STATUS_TONE,
} from "../dashboard/domain/labels";
import { formatDateDual, formatDurationHours, formatMoneyCompact, formatNumber, hoursBetween } from "../dashboard/lib/format";
import { loadDataset, saveDataset } from "../dashboard/lib/persistence";
import { useHashRoute } from "../dashboard/lib/useHashRoute";
import type { FulfillmentRequest, Shipment, SupplierSettlement, WholesaleDataset } from "../dashboard/domain/types";

/**
 * Standalone supplier workspace — deliberately NOT part of the admin shell.
 *
 * A supplier may only ever read its own fulfillment requests, shipments and
 * settlements. VIP customer identity, customer order totals, escrow balances
 * and customer disputes are structurally absent from this bundle's queries.
 */
export function SupplierPortalApp() {
  const { location, navigate } = useHashRoute();
  const [dataset, setDataset] = useState<WholesaleDataset>(() => loadDataset() ?? generateDataset(Date.now()));
  const [toast, setToast] = useState<string | null>(null);
  const now = Date.now();

  const supplierId = location.params.get("supplier") ?? dataset.suppliers[0]?.id ?? "";
  const supplier = dataset.suppliers.find((s) => s.id === supplierId) ?? dataset.suppliers[0];

  const dispatch = useCallback(
    (fulfillmentId: string, kind: "accept" | "reject" | "advance") => {
      setDataset((prev) => {
        const result = applyAction(
          prev,
          kind === "accept"
            ? { type: "fulfillment/accept", fulfillmentId }
            : kind === "reject"
              ? { type: "fulfillment/reject", fulfillmentId }
              : { type: "fulfillment/advance", fulfillmentId },
          Date.now(),
        );
        saveDataset(result.dataset);
        setToast(result.message);
        window.setTimeout(() => setToast(null), 4000);
        return result.dataset;
      });
    },
    [],
  );

  const fulfillments = useMemo(
    () => dataset.fulfillments.filter((f) => f.supplierId === supplier?.id),
    [dataset.fulfillments, supplier?.id],
  );
  const shipments = useMemo(
    () => dataset.shipments.filter((s) => s.supplierId === supplier?.id),
    [dataset.shipments, supplier?.id],
  );
  const settlements = useMemo(
    () => dataset.settlements.filter((s) => s.supplierId === supplier?.id),
    [dataset.settlements, supplier?.id],
  );

  const pending = fulfillments.filter((f) => f.status === "requested");
  const inProgress = fulfillments.filter((f) => ["accepted", "preparing", "ready_to_ship", "shipped"].includes(f.status));
  const earned = settlements.filter((s) => s.status === "paid").reduce((a, s) => a + s.payableAmount, 0);
  const awaiting = settlements.filter((s) => s.status !== "paid" && s.status !== "failed").reduce((a, s) => a + s.payableAmount, 0);

  const slaItems = useMemo(() => {
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const accept = fulfillments.filter((f) => f.acceptedAt).map((f) => hoursBetween(f.requestedAt, f.acceptedAt!));
    const prep = fulfillments.filter((f) => f.preparingAt && f.readyAt).map((f) => hoursBetween(f.preparingAt!, f.readyAt!));
    const ship = fulfillments.filter((f) => f.readyAt && f.shippedAt).map((f) => hoursBetween(f.readyAt!, f.shippedAt!));
    return [
      { label: "درخواست ← پذیرش", avgHours: avg(accept), targetHours: SLA.acceptHours, samples: accept.length },
      { label: "پذیرش ← آماده‌سازی", avgHours: avg(prep), targetHours: SLA.prepareHours, samples: prep.length },
      { label: "آماده‌سازی ← ارسال", avgHours: avg(ship), targetHours: SLA.shipHours, samples: ship.length },
    ];
  }, [fulfillments]);

  const ffColumns: Array<Column<FulfillmentRequest>> = [
    { key: "code", header: "درخواست", value: (f) => f.code },
    {
      key: "units",
      header: "تعداد",
      value: (f) => f.items.reduce((s, i) => s + i.quantity, 0),
      align: "end",
      render: (f) => formatNumber(f.items.reduce((s, i) => s + i.quantity, 0)),
    },
    { key: "payout", header: "مبلغ شما", value: (f) => f.supplierCostTotal, align: "end", render: (f) => <MoneyValue amount={f.supplierCostTotal} /> },
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
                <ActionButton variant="primary" testId={`portal-accept-${f.id}`} onClick={() => dispatch(f.id, "accept")}>
                  پذیرش
                </ActionButton>
                <ActionButton variant="danger" onClick={() => dispatch(f.id, "reject")}>
                  رد
                </ActionButton>
              </>
            ) : null}
            {step ? (
              <ActionButton variant="primary" onClick={() => dispatch(f.id, "advance")}>
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
    {
      key: "status",
      header: "وضعیت",
      value: (s) => s.status,
      render: (s) => <StatusBadge label={SHIPMENT_STATUS_LABEL[s.status]} tone={SHIPMENT_STATUS_TONE[s.status]} />,
    },
  ];

  const setColumns: Array<Column<SupplierSettlement>> = [
    { key: "code", header: "کد", value: (s) => s.code },
    { key: "fulfilled", header: "مبلغ تأمین‌شده", value: (s) => s.fulfilledAmount, align: "end", render: (s) => <MoneyValue amount={s.fulfilledAmount} /> },
    { key: "commission", header: "کارمزد کلبه", value: (s) => s.commissionAmount, align: "end", secondary: true, render: (s) => <MoneyValue amount={s.commissionAmount} /> },
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
    <div dir="rtl" className="min-h-dvh bg-slate-50 dark:bg-slate-950" data-testid="supplier-portal">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">پورتال تأمین‌کننده · Kolbe Vintage</p>
            <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-50">{supplier?.name}</h1>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>حساب:</span>
            <select
              value={supplier?.id ?? ""}
              onChange={(e) => navigate("/partner", { supplier: e.target.value })}
              aria-label="انتخاب حساب تأمین‌کننده"
              data-testid="portal-account"
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {dataset.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <a
            href="#/"
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            خروج
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          شما درخواست‌های تأمین را از <strong className="font-semibold">کلبه وینتیج</strong> دریافت
          می‌کنید. اطلاعات خریدار نهایی، مبلغ سفارش مشتری و وضعیت مالی او در اختیار تأمین‌کننده
          قرار نمی‌گیرد.
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="در انتظار پاسخ شما" value={formatNumber(pending.length)} tone="warning" />
          <MetricCard label="در جریان" value={formatNumber(inProgress.length)} tone="progress" />
          <MetricCard label="دریافتی تا امروز" value={formatMoneyCompact(earned)} tone="success" />
          <MetricCard label="در انتظار دریافت" value={formatMoneyCompact(awaiting)} tone="info" />
        </div>

        <Card>
          <CardHeader title="عملکرد SLA شما" subtitle="میانگین زمان‌های شما در برابر تعهد قرارداد" />
          <SlaBars items={slaItems} />
        </Card>

        <Card>
          <CardHeader title="درخواست‌های تأمین" subtitle={`${fulfillments.length} درخواست`} />
          <DataTable
            rows={fulfillments}
            columns={ffColumns}
            rowKey={(f) => f.id}
            initialSortKey="requested"
            pageSize={10}
            testId="portal-fulfillments"
            emptyTitle="درخواستی برای شما ثبت نشده"
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
      </main>

      {toast ? (
        <div
          className={cn(
            "fixed bottom-4 left-4 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 shadow-lg",
            "dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
          )}
          role="status"
          aria-live="polite"
          data-testid="portal-toast"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
