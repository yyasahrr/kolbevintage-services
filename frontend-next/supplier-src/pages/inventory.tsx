'use client'

/**
 * موجودی (فاز ۶.۲).
 *
 * مرجع: `GET /api/v1/inventory/my` — سرور فروشنده را از نشست استخراج می‌کند و
 * `available` را خودش محاسبه می‌کند. مرورگر هیچ موجودی‌ای نمی‌سازد و رزرو را
 * شبیه‌سازی نمی‌کند.
 */

import { Boxes, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { InventoryRecord } from '@shared/supplier/contracts'
import { quantity } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierResource } from '../hooks'
import { DataTable, Notice, SectionHeading, StateView, Status } from '../ui'

type InventoryRow = {
  id: string
  variantId: string
  sku: string
  onHand: number
  reserved: number
  available: number
  status: string
}

export function InventoryPage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [onlyLow, setOnlyLow] = useState(false)

  const inventory = useSupplierResource(() => portal.api.inventory.mine(), [version], {
    isEmpty: data => normalizeInventory(data).length === 0,
  })
  const raw = dataOrNull(inventory.state)
  const rows = useMemo<InventoryRow[]>(() => normalizeInventory(raw), [raw])
  const visible = onlyLow ? rows.filter(row => row.available <= 0) : rows

  const totals = useMemo(
    () => rows.reduce(
      (acc, row) => ({ onHand: acc.onHand + row.onHand, reserved: acc.reserved + row.reserved, available: acc.available + row.available }),
      { onHand: 0, reserved: 0, available: 0 },
    ),
    [rows],
  )

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">موجودی</p>
          <h1>موجودی</h1>
          <p>موجودی، رزروشده و قابل‌فروش از مرجعِ سرور خوانده می‌شود.</p>
        </div>
        <button type="button" className="button secondary" onClick={inventory.reload}><RefreshCw size={15} />به‌روزرسانی</button>
      </div>

      <Notice tone="info" title="مالکیتِ رزرو و در دسترس بودن">
        محاسبهٔ «قابل فروش» سمت سرور انجام می‌شود؛ این صفحه فقط همان مقدار را نمایش می‌دهد.
      </Notice>

      <StateView state={inventory.state} emptyLabel="رکورد موجودی‌ای ثبت نشده است" emptyDescription="پس از ثبت نخستین محصول و تنوع آن، موجودی اینجا ظاهر می‌شود." onRetry={inventory.reload}>
        <section className="inventory-summary">
          <article><p>موجودی فیزیکی</p><strong>{quantity(totals.onHand)}</strong><span>واحد</span></article>
          <article><p>رزروشده</p><strong>{quantity(totals.reserved)}</strong><span>واحد</span></article>
          <article className={totals.available <= 0 ? 'warn' : undefined}><p>قابل فروش</p><strong>{quantity(totals.available)}</strong><span>واحد</span></article>
        </section>

        <section className="surface table-surface">
          <div className="table-toolbar">
            <SectionHeading title="جزئیات موجودی" />
            <label className="toggle-field">
              <input type="checkbox" checked={onlyLow} onChange={event => setOnlyLow(event.target.checked)} />
              فقط بدون موجودیِ قابل فروش
            </label>
          </div>
          {visible.length === 0 ? (
            <div className="empty-state"><span className="empty-mark"><Boxes size={20} /></span><b>موردی در این فیلتر نیست</b></div>
          ) : (
            <DataTable
              columns={[
                { key: 'variant', header: 'تنوع', primary: true, render: row => <b className="ltr-inline">{row.variantId}</b> },
                { key: 'sku', header: 'SKU', render: row => <span className="ltr-inline">{row.sku || '—'}</span> },
                { key: 'onHand', header: 'فیزیکی', align: 'end', render: row => quantity(row.onHand) },
                { key: 'reserved', header: 'رزروشده', align: 'end', render: row => quantity(row.reserved) },
                { key: 'available', header: 'قابل فروش', align: 'end', primary: true, render: row => <Status tone={row.available <= 0 ? 'danger' : 'success'}>{quantity(row.available)}</Status> },
              ]}
              rows={visible}
              rowKey={row => row.id}
              busy={inventory.busy}
            />
          )}
        </section>
      </StateView>
    </>
  )
}

/**
 * پاسخِ `/inventory/my` یک آرایهٔ خام از `product_variant_inventory` است
 * (`on_hand`, `reserved`, `available`, `variant_id`). اینجا فقط **تغییرِ نام**
 * انجام می‌شود؛ هیچ مقداری محاسبه یا جایگزین نمی‌شود.
 */
export function normalizeInventory(raw: unknown): InventoryRow[] {
  const records: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown> | null)?.inventories)
      ? ((raw as { inventories: unknown[] }).inventories)
      : Array.isArray((raw as Record<string, unknown> | null)?.items)
        ? ((raw as { items: unknown[] }).items)
        : []

  return records
    .filter((record): record is InventoryRecord => typeof record === 'object' && record !== null)
    .map((record, index) => {
      const snake = record as unknown as Record<string, unknown>
      const onHand = toCount(snake.on_hand ?? snake.onHand)
      const reserved = toCount(snake.reserved)
      const availableRaw = snake.available
      return {
        id: String(snake.id ?? snake.variant_id ?? snake.variantId ?? index),
        variantId: String(snake.variant_id ?? snake.variantId ?? '—'),
        sku: String(snake.sku ?? ''),
        onHand,
        reserved,
        // اگر سرور `available` را اعلام نکرد، چیزی حدس نمی‌زنیم: همان فیزیکی را
        // نشان می‌دهیم اما رزرو را از آن کم نمی‌کنیم (مالکیتِ محاسبه با سرور است).
        available: availableRaw === undefined || availableRaw === null ? onHand : toCount(availableRaw),
        status: String(snake.status ?? 'active'),
      }
    })
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
