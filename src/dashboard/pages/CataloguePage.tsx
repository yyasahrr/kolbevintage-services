import { useMemo } from "react";
import { Card, CardHeader, MetricCard, MoneyValue, SectionTitle } from "../components/primitives";
import { DataTable, type Column } from "../components/DataTable";
import { StatusBarChart, CHART_COLORS } from "../components/charts";
import { buildCatalogueAnalytics, buildProductAnalytics, type CatalogueRow, type ProductRow } from "../domain/selectors";
import { formatCompactNumber, formatMoneyCompact, formatNumber, formatPercent } from "../lib/format";
import { useDashboard } from "../state";

export function CataloguePage({ onSelectCatalogue }: { onSelectCatalogue: (catalogueId: string) => void }) {
  const { data, index, filtered } = useDashboard();
  const catalogues = useMemo(() => buildCatalogueAnalytics(data, filtered), [data, filtered]);
  const products = useMemo(() => buildProductAnalytics(index, filtered), [index, filtered]);

  const totalUnits = catalogues.reduce((s, c) => s + c.units, 0);
  const totalViews = catalogues.reduce((s, c) => s + c.views, 0);
  const totalGmv = catalogues.reduce((s, c) => s + c.gmv, 0);
  const conversion = totalViews ? (catalogues.reduce((s, c) => s + c.orders, 0) / totalViews) * 100 : 0;

  const catColumns: Array<Column<CatalogueRow>> = [
    { key: "name", header: "کاتالوگ", value: (r) => r.name },
    { key: "season", header: "فصل", value: (r) => r.season, secondary: true },
    { key: "views", header: "بازدید", value: (r) => r.views, align: "end", render: (r) => formatCompactNumber(r.views) },
    { key: "orders", header: "سفارش‌ها", value: (r) => r.orders, align: "end" },
    { key: "conv", header: "نرخ تبدیل", value: (r) => r.conversion, align: "end", render: (r) => formatPercent(r.conversion, 2) },
    { key: "units", header: "تعداد فروش", value: (r) => r.units, align: "end", render: (r) => formatNumber(r.units) },
    { key: "gmv", header: "GMV", value: (r) => r.gmv, align: "end", render: (r) => <MoneyValue amount={r.gmv} compact /> },
    { key: "aov", header: "میانگین سفارش", value: (r) => r.aov, align: "end", secondary: true, render: (r) => <MoneyValue amount={r.aov} compact /> },
  ];

  const prodColumns: Array<Column<ProductRow>> = [
    { key: "name", header: "محصول", value: (r) => r.name },
    { key: "sku", header: "SKU", value: (r) => r.sku, secondary: true },
    { key: "catalogue", header: "کاتالوگ", value: (r) => r.catalogue, secondary: true },
    { key: "category", header: "دسته", value: (r) => r.category },
    { key: "supplier", header: "تأمین‌کننده", value: (r) => r.supplier, secondary: true },
    { key: "units", header: "تعداد", value: (r) => r.units, align: "end", render: (r) => formatNumber(r.units) },
    { key: "gmv", header: "GMV", value: (r) => r.gmv, align: "end", render: (r) => <MoneyValue amount={r.gmv} compact /> },
  ];

  const chart = catalogues.map((c) => ({ label: c.name, value: Math.round(c.gmv / 1_000_000), color: CHART_COLORS.navy }));

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle hint="کاتالوگ عمده صرفاً برای مشتریان VIP قابل مشاهده است">عملکرد کاتالوگ</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="GMV کاتالوگ‌ها" value={formatMoneyCompact(totalGmv)} tone="info" />
          <MetricCard label="بازدید کاتالوگ" value={formatCompactNumber(totalViews)} tone="progress" />
          <MetricCard label="نرخ تبدیل" value={formatPercent(conversion, 2)} tone="success" />
          <MetricCard label="تعداد فروش" value={formatNumber(totalUnits)} tone="warning" />
        </div>
      </section>

      <Card>
        <CardHeader title="GMV بر اساس کاتالوگ" subtitle="میلیون تومان" />
        <StatusBarChart data={chart} colorKey="chart-catalogue" />
      </Card>

      <Card>
        <CardHeader title="کاتالوگ‌ها" subtitle={`${catalogues.length} کاتالوگ`} />
        <DataTable
          rows={catalogues}
          columns={catColumns}
          rowKey={(r) => r.catalogueId}
          onRowClick={(r) => onSelectCatalogue(r.catalogueId)}
          initialSortKey="gmv"
          pageSize={8}
          testId="catalogue-table"
          mobileCard={(r) => (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
              <span className="text-slate-500">
                {r.orders} سفارش · {formatMoneyCompact(r.gmv)}
              </span>
            </div>
          )}
        />
      </Card>

      <Card>
        <CardHeader title="محصولات برتر" subtitle={`${products.length} محصول فروخته‌شده در بازه`} />
        <DataTable
          rows={products}
          columns={prodColumns}
          rowKey={(r) => r.productId}
          initialSortKey="gmv"
          pageSize={12}
          testId="products-table"
          mobileCard={(r) => (
            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-800 dark:text-slate-100">{r.name}</span>
              <span className="text-slate-500">
                {formatNumber(r.units)} عدد · {formatMoneyCompact(r.gmv)}
              </span>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
