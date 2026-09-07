import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Icon from "../components/Icon";
import { ApiError } from "../lib/api";
import {
  loadSystemLogs,
  updateSystemLogStatus,
  type SystemLog,
  type SystemLogFilters,
  type SystemLogLevel,
  type SystemLogSource,
  type SystemLogStatus,
  type SystemLogsResponse,
} from "../lib/wholesaleApi";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6f91aa] focus-visible:ring-offset-2";
const control = `h-10 border border-neutral-300 bg-white px-3 text-[11px] outline-none hover:border-neutral-400 ${focus}`;
const number = new Intl.NumberFormat("fa-IR");
const dateTime = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });

const levelConfig: Record<SystemLogLevel, { label: string; dot: string; badge: string }> = {
  debug: { label: "دیباگ", dot: "bg-neutral-400", badge: "border-neutral-200 bg-neutral-50 text-neutral-600" },
  info: { label: "اطلاعات", dot: "bg-sky-500", badge: "border-sky-200 bg-sky-50 text-sky-800" },
  warning: { label: "هشدار", dot: "bg-amber-500", badge: "border-amber-200 bg-amber-50 text-amber-800" },
  error: { label: "خطا", dot: "bg-red-500", badge: "border-red-200 bg-red-50 text-red-800" },
  critical: { label: "بحرانی", dot: "bg-red-800", badge: "border-red-300 bg-red-100 text-red-950" },
};

const sourceLabel: Record<SystemLogSource, string> = {
  api: "API",
  frontend: "مرورگر",
  auth: "احراز هویت",
  system: "سیستم",
  integration: "اتصال خارجی",
};

const statusLabel: Record<SystemLogStatus, string> = {
  open: "باز",
  resolved: "رفع‌شده",
  ignored: "نادیده‌گرفته‌شده",
};

const emptySummary: SystemLogsResponse["summary"] = {
  openErrors: 0,
  criticalOpen: 0,
  errors24h: 0,
  frontend24h: 0,
  warnings24h: 0,
  slow24h: 0,
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

function SeverityBadge({ level }: { level: SystemLogLevel }) {
  const config = levelConfig[level];
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[9.5px] font-medium ${config.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />{config.label}</span>;
}

function StatusBadge({ status }: { status: SystemLogStatus }) {
  const style = status === "open"
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : status === "resolved"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-neutral-200 bg-neutral-50 text-neutral-500";
  return <span className={`inline-flex border px-2 py-1 text-[9.5px] ${style}`}>{statusLabel[status]}</span>;
}

function SummaryStrip({ summary, loading }: { summary: SystemLogsResponse["summary"]; loading: boolean }) {
  const items = [
    { label: "خطاهای باز", value: summary.openErrors, detail: "نیازمند بررسی", tone: summary.openErrors ? "text-red-800" : "text-emerald-700" },
    { label: "بحرانی باز", value: summary.criticalOpen, detail: "اولویت فوری", tone: summary.criticalOpen ? "text-red-900" : "text-neutral-900" },
    { label: "خطا در ۲۴ ساعت", value: summary.errors24h, detail: `${number.format(summary.warnings24h)} هشدار`, tone: "text-neutral-900" },
    { label: "خطای مرورگر", value: summary.frontend24h, detail: `${number.format(summary.slow24h)} درخواست کند`, tone: "text-neutral-900" },
  ];
  return (
    <section aria-label="خلاصه وضعیت لاگ‌ها" className="grid overflow-hidden border border-neutral-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => <div key={item.label} className="border-b border-neutral-200 p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-l xl:border-b-0 xl:border-l xl:last:border-l-0">
        <p className="text-[10px] text-neutral-500">{item.label}</p>
        {loading ? <span className="mt-2 block h-7 w-16 animate-pulse bg-neutral-100" /> : <p className={`mt-1.5 text-[23px] font-semibold tabular-nums ${item.tone}`}>{number.format(item.value)}</p>}
        <p className="mt-1 text-[9.5px] text-neutral-400">{item.detail}</p>
      </div>)}
    </section>
  );
}

function LogToolbar({ filters, onChange, autoRefresh, onAutoRefresh, refreshing, onRefresh, onExport }: {
  filters: SystemLogFilters;
  onChange: (patch: Partial<SystemLogFilters>) => void;
  autoRefresh: boolean;
  onAutoRefresh: (value: boolean) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <section aria-label="فیلترهای لاگ" className="border-x border-t border-neutral-200 bg-white p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <label className="relative min-w-0 flex-1 xl:max-w-md"><span className="sr-only">جست‌وجو در لاگ‌ها</span><Icon name="search" className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-neutral-400"/><input type="search" value={filters.query} onChange={(event) => onChange({ query: event.target.value, page: 1 })} placeholder="پیام، مسیر، request ID یا نوع خطا…" className={`${control} w-full pr-9`} /></label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label><span className="sr-only">شدت</span><select value={filters.level} onChange={(event) => onChange({ level: event.target.value as SystemLogFilters["level"], page: 1 })} className={`${control} w-full`}><option value="all">همه شدت‌ها</option><option value="critical">بحرانی</option><option value="error">خطا</option><option value="warning">هشدار</option><option value="info">اطلاعات</option><option value="debug">دیباگ</option></select></label>
          <label><span className="sr-only">منبع</span><select value={filters.source} onChange={(event) => onChange({ source: event.target.value as SystemLogFilters["source"], page: 1 })} className={`${control} w-full`}><option value="all">همه منابع</option><option value="api">API</option><option value="frontend">مرورگر</option><option value="auth">احراز هویت</option><option value="system">سیستم</option><option value="integration">اتصال خارجی</option></select></label>
          <label><span className="sr-only">وضعیت بررسی</span><select value={filters.status} onChange={(event) => onChange({ status: event.target.value as SystemLogFilters["status"], page: 1 })} className={`${control} w-full`}><option value="all">همه وضعیت‌ها</option><option value="open">باز</option><option value="resolved">رفع‌شده</option><option value="ignored">نادیده</option></select></label>
          <label><span className="sr-only">بازه زمانی</span><select value={filters.range} onChange={(event) => onChange({ range: event.target.value as SystemLogFilters["range"], page: 1 })} className={`${control} w-full`}><option value="24h">۲۴ ساعت</option><option value="7d">۷ روز</option><option value="30d">۳۰ روز</option><option value="all">همه زمان‌ها</option></select></label>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex h-10 cursor-pointer items-center gap-2 border border-neutral-200 px-3 text-[10px] text-neutral-600"><input type="checkbox" checked={autoRefresh} onChange={(event) => onAutoRefresh(event.target.checked)} className="accent-[#011c3a]" />به‌روزرسانی خودکار</label>
          <button type="button" onClick={onRefresh} disabled={refreshing} className={`${control} flex w-10 items-center justify-center px-0 disabled:opacity-50`} aria-label="به‌روزرسانی لاگ‌ها"><span className={refreshing ? "animate-spin" : ""}><Icon name="return" className="h-4 w-4" /></span></button>
          <button type="button" onClick={onExport} className={`${control} whitespace-nowrap`}>خروجی CSV</button>
        </div>
      </div>
    </section>
  );
}

function LogTable({ logs, onSelect }: { logs: SystemLog[]; onSelect: (log: SystemLog) => void }) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[980px] text-right text-[11px]">
        <thead><tr className="border-b border-neutral-200 bg-neutral-50 text-neutral-500"><th className="w-36 px-4 py-3 font-medium">آخرین رخداد</th><th className="w-24 px-3 py-3 font-medium">شدت</th><th className="px-3 py-3 font-medium">پیام و مسیر</th><th className="w-28 px-3 py-3 font-medium">منبع</th><th className="w-24 px-3 py-3 font-medium">وضعیت</th><th className="w-20 px-3 py-3 font-medium">تکرار</th><th className="w-20 px-3 py-3 font-medium" /></tr></thead>
        <tbody>{logs.map((log) => <tr key={log.id} className="observability-row border-b border-neutral-100 align-top hover:bg-neutral-50/80">
          <td className="px-4 py-3 text-[10px] text-neutral-500"><time dateTime={log.lastSeenAt}>{formatDate(log.lastSeenAt)}</time>{log.durationMs !== null ? <p dir="ltr" className={`mt-1 text-right tabular-nums ${log.durationMs >= 1_500 ? "text-amber-700" : "text-neutral-400"}`}>{number.format(log.durationMs)} ms</p> : null}</td>
          <td className="px-3 py-3"><SeverityBadge level={log.level} /></td>
          <td className="max-w-0 px-3 py-3"><button type="button" onClick={() => onSelect(log)} className={`block w-full text-right ${focus}`}><span className="block truncate font-medium text-neutral-900">{log.message}</span><span dir="ltr" className="mt-1 block truncate text-right font-mono text-[9.5px] text-neutral-400">{log.httpMethod ? `${log.httpMethod} ` : ""}{log.path ?? log.eventType}</span></button></td>
          <td className="px-3 py-3 text-neutral-600">{sourceLabel[log.source]}<p dir="ltr" className="mt-1 text-right text-[9px] text-neutral-400">{log.httpStatus ? `HTTP ${log.httpStatus}` : log.eventType}</p></td>
          <td className="px-3 py-3"><StatusBadge status={log.status} /></td>
          <td className="px-3 py-3 tabular-nums text-neutral-600">× {number.format(log.occurrenceCount)}</td>
          <td className="px-3 py-3"><button type="button" onClick={() => onSelect(log)} className={`text-[10px] text-[#011c3a] underline underline-offset-4 ${focus}`}>بررسی</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function MobileLogList({ logs, onSelect }: { logs: SystemLog[]; onSelect: (log: SystemLog) => void }) {
  return <div className="divide-y divide-neutral-100 lg:hidden">{logs.map((log) => <button type="button" key={log.id} onClick={() => onSelect(log)} className={`observability-row block w-full p-4 text-right hover:bg-neutral-50 ${focus}`}><div className="flex items-start justify-between gap-3"><SeverityBadge level={log.level}/><StatusBadge status={log.status}/></div><p className="mt-3 line-clamp-2 text-[11.5px] font-medium leading-6">{log.message}</p><p dir="ltr" className="mt-1 truncate text-right font-mono text-[9.5px] text-neutral-400">{log.httpMethod ? `${log.httpMethod} ` : ""}{log.path ?? log.eventType}</p><div className="mt-3 flex items-center justify-between text-[9.5px] text-neutral-500"><span>{sourceLabel[log.source]} · × {number.format(log.occurrenceCount)}</span><time dateTime={log.lastSeenAt}>{formatDate(log.lastSeenAt)}</time></div></button>)}</div>;
}

function LoadingRows() {
  return <div role="status" aria-label="در حال دریافت لاگ‌ها" className="divide-y divide-neutral-100">{Array.from({ length: 7 }, (_, index) => <div key={index} className="grid grid-cols-[100px_80px_1fr] gap-4 p-4"><span className="h-4 animate-pulse bg-neutral-100"/><span className="h-5 animate-pulse bg-neutral-100"/><span className="h-4 animate-pulse bg-neutral-100"/></div>)}</div>;
}

function LogInspector({ log, onClose, onStatus }: { log: SystemLog; onClose: () => void; onStatus: (status: SystemLogStatus, note: string) => Promise<void> }) {
  const [note, setNote] = useState(log.resolutionNote ?? "");
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pending, startTransition] = useTransition();
  const copyDetails = async () => {
    const details = JSON.stringify({ ...log, metadata: log.metadata }, null, 2);
    await navigator.clipboard.writeText(details).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const changeStatus = (status: SystemLogStatus) => startTransition(async () => {
    setActionError("");
    try {
      await onStatus(status, note);
    } catch {
      setActionError("ثبت وضعیت انجام نشد؛ اتصال یا دسترسی ادمین را بررسی کنید.");
    }
  });
  const metadata = log.metadata ? JSON.stringify(log.metadata, null, 2) : null;

  return <div className="fixed inset-0 z-[80] flex justify-end bg-black/30" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="log-inspector-title" className="h-full w-full overflow-y-auto border-r border-neutral-200 bg-white shadow-2xl sm:max-w-2xl">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-neutral-200 bg-white/95 p-4 backdrop-blur"><div className="min-w-0"><p className="text-[9px] tracking-[0.18em] text-neutral-400">INCIDENT INSPECTOR</p><h2 id="log-inspector-title" className="mt-1 truncate text-[16px] font-semibold">جزئیات رخداد</h2></div><div className="flex gap-2"><button type="button" onClick={copyDetails} className={`${control} whitespace-nowrap`}>{copied ? "کپی شد" : "کپی JSON"}</button><button type="button" onClick={onClose} aria-label="بستن جزئیات" className={`${control} flex w-10 items-center justify-center px-0`}><Icon name="close" className="h-4 w-4"/></button></div></header>
    <div className="space-y-6 p-4 sm:p-6">
      <div><div className="flex flex-wrap items-center gap-2"><SeverityBadge level={log.level}/><StatusBadge status={log.status}/><span className="text-[10px] text-neutral-500">{sourceLabel[log.source]}</span><span className="text-[10px] text-neutral-400">× {number.format(log.occurrenceCount)} رخداد</span></div><p className="mt-4 text-[14px] font-medium leading-7">{log.message}</p><p dir="ltr" className="mt-2 break-all text-left font-mono text-[10px] text-neutral-500">{log.eventType}</p></div>
      <dl className="grid border border-neutral-200 sm:grid-cols-2">{[
        ["اولین مشاهده", formatDate(log.firstSeenAt)], ["آخرین مشاهده", formatDate(log.lastSeenAt)],
        ["مسیر", log.path ?? "—"], ["HTTP", log.httpStatus ? `${log.httpMethod ?? ""} ${log.httpStatus}` : "—"],
        ["زمان پاسخ", log.durationMs !== null ? `${number.format(log.durationMs)} ms` : "—"], ["محیط / نسخه", `${log.environment}${log.release ? ` · ${log.release}` : ""}`],
        ["نقش کاربر", log.actorRole ?? "ناشناس"], ["Request ID", log.requestId ?? "—"],
      ].map(([label, value]) => <div key={label} className="min-w-0 border-b border-neutral-200 p-3 last:border-b-0 sm:border-l sm:[&:nth-child(even)]:border-l-0"><dt className="text-[9px] text-neutral-400">{label}</dt><dd dir={label === "مسیر" || label === "Request ID" ? "ltr" : "rtl"} className="mt-1 break-all text-[10.5px] text-neutral-700">{value}</dd></div>)}</dl>
      {log.stack ? <section><h3 className="text-[11px] font-medium">Stack trace</h3><pre dir="ltr" className="mt-2 max-h-80 overflow-auto border border-neutral-800 bg-[#071c31] p-4 text-left font-mono text-[10px] leading-5 text-slate-200">{log.stack}</pre></section> : null}
      {metadata ? <section><h3 className="text-[11px] font-medium">Metadata امن</h3><pre dir="ltr" className="mt-2 max-h-64 overflow-auto border border-neutral-200 bg-neutral-50 p-4 text-left font-mono text-[10px] leading-5 text-neutral-700">{metadata}</pre></section> : null}
      <section className="border-t border-neutral-200 pt-5"><label className="block text-[10.5px] text-neutral-600">یادداشت بررسی<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1_000} placeholder="علت، راه‌حل یا شماره تسک مرتبط…" className={`mt-2 w-full border border-neutral-300 p-3 text-[11px] outline-none ${focus}`}/></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending || log.status === "resolved"} onClick={() => changeStatus("resolved")} className={`h-10 bg-[#36563a] px-4 text-[10.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}>علامت‌گذاری رفع‌شده</button><button type="button" disabled={pending || log.status === "ignored"} onClick={() => changeStatus("ignored")} className={`h-10 border border-neutral-300 px-4 text-[10.5px] disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}>نادیده گرفتن</button><button type="button" disabled={pending || log.status === "open"} onClick={() => changeStatus("open")} className={`h-10 border border-amber-300 px-4 text-[10.5px] text-amber-800 disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}>بازگشایی</button>{pending ? <span role="status" className="self-center text-[10px] text-neutral-500">در حال ثبت…</span> : null}</div>{actionError ? <p role="alert" className="mt-3 text-[10px] text-red-700">{actionError}</p> : null}</section>
      {log.resolvedAt ? <p className="border-t border-neutral-100 pt-4 text-[9.5px] text-neutral-500">آخرین تعیین وضعیت: {formatDate(log.resolvedAt)}{log.resolvedBy ? ` · توسط ${log.resolvedBy}` : ""}</p> : null}
    </div>
  </section></div>;
}

export default function AdminLogs() {
  const [filters, setFilters] = useState<SystemLogFilters>({ level: "all", source: "all", status: "open", range: "24h", query: "", page: 1, limit: 50 });
  const deferredQuery = useDeferredValue(filters.query);
  const [data, setData] = useState<SystemLogsResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<SystemLog | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const loaded = useRef(false);
  const requestFilters = useMemo(() => ({ ...filters, query: deferredQuery }), [filters.level, filters.source, filters.status, filters.range, filters.page, filters.limit, deferredQuery]);

  useEffect(() => {
    const controller = new AbortController();
    if (!loaded.current) setRefreshing(true);
    setError("");
    loadSystemLogs(requestFilters, controller.signal)
      .then((result) => { setData(result); loaded.current = true; })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        if (reason instanceof ApiError && reason.code === "UNAUTHORIZED") setError("برای مشاهده لاگ‌های سیستم باید با حساب مدیر وارد شوید.");
        else setError("دریافت لاگ‌ها انجام نشد. اتصال بک‌اند و وضعیت دیتابیس را بررسی کنید.");
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [requestFilters, refreshKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => setRefreshKey((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const changeFilters = (patch: Partial<SystemLogFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters({ level: "all", source: "all", status: "all", range: "24h", query: "", page: 1, limit: 50 });
  const updateStatus = async (status: SystemLogStatus, note: string) => {
    if (!selected) return;
    const { log } = await updateSystemLogStatus(selected.id, status, note);
    setSelected(log);
    setData((current) => current ? { ...current, logs: current.logs.map((item) => item.id === log.id ? log : item) } : current);
    setRefreshKey((value) => value + 1);
  };
  const exportCsv = () => {
    if (!data?.logs.length) return;
    const rows = [["time", "level", "source", "status", "message", "path", "http_status", "duration_ms", "occurrences", "request_id"], ...data.logs.map((log) => [log.lastSeenAt, log.level, log.source, log.status, log.message, log.path ?? "", String(log.httpStatus ?? ""), String(log.durationMs ?? ""), String(log.occurrenceCount), log.requestId ?? ""])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `kolbe-logs-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const summary = data?.summary ?? emptySummary;
  return <div className="space-y-5">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[9px] tracking-[0.2em] text-neutral-400">OBSERVABILITY CENTER</p><h1 className="mt-1.5 text-[20px] font-semibold tracking-tight">لاگ‌ها و خطاهای سیستم</h1><p className="mt-2 max-w-2xl text-[10.5px] leading-6 text-neutral-500">خطاهای API و مرورگر، درخواست‌های کند و عملیات حساس مدیریت در یک صف قابل پیگیری و بدون ثبت اطلاعات محرمانه.</p></div><div className="flex items-center gap-2 text-[9.5px] text-neutral-500"><span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : refreshing ? "animate-pulse bg-amber-400" : "bg-emerald-500"}`}/><span aria-live="polite">{error ? "ارتباط قطع" : refreshing ? "در حال همگام‌سازی" : autoRefresh ? "پایش زنده · هر ۱۵ ثانیه" : "به‌روزرسانی دستی"}</span></div></header>
    <SummaryStrip summary={summary} loading={!data && refreshing}/>
    <div>
      <LogToolbar filters={filters} onChange={changeFilters} autoRefresh={autoRefresh} onAutoRefresh={setAutoRefresh} refreshing={refreshing} onRefresh={() => setRefreshKey((value) => value + 1)} onExport={exportCsv}/>
      <section className="min-h-72 border border-neutral-200 bg-white" aria-label="فهرست رخدادها">
        {!data && refreshing ? <LoadingRows/> : error ? <div role="alert" className="grid min-h-72 place-items-center p-8 text-center"><div><p className="text-[13px] font-medium">لاگ‌ها در دسترس نیستند</p><p className="mt-2 text-[10.5px] leading-6 text-neutral-500">{error}</p><button type="button" onClick={() => setRefreshKey((value) => value + 1)} className={`mt-4 h-10 bg-[#011c3a] px-5 text-[10.5px] text-white ${focus}`}>تلاش دوباره</button></div></div> : data && data.logs.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700"><Icon name="check" className="h-4 w-4"/></span><p className="mt-3 text-[13px] font-medium">رخدادی با این فیلتر پیدا نشد</p><p className="mt-2 text-[10.5px] text-neutral-500">اگر دنبال رخداد قدیمی‌تری هستید، بازه زمانی یا وضعیت را تغییر دهید.</p><button type="button" onClick={clearFilters} className={`mt-4 text-[10.5px] underline underline-offset-4 ${focus}`}>پاک‌کردن فیلترها</button></div></div> : data ? <><LogTable logs={data.logs} onSelect={setSelected}/><MobileLogList logs={data.logs} onSelect={setSelected}/></> : null}
      </section>
      {data ? <footer className="flex flex-col gap-3 border-x border-b border-neutral-200 bg-white px-4 py-3 text-[10px] text-neutral-500 sm:flex-row sm:items-center sm:justify-between"><p>{number.format(data.pagination.total)} گروه رخداد{data.pagination.capped ? " · نمایش بر اساس ۱۰۰۰ رخداد اخیر" : ""}</p><div className="flex items-center gap-2"><label className="flex items-center gap-2">تعداد<select value={filters.limit} onChange={(event) => changeFilters({ limit: Number(event.target.value), page: 1 })} className="h-8 border border-neutral-300 bg-white px-2"><option value="25">۲۵</option><option value="50">۵۰</option><option value="100">۱۰۰</option></select></label><button type="button" disabled={data.pagination.page <= 1} onClick={() => changeFilters({ page: Math.max(1, filters.page - 1) })} className={`h-8 border border-neutral-300 px-3 disabled:opacity-35 ${focus}`}>قبلی</button><span>صفحه {number.format(data.pagination.page)} از {number.format(data.pagination.pageCount)}</span><button type="button" disabled={data.pagination.page >= data.pagination.pageCount} onClick={() => changeFilters({ page: filters.page + 1 })} className={`h-8 border border-neutral-300 px-3 disabled:opacity-35 ${focus}`}>بعدی</button></div></footer> : null}
    </div>
    {selected ? <LogInspector key={selected.id} log={selected} onClose={() => setSelected(null)} onStatus={updateStatus}/> : null}
  </div>;
}
