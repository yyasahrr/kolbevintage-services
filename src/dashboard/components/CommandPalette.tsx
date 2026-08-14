import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { NAV_ITEMS } from "../nav";
import type { WholesaleDataset } from "../domain/types";

interface Command {
  id: string;
  title: string;
  hint: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  data,
  navigate,
}: {
  open: boolean;
  onClose: () => void;
  data: WholesaleDataset;
  navigate: (path: string, params?: Record<string, string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV_ITEMS.map((n) => ({
      id: `nav-${n.path}`,
      title: n.label,
      hint: n.description,
      run: () => navigate(n.path),
    }));
    for (const s of data.suppliers) {
      list.push({
        id: `sup-${s.id}`,
        title: s.name,
        hint: "فیلتر بر اساس تأمین‌کننده",
        run: () => navigate("/suppliers", { supplier: s.id, preset: "90d" }),
      });
      list.push({
        id: `portal-${s.id}`,
        title: `پورتال ${s.name}`,
        hint: "نمای تأمین‌کننده",
        run: () => navigate("/supplier-portal", { supplier: s.id }),
      });
    }
    for (const o of data.orders.slice(0, 60)) {
      list.push({
        id: `ord-${o.id}`,
        title: o.code,
        hint: "باز کردن سفارش",
        run: () => navigate("/orders", { order: o.id, preset: "90d" }),
      });
    }
    list.push({
      id: "quick-disputes",
      title: "اختلافات باز",
      hint: "میان‌بر عملیاتی",
      run: () => navigate("/disputes"),
    });
    list.push({
      id: "quick-pending",
      title: "تسویه‌های در انتظار",
      hint: "میان‌بر مالی",
      run: () => navigate("/settlements", { settlement_status: "pending" }),
    });
    return list;
  }, [data, navigate]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);
    return commands.filter((c) => c.title.toLowerCase().includes(q) || c.hint.includes(q)).slice(0, 12);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === "Enter") {
        const cmd = results[active];
        if (cmd) {
          cmd.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, active, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24" role="dialog" aria-modal="true" aria-label="پالت فرمان">
      <button type="button" aria-label="بستن" onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        data-testid="command-palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="جستجوی صفحه، سفارش یا تأمین‌کننده…"
          aria-label="جستجوی فرمان"
          className="w-full border-b border-slate-100 bg-transparent px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:border-slate-800 dark:text-slate-100"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-slate-500">نتیجه‌ای یافت نشد</li>
          ) : (
            results.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    c.run();
                    onClose();
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-4 py-2 text-right text-sm",
                    i === active ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-800/60",
                  )}
                >
                  <span className="truncate text-slate-800 dark:text-slate-100">{c.title}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{c.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
