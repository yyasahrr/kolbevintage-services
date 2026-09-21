import type { AnalyticsScope } from "@kolbe/database";

export type { AnalyticsScope };

export const ANALYTICS_DEFAULT_TIMEZONE = "Asia/Tehran";
export const ANALYTICS_MAX_METRICS_PER_RUN = 50;
export const ANALYTICS_MAX_EXPORT_ROWS = 10_000;
export const ANALYTICS_EXPORT_TTL_SECONDS = 60 * 60 * 24;

export const ANALYTICS_DATE_PRESETS = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "MONTH_TO_DATE",
  "CUSTOM",
] as const;
export type AnalyticsDatePreset = (typeof ANALYTICS_DATE_PRESETS)[number];

export const ANALYTICS_COMPARISONS = ["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR"] as const;
export type AnalyticsComparison = (typeof ANALYTICS_COMPARISONS)[number];

export const ANALYTICS_DIMENSIONS = ["day", "status", "channel", "supplier"] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export type AnalyticsRangeInput = {
  preset?: AnalyticsDatePreset;
  /** UTC ISO-8601 instant. Required as a pair for custom instant ranges. */
  startUtc?: string;
  endUtc?: string;
  /** Calendar dates interpreted at midnight in `timezone`. */
  startDate?: string;
  endDate?: string;
  timezone?: string;
  comparison?: AnalyticsComparison;
};

export type ResolvedAnalyticsRange = {
  preset: AnalyticsDatePreset;
  timezone: string;
  startUtc: Date;
  endUtc: Date;
  comparison: AnalyticsComparison;
  comparisonStartUtc: Date | null;
  comparisonEndUtc: Date | null;
};

export type AnalyticsDefinition = {
  metricKeys: string[];
  scope: AnalyticsScope;
  scopeId?: string | null;
  range: AnalyticsRangeInput;
  dimensions?: AnalyticsDimension[];
};

export type AnalyticsRatioValue = {
  kind: "ratio";
  numerator: string;
  denominator: string;
  /** Integer basis points. 10000 basis points = 100%. */
  basisPoints: string;
};

export type AnalyticsMetricValue = string | AnalyticsRatioValue;

export type AnalyticsFreshness = {
  mode: "LIVE";
  sourceMode: "AUTHORITATIVE_LIVE";
  dataAsOf: string;
  snapshot: false;
  sourceLastUpdatedAt: string | null;
};

export type AnalyticsMetricResult = {
  key: string;
  label: string;
  unit: "COUNT" | "INTEGER" | "IRR" | "RATIO";
  value: AnalyticsMetricValue;
  range: { startUtc: string; endUtc: string };
  comparison: {
    mode: AnalyticsComparison;
    value: AnalyticsMetricValue | null;
  };
  freshness: AnalyticsFreshness;
};

export type AnalyticsReportResult = {
  reportRunId?: string;
  scope: AnalyticsScope;
  scopeId: string | null;
  timezone: string;
  range: ResolvedAnalyticsRange & {
    startUtc: string;
    endUtc: string;
    comparisonStartUtc: string | null;
    comparisonEndUtc: string | null;
  };
  metrics: AnalyticsMetricResult[];
  freshness: AnalyticsFreshness;
};

export function isAnalyticsDatePreset(value: unknown): value is AnalyticsDatePreset {
  return typeof value === "string" && (ANALYTICS_DATE_PRESETS as readonly string[]).includes(value);
}

export function isAnalyticsComparison(value: unknown): value is AnalyticsComparison {
  return typeof value === "string" && (ANALYTICS_COMPARISONS as readonly string[]).includes(value);
}

export function isAnalyticsDimension(value: unknown): value is AnalyticsDimension {
  return typeof value === "string" && (ANALYTICS_DIMENSIONS as readonly string[]).includes(value);
}

export function parseMetricKeys(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const keys = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

/**
 * Convert a non-negative integer ratio into basis points without floating
 * point arithmetic. The numerator and denominator remain the authority.
 */
export function ratioValue(numerator: bigint, denominator: bigint): AnalyticsRatioValue {
  if (denominator < 0n || numerator < 0n) throw new Error("Analytics ratios must be non-negative");
  return {
    kind: "ratio",
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    basisPoints: denominator === 0n ? "0" : ((numerator * 10_000n) / denominator).toString(),
  };
}

export function parseInteger(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

export function safeMetricValue(value: bigint): string {
  return value.toString();
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

function localDateParts(date: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function localDateKey(date: Date, timezone: string): string {
  const parts = localDateParts(date, timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

/** Convert a local calendar midnight in an IANA zone to a UTC instant. */
export function zonedMidnightUtc(dateKey: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`Invalid calendar date: ${dateKey}`);
  assertTimezone(timezone);
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const representedUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour"), get("minute"), get("second"));
  const offset = representedUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function requireUtcInstant(value: string, field: string): Date {
  if (!/Z$/i.test(value)) throw new Error(`${field} must be an explicit UTC ISO-8601 instant ending in Z`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is not a valid UTC instant`);
  return date;
}

function rangeFromCalendarDates(startDate: string, endDate: string, timezone: string): { start: Date; end: Date } {
  const start = zonedMidnightUtc(startDate, timezone);
  const end = zonedMidnightUtc(addCalendarDays(endDate, 1), timezone);
  if (end <= start) throw new Error("Analytics date range must have a positive duration");
  return { start, end };
}

export function resolveAnalyticsRange(input: AnalyticsRangeInput = {}, now = new Date()): ResolvedAnalyticsRange {
  const timezone = input.timezone?.trim() || ANALYTICS_DEFAULT_TIMEZONE;
  assertTimezone(timezone);
  const preset = input.preset || "LAST_30_DAYS";
  if (!isAnalyticsDatePreset(preset)) throw new Error(`Unsupported analytics date preset: ${String(preset)}`);
  const comparison = input.comparison || "NONE";
  if (!isAnalyticsComparison(comparison)) throw new Error(`Unsupported analytics comparison: ${String(comparison)}`);

  let startUtc: Date;
  let endUtc: Date;
  if (preset === "CUSTOM" && input.startUtc && input.endUtc) {
    startUtc = requireUtcInstant(input.startUtc, "startUtc");
    endUtc = requireUtcInstant(input.endUtc, "endUtc");
    if (endUtc <= startUtc) throw new Error("Analytics date range must have a positive duration");
  } else {
    const today = localDateKey(now, timezone);
    const dates: Record<Exclude<AnalyticsDatePreset, "CUSTOM">, [string, string]> = {
      TODAY: [today, today],
      YESTERDAY: [addCalendarDays(today, -1), addCalendarDays(today, -1)],
      LAST_7_DAYS: [addCalendarDays(today, -6), today],
      LAST_30_DAYS: [addCalendarDays(today, -29), today],
      MONTH_TO_DATE: [`${today.slice(0, 7)}-01`, today],
    };
    if (preset === "CUSTOM") {
      if (!input.startDate || !input.endDate) throw new Error("CUSTOM analytics ranges require startDate/endDate or startUtc/endUtc");
      ({ start: startUtc, end: endUtc } = rangeFromCalendarDates(input.startDate, input.endDate, timezone));
    } else {
      const [startDate, endDate] = dates[preset];
      ({ start: startUtc, end: endUtc } = rangeFromCalendarDates(startDate, endDate, timezone));
    }
  }

  let comparisonStartUtc: Date | null = null;
  let comparisonEndUtc: Date | null = null;
  if (comparison === "PREVIOUS_PERIOD") {
    const duration = endUtc.getTime() - startUtc.getTime();
    comparisonEndUtc = new Date(startUtc.getTime());
    comparisonStartUtc = new Date(startUtc.getTime() - duration);
  } else if (comparison === "PREVIOUS_YEAR") {
    comparisonStartUtc = new Date(startUtc);
    comparisonStartUtc.setUTCFullYear(comparisonStartUtc.getUTCFullYear() - 1);
    comparisonEndUtc = new Date(endUtc);
    comparisonEndUtc.setUTCFullYear(comparisonEndUtc.getUTCFullYear() - 1);
  }

  return { preset, timezone, startUtc, endUtc, comparison, comparisonStartUtc, comparisonEndUtc };
}
