import { useEffect, useState } from "react";
import Admin from "./Admin";
import WholesaleAdmin from "./WholesaleAdmin";
import Icon from "../components/Icon";
import { Link } from "../router";
import { isBackendConfigured as isSupabaseConfigured } from "../lib/api";
import { restoreAdminSession, signInAdmin, signOutAdmin } from "../lib/wholesaleApi";
import { PANELS_PREVIEW_MODE } from "../previewMode";

type Workspace = "retail" | "wholesale";

/** مارکر نسخه - با هر تغییر کد آپدیت میشود تا تب قدیمی فوراً شناسایی شود */
const BUILD = "b-601206f";

function BackendStatus() {
  const [state, setState] = useState<{ ok: boolean; detail: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      const started = performance.now();
      try {
        const res = await fetch("/store/kolbe/health");
        if (!alive) return;
        setState(res.ok
          ? { ok: true, detail: `\u200e${Math.round(performance.now() - started)}ms` }
          : { ok: false, detail: `HTTP ${res.status}` });
      } catch (error) {
        if (alive) setState({ ok: false, detail: error instanceof Error ? error.name : "NETWORK" });
      }
    };
    ping();
    const timer = window.setInterval(ping, 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 text-[9.5px] text-neutral-400" dir="rtl">
      <span className="num-fa">نسخه {BUILD}</span>
      {state === null ? (
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-300" />در حال بررسی بک‌اند…</span>
      ) : state.ok ? (
        <span className="flex items-center gap-1.5 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />بک‌اند متصل ({state.detail})</span>
      ) : (
        <span className="flex items-center gap-1.5 text-red-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />بک‌اند در دسترس نیست ({state.detail})</span>
      )}
    </div>
  );
}
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

export default function AdminPortal() {
  const [authenticated, setAuthenticated] = useState(PANELS_PREVIEW_MODE);
  const [restoring, setRestoring] = useState(!PANELS_PREVIEW_MODE);
  const [workspace, setWorkspace] = useState<Workspace>("retail");
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (PANELS_PREVIEW_MODE) return;
    restoreAdminSession().then(setAuthenticated).finally(() => setRestoring(false));
  }, []);
  const logout = () => { if (PANELS_PREVIEW_MODE) return; signOutAdmin().catch(() => undefined); setAuthenticated(false); setCredentials({ username: "", password: "" }); };

  if (restoring) return <main className="admin-system grid min-h-screen place-items-center bg-[#f4f3ef]"><div role="status" className="text-center"><span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-[#011c3a]/20 border-t-[#011c3a]"/><p className="mt-4 text-[11px] text-neutral-500">در حال بررسی نشست امن…</p></div></main>;

  if (!authenticated) return (
    <main className="admin-system grid min-h-screen bg-[#f4f3ef] lg:grid-cols-[0.9fr_1.1fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#011c3a] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <img src="/images/store.jpg" alt="فضای فروشگاه کلبه وینتیج" className="absolute inset-0 h-full w-full object-cover opacity-30" /><span className="absolute inset-0 bg-[#011c3a]/65" aria-hidden="true" />
        <div className="relative"><p className="text-[18px] font-semibold tracking-[0.14em]">کلبه وینتیج</p><p className="mt-2 text-[8px] tracking-[0.38em] text-white/50">KOLBE VINTAGE</p></div>
        <div className="relative max-w-lg"><p className="text-[10px] tracking-[0.22em] text-white/45">CONTROL ROOM</p><h1 className="mt-4 text-[34px] font-medium leading-[1.6]">یک مرکز کنترل برای فروشگاه و همکاری‌های عمده</h1><p className="mt-4 max-w-md text-[12px] leading-7 text-white/60">محصول، سفارش، محتوا و عملیات همکاران تجاری را از دو فضای کاری مستقل مدیریت کنید.</p></div>
        <p className="relative text-[9.5px] text-white/35">دسترسی مدیریت · نشست امن مرورگر</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8"><form onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setError(""); try { await signInAdmin(credentials.username, credentials.password); setAuthenticated(true); } catch (reason) { setError(reason instanceof Error ? reason.message : "ورود انجام نشد."); } finally { setSubmitting(false); } }} className="w-full max-w-sm">
        <div className="mb-9 lg:hidden"><p className="text-[18px] font-semibold tracking-[0.14em]">کلبه وینتیج</p><p className="mt-2 text-[8px] tracking-[0.38em] text-neutral-400">KOLBE VINTAGE</p></div>
        <p className="text-[9px] tracking-[0.24em] text-neutral-400">ADMIN ACCESS</p><h1 className="mt-3 text-[25px] font-medium tracking-tight">ورود به مرکز مدیریت</h1><p className="mt-2 text-[11px] leading-6 text-neutral-500">برای مدیریت فروشگاه و سرویس عمده‌فروشی وارد شوید.</p>
        <div className="mt-7 space-y-4"><label className="block text-[10.5px] text-neutral-600">ایمیل مدیر<input autoFocus name="admin-username" type="email" autoComplete="username" value={credentials.username} onChange={(event) => setCredentials((value) => ({ ...value, username: event.target.value }))} className={`mt-1.5 h-11 w-full border border-neutral-300 bg-white px-3 text-[12px] ${focusRing}`} /></label><label className="block text-[10.5px] text-neutral-600">رمز عبور<input name="admin-password" type="password" autoComplete="current-password" value={credentials.password} onChange={(event) => setCredentials((value) => ({ ...value, password: event.target.value }))} className={`mt-1.5 h-11 w-full border border-neutral-300 bg-white px-3 text-[12px] ${focusRing}`} /></label></div>
        {error && <p role="alert" className="mt-4 border border-red-200 bg-red-50 px-3 py-2.5 text-[10.5px] text-red-700">{error}</p>}
        {!isSupabaseConfigured && <p role="alert" className="mt-4 border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10.5px] text-amber-800">اتصال بک‌اند تنظیم نشده است؛ ورود محلی غیرفعال است.</p>}
        <button type="submit" disabled={submitting || !isSupabaseConfigured} className={`mt-5 h-11 w-full bg-[#011c3a] text-[12px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}>{submitting ? "در حال بررسی…" : "ورود به پنل مدیریت"}</button>
        <BackendStatus />
        <Link to="/" className={`mt-3 flex items-center justify-center gap-2 text-[10.5px] text-neutral-500 underline-offset-4 hover:underline ${focusRing}`}><Icon name="arrowLeft" className="h-3.5 w-3.5 rotate-180" />بازگشت به وب‌سایت</Link>
      </form></section>
    </main>
  );

  return <div className="admin-system min-h-screen bg-[#f6f6f4]"><header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/95 backdrop-blur-md"><div className="mx-auto flex min-h-[73px] max-w-[1800px] items-center gap-3 px-4 lg:px-6">
    <div className="hidden min-w-44 flex-col leading-none sm:flex"><span className="text-[15px] font-semibold tracking-[0.12em]">کلبه وینتیج</span><span className="mt-1.5 text-[7.5px] tracking-[0.34em] text-neutral-400">MANAGEMENT SYSTEM</span></div>
    <div className="flex min-w-0 flex-1 items-center justify-center"><div className="grid w-full max-w-[410px] grid-cols-2 border border-neutral-200 bg-[#f6f6f4] p-1" role="tablist" aria-label="انتخاب فضای مدیریت"><button role="tab" aria-selected={workspace === "retail"} onClick={() => setWorkspace("retail")} className={`h-10 px-3 text-[10.5px] font-medium transition ${focusRing} ${workspace === "retail" ? "bg-[#011c3a] text-white" : "text-neutral-500 hover:bg-white hover:text-neutral-900"}`}>مدیریت کلبه</button><button role="tab" aria-selected={workspace === "wholesale"} onClick={() => setWorkspace("wholesale")} className={`h-10 px-3 text-[10.5px] font-medium transition ${focusRing} ${workspace === "wholesale" ? "bg-[#011c3a] text-white" : "text-neutral-500 hover:bg-white hover:text-neutral-900"}`}>مدیریت عمده‌فروشی</button></div></div>
    <div className="flex min-w-fit items-center justify-end gap-2 sm:min-w-44"><Link to="/" aria-label="مشاهده وب‌سایت" className={`hidden h-10 items-center gap-2 px-2 text-[10.5px] text-neutral-500 hover:text-[#011c3a] md:flex ${focusRing}`}><Icon name="arrowLeft" className="h-3.5 w-3.5 rotate-180" />مشاهده سایت</Link><button type="button" onClick={logout} aria-label="خروج امن" className={`flex h-10 w-10 items-center justify-center border border-neutral-200 text-neutral-500 transition hover:border-red-200 hover:text-red-700 ${focusRing}`}><Icon name="user" className="h-4 w-4" /></button></div>
  </div></header>{PANELS_PREVIEW_MODE && <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[10.5px] text-amber-800">حالت پیش‌نمایش فعال است — ورود ادمین موقتاً غیرفعال و داده‌های زنده در دسترس نیستند.</div>}{workspace === "retail" ? <Admin embedded /> : <WholesaleAdmin />}</div>;
}
