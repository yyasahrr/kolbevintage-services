'use client'

/**
 * محصولات و ثبتِ پیشنهاد (فاز ۶.۲).
 *
 * مرجعِ داده: `GET /api/v1/compat/supplier/products` — این مسیر، قراردادِ
 * انتقالیِ ثبت‌شده در `truth-registry.ts` (مدخل `supplier-products-intake`) است؛
 * تا زمانی که فهرستِ canonicalِ محصول وجود دارد، همین seam استفاده می‌شود و
 * مسیرِ تازه‌ای اختراع نمی‌شود.
 *
 * ثبتِ محصول: `POST /api/v1/catalog/compat/supplier-submissions`. اعتبارسنجی
 * کاملاً سمتِ سرور است (`INVALID_INPUT`/`INVALID_MEDIA_URL`) و پیام‌ها عیناً
 * نمایش داده می‌شوند. قیمت یک **رشتهٔ ده‌دهی** است و هرگز `Number()` نمی‌شود.
 */

import { AlertTriangle, Package, Plus, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupplierProduct } from '@shared/supplier/contracts'
import { money, quantity, submissionStatusLabel, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierResource } from '../hooks'
import type { SupplierPage } from '../navigation'
import { DataTable, Notice, SectionHeading, StateView, Status } from '../ui'

export function ProductsPage({ onNavigate }: { onNavigate: (page: SupplierPage) => void }) {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const pageSize = 20

  const products = useSupplierResource(
    () => portal.api.products.list({ limit: pageSize, offset }),
    [offset, version],
    { isEmpty: data => (data.products ?? []).length === 0 },
  )
  const list = useMemo(() => dataOrNull(products.state)?.products ?? [], [products.state])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter(item => item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle))
  }, [list, query])

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">کاتالوگ / محصولات</p>
          <h1>محصولات</h1>
          <p>کاتالوگ، وضعیت بررسی کلبه و پیشنهادهای ثبت‌شدهٔ شما.</p>
        </div>
        <div className="sp-page-actions">
          <button type="button" className="button secondary" onClick={products.reload}><RefreshCw size={15} />به‌روزرسانی</button>
          <button type="button" className="button primary" onClick={() => onNavigate('product-editor')}><Plus size={16} />ثبت محصول</button>
        </div>
      </div>

      <section className="surface table-surface">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="جست‌وجو در نام یا SKU" aria-label="جست‌وجوی محصول" />
          </label>
          <span className="toolbar-note">{query ? `${filtered.length.toLocaleString('fa-IR')} مورد از ${list.length.toLocaleString('fa-IR')}` : ''}</span>
        </div>
        <StateView
          state={products.state}
          emptyLabel="هنوز محصولی ثبت نکرده‌اید"
          emptyDescription="برای دیده‌شدن در کاتالوگ کلبه، نخستین پیشنهاد محصول را ثبت کنید."
          emptyAction={<button type="button" className="button primary" onClick={() => onNavigate('product-editor')}>ثبت محصول</button>}
          onRetry={products.reload}
        >
          <DataTable
            columns={[
              { key: 'name', header: 'محصول', primary: true, render: row => <div className="product-cell"><b>{row.name}</b><small className="ltr-inline">{row.sku || '—'}</small></div> },
              { key: 'category', header: 'دسته', render: row => row.category || '—' },
              { key: 'variants', header: 'تنوع', align: 'end', render: row => quantity(row.productVariants?.length ?? 0) },
              { key: 'price', header: 'قیمت عمده', align: 'end', primary: true, render: row => <span className="numeric">{money(row.wholesalePrice)}</span> },
              { key: 'status', header: 'وضعیت', primary: true, render: row => <Status tone={statusTone(row.status)}>{submissionStatusLabel(row.status)}</Status> },
            ]}
            rows={filtered}
            rowKey={row => row.id}
            busy={products.busy}
          />
          <div className="table-footer">
            <span>{list.length.toLocaleString('fa-IR')} مورد در این صفحه</span>
            <div className="pager-actions">
              <button type="button" className="button secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>صفحهٔ قبل</button>
              <button type="button" className="button secondary" disabled={list.length < pageSize} onClick={() => setOffset(offset + pageSize)}>صفحهٔ بعد</button>
            </div>
          </div>
        </StateView>
      </section>

      <ProductDetailHints products={list} />
    </>
  )
}

/**
 * جزئیات محصول: تا وقتی قراردادِ canonicalِ «جزئیاتِ پیشنهادِ تأمین‌کننده»
 * وجود ندارد، همان رکوردِ فهرست (که از سرور آمده) مرجع است — نه دادهٔ محلی.
 */
function ProductDetailHints({ products }: { products: SupplierProduct[] }) {
  const rejected = products.filter(item => item.status === 'rejected' || item.status === 'changes_requested')
  if (rejected.length === 0) return null
  return (
    <section className="surface" style={{ padding: 18 }}>
      <SectionHeading eyebrow="نیازمند اقدام" title="پیشنهادهای نیازمند اصلاح" description="این موارد توسط تیم کلبه رد یا مشروط شده‌اند؛ دلیل از سرور آمده است." />
      <ul className="notice-list">
        {rejected.map(item => (
          <li key={item.id}>
            <AlertTriangle size={16} />
            <div>
              <b>{item.name}</b>
              <span>{item.rejectionReason || 'دلیلِ اصلاح در پاسخِ سرور اعلام نشده است.'}</span>
            </div>
            <Status tone="warning">{submissionStatusLabel(item.status)}</Status>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ProductEmptyIcon() {
  return <Package size={20} />
}
