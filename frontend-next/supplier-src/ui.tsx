'use client'

/**
 * اجزای پایهٔ رابطِ پورتال تأمین‌کننده (فاز ۶.۲).
 *
 * قاعده: اینجا فقط «پوسته» است. هیچ داده‌ای ساخته نمی‌شود و هیچ فراخوانیِ API
 * انجام نمی‌شود. هر جزوی که داده می‌خواهد، آن را از prop می‌گیرد تا صفحه‌ها
 * بتوانند مستقل از مرورگر تست شوند (jsdom) و مرجعِ داده پایدار بماند.
 *
 * کلاس‌ها همان واژگانِ طراحیِ تأییدشده در
 * `public/supplier-portal/styles.css` هستند؛ تغییرِ ظاهری عمدی نیست.
 */

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Lock, RefreshCw, X } from 'lucide-react'
import type { Tone } from '@shared/supplier/present'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { type AsyncState, dataOrNull, isErrorState, isLoading } from '@shared/ui/async-state'
import type { ApiError } from '@shared/http/errors'

/* ── نشان وضعیت ───────────────────────────────────────────────────────────── */

/** نگاشتِ لحنِ معنایی به کلاس‌های رنگیِ تأییدشدهٔ پورتال. */
const TONE_CLASS: Record<Tone, string> = {
  neutral: 'neutral',
  success: 'green',
  warning: 'amber',
  danger: 'rose',
  info: 'blue',
}

export function Status({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status ${TONE_CLASS[tone] ?? 'neutral'}`}>{children}</span>
}

/* ── سربرگِ بخش ───────────────────────────────────────────────────────────── */

export function SectionHeading({ eyebrow, title, description, action, id, children }: { eyebrow?: string; title: string; description?: ReactNode; action?: ReactNode; id?: string; children?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3 id={id}>{title}</h3>
        {description ? <p>{description}</p> : children ? <p>{children}</p> : null}
      </div>
      {action ? <div className="tool-actions">{action}</div> : null}
    </div>
  )
}

export function TextButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className="text-button" onClick={onClick} disabled={disabled}>{children}</button>
}

/* ── وضعیت‌های راستین: بارگذاری / خالی / خطا / دسترسی ─────────────────────── */

export function StateBlock({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div className={`empty-state ${tone === 'danger' ? 'error' : ''}`} role="status">
      <span className="empty-mark">{icon ?? <Inbox size={20} />}</span>
      <b>{title}</b>
      {description ? <span>{description}</span> : null}
      {action ? <div className="sp-empty-actions">{action}</div> : null}
    </div>
  )
}

export function LoadingRows({ count = 4, label = 'در حال دریافت از سرور…' }: { count?: number; label?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite" aria-busy="true" data-testid="loading-rows">
      <span><Loader2 size={18} className="spin" /> {label}</span>
      {Array.from({ length: count }, (_, index) => <i key={index} className="skeleton-line" aria-hidden="true" />)}
    </div>
  )
}

/**
 * نمایشِ راستینِ یک وضعیتِ ناهمزمان: هیچ خطایی بی‌صدا به «خالی» تبدیل نمی‌شود.
 * حالتِ «دسترسی ندارید» (FORBIDDEN/UNAUTHORIZED) از خطای عمومی جدا نمایش داده
 * می‌شود تا کاربر بداند مشکلِ داده نیست، مشکلِ نقش است.
 */
export function StateView<T>({
  state,
  emptyLabel,
  emptyDescription,
  emptyAction,
  onRetry,
  children,
}: {
  state: AsyncState<T>
  emptyLabel?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  onRetry?: () => void
  children: ReactNode
}) {
  if (isErrorState(state)) {
    if (state.status === 'FORBIDDEN' || state.status === 'UNAUTHORIZED') {
      return <StateBlock icon={<Lock size={20} />} tone="danger" title={state.status === 'UNAUTHORIZED' ? 'نشست شما منقضی شده است' : 'دسترسی به این بخش وجود ندارد'} description={state.error.message} />
    }
    return (
      <StateBlock
        icon={<AlertTriangle size={20} />}
        tone="danger"
        title="دریافت اطلاعات ناموفق بود"
        description={state.error.message}
        action={onRetry ? <button type="button" className="button secondary" onClick={onRetry}><RefreshCw size={15} />تلاش دوباره</button> : undefined}
      />
    )
  }
  if (isLoading(state)) return <LoadingRows />
  if (dataOrNull(state) === null && state.status === 'READY_EMPTY') {
    return <StateBlock title={emptyLabel ?? 'موردی ثبت نشده است'} description={emptyDescription} action={emptyAction} />
  }
  return <>{children}</>
}

/** پیامِ خطای یک وضعیت، برای نمایش در فرم‌ها و نوارهای هشدار. */
export function stateMessage(state: AsyncState<unknown>): string | null {
  return isErrorState(state) ? state.error.message : null
}

export type { ApiError }

/* ── جدول ────────────────────────────────────────────────────────────────── */

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** فقط ستون‌های اصلی در موبایل به‌صورت کارت نمایش داده می‌شوند. */
  primary?: boolean
  align?: 'start' | 'end'
}

export function DataTable<T>({ columns, rows, rowKey, busy, onRowClick }: { columns: Array<Column<T>>; rows: T[]; rowKey: (row: T) => string; busy?: boolean; onRowClick?: (row: T) => void }) {
  const primary = columns.filter(column => column.primary)
  return (
    <>
      <div className="sp-table" aria-busy={busy ? 'true' : 'false'}>
        <table>
          <thead>
            <tr>{columns.map(column => <th key={column.key} className={column.align === 'end' ? 'numeric' : undefined}>{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={rowKey(row)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRowClick(row) } } : undefined}>
                {columns.map(column => <td key={column.key} className={column.align === 'end' ? 'numeric' : undefined}>{column.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mobile-card-list">
        {rows.map(row => (
          <li key={rowKey(row)}>
            <button type="button" onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {(primary.length > 0 ? primary : columns).map(column => (
                <span key={column.key}>
                  <small>{column.header}</small>
                  {column.render(row)}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/* ── صفحه‌بندی ────────────────────────────────────────────────────────────── */

export function Pager({ page, pageSize, total, mode, onPage, disabled }: { page: number; pageSize: number; total: number | null; mode: 'offset' | 'page' | 'cursor' | 'none'; onPage: (next: number) => void; disabled?: boolean }) {
  if (mode === 'none') return null
  const hasPrev = mode === 'page' ? page > 1 : page > 0
  const hasNext = total === null ? true : (mode === 'page' ? page * pageSize : (page + 1) * pageSize) < total
  return (
    <div className="table-footer">
      <span>{total === null ? `صفحهٔ ${page + (mode === 'page' ? 0 : 1)}` : `${total.toLocaleString('fa-IR')} مورد`}</span>
      <div className="pager-actions">
        <button type="button" className="icon-button" aria-label="صفحهٔ بعد" disabled={disabled || !hasNext} onClick={() => onPage(page + 1)}><ChevronLeft size={16} /></button>
        <button type="button" className="icon-button" aria-label="صفحهٔ قبل" disabled={disabled || !hasPrev} onClick={() => onPage(Math.max(mode === 'page' ? 1 : 0, page - 1))}><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

/* ── فرم ──────────────────────────────────────────────────────────────────── */

export function Field({ label, hint, error, children, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; required?: boolean }) {
  return (
    <label className="sp-field">
      <span>{label}{required ? <em aria-hidden="true"> *</em> : null}</span>
      {children}
      {error ? <b className="field-error" role="alert">{error}</b> : hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function SubmitBar({ busy, error, children }: { busy: boolean; error?: string | null; children: ReactNode }) {
  return (
    <div className="sp-actions">
      {error ? <b className="field-error" role="alert">{error}</b> : null}
      {children}
      {busy ? <span className="sp-saving"><Loader2 size={14} className="spin" /> در حال ارسال…</span> : null}
    </div>
  )
}

/* ── پنلِ کشویی ───────────────────────────────────────────────────────────── */

export function Drawer({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} onClick={event => event.stopPropagation()}>
        <div className="drawer-head">
          <b>{title}</b>
          <button type="button" className="icon-button" aria-label="بستن" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </aside>
    </div>
  )
}

/* ── اطلاع‌رسانیِ کوتاه ───────────────────────────────────────────────────── */

export function Toast({ message, tone = 'info', onDismiss }: { message: string; tone?: 'info' | 'success' | 'danger'; onDismiss?: () => void }) {
  if (!message) return null
  return (
    <div className={`toast ${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      {onDismiss ? <button type="button" className="icon-button" aria-label="بستن پیام" onClick={onDismiss}><X size={15} /></button> : null}
    </div>
  )
}

/* ── نوارِ هشدار ──────────────────────────────────────────────────────────── */

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger'; title: string; children?: ReactNode }) {
  return (
    <div className={`sp-notice ${tone}`} role="note">
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
    </div>
  )
}

/* ── کارتِ متریک ──────────────────────────────────────────────────────────── */

export function MetricCard({ label, value, delta, alert }: { label: string; value: string; delta?: string; alert?: boolean }) {
  return (
    <div className={`dashboard-metric ${alert ? 'attention' : ''}`}>
      <p>{label}</p>
      <b>{value}</b>
      {delta ? <small>{delta}</small> : null}
    </div>
  )
}
