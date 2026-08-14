import { cn } from "@/utils/cn";
import { GROUP_LABEL, NAV_ITEMS, type NavItem } from "../nav";

const GROUPS: Array<NavItem["group"]> = ["operations", "catalogue", "finance", "insight"];

export function Sidebar({
  currentPath,
  onNavigate,
  onClose,
  mobileOpen,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
  onClose: () => void;
  mobileOpen: boolean;
}) {
  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="بستن منو"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}
      <aside
        data-testid="sidebar"
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-64 flex-col border-l border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 motion-reduce:transition-none",
          "dark:border-slate-800 dark:bg-slate-950",
          mobileOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-navy dark:text-slate-50">
              Kolbe Vintage
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              عملیات عمده‌فروشی B2B
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن منو"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy lg:hidden dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="ناوبری اصلی">
          {GROUPS.map((group) => (
            <div key={group} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {GROUP_LABEL[group]}
              </p>
              <ul className="flex flex-col gap-0.5">
                {NAV_ITEMS.filter((i) => i.group === group).map((item) => {
                  const active = currentPath === item.path;
                  return (
                    <li key={item.path}>
                      <a
                        href={`#${item.path}`}
                        onClick={() => onNavigate(item.path)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:focus-visible:outline-sky-400",
                          active
                            ? "bg-navy text-white dark:bg-sky-500/15 dark:text-sky-300"
                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60",
                        )}
                      >
                        <span aria-hidden="true" className="w-4 text-center opacity-80">
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-slate-100 p-3 dark:border-slate-800">
          <a
            href="#/"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:text-slate-400 dark:hover:bg-slate-800/60"
          >
            <span aria-hidden="true">↗</span>
            فروشگاه
          </a>
          <a
            href="#/partner"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:text-slate-400 dark:hover:bg-slate-800/60"
          >
            <span aria-hidden="true">◈</span>
            پورتال تأمین‌کننده
          </a>
          <a
            href="#/supplier-apply"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy dark:text-slate-400 dark:hover:bg-slate-800/60"
          >
            <span aria-hidden="true">✉</span>
            فرم درخواست همکاری
          </a>
        </div>
      </aside>
    </>
  );
}
