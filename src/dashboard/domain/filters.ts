import type {
  FulfillmentStatus,
  OrderStatus,
  SettlementStatus,
} from "./types";

export type DatePreset =
  | "today"
  | "7d"
  | "30d"
  | "90d"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "custom";

export const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  today: "امروز",
  "7d": "۷ روز",
  "30d": "۳۰ روز",
  "90d": "۹۰ روز",
  this_month: "این ماه",
  last_month: "ماه گذشته",
  this_quarter: "این فصل",
  custom: "بازه دلخواه",
};

export interface DashboardFilters {
  preset: DatePreset;
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  supplierId: string; // "all" | id
  customerId: string;
  orderStatus: OrderStatus | "all";
  fulfillmentStatus: FulfillmentStatus | "all";
  settlementStatus: SettlementStatus | "all";
  catalogueId: string;
  category: string;
}

const DAY = 86_400_000;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeForPreset(preset: DatePreset, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: ymd(today), to: ymd(today) };
    case "7d":
      return { from: ymd(new Date(today.getTime() - 6 * DAY)), to: ymd(today) };
    case "30d":
      return { from: ymd(new Date(today.getTime() - 29 * DAY)), to: ymd(today) };
    case "90d":
      return { from: ymd(new Date(today.getTime() - 89 * DAY)), to: ymd(today) };
    case "this_month":
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(today) };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    }
    case "this_quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { from: ymd(new Date(now.getFullYear(), q * 3, 1)), to: ymd(today) };
    }
    default:
      return { from: ymd(new Date(today.getTime() - 29 * DAY)), to: ymd(today) };
  }
}

export function defaultFilters(now = new Date()): DashboardFilters {
  const { from, to } = rangeForPreset("30d", now);
  return {
    preset: "30d",
    from,
    to,
    supplierId: "all",
    customerId: "all",
    orderStatus: "all",
    fulfillmentStatus: "all",
    settlementStatus: "all",
    catalogueId: "all",
    category: "all",
  };
}

export function rangeBounds(filters: DashboardFilters): { start: number; end: number } {
  const start = new Date(`${filters.from}T00:00:00`).getTime();
  const end = new Date(`${filters.to}T23:59:59.999`).getTime();
  return { start, end };
}

/** immediately preceding window of equal length, for comparisons */
export function previousBounds(filters: DashboardFilters): { start: number; end: number } {
  const { start, end } = rangeBounds(filters);
  const span = end - start;
  return { start: start - span - 1, end: start - 1 };
}

export function filtersToParams(f: DashboardFilters): Record<string, string> {
  const out: Record<string, string> = { preset: f.preset };
  if (f.preset === "custom") {
    out.from = f.from;
    out.to = f.to;
  }
  if (f.supplierId !== "all") out.supplier = f.supplierId;
  if (f.customerId !== "all") out.customer = f.customerId;
  if (f.orderStatus !== "all") out.order_status = f.orderStatus;
  if (f.fulfillmentStatus !== "all") out.ff_status = f.fulfillmentStatus;
  if (f.settlementStatus !== "all") out.settlement_status = f.settlementStatus;
  if (f.catalogueId !== "all") out.catalogue = f.catalogueId;
  if (f.category !== "all") out.category = f.category;
  return out;
}

export function filtersFromParams(
  params: URLSearchParams,
  now = new Date(),
): DashboardFilters {
  const base = defaultFilters(now);
  const preset = (params.get("preset") as DatePreset | null) ?? base.preset;
  const range = preset === "custom" ? null : rangeForPreset(preset, now);
  return {
    preset,
    from: range?.from ?? params.get("from") ?? base.from,
    to: range?.to ?? params.get("to") ?? base.to,
    supplierId: params.get("supplier") ?? "all",
    customerId: params.get("customer") ?? "all",
    orderStatus: (params.get("order_status") as OrderStatus | null) ?? "all",
    fulfillmentStatus: (params.get("ff_status") as FulfillmentStatus | null) ?? "all",
    settlementStatus: (params.get("settlement_status") as SettlementStatus | null) ?? "all",
    catalogueId: params.get("catalogue") ?? "all",
    category: params.get("category") ?? "all",
  };
}

export function countActiveFilters(f: DashboardFilters): number {
  let n = 0;
  if (f.supplierId !== "all") n++;
  if (f.customerId !== "all") n++;
  if (f.orderStatus !== "all") n++;
  if (f.fulfillmentStatus !== "all") n++;
  if (f.settlementStatus !== "all") n++;
  if (f.catalogueId !== "all") n++;
  if (f.category !== "all") n++;
  return n;
}
