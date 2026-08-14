import { createContext, useContext, useMemo, type ReactNode } from "react";
import { generateDataset } from "./domain/generate";
import {
  applyFilters,
  buildIndex,
  computeKpis,
  type DashboardKpis,
  type DatasetIndex,
  type FilteredData,
} from "./domain/selectors";
import type { DashboardFilters } from "./domain/filters";
import type { WholesaleDataset } from "./domain/types";

interface DashboardContextValue {
  data: WholesaleDataset;
  index: DatasetIndex;
  filtered: FilteredData;
  kpis: DashboardKpis;
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters) => void;
  now: number;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

/** dataset is generated once per session, anchored to the current system time */
const DATASET: WholesaleDataset = generateDataset(Date.now());
const INDEX: DatasetIndex = buildIndex(DATASET);
const NOW = new Date(DATASET.generatedAt).getTime();

export function DashboardProvider({
  filters,
  setFilters,
  children,
}: {
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters) => void;
  children: ReactNode;
}) {
  const filtered = useMemo(() => applyFilters(DATASET, INDEX, filters), [filters]);
  const kpis = useMemo(() => computeKpis(DATASET, INDEX, filtered), [filtered]);

  const value = useMemo<DashboardContextValue>(
    () => ({ data: DATASET, index: INDEX, filtered, kpis, filters, setFilters, now: NOW }),
    [filtered, kpis, filters, setFilters],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}
