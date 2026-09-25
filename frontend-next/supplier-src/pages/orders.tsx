'use client'

/**
 * سفارش‌ها، چرخهٔ عمر و ارسال (فاز ۶.۲).
 *
 * مرجعِ وضعیت: `supplier/orders` و عملیاتِ `confirm / start-preparation / ready /
 * dispatch / deliver / cancel`. ماشینِ حالت کاملاً سمتِ سرور است؛ UI فقط
 * انتقال‌های پیشنهادی را نشان می‌دهد و پاسخِ ۴۰۹/۴۲۲ را عیناً نمایش می‌دهد.
 *
 * حذفِ مرجعِ مرورگر: کدِ رهگیری دیگر با `Date.now()` ساخته نمی‌شود. ثبتِ ارسال
 * نیازمند ورودِ صریحِ اپراتور است و اگر سرور آن را نپذیرد، خطا نشان داده می‌شود.
 */

import { Check, ChevronLeft, RefreshCw, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ChildOrder, OrderTransition } from '@shared/supplier/contracts'
import { newIdempotencyKey } from '@shared/supplier/client'
import { formatDate, formatDateTime, money, orderStatusLabel, orderTransitionLabel, quantity, statusTone, suggestedOrderTransitions, transitionRequiresReason, transitionRequiresTracking } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { Drawer, DataTable, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

export function OrdersPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const orders = useSupplierResource(() => portal.api.orders.list(), [version], {
    isEmpty: data => (data.children ?? []).length === 0,
  })
  const list = useMemo(() => dataOrNull(orders.state)?.children ?? [], [orders.state])
  const selected = list.find(order => order.id === selectedId) ?? null

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">عملیات / سفارش‌ها</p>
          <h1>سفارش‌ها</h1>
          <p>سفارش‌ها را تأیید، آماده و ارسال کنید؛ وضعیت از سرور خوانده می‌شود.</p>
        </div>
        <button type="button" className="button secondary" onClick={orders.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <section className="surface table-surface">
        <StateView
          state={orders.state}
          emptyLabel="سفارشی ثبت نشده است"
          emptyDescription="پس از نخستین سفارش عمدهٔ کلبه، اینجا نمایش داده می‌شود."
          onRetry={orders.reload}
        >
          <DataTable
            columns={[
              { key: 'code', header: 'سفارش', primary: true, render: row => <b className="ltr-inline">{row.orderCode ?? row.id}</b> },
              { key: 'lines', header: 'ردیف‌ها', align: 'end', render: row => quantity(row.items?.length ?? row.children?.length ?? 0) },
              { key: 'amount', header: 'مبلغ', align: 'end', primary: true, render: row => <span className="numeric">{money(row.totalAmount)}</span> },
              { key: 'due', header: 'مهلت', render: row => formatDate(row.dueDate) },
              { key: 'created', header: 'تاریخ', render: row => formatDate(row.createdAt) },
              { key: 'status', header: 'وضعیت', primary: true, render: row => <Status tone={statusTone(row.status)}>{orderStatusLabel(row.status)}</Status> },
            ]}
            rows={list}
            rowKey={row => row.id}
            busy={orders.busy}
            onRowClick={row => setSelectedId(row.id)}
          />
        </StateView>
      </section>

      <Drawer open={Boolean(selected)} title={selected ? `سفارش ${selected.orderCode ?? selected.id}` : ''} onClose={() => setSelectedId(null)}>
        {selected ? <OrderDetail order={selected} onChanged={orders.reload} /> : null}
      </Drawer>
    </>
  )
}

function OrderDetail({ order, onChanged }: { order: ChildOrder; onChanged: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onChanged })
  const [trackingCode, setTrackingCode] = useState('')
  const [carrier, setCarrier] = useState('')
  const [reason, setReason] = useState('')
  const [action, setAction] = useState<OrderTransition | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const exceptions = useSupplierResource(() => portal.api.orders.exceptions(order.id), [order.id])
  const lines = order.items ?? order.children ?? []
  const transitions = suggestedOrderTransitions(order.status)
  const needsTracking = action ? transitionRequiresTracking(action) : false
  const needsReason = action ? transitionRequiresReason(action) : false

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!action) return
    setLocalError(null)
    if (needsTracking && trackingCode.trim().length < 3) {
      setLocalError('کد رهگیری واقعیِ شرکت حمل را وارد کنید؛ این مقدار در مرورگر ساخته نمی‌شود.')
      return
    }
    if (needsReason && reason.trim().length < 3) {
      setLocalError('دلیل لغو را وارد کنید.')
      return
    }
    // هر عملیات یک کلیدِ یکتای تازه می‌گیرد: دوبار-کلیک، وضعیتِ تکراری نمی‌سازد.
    await mutation.run(() =>
      portal.api.orders.action(action, {
        id: order.id,
        idempotencyKey: newIdempotencyKey(),
        expectedVersion: order.version ?? undefined,
        trackingCode: needsTracking ? trackingCode.trim() : undefined,
        carrier: needsTracking && carrier.trim() ? carrier.trim() : undefined,
        reason: needsReason ? reason.trim() : undefined,
      }),
    )
    setAction(null)
    setTrackingCode('')
    setCarrier('')
    setReason('')
  }

  return (
    <div className="drawer-detail">
      <div className="detail-meta">
        <div><span>وضعیت</span><Status tone={statusTone(order.status)}>{orderStatusLabel(order.status)}</Status></div>
        <div><span>مبلغ کل</span><b className="numeric">{money(order.totalAmount)}</b></div>
        <div><span>مهلت ارسال</span><b>{formatDate(order.dueDate)}</b></div>
        <div><span>آخرین به‌روزرسانی</span><b>{formatDateTime(order.updatedAt ?? order.createdAt)}</b></div>
        <div><span>کد رهگیری</span><b className="ltr-inline">{order.trackingCode || '—'}</b></div>
        <div><span>نسخهٔ رکورد</span><b className="ltr-inline">{order.version ?? '—'}</b></div>
      </div>

      <SectionHeading title="ردیف‌های سفارش" />
      {lines.length > 0 ? (
        <ul className="line-list">
          {lines.map((line, index) => (
            <li key={line.id ?? `${line.sku ?? 'line'}-${index}`}>
              <div>
                <b>{line.productName ?? 'ردیف سفارش'}</b>
                <small className="ltr-inline">{line.sku ?? '—'}</small>
              </div>
              <span className="numeric">{quantity(line.quantity)}</span>
              <span className="numeric">{money(line.totalPrice ?? line.unitPrice)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-line">ردیفی در پاسخِ سرور نبود.</p>
      )}

      <SectionHeading title="مغایرت‌های گزارش‌شده" />
      <StateView state={exceptions.state} emptyLabel="مغایرتی ثبت نشده است">
        <ul className="notice-list">
          {(dataOrNull(exceptions.state)?.exceptions ?? []).map(exception => (
            <li key={exception.id}>
              <Truck size={16} />
              <div>
                <b>{exception.type ?? 'مغایرت'}</b>
                <span>{exception.note ?? '—'}</span>
              </div>
              <Status tone="warning">{exception.status ?? '—'}</Status>
            </li>
          ))}
        </ul>
      </StateView>

      {transitions.length > 0 ? (
        <form className="transition-form" onSubmit={submit} noValidate>
          <SectionHeading title="انتقال وضعیت" description="سرور مرجعِ ماشینِ حالت است؛ اگر انتقال مجاز نباشد، دلیل را نمایش می‌دهیم." />
          <div className="sp-chips">
            {transitions.map((transition: OrderTransition) => (
              <button
                type="button"
                key={transition}
                className={action === transition ? 'button primary' : 'button secondary'}
                onClick={() => { setAction(transition); setLocalError(null) }}
              >
                {orderTransitionLabel(transition)}
              </button>
            ))}
          </div>

          {action && needsTracking ? (
            <div className="sp-grid">
              <Field label="کد رهگیری" required hint="مقدارِ واقعیِ شرکت حمل — هرگز به‌صورت خودکار ساخته نمی‌شود">
                <input value={trackingCode} onChange={event => setTrackingCode(event.target.value)} className="ltr-inline" dir="ltr" required minLength={3} />
              </Field>
              <Field label="شرکت حمل">
                <input value={carrier} onChange={event => setCarrier(event.target.value)} />
              </Field>
            </div>
          ) : null}

          {action && needsReason ? (
            <Field label="دلیل لغو" required>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} required minLength={3} />
            </Field>
          ) : null}

          <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
            <button type="submit" className="button primary" disabled={!action || mutation.busy}><Check size={16} />ثبت انتقال</button>
          </SubmitBar>
        </form>
      ) : (
        <Notice tone="info" title="انتقالِ بعدی وجود ندارد">این سفارش در وضعیتِ پایانی است.</Notice>
      )}

      {mutation.message ? <Notice tone="info" title="ثبت شد">{mutation.message}</Notice> : null}
    </div>
  )
}

export function OrdersBreadcrumb() {
  return <ChevronLeft size={14} />
}
