import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type CartLine = {
  id: string;
  name: string;
  colour: string;
  size: string;
  price: number;
  img: string;
  qty: number;
};

export type Toast = { id: number; text: string };

type StoreValue = {
  /* سبد خرید */
  lines: CartLine[];
  cartCount: number;
  cartTotal: number;
  addToCart: (line: Omit<CartLine, "qty"> & { qty?: number }) => void;
  removeLine: (key: string) => void;
  setLineQty: (key: string, qty: number) => void;
  clearCart: () => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;

  /* علاقه‌مندی‌ها */
  wishlist: string[];
  toggleWish: (id: string) => void;
  isWished: (id: string) => boolean;

  /* مقایسه */
  compare: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;

  /* توست */
  toasts: Toast[];
  notify: (text: string) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

export const lineKey = (l: { id: string; colour: string; size: string }) =>
  `${l.id}|${l.colour}|${l.size}`;

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => load("kv_cart", [] as CartLine[]));
  const [wishlist, setWishlist] = useState<string[]>(() => load("kv_wish", [] as string[]));
  const wishlistRef = useRef(wishlist);
  const [compare, setCompare] = useState<string[]>(() => load("kv_compare", [] as string[]));
  const [cartOpen, setCartOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => localStorage.setItem("kv_cart", JSON.stringify(lines)), [lines]);
  useEffect(() => localStorage.setItem("kv_wish", JSON.stringify(wishlist)), [wishlist]);
  useEffect(() => localStorage.setItem("kv_compare", JSON.stringify(compare)), [compare]);

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const addToCart: StoreValue["addToCart"] = useCallback(
    (line) => {
      setLines((prev) => {
        const k = lineKey(line);
        const found = prev.find((p) => lineKey(p) === k);
        if (found) return prev.map((p) => (lineKey(p) === k ? { ...p, qty: p.qty + (line.qty ?? 1) } : p));
        return [...prev, { ...line, qty: line.qty ?? 1 }];
      });
      notify(`${line.name} به سبد خرید اضافه شد`);
    },
    [notify],
  );

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((p) => lineKey(p) !== key));
  }, []);

  const setLineQty = useCallback((key: string, qty: number) => {
    setLines((prev) =>
      qty <= 0 ? prev.filter((p) => lineKey(p) !== key) : prev.map((p) => (lineKey(p) === key ? { ...p, qty } : p)),
    );
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const toggleWish = useCallback(
    (id: string) => {
      const has = wishlistRef.current.includes(id);
      const nextWishlist = has ? wishlistRef.current.filter((itemId) => itemId !== id) : [...wishlistRef.current, id];
      wishlistRef.current = nextWishlist;
      setWishlist(nextWishlist);
      notify(has ? "از علاقه‌مندی‌ها حذف شد" : "به علاقه‌مندی‌ها اضافه شد");
    },
    [notify],
  );

  const toggleCompare = useCallback(
    (id: string) => {
      setCompare((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= 4) {
          notify("حداکثر ۴ محصول قابل مقایسه است");
          return prev;
        }
        return [...prev, id];
      });
    },
    [notify],
  );

  const value = useMemo<StoreValue>(() => {
    const cartCount = lines.reduce((s, l) => s + l.qty, 0);
    const cartTotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
    return {
      lines,
      cartCount,
      cartTotal,
      addToCart,
      removeLine,
      setLineQty,
      clearCart,
      cartOpen,
      setCartOpen,
      wishlist,
      toggleWish,
      isWished: (id: string) => wishlist.includes(id),
      compare,
      toggleCompare,
      clearCompare: () => setCompare([]),
      toasts,
      notify,
    };
  }, [lines, cartOpen, wishlist, compare, toasts, addToCart, removeLine, setLineQty, clearCart, toggleWish, toggleCompare, notify]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore باید داخل StoreProvider استفاده شود");
  return ctx;
}
