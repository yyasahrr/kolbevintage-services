'use client'

/**
 * پشتیبانی (فاز ۶.۲).
 *
 * مالکیتِ دامنه: `support` (پرونده‌ها و گفت‌وگو) — از `compliance` جداست؛ grouping
 * بصری در ناوبری، مالکیتِ کد را ادغام نمی‌کند.
 *
 * مرجع: `supplier/support/cases` (فهرست/جزئیات/پیام).
 */

import { Check, MessageSquareText, Plus, RefreshCw, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupportCase, SupportMessage } from '@shared/supplier/contracts'
import { formatDateTime, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { Drawer, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

const CATEGORIES = ['order', 'settlement', 'product', 'technical', 'other']
const CATEGORY_LABEL: Record<string, string> = {
  order: 'سفارش و ارسال',
  settlement: 'مالی و تسویه',
  product: 'محصول و کاتالوگ',
  technical: 'فنی',
  other: 'سایر',
}

export function SupportPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const pageSize = 20

  const cases = useSupplierResource(() => portal.api.support.list({ limit: pageSize, offset }), [offset, version], {
    isEmpty: data => (data.cases ?? []).length === 0,
  })
  const list = useMemo(() => dataOrNull(cases.state)?.cases ?? [], [cases.state])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">حساب کاربری / پشتیبانی</p>
          <h1>پشتیبانی</h1>
          <p>پرونده‌های پشتیبانی و گفت‌وگو با تیم کلبه.</p>
        </div>
        <div className="sp-page-actions">
          <button type="button" className="button secondary" onClick={cases.reload}><RefreshCw size={15} />به‌روزرسانی</button>
          <button type="button" className="button primary" onClick={() => setComposerOpen(true)}><Plus size={16} />پروندهٔ جدید</button>
        </div>
      </div>

      <section className="surface table-surface">
        <StateView
          state={cases.state}
          emptyLabel="پروندهٔ پشتیبانی ندارید"
          emptyDescription="اگر سؤال یا مشکلی دارید، یک پروندهٔ جدید باز کنید."
          emptyAction={<button type="button" className="button primary" onClick={() => setComposerOpen(true)}>پروندهٔ جدید</button>}
          onRetry={cases.reload}
        >
          <ul className="sp-threads">
            {list.map(item => (
              <li key={item.id}>
                <button type="button" className="thread-row" onClick={() => setSelectedId(item.id)}>
                  <div>
                    <b>{item.subject ?? 'بدون عنوان'}</b>
                    <span>{CATEGORY_LABEL[String(item.category ?? '')] ?? String(item.category ?? '—')} · {formatDateTime(item.createdAt)}</span>
                  </div>
                  <Status tone={statusTone(String(item.status ?? ''))}>{String(item.status ?? '—')}</Status>
                </button>
              </li>
            ))}
          </ul>
          <div className="table-footer">
            <span>{list.length.toLocaleString('fa-IR')} پرونده در این صفحه</span>
            <div className="pager-actions">
              <button type="button" className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>قبلی</button>
              <button type="button" className="button secondary" disabled={list.length < pageSize} onClick={() => setOffset(offset + pageSize)}>بعدی</button>
            </div>
          </div>
        </StateView>
      </section>

      <Drawer open={Boolean(selectedId)} title="گفت‌وگو" onClose={() => setSelectedId(null)}>
        {selectedId ? <CaseDetail caseId={selectedId} /> : null}
      </Drawer>

      <Drawer open={composerOpen} title="پروندهٔ جدید" onClose={() => setComposerOpen(false)}>
        <CaseComposer onCreated={() => { setComposerOpen(false); cases.reload() }} />
      </Drawer>
    </>
  )
}

function CaseDetail({ caseId }: { caseId: string }) {
  const portal = useSupplierPortal()
  const detail = useSupplierResource(() => portal.api.support.get(caseId), [caseId])
  const mutation = useSupplierMutation({ onSuccess: detail.reload })
  const [body, setBody] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const data = dataOrNull(detail.state)
  const messages: SupportMessage[] = data?.messages ?? []

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (body.trim().length < 3) {
      setLocalError('متن پیام را وارد کنید.')
      return
    }
    const result = await mutation.run(() => portal.api.support.message(caseId, body.trim()))
    if (result.ok) setBody('')
  }

  return (
    <div className="drawer-detail">
      <StateView state={detail.state} emptyLabel="پرونده‌ای یافت نشد" onRetry={detail.reload}>
        {data ? (
          <>
            <div className="detail-meta">
              <div><span>موضوع</span><b>{data.case.subject ?? '—'}</b></div>
              <div><span>دسته</span><b>{CATEGORY_LABEL[String(data.case.category ?? '')] ?? String(data.case.category ?? '—')}</b></div>
              <div><span>وضعیت</span><Status tone={statusTone(String(data.case.status ?? ''))}>{String(data.case.status ?? '—')}</Status></div>
              <div><span>اولویت</span><b>{String(data.case.priority ?? '—')}</b></div>
            </div>

            <SectionHeading title="پیام‌ها" />
            {messages.length > 0 ? (
              <ul className="sp-messages">
                {messages.map(message => (
                  <li key={message.id} className={message.authorType === 'SUPPLIER' ? 'mine' : undefined}>
                    <b>{message.authorType ?? '—'}</b>
                    <p>{message.body ?? ''}</p>
                    <small>{formatDateTime(message.createdAt)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-line">پیامی ثبت نشده است.</p>
            )}

            <form className="reply-form" onSubmit={send} noValidate>
              <Field label="پاسخ شما" required>
                <textarea value={body} onChange={event => setBody(event.target.value)} rows={4} required minLength={3} />
              </Field>
              <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
                <button type="submit" className="button primary" disabled={mutation.busy}><Send size={16} />ارسال پاسخ</button>
              </SubmitBar>
              {mutation.message ? <Notice tone="info" title="ارسال شد"><Check size={14} /> {mutation.message}</Notice> : null}
            </form>
          </>
        ) : null}
      </StateView>
    </div>
  )
}

function CaseComposer({ onCreated }: { onCreated: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onCreated })
  const [category, setCategory] = useState('other')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (subject.trim().length < 3) {
      setLocalError('موضوع را وارد کنید.')
      return
    }
    if (message.trim().length < 5) {
      setLocalError('شرح مشکل را کامل‌تر بنویسید.')
      return
    }
    await mutation.run(() =>
      portal.api.support.create({ category, subject: subject.trim(), initialMessage: message.trim(), priority }),
    )
  }

  return (
    <form className="drawer-detail" onSubmit={submit} noValidate>
      <SectionHeading title="باز کردن پروندهٔ پشتیبانی" description="اعتبارسنجی نهایی سمت سرور است." />
      <div className="sp-grid">
        <Field label="دسته" required>
          <select value={category} onChange={event => setCategory(event.target.value)}>
            {CATEGORIES.map(item => <option key={item} value={item}>{CATEGORY_LABEL[item]}</option>)}
          </select>
        </Field>
        <Field label="اولویت" required>
          <select value={priority} onChange={event => setPriority(event.target.value as typeof priority)}>
            <option value="LOW">کم</option>
            <option value="NORMAL">عادی</option>
            <option value="HIGH">زیاد</option>
            <option value="URGENT">فوری</option>
          </select>
        </Field>
      </div>
      <Field label="موضوع" required>
        <input value={subject} onChange={event => setSubject(event.target.value)} required minLength={3} />
      </Field>
      <Field label="شرح" required>
        <textarea value={message} onChange={event => setMessage(event.target.value)} rows={5} required minLength={5} />
      </Field>
      <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
        <button type="submit" className="button primary" disabled={mutation.busy}><MessageSquareText size={16} />ثبت پرونده</button>
      </SubmitBar>
    </form>
  )
}

export function supportCaseTitle(item: SupportCase): string {
  return item.subject ?? 'بدون عنوان'
}
