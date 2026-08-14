import { cn } from "@/utils/cn";
import { useDashboard } from "../state";

const TONE = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
} as const;

export function Toasts() {
  const { toasts, dismissToast } = useDashboard();
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[60] flex flex-col gap-2"
      role="status"
      aria-live="polite"
      data-testid="toasts"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-2.5 text-xs shadow-lg",
            TONE[t.tone],
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="بستن اعلان"
            className="shrink-0 rounded opacity-60 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
