import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/utils/cn";
import { formatCompactNumber, formatMoney, formatNumber } from "../lib/format";
import type { FunnelStage, TimeSeriesPoint } from "../domain/selectors";

export const CHART_COLORS = {
  navy: "#011c3a",
  sky: "#0ea5e9",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  indigo: "#6366f1",
  slate: "#94a3b8",
  violet: "#8b5cf6",
} as const;

const axisStyle = { fontSize: 11, fill: "currentColor" } as const;

function TooltipBox({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-1 font-medium text-slate-700 dark:text-slate-200">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </span>
            <span className="tabular-nums text-slate-900 dark:text-slate-100">
              {money ? formatMoney(Number(p.value)) : formatNumber(Number(p.value))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RevenueSettlementChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <div className="h-72 w-full text-slate-500 dark:text-slate-400" data-testid="chart-revenue">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="gGross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.navy} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS.navy} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => formatCompactNumber(v)}
          />
          <Tooltip content={<TooltipBox money />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="gross"
            name="فروش ناخالص"
            stroke={CHART_COLORS.navy}
            fill="url(#gGross)"
            strokeWidth={2}
          />
          <Line type="monotone" dataKey="escrowHeld" name="امانی" stroke={CHART_COLORS.sky} dot={false} strokeWidth={2} />
          <Line
            type="monotone"
            dataKey="settlement"
            name="تسویه تأمین‌کننده"
            stroke={CHART_COLORS.emerald}
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="commission"
            name="کمیسیون کلبه"
            stroke={CHART_COLORS.amber}
            dot={false}
            strokeWidth={2}
          />
          <Line type="monotone" dataKey="refunds" name="بازپرداخت" stroke={CHART_COLORS.rose} dot={false} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OrderVolumeChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <div className="h-56 w-full text-slate-500 dark:text-slate-400" data-testid="chart-orders">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={<TooltipBox />} />
          <Line
            type="monotone"
            dataKey="orders"
            name="تعداد سفارش"
            stroke={CHART_COLORS.indigo}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusBarChart({
  data,
  colorKey,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  colorKey?: string;
}) {
  return (
    <div className="h-64 w-full text-slate-500 dark:text-slate-400" data-testid={colorKey ?? "chart-status"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} tickLine={false} axisLine={false} interval={0} height={48} angle={-25} textAnchor="end" />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "currentColor", opacity: 0.06 }} />
          <Bar dataKey="value" name="تعداد" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color ?? CHART_COLORS.navy} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
}) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  return (
    <div className="relative h-64 w-full text-slate-500 dark:text-slate-400" data-testid="chart-donut">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<TooltipBox />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] flex -translate-y-1/2 flex-col items-center">
        <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{centerValue}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{centerLabel}</span>
        <span className="sr-only">{total}</span>
      </div>
    </div>
  );
}

/** Custom SVG funnel — no chart library, fully responsive */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ol className="flex flex-col gap-2 p-5" data-testid="chart-funnel">
      {stages.map((stage, i) => {
        const pct = (stage.count / max) * 100;
        const prev = i > 0 ? stages[i - 1].count : stage.count;
        const drop = prev > 0 ? ((prev - stage.count) / prev) * 100 : 0;
        return (
          <li key={stage.key} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">{stage.label}</span>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-lg bg-gradient-to-l from-navy to-sky-500 dark:from-sky-600 dark:to-sky-400"
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-medium tabular-nums text-white mix-blend-difference">
                {formatNumber(stage.count)}
              </span>
            </div>
            <span
              className={cn(
                "w-14 shrink-0 text-left text-[11px] tabular-nums",
                drop > 25 ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-500",
              )}
            >
              {i === 0 ? "—" : `-${drop.toFixed(0)}%`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Custom SVG horizontal comparison bars for SLA metrics */
export function SlaBars({
  items,
}: {
  items: Array<{ label: string; avgHours: number; targetHours: number; samples: number }>;
}) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.avgHours, i.targetHours)));
  return (
    <ul className="flex flex-col gap-3 p-5" data-testid="chart-sla">
      {items.map((item) => {
        const over = item.avgHours > item.targetHours;
        return (
          <li key={item.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
              <span
                className={cn(
                  "tabular-nums",
                  over ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {item.avgHours.toFixed(1)}h / هدف {item.targetHours}h
              </span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={cn("h-full rounded-full", over ? "bg-rose-500" : "bg-emerald-500")}
                style={{ width: `${Math.min(100, (item.avgHours / max) * 100)}%` }}
              />
              <span
                className="absolute inset-y-0 w-0.5 bg-slate-900/60 dark:bg-white/70"
                style={{ insetInlineStart: `${Math.min(100, (item.targetHours / max) * 100)}%` }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
