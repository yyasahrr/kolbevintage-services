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

import { AlertTriangle, Check, Package, Plus, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SupplierProduct } from '@shared/supplier/contracts'
import { money, quantity, submissionStatusLabel, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import type { SupplierPage } from '../navigation'
import { DataTable, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

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

/* ── فرمِ ثبتِ محصول ──────────────────────────────────────────────────────── */

const CATEGORIES = ['پوشاک مردانه', 'پوشاک زنانه', 'کفش و اکسسوری']

export function ProductEditorPage({ onDone }: { onDone: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onDone })
  const [form, setForm] = useState({ name: '', sku: '', category: '', description: '', wholesalePrice: '', stock: '', size: '', color: '', imageUrl: '' })

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [key]: event.target.value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const price = form.wholesalePrice.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '')
    const stock = Number(form.stock.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '') || '0')
    // قیمت یک رشتهٔ ده‌دهی می‌ماند؛ هیچ float‌ای به سرور فرستاده نمی‌شود.
    await mutation.run(() =>
      portal.api.products.submit({
        name: form.name.trim(),
        sku: form.sku.trim().toUpperCase(),
        category: form.category,
        description: form.description.trim(),
        wholesalePrice: price || '0',
        stock,
        size: form.size.trim() || undefined,
        color: form.color.trim() || undefined,
        imageUrl: form.imageUrl.trim() || null,
      }),
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">کاتالوگ / ثبت محصول</p>
          <h1>ثبت محصول جدید</h1>
          <p>اطلاعات را کامل کنید؛ اعتبارسنجی نهایی سمت سرور انجام می‌شود.</p>
        </div>
        <button type="button" className="button secondary" onClick={onDone}>بازگشت</button>
      </div>

      <Notice tone="info" title="شناسهٔ تأمین‌کننده از نشست سرور خوانده می‌شود">
        هیچ شناسه‌ای از مرورگر به‌عنوان مالکیت ارسال نمی‌شود؛ سرور آن را از کوکیِ نشست استخراج می‌کند.
      </Notice>

      <form className="surface form-surface" onSubmit={submit} noValidate>
        <div className="sp-grid">
          <Field label="نام محصول" required>
            <input value={form.name} onChange={set('name')} required minLength={3} />
          </Field>
          <Field label="SKU" required hint="حروف بزرگ لاتین؛ مثلاً KH-OXF-241">
            <input value={form.sku} onChange={set('sku')} required className="ltr-inline" />
          </Field>
          <Field label="دستهٔ تولید" required>
            <select value={form.category} onChange={set('category')} required>
              <option value="" disabled>انتخاب کنید</option>
              {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </Field>
          <Field label="قیمت عمده (ریال)" required hint="فقط عدد؛ به‌صورت رشتهٔ ده‌دهی ارسال می‌شود">
            <input value={form.wholesalePrice} onChange={set('wholesalePrice')} inputMode="numeric" required className="ltr-inline" />
          </Field>
          <Field label="موجودی پیشنهادی" required>
            <input value={form.stock} onChange={set('stock')} inputMode="numeric" required className="ltr-inline" />
          </Field>
          <Field label="سایز">
            <input value={form.size} onChange={set('size')} placeholder="تک‌سایز" />
          </Field>
          <Field label="رنگ">
            <input value={form.color} onChange={set('color')} placeholder="بدون رنگ" />
          </Field>
          <Field label="نشانی تصویر" hint="URL معتبر یا مسیرِ داخلی؛ در غیر این صورت سرور آن را رد می‌کند">
            <input value={form.imageUrl} onChange={set('imageUrl')} className="ltr-inline" dir="ltr" />
          </Field>
        </div>
        <Field label="توضیحات">
          <textarea value={form.description} onChange={set('description')} rows={4} />
        </Field>
        <SubmitBar busy={mutation.busy} error={mutation.error}>
          <button type="submit" className="button primary" disabled={mutation.busy}><Check size={16} />ارسال برای بررسی</button>
        </SubmitBar>
        {mutation.message ? <Notice tone="info" title="ثبت شد">{mutation.message}</Notice> : null}
      </form>
    </>
  )
}

export function ProductEmptyIcon() {
  return <Package size={20} />
}
