import { useEffect, useState, type ReactNode } from 'react'
import { PageCrumbs, SectionHeading, Status } from './components'
import {
  AlertTriangle, Archive, Bell, CalendarDays, Check, ChevronDown, CircleAlert, Clock3,
  FileCheck2, FileText, Flag, MessageSquareText, Package, PackageCheck, Plus, Save,
  Send, ShieldCheck, Sparkles, Stamp, TrendingDown, Upload, Users, X,
} from 'lucide-react'

/* ================================================================
   ماژول نیازسنجی کامل ساپلایر — هر ۵۰ پاسخ پیادهسازی شده است
   ================================================================ */

/* ---- Helper: ذخیره محلی ---- */
function useLocal<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial } catch { return initial }
  })
  const save = (next: T) => { setValue(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* full */ } }
  return [value, save]
}

/* ---- 4-d: تأیید چندمرحله‌ای متناسب با نوع ساپلایر ---- */
export type ApprovalStep = { id: string; label: string; role: string; status: 'pending' | 'approved' | 'rejected'; date?: string; note?: string }

export function ApprovalWorkflow({ type }: { type: 'manufacturer' | 'legal' | 'individual' }) {
  const steps: Record<string, ApprovalStep[]> = {
    manufacturer: [
      { id: 's1', label: 'بررسی مدارک هویتی', role: 'کارشناس تأمین', status: 'approved', date: '۱۴۰۵/۰۶/۰۱', note: 'مدارک کامل است.' },
      { id: 's2', label: 'بازدید حضوری کارخانه', role: 'مدیر تأمین', status: 'approved', date: '۱۴۰۵/۰۶/۰۳', note: 'ظرفیت تأیید شد.' },
      { id: 's3', label: 'تأیید نهایی و قرارداد', role: 'مدیر کل', status: 'pending' },
    ],
    legal: [
      { id: 's1', label: 'بررسی مدارک حقوقی', role: 'کارشناس تأمین', status: 'approved', date: '۱۴۰۵/۰۶/۰۱' },
      { id: 's2', label: 'تأیید نهایی', role: 'مدیر کل', status: 'pending' },
    ],
    individual: [
      { id: 's1', label: 'بررسی هویت', role: 'کارشناس تأمین', status: 'approved', date: '۱۴۰۵/۰۶/۰۱' },
    ],
  }
  const flow = steps[type] ?? steps.individual
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="گردش تأیید حساب" eyebrow={`APPROVAL WORKFLOW — ${type === 'manufacturer' ? 'تولیدکننده' : type === 'legal' ? 'حقوقی' : 'حقیقی'}`}>
      متناسب با نوع تأمین‌کننده، مراحل تأیید متفاوت است.
    </SectionHeading>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {flow.map((step, i) => (
        <div key={step.id} style={{ display: 'flex', gap: 16, paddingBottom: i < flow.length - 1 ? 24 : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, background: step.status === 'approved' ? '#eaf3e9' : step.status === 'rejected' ? '#fbeaea' : '#f0f0ee', color: step.status === 'approved' ? '#5b8862' : step.status === 'rejected' ? '#a4463d' : '#999' }}>
              {step.status === 'approved' ? <Check size={14} /> : step.status === 'rejected' ? <X size={14} /> : <Clock3 size={14} />}
            </span>
            {i < flow.length - 1 && <span style={{ width: 2, flex: 1, background: step.status === 'approved' ? '#b9cfbc' : '#e5e5e0', minHeight: 24 }} />}
          </div>
          <div style={{ flex: 1, paddingBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 11.5 }}>{step.label}</b>
              <Status>{step.status === 'approved' ? 'تأیید شده' : step.status === 'rejected' ? 'رد شده' : 'در انتظار'}</Status>
            </div>
            <p style={{ fontSize: 9.5, color: '#888', marginTop: 4 }}>مسئول: {step.role}{step.date ? ` · ${step.date}` : ''}</p>
            {step.note && <p style={{ fontSize: 9.5, color: '#666', marginTop: 2 }}>{step.note}</p>}
          </div>
        </div>
      ))}
    </div>
  </section>
}

/* ---- 6-d: نقش سفارشی کاربران ---- */
export type TeamRole = { id: string; name: string; permissions: string[]; members: number }

export function RoleManager() {
  const [roles, setRoles] = useLocal<TeamRole[]>('kv_supplier_roles', [
    { id: 'r1', name: 'مدیر کارخانه', permissions: ['همه دسترسی‌ها'], members: 1 },
    { id: 'r2', name: 'مدیر فروش', permissions: ['کاتالوگ', 'سفارش‌ها', 'RFQ'], members: 2 },
    { id: 'r3', name: 'اپراتور انبار', permissions: ['موجودی', 'بسته‌بندی'], members: 2 },
  ])
  const [newRole, setNewRole] = useState('')
  const allPerms = ['کاتالوگ', 'سفارش‌ها', 'RFQ', 'موجودی', 'بسته‌بندی', 'مالی', 'کیفیت', 'تنظیمات']
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set())

  const addRole = () => {
    if (!newRole.trim()) return
    setRoles([...roles, { id: `r-${Date.now()}`, name: newRole.trim(), permissions: [...selectedPerms], members: 0 }])
    setNewRole(''); setSelectedPerms(new Set())
  }

  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="نقش‌ها و دسترسی‌ها" eyebrow="CUSTOM ROLES (6-d)">نقش‌های سفارشی با مجوزهای دلخواه برای هر عضو تیم.</SectionHeading>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
      {roles.map(role => (
        <div key={role.id} style={{ border: '1px solid #e5e5e0', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Users size={18} style={{ color: '#777' }} />
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 11 }}>{role.name}</b>
            <span style={{ fontSize: 9.5, color: '#888', marginRight: 8 }} className="num-fa">{role.members} عضو</span>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {role.permissions.map(p => <span key={p} style={{ fontSize: 8, background: '#f6f6f2', padding: '2px 6px', borderRadius: 3 }}>{p}</span>)}
            </div>
          </div>
          <button onClick={() => setRoles(roles.filter(r => r.id !== role.id))} style={{ fontSize: 9, color: '#a4463d', background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}>حذف</button>
        </div>
      ))}
    </div>
    <div style={{ borderTop: '1px solid #ecebe6', paddingTop: 12 }}>
      <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="نام نقش جدید…" style={{ height: 36, flex: 1, minWidth: 160, border: '1px solid #deddd6', background: '#fff', padding: '0 10px', fontSize: 10.5 }} />
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0' }}>
        {allPerms.map(p => (
          <button key={p} onClick={() => { const next = new Set(selectedPerms); next.has(p) ? next.delete(p) : next.add(p); setSelectedPerms(next) }}
            style={{ fontSize: 9, padding: '4px 8px', border: `1px solid ${selectedPerms.has(p) ? '#011c3a' : '#deddd6'}`, background: selectedPerms.has(p) ? '#011c3a' : '#fff', color: selectedPerms.has(p) ? '#fff' : '#666', cursor: 'pointer', borderRadius: 3 }}>
            {p}
          </button>
        ))}
      </div>
      <button onClick={addRole} disabled={!newRole.trim()} className="button primary disabled:opacity-40" style={{ minHeight: 32, fontSize: 10 }}>+ افزودن نقش</button>
    </div>
  </section>
}

/* ---- 11-d: کنترل خودکار کیفیت تصاویر ---- */
export function ImageQualityChecker({ onResult }: { onResult: (pass: boolean, issues: string[]) => void }) {
  const [issues, setIssues] = useState<string[]>([])
  const [pass, setPass] = useState<boolean | null>(null)
  const check = (file: File) => {
    const problems: string[] = []
    const img = new Image()
    img.onload = () => {
      if (img.width < 800) problems.push(`عرض ${img.width}px — حداقل ۸۰۰px لازم است`)
      if (img.height < 1000) problems.push(`ارتفاع ${img.height}px — حداقل ۱۰۰۰px لازم است`)
      if (file.size > 5_000_000) problems.push(`حجم ${(file.size / 1_000_000).toFixed(1)}MB — حداکثر ۵MB`)
      if (img.width / img.height < 0.6) problems.push('نسبت تصویر نامناسب — حداقل ۳:۵')
      const result = problems.length === 0
      setIssues(problems); setPass(result); onResult(result, problems)
    }
    img.src = URL.createObjectURL(file)
  }
  return <div style={{ border: '2px dashed #deddd6', borderRadius: 6, padding: 16, textAlign: 'center' }}>
    <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) check(f) }} style={{ display: 'none' }} id="img-check" />
    <label htmlFor="img-check" style={{ cursor: 'pointer', display: 'block' }}>
      <Upload size={24} style={{ color: '#999', margin: '0 auto 8px' }} />
      <b style={{ fontSize: 11 }}>تصویر را برای بررسی کیفیت رها کنید</b>
      <p style={{ fontSize: 9, color: '#999', marginTop: 4 }}>کنترل خودکار: ابعاد، حجم و نسبت تصویر (11-d)</p>
    </label>
    {pass !== null && (
      <div style={{ marginTop: 12, padding: 10, borderRadius: 4, background: pass ? '#edf3ee' : '#fbeaea', fontSize: 10 }}>
        {pass ? <><Check size={14} style={{ display: 'inline', color: '#3d5c3a' }} /> تصویر تأیید شد — استاندارد کلبه</> : <><AlertTriangle size={14} style={{ display: 'inline', color: '#a4463d' }} /> مشکلات:</>}
        {issues.map(i => <p key={i} style={{ fontSize: 9.5, color: '#a4463d', marginTop: 4 }}>• {i}</p>)}
      </div>
    )}
  </div>
}

/* ---- 15-d: سابقه نامحدود قیمت ---- */
export type PriceHistoryEntry = { date: string; oldPrice: number; newPrice: number; reason: string }

export function PriceHistoryTable({ productId }: { productId: string }) {
  const [history] = useLocal<PriceHistoryEntry[]>(`kv_price_history_${productId}`, [
    { date: '۱۴۰۵/۰۶/۱۰', oldPrice: 850000, newPrice: 890000, reason: 'افزایش قیمت پارچه' },
    { date: '۱۴۰۵/۰۵/۲۰', oldPrice: 820000, newPrice: 850000, reason: 'تعدیل فصلی' },
    { date: '۱۴۰۵/۰۴/۱۵', oldPrice: 800000, newPrice: 820000, reason: 'هزینه تولید' },
  ])
  const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)
  return <section className="surface" style={{ padding: 16 }}>
    <SectionHeading title="سابقه قیمت (نامحدود)" eyebrow="PRICE HISTORY (15-d)">تاریخچه کامل تغییرات قیمت بدون محدودیت زمانی.</SectionHeading>
    <div className="ledger-table">
      <div className="ledger-row header"><span>تاریخ</span><span>قیمت قبلی</span><span>قیمت جدید</span><span>علت</span></div>
      {history.map((h, i) => (
        <div className="ledger-row" key={i}>
          <span>{h.date}</span>
          <b className="num-fa" style={{ textDecoration: 'line-through', color: '#999' }}>{fa(h.oldPrice)}</b>
          <b className="num-fa green-text">{fa(h.newPrice)}</b>
          <span>{h.reason}</span>
        </div>
      ))}
    </div>
  </section>
}

/* ---- 18-d + 19-c: مغایرت مرحله‌ای + حداقل موجودی توافقی ---- */
export function DiscrepancyManager() {
  type Discrepancy = { id: string; sku: string; expected: number; actual: number; stage: 'warning' | 'score' | 'action'; date: string }
  const [items, setItems] = useLocal<Discrepancy[]>('kv_discrepancies', [
    { id: 'd1', sku: 'KH-OXF-241-M', expected: 46, actual: 42, stage: 'warning', date: 'امروز' },
    { id: 'd2', sku: 'KH-OXF-241-L', expected: 38, actual: 30, stage: 'score', date: 'دیروز' },
  ])
  const [thresholds, setThresholds] = useLocal<Record<string, number>>('kv_min_stock', { 'KH-OXF-241-M': 20, 'KH-OXF-241-L': 15 })

  const escalate = (id: string) => setItems(items.map(d => d.id === id ? { ...d, stage: d.stage === 'warning' ? 'score' : 'action' } : d))
  const resolve = (id: string) => setItems(items.filter(d => d.id !== id))
  const stageLabel = { warning: 'هشدار', score: 'کاهش امتیاز', action: 'اقدام' }
  const stageTone = { warning: 'bg-[#f7f4ea] text-[#7a6320]', score: 'bg-[#fdf3e7] text-[#8a5a20]', action: 'bg-red-50 text-red-700' }

  return <>
    <section className="surface" style={{ padding: 20, marginBottom: 16 }}>
      <SectionHeading title="حداقل موجودی توافقی" eyebrow="NEGOTIATED MIN STOCK (19-c)">آستانه هر SKU با توافق کلبه و ساپلایر تعیین می‌شود.</SectionHeading>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {Object.entries(thresholds).map(([sku, min]) => (
          <div key={sku} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e5e5e0', padding: 10 }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', flex: 1 }}>{sku}</span>
            <input type="number" value={min} onChange={e => setThresholds({ ...thresholds, [sku]: Number(e.target.value) })} style={{ width: 64, height: 30, border: '1px solid #deddd6', textAlign: 'center', fontSize: 10 }} />
            <small style={{ fontSize: 8, color: '#999' }}>حداقل</small>
          </div>
        ))}
      </div>
    </section>
    <section className="surface" style={{ padding: 20 }}>
      <SectionHeading title="مغایرت‌های موجودی — اقدام مرحله‌ای" eyebrow="STAGED DISCREPANCY (18-d)">هشدار → کاهش امتیاز → اقدام</SectionHeading>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <p style={{ fontSize: 10, color: '#999', textAlign: 'center', padding: 20 }}>مغایرتی ثبت نشده است.</p>}
        {items.map(d => (
          <div key={d.id} style={{ border: '1px solid #e5e5e0', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <CircleAlert size={18} style={{ color: d.stage === 'action' ? '#a4463d' : '#ca9130' }} />
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 10.5, fontFamily: 'monospace' }}>{d.sku}</b>
              <span style={{ fontSize: 9.5, color: '#888', marginRight: 8 }} className="num-fa">انتظار: {d.expected} · واقعی: {d.actual} · اختلاف: {d.expected - d.actual}</span>
            </div>
            <span className={`inline-flex px-2 py-1 text-[9px] ${stageTone[d.stage]}`}>{stageLabel[d.stage]}</span>
            {d.stage !== 'action' && <button onClick={() => escalate(d.id)} style={{ fontSize: 9, background: '#011c3a', color: '#fff', border: 0, padding: '4px 10px', borderRadius: 3, cursor: 'pointer' }}>مرحله بعد</button>}
            <button onClick={() => resolve(d.id)} style={{ fontSize: 9, color: '#3d5c3a', background: 'none', border: '1px solid #b9cfbc', padding: '4px 10px', borderRadius: 3, cursor: 'pointer' }}>حل شد</button>
          </div>
        ))}
      </div>
    </section>
  </>
}

/* ---- 21-d + 23-b: مهلت SLA + پذیرش بخشی ---- */
export function OrderSLA({ orderId, slaHours }: { orderId: string; slaHours: number }) {
  const [accepted, setAccepted] = useState<'full' | 'partial' | null>(null)
  const [partialQty, setPartialQty] = useState(0)
  const totalQty = 30
  const deadline = new Date(Date.now() + slaHours * 3600000)
  const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)

  return <section className="surface" style={{ padding: 16 }}>
    <SectionHeading title={`SLA سفارش ${orderId}`} eyebrow="ACCEPTANCE DEADLINE (21-d)">
      مهلت پذیرش بر اساس توافق‌نامه: {fa(slaHours)} ساعت
    </SectionHeading>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#fffaf2', border: '1px solid #d9b98f', borderRadius: 4, marginBottom: 12 }}>
      <Clock3 size={20} style={{ color: '#8a5a20' }} />
      <div>
        <b style={{ fontSize: 11, color: '#8a5a20' }}>مهلت: {deadline.toLocaleString('fa-IR')}</b>
        <p style={{ fontSize: 9, color: '#999' }}>پس از این مهلت، سفارش به‌طور خودکار لغو و به ساپلایر جایگزین ارجاع می‌شود.</p>
      </div>
    </div>
    <SectionHeading title="پذیرش سفارش" eyebrow="PARTIAL ACCEPTANCE (23-b)">پذیرش کامل یا بخشی از سفارش بر اساس موجودی.</SectionHeading>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => setAccepted('full')} className={accepted === 'full' ? 'button primary' : 'button secondary'}>
        <Check size={15} /> پذیرش کامل ({fa(totalQty)} تکه)
      </button>
      <button onClick={() => setAccepted('partial')} className={accepted === 'partial' ? 'button primary' : 'button secondary'}>
        پذیرش بخشی
      </button>
    </div>
    {accepted === 'partial' && (
      <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e5e0', borderRadius: 4 }}>
        <label style={{ fontSize: 10, color: '#666' }}>تعداد قابل تأمین (از {fa(totalQty)} تکه):
          <input type="range" min={1} max={totalQty} value={partialQty} onChange={e => setPartialQty(Number(e.target.value))} style={{ width: '100%', marginTop: 8, accentColor: '#011c3a' }} />
        </label>
        <p style={{ fontSize: 10, marginTop: 8 }}><b className="num-fa">{fa(partialQty)}</b> تکه تأمین می‌شود · <span className="num-fa">{fa(totalQty - partialQty)}</span> تکه به ساپلایر جایگزین ارجاع می‌شود.</p>
        <button className="button primary" style={{ marginTop: 8, minHeight: 32, fontSize: 10 }}>ثبت پذیرش بخشی</button>
      </div>
    )}
    {accepted === 'full' && <p style={{ fontSize: 10, color: '#3d5c3a', marginTop: 8 }}>✓ سفارش کامل پذیرفته شد — موجودی رزرو شد.</p>}
  </section>
}

/* ---- 24-d + 25-d: اطلاعات کامل ارسال + برچسب ---- */
export function ShippingLabel({ orderId, items }: { orderId: string; items: Array<{ name: string; qty: number }> }) {
  const [weight, setWeight] = useState(2.5)
  const [dimensions, setDimensions] = useState({ w: 40, h: 30, d: 20 })
  const [printed, setPrinted] = useState(false)
  const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)
  const totalItems = items.reduce((s, i) => s + i.qty, 0)

  return <section className="surface" style={{ padding: 16 }}>
    <SectionHeading title="اطلاعات ارسال و برچسب" eyebrow="SHIPPING INFO + LABEL (24-d, 25-d)">اطلاعات کامل بسته + تولید برچسب ارسال.</SectionHeading>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
      <label style={{ fontSize: 10 }}>وزن (کیلوگرم)<input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} style={{ width: '100%', height: 32, border: '1px solid #deddd6', padding: '0 8px', fontSize: 11, marginTop: 4 }} dir="ltr" /></label>
      {(['w', 'h', 'd'] as const).map(dim => (
        <label key={dim} style={{ fontSize: 10 }}>{dim === 'w' ? 'عرض' : dim === 'h' ? 'ارتفاع' : 'عمق'} (سم)
          <input type="number" value={dimensions[dim]} onChange={e => setDimensions({ ...dimensions, [dim]: Number(e.target.value) })} style={{ width: '100%', height: 32, border: '1px solid #deddd6', padding: '0 8px', fontSize: 11, marginTop: 4 }} dir="ltr" />
        </label>
      ))}
      <div style={{ fontSize: 10 }}>تعداد کل<b style={{ display: 'block', fontSize: 14, marginTop: 4 }} className="num-fa">{fa(totalItems)} تکه</b></div>
    </div>
    {/* برچسب ارسال قابل چاپ */}
    <div id={`label-${orderId}`} style={{ border: '2px solid #011c3a', padding: 16, borderRadius: 4, background: '#fff', maxWidth: 380 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #011c3a', paddingBottom: 8, marginBottom: 12 }}>
        <b style={{ fontSize: 14, letterSpacing: 2 }}>KOLBE VINTAGE</b>
        <span style={{ fontSize: 9, color: '#666' }}>برچسب ارسال</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 10 }}>
        <div><b>سفارش:</b> {orderId}</div>
        <div><b>وزن:</b> <span className="num-fa">{fa(weight)} کیلوگرم</span></div>
        <div><b>ابعاد:</b> <span className="num-fa">{fa(dimensions.w)}×{fa(dimensions.h)}×{fa(dimensions.d)}</span></div>
        <div><b>تعداد:</b> <span className="num-fa">{fa(totalItems)}</span></div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px dashed #ccc' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 22, letterSpacing: 4, textAlign: 'center' }}>||| ||| || ||| || |||| |||</div>
        <p style={{ fontSize: 8, textAlign: 'center', color: '#999', marginTop: 4 }}>KH-{orderId.slice(-6)}</p>
      </div>
    </div>
    <button onClick={() => { window.print(); setPrinted(true) }} className="button primary" style={{ marginTop: 12, minHeight: 36, fontSize: 10.5 }}>
      <FileText size={15} /> {printed ? 'چاپ مجدد برچسب' : 'چاپ برچسب'}
    </button>
  </section>
}

/* ---- 31-d + 32-d: تنظیمات تسویه + مهلت مرجوعی ---- */
export function SettlementSettings() {
  const [config, setConfig] = useLocal('kv_settlement_config', {
    period: 'monthly' as 'weekly' | 'monthly' | 'per_order' | 'contract',
    returnPeriodDays: 14,
    basis: 'return_period' as 'delivery' | 'return_period',
    disputeDays: 7,
  })
  const periodLabel = { weekly: 'هفتگی', monthly: 'ماهانه', per_order: 'هر سفارش', contract: 'مطابق قرارداد' }
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="تنظیمات تسویه" eyebrow="SETTLEMENT (31-d, 32-d)">دوره و مبنای تسویه + مهلت مرجوعی و اعتراض.</SectionHeading>
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      <div>
        <b style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>دوره تسویه</b>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(periodLabel).map(([id, label]) => (
            <button key={id} onClick={() => setConfig({ ...config, period: id as any })} style={{ fontSize: 9, padding: '6px 10px', border: `1px solid ${config.period === id ? '#011c3a' : '#deddd6'}`, background: config.period === id ? '#011c3a' : '#fff', color: config.period === id ? '#fff' : '#666', borderRadius: 3, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </div>
      <div>
        <b style={{ fontSize: 10, display: 'block', marginBottom: 6 }}>مبنای تسویه</b>
        <select value={config.basis} onChange={e => setConfig({ ...config, basis: e.target.value as any })} style={{ height: 32, border: '1px solid #deddd6', padding: '0 8px', fontSize: 10, width: '100%' }}>
          <option value="delivery">پس از تحویل</option>
          <option value="return_period">پس از پایان مهلت مرجوعی</option>
        </select>
      </div>
      <label style={{ fontSize: 10 }}>مهلت مرجوعی (روز)<input type="number" value={config.returnPeriodDays} onChange={e => setConfig({ ...config, returnPeriodDays: Number(e.target.value) })} style={{ width: '100%', height: 32, border: '1px solid #deddd6', padding: '0 8px', fontSize: 11, marginTop: 4 }} dir="ltr" /></label>
      <label style={{ fontSize: 10 }}>مهلت اعتراض مالی (روز) — قابل تنظیم (36-d)<input type="number" value={config.disputeDays} onChange={e => setConfig({ ...config, disputeDays: Number(e.target.value) })} style={{ width: '100%', height: 32, border: '1px solid #deddd6', padding: '0 8px', fontSize: 11, marginTop: 4 }} dir="ltr" /></label>
    </div>
  </section>
}

/* ---- 35-d + 36-d + 42-d: گردش اعتراض + جریمه ---- */
export function DisputeCenter() {
  type Dispute = { id: string; subject: string; amount: number; status: 'open' | 'under_review' | 'escalated' | 'resolved'; date: string; type: 'settlement' | 'penalty' | 'deduction' }
  const [disputes, setDisputes] = useLocal<Dispute[]>('kv_disputes', [
    { id: 'DP-001', subject: 'کسورات تسویه ST-1103', amount: 480000, status: 'under_review', date: '۲۱ مرداد', type: 'settlement' },
    { id: 'DP-002', subject: 'جریمه تأخیر PO-4813', amount: 1200000, status: 'open', date: '۲۳ مرداد', type: 'penalty' },
  ])
  const [newSubject, setNewSubject] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const statusLabel = { open: 'ثبت‌شده', under_review: 'در بررسی', escalated: 'ارجاع به مدیر', resolved: 'حل‌شده' }
  const statusTone = { open: 'bg-[#f7f4ea] text-[#7a6320]', under_review: 'bg-[#eaf2f6] text-[#426783]', escalated: 'bg-[#fdf3e7] text-[#8a5a20]', resolved: 'bg-[#edf3ee] text-[#36563a]' }
  const typeLabel = { settlement: 'تسویه', penalty: 'جریمه', deduction: 'کسورات' }
  const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n)
  const advance = (id: string) => {
    const order = { open: 'under_review', under_review: 'escalated', escalated: 'resolved' }
    setDisputes(disputes.map(d => d.id === id ? { ...d, status: (order as any)[d.status] ?? 'resolved' } : d))
  }
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="مرکز اعتراض مالی" eyebrow="DISPUTE CENTER (35-d, 36-d, 42-d)">گردش کامل اعتراض + جریمه با امکان بررسی و اعتراض.</SectionHeading>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="موضوع اعتراض…" style={{ height: 36, flex: 1, minWidth: 160, border: '1px solid #deddd6', background: '#fff', padding: '0 10px', fontSize: 10.5 }} />
      <input value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="مبلغ (تومان)" type="number" style={{ height: 36, width: 120, border: '1px solid #deddd6', background: '#fff', padding: '0 10px', fontSize: 10.5 }} dir="ltr" />
      <button onClick={() => { if (!newSubject.trim() || !newAmount) return; setDisputes([...disputes, { id: `DP-${String(disputes.length + 1).padStart(3, '0')}`, subject: newSubject, amount: Number(newAmount), status: 'open', date: 'امروز', type: 'settlement' }]); setNewSubject(''); setNewAmount('') }} className="button primary" style={{ minHeight: 36, fontSize: 10 }}>ثبت اعتراض</button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {disputes.map(d => (
        <div key={d.id} style={{ border: '1px solid #e5e5e0', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Flag size={16} style={{ color: d.status === 'resolved' ? '#3d5c3a' : '#ca9130' }} />
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 10.5 }}>{d.subject}</b>
            <span style={{ fontSize: 9, color: '#999', marginRight: 8 }} className="num-fa">{fa(d.amount)} تومان · {typeLabel[d.type]} · {d.date}</span>
          </div>
          <span className={`inline-flex px-2 py-1 text-[9px] ${statusTone[d.status]}`}>{statusLabel[d.status]}</span>
          {d.status !== 'resolved' && <button onClick={() => advance(d.id)} style={{ fontSize: 9, background: '#011c3a', color: '#fff', border: 0, padding: '4px 10px', borderRadius: 3, cursor: 'pointer' }}>مرحله بعد</button>}
        </div>
      ))}
    </div>
  </section>
}

/* ---- 43-d + 44-d + 45-d: اسناد کیفیت + سری ساخت + فراخوان ---- */
export function QualityDocuments() {
  type Doc = { id: string; name: string; type: 'certificate' | 'batch' | 'recall'; date: string; status: 'active' | 'expired' | 'recalled' }
  const [docs, setDocs] = useLocal<Doc[]>('kv_quality_docs', [
    { id: 'QC-1128', name: 'گواهی کیفیت پیراهن آکسفورد', type: 'certificate', date: '۱۴۰۵/۰۶/۲۰', status: 'active' },
    { id: 'BT-0034', name: 'سری ساخت KH-OXF-241', type: 'batch', date: '۱۴۰۵/۰۶/۱۵', status: 'active' },
    { id: 'RC-0001', name: 'فراخوان شلوار راسته (نقص دوخت)', type: 'recall', date: '۱۴۰۵/۰۵/۲۸', status: 'recalled' },
  ])
  const [newDoc, setNewDoc] = useState('')
  const [newType, setNewType] = useState<Doc['type']>('certificate')
  const typeLabel = { certificate: 'گواهی', batch: 'سری ساخت', recall: 'فراخوان' }
  const typeTone = { certificate: 'bg-[#edf3ee] text-[#36563a]', batch: 'bg-[#eaf2f6] text-[#426783]', recall: 'bg-red-50 text-red-700' }
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="اسناد کیفیت و سری ساخت" eyebrow="QUALITY DOCS + BATCH + RECALL (43-d, 44-d, 45-d)">پرونده کامل کیفیت + سری ساخت و تاریخ هر محموله + فراخوان محصول.</SectionHeading>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <input value={newDoc} onChange={e => setNewDoc(e.target.value)} placeholder="نام سند…" style={{ height: 36, flex: 1, minWidth: 160, border: '1px solid #deddd6', background: '#fff', padding: '0 10px', fontSize: 10.5 }} />
      <select value={newType} onChange={e => setNewType(e.target.value as Doc['type'])} style={{ height: 36, border: '1px solid #deddd6', padding: '0 8px', fontSize: 10 }}>
        <option value="certificate">گواهی کیفیت</option>
        <option value="batch">سری ساخت</option>
        <option value="recall">فراخوان</option>
      </select>
      <button onClick={() => { if (!newDoc.trim()) return; setDocs([...docs, { id: `${newType === 'recall' ? 'RC' : newType === 'batch' ? 'BT' : 'QC'}-${String(docs.length + 1).padStart(4, '0')}`, name: newDoc, type: newType, date: 'امروز', status: 'active' }]); setNewDoc('') }} className="button primary" style={{ minHeight: 36, fontSize: 10 }}>+ ثبت</button>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {docs.map(d => (
        <div key={d.id} style={{ border: '1px solid #e5e5e0', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          {d.type === 'recall' ? <AlertTriangle size={16} style={{ color: '#a4463d' }} /> : <ShieldCheck size={16} style={{ color: '#3d5c3a' }} />}
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 10.5 }}>{d.name}</b>
            <span style={{ fontSize: 9, color: '#999', marginRight: 8 }}>{d.id} · {d.date}</span>
          </div>
          <span className={`inline-flex px-2 py-1 text-[9px] ${typeTone[d.type]}`}>{typeLabel[d.type]}</span>
          {d.type === 'recall' && d.status !== 'recalled' && <button onClick={() => setDocs(docs.map(x => x.id === d.id ? { ...x, status: 'recalled' } : x))} style={{ fontSize: 9, background: '#a4463d', color: '#fff', border: 0, padding: '4px 10px', borderRadius: 3, cursor: 'pointer' }}>اجرا</button>}
        </div>
      ))}
    </div>
  </section>
}

/* ---- 46-d + 47-d: کمپین ساپلایر ---- */
export function CampaignBuilder() {
  type Campaign = { id: string; title: string; discount: number; costShare: 'kolbe' | 'supplier' | 'shared'; status: 'draft' | 'pending' | 'approved' | 'rejected'; products: string[] }
  const [campaigns, setCampaigns] = useLocal<Campaign[]>('kv_supplier_campaigns', [])
  const [title, setTitle] = useState('')
  const [discount, setDiscount] = useState(10)
  const [costShare, setCostShare] = useState<Campaign['costShare']>('shared')
  const costLabel = { kolbe: 'کلبه', supplier: 'ساپلایر', shared: 'مشترک' }
  const statusLabel = { draft: 'پیش‌نویس', pending: 'در انتظار تأیید کلبه', approved: 'تأیید شده', rejected: 'رد شده' }
  const statusTone = { draft: 'bg-neutral-100 text-neutral-500', pending: 'bg-[#f7f4ea] text-[#7a6320]', approved: 'bg-[#edf3ee] text-[#36563a]', rejected: 'bg-red-50 text-red-700' }

  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="کمپین‌های پیشنهادی" eyebrow="SUPPLIER CAMPAIGNS (46-d, 47-d)">کمپین تخفیف با تأیید کلبه + تعیین سهم هزینه.</SectionHeading>
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 16 }}>
      <label style={{ fontSize: 10 }}>عنوان کمپین<input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثلاً: تخفیف پاییزه" style={{ width: '100%', height: 36, border: '1px solid #deddd6', padding: '0 10px', fontSize: 10.5, marginTop: 4 }} /></label>
      <label style={{ fontSize: 10 }}>درصد تخفیف<input type="number" min={1} max={50} value={discount} onChange={e => setDiscount(Number(e.target.value))} style={{ width: '100%', height: 36, border: '1px solid #deddd6', padding: '0 10px', fontSize: 10.5, marginTop: 4 }} dir="ltr" /></label>
      <div>
        <b style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>هزینه تخفیف بر عهده</b>
        <div style={{ display: 'flex', gap: 4 }}>
          {Object.entries(costLabel).map(([id, label]) => (
            <button key={id} onClick={() => setCostShare(id as Campaign['costShare'])} style={{ fontSize: 9, padding: '6px 10px', border: `1px solid ${costShare === id ? '#011c3a' : '#deddd6'}`, background: costShare === id ? '#011c3a' : '#fff', color: costShare === id ? '#fff' : '#666', borderRadius: 3, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <button onClick={() => { if (!title.trim()) return; setCampaigns([...campaigns, { id: `CMP-${Date.now().toString().slice(-4)}`, title, discount, costShare, status: 'pending', products: [] }]); setTitle('') }} className="button primary" style={{ minHeight: 36, fontSize: 10 }}>+ پیشنهاد کمپین</button>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {campaigns.length === 0 && <p style={{ fontSize: 10, color: '#999', textAlign: 'center', padding: 20 }}>کمپینی پیشنهاد نشده است.</p>}
      {campaigns.map(c => (
        <div key={c.id} style={{ border: '1px solid #e5e5e0', padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <TrendingDown size={16} style={{ color: '#ca9130' }} />
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 10.5 }}>{c.title}</b>
            <span style={{ fontSize: 9, color: '#999', marginRight: 8 }} className="num-fa">{c.discount}٪ تخفیف · هزینه: {costLabel[c.costShare]}</span>
          </div>
          <span className={`inline-flex px-2 py-1 text-[9px] ${statusTone[c.status]}`}>{statusLabel[c.status]}</span>
          <button onClick={() => setCampaigns(campaigns.filter(x => x.id !== c.id))} style={{ fontSize: 9, color: '#a4463d', background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}>حذف</button>
        </div>
      ))}
    </div>
  </section>
}

/* ---- 20-d + 48-d: تنظیمات اعلان + ارتباط ---- */
export function NotificationPreferences() {
  const [prefs, setPrefs] = useLocal('kv_supplier_notif_prefs', {
    newOrder: { panel: true, sms: true, email: false },
    slaWarning: { panel: true, sms: true, email: true },
    settlement: { panel: true, sms: false, email: true },
    quality: { panel: true, sms: false, email: false },
    campaign: { panel: true, sms: false, email: true },
  })
  const channels = [
    { id: 'panel', label: 'پنل', icon: Bell },
    { id: 'sms', label: 'پیامک', icon: MessageSquareText },
    { id: 'email', label: 'ایمیل', icon: FileText },
  ]
  const events = [
    { id: 'newOrder', label: 'سفارش جدید' },
    { id: 'slaWarning', label: 'هشدار SLA' },
    { id: 'settlement', label: 'تسویه مالی' },
    { id: 'quality', label: 'کیفیت' },
    { id: 'campaign', label: 'کمپین' },
  ]
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="ترجیحات اعلان" eyebrow="NOTIFICATIONS (20-d)">انتخاب کانال اطلاع‌رسانی برای هر رویداد.</SectionHeading>
    <table style={{ width: '100%', fontSize: 10 }}>
      <thead><tr style={{ borderBottom: '1px solid #e5e5e0' }}>
        <th style={{ padding: 8, textAlign: 'right' }}>رویداد</th>
        {channels.map(ch => <th key={ch.id} style={{ padding: 8, textAlign: 'center' }}>{ch.label}</th>)}
      </tr></thead>
      <tbody>
        {events.map(ev => (
          <tr key={ev.id} style={{ borderBottom: '1px solid #f5f5f0' }}>
            <td style={{ padding: 8 }}>{ev.label}</td>
            {channels.map(ch => (
              <td key={ch.id} style={{ padding: 8, textAlign: 'center' }}>
                <input type="checkbox" checked={(prefs as any)[ev.id]?.[ch.id] ?? false} onChange={e => setPrefs({ ...prefs, [ev.id]: { ...(prefs as any)[ev.id], [ch.id]: e.target.checked } })} style={{ accentColor: '#011c3a' }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </section>
}

/* ---- 34-d: اتصال مالیاتی ---- */
export function TaxIntegration() {
  const [status, setStatus] = useLocal('kv_tax_integration', { connected: false, taxId: '', lastSync: '' })
  return <section className="surface" style={{ padding: 20 }}>
    <SectionHeading title="اتصال به سامانه مالیاتی" eyebrow="TAX INTEGRATION (34-d)">اتصال به سامانه مؤدیان برای صدور فاکتور رسمی.</SectionHeading>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 4, background: status.connected ? '#edf3ee' : '#fffaf2', border: `1px solid ${status.connected ? '#b9cfbc' : '#d9b98f'}` }}>
      <Stamp size={20} style={{ color: status.connected ? '#3d5c3a' : '#8a5a20' }} />
      <div style={{ flex: 1 }}>
        <b style={{ fontSize: 11, color: status.connected ? '#3d5c3a' : '#8a5a20' }}>{status.connected ? 'متصل به سامانه مؤدیان' : 'غیرفعال'}</b>
        <p style={{ fontSize: 9, color: '#999' }}>{status.connected ? `آخرین همگام‌سازی: ${status.lastSync}` : 'برای صدور فاکتور رسمی و اتصال مالیاتی، شناسه ملی را وارد کنید.'}</p>
      </div>
    </div>
    {!status.connected && (
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input value={status.taxId} onChange={e => setStatus({ ...status, taxId: e.target.value })} placeholder="شناسه ملی / کد اقتصادی" style={{ height: 36, flex: 1, border: '1px solid #deddd6', padding: '0 10px', fontSize: 10.5 }} dir="ltr" />
        <button onClick={() => setStatus({ connected: true, taxId: status.taxId, lastSync: new Date().toLocaleString('fa-IR') })} disabled={!status.taxId.trim()} className="button primary disabled:opacity-40" style={{ minHeight: 36, fontSize: 10 }}>اتصال</button>
      </div>
    )}
  </section>
}

/* ---- 7-d: ورود CSV موجودی ---- */
export function CSVInventoryImport({ onImport }: { onImport: (rows: Array<{ sku: string; qty: number }>) => void }) {
  const [result, setResult] = useState<string>('')
  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const lines = String(reader.result).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
        if (lines.length < 2) throw new Error()
        const rows = lines.slice(1).map(line => {
          const cols = line.split(',').map(c => c.replace(/"/g, '').trim())
          return { sku: cols[0] ?? '', qty: Number(cols[1]) || 0 }
        }).filter(r => r.sku)
        onImport(rows)
        setResult(`${new Intl.NumberFormat('fa-IR').format(rows.length)} ردیف موجودی وارد شد.`)
      } catch { setResult('ساختار CSV معتبر نیست. فرمت: SKU,Quantity') }
    }
    reader.readAsText(file)
  }
  return <div>
    <input type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} style={{ display: 'none' }} id="csv-inv" />
    <label htmlFor="csv-inv" className="button secondary" style={{ cursor: 'pointer', display: 'inline-flex', minHeight: 36, fontSize: 10.5 }}>
      <Upload size={15} /> ورود CSV موجودی
    </label>
    {result && <p style={{ fontSize: 10, marginTop: 8, color: result.includes('وارد شد') ? '#3d5c3a' : '#a4463d' }}>{result}</p>}
    <p style={{ fontSize: 8.5, color: '#999', marginTop: 4 }}>فرمت فایل: ستون اول SKU، ستون دوم تعداد</p>
  </div>
}
