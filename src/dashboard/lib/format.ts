const numberFmt = new Intl.NumberFormat("en-US");
const decimalFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const gregorianFmt = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});
const gregorianTimeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const jalaliFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

/** Latin digits everywhere, currency in تومان */
export function formatNumber(value: number): string {
  return numberFmt.format(Math.round(value));
}

export function formatDecimal(value: number): string {
  return decimalFmt.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Full amount, e.g. 1,240,000,000 تومان */
export function formatMoney(value: number): string {
  return `${numberFmt.format(Math.round(value))} تومان`;
}

/** Compact amount for KPI cards, e.g. 1.24B تومان */
export function formatMoneyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${decimalFmt.format(value / 1_000_000_000)}B تومان`;
  if (abs >= 1_000_000) return `${decimalFmt.format(value / 1_000_000)}M تومان`;
  if (abs >= 1_000) return `${decimalFmt.format(value / 1_000)}K تومان`;
  return `${numberFmt.format(value)} تومان`;
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${decimalFmt.format(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${decimalFmt.format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${decimalFmt.format(value / 1_000)}K`;
  return numberFmt.format(value);
}

export function formatDateGregorian(input: string | number | Date): string {
  return gregorianFmt.format(new Date(input));
}

export function formatJalali(input: string | number | Date): string {
  return jalaliFmt.format(new Date(input));
}

/** Dual calendar: "14 Aug 2026 · 1405 مرداد 23" */
export function formatDateDual(input: string | number | Date): string {
  return `${formatDateGregorian(input)} · ${formatJalali(input)}`;
}

export function formatTime(input: string | number | Date): string {
  return gregorianTimeFmt.format(new Date(input));
}

export function formatDateTimeDual(input: string | number | Date): string {
  return `${formatDateDual(input)} — ${formatTime(input)}`;
}

/** Human duration in hours -> "18h 30m" / "2d 4h" */
export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  const abs = Math.abs(hours);
  if (abs < 1) return `${Math.round(abs * 60)}m`;
  if (abs < 24) {
    const h = Math.floor(abs);
    const m = Math.round((abs - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(abs / 24);
  const h = Math.round(abs % 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

export function hoursBetween(a: string | number | Date, b: string | number | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}

export function toCsvValue(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
