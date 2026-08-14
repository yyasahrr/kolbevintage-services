import { useMemo } from "react";
import { Card, CardHeader, MoneyValue, SectionTitle } from "../components/primitives";
import { buildOrdersCsv } from "../components/modules";
import {
  buildCatalogueAnalytics,
  buildCustomerAnalytics,
  buildOrderRows,
  buildSupplierPerformance,
} from "../domain/selectors";
import { formatDateDual, formatMoneyCompact, formatNumber, toCsvValue } from "../lib/format";
import { useDashboard } from "../state";

function download(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { data, index, filtered, filters, kpis, now } = useDashboard();

  const orderRows = useMemo(() => buildOrderRows(index, filtered, now), [index, filtered, now]);
  const supplierRows = useMemo(() => buildSupplierPerformance(index, filtered), [index, filtered]);
  const customerRows = useMemo(() => buildCustomerAnalytics(data, index, filtered), [data, index, filtered]);
  const catalogueRows = useMemo(() => buildCatalogueAnalytics(data, filtered), [data, filtered]);

  const reports = [
    {
      id: "orders",
      title: "گزارش سفارش‌های عمده",
      detail: `${orderRows.length} سفارش · شامل امانی، تأمین، ارسال و تسویه`,
      run: () => download(`kolbe-orders-${filters.from}_${filters.to}.csv`, buildOrdersCsv(orderRows)),
    },
    {
      id: "suppliers",
      title: "گزارش عملکرد تأمین‌کنندگان",
      detail: `${supplierRows.length} تأمین‌کننده · شاخص‌های SLA و امتیاز عملکرد`,
      run: () =>
        download(
          `kolbe-suppliers-${filters.from}_${filters.to}.csv`,
          [
            "Supplier,Fulfillments,Acceptance Rate,Avg Acceptance (h),Avg Preparation (h),On-Time Shipping,Cancellation Rate,Dispute Rate,GMV Supplied,Settlement Amount,Score",
            ...supplierRows.map((r) =>
              [
                r.supplierName,
                r.fulfillments,
                r.acceptanceRate.toFixed(1),
                r.avgAcceptanceHours.toFixed(1),
                r.avgPreparationHours.toFixed(1),
                r.onTimeShippingRate.toFixed(1),
                r.cancellationRate.toFixed(1),
                r.disputeRate.toFixed(1),
                r.gmvSupplied,
                r.settlementAmount,
                r.score.toFixed(1),
              ]
                .map(toCsvValue)
                .join(","),
            ),
          ].join("\n"),
        ),
    },
    {
      id: "settlements",
      title: "گزارش تسویه و کمیسیون",
      detail: `${filtered.settlements.length} تسویه · تفکیک کمیسیون، بازپرداخت و تعدیل`,
      run: () =>
        download(
          `kolbe-settlements-${filters.from}_${filters.to}.csv`,
          [
            "Settlement,Order,Supplier,Fulfilled Amount,Commission,Refund,Adjustments,Payable,Due,Status",
            ...filtered.settlements.map((s) =>
              [
                s.code,
                index.orderById.get(s.orderId)?.code ?? s.orderId,
                index.supplierById.get(s.supplierId)?.name ?? s.supplierId,
                s.fulfilledAmount,
                s.commissionAmount,
                s.refundAmount,
                s.adjustmentTotal,
                s.payableAmount,
                s.dueAt.slice(0, 10),
                s.status,
              ]
                .map(toCsvValue)
                .join(","),
            ),
          ].join("\n"),
        ),
    },
    {
      id: "customers",
      title: "گزارش مشتریان VIP",
      detail: `${customerRows.length} مشتری · GMV و رفتار خرید`,
      run: () =>
        download(
          `kolbe-customers-${filters.from}_${filters.to}.csv`,
          [
            "Company,Contact,City,Tier,Segment,Orders,GMV,AOV,Open Disputes",
            ...customerRows.map((r) =>
              [r.company, r.name, r.city, r.tier, r.segment, r.orders, r.gmv, Math.round(r.aov), r.openDisputes]
                .map(toCsvValue)
                .join(","),
            ),
          ].join("\n"),
        ),
    },
    {
      id: "catalogue",
      title: "گزارش کاتالوگ",
      detail: `${catalogueRows.length} کاتالوگ · بازدید، تبدیل و GMV`,
      run: () =>
        download(
          `kolbe-catalogues-${filters.from}_${filters.to}.csv`,
          [
            "Catalogue,Season,Views,Orders,Conversion,Units,GMV,AOV",
            ...catalogueRows.map((r) =>
              [r.name, r.season, r.views, r.orders, r.conversion.toFixed(3), r.units, r.gmv, Math.round(r.aov)]
                .map(toCsvValue)
                .join(","),
            ),
          ].join("\n"),
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint={`بازه گزارش: ${formatDateDual(filters.from)} تا ${formatDateDual(filters.to)}`}>
          گزارش‌های قابل خروجی
        </SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <Card key={r.id} className="flex flex-col justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.title}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.detail}</p>
              </div>
              <button
                type="button"
                onClick={r.run}
                data-testid={`report-${r.id}`}
                className="mt-4 self-start rounded-lg bg-navy px-3 py-1.5 text-xs text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:bg-sky-500/20 dark:text-sky-200"
              >
                دانلود CSV
              </button>
            </Card>
          ))}
        </div>
      </section>

      <Card>
        <CardHeader title="خلاصه اجرایی بازه" subtitle="اعداد کلیدی برای گزارش مدیریتی" />
        <dl className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
          {[
            ["فروش ناخالص", <MoneyValue key="a" amount={kpis.grossRevenue.value} compact />],
            ["موجودی امانی", <MoneyValue key="b" amount={kpis.escrowBalance.value} compact />],
            ["کمیسیون", <MoneyValue key="c" amount={kpis.commission.value} compact />],
            ["تسویه‌شده", <MoneyValue key="d" amount={kpis.totalSettled} compact />],
            ["سفارش‌ها", formatNumber(filtered.orders.length)],
            ["درخواست‌های تأمین", formatNumber(filtered.fulfillments.length)],
            ["اختلافات باز", formatNumber(filtered.disputes.filter((d) => d.status !== "resolved").length)],
            ["میانگین سفارش", formatMoneyCompact(kpis.averageOrderValue.value)],
          ].map(([label, value], i) => (
            <div key={i}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
