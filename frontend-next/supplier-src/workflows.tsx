import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, Check, ChevronLeft, CircleAlert, Clock3, FileImage, FileText, GripVertical,
  ImagePlus, Info, MessageSquareText, PackageCheck, Paperclip, Plus, Save, Send, Shirt,
  Sparkles, Upload, Video, X, ShieldCheck,
} from 'lucide-react'
import { PageCrumbs, SectionHeading, Status } from './components'
import { createSupplierProduct, loadSupplierOrders, updateSupplierPurchaseOrder } from './api'

/* ================================================================
   تعریف انواع سری — قیمت بر اساس نوع سری × قیمت هر تیکه
   ================================================================ */

export type SeriesType = {
  id: string
  label: string
  description: string
  composition: Record<string, number>  // سایز → تعداد تیکه
  pieceCount: number                   // مجموع تیکهها
}

export const SERIES_TYPES: SeriesType[] = [
  {
    id: 'full', label: 'سری کامل', description: 'تمام سایزها با نسبت استاندارد',
    composition: { 'S': 1, 'M': 2, 'L': 2, 'XL': 2, '2XL': 1 }, pieceCount: 8,
  },
  {
    id: 'half', label: 'نیم‌سری', description: 'M تا 2XL — ۵ تیکه',
    composition: { 'M': 1, 'L': 1, 'XL': 1, '2XL': 1, 'M/L': 1 }, pieceCount: 5,
  },
  {
    id: 'bestseller', label: 'سری پرفروش', description: 'تمرکز روی سایزهای پرتقاضا',
    composition: { 'M': 2, 'L': 2, 'XL': 1 }, pieceCount: 5,
  },
  {
    id: 'single_size', label: 'تک‌سایز', description: 'همه تیکهها یک سایز',
    composition: { '—': 6 }, pieceCount: 6,
  },
  {
    id: 'custom', label: 'سری سفارشی', description: 'ترکیب دلخواه سایزها',
    composition: {}, pieceCount: 0,
  },
]

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)
const toman = (n: number) => `${fa(n)} تومان`

function parseNumber(value: string): number {
  return Number(value
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,\s]/g, ''))
}

/* ================================================================
   ویرایشگر محصول جدید — بر اساس سری (نه سایز تکی)
   ================================================================ */

export function ProductEditor({ supplierId, onClose, onCreated }: { supplierId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', sku: '', category: 'پوشاک', description: '',
    unitPrice: '',       // قیمت هر تیکه
    seriesTypeId: 'full', // نوع سری
    seriesCount: '',      // تعداد سری موجود
    color: 'مشکی',
    colorHex: '#1a1a1a',
    imageUrl: '',         // data URL از آپلود
  })
  const [customComposition, setCustomComposition] = useState<Record<string, number>>({ S: 1, M: 1, L: 1, XL: 1 })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const update = (field: keyof typeof form, value: string) => setForm(current => ({ ...current, [field]: value }))
  const showError = (message: string) => {
    setError(message)
    requestAnimationFrame(() => document.getElementById('product-form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const seriesType = SERIES_TYPES.find(t => t.id === form.seriesTypeId) ?? SERIES_TYPES[0]
  const isCustom = seriesType.id === 'custom'
  const composition = isCustom ? customComposition : seriesType.composition
  const pieceCount = isCustom
    ? Object.values(customComposition).reduce((a, b) => a + b, 0)
    : seriesType.pieceCount

  const unitPrice = parseNumber(form.unitPrice)
  const seriesCount = parseNumber(form.seriesCount)
  const seriesPrice = unitPrice * pieceCount          // قیمت هر سری
  const totalPieces = pieceCount * (seriesCount || 0)  // مجموع تیکهها
  const totalValue = seriesPrice * (seriesCount || 0)  // ارزش کل

  /* آپلود تصویر به data URL */
  const handleImageUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return showError('فایل انتخاب‌شده تصویر نیست.')
    if (file.size > 2_500_000) return showError('حجم تصویر حداکثر ۲.۵ مگابایت.')
    const reader = new FileReader()
    reader.onload = () => update('imageUrl', String(reader.result))
    reader.readAsDataURL(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!form.name.trim() || !form.sku.trim() || !form.description.trim()) return showError('نام، SKU و توضیحات محصول الزامی است.')
    if (!form.unitPrice.trim() || !Number.isInteger(unitPrice) || unitPrice <= 0) return showError('قیمت هر تیکه را به‌صورت عدد صحیح وارد کنید.')
    if (!form.seriesCount.trim() || !Number.isInteger(seriesCount) || seriesCount <= 0) return showError('تعداد سری موجود را وارد کنید.')
    if (pieceCount <= 0) return showError('ترکیب سری باید حداقل یک تیکه داشته باشد.')
    if (!form.color.trim()) return showError('رنگ محصول را وارد کنید.')

    setSubmitting(true)
    try {
      const seriesLabel = `${seriesType.label} (${fa(pieceCount)} تیکه)`
      await createSupplierProduct({
        supplierId,
        name: form.name,
        sku: form.sku,
        category: form.category,
        description: `${form.description}\n\nسری: ${seriesLabel}\nرنگ: ${form.color}\nترکیب: ${Object.entries(composition).map(([s, q]) => `${s}×${fa(q)}`).join(' · ')}`,
        wholesalePrice: unitPrice,
        imageUrl: form.imageUrl,
        color: form.color,
        
        size: seriesLabel,
        stock: totalPieces,
      })
      onCreated()
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : 'ثبت محصول انجام نشد.')
    } finally { setSubmitting(false) }
  }

  return <div className="workflow-page">
    <div className="workflow-topbar">
      <button type="button" className="icon-button" aria-label="بستن" onClick={onClose}><X size={18}/></button>
      <div><b>محصول جدید</b><span className="unsaved-state"><Clock3 size={12}/>در انتظار ثبت</span></div>
      <div className="workflow-top-actions">
        <button type="button" className="button secondary" onClick={onClose}>انصراف</button>
        <button type="submit" form="supplier-product-form" className="button primary" disabled={submitting}>
          <Send size={15}/>{submitting ? 'در حال ثبت…' : 'ثبت و ارسال برای بررسی'}
        </button>
      </div>
    </div>

    <main className="editor-main">
      <form id="supplier-product-form" className="editor-content" onSubmit={submit} noValidate>
        <div className="editor-title">
          <PageCrumbs parent="کاتالوگ" current="محصول جدید (بر اساس سری)"/>
          <h1>ثبت محصول در کاتالوگ عمده</h1>
          <p>محصول بر اساس نوع سری عرضه می‌شود. قیمت هر سری = قیمت هر تیکه × تعداد تیکه در سری.</p>
        </div>

        {error ? <div id="product-form-error" role="alert" className="review-policy"><CircleAlert size={18}/><div><b>خطا</b><p>{error}</p></div></div> : null}

        {/* === ۱. اطلاعات پایه === */}
        <EditorSection title="۱. اطلاعات پایه" description="نام و دسته محصول">
          <div className="form-grid">
            <Field label="نام محصول"><input required value={form.name} onChange={e => update('name', e.target.value)} placeholder="مثلاً پیراهن لینن تابستانی"/></Field>
            <Field label="SKU"><input required dir="ltr" value={form.sku} onChange={e => update('sku', e.target.value)} placeholder="NG-LIN-301"/></Field>
            <Field label="دسته‌بندی">
              <select value={form.category} onChange={e => update('category', e.target.value)}>
                <option>پوشاک</option><option>کفش</option><option>اکسسوری</option><option>پارچه</option>
              </select>
            </Field>
          </div>
        </EditorSection>

        {/* === ۲. تصویر (آپلود) === */}
        <EditorSection title="۲. تصویر محصول" description="تصویر را از سیستم خود انتخاب کنید">
          <div className="form-grid">
            <Field label="آپلود تصویر">
              <div style={{ border: '2px dashed #deddd6', borderRadius: 6, padding: 20, textAlign: 'center', cursor: 'pointer' }}
                   onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#011c3a' }}
                   onDragLeave={e => e.currentTarget.style.borderColor = '#deddd6'}
                   onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#deddd6'; const f = e.dataTransfer.files[0]; if (f) handleImageUpload(f) }}>
                <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f) }} style={{ display: 'none' }} id="img-upload" />
                <label htmlFor="img-upload" style={{ cursor: 'pointer', display: 'block' }}>
                  {form.imageUrl ? (
                    <div>
                      <img src={form.imageUrl} alt="" style={{ maxHeight: 180, margin: '0 auto 8px', borderRadius: 4, objectFit: 'contain' }} />
                      <small style={{ color: '#3d5c3a' }}>✓ تصویر بارگذاری شد — برای تغییر کلیک کنید</small>
                    </div>
                  ) : (
                    <div>
                      <ImagePlus size={28} style={{ color: '#999', margin: '0 auto 8px' }} />
                      <b style={{ fontSize: 11 }}>تصویر را بکشید و اینجا رها کنید</b>
                      <p style={{ fontSize: 9, color: '#999', marginTop: 4 }}>یا کلیک کنید — JPG/PNG، حداکثر ۲.۵MB</p>
                    </div>
                  )}
                </label>
              </div>
            </Field>
          </div>
        </EditorSection>

        {/* === ۳. قیمت و سری === */}
        <EditorSection title="۳. قیمت و نوع سری" description="قیمت هر تیکه × تعداد تیکه در سری = قیمت هر سری">
          <div className="form-grid">
            <Field label="قیمت هر تیکه (تومان)" helper="مبنای محاسبه قیمت سری">
              <input required type="text" inputMode="numeric" value={form.unitPrice} onChange={e => update('unitPrice', e.target.value)} placeholder="۱٬۲۵۰٬۰۰۰"/>
            </Field>
            <Field label="نوع سری">
              <select value={form.seriesTypeId} onChange={e => update('seriesTypeId', e.target.value)}>
                {SERIES_TYPES.map(t => <option key={t.id} value={t.id}>{t.label} — {t.pieceCount > 0 ? `${fa(t.pieceCount)} تیکه` : 'سفارشی'}</option>)}
              </select>
            </Field>
          </div>

          {/* ترکیب سری */}
          <div style={{ marginTop: 16, padding: 14, border: '1px solid #e5e5e0', borderRadius: 6 }}>
            <b style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>ترکیب {seriesType.label}:</b>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(composition).map(([size, qty]) => (
                <span key={size} style={{ fontSize: 10, background: '#f6f6f2', padding: '4px 10px', borderRadius: 4, border: '1px solid #e5e5e0' }}>
                  <b>{size}</b> × <span className="num-fa">{fa(qty)}</span>
                </span>
              ))}
              <span style={{ fontSize: 10, padding: '4px 10px', background: '#011c3a', color: '#fff', borderRadius: 4 }}>
                = <span className="num-fa">{fa(pieceCount)}</span> تیکه
              </span>
            </div>

            {/* سری سفارشی: تنظیم تعداد هر سایز */}
            {isCustom && (
              <div style={{ marginTop: 12, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {['S', 'M', 'L', 'XL', '2XL'].map(size => (
                  <label key={size} style={{ fontSize: 10 }}>
                    سایز {size}
                    <input type="number" min={0} max={10} value={customComposition[size] ?? 0}
                      onChange={e => setCustomComposition({ ...customComposition, [size]: Number(e.target.value) })}
                      style={{ width: '100%', height: 32, border: '1px solid #deddd6', textAlign: 'center', fontSize: 12, marginTop: 4 }} dir="ltr" />
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* خلاصه محاسبه */}
          <div style={{ marginTop: 16, padding: 16, background: '#fffaf2', border: '1px solid #d9b98f', borderRadius: 6 }}>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', fontSize: 11 }}>
              <div><span style={{ color: '#888' }}>قیمت هر تیکه:</span><br/><b className="num-fa" style={{ fontSize: 14 }}>{toman(unitPrice || 0)}</b></div>
              <div><span style={{ color: '#888' }}>تعداد تیکه در {seriesType.label}:</span><br/><b className="num-fa" style={{ fontSize: 14 }}>{fa(pieceCount)} تیکه</b></div>
              <div><span style={{ color: '#888' }}>قیمت هر {seriesType.label}:</span><br/><b className="num-fa" style={{ fontSize: 14, color: '#011c3a' }}>{toman(seriesPrice)}</b></div>
            </div>
            <p style={{ fontSize: 9.5, color: '#8a5a20', marginTop: 8 }}>فرمول: {fa(unitPrice || 0)} × {fa(pieceCount)} = <b className="num-fa">{fa(seriesPrice)}</b> تومان</p>
          </div>
        </EditorSection>

        {/* === ۴. رنگ و موجودی === */}
        <EditorSection title="۴. رنگ و موجودی" description="رنگ سری و تعداد سری موجود">
          <div className="form-grid">
            <Field label="رنگ"><input required value={form.color} onChange={e => update('color', e.target.value)} placeholder="مثلاً مشکی"/></Field>
            <Field label="کد رنگ">
              <input type="color" value={form.colorHex} onChange={e => update('colorHex', e.target.value)} style={{ height: 40, width: '100%', border: '1px solid #deddd6', cursor: 'pointer' }} />
            </Field>
            <Field label={`تعداد ${seriesType.label} موجود`} helper={`مثلاً ۴ سری = ${fa(4 * pieceCount)} تیکه`}>
              <input required type="text" inputMode="numeric" value={form.seriesCount} onChange={e => update('seriesCount', e.target.value)} placeholder="۴"/>
            </Field>
          </div>

          {/* پیشنمایش موجودی */}
          {seriesCount > 0 && (
            <div style={{ marginTop: 12, padding: 14, border: '1px solid #b9cfbc', background: '#edf3ee', borderRadius: 6, fontSize: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: form.colorHex, border: '2px solid #fff', boxShadow: '0 0 0 1px #ccc' }} />
                <b>{form.color || 'بدون رنگ'}</b>
                <span style={{ color: '#36563a' }} className="num-fa">
                  {fa(seriesCount)} × {seriesType.label} = {fa(totalPieces)} تیکه
                </span>
              </div>
              <p style={{ fontSize: 10, color: '#36563a', marginTop: 6 }}>ارزش کل موجودی: <b className="num-fa">{toman(totalValue)}</b></p>
            </div>
          )}
        </EditorSection>

        {/* === ۵. توضیحات === */}
        <EditorSection title="۵. توضیحات" description="جنس، فرم و شرایط تولید">
          <Field label="توضیحات محصول">
            <textarea required rows={5} maxLength={1200} value={form.description} onChange={e => update('description', e.target.value)} placeholder="جنس پارچه، نوع دوخت، فرم محصول و ویژگی‌های قابل ارائه…"/>
            <small>{form.description.length.toLocaleString('fa-IR')} از ۱٬۲۰۰ نویسه</small>
          </Field>
        </EditorSection>

        {/* === بازبینی === */}
        <div className="review-policy"><ShieldCheck size={18}/><div><b>انتشار بعد از تأیید کلبه</b><p>محصول با وضعیت «در بررسی» برای تیم کاتالوگ کلبه ارسال می‌شود.</p></div></div>

        {/* خلاصه نهایی */}
        <div style={{ padding: 16, border: '1px solid #e5e5e0', borderRadius: 6, background: '#fff' }}>
          <b style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>خلاصه محصول</b>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', fontSize: 11 }}>
            <div><span style={{ color: '#888' }}>نام:</span> {form.name || '—'}</div>
            <div><span style={{ color: '#888' }}>رنگ:</span> <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: form.colorHex, marginRight: 4, verticalAlign: 'middle' }} /> {form.color || '—'}</div>
            <div><span style={{ color: '#888' }}>نوع سری:</span> {seriesType.label} ({fa(pieceCount)} تیکه)</div>
            <div><span style={{ color: '#888' }}>قیمت هر تیکه:</span> <b className="num-fa">{toman(unitPrice || 0)}</b></div>
            <div><span style={{ color: '#888' }}>قیمت هر سری:</span> <b className="num-fa" style={{ color: '#011c3a' }}>{toman(seriesPrice)}</b></div>
            <div><span style={{ color: '#888' }}>تعداد سری:</span> <b className="num-fa">{fa(seriesCount || 0)}</b></div>
            <div><span style={{ color: '#888' }}>مجموع تیکه:</span> <b className="num-fa">{fa(totalPieces)}</b></div>
            <div><span style={{ color: '#888' }}>ارزش کل:</span> <b className="num-fa">{toman(totalValue)}</b></div>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>انصراف</button>
          <button type="submit" className="button primary" disabled={submitting}>{submitting ? 'در حال ثبت…' : 'ثبت و ارسال برای بررسی'}</button>
        </div>
      </form>
    </main>
  </div>
}

/* ================================================================
   کامپوننتهای کمکی
   ================================================================ */

function EditorSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section style={{ marginBottom: 24 }}>
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 13, fontWeight: 'bold' }}>{title}</h2>
      <p style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{description}</p>
    </div>
    {children}
  </section>
}

function Field({ label, children, optional, helper }: { label: string; children: ReactNode; optional?: boolean; helper?: string }) {
  return <label style={{ display: 'block', fontSize: 10, color: '#45453f', fontWeight: 600, marginBottom: 12 }}>
    {label}{optional ? <span style={{ color: '#929188', fontWeight: 400, marginRight: 4 }}>(اختیاری)</span> : <span style={{ color: '#a4463d' }}>*</span>}
    <div style={{ marginTop: 6 }}>{children}</div>
    {helper && <small style={{ display: 'block', color: '#929188', fontWeight: 400, fontSize: 9, marginTop: 4 }}>{helper}</small>}
  </label>
}

/* ================================================================
   FulfillmentOrders — سفارشات آماده با API
   ================================================================ */

export function FulfillmentOrders({ onUpdated }: { onUpdated: () => void }) {
  const [orders, setOrders] = useState<Array<any>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionResult, setActionResult] = useState('')
  const statusLabel: Record<string, string> = { pending: 'نیازمند تأیید', confirmed: 'جدید', preparing: 'در حال آماده‌سازی', shipped: 'آماده ارسال', delivered: 'تحویل شده', cancelled: 'لغو شده' }

  useEffect(() => { loadSupplierOrders('').then(data => { setOrders(data as any[]); setLoading(false) }).catch(() => { setError('دریافت سفارش‌ها انجام نشد.'); setLoading(false) }) }, [])
  void onUpdated

  const updateStatus = async (id: string, status: 'preparing' | 'shipped' | 'delivered') => {
    setActionResult('در حال ثبت…')
    try { await updateSupplierPurchaseOrder(id, status, status === 'shipped' ? `TAX-${Date.now().toString().slice(-6)}` : undefined); setActionResult('وضعیت سفارش به‌روزرسانی شد.'); setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o)) }
    catch (e) { setActionResult(e instanceof Error ? e.message : 'خطا در به‌روزرسانی.') }
  }

  if (loading) return <div className="page-head"><h1>سفارشات آماده</h1><p style={{fontSize:11,color:'#999'}}>در حال دریافت…</p></div>
  if (error) return <div className="page-head"><h1>سفارشات آماده</h1><p style={{fontSize:11,color:'#a4463d'}}>{error}</p></div>

  return <><div className="page-head"><div><PageCrumbs parent="عملیات" current="سفارشات آماده"/><h1>سفارشات آماده</h1><p>سفارش‌های خرید را تأیید، آماده و ارسال کنید.</p></div></div>
  {actionResult && <div role="status" style={{marginBottom:12,border:'1px solid #b9cfbc',background:'#edf3ee',padding:'8px 12px',fontSize:10,color:'#36563a'}}>{actionResult}</div>}
  <section className="surface orders-surface" style={{padding:16}}>
    <div className="ledger-table">
      <div className="ledger-row header"><span>کد سفارش</span><span>محصول</span><span>تعداد</span><span>مبلغ</span><span>وضعیت</span><span>اقدام</span></div>
      {orders.length === 0 && <div style={{padding:20,textAlign:'center',fontSize:11,color:'#999'}}>سفارشی در انتظار اقدام نیست.</div>}
      {(orders as any[]).map(order => (
        <div className="ledger-row" key={order.id}>
          <b>{order.order_code}</b>
          <span>{(order.purchase_order_items ?? []).map((item: any) => item.product_name).join('، ') || 'چند محصولی'}</span>
          <b className="num-fa">{fa((order.purchase_order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0))} تکه</b>
          <b className="num-fa">{fa(order.total_amount)} ت</b>
          <Status>{statusLabel[order.status] ?? order.status}</Status>
          <div style={{display:'flex',gap:4}}>
            {order.status === 'pending' && <button onClick={() => updateStatus(order.id, 'preparing')} className="button primary" style={{minHeight:28,fontSize:9,padding:'0 8px'}}>تأیید</button>}
            {order.status === 'confirmed' && <button onClick={() => updateStatus(order.id, 'preparing')} className="button secondary" style={{minHeight:28,fontSize:9,padding:'0 8px'}}>شروع</button>}
            {order.status === 'preparing' && <button onClick={() => updateStatus(order.id, 'shipped')} className="button primary" style={{minHeight:28,fontSize:9,padding:'0 8px'}}>ارسال</button>}
            {order.status === 'shipped' && <button onClick={() => updateStatus(order.id, 'delivered')} className="button secondary" style={{minHeight:28,fontSize:9,padding:'0 8px'}}>تحویل</button>}
          </div>
        </div>
      ))}
    </div>
  </section></>
}

export function ReturnsIssues() {
  const issues = [
    { id: 'RI-0891', order: 'PO-4813', type: 'کسری کالا', qty: '۲ تکه', status: 'در بررسی', date: '۲۱ مرداد' },
    { id: 'RI-0887', order: 'PO-4805', type: 'کالای اشتباه', qty: '۱ بسته', status: 'برطرف شد', date: '۱۸ مرداد' },
  ]
  return <><div className="page-head"><div><PageCrumbs parent="عملیات" current="مرجوعی و مسائل"/><h1>مرجوعی و مسائل</h1><p>کسری، کالای اشتباه و آسیب‌دیدگی سفارش‌ها را مدیریت کنید.</p></div><button className="button primary"><Plus size={17}/>ثبت مورد جدید</button></div>
  <section className="surface" style={{padding:16}}>
    <div className="ledger-table">
      <div className="ledger-row header"><span>شناسه</span><span>سفارش</span><span>نوع</span><span>تعداد</span><span>وضعیت</span><span>تاریخ</span></div>
      {issues.map(i => <div className="ledger-row" key={i.id}><b>{i.id}</b><span>{i.order}</span><span>{i.type}</span><b>{i.qty}</b><Status>{i.status}</Status><span>{i.date}</span></div>)}
    </div>
  </section></>
}

export function Messages() {
  const threads = [
    { id: 't1', from: 'تیم خرید کلبه', preview: 'PO-4813 — تأخیر در ارسال؟', time: '۱۰:۳۲', unread: true },
    { id: 't2', from: 'کنترل کیفیت', preview: 'نمونه جدید تأیید شد', time: 'دیروز', unread: false },
    { id: 't3', from: 'مالی کلبه', preview: 'صورت‌حساب مرداد ارسال شد', time: '۲ روز پیش', unread: false },
  ]
  return <><div className="page-head"><div><PageCrumbs parent="ارتباطات" current="پیام‌ها"/><h1>پیام‌ها</h1><p>گفتگو با تیم‌های کلبه — خرید، کیفیت و مالی.</p></div></div>
  <section className="surface" style={{padding:16}}>
    {threads.map(t => (
      <div key={t.id} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 0',borderBottom:'1px solid #ecebe6'}}>
        <span style={{width:36,height:36,borderRadius:'50%',background:'#e7e7e1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'#555'}}>{t.from.slice(0,1)}</span>
        <div style={{flex:1,minWidth:0}}><b style={{fontSize:11.5,display:'block'}}>{t.from}{t.unread && <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:'#ca9130',marginRight:6}} />}</b><span style={{fontSize:10,color:'#888'}}>{t.preview}</span></div>
        <small style={{fontSize:9,color:'#999'}}>{t.time}</small>
      </div>
    ))}
  </section></>
}


export function ProductReview() {
  return <><div className="page-head"><div><PageCrumbs parent="کاتالوگ" current="در حال بررسی"/><h1>در حال بررسی کلبه</h1><p>محصولات ارسالی شما که منتظر تأیید تیم کاتالوگ کلبه هستند.</p></div></div>
  <section className="surface" style={{padding:16}}>
    <div className="ledger-table"><div className="ledger-row header"><span>محصول</span><span>SKU</span><span>سری</span><span>وضعیت</span></div>
    <div className="ledger-row"><b>پیراهن لینن</b><span>NG-LIN-301</span><span>سری کامل (۸ تیکه)</span><Status>در بررسی</Status></div>
    <div className="ledger-row"><b>وست پشمی</b><span>NG-VST-041</span><span>نیم‌سری (۵ تیکه)</span><Status>نیازمند اصلاح</Status></div>
    </div>
  </section></>
}

export function QuoteBuilder() {
  return <><div className="page-head"><div><PageCrumbs parent="تولید سفارشی" current="پیشنهاد قیمت"/><h1>ساخت پیشنهاد قیمت</h1><p>برای RFQ-2048 پیشنهاد خود را تنظیم و ارسال کنید.</p></div></div>
  <section className="surface" style={{padding:20}}>
    <SectionHeading title="پیشنهاد قیمت برای RFQ-2048" eyebrow="QUOTE BUILDER">پیراهن آکسفورد اختصاصی — گروه هتل‌های هلیا</SectionHeading>
    <div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))'}}>
      <label style={{fontSize:10}}>قیمت هر تیکه<input type="text" placeholder="۱٬۴۵۰٬۰۰۰" style={{width:'100%',height:36,border:'1px solid #deddd6',padding:'0 10px',fontSize:11,marginTop:4}}/></label>
      <label style={{fontSize:10}}>زمان تولید (روز)<input type="number" defaultValue={28} style={{width:'100%',height:36,border:'1px solid #deddd6',padding:'0 10px',fontSize:11,marginTop:4}} dir="ltr"/></label>
      <label style={{fontSize:10}}>تعداد قابل تأمین<input type="number" defaultValue={600} style={{width:'100%',height:36,border:'1px solid #deddd6',padding:'0 10px',fontSize:11,marginTop:4}} dir="ltr"/></label>
    </div>
    <button className="button primary" style={{marginTop:16,minHeight:38}}>ارسال پیشنهاد</button>
  </section></>
}

export function SamplesWorkspace() {
  return <><div className="page-head"><div><PageCrumbs parent="تولید سفارشی" current="نمونه‌ها"/><h1>فضای نمونه‌ها</h1><p>نمونه‌های فیزیکی و دیجیتال را بارگذاری و پیگیری کنید.</p></div><button className="button primary"><Upload size={17}/>بارگذاری نمونه</button></div>
  <section className="surface" style={{padding:16}}>
    <p style={{fontSize:11,color:'#666'}}>PO-4827 — نمونه فیزیکی تا ۲۳ مرداد باید بارگذاری شود.</p>
    <div style={{marginTop:12,border:'2px dashed #deddd6',borderRadius:6,padding:24,textAlign:'center'}}>
      <Upload size={28} style={{color:'#999',margin:'0 auto 8px'}} />
      <b style={{fontSize:11}}>عکس‌های نمونه را اینجا رها کنید</b>
      <p style={{fontSize:9,color:'#999',marginTop:4}}>جلو، پشت و جزئیات پارچه</p>
    </div>
  </section></>
}

export function ChangeRequests() {
  const requests = [
    { id: 'CR-0091', title: 'تغییر لیبل گردن', product: 'پیراهن آکسفورد', status: 'در بررسی', date: '۲۰ مرداد' },
    { id: 'CR-0087', title: 'افزایش گرماژ پارچه', product: 'بارانی کوتاه', status: 'تأیید شد', date: '۱۵ مرداد' },
  ]
  return <><div className="page-head"><div><PageCrumbs parent="کاتالوگ" current="درخواست تغییر"/><h1>درخواست‌های تغییر</h1><p>تغییرات پیشنهادی روی محصولات تأییدشده.</p></div><button className="button primary"><Plus size={17}/>درخواست جدید</button></div>
  <section className="surface" style={{padding:16}}>
    <div className="ledger-table"><div className="ledger-row header"><span>شناسه</span><span>عنوان</span><span>محصول</span><span>وضعیت</span><span>تاریخ</span></div>
    {requests.map(r => <div className="ledger-row" key={r.id}><b>{r.id}</b><span>{r.title}</span><span>{r.product}</span><Status>{r.status}</Status><span>{r.date}</span></div>)}
    </div>
  </section></>
}
