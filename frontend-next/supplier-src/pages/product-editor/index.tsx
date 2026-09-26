'use client'

/**
 * پوستهٔ ویرایشگرِ محصولِ تأمین‌کننده (L4).
 *
 * جایگزینِ فرمِ تختِ قدیمی است: ده بخشِ مجزا با ناوبریِ لنگری، یک draft واحد،
 * و یک ریلِ خلاصه در دسکتاپ. در موبایل تک‌ستونی می‌شود.
 *
 * قواعد:
 *  - هیچ fetch مستقیمی در کامپوننت نیست؛ همه از `portal.api` می‌آید.
 *  - تنها تبدیل، `buildStagedProduct(draft)` است؛ بازبینی و ارسال هر دو همان را
 *    می‌بینند.
 *  - خطاها از `AsyncState`/`ApiError` می‌آیند؛ شکست هرگز «خالی» یا «موفق»
 *    گزارش نمی‌شود.
 */

import { AlertTriangle, ArrowLeft, Check, Save, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { SupplierBrand, SupplierCategoryNode } from '@shared/supplier/contracts'
import { dataOrNull } from '@shared/ui/async-state'
import { useSupplierPortal } from '../../context'
import { usePortalDataVersion, useSupplierMutation, useSupplierResource } from '../../hooks'
import { Notice, StateView } from '../../ui'
import { useProductDraft } from './draft'
import {
  BasicInformationSection,
  CommercialSection,
  InventorySection,
  MediaSection,
  PackagesSection,
  PricingTiersSection,
  ReviewSection,
  SummaryRail,
  VariantsSection,
} from './sections'

const STEPS = [
  { id: 'basic', label: 'اطلاعاتِ پایه' },
  { id: 'media', label: 'رسانه' },
  { id: 'variants', label: 'واریانت‌ها' },
  { id: 'inventory', label: 'موجودی' },
  { id: 'commercial', label: 'پیشنهادِ تجاری و MOQ' },
  { id: 'packages', label: 'سری / بسته‌ها' },
  { id: 'tiers', label: 'پله‌های قیمت' },
  { id: 'review', label: 'بازبینی و ارسال' },
] as const

export function ProductEditorPage({ onDone }: { onDone: () => void }) {
  const portal = useSupplierPortal()
  const version = usePortalDataVersion()
  const controller = useProductDraft()
  const { draft, dispatch, issues, brokenReferences, staged } = controller

  const [step, setStep] = useState<string>('basic')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  /** نتیجهٔ واقعیِ سرور پس از ارسالِ موفق. */
  const [serverOutcome, setServerOutcome] = useState<{ id: string | null; status: string | null } | null>(null)

  const categories = useSupplierResource(() => portal.api.taxonomy.categories(), [version], { isEmpty: data => data.length === 0 })
  const brands = useSupplierResource(() => portal.api.taxonomy.brands(), [version], { isEmpty: data => data.length === 0 })

  const categoryTree = useMemo(() => dataOrNull(categories.state) ?? [], [categories.state])
  const brandList = useMemo(() => dataOrNull(brands.state) ?? [], [brands.state])

  const flatNames = useMemo(() => {
    const out: Array<{ id: string; name: string }> = []
    const walk = (nodes: SupplierCategoryNode[]) => {
      for (const node of nodes) {
        out.push({ id: node.id, name: node.name })
        if (node.children?.length) walk(node.children)
      }
    }
    walk(categoryTree)
    return out
  }, [categoryTree])

  const categoryName = flatNames.find(node => node.id === draft.categoryId)?.name ?? ''
  const brandName = (brandList as SupplierBrand[]).find(brand => brand.id === draft.brandId)?.name ?? ''

  const mutation = useSupplierMutation({
    onSuccess: () => {
      controller.markSubmitted()
    },
  })

  /** بارگذاریِ واقعیِ فایل از راهِ seamِ سرور؛ سپس نشانیِ برگشتی در draft می‌نشیند. */
  const handleUpload = useCallback(
    async (file: File, rowId: string) => {
      setUploading(true)
      setUploadError(null)
      try {
        const result = await portal.api.media.upload(file)
        if (result.ok) {
          dispatch({ type: 'patchMedia', rowId, patch: { url: result.data.url } })
        } else {
          setUploadError(result.error.message || 'بارگذاری ناموفق بود')
        }
      } finally {
        setUploading(false)
      }
    },
    [portal.api, dispatch],
  )

  const canSubmit = issues.length === 0 && brokenReferences.length === 0 && staged.name.length > 0 && staged.variants.length > 0

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) {
      setStep('review')
      return
    }
    // تنها بدنهٔ ممکن: همان چیزی که صفحهٔ بازبینی نشان داد.
    const result = await mutation.run(() => portal.api.products.submitStaged(staged))
    if (result.ok) {
      // وضعیت از **سرور** خوانده می‌شود؛ هرگز از stateِ مرورگر ساخته نمی‌شود.
      const data = result.data as { id?: string; status?: string } | undefined
      setServerOutcome({ id: data?.id ?? null, status: data?.status ?? null })
    }
  }

  const go = (id: string) => {
    setStep(id)
    if (typeof document !== 'undefined') {
      const target = document.getElementById(`spe-${id}`)
      // `scrollIntoView` در همهٔ محیط‌ها نیست (مثلاً jsdom)؛ نبودش نباید ناوبری را بشکند.
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="crumbs">کاتالوگ / ثبت محصول</p>
          <h1>ثبت محصول</h1>
          <p>کلِ گرافِ محصول را بسازید؛ ادمین دقیقاً همین را می‌بیند و تأیید می‌کند.</p>
        </div>
        <div className="sp-page-actions">
          <button type="button" className="button secondary" onClick={onDone}>
            <ArrowLeft size={15} />
            بازگشت به محصولات
          </button>
        </div>
      </div>

      {controller.hasPersistedDraft ? (
        <Notice tone="warn" title="پیش‌نویسِ ذخیره‌شدهٔ محلی">
          <p>
            یک پیش‌نویسِ ویرایش‌نشده در همین مرورگر هست. این فقط پیش‌نویس است، نه وضعیتِ ارسال یا
            تأیید.
          </p>
          <div className="spe-actions">
            <button type="button" className="button secondary" onClick={controller.restorePersisted}>
              <Save size={14} />
              بازیابیِ پیش‌نویس
            </button>
            <button type="button" className="button secondary" onClick={controller.discardPersisted}>
              شروعِ از نو
            </button>
          </div>
        </Notice>
      ) : null}

      <div className="spe-layout">
        <form className="spe-main" onSubmit={submit} noValidate>
          <StateView
            state={categories.state}
            emptyLabel="دسته‌بندی‌ای در سرور نیست"
            emptyDescription="برای انتخابِ دستهٔ کانونیک، باید دسته‌ای در کاتالوگ وجود داشته باشد."
            onRetry={categories.reload}
          >
            {step === 'basic' ? (
              <BasicInformationSection draft={draft} dispatch={dispatch} categories={categoryTree} brands={brandList} issues={issues} />
            ) : null}
            {step === 'media' ? (
              <MediaSection draft={draft} dispatch={dispatch} issues={issues} onUpload={handleUpload} uploading={uploading} uploadError={uploadError} />
            ) : null}
            {step === 'variants' ? <VariantsSection draft={draft} dispatch={dispatch} issues={issues} /> : null}
            {step === 'inventory' ? <InventorySection draft={draft} dispatch={dispatch} issues={issues} /> : null}
            {step === 'commercial' ? <CommercialSection draft={draft} dispatch={dispatch} issues={issues} /> : null}
            {step === 'packages' ? (
              <PackagesSection draft={draft} dispatch={dispatch} issues={issues} broken={brokenReferences} />
            ) : null}
            {step === 'tiers' ? <PricingTiersSection draft={draft} dispatch={dispatch} issues={issues} /> : null}
            {step === 'review' ? (
              <ReviewSection staged={staged} issues={issues} broken={brokenReferences} categoryName={categoryName} brandName={brandName} />
            ) : null}

            <div className="spe-footer">
              <div className="spe-footer-nav">
                <button
                  type="button"
                  className="button secondary"
                  disabled={step === STEPS[0].id}
                  onClick={() => go(STEPS[Math.max(0, STEPS.findIndex(item => item.id === step) - 1)]!.id)}
                >
                  بخشِ قبل
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={step === STEPS[STEPS.length - 1].id}
                  onClick={() => go(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex(item => item.id === step) + 1)]!.id)}
                >
                  بخشِ بعد
                </button>
              </div>

              {issues.length > 0 || brokenReferences.length > 0 ? (
                <p className="spe-rail-alert" role="status">
                  <AlertTriangle size={15} aria-hidden="true" />
                  پیش از ارسال، مواردِ مشخص‌شده را اصلاح کنید.
                </p>
              ) : null}

              <button type="submit" className="button primary spe-submit" disabled={mutation.busy || !canSubmit}>
                {mutation.busy ? <Upload size={16} /> : <Check size={16} />}
                ارسال برای بررسی
              </button>

              {mutation.error ? (
                <Notice tone="danger" title="ارسال ناموفق">
                  {/* پیامِ سرور نگه داشته می‌شود؛ stack trace نمایش داده نمی‌شود. */}
                  {mutation.error}
                </Notice>
              ) : null}
              {serverOutcome ? (
                <Notice tone="success" title="برای بررسی ارسال شد">
                  وضعیتِ برگشتی از سرور:{' '}
                  <b>{serverOutcome.status ? submissionStateLabel(serverOutcome.status) : 'نامشخص'}</b>
                  {serverOutcome.id ? (
                    <>
                      {' '}
                      — شناسهٔ پیشنهاد: <span className="ltr-inline">{serverOutcome.id}</span>
                    </>
                  ) : null}
                  . تأییدِ نهایی با تیم کلبه است؛ «ارسال‌شده» به معنای «تأییدشده» یا «منتشرشده» نیست.
                  <div className="spe-actions">
                    <button type="button" className="button secondary" onClick={onDone}>
                      مشاهدهٔ محصولات
                    </button>
                  </div>
                </Notice>
              ) : null}
            </div>
          </StateView>
        </form>

        <SummaryRail draft={draft} issues={issues} broken={brokenReferences} activeStep={step} steps={STEPS as unknown as Array<{ id: string; label: string }>} onGo={go} />
      </div>
    </>
  )
}

/** نگاشتِ کوتاهِ وضعیتِ پیشنهاد برای نمایشِ truthful پس از ارسال. */
export function submissionStateLabel(status: string): string {
  switch (status) {
    case 'pending_review':
      return 'در انتظارِ بررسی'
    case 'approved_new_product':
      return 'تأیید شد (محصولِ تازه)'
    case 'approved_existing_product':
      return 'تأیید شد (محصولِ موجود)'
    case 'rejected':
      return 'رد شد'
    case 'cancelled':
      return 'لغو شد'
    default:
      return status
  }
}
