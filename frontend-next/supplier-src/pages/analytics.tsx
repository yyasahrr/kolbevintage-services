'use client'

/**
 * عملکرد و تحلیل (فاز ۶.۲).
 *
 * مرجع: `supplier/analytics/{overview,orders,inventory,settlement}`.
 * جایگزینِ کاملِ داشبوردِ قدیمی که قیف فروش و امتیاز عملکرد را با اعدادِ
 * ثابتِ داخلِ کامپوننت می‌ساخت — آن اعداد «حقیقتِ سخت‌کدشده» بودند و حذف شدند.
 *
 * آنچه امروز نمایش داده می‌شود فقط همان metricهایی است که سرور برمی‌گرداند،
 * با واحدِ اعلام‌شدهٔ خودش (COUNT/INTEGER/IRR/RATIO).
 */

import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AnalyticsResult } from '@shared/supplier/contracts'
import { money, quantity } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { useSupplierResource } from '../hooks'
import { Notice, SectionHeading, StateView } from '../ui'

const PRESETS: Array<{ id: string; label: string }> = [
  { id: 'today', label: 'امروز' },
  { id: 'this_week', label: 'این هفته' },
  { id: 'this_month', label: 'این ماه' },
  { id: 'last_30_days', label: '۳۰ روز گذشته' },
]

const GROUPS: Array<{ title: string; description: string; keys: string[] }> = [
  { title: 'سفارش‌ها', description: 'حجم و واحدِ سفارش‌های فرزند', keys: ['supplier.child_orders_count', 'supplier.order_units', 'supplier.delivered_shipments_count'] },
  { title: 'موجودی', description: 'واحدِ فیزیکی، قابل‌فروش و رزروشده', keys: ['inventory.on_hand_units', 'inventory.available_units', 'inventory.reserved_units'] },
  { title: 'تسویه', description: 'مبالغِ ریالیِ اعلام‌شده توسط سرور', keys: ['settlement.pending_amount', 'settlement.available_amount', 'settlement.held_amount', 'settlement.payout_submitted_amount', 'settlement.bank_settled_amount'] },
  { title: 'تولید', description: 'شغل، واحد واقعی، نقص و فراخوان', keys: ['production.jobs_count', 'production.actual_units', 'production.quality_releases_count', 'production.defects_count', 'production.rework_units', 'production.recalls_count'] },
]

export function AnalyticsPage() {
  const portal = useSupplierPortal()
  const [preset, setPreset] = useState('this_month')

  const overview = useSupplierResource(() => portal.api.analytics.overview({ preset }), [preset], {
    isEmpty: data => (data.metrics ?? []).length === 0,
  })
  const settlement = useSupplierResource(() => portal.api.analytics.settlement({ preset }), [preset])

  const metrics = useMemo(() => {
    const merged = new Map<string, AnalyticsResult['metrics'][number]>()
    for (const result of [overview.state, settlement.state]) {
      const data = dataOrNull(result) as AnalyticsResult | null
      for (const metric of data?.metrics ?? []) merged.set(metric.key, metric)
    }
    return merged
  }, [overview.state, settlement.state])

  const presetLabel = PRESETS.find(item => item.id === preset)?.label ?? preset

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">تحلیل / عملکرد</p>
          <h1>عملکرد تأمین‌کننده</h1>
          <p>شاخص‌ها از سرویس تحلیل خوانده می‌شوند — بازهٔ {presetLabel}.</p>
        </div>
        <div className="sp-page-actions">
          <button type="button" className="button secondary" onClick={() => { overview.reload(); settlement.reload() }}><RefreshCw size={15} />به‌روزرسانی</button>
        </div>
      </div>

      <div className="sp-chips range-chips" role="group" aria-label="بازهٔ زمانی">
        {PRESETS.map(item => (
          <button type="button" key={item.id} className={preset === item.id ? 'button primary' : 'button secondary'} onClick={() => setPreset(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <Notice tone="info" title="بدون اعدادِ ساختگی">
        اگر شاخصی در پاسخِ سرور نباشد، «—» نمایش داده می‌شود؛ هیچ مقداری در مرورگر ساخته یا حدس زده نمی‌شود.
      </Notice>

      <StateView state={overview.state} emptyLabel="دادهٔ تحلیلی برای این بازه وجود ندارد" onRetry={overview.reload}>
        {GROUPS.map(group => {
          const rows = group.keys.map(key => ({ key, metric: metrics.get(key) })).filter(row => row.metric)
          if (rows.length === 0) {
            return (
              <section className="surface" key={group.title} style={{ padding: 18 }}>
                <SectionHeading eyebrow={group.description} title={group.title} />
                <p className="muted-line">سرور برای این گروه شاخصی برنگرداند.</p>
              </section>
            )
          }
          return (
            <section className="surface" key={group.title} style={{ padding: 18 }}>
              <SectionHeading eyebrow={group.description} title={group.title} />
              <div className="metric-grid">
                {rows.map(({ key, metric }) => (
                  <article className="kpi" key={key}>
                    <p>{metric?.label ?? key}</p>
                    <strong className="kpi-value">{formatMetric(metric!)}</strong>
                    <span className="ltr-inline">{key}</span>
                  </article>
                ))}
              </div>
            </section>
          )
        })}
      </StateView>
    </>
  )
}

function formatMetric(metric: AnalyticsResult['metrics'][number]): string {
  const raw = metric.value?.raw
  if (raw === undefined || raw === null || raw === '') return '—'
  if (metric.unit === 'IRR') return money(raw)
  if (metric.unit === 'RATIO') return `${raw}`
  return quantity(raw)
}
