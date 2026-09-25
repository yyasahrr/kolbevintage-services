'use client'

/**
 * داشبورد تأمین‌کننده (فاز ۶.۲).
 *
 * قاعدهٔ اصلی این صفحه: **هیچ عددی ساخته نمی‌شود.** هر KPI از
 * `GET /supplier/analytics/overview` می‌آید. اگر سرویس تحلیل در دسترس نبود،
 * کارتِ مربوطه وضعیتِ خطا نشان می‌دهد — نه صفر، نه مقدارِ حدسی.
 */

import { Boxes, CreditCard, FolderKanban, MessageSquareText, RefreshCw, Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import type { AnalyticsResult } from '@shared/supplier/contracts'
import { formatDate, formatDateTime, money, orderStatusLabel, quantity, rfqStatusLabel, statusTone } from '@shared/supplier/present'
import { dataOrNull, isErrorState, isLoading } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierResource } from '../hooks'
import { LoadingRows, SectionHeading, StateBlock, StateView, Status, TextButton } from '../ui'
import type { SupplierPage } from '../navigation'

const OVERVIEW_CARDS: Array<{ key: string; label: string; icon: ReactNode; money?: boolean; alert?: boolean }> = [
  { key: 'supplier.child_orders_count', label: 'سفارش‌های فرزند', icon: <Truck size={18} /> },
  { key: 'supplier.order_units', label: 'واحد سفارش‌شده', icon: <Boxes size={18} /> },
  { key: 'settlement.pending_amount', label: 'در انتظار تسویه', icon: <CreditCard size={18} />, money: true },
  { key: 'settlement.available_amount', label: 'قابل برداشت', icon: <CreditCard size={18} />, money: true },
  { key: 'production.jobs_count', label: 'شغل تولید', icon: <FolderKanban size={18} /> },
  { key: 'production.defects_count', label: 'نقص ثبت‌شده', icon: <MessageSquareText size={18} />, alert: true },
]

export function DashboardPage({ onNavigate }: { onNavigate: (page: SupplierPage) => void }) {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()

  const overview = useSupplierResource(() => portal.api.analytics.overview(), [version])
  const orders = useSupplierResource(() => portal.api.orders.list(), [version])
  const rfqs = useSupplierResource(() => portal.api.rfqs.list({ limit: 5 }), [version])

  const metricByKey = useMemo(() => {
    const data = dataOrNull(overview.state) as AnalyticsResult | null
    return new Map((data?.metrics ?? []).map(metric => [metric.key, metric]))
  }, [overview.state])

  const ordersList = dataOrNull(orders.state)?.children ?? []
  const rfqList = dataOrNull(rfqs.state)?.rfqs ?? []
  const pendingOrders = ordersList.filter(order => order.status === 'pending')
  const openRfqs = rfqList.filter(rfq => rfq.status === 'open')

  return (
    <>
      <div className="page-head dashboard-head">
        <div>
          <p className="eyebrow">{formatDate(new Date())}</p>
          <h1>داشبورد عملیات</h1>
          <p>در یک نگاه ببینید چه چیزی امروز به تصمیم شما نیاز دارد.</p>
        </div>
        <div className="sp-page-actions">
          <button type="button" className="button secondary" onClick={() => { overview.reload(); orders.reload(); rfqs.reload() }}>
            <RefreshCw size={15} />به‌روزرسانی
          </button>
          <button type="button" className="button primary" onClick={() => onNavigate('product-editor')}>ثبت محصول</button>
        </div>
      </div>

      {/* ── KPIها: فقط از سرویس تحلیل ─────────────────────────────────────── */}
      <section className="kpi-grid dashboard-kpis" aria-label="شاخص‌های کلیدی">
        {isErrorState(overview.state) ? (
          <div className="kpi-error" role="alert">
            <b>شاخص‌ها در دسترس نیستند</b>
            <p>{overview.state.error.message}</p>
            <button type="button" className="button secondary" onClick={overview.reload}>تلاش دوباره</button>
          </div>
        ) : isLoading(overview.state) ? (
          <LoadingRows count={3} label="در حال محاسبهٔ شاخص‌ها…" />
        ) : (
          OVERVIEW_CARDS.map(card => {
            const metric = metricByKey.get(card.key)
            return (
              <article className={`kpi ${card.alert ? 'attention' : ''}`} key={card.key}>
                <div className="kpi-icon">{card.icon}</div>
                <p>{card.label}</p>
                {metric ? (
                  <>
                    <strong className="kpi-value">{card.money ? money(metric.value.raw) : quantity(metric.value.raw)}</strong>
                    <span>{metric.comparison?.value ? `دورهٔ قبل: ${card.money ? money(metric.comparison.value.raw) : quantity(metric.comparison.value.raw)}` : 'بدون مقایسه'}</span>
                  </>
                ) : (
                  <>
                    <strong className="kpi-value">—</strong>
                    <span>این شاخص در پاسخِ سرور نبود</span>
                  </>
                )}
              </article>
            )
          })
        )}
      </section>

      {/* ── صف اقدام: شمارش‌های واقعی از فهرست‌های سرور ────────────────────── */}
      <section className="dashboard-grid">
        <div className="action-center">
          <SectionHeading eyebrow="صف اقدام" title="کارهایی که منتظر شما هستند" action={<TextButton onClick={() => onNavigate('orders')}>مشاهده همه</TextButton>}>
            این فهرست از دادهٔ زندهٔ سرور ساخته می‌شود؛ اگر بخشی بارگذاری نشود، وضعیتِ خطا نمایش داده می‌شود.
          </SectionHeading>
          <div className="action-list">
            <ActionRow
              icon={<Truck size={19} />}
              tone="warm"
              title="سفارش در انتظار تأیید"
              count={orders.state}
              value={pendingOrders.length}
              note="تأیید به‌موقع، مهلت ارسال را حفظ می‌کند."
              action="بررسی سفارش‌ها"
              onClick={() => onNavigate('orders')}
            />
            <ActionRow
              icon={<MessageSquareText size={19} />}
              tone="blue"
              title="RFQ بدون پیشنهاد"
              count={rfqs.state}
              value={openRfqs.length}
              note="برای هر درخواست، پیشنهاد قیمت ثبت کنید."
              action="باز کردن RFQها"
              onClick={() => onNavigate('rfqs')}
            />
          </div>
        </div>

        <div className="side-stack">
          <section className="today-panel">
            <SectionHeading title="آخرین درخواست‌های تولید" action={<TextButton onClick={() => onNavigate('rfqs')}>همه</TextButton>} />
            <StateView state={rfqs.state} emptyLabel="درخواست تولیدی وجود ندارد" emptyDescription="وقتی کلبه درخواستی برای شما بفرستد، اینجا نمایش داده می‌شود.">
              <div className="mini-list">
                {rfqList.slice(0, 4).map(rfq => (
                  <div className="mini-order" key={rfq.id}>
                    <span className="rfq-avatar">{(rfq.customerName ?? 'ک').slice(0, 1)}</span>
                    <div>
                      <b className="ltr-inline">{rfq.referenceCode ?? rfq.id}</b>
                      <span>{rfq.title} · {quantity(rfq.quantity)} تکه</span>
                    </div>
                    <Status tone={statusTone(rfq.status)}>{rfqStatusLabel(rfq.status)}</Status>
                  </div>
                ))}
              </div>
            </StateView>
          </section>

          <section className="stock-watch">
            <SectionHeading eyebrow="مالی" title="وضعیت تسویه" action={<TextButton onClick={() => onNavigate('finance')}>جزئیات</TextButton>} />
            <StateView state={overview.state} emptyLabel="دادهٔ تسویه‌ای ثبت نشده است">
              <div className="mini-list">
                {(['settlement.pending_amount', 'settlement.available_amount', 'settlement.held_amount'] as const).map(key => {
                  const metric = metricByKey.get(key)
                  if (!metric) return null
                  return (
                    <div className="mini-order" key={key}>
                      <span className="rfq-avatar ink"><CreditCard size={15} /></span>
                      <div><b>{metric.label ?? key}</b><span>مبلغِ اعلام‌شده توسط سرور</span></div>
                      <Status tone="neutral">{money(metric.value.raw)}</Status>
                    </div>
                  )
                })}
              </div>
            </StateView>
          </section>
        </div>
      </section>

      {/* ── آخرین سفارش‌ها ─────────────────────────────────────────────────── */}
      <section className="surface order-preview">
        <SectionHeading title="آخرین سفارش‌ها" action={<TextButton onClick={() => onNavigate('orders')}>همه سفارش‌ها</TextButton>} />
        <StateView state={orders.state} emptyLabel="سفارشی ثبت نشده است" emptyDescription="پس از نخستین سفارش عمده، اینجا نمایش داده می‌شود.">
          <div className="compact-table">
            {ordersList.slice(0, 4).map(order => (
              <button type="button" className="compact-row" key={order.id} onClick={() => onNavigate('orders')}>
                <b className="ltr-inline">{order.orderCode ?? order.id}</b>
                <span>{order.items?.length ?? order.children?.length ?? 0} ردیف</span>
                <span className="numeric">{money(order.totalAmount)}</span>
                <Status tone={statusTone(order.status)}>{orderStatusLabel(order.status)}</Status>
                <small>{formatDateTime(order.createdAt)}</small>
              </button>
            ))}
          </div>
        </StateView>
      </section>
    </>
  )
}

function ActionRow({
  icon, tone, title, note, action, onClick, count, value,
}: {
  icon: ReactNode; tone: string; title: string; note: string; action: string; onClick: () => void
  count: ReturnType<typeof useSupplierResource<unknown>>['state']; value: number
}) {
  return (
    <div className="action-item">
      <span className={`action-icon ${tone}`}>{icon}</span>
      <b className="action-count">{isErrorState(count) ? '—' : isLoading(count) ? '…' : value.toLocaleString('fa-IR')}</b>
      <div>
        <b>{title}</b>
        <span>{isErrorState(count) ? count.error.message : note}</span>
      </div>
      <button type="button" className="button secondary" onClick={onClick}>{action}</button>
    </div>
  )
}
