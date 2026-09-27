import { useEffect, useState } from "react";
import Admin from "./Admin";
import WholesaleAdmin from "./WholesaleAdmin";
import Icon from "../components/Icon";
import { Link } from "../router";
import { isBackendConfigured } from "../lib/api";
import { useStorefrontSession } from "../session/SessionProvider";
import { AuthBackLink, AuthError, AuthFooter, AuthForm, AuthHeader, AuthPanel, AuthShell, AuthStatus, AuthStory, accessDenied, presentAuthError, requiresTotp, type AuthErrorPresentation } from "../../shared/auth";
import { Button, InlineNotice, PasswordField, TextField } from "../../shared/components";

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
  const { session, resolving, error: restoreError, login, logout: endSession } = useStorefrontSession();
  const [workspace, setWorkspace] = useState<Workspace>("retail");
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<AuthErrorPresentation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const authenticated = session.status === "authenticated" && session.user.role === "admin";
  const forbidden = session.status === "authenticated" && session.user.role !== "admin";
  const logout = () => { void endSession(); setCredentials({ username: "", password: "" }); setError(null); };

  if (resolving) return <AuthStatus label="در حال بررسی دسترسی مدیریت" />;

  if (!authenticated) return (
    <AuthShell tone="control" story={<AuthStory eyebrow="ADMIN CONTROL" title="مدیریت دقیق فروشگاه و همکاری‌های تجاری" description="این ورودی تنها برای حساب‌هایی است که نقش مدیریت آن‌ها در نشست سرور تأیید شده است." />}>
      <AuthPanel labelledBy="admin-auth-title">
        <AuthBackLink href="/">بازگشت به وب‌سایت</AuthBackLink>
        <AuthHeader id="admin-auth-title" eyebrow="دسترسی محدود" title="ورود به مرکز مدیریت" description="اطلاعات حساب مدیریت را وارد کنید. سطح دسترسی پس از ورود از سرور بازخوانی می‌شود." />
        {restoreError ? <AuthError error={presentAuthError(restoreError)} /> : null}
        {forbidden ? <><AuthError error={accessDenied("نشست فعلی متعلق به حساب مدیریت نیست.")} /><Button variant="secondary" onClick={logout}>خروج از حساب فعلی</Button></> : (
          <AuthForm onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setError(null); try { const state = await login({ email: credentials.username, password: credentials.password, ...(totpCode ? { totpCode } : {}) }); if (state.session.status !== "authenticated" || state.session.user.role !== "admin") setError(accessDenied("این حساب دسترسی مدیریت کلبه را ندارد.")); } catch (reason) { if (requiresTotp(reason)) setTotpRequired(true); setError(presentAuthError(reason)); } finally { setSubmitting(false); } }}>
            <TextField autoFocus name="admin-username" type="email" label="ایمیل مدیر" autoComplete="username" dir="ltr" value={credentials.username} onChange={(event) => setCredentials((value) => ({ ...value, username: event.target.value }))} required disabled={submitting} />
            <PasswordField name="admin-password" label="رمز عبور" autoComplete="current-password" value={credentials.password} onChange={(password) => setCredentials((value) => ({ ...value, password }))} required disabled={submitting} />
            {totpRequired ? <TextField name="admin-totp" label="کد یک‌بارمصرف" autoComplete="one-time-code" inputMode="numeric" dir="ltr" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required disabled={submitting} /> : null}
            <AuthError error={error} />
            {!isBackendConfigured ? <InlineNotice intent="warning">اتصال بک‌اند تنظیم نشده است؛ ورود محلی غیرفعال است.</InlineNotice> : null}
            <Button type="submit" disabled={submitting || !isBackendConfigured}>{submitting ? "در حال تأیید هویت" : "ورود به پنل مدیریت"}</Button>
          </AuthForm>
        )}
        <BackendStatus />
        <AuthFooter>نشست با کوکی HttpOnly برقرار می‌شود و نقش مدیریت از پاسخ سرور خوانده می‌شود.</AuthFooter>
      </AuthPanel>
    </AuthShell>
  );

  return <div className="admin-system min-h-screen bg-[#f6f6f4]"><header className="sticky top-0 z-50 border-b border-neutral-200 bg-white/95 backdrop-blur-md"><div className="mx-auto flex min-h-[73px] max-w-[1800px] items-center gap-3 px-4 lg:px-6">
    <div className="hidden min-w-44 flex-col leading-none sm:flex"><span className="text-[15px] font-semibold tracking-[0.12em]">کلبه وینتیج</span><span className="mt-1.5 text-[7.5px] tracking-[0.34em] text-neutral-400">MANAGEMENT SYSTEM</span></div>
    <div className="flex min-w-0 flex-1 items-center justify-center"><div className="grid w-full max-w-[410px] grid-cols-2 border border-neutral-200 bg-[#f6f6f4] p-1" role="tablist" aria-label="انتخاب فضای مدیریت"><button role="tab" aria-selected={workspace === "retail"} onClick={() => setWorkspace("retail")} className={`h-10 px-3 text-[10.5px] font-medium transition ${focusRing} ${workspace === "retail" ? "bg-[#011c3a] text-white" : "text-neutral-500 hover:bg-white hover:text-neutral-900"}`}>مدیریت کلبه</button><button role="tab" aria-selected={workspace === "wholesale"} onClick={() => setWorkspace("wholesale")} className={`h-10 px-3 text-[10.5px] font-medium transition ${focusRing} ${workspace === "wholesale" ? "bg-[#011c3a] text-white" : "text-neutral-500 hover:bg-white hover:text-neutral-900"}`}>مدیریت عمده‌فروشی</button></div></div>
    <div className="flex min-w-fit items-center justify-end gap-2 sm:min-w-44"><Link to="/" aria-label="مشاهده وب‌سایت" className={`hidden h-10 items-center gap-2 px-2 text-[10.5px] text-neutral-500 hover:text-[#011c3a] md:flex ${focusRing}`}><Icon name="arrowLeft" className="h-3.5 w-3.5 rotate-180" />مشاهده سایت</Link><button type="button" onClick={logout} aria-label="خروج امن" className={`flex h-10 w-10 items-center justify-center border border-neutral-200 text-neutral-500 transition hover:border-red-200 hover:text-red-700 ${focusRing}`}><Icon name="user" className="h-4 w-4" /></button></div>
  </div></header>{workspace === "retail" ? <Admin embedded /> : <WholesaleAdmin />}</div>;
}
