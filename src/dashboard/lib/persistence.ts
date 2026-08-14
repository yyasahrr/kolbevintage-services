import type { WholesaleDataset } from "../domain/types";

const STORAGE_KEY = "kv-wholesale-dataset";
const SCHEMA_VERSION = 2;

interface Envelope {
  version: number;
  savedAt: string;
  dataset: WholesaleDataset;
}

export function loadDataset(): WholesaleDataset | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed.version !== SCHEMA_VERSION || !parsed.dataset?.orders?.length) return null;
    return parsed.dataset;
  } catch {
    return null;
  }
}

export function saveDataset(dataset: WholesaleDataset): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: Envelope = { version: SCHEMA_VERSION, savedAt: new Date().toISOString(), dataset };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // quota exceeded or private mode — the dashboard still works in memory
  }
}

export function clearDataset(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function savedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as Envelope).savedAt ?? null;
  } catch {
    return null;
  }
}
