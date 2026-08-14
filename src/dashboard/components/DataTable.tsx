import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import { EmptyState } from "./primitives";

export interface Column<T> {
  key: string;
  header: string;
  /** used for sorting and CSV export */
  value?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: "start" | "end";
  className?: string;
  /** hidden on tablet breakpoint to keep density readable */
  secondary?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyTitle?: string;
  emptyDetail?: string;
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  /** mobile card renderer; when omitted the table scrolls horizontally */
  mobileCard?: (row: T) => ReactNode;
  testId?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  pageSize = 10,
  emptyTitle = "داده‌ای برای نمایش نیست",
  emptyDetail = "فیلترها را تغییر دهید تا نتایج بیشتری ببینید",
  initialSortKey,
  initialSortDir = "desc",
  mobileCard,
  testId,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.value) return rows;
    const getter = col.value;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      const cmp = String(va).localeCompare(String(vb), "fa");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, columns, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  if (rows.length === 0) return <EmptyState title={emptyTitle} detail={emptyDetail} />;

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  };

  return (
    <div data-testid={testId}>
      {mobileCard ? (
        <ul className="flex flex-col gap-3 p-4 md:hidden">
          {visible.map((row) => (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-right focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-800 dark:bg-slate-900"
                >
                  {mobileCard(row)}
                </button>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  {mobileCard(row)}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={cn("overflow-x-auto", mobileCard && "hidden md:block")}>
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-medium",
                    col.align === "end" ? "text-left" : "text-right",
                    col.secondary && "hidden lg:table-cell",
                  )}
                >
                  {col.value ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:focus-visible:outline-sky-400"
                      aria-label={`مرتب‌سازی بر اساس ${col.header}`}
                    >
                      {col.header}
                      <span aria-hidden="true" className="text-[10px]">
                        {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-slate-50 last:border-0 dark:border-slate-800/60",
                  onRowClick &&
                    "cursor-pointer hover:bg-slate-50 focus-within:bg-slate-50 dark:hover:bg-slate-800/40 dark:focus-within:bg-slate-800/40",
                )}
              >
                {columns.map((col, ci) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-slate-700 dark:text-slate-200",
                      col.align === "end" ? "text-left tabular-nums" : "text-right",
                      col.secondary && "hidden lg:table-cell",
                      col.className,
                    )}
                  >
                    {ci === 0 && onRowClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowClick(row);
                        }}
                        className="rounded font-medium text-navy underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:text-sky-400 dark:focus-visible:outline-sky-400"
                      >
                        {col.render ? col.render(row) : String(col.value?.(row) ?? "")}
                      </button>
                    ) : col.render ? (
                      col.render(row)
                    ) : (
                      String(col.value?.(row) ?? "")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span className="tabular-nums">
            {sorted.length} ردیف · صفحه {safePage + 1} از {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:hover:bg-slate-800"
            >
              قبلی
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-lg border border-slate-200 px-2.5 py-1 disabled:opacity-40 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:border-slate-700 dark:hover:bg-slate-800"
            >
              بعدی
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
