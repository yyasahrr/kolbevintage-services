export type CommerceEventName =
  | "page_view"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "purchase";

export type CommerceEvent = {
  id: string;
  name: CommerceEventName;
  at: string;
  path?: string;
  productId?: string;
  productName?: string;
  value?: number;
  quantity?: number;
  source?: string;
};

const STORAGE_KEY = "kv_commerce_events_v1";
let lastSignature = "";
let lastTrackedAt = 0;

export function readCommerceEvents(): CommerceEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CommerceEvent[]) : [];
  } catch {
    return [];
  }
}

export function trackCommerceEvent(event: Omit<CommerceEvent, "id" | "at">) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const signature = `${event.name}|${event.path || ""}|${event.productId || ""}`;
  if (signature === lastSignature && now - lastTrackedAt < 800) return;
  lastSignature = signature;
  lastTrackedAt = now;
  const next: CommerceEvent = {
    ...event,
    id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date(now).toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readCommerceEvents(), next].slice(-5000)));
    window.dispatchEvent(new CustomEvent("kolbe:analytics", { detail: next }));
  } catch {
    // Analytics must never interrupt a purchase flow when browser storage is full.
  }
}

export function productIdFromPath(path: string) {
  const match = path.match(/^\/product\/([^/?#]+)/);
  return match?.[1];
}
