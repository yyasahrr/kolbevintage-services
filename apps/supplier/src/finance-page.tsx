import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CreditCard, RefreshCw, WalletCards } from 'lucide-react'
import { Status } from './components'
import {
  addSupplierPayoutAccount,
  loadSupplierWallet,
  requestSupplierWithdrawal,
  type SupplierWallet,
} from './finance-api'

const toman = new Intl.NumberFormat('fa-IR')
const date = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' })

function money(value: number) {
  return `${toman.format(value)} تومان`
}

function statusLabel(status: string) {
  switch (status) {
    case 'requested': return 'درخواست ثبت شد'
    case 'processing': return 'در حال پرداخت'
    case 'paid': return 'واریز شد'
    case 'failed': return 'ناموفق'
    case 'rejected': return 'رد شد'
    case 'cancelled': return 'لغو شد'
    case 'verified': return 'تأییدشده'
    case 'pending': return 'در انتظار تأیید'
    default: return status
  }
}

function entryLabel(type: string) {
  switch (type) {
    case 'sale': return 'فروش سفارش'
    case 'commission': return 'کمیسیون کلبه'
    case 'refund': return 'مرجوعی'
    case 'commission_reversal': return 'اصلاح کمیسیون'
    case 'adjustment': return 'تعدیل مالی'
    case 'payout': return 'برداشت وجه'
    default: return type
  }
}

export function SupplierFinancePage() {
  const [wallet, setWallet] = useState<SupplierWallet | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [sheba, setSheba] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try { setWallet(await loadSupplierWallet()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'بارگذاری اطلاعات مالی انجام نشد.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  const defaultAccount = useMemo(
    () => wallet?.payout_accounts.find(account => account.is_default) ?? wallet?.payout_accounts[0],
    [wallet],
  )

  const requestWithdrawal = async (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(withdrawAmount.replace(/[^0-9]/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError('مبلغ برداشت معتبر نیست.'); return }
    setSubmitting(true); setError(''); setNotice('')
    try {
      await requestSupplierWithdrawal(amount)
      setWithdrawAmount('')
      setNotice('درخواست برداشت ثبت شد و تا زمان پردازش، مبلغ آن از موجودی قابل برداشت رزرو می‌شود.')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ثبت درخواست برداشت انجام نشد.') }
    finally { setSubmitting(false) }
  }

  const savePayoutAccount = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true); setError(''); setNotice('')
    try {
      await addSupplierPayoutAccount({ sheba, accountHolder, bankName, makeDefault: true })
      setSheba(''); setAccountHolder(''); setBankName('')
      setNotice('شماره شبا ثبت شد. برداشت وجه پس از تأیید حساب توسط کلبه فعال می‌شود.')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ثبت حساب تسویه انجام نشد.') }
    finally { setSubmitting(false) }
  }

  if (loading && !wallet) return <section className="surface"><p>در حال بارگذاری اطلاعات مالی…</p></section>
  if (!wallet) return <section className="surface"><p className="low-number">{error || 'اطلاعات مالی در دسترس نیست.'}</p><button className="button secondary" onClick={() => void refresh()}><RefreshCw size={16}/>تلاش دوباره</button></section>

  const canWithdraw = wallet.payouts_enabled && defaultAccount?.status === 'verified' && wallet.withdrawable_balance >= wallet.min_withdrawal_amount

  return <>
    <div className="page-head">
      <div><p className="eyebrow">FINANCE</p><h1>مالی و تسویه</h1><p>فروش، کمیسیون، مبالغ در انتظار آزادسازی و برداشت‌های شما از دفتر مالی واقعی کلبه محاسبه می‌شوند.</p></div>
      <button className="button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16}/>به‌روزرسانی</button>
    </div>

    {error ? <p className="auth-error" role="alert">{error}</p> : null}
    {notice ? <section className="surface"><p>{notice}</p></section> : null}

    <section className="balance-grid">
      <article className="balance-main"><p>موجودی قابل برداشت</p><strong>{toman.format(wallet.withdrawable_balance)} <span>تومان</span></strong><div><span>دوره نگهداشت تسویه</span><b>{toman.format(wallet.settlement_hold_days)} روز</b></div></article>
      <article><p>در انتظار آزادسازی</p><strong>{toman.format(wallet.pending_balance)}</strong><span>پس از تحویل موفق و پایان دوره نگهداشت آزاد می‌شود.</span></article>
      <article><p>رزرو برداشت</p><strong>{toman.format(wallet.reserved_for_withdrawal)}</strong><span>درخواست‌های ثبت‌شده یا در حال پردازش</span></article>
    </section>

    {!wallet.terms_configured ? <section className="surface"><h3>شرایط مالی هنوز فعال نشده است</h3><p>کمیسیون، دوره نگهداشت و حداقل برداشت باید توسط کلبه برای قرارداد شما تنظیم شود.</p></section> : null}

    <section className="profile-grid">
      <section className="surface profile-section">
        <div className="section-heading"><div><h2>حساب تسویه</h2><p>فقط شماره شبای تأییدشده برای برداشت استفاده می‌شود.</p></div><CreditCard size={20}/></div>
        {defaultAccount ? <div className="profile-details"><div><span>شماره شبا</span><b>{defaultAccount.sheba}</b></div><div><span>صاحب حساب</span><b>{defaultAccount.account_holder}</b></div><div><span>وضعیت</span><Status>{statusLabel(defaultAccount.status)}</Status></div></div> : <p>حساب تسویه‌ای ثبت نشده است.</p>}
        <form onSubmit={savePayoutAccount} className="auth-form-wrap">
          <label className="auth-label">شماره شبا<input value={sheba} onChange={event => setSheba(event.target.value)} placeholder="IR000000000000000000000000"/></label>
          <label className="auth-label">نام صاحب حساب<input value={accountHolder} onChange={event => setAccountHolder(event.target.value)} /></label>
          <label className="auth-label">بانک<input value={bankName} onChange={event => setBankName(event.target.value)} /></label>
          <button className="button secondary" disabled={submitting}>ثبت برای بررسی</button>
        </form>
      </section>

      <section className="surface profile-section">
        <div className="section-heading"><div><h2>برداشت وجه</h2><p>مبلغ تا زمان نتیجه انتقال بانکی رزرو می‌شود.</p></div><WalletCards size={20}/></div>
        <form onSubmit={requestWithdrawal} className="auth-form-wrap">
          <label className="auth-label">مبلغ برداشت<input inputMode="numeric" value={withdrawAmount} onChange={event => setWithdrawAmount(event.target.value)} placeholder={toman.format(wallet.withdrawable_balance)}/></label>
          <small>حداقل برداشت: {money(wallet.min_withdrawal_amount)}</small>
          {!wallet.payouts_enabled ? <p className="low-number">برداشت برای این حساب هنوز توسط کلبه فعال نشده است.</p> : null}
          {defaultAccount?.status !== 'verified' ? <p className="low-number">برای برداشت، شماره شبا باید تأیید شود.</p> : null}
          <button className="button primary" disabled={!canWithdraw || submitting}>ثبت درخواست برداشت</button>
        </form>
      </section>
    </section>

    <section className="surface ledger">
      <div className="section-heading"><div><h2>گردش حساب</h2><p>رکوردهای Ledger قابل ویرایش یا حذف نیستند.</p></div></div>
      <div className="ledger-table">
        <div className="ledger-row header"><span>تاریخ</span><span>سفارش</span><span>شرح</span><span>مبلغ</span><span>وضعیت</span></div>
        {wallet.recent_entries.map(entry => {
          const positive = entry.direction === 'credit'
          const available = entry.available_at ? new Date(entry.available_at).getTime() <= Date.now() : false
          return <div className="ledger-row" key={entry.id}><span>{date.format(new Date(entry.created_at))}</span><b>{entry.order_code || '—'}</b><span>{entryLabel(entry.entry_type)}</span><b className={positive ? 'green-text' : 'low-number'}>{positive ? '+' : '−'} {money(entry.amount)}</b><Status>{available ? 'قابل برداشت' : 'در انتظار'}</Status></div>
        })}
        {!wallet.recent_entries.length ? <p>هنوز تراکنش مالی ثبت نشده است.</p> : null}
      </div>
    </section>

    <section className="surface ledger">
      <div className="section-heading"><div><h2>برداشت‌ها</h2></div></div>
      <div className="ledger-table">
        <div className="ledger-row header"><span>تاریخ</span><span>شناسه</span><span>شرح</span><span>مبلغ</span><span>وضعیت</span></div>
        {wallet.recent_withdrawals.map(item => <div className="ledger-row" key={item.id}><span>{date.format(new Date(item.requested_at))}</span><b>{item.id.slice(0, 8)}</b><span>{item.bank_reference ? `پیگیری: ${item.bank_reference}` : item.failure_reason || 'برداشت به حساب بانکی'}</span><b>{money(item.amount)}</b><Status>{statusLabel(item.status)}</Status></div>)}
        {!wallet.recent_withdrawals.length ? <p>هنوز برداشتی ثبت نشده است.</p> : null}
      </div>
    </section>
  </>
}
