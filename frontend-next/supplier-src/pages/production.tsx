'use client'

/**
 * تولید و کنترل کیفیت (فاز ۶.۲) — **محدود به capability**.
 *
 * مرجع: `supplier/production/*` (شغل‌ها، مایلستون، نمونه، لات، بازرسی، نقص،
 * بازکاری، درخواست تغییر، رویداد، آمادگی انتشار، فراخوان، ظرفیت و تعطیلی).
 *
 * دو قاعدهٔ امنیتیِ این صفحه:
 *  ۱) دسترسی با `canUseProduction(capabilities)` دروازه شده است؛ نقشِ «supplier»
 *     به‌تنهایی مجوزِ دیدنِ تولید نیست (Supplier ≠ Manufacturer).
 *  ۲) هیچ وضعیتِ تولیدی در مرورگر ساخته نمی‌شود: هر انتقال با
 *     `Idempotency-Key` به سرور می‌رود و نتیجه از سرور خوانده می‌شود.
 */

import { Check, ClipboardCheck, Factory, FolderKanban, Lock, RefreshCw, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProductionJob } from '@shared/supplier/contracts'
import { newIdempotencyKey } from '@shared/supplier/client'
import { formatDate, formatDateTime, jobStatusLabel, quantity, statusTone } from '@shared/supplier/present'
import { canUseProduction } from '@shared/permissions/capabilities'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { DataTable, Drawer, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

export function ProductionPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const gated = canUseProduction(portal.sessionState.capabilities)

  const jobs = useSupplierResource(
    () => portal.api.production.jobs({ page, limit: pageSize, status: status || undefined }),
    [page, status, version],
    { enabled: gated, isEmpty: data => (data.jobs ?? []).length === 0 },
  )
  const list = useMemo(() => dataOrNull(jobs.state)?.jobs ?? [], [jobs.state])

  if (!gated) {
    return (
      <>
        <div className="page-head">
          <div>
            <p className="crumbs">تولید سفارشی / تولید</p>
            <h1>تولید و کنترل کیفیت</h1>
            <p>این بخش فقط برای تأمین‌کننده‌های دارای capability تولید فعال است.</p>
          </div>
        </div>
        <div className="empty-state">
          <span className="empty-mark"><Lock size={20} /></span>
          <b>دسترسی به بخش تولید ندارید</b>
          <span>
            سرور برای حسابِ شما capability تولید اعلام نکرده است. «تأمین‌کننده» و «تولیدکننده» یکسان نیستند؛
            برای فعال‌سازی، تیم کلبه باید capability را ثبت کند.
          </span>
        </div>
      </>
    )
  }

  const selected = list.find(job => job.id === selectedId) ?? null

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">تولید سفارشی / تولید</p>
          <h1>تولید و کنترل کیفیت</h1>
          <p>شغل‌های تولید، نمونه، لات، بازرسی و نقص‌ها — همه از سرور.</p>
        </div>
        <button type="button" className="button secondary" onClick={jobs.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <section className="surface table-surface">
        <div className="table-toolbar">
          <SectionHeading eyebrow="capability فعال" title="شغل‌های تولید" />
          <div className="tool-actions">
            <label className="search-field">
              <select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }} aria-label="فیلتر وضعیت">
                <option value="">همه وضعیت‌ها</option>
                <option value="draft">پیش‌نویس</option>
                <option value="planned">برنامه‌ریزی‌شده</option>
                <option value="in_progress">در حال تولید</option>
                <option value="blocked">متوقف</option>
                <option value="completed">تکمیل‌شده</option>
                <option value="cancelled">لغوشده</option>
              </select>
            </label>
          </div>
        </div>
        <StateView
          state={jobs.state}
          emptyLabel="شغل تولیدی ثبت نشده است"
          emptyDescription="پس از تأیید سفارشی که نیازمند تولید است، شغلِ آن اینجا ساخته می‌شود."
          onRetry={jobs.reload}
        >
          <DataTable
            columns={[
              { key: 'id', header: 'شغل', primary: true, render: row => <span className="ltr-inline">{row.id}</span> },
              { key: 'order', header: 'سفارش', render: row => <span className="ltr-inline">{row.childOrderId ?? '—'}</span> },
              { key: 'planned', header: 'برنامه', render: row => `${formatDate(row.plannedStartAt)} → ${formatDate(row.plannedEndAt)}` },
              { key: 'units', header: 'واحد', align: 'end', render: row => `${quantity(row.actualUnits ?? 0)} / ${quantity(row.expectedUnits ?? 0)}` },
              { key: 'status', header: 'وضعیت', primary: true, render: row => <Status tone={statusTone(String(row.status ?? ''))}>{jobStatusLabel(row.status)}</Status> },
            ]}
            rows={list}
            rowKey={row => row.id}
            busy={jobs.busy}
            onRowClick={row => setSelectedId(row.id)}
          />
          <div className="table-footer">
            <span>{list.length.toLocaleString('fa-IR')} مورد در این صفحه</span>
            <div className="pager-actions">
              <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))}>قبلی</button>
              <button type="button" className="button secondary" disabled={list.length < pageSize} onClick={() => setPage(page + 1)}>بعدی</button>
            </div>
          </div>
        </StateView>
      </section>

      <Drawer open={Boolean(selected)} title="جزئیات شغل تولید" onClose={() => setSelectedId(null)}>
        {selected ? <JobDetail jobId={selected.id} onChanged={jobs.reload} /> : null}
      </Drawer>
    </>
  )
}

/* ── جزئیات شغل ───────────────────────────────────────────────────────────── */

function JobDetail({ jobId, onChanged }: { jobId: string; onChanged: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onChanged })
  const [actualUnits, setActualUnits] = useState('')
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const job = useSupplierResource(() => portal.api.production.job(jobId), [jobId, mutation.busy])
  const samples = useSupplierResource(() => portal.api.production.samples(jobId), [jobId, mutation.busy])
  const events = useSupplierResource(() => portal.api.production.events(jobId, { limit: 20 }), [jobId, mutation.busy])

  const data = dataOrNull(job.state)
  const record = data?.job
  const milestones = data?.milestones ?? []
  const sampleRows = dataOrNull(samples.state)?.samples ?? []
  const eventRows = dataOrNull(events.state)?.events ?? []

  const run = async (fn: (key: string) => Promise<unknown>, note?: string) => {
    setLocalError(null)
    const result = await mutation.run(() => fn(newIdempotencyKey()) as never)
    if (!result.ok) setLocalError(result.error.message)
    if (note && result.ok) setReason('')
  }

  const submitActualUnits = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    const digits = actualUnits.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '')
    const units = Number(digits || '0')
    if (!Number.isFinite(units) || units <= 0) {
      setLocalError('واحد واقعی را با عدد معتبر وارد کنید.')
      return
    }
    await run(key => portal.api.production.actualUnits(jobId, units, key, record?.version ?? undefined))
    setActualUnits('')
  }

  return (
    <div className="drawer-detail">
      <StateView state={job.state} emptyLabel="شغلی یافت نشد" onRetry={job.reload}>
        {record ? (
          <>
            <div className="detail-meta">
              <div><span>شناسه</span><b className="ltr-inline">{record.id}</b></div>
              <div><span>سفارش</span><b className="ltr-inline">{record.childOrderId ?? '—'}</b></div>
              <div><span>وضعیت</span><Status tone={statusTone(String(record.status ?? ''))}>{jobStatusLabel(record.status)}</Status></div>
              <div><span>واحد واقعی</span><b>{quantity(record.actualUnits ?? 0)}</b></div>
              <div><span>نمونه الزامی</span><b>{record.requiresSampleApproval ? 'بله' : 'خیر'}</b></div>
              <div><span>انتشار کیفی الزامی</span><b>{record.requiresQualityRelease ? 'بله' : 'خیر'}</b></div>
            </div>

            <SectionHeading title="انتقال وضعیت" description="سرور مرجعِ ماشینِ حالت است؛ اگر انتقال مجاز نباشد، دلیل نمایش داده می‌شود." />
            <div className="sp-chips">
              <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transition(jobId, 'start', {}, key))}>شروع</button>
              <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transition(jobId, 'block', { reason: reason || undefined }, key))}>توقف</button>
              <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transition(jobId, 'complete', {}, key))}>تکمیل</button>
              <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transition(jobId, 'cancel', { reason: reason || undefined }, key))}>لغو</button>
            </div>
            <Field label="دلیل (برای توقف/لغو)">
              <input value={reason} onChange={event => setReason(event.target.value)} />
            </Field>

            <form className="reply-form" onSubmit={submitActualUnits} noValidate>
              <Field label="واحد واقعی تولیدشده" required>
                <input value={actualUnits} onChange={event => setActualUnits(event.target.value)} inputMode="numeric" required className="ltr-inline" dir="ltr" />
              </Field>
              <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
                <button type="submit" className="button primary" disabled={mutation.busy}><Check size={16} />ثبت واحد</button>
              </SubmitBar>
            </form>

            <SectionHeading title="مایلستون‌ها" />
            {milestones.length > 0 ? (
              <ul className="notice-list">
                {milestones.map(milestone => (
                  <li key={milestone.id}>
                    <ClipboardCheck size={16} />
                    <div>
                      <b>{milestone.title ?? milestone.id}</b>
                      <span>{formatDateTime(milestone.completedAt ?? milestone.startedAt)}</span>
                    </div>
                    <div className="row-actions">
                      <Status tone={statusTone(String(milestone.status ?? ''))}>{String(milestone.status ?? '—')}</Status>
                      <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transitionMilestone(jobId, milestone.id, 'start', key))}>شروع</button>
                      <button type="button" className="button secondary" disabled={mutation.busy} onClick={() => run(key => portal.api.production.transitionMilestone(jobId, milestone.id, 'complete', key))}>تکمیل</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-line">مایلستونی برای این شغل تعریف نشده است.</p>
            )}

            <SectionHeading title="نمونه‌ها" />
            <StateView state={samples.state} emptyLabel="نمونه‌ای ثبت نشده است">
              <ul className="notice-list">
                {sampleRows.map(sample => (
                  <li key={sample.id}>
                    <Factory size={16} />
                    <div><b className="ltr-inline">{sample.id}</b><span>{formatDateTime(sample.requiredAt)}</span></div>
                    <Status tone={statusTone(String(sample.status ?? ''))}>{String(sample.status ?? '—')}</Status>
                  </li>
                ))}
              </ul>
            </StateView>

            <SectionHeading title="رویدادهای یکپارچه‌سازی" />
            <StateView state={events.state} emptyLabel="رویدادی ثبت نشده است">
              <ul className="notice-list">
                {eventRows.map(event => (
                  <li key={event.id}>
                    <Send size={16} />
                    <div>
                      <b className="ltr-inline">{String(event.eventType ?? event.id)}</b>
                      <span>{formatDateTime(event.createdAt)} · {String(event.status ?? '')}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </StateView>

            {mutation.message ? <Notice tone="info" title="ثبت شد">{mutation.message}</Notice> : null}
          </>
        ) : null}
      </StateView>
    </div>
  )
}

/* ── ظرفیت و تعطیلی ──────────────────────────────────────────────────────── */

export function CapacityPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const gated = canUseProduction(portal.sessionState.capabilities)
  const [periodId, setPeriodId] = useState('')
  const [closureDate, setClosureDate] = useState('')
  const [closureUnits, setClosureUnits] = useState('')
  const [closureReason, setClosureReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const periods = useSupplierResource(() => portal.api.production.capacityPeriods({ limit: 20 }), [version], {
    enabled: gated,
    isEmpty: data => (data.periods ?? []).length === 0,
  })
  const mutation = useSupplierMutation({ onSuccess: periods.reload })
  const rows = dataOrNull(periods.state)?.periods ?? []

  if (!gated) {
    return (
      <div className="empty-state">
        <span className="empty-mark"><Lock size={20} /></span>
        <b>مدیریت ظرفیت نیازمند capability تولید است</b>
        <span>سرور برای این حساب capability تولید اعلام نکرده است.</span>
      </div>
    )
  }

  const submitClosure = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (!periodId) {
      setLocalError('دورهٔ ظرفیت را انتخاب کنید.')
      return
    }
    if (!closureDate) {
      setLocalError('تاریخ تعطیلی را وارد کنید.')
      return
    }
    const digits = closureUnits.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '')
    await mutation.run(() =>
      portal.api.production.createClosure(periodId, {
        startsAt: new Date(closureDate).toISOString(),
        endsAt: new Date(closureDate).toISOString(),
        unavailableUnits: digits ? Number(digits) : undefined,
        reason: closureReason.trim() || undefined,
      }),
    )
    setClosureDate('')
    setClosureUnits('')
    setClosureReason('')
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">تولید سفارشی / ظرفیت</p>
          <h1>ظرفیت و تعطیلی</h1>
          <p>دوره‌های ظرفیت و روزهای تعطیل کارخانه — جایگزینِ رکوردهای localStorage.</p>
        </div>
        <button type="button" className="button secondary" onClick={periods.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <Notice tone="info" title="مرجعِ ظرفیت، سرور است">
        تعطیلی‌ها دیگر در مرورگر ذخیره نمی‌شوند؛ هر ثبت با اعتبارسنجیِ سرور انجام می‌شود.
      </Notice>

      <section className="surface table-surface">
        <SectionHeading title="دوره‌های ظرفیت" />
        <StateView state={periods.state} emptyLabel="دورهٔ ظرفیتی تعریف نشده است" onRetry={periods.reload}>
          <DataTable
            columns={[
              { key: 'id', header: 'دوره', primary: true, render: row => <span className="ltr-inline">{row.id}</span> },
              { key: 'range', header: 'بازه', render: row => `${formatDate(row.startsAt)} → ${formatDate(row.endsAt)}` },
              { key: 'declared', header: 'اعلام‌شده', align: 'end', render: row => quantity(row.declaredUnits ?? 0) },
              { key: 'reserved', header: 'رزروشده', align: 'end', render: row => quantity(row.reservedUnits ?? 0) },
              { key: 'available', header: 'در دسترس', align: 'end', primary: true, render: row => <Status tone="success">{quantity(row.availableUnits ?? 0)}</Status> },
            ]}
            rows={rows}
            rowKey={row => row.id}
            busy={periods.busy}
          />
        </StateView>
      </section>

      <form className="surface form-surface" onSubmit={submitClosure} noValidate>
        <SectionHeading eyebrow="ثبت تعطیلی" title="روز عدم تأمین" description="کلبه مهلت‌ها را بر اساس همین رکوردها تنظیم می‌کند." />
        <div className="sp-grid">
          <Field label="دورهٔ ظرفیت" required>
            <select value={periodId} onChange={event => setPeriodId(event.target.value)} required>
              <option value="" disabled>انتخاب کنید</option>
              {rows.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
            </select>
          </Field>
          <Field label="تاریخ" required>
            <input type="date" value={closureDate} onChange={event => setClosureDate(event.target.value)} required dir="ltr" className="ltr-inline" />
          </Field>
          <Field label="واحدِ از دست رفته">
            <input value={closureUnits} onChange={event => setClosureUnits(event.target.value)} inputMode="numeric" className="ltr-inline" dir="ltr" />
          </Field>
          <Field label="علت">
            <input value={closureReason} onChange={event => setClosureReason(event.target.value)} placeholder="مثلاً تعطیل رسمی" />
          </Field>
        </div>
        <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
          <button type="submit" className="button primary" disabled={mutation.busy}><Check size={16} />ثبت تعطیلی</button>
        </SubmitBar>
      </form>
    </>
  )
}

export function ProductionEmptyIcon() {
  return <FolderKanban size={20} />
}

export type { ProductionJob }
