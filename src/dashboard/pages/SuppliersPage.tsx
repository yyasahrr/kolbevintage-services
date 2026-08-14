import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, ProgressBar, SectionTitle } from "../components/primitives";
import { SlaCard, SupplierPerformanceTable } from "../components/modules";
import { StatusBarChart, CHART_COLORS } from "../components/charts";
import { buildSupplierPerformance } from "../domain/selectors";
import { formatDecimal, formatMoneyCompact, formatNumber, formatPercent } from "../lib/format";
import { useDashboard } from "../state";

export function SuppliersPage({ onSelectSupplier }: { onSelectSupplier: (supplierId: string) => void }) {
  const { index, filtered, data } = useDashboard();
  const rows = useMemo(() => buildSupplierPerformance(index, filtered), [index, filtered]);

  const avgScore = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
  const best = rows[0];
  const worst = rows[rows.length - 1];

  const volumeChart = useMemo(
    () => rows.slice(0, 10).map((r) => ({ label: r.supplierName, value: r.fulfillments, color: CHART_COLORS.navy })),
    [rows],
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="تأمین‌کننده شریک داخلی کلبه وینتیج است و هرگز مستقیماً به مشتری متصل نمی‌شود">
          شبکه تأمین
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="تأمین‌کنندگان فعال" value={formatNumber(rows.length)} hint={`از ${data.suppliers.length} کل`} tone="info" />
          <MetricCard label="میانگین امتیاز عملکرد" value={formatDecimal(avgScore)} tone="progress" />
          <MetricCard label="بهترین عملکرد" value={best?.supplierName ?? "—"} hint={best ? `${best.score.toFixed(0)}/100` : ""} tone="success" />
          <MetricCard label="ضعیف‌ترین عملکرد" value={worst?.supplierName ?? "—"} hint={worst ? `${worst.score.toFixed(0)}/100` : ""} tone="danger" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="حجم تأمین بر اساس تأمین‌کننده" subtitle="تعداد درخواست‌های تأمین" />
          <StatusBarChart data={volumeChart} colorKey="chart-supplier-volume" />
        </Card>
        <SlaCard />
      </div>

      <SupplierPerformanceTable onSelect={onSelectSupplier} />

      <Card>
        <CardHeader title="پروفایل تأمین‌کنندگان" subtitle="اطلاعات پایه و سهم مالی" />
        <ul className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const supplier = index.supplierById.get(r.supplierId);
            return (
              <li key={r.supplierId}>
                <button
                  type="button"
                  onClick={() => onSelectSupplier(r.supplierId)}
                  className="w-full rounded-2xl border border-slate-200 p-4 text-right transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none dark:border-slate-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{r.supplierName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{r.score.toFixed(0)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {supplier?.city} · {supplier?.specialty} · کمیسیون {supplier?.commissionTier}٪
                  </p>
                  <div className="mt-3">
                    <ProgressBar value={r.score} max={100} tone={r.score > 75 ? "success" : r.score > 55 ? "warning" : "danger"} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="flex justify-between gap-1"><dt>تأمین‌ها</dt><dd className="tabular-nums">{r.fulfillments}</dd></div>
                    <div className="flex justify-between gap-1"><dt>پذیرش</dt><dd className="tabular-nums">{formatPercent(r.acceptanceRate, 0)}</dd></div>
                    <div className="flex justify-between gap-1"><dt>GMV</dt><dd><MoneyValue amount={r.gmvSupplied} compact /></dd></div>
                    <div className="flex justify-between gap-1"><dt>تسویه</dt><dd>{formatMoneyCompact(r.settlementAmount)}</dd></div>
                  </dl>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
