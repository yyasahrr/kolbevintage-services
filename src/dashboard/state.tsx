import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyAction, type DashboardAction } from "./domain/actions";
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
import { clearDataset, loadDataset, saveDataset } from "./lib/persistence";

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "warning" | "danger";
}

interface DashboardContextValue {
  data: WholesaleDataset;
  index: DatasetIndex;
  filtered: FilteredData;
  kpis: DashboardKpis;
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters) => void;
  dispatch: (action: DashboardAction) => void;
  resetData: () => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  now: number;
  persisted: boolean;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

const NOW = Date.now();

function initialDataset(): { dataset: WholesaleDataset; persisted: boolean } {
  const stored = loadDataset();
  if (stored) return { dataset: stored, persisted: true };
  return { dataset: generateDataset(NOW), persisted: false };
}

let toastSeq = 0;

export function DashboardProvider({
  filters,
  setFilters,
  children,
}: {
  filters: DashboardFilters;
  setFilters: (next: DashboardFilters) => void;
  children: ReactNode;
}) {
  const [{ dataset, persisted }, setState] = useState(initialDataset);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const index = useMemo(() => buildIndex(dataset), [dataset]);
  const filtered = useMemo(() => applyFilters(dataset, index, filters), [dataset, index, filters]);
  const kpis = useMemo(() => computeKpis(dataset, index, filtered), [dataset, index, filtered]);

  useEffect(() => {
    saveDataset(dataset);
  }, [dataset]);

  const pushToast = useCallback((message: string, tone: Toast["tone"]) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const resetData = useCallback(() => {
    clearDataset();
    setState({ dataset: generateDataset(Date.now()), persisted: false });
    pushToast("داده نمونه بازنشانی شد", "success");
  }, [pushToast]);

  const dispatch = useCallback(
    (action: DashboardAction) => {
      if (action.type === "data/reset") {
        resetData();
        return;
      }
      setState((prev) => {
        const result = applyAction(prev.dataset, action, Date.now());
        pushToast(result.message, result.tone);
        if (result.dataset === prev.dataset) return prev;
        return { dataset: result.dataset, persisted: true };
      });
    },
    [pushToast, resetData],
  );

  const value = useMemo<DashboardContextValue>(
    () => ({
      data: dataset,
      index,
      filtered,
      kpis,
      filters,
      setFilters,
      dispatch,
      resetData,
      toasts,
      dismissToast,
      now: NOW,
      persisted,
    }),
    [dataset, index, filtered, kpis, filters, setFilters, dispatch, resetData, toasts, dismissToast, persisted],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}
