import { cn } from "@/utils/cn";
import { formatDateDual } from "../lib/format";
import type { ThemeMode } from "../lib/useTheme";

const MODES: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: "light", label: "روشن", icon: "☀" },
  { value: "dark", label: "تیره", icon: "☾" },
  { value: "system", label: "سیستم", icon: "◑" },
];

export function Topbar({
  title,
  subtitle,
  themeMode,
  onThemeChange,
  onOpenMenu,
  onOpenPalette,
  now,
}: {
  title: string;
  subtitle: string;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
  now: number;
}) {
  return (
    <header
      className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85"
      data-testid="topbar"
    >
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="باز کردن منو"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
        >
          ☰
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:flex dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          data-testid="open-palette"
        >
          <span aria-hidden="true">⌘</span>
          جستجوی سریع
          <kbd className="rounded border border-slate-200 px-1 text-[10px] dark:border-slate-700">K</kbd>
        </button>

        <div
          className="flex items-center rounded-xl border border-slate-200 p-0.5 dark:border-slate-700"
          role="group"
          aria-label="حالت نمایش"
        >
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onThemeChange(m.value)}
              aria-label={`حالت ${m.label}`}
              aria-pressed={themeMode === m.value}
              data-testid={`theme-${m.value}`}
              className={cn(
                "rounded-lg px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
                themeMode === m.value
                  ? "bg-navy text-white dark:bg-sky-500/20 dark:text-sky-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
              )}
            >
              <span aria-hidden="true">{m.icon}</span>
            </button>
          ))}
        </div>

        <div className="hidden items-center gap-2 border-r border-slate-200 pr-3 md:flex dark:border-slate-700">
          <div className="text-left">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-100">نازنین رحیمی</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">Ops Admin · کلبه وینتیج</p>
          </div>
          <span
            className="grid size-8 place-items-center rounded-full bg-navy text-xs font-semibold text-white dark:bg-sky-500/20 dark:text-sky-300"
            aria-hidden="true"
          >
            NR
          </span>
        </div>
      </div>
      <div className="border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-400 sm:px-6 dark:border-slate-800/70 dark:text-slate-500">
        امروز: {formatDateDual(now)}
      </div>
    </header>
  );
}
