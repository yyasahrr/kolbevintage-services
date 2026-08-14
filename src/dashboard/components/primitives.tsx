import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { TONE_CLASS, type Tone } from "../domain/labels";
import {
  formatDurationHours,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
} from "../lib/format";

export function Card({
  children,
  className,
  as: As = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <As
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(1,28,58,0.04)]",
        "dark:border-slate-800 dark:bg-slate-900/60",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        TONE_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}

export function TrendIndicator({ delta, invert = false }: { delta: number; invert?: boolean }) {
  const rounded = Math.round(delta * 10) / 10;
  const positive = rounded > 0;
  const good = invert ? !positive : positive;
  const neutral = rounded === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
        neutral
          ? "text-slate-500 dark:text-slate-400"
          : good
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-rose-600 dark:text-rose-400",
      )}
    >
      <span aria-hidden="true">{neutral ? "→" : positive ? "▲" : "▼"}</span>
      {formatPercent(Math.abs(rounded))}
    </span>
  );
}

export function MoneyValue({
  amount,
  compact = false,
  className,
}: {
  amount: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)} title={formatMoney(amount)}>
      {compact ? formatMoneyCompact(amount) : formatMoney(amount)}
    </span>
  );
}

export function DurationValue({ hours, className }: { hours: number; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatDurationHours(hours)}</span>;
}

export function MetricCard({
  label,
  value,
  delta,
  hint,
  tone = "neutral",
  invertTrend = false,
  onClick,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  tone?: Tone;
  invertTrend?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <span className={cn("size-2 rounded-full", TONE_CLASS[tone].split(" ")[0])} aria-hidden="true" />
      </div>
      <div className="mt-2 truncate text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {delta !== undefined ? <TrendIndicator delta={delta} invert={invertTrend} /> : null}
        {hint ? (
          <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>
        ) : null}
      </div>
    </>
  );

  const base =
    "w-full rounded-2xl border border-slate-200/80 bg-white p-4 text-right shadow-[0_1px_2px_rgba(1,28,58,0.04)] dark:border-slate-800 dark:bg-slate-900/60";

  if (!onClick) return <div className={base}>{inner}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        "cursor-pointer transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:focus-visible:outline-sky-400",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      {inner}
    </button>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {detail ? <p className="text-xs text-slate-500 dark:text-slate-400">{detail}</p> : null}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{children}</h2>
      {hint ? <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  max,
  tone = "info",
}: {
  value: number;
  max: number;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const colour =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "danger"
          ? "bg-rose-500"
          : "bg-navy dark:bg-sky-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={cn("h-full rounded-full", colour)} style={{ width: `${pct}%` }} />
    </div>
  );
}
