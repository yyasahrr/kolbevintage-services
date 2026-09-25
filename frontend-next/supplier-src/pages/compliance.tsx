'use client'

/**
 * انطباق، اسناد، توافق‌نامه و حساب بانکی (فاز ۶.۲).
 *
 * مالکیتِ دامنه: `compliance` (پروفایل/اسناد/توافق/holds/بانک/واجد شرایط بودن).
 * این صفحه **هیچ‌وقت** کلیدِ شیءٔ خصوصی را به‌عنوان URL عمومی نشان نمی‌دهد:
 * دانلود فقط از `POST /supplier/compliance/documents/:id/access` می‌آید که یک
 * دسترسیِ دارای مجوز/امضا با انقضا برمی‌گرداند.
 *
 * `:supplierId` از نشستِ سرور گرفته می‌شود، نه از ورودیِ مرورگر.
 */

import { Check, Download, FileText, RefreshCw, ShieldCheck, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ComplianceDocument } from '@shared/supplier/contracts'
import { formatDateTime, statusTone } from '@shared/supplier/present'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../hooks'
import { DataTable, Field, Notice, SectionHeading, StateView, Status, SubmitBar } from '../ui'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']

export function CompliancePage() {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const supplierId = portal.sessionState.status === 'authenticated' ? portal.sessionState.supplier?.supplierId : undefined

  const profile = useSupplierResource(() => portal.api.compliance.profile(supplierId!), [supplierId, version], { enabled: Boolean(supplierId) })
  const documents = useSupplierResource(() => portal.api.compliance.documents(supplierId!), [supplierId, version], {
    enabled: Boolean(supplierId),
    isEmpty: data => (data.documents ?? []).length === 0,
  })
  const holds = useSupplierResource(() => portal.api.compliance.holds(supplierId!), [supplierId, version], { enabled: Boolean(supplierId) })
  const bank = useSupplierResource(() => portal.api.compliance.bank(supplierId!), [supplierId, version], { enabled: Boolean(supplierId) })
  const eligibility = useSupplierResource(() => portal.api.compliance.eligibility(supplierId!), [supplierId, version], { enabled: Boolean(supplierId) })
  const agreement = useSupplierResource(() => portal.api.compliance.contractStatus(supplierId!), [supplierId, version], { enabled: Boolean(supplierId) })

  if (!supplierId) {
    return <Notice tone="warn" title="تأمین‌کننده‌ای در نشست شما ثبت نشده است">برای دیدن انطباق، باید عضو یک تأمین‌کننده باشید.</Notice>
  }

  const profileData = dataOrNull(profile.state)
  const documentRows = useMemo(() => dataOrNull(documents.state)?.documents ?? [], [documents.state])
  const holdRows = dataOrNull(holds.state)?.holds ?? []
  const bankData = dataOrNull(bank.state)?.current ?? null
  const eligibilityData = dataOrNull(eligibility.state)
  const agreementData = dataOrNull(agreement.state)
  const blockers = eligibilityData?.blockers ?? eligibilityData?.reasons ?? []

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">حساب کاربری / انطباق</p>
          <h1>انطباق و اسناد</h1>
          <p>پروفایل انطباق، اسناد، توافق‌نامه، حساب بانکی و وضعیت تسویه.</p>
        </div>
        <button type="button" className="button secondary" onClick={() => { profile.reload(); documents.reload(); holds.reload(); bank.reload(); eligibility.reload() }}>
          <RefreshCw size={15} />به‌روزرسانی
        </button>
      </div>

      <StateView state={eligibility.state} emptyLabel="وضعیت واجد شرایط بودن اعلام نشده است">
        <Notice tone={eligibilityData?.eligible ? 'info' : 'warn'} title={eligibilityData?.eligible ? 'واجد شرایط تسویه هستید' : 'تسویه فعلاً ممکن نیست'}>
          {blockers.length > 0 ? blockers.join(' · ') : 'سرور دلیلی اعلام نکرده است.'}
        </Notice>
      </StateView>

      <div className="compliance-grid">
        <section className="surface">
          <SectionHeading eyebrow="پروفایل" title="پروفایل انطباق" />
          <StateView state={profile.state} emptyLabel="پروفایلی ثبت نشده است" onRetry={profile.reload}>
            <dl className="detail-meta">
              <div><span>شناسهٔ تأمین‌کننده</span><b className="ltr-inline">{supplierId}</b></div>
              <div><span>وضعیت</span><Status tone={statusTone(String(profileData?.profile?.status ?? ''))}>{String(profileData?.profile?.status ?? '—')}</Status></div>
              <div><span>آخرین به‌روزرسانی</span><b>{formatDateTime(String(profileData?.profile?.updatedAt ?? ''))}</b></div>
            </dl>
          </StateView>
        </section>

        <section className="surface">
          <SectionHeading eyebrow="توافق‌نامه" title="وضعیت قرارداد" />
          <StateView state={agreement.state} emptyLabel="توافق‌نامهٔ فعالی اعلام نشده است">
            <p className="muted-line">
              {agreementData?.accepted ? 'توافق‌نامه پذیرفته شده است.' : 'پذیرش توافق‌نامه هنوز ثبت نشده است.'}
            </p>
            {agreementData?.published?.length ? (
              <ul className="notice-list">
                {agreementData.published.map(policy => (
                  <li key={policy.id}>
                    <FileText size={16} />
                    <div><b>{policy.title ?? policy.policyType ?? policy.id}</b><span>نسخهٔ {policy.version ?? '—'}</span></div>
                  </li>
                ))}
              </ul>
            ) : null}
          </StateView>
        </section>

        <section className="surface">
          <SectionHeading eyebrow="بانک" title="مقصد پرداخت" />
          <StateView state={bank.state} emptyLabel="مقصد بانکی ثبت نشده است">
            <dl className="detail-meta">
              <div><span>نوع مقصد</span><b>{bankData?.destinationKind ?? '—'}</b></div>
              <div><span>شماره</span><b className="ltr-inline">{bankData?.value ?? '—'}</b></div>
              <div><span>به نام</span><b>{bankData?.holderName ?? '—'}</b></div>
              <div><span>وضعیت</span><Status tone={statusTone(String(bankData?.status ?? ''))}>{String(bankData?.status ?? '—')}</Status></div>
            </dl>
          </StateView>
          <BankForm supplierId={supplierId} onSaved={bank.reload} />
        </section>

        <section className="surface">
          <SectionHeading eyebrow="مسدودی‌ها" title="Holdهای فعال" />
          <StateView state={holds.state} emptyLabel="مسدودی فعالی وجود ندارد">
            <ul className="notice-list">
              {holdRows.map(hold => (
                <li key={hold.id}>
                  <ShieldCheck size={16} />
                  <div><b>{hold.reason ?? 'مسدودی'}</b><span>{formatDateTime(hold.createdAt)}</span></div>
                  <Status tone="warning">{String(hold.status ?? '—')}</Status>
                </li>
              ))}
            </ul>
          </StateView>
        </section>
      </div>

      <section className="surface table-surface">
        <SectionHeading eyebrow="اسناد" title="اسناد انطباق" description="دسترسی به فایل فقط با مجوزِ صادرشده از سرور انجام می‌شود؛ کلیدِ ذخیره‌سازی خصوصی هرگز در مرورگر ظاهر نمی‌شود." />
        <StateView state={documents.state} emptyLabel="سندی بارگذاری نشده است" onRetry={documents.reload}>
          <DataTable
            columns={[
              { key: 'type', header: 'نوع سند', primary: true, render: row => row.documentType ?? '—' },
              { key: 'name', header: 'نام فایل', render: row => <span className="ltr-inline">{row.originalFilename ?? '—'}</span> },
              { key: 'uploaded', header: 'تاریخ', render: row => formatDateTime(row.uploadedAt) },
              { key: 'status', header: 'وضعیت', primary: true, render: row => <Status tone={statusTone(String(row.status ?? ''))}>{String(row.status ?? '—')}</Status> },
              { key: 'action', header: 'دسترسی', render: row => <DocumentAccessButton documentId={row.id} /> },
            ]}
            rows={documentRows}
            rowKey={row => row.id}
            busy={documents.busy}
          />
        </StateView>
        <DocumentUpload supplierId={supplierId} onUploaded={documents.reload} />
      </section>
    </>
  )
}

/**
 * دریافتِ دسترسیِ دارای مجوز. اگر سرور `url` ندهد، چیزی ساخته نمی‌شود و
 * وضعیتِ خطا/نامشخص به کاربر گفته می‌شود.
 */
function DocumentAccessButton({ documentId }: { documentId: string }) {
  const portal = useSupplierPortal()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = async () => {
    setBusy(true)
    setError(null)
    const result = await portal.api.compliance.documentAccess(documentId)
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const url = result.data.url
    if (!url) {
      setError('سرور نشانیِ دسترسی صادر نکرد.')
      return
    }
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="inline-action">
      <button type="button" className="button secondary" onClick={request} disabled={busy}>
        <Download size={14} />{busy ? 'در حال دریافت…' : 'دریافت امن'}
      </button>
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </div>
  )
}

function DocumentUpload({ supplierId, onUploaded }: { supplierId: string; onUploaded: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onUploaded })
  const [documentType, setDocumentType] = useState('business_license')
  const [file, setFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    if (!file) {
      setLocalError('فایل را انتخاب کنید.')
      return
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setLocalError('فقط PDF یا تصویر PNG/JPEG پذیرفته می‌شود.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError('حجم فایل نباید بیشتر از ۸ مگابایت باشد.')
      return
    }
    const base64 = await toBase64(file)
    if (!base64) {
      setLocalError('خواندن فایل ممکن نشد.')
      return
    }
    await mutation.run(() =>
      portal.api.compliance.uploadDocument(supplierId, {
        documentType,
        mimeType: file.type,
        contentBase64: base64,
        originalFilename: file.name,
      }),
    )
    setFile(null)
  }

  return (
    <form className="upload-form" onSubmit={submit} noValidate>
      <SectionHeading eyebrow="بارگذاری" title="افزودن سند جدید" />
      <div className="sp-grid">
        <Field label="نوع سند" required>
          <select value={documentType} onChange={event => setDocumentType(event.target.value)}>
            <option value="business_license">پروانهٔ کسب</option>
            <option value="tax_certificate">گواهی مالیاتی</option>
            <option value="quality_certificate">گواهی کیفیت</option>
            <option value="other">سایر</option>
          </select>
        </Field>
        <Field label="فایل" required hint="PDF / PNG / JPEG — حداکثر ۸ مگابایت">
          <input type="file" accept={ALLOWED_TYPES.join(',')} onChange={event => setFile(event.target.files?.[0] ?? null)} />
        </Field>
      </div>
      <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
        <button type="submit" className="button primary" disabled={mutation.busy}><Upload size={16} />بارگذاری</button>
      </SubmitBar>
      {mutation.message ? <Notice tone="info" title="بارگذاری شد"><Check size={14} /> {mutation.message}</Notice> : null}
    </form>
  )
}

function BankForm({ supplierId, onSaved }: { supplierId: string; onSaved: () => void }) {
  const portal = useSupplierPortal()
  const mutation = useSupplierMutation({ onSuccess: onSaved })
  const [destinationKind, setDestinationKind] = useState('IBAN')
  const [value, setValue] = useState('')
  const [holderName, setHolderName] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLocalError(null)
    const normalized = value.trim().replace(/\s+/g, '')
    if (normalized.length < 8) {
      setLocalError('شمارهٔ حساب/شبا را کامل وارد کنید.')
      return
    }
    await mutation.run(() => portal.api.compliance.submitBank(supplierId, { destinationKind, value: normalized, holderName: holderName.trim() || undefined }))
    setValue('')
    setHolderName('')
  }

  return (
    <form className="upload-form" onSubmit={submit} noValidate>
      <SectionHeading eyebrow="به‌روزرسانی" title="ثبت مقصد پرداخت" description="تأیید نهایی سمت سرور و تیم مالی انجام می‌شود." />
      <div className="sp-grid">
        <Field label="نوع مقصد" required>
          <select value={destinationKind} onChange={event => setDestinationKind(event.target.value)}>
            <option value="IBAN">شبا</option>
            <option value="CARD">کارت</option>
            <option value="ACCOUNT">شمارهٔ حساب</option>
          </select>
        </Field>
        <Field label="شماره" required>
          <input value={value} onChange={event => setValue(event.target.value)} className="ltr-inline" dir="ltr" required minLength={8} />
        </Field>
        <Field label="به نام">
          <input value={holderName} onChange={event => setHolderName(event.target.value)} />
        </Field>
      </div>
      <SubmitBar busy={mutation.busy} error={localError ?? mutation.error}>
        <button type="submit" className="button primary" disabled={mutation.busy}><Check size={16} />ثبت مقصد</button>
      </SubmitBar>
    </form>
  )
}

function toBase64(file: File): Promise<string | null> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : null)
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export function documentTypeLabel(document: ComplianceDocument): string {
  return document.documentType ?? 'سند'
}
