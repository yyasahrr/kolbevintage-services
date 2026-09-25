'use client'

/**
 * مالی، تسویه و برداشت (فاز ۶.۲).
 *
 * مرجع: `supplier/financial-account/{summary,history,withdrawals}` و
 * `supplier/finance/proformas`. هیچ مانده‌ای در مرورگر ساخته نمی‌شود؛ مبلغِ
 * قابل برداشت همان چیزی است که سرور اعلام می‌کند و درخواستِ برداشت یک
 * `Idempotency-Key` می‌برد تا دوبار-ارسال، دو برداشت نسازد.
 */

import { Check, RefreshCw, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FinancialAccountSummary } from '@shared/supplier/contracts'
import { formatDate, formatDateTime, money, withdrawalStatusLabel, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { DataTable, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

const SUMMARY_CARDS: Array<{ key: keyof FinancialAccountSummary; label: string; tone?: string }> = [
  { key: 'availableAmount', label: 'قابل برداشت', tone: 'green' },
  { key: 'pendingAmount', label: 'در انتظار تسویه' },
  { key: 'heldAmount', label: 'مسدود', tone: 'amber' },
  { key: 'payoutSubmittedAmount', label: 'ارسال‌شده برای پرداخت' },
  { key: 'bankSettledAmount', label: 'نشسته به بانک', tone: 'green' },
]

export function FinancePage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [offset, setOffset] = useState(0)
  const pageSize = 20

  const summary = useSupplierResource(() => portal.api.finance.summary(), [version])
  const history = useSupplierResource(() => portal.api.finance.history({ limit: pageSize, offset }), [offset, version], {
    isEmpty: data => (data.items ?? []).length === 0,
  })
  const proformas = useSupplierResource(() => portal.api.finance.proformas({ limit: 10 }), [version], {
    isEmpty: data => (data.proformas ?? []).length === 0,
  })

  const summaryData = dataOrNull(summary.state)
  const historyRows = useMemo(() => dataOrNull(history.state)?.items ?? [], [history.state])
  const proformaRows = useMemo(() => dataOrNull(proformas.state)?.proformas ?? [], [proformas.state])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">مالی / تسویه</p>
          <h1>مالی و تسویه</h1>
          <p>مانده، گردش حساب و پیش‌فاکتورها — همه از سرور.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => { summary.reload(); history.reload(); proformas.reload() }}>
          <RefreshCw size={15} />به‌روزرسانی
        </button>
      </div>

      <StateView state={summary.state} emptyLabel="حساب مالی‌ای برای این تأمین‌کننده ساخته نشده است" onRetry={summary.reload}>
        <section className="balance-grid">
          {SUMMARY_CARDS.map(card => (
            <article className={card.tone === 'green' ? 'balance-main' : undefined} key={String(card.key)}>
              <p>{card.label}</p>
              <strong className="numeric">{money(summaryData?.[card.key] as string | null | undefined)}</strong>
              <span>تومان</span>
            </article>
          ))}
        </section>
      </StateView>

      <section className="surface ledger">
        <SectionHeading eyebrow="گردش حساب" title="تاریخچهٔ مالی" description="فهرست صفحه‌بندی‌شده از سرور؛ هیچ ردیفی در مرورگر ساخته نمی‌شود." />
        <StateView state={history.state} emptyLabel="گردش مالی ثبت نشده است" onRetry={history.reload}>
          <DataTable
            columns={[
              { key: 'date', header: 'تاریخ', primary: true, render: row => formatDateTime(row.createdAt) },
              { key: 'type', header: 'نوع', render: row => row.type ?? '—' },
              { key: 'reference', header: 'مرجع', render: row => <span className="ltr-inline">{row.referenceId ?? row.referenceType ?? '—'}</span> },
              { key: 'amount', header: 'مبلغ', align: 'end', primary: true, render: row => <span className="numeric">{money(row.amount)}</span> },
              { key: 'balance', header: 'ماندهٔ پس از آن', align: 'end', render: row => <span className="numeric">{money(row.balanceAfter)}</span> },
            ]}
            rows={historyRows}
            rowKey={row => row.id}
            busy={history.busy}
          />
          <div className="table-footer">
            <span>نمایش {historyRows.length.toLocaleString('fa-IR')} ردیف</span>
            <div className="pager-actions">
              <button type="button" className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>قبلی</button>
              <button type="button" className="button secondary" disabled={historyRows.length < pageSize} onClick={() => setOffset(offset + pageSize)}>بعدی</button>
            </div>
          </div>
        </StateView>
      </section>

      <section className="surface ledger">
        <SectionHeading eyebrow="پیش‌فاکتور" title="پیش‌فاکتورهای صادرشده" />
        <StateView state={proformas.state} emptyLabel="پیش‌فاکتوری صادر نشده است">
          <ul className="notice-list">
            {proformaRows.map(proforma => (
              <li key={proforma.id}>
                <Wallet size={16} />
                <div>
                  <b className="ltr-inline">{proforma.reference ?? proforma.id}</b>
                  <span>{formatDate(proforma.issuedAt)} · سررسید {formatDate(proforma.dueAt)}</span>
                </div>
                <span className="numeric">{money(proforma.totalAmount)}</span>
              </li>
            ))}
          </ul>
        </StateView>
      </section>
    </>
  )
}

export function WithdrawalsPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const mutation = useSupplierMutation()
  const [amount, setAmount] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const pageSize = 20

  const summary = useSupplierResource(() => portal.api.finance.summary(), [version])
  const withdrawals = useSupplierResource(
    () => portal.api.finance.withdrawals({ limit: pageSize, offset }),
    [offset, version, mutation.busy],
    { isEmpty: data => (data.withdrawals ?? []).length === 0 },
  )
  const rows = useMemo(() => dataOrNull(withdrawals.state)?.withdrawals ?? [], [withdrawals.state])
  const available = dataOrNull(summary.state)?.availableAmount ?? null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    const normalized = amount.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '')
    if (!normalized || normalized === '0') {
      setLocalError('مبلغ برداشت را وارد کنید (فقط رقم، بزرگ‌تر از صفر).')
      return
    }
    // مبلغ به‌صورت رشتهٔ ده‌دهی می‌رود؛ سرور آن را به bigint تبدیل و اعتبارسنجی می‌کند.
    const result = await mutation.run(() => portal.api.finance.requestWithdrawal(normalized, crypto.randomUUID()))
    if (result.ok) {
      setAmount('')
      withdrawals.reload()
      summary.reload()
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">مالی / برداشت</p>
          <h1>برداشت‌ها</h1>
          <p>درخواست برداشت و پیگیری وضعیت آن.</p>
        </div>
        <button type="button" className="button secondary" onClick={withdrawals.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <StateView state={summary.state} emptyLabel="حساب مالی در دسترس نیست">
        <section className="balance-grid">
          <article className="balance-main">
            <p>قابل برداشت (اعلام‌شده توسط سرور)</p>
            <strong className="numeric">{money(available)}</strong>
            <span>تومان</span>
          </article>
        </section>
      </StateView>

      <form className="surface form-surface" onSubmit={submit} noValidate>
        <SectionHeading eyebrow="درخواست جدید" title="ثبت درخواست برداشت" description="سرور واجد شرایط بودن را بررسی می‌کند؛ اگر مانده یا مقصد بانکی آماده نباشد، دلیل را نمایش می‌دهیم." />
        <Field label="مبلغ (ریال)" required hint="رشتهٔ ده‌دهی؛ بدون ممیز">
          <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="numeric" required className="ltr-inline" dir="ltr" />
        </Field>
        <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
          <button type="submit" className="button primary" disabled={mutation.busy}><Check size={16} />ثبت درخواست</button>
        </SubmitBar>
        {mutation.message ? <Notice tone="info" title="ثبت شد">{mutation.message}</Notice> : null}
      </form>

      <section className="surface table-surface">
        <SectionHeading title="تاریخچهٔ برداشت" />
        <StateView state={withdrawals.state} emptyLabel="درخواست برداشتی ثبت نشده است" onRetry={withdrawals.reload}>
          <DataTable
            columns={[
              { key: 'id', header: 'شناسه', primary: true, render: row => <span className="ltr-inline">{row.id}</span> },
              { key: 'amount', header: 'مبلغ', align: 'end', primary: true, render: row => <span className="numeric">{money(row.amount)}</span> },
              { key: 'requested', header: 'تاریخ درخواست', render: row => formatDateTime(row.requestedAt) },
              { key: 'status', header: 'وضعیت', primary: true, render: row => <Status tone={statusTone(row.status)}>{withdrawalStatusLabel(row.status)}</Status> },
              { key: 'reason', header: 'توضیح', render: row => row.rejectionReason ?? '—' },
            ]}
            rows={rows}
            rowKey={row => row.id}
            busy={withdrawals.busy}
          />
          <div className="table-footer">
            <span>نمایش {rows.length.toLocaleString('fa-IR')} مورد</span>
            <div className="pager-actions">
              <button type="button" className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>قبلی</button>
              <button type="button" className="button secondary" disabled={rows.length < pageSize} onClick={() => setOffset(offset + pageSize)}>بعدی</button>
            </div>
          </div>
        </StateView>
      </section>
    </>
  )
}
