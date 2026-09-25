'use client'

/**
 * RFQ و پیشنهاد قیمت (فاز ۶.۲).
 *
 * فهرست: `GET /api/v1/compat/supplier/rfqs` (seam ثبت‌شده در truth-registry).
 * پیشنهاد: `POST /api/v1/offers/compat/rfqs/:id/quote`.
 *
 * قاعدهٔ پول: قیمتِ واحد یک **رشتهٔ ده‌دهی** است. هیچ `Number()`/`parseFloat`
 * روی مبلغ انجام نمی‌شود و هیچ مبلغی در مرورگر محاسبه نمی‌شود؛ جمع و مالیات
 * مالکیتِ سرور است.
 */

import { Check, FileCheck2, RefreshCw, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupplierRfq } from '@shared/supplier/contracts'
import { formatDate, initials, money, quantity, rfqStatusLabel, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

export function RfqsPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pageSize = 20

  const rfqs = useSupplierResource(
    () => portal.api.rfqs.list({ limit: pageSize, offset }),
    [offset, version],
    { isEmpty: data => (data.rfqs ?? []).length === 0 },
  )
  const list = useMemo(() => dataOrNull(rfqs.state)?.rfqs ?? [], [rfqs.state])
  const selected = list.find(item => item.id === selectedId) ?? null

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">تولید سفارشی / صندوق RFQ</p>
          <h1>درخواست‌های تولید</h1>
          <p>درخواست‌ها را بررسی و برای آن‌ها پیشنهاد قیمت ثبت کنید.</p>
        </div>
        <button type="button" className="button secondary" onClick={rfqs.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <section className="rfq-layout">
        <div className="surface rfq-list">
          <StateView
            state={rfqs.state}
            emptyLabel="درخواست تولید جدیدی وجود ندارد"
            emptyDescription="وقتی کلبه درخواست تولید سفارشی برای شما ارسال کند، آن را اینجا می‌بینید."
            onRetry={rfqs.reload}
          >
            <ul className="rfq-rows">
              {list.map(rfq => (
                <li key={rfq.id}>
                  <button type="button" className={`rfq-row ${selectedId === rfq.id ? 'selected' : ''}`} onClick={() => setSelectedId(rfq.id)}>
                    <span className="rfq-avatar">{initials(rfq.customerName)}</span>
                    <div>
                      <div><b>{rfq.title}</b><Status tone={statusTone(rfq.status)}>{rfqStatusLabel(rfq.status)}</Status></div>
                      <span>{rfq.customerName ?? '—'} · {quantity(rfq.quantity)} تکه</span>
                      <small className="ltr-inline">{rfq.referenceCode ?? rfq.id} · موعد: {formatDate(rfq.requestedDeliveryDate)}</small>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="table-footer">
              <span>{list.length.toLocaleString('fa-IR')} مورد در این صفحه</span>
              <div className="pager-actions">
                <button type="button" className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>قبلی</button>
                <button type="button" className="button secondary" disabled={list.length < pageSize} onClick={() => setOffset(offset + pageSize)}>بعدی</button>
              </div>
            </div>
          </StateView>
        </div>

        {selected ? (
          <RfqDetail rfq={selected} onQuoted={rfqs.reload} />
        ) : (
          <aside className="surface rfq-detail">
            <div className="rfq-detail-head">
              <div>
                <p className="eyebrow">درخواستی انتخاب نشده است</p>
                <h2>جزئیات RFQ</h2>
                <p>یک درخواست از فهرست انتخاب کنید.</p>
              </div>
            </div>
          </aside>
        )}
      </section>
    </>
  )
}

function RfqDetail({ rfq, onQuoted }: { rfq: SupplierRfq; onQuoted: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onQuoted })
  const [unitPrice, setUnitPrice] = useState('')
  const [leadTimeDays, setLeadTimeDays] = useState('')
  const [notes, setNotes] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const specs = rfq.specifications ?? {}
  const specEntries = Object.entries(specs).filter(([, value]) => value !== null && value !== undefined)
  const canQuote = rfq.status === 'open'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    const price = unitPrice.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '')
    const days = Number(leadTimeDays.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '') || '0')
    if (!price) {
      setLocalError('قیمت واحد را وارد کنید (فقط رقم).')
      return
    }
    if (!Number.isFinite(days) || days <= 0) {
      setLocalError('زمان تحویل را بر حسب روز وارد کنید.')
      return
    }
    // قیمت به‌صورت رشتهٔ ده‌دهی ارسال می‌شود؛ محاسبهٔ مبلغ کل سمت سرور است.
    await mutation.run(() =>
      portal.api.rfqs.quote(rfq.id, {
        unitPrice: price,
        leadTimeDays: days,
        notes: notes.trim() || undefined,
      }),
    )
    setUnitPrice('')
    setLeadTimeDays('')
    setNotes('')
  }

  return (
    <section className="surface rfq-detail">
      <div className="rfq-detail-head">
        <div>
          <p className="eyebrow ltr-inline">{rfq.referenceCode ?? rfq.id}</p>
          <h2>{rfq.title}</h2>
          <p>{rfq.customerName ?? 'مشتری نامشخص'}</p>
        </div>
        <Status tone={statusTone(rfq.status)}>{rfqStatusLabel(rfq.status)}</Status>
      </div>

      <div className="request-banner">
        <div><p>حجم درخواست</p><strong>{quantity(rfq.quantity)}</strong><span>تکه</span></div>
        <div><p>موعد تحویل</p><strong>{formatDate(rfq.requestedDeliveryDate)}</strong><span>طبق درخواست</span></div>
        <div><p>تاریخ ثبت</p><strong>{formatDate(rfq.createdAt)}</strong><span>از سرور</span></div>
      </div>

      <div className="spec-columns">
        <div>
          <h3>مشخصات درخواست</h3>
          {specEntries.length > 0 ? (
            specEntries.map(([key, value]) => (
              <div className="spec" key={key}>
                <span>{key}</span>
                <b>{typeof value === 'string' ? value : JSON.stringify(value)}</b>
              </div>
            ))
          ) : (
            <p className="muted-line">سرور مشخصاتی برای این درخواست اعلام نکرده است.</p>
          )}
        </div>
      </div>

      {canQuote ? (
        <form className="sp-quote-form" onSubmit={submit} noValidate>
          <SectionHeading eyebrow="پیشنهاد کارخانه" title="ثبت پیشنهاد قیمت" description="مبلغ کل و مالیات سمت سرور محاسبه می‌شود؛ اینجا فقط قیمت واحد و زمان تحویل را اعلام می‌کنید." />
          <div className="sp-grid">
            <Field label="قیمت واحد (ریال)" required hint="رشتهٔ ده‌دهی؛ بدون ممیز و واحد">
              <input value={unitPrice} onChange={event => setUnitPrice(event.target.value)} inputMode="numeric" required className="ltr-inline" dir="ltr" />
            </Field>
            <Field label="زمان تحویل (روز)" required>
              <input value={leadTimeDays} onChange={event => setLeadTimeDays(event.target.value)} inputMode="numeric" required className="ltr-inline" dir="ltr" />
            </Field>
          </div>
          <Field label="توضیحات">
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="مثلاً حداقل مقدار قابل تولید یا شرایط پارچه" />
          </Field>
          <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
            <button type="submit" className="button primary" disabled={mutation.busy}><Send size={16} />ارسال پیشنهاد</button>
          </SubmitBar>
        </form>
      ) : (
        <Notice tone="info" title="این درخواست دیگر پذیرای پیشنهاد نیست">
          وضعیتِ فعلی از سرور آمده است؛ برای تغییر آن باید کلبه اقدام کند.
        </Notice>
      )}

      {mutation.message ? <Notice tone="info" title="پیشنهاد ثبت شد"><Check size={14} /> {mutation.message}</Notice> : null}
    </section>
  )
}

export function RfqEmptyIcon() {
  return <FileCheck2 size={20} />
}

export function quotePreviewLabel(value: string): string {
  return money(value)
}
