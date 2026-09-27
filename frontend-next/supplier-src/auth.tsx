'use client'

/**
 * ورود، بازیابی نشست و درخواست عضویت (فاز ۶.۲).
 *
 * قواعد:
 *  - هویت فقط از سرور: `POST /auth/supplier/login` کوکی را می‌سازد و سپس
 *    `GET /auth/me` خوانده می‌شود؛ بدنهٔ پاسخِ ورود هرگز مرجعِ هویت نیست.
 *  - خروج و انقضای نشست، وضعیتِ نمایشی را کامل پاک می‌کند.
 *  - حالتِ نمایشی فقط با فلگِ صریحِ محیطی (`NEXT_PUBLIC_SUPPLIER_DEMO`) قابل
 *    فعال‌شدن است و با برچسبِ دائمی در UI نشان داده می‌شود؛ در تولید هرگز
 *    جایگزینِ خاموشِ ورود نمی‌شود.
 */

import { AlertTriangle, ArrowLeft, Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { isDemoModeAllowed } from '@shared/supplier/session'
import { AuthError, AuthFooter, AuthHeader, AuthPanel, AuthShell as SharedAuthShell, AuthStory, presentAuthError, requiresTotp, type AuthErrorPresentation } from '@shared/auth'
import { Button, PasswordField, TextField } from '@shared/components'
import { useSupplierPortal } from './context'

export type AuthView = 'login' | 'register'

export function AuthShell({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [view, setView] = useState<AuthView>('login')
  const [notice, setNotice] = useState('')

  return (
    <SharedAuthShell tone="partner" story={<AuthStory eyebrow="SUPPLIER OPERATIONS" title="عملیات همکاری، دقیق و یکپارچه" description="فروش، تولید و تسویهٔ تأمین‌کنندگان تأییدشده در یک فضای عملیاتی روشن مدیریت می‌شود." />}>
      <AuthPanel>
        {notice ? <AuthError error={{ kind: 'UNKNOWN', title: 'درخواست کامل نشد', message: notice, retryAfterSeconds: null }} /> : null}
        {view === 'login' ? (
          <LoginForm onRegister={() => setView('register')} onSuccess={onAuthenticated} onError={setNotice} />
        ) : (
          <RegistrationForm onBack={() => setView('login')} onError={setNotice} />
        )}
        <AuthFooter>هویت تأمین‌کننده و شناسهٔ مجموعه فقط از نشست سرور پذیرفته می‌شود.</AuthFooter>
      </AuthPanel>
    </SharedAuthShell>
  )
}

function LoginForm({ onRegister, onSuccess, onError }: { onRegister: () => void; onSuccess: () => void; onError: (message: string) => void }) {
  const portal = useSupplierPortal()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [error, setError] = useState<AuthErrorPresentation | null>(null)
  const [busy, setBusy] = useState(false)
  const demoAllowed = isDemoModeAllowed()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    onError('')
    if (!email.includes('@') || !password) {
      setError({ kind: 'VALIDATION_ERROR', title: 'اطلاعات را بررسی کنید', message: 'ایمیل معتبر و رمز عبور را وارد کنید.', retryAfterSeconds: null })
      return
    }
    setBusy(true)
    try {
      const session = await portal.session.login(email, password, totpCode || undefined)
      portal.setSessionState(session)
      portal.setDemoMode(false)
      onSuccess()
    } catch (caught) {
      // شکستِ ورود هرگز به «ورودِ نمایشی» تبدیل نمی‌شود.
      if (requiresTotp(caught)) setTotpRequired(true)
      setError(presentAuthError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <AuthHeader eyebrow="ورود تأمین‌کننده" title="به فضای کاری خود وارد شوید" description="اطلاعات حساب تأمین‌کنندهٔ تأییدشده را وارد کنید." />
      <form onSubmit={submit} noValidate className="kolbe-auth__form">
        <TextField type="email" label="ایمیل سازمانی" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="name@factory.ir" dir="ltr" required disabled={busy} />
        <PasswordField label="رمز عبور" value={password} onChange={setPassword} autoComplete="current-password" placeholder="رمز عبور شما" dir="ltr" required disabled={busy} />
        {totpRequired ? <TextField label="کد یک‌بارمصرف" value={totpCode} onChange={event => setTotpCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" dir="ltr" required disabled={busy} /> : null}
        <AuthError error={error} />
        <Button type="submit" disabled={busy}>{busy ? 'در حال بررسی' : 'ورود به پنل'} <ArrowLeft size={17} /></Button>
      </form>

      {demoAllowed ? (
        <Button
          type="button"
          variant="secondary"
          className="demo-toggle"
          onClick={() => { portal.setDemoMode(true); onSuccess() }}
        >
          <AlertTriangle size={15} />حالت نمایشی (بدون دادهٔ واقعی)
        </Button>
      ) : null}

      <div className="auth-divider"><span>یا</span></div>
      <div className="auth-register-prompt">
        <p>
          هنوز حساب تأمین‌کننده ندارید؟
          <span>فرآیند بررسی عضویت معمولاً ۱ تا ۲ روز کاری طول می‌کشد.</span>
        </p>
        <button type="button" className="button secondary" onClick={onRegister}>درخواست عضویت</button>
      </div>
    </div>
  )
}

function RegistrationForm({ onBack, onError }: { onBack: () => void; onError: (message: string) => void }) {
  const portal = useSupplierPortal()
  const [sent, setSent] = useState<string | null>(null)
  const [form, setForm] = useState({ company: '', representative: '', mobile: '', category: '', capacity: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [key]: event.target.value }))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    onError('')
    const digits = (value: string) => value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/\D/g, '')
    if (form.company.trim().length < 3 || form.representative.trim().length < 3 || digits(form.mobile).length < 10 || !form.category) {
      setError('نام کارخانه، نماینده، شمارهٔ همراه و دستهٔ تولید را کامل کنید.')
      return
    }
    setBusy(true)
    const result = await portal.api.auth.apply({
      companyName: form.company.trim(),
      representativeName: form.representative.trim(),
      phone: form.mobile.trim(),
      category: form.category,
      monthlyCapacity: form.capacity ? Number(digits(form.capacity)) : null,
    })
    setBusy(false)
    if (!result.ok) {
      // پیامِ اعتبارسنجیِ سرور عیناً نشان داده می‌شود.
      setError(result.error.message)
      return
    }
    setSent(result.data.id)
  }

  if (sent) {
    return (
      <div className="auth-form-wrap request-complete">
        <span className="request-success"><Check size={23} /></span>
        <p className="eyebrow">درخواست ثبت شد</p>
        <h2>در صف بررسی هستید.</h2>
        <p>کارشناسان تأمین کولبه برای هماهنگی ارزیابی ظرفیت و نمونه‌ها با شما تماس می‌گیرند.</p>
        <div className="request-reference">
          <span>شناسهٔ پیگیری</span>
          <strong className="ltr-inline">{sent}</strong>
        </div>
        <button type="button" className="button primary" onClick={onBack}>بازگشت به ورود</button>
      </div>
    )
  }

  return (
    <div className="auth-form-wrap">
      <button type="button" className="back-to-login" onClick={onBack}><ArrowLeft size={16} />بازگشت به ورود</button>
      <div className="auth-form-heading">
        <p className="eyebrow">درخواست عضویت</p>
        <h2>کارخانه‌تان را به کولبه معرفی کنید</h2>
        <p>این اطلاعات برای بررسی اولیهٔ ظرفیت و دستهٔ تولید شما استفاده می‌شود.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <label className="auth-label">
          نام کارخانه یا شرکت
          <input value={form.company} onChange={set('company')} aria-invalid={Boolean(error)} placeholder="مثال: پوشاک نیلگون" />
        </label>
        <label className="auth-label">
          نام و نام خانوادگی نماینده
          <input value={form.representative} onChange={set('representative')} placeholder="مثال: نرگس آذر" />
        </label>
        <span className="auth-form-grid">
          <label className="auth-label">
            شمارهٔ همراه
            <input value={form.mobile} onChange={set('mobile')} inputMode="tel" placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷" dir="ltr" className="ltr-inline" />
          </label>
          <label className="auth-label">
            دستهٔ اصلی تولید
            <select value={form.category} onChange={set('category')}>
              <option value="" disabled>انتخاب کنید</option>
              <option>پوشاک مردانه</option>
              <option>پوشاک زنانه</option>
              <option>کفش و اکسسوری</option>
            </select>
          </label>
        </span>
        <label className="auth-label">
          ظرفیت تولید ماهانه <span>اختیاری</span>
          <input value={form.capacity} onChange={set('capacity')} inputMode="numeric" placeholder="مثال: ۵٬۰۰۰ تکه" dir="ltr" className="ltr-inline" />
        </label>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy} className="auth-submit">
          {busy ? 'در حال ثبت…' : 'ارسال درخواست عضویت'} <ArrowLeft size={17} />
        </button>
      </form>
      <p className="auth-disclaimer">با ارسال درخواست، با بررسی اطلاعات کارخانه طبق سیاست حریم خصوصی کولبه موافقت می‌کنید.</p>
    </div>
  )
}
