import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import {
  DATE_PRESET_LABEL,
  countActiveFilters,
  defaultFilters,
  rangeForPreset,
  type DashboardFilters,
  type DatePreset,
} from "../domain/filters";
import {
  FULFILLMENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  SETTLEMENT_STATUS_LABEL,
} from "../domain/labels";
import type { FulfillmentStatus, OrderStatus, SettlementStatus, WholesaleDataset } from "../domain/types";

const PRESETS: DatePreset[] = ["today", "7d", "30d", "90d", "this_month", "last_month", "this_quarter", "custom"];

const selectClass =
  "w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy " +
  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function GlobalFilters({
  data,
  filters,
  onChange,
}: {
  data: WholesaleDataset;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const categories = useMemo(
    () => Array.from(new Set(data.products.map((p) => p.category))).sort(),
    [data.products],
  );
  const activeCount = countActiveFilters(filters);

  const patch = (partial: Partial<DashboardFilters>) => onChange({ ...filters, ...partial });

  const setPreset = (preset: DatePreset) => {
    if (preset === "custom") patch({ preset });
    else {
      const range = rangeForPreset(preset);
      patch({ preset, from: range.from, to: range.to });
    }
  };

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="بازه زمانی">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            aria-pressed={filters.preset === p}
            data-testid={`preset-${p}`}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs transition-colors motion-reduce:transition-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
              filters.preset === p
                ? "bg-navy text-white dark:bg-sky-500/20 dark:text-sky-300"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
            )}
          >
            {DATE_PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      {filters.preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="از تاریخ">
            <input
              type="date"
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
              className={selectClass}
              data-testid="filter-from"
            />
          </Field>
          <Field label="تا تاریخ">
            <input
              type="date"
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
              className={selectClass}
              data-testid="filter-to"
            />
          </Field>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Field label="تأمین‌کننده">
          <select
            className={selectClass}
            value={filters.supplierId}
            onChange={(e) => patch({ supplierId: e.target.value })}
            data-testid="filter-supplier"
          >
            <option value="all">همه</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="مشتری VIP">
          <select
            className={selectClass}
            value={filters.customerId}
            onChange={(e) => patch({ customerId: e.target.value })}
            data-testid="filter-customer"
          >
            <option value="all">همه</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
        </Field>

        <Field label="وضعیت سفارش">
          <select
            className={selectClass}
            value={filters.orderStatus}
            onChange={(e) => patch({ orderStatus: e.target.value as OrderStatus | "all" })}
            data-testid="filter-order-status"
          >
            <option value="all">همه</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label="وضعیت تأمین">
          <select
            className={selectClass}
            value={filters.fulfillmentStatus}
            onChange={(e) => patch({ fulfillmentStatus: e.target.value as FulfillmentStatus | "all" })}
            data-testid="filter-ff-status"
          >
            <option value="all">همه</option>
            {Object.entries(FULFILLMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label="وضعیت تسویه">
          <select
            className={selectClass}
            value={filters.settlementStatus}
            onChange={(e) => patch({ settlementStatus: e.target.value as SettlementStatus | "all" })}
            data-testid="filter-settlement-status"
          >
            <option value="all">همه</option>
            {Object.entries(SETTLEMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>

        <Field label="کاتالوگ">
          <select
            className={selectClass}
            value={filters.catalogueId}
            onChange={(e) => patch({ catalogueId: e.target.value })}
            data-testid="filter-catalogue"
          >
            <option value="all">همه</option>
            {data.catalogues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="دسته محصول">
          <select
            className={selectClass}
            value={filters.category}
            onChange={(e) => patch({ category: e.target.value })}
            data-testid="filter-category"
          >
            <option value="all">همه</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {activeCount > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => onChange(defaultFilters())}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            data-testid="reset-filters"
          >
            پاک کردن {activeCount} فیلتر
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900/40"
      data-testid="global-filters"
    >
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        className="mb-2 flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 md:hidden dark:border-slate-700 dark:text-slate-300"
        data-testid="toggle-filters"
      >
        <span>فیلترهای سراسری {activeCount > 0 ? `(${activeCount})` : ""}</span>
        <span aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
      </button>
      <div className={cn(mobileOpen ? "block" : "hidden", "md:block")}>{body}</div>
    </div>
  );
}
