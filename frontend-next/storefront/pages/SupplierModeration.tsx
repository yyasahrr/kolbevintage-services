'use client'

/**
 * بازبینیِ کانونیکالِ محصولِ تأمین‌کننده (ادمین) — فاز ۶.۷.
 *
 * جایگزینِ پنلِ قدیمیِ «کاتالوگ تأمین‌کنندگان» است که وضعیت‌های
 * `draft/submitted/approved/rejected` را **در مرورگر می‌ساخت** و با یک `select`
 * عوض می‌کرد؛ آن وضعیت‌ها هیچ مقصدِ سروری نداشتند.
 *
 * قواعد:
 *  - تنها منبعِ حقیقت، `supplier_product_submission` است: `reviews.list()` و
 *    `reviews.get()` از مرزِ مشترکِ تأمین‌کننده.
 *  - ادمین **کلِ** گراف را پیش از تأیید می‌بیند؛ هیچ دادهٔ تجاریِ پنهانی نیست.
 *  - فقط actionهایی که واقعاً در بک‌اند هستند: approve-new، approve-existing،
 *    reject. «درخواستِ اصلاح» action جداگانه‌ای در سرور نیست، پس ساخته نمی‌شود؛
 *    یادداشتِ رد همان بازخوردِ اصلاح است و صادقانه نوشته شده.
 *  - پس از هر action، فهرست/جزئیات **از سرور** تازه می‌شود؛ وضعیتِ محلی
 *    جابه‌جا نمی‌شود.
 *  - `approveAsExisting` نیازمندِ انتخابِ صریحِ محصولِ کانونیکال است؛ هیچ
 *    تطبیقِ فازی در مرورگر انجام نمی‌شود.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupplierApi } from '@shared/supplier/client'
import { createApiClient } from '@shared/http/client'
import { createSupplierApi } from '@shared/supplier/client'
import type { SupplierSubmissionReview } from '@shared/supplier/contracts'
import { MOQ_UNIT_LABELS_FA, PACKAGE_TYPE_LABELS_FA, humanizeAttributeKey } from '@shared/supplier/product-graph'

/** وضعیت‌های واقعیِ `supplier_product_submission` (از `state-values.ts`). */
const SUBMISSION_STATUS_LABELS_FA: Record<string, string> = {
  pending_review: 'در انتظارِ بررسی',
  approved_new_product: 'تأیید شد — محصولِ تازه',
  approved_existing_product: 'تأیید شد — اتصال به محصولِ موجود',
  rejected: 'رد شد',
  cancelled: 'لغو شد',
}

const RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-1'

function statusLabel(status: string): string {
  return SUBMISSION_STATUS_LABELS_FA[status] ?? status
}

function moqUnitLabel(unit: string | undefined | null): string {
  if (!unit) return '—'
  return MOQ_UNIT_LABELS_FA[unit as keyof typeof MOQ_UNIT_LABELS_FA] ?? unit
}

function packageTypeLabel(type: string | undefined | null): string {
  if (!type) return '—'
  return PACKAGE_TYPE_LABELS_FA[type as keyof typeof PACKAGE_TYPE_LABELS_FA] ?? type
}

function money(value: string | null | undefined): string {
  if (value == null || value === '') return '—'
  // پول رشتهٔ ده‌دهی می‌ماند؛ فقط جداکنندهٔ هزارگان اضافه می‌شود، هیچ گردکردنی نیست.
  return `${value.replace(/\B(?=(\d{3})+(?!\d))/g, '٬')} تومان`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fa-IR')
}

type Candidate = { id: string; name: string; sku?: string | null }

/** مرزِ پیش‌فرض: همان کلاینتِ مشترک، با کوکیِ جلسه. */
function defaultApi(): SupplierApi {
  return createSupplierApi(createApiClient())
}

/**
 * یک نمونهٔ **پایدار** در سطح ماژول.
 *
 * چرا این لازم است؟ پارامترِ پیش‌فرضِ جاوااسکریپت در **هر** فراخوانی تابع
 * ارزیابی می‌شود؛ یعنی `{ api = defaultApi() }` در هر render یک کلاینتِ تازه
 * می‌ساخت. چون `loadList` به `[api, statusFilter]` وابسته است و `useEffect`
 * به `[loadList]`، هر setState یک render و هر render یک کلاینتِ جدید و در نتیجه
 * یک واکشیِ دوباره تولید می‌کرد: حلقهٔ بی‌پایان.
 *
 * اندازه‌گیری پیش از اصلاح: **۵۱۷ درخواستِ فهرست در ~۹.۵ ثانیه** (~۵۴ در ثانیه)
 * — یعنی صفحه هم API خودش را زیر بار می‌برد و هم چون DOM مدام بازسازی می‌شد،
 * کلیک روی ردیف‌ها هرگز نمی‌نشست.
 */
const SHARED_DEFAULT_API: SupplierApi = defaultApi()

export function SupplierModerationPage({ api = SHARED_DEFAULT_API }: { api?: SupplierApi }) {
  const [statusFilter, setStatusFilter] = useState<string>('pending_review')
  const [submissions, setSubmissions] = useState<SupplierSubmissionReview[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(true)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupplierSubmissionReview | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const [confirm, setConfirm] = useState<null | 'new' | 'existing' | 'reject'>(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishNotice, setPublishNotice] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [chosenProductId, setChosenProductId] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setListBusy(true)
    setListError(null)
    const result = await api.reviews.list({ status: statusFilter || undefined })
    setListBusy(false)
    if (result.ok) {
      setSubmissions(result.data)
    } else {
      // شکست هرگز به «فهرستِ خالی» تبدیل نمی‌شود.
      setSubmissions(null)
      setListError(result.error.message || 'فهرستِ پیشنهادها خوانده نشد')
    }
  }, [api, statusFilter])

  useEffect(() => {
    void loadList()
  }, [loadList])

  /**
   * `resetFeedback` پیش‌فرض روشن است: بازکردنِ یک پیشنهادِ تازه باید فرم و
   * پیام‌ها را صفر کند. اما **تازه‌سازیِ پس از action** باید نتیجه را نگه دارد،
   * وگرنه موفقیت یا CONFLICT همان لحظه پاک می‌شود و ادمین هیچ بازخوردی
   * نمی‌بیند.
   */
  const loadDetail = useCallback(
    async (id: string, options: { resetFeedback?: boolean } = {}) => {
      setOpenId(id)
      setDetailBusy(true)
      setDetailError(null)
      if (options.resetFeedback !== false) {
        setActionError(null)
        setActionNotice(null)
        setConfirm(null)
        setNote('')
        setChosenProductId(null)
        setCandidates(null)
        setSearch('')
      }
      const result = await api.reviews.get(id)
      setDetailBusy(false)
      if (result.ok) setDetail(result.data)
      else {
        setDetail(null)
        setDetailError(result.error.message || 'جزئیاتِ پیشنهاد خوانده نشد')
      }
    },
    [api],
  )

  const runSearch = useCallback(async () => {
    if (search.trim().length < 2) return
    setSearchBusy(true)
    setSearchError(null)
    // `finally` حیاتی است: اگر هر خطای ناهمگامی رخ دهد، بی‌آن‌که وضعیتِ
    // «در حالِ جست‌وجو…» را رها کند، آن را پاک می‌کند و خطا را صادقانه نشان می‌دهد.
    try {
      const result = await api.catalogSearch.products(search.trim())
      if (result.ok) {
        setCandidates(result.data)
      } else {
        setCandidates(null)
        setSearchError(result.error.message || 'جست‌وجوی محصولِ کانونیکال ناموفق بود')
      }
    } catch (error) {
      setCandidates(null)
      setSearchError(error instanceof Error ? error.message : 'جست‌وجوی محصولِ کانونیکال ناموفق بود')
    } finally {
      setSearchBusy(false)
    }
  }, [api, search])

  /** پس از هر action فقط سرور تصمیم می‌گیرد چه اتفاقی افتاده است. */
  const refreshAfterAction = useCallback(async () => {
    await loadList()
    if (openId) await loadDetail(openId, { resetFeedback: false })
  }, [loadList, loadDetail, openId])

  const act = useCallback(
    async (kind: 'new' | 'existing' | 'reject') => {
      if (!openId) return
      setActionBusy(true)
      setActionError(null)
      setActionNotice(null)
      const result =
        kind === 'new'
          ? await api.reviews.approveAsNew(openId, note || undefined)
          : kind === 'existing'
            ? await api.reviews.approveAsExisting(openId, chosenProductId ?? '', note || undefined)
            : await api.reviews.reject(openId, note);
      setActionBusy(false)
      if (result.ok) {
        setConfirm(null)
        setActionNotice(
          kind === 'reject'
            ? 'پیشنهاد رد شد؛ یادداشت برای تأمین‌کننده ثبت شد.'
            : kind === 'new'
              ? 'محصولِ کانونیکالِ تازه ساخته شد.'
              : 'پیشنهاد به محصولِ کانونیکالِ انتخاب‌شده متصل شد.',
        )
        await refreshAfterAction()
      } else {
        // از جمله CONFLICT وقتی ادمینِ دیگری قبلاً بررسی کرده است.
        setActionError(result.error.message || 'عملیات انجام نشد')
        await refreshAfterAction()
      }
    },
    [api, openId, note, chosenProductId, refreshAfterAction],
  )

  /**
   * انتشارِ محصولِ کانونیکال در کانالِ عمده‌فروشی.
   *
   * تأیید، محصول را `approved` می‌کند؛ مرورِ عمده‌فروشی فقط `published` را نشان
   * می‌دهد. این کنش همان `POST /catalog/products/:id/status` واقعی است تا
   * زنجیرهٔ «تأمین‌کننده → تأییدِ ادمین → کاتالوگِ عمده» در UI بن‌بست نشود.
   * نتیجه از سرور بازخوانی می‌شود و هیچ وضعیتی در مرورگر ساخته نمی‌شود.
   */
  const publishProduct = useCallback(async () => {
    const productId = detail?.approvedProductId
    if (!productId) return
    setPublishBusy(true)
    setPublishError(null)
    setPublishNotice(null)
    const result = await api.catalogSearch.transition(productId, 'published')
    setPublishBusy(false)
    if (result.ok) {
      setPublishNotice('محصول در کانالِ عمده‌فروشی منتشر شد.')
    } else {
      setPublishError(result.error.message || 'انتشار انجام نشد')
    }
    await loadDetail(openId ?? '', { resetFeedback: false })
  }, [api, detail?.approvedProductId, loadDetail, openId])

  const rows = useMemo(() => submissions ?? [], [submissions])
  const chosen = candidates?.find(item => item.id === chosenProductId) ?? null

  return (
    <section aria-labelledby="moderation-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] tracking-[0.24em] text-neutral-400">SUPPLIER PRODUCT MODERATION</p>
          <h2 id="moderation-title" className="mt-1 text-[17px] font-medium">
            بازبینیِ محصولِ تأمین‌کنندگان
          </h2>
          <p className="mt-1 max-w-2xl text-[10.5px] text-neutral-500">
            فهرست و جزئیات مستقیماً از جدولِ پیشنهادها خوانده می‌شود. ادمین پیش از تأیید کلِ گرافِ
            تجاری (قیمت، MOQ، سری/بسته، پله‌های قیمت، موجودی و رسانه) را می‌بیند.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] text-neutral-500">
          وضعیت
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
            className={`h-9 border border-neutral-300 bg-white px-2 text-[10.5px] ${RING}`}
          >
            <option value="pending_review">در انتظارِ بررسی</option>
            <option value="approved_new_product">تأییدشده — محصولِ تازه</option>
            <option value="approved_existing_product">تأییدشده — محصولِ موجود</option>
            <option value="rejected">ردشده</option>
            <option value="">همه</option>
          </select>
        </label>
      </div>

      {listError ? (
        <div role="alert" className="border border-red-300 bg-red-50 p-4 text-[10.5px] text-red-800">
          <b>خواندنِ فهرست ناموفق بود.</b> {listError}
          <button type="button" onClick={() => void loadList()} className={`ms-3 underline underline-offset-4 ${RING}`}>
            تلاشِ دوباره
          </button>
        </div>
      ) : listBusy ? (
        <p className="border border-neutral-200 bg-white p-4 text-[10.5px] text-neutral-500" role="status">
          در حالِ خواندنِ پیشنهادها…
        </p>
      ) : rows.length === 0 ? (
        <p className="border border-neutral-200 bg-white p-6 text-center text-[10.5px] text-neutral-500">
          پیشنهادی با این وضعیت ثبت نشده است.
        </p>
      ) : (
        <div className="overflow-x-auto border border-neutral-200 bg-white">
          <table className="w-full min-w-[860px] text-right text-[10.5px]">
            <caption className="sr-only">فهرستِ پیشنهادهای محصولِ تأمین‌کننده</caption>
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                {['محصول', 'SKU پایه', 'واریانت', 'MOQ', 'قیمتِ عمده', 'وضعیت', 'ثبت', ''].map(head => (
                  <th key={head} scope="col" className="border-b p-3 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="p-3 font-medium">{row.product.name}</td>
                  <td className="p-3">
                    <span className="num-en" dir="ltr">
                      {row.commercial.sku || '—'}
                    </span>
                  </td>
                  <td className="p-3 num-fa">{row.variants.length.toLocaleString('fa-IR')}</td>
                  <td className="p-3">
                    <span className="num-fa">{(row.commercial.moq ?? 1).toLocaleString('fa-IR')}</span>{' '}
                    {moqUnitLabel(row.commercial.moqUnit)}
                  </td>
                  <td className="p-3 num-fa">{money(row.commercial.wholesalePrice)}</td>
                  <td className="p-3">{statusLabel(row.status)}</td>
                  <td className="p-3 num-fa">{formatDate(row.createdAt)}</td>
                  <td className="p-3 text-left">
                    <button
                      type="button"
                      onClick={() => void loadDetail(row.id)}
                      className={`underline underline-offset-4 ${RING}`}
                    >
                      بازبینی
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId ? (
        <div className="mt-6 border border-neutral-200 bg-white p-4" aria-live="polite">
          {detailBusy ? (
            <p className="text-[10.5px] text-neutral-500" role="status">
              در حالِ خواندنِ جزئیات…
            </p>
          ) : detailError ? (
            <p role="alert" className="text-[10.5px] text-red-700">
              <b>خواندنِ جزئیات ناموفق بود.</b> {detailError}
            </p>
          ) : detail ? (
            <SubmissionDetail
              detail={detail}
              actionBusy={actionBusy}
              actionError={actionError}
              actionNotice={actionNotice}
              confirm={confirm}
              setConfirm={setConfirm}
          publishBusy={publishBusy}
          publishError={publishError}
          publishNotice={publishNotice}
          onPublish={() => void publishProduct()}
              note={note}
              setNote={setNote}
              search={search}
              setSearch={setSearch}
              runSearch={runSearch}
              searchBusy={searchBusy}
              searchError={searchError}
              candidates={candidates}
              chosenProductId={chosenProductId}
              setChosenProductId={setChosenProductId}
              chosen={chosen}
              onAct={act}
              onClose={() => {
                setOpenId(null)
                setDetail(null)
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/* ── جزئیاتِ کاملِ پیشنهاد ─────────────────────────────────────────────────── */

function SubmissionDetail(props: {
  detail: SupplierSubmissionReview
  actionBusy: boolean
  actionError: string | null
  actionNotice: string | null
  confirm: null | 'new' | 'existing' | 'reject'
  setConfirm: (value: null | 'new' | 'existing' | 'reject') => void
  publishBusy: boolean
  publishError: string | null
  publishNotice: string | null
  onPublish: () => void
  note: string
  setNote: (value: string) => void
  search: string
  setSearch: (value: string) => void
  runSearch: () => void
  searchBusy: boolean
  searchError: string | null
  candidates: Candidate[] | null
  chosenProductId: string | null
  setChosenProductId: (value: string) => void
  chosen: Candidate | null
  onAct: (kind: 'new' | 'existing' | 'reject') => void
  onClose: () => void
}) {
  const { detail } = props
  const commercial = detail.commercial
  const productMedia = detail.media.filter(item => !item.variantSku)
  const variantMedia = new Map<string, number>()
  for (const item of detail.media) {
    if (item.variantSku) variantMedia.set(item.variantSku, (variantMedia.get(item.variantSku) ?? 0) + 1)
  }
  const attributes = Object.entries(detail.product.attributes ?? {})
  const canAct = detail.status === 'pending_review'
  const tiers = commercial.pricingTiers ?? []

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium">{detail.product.name}</h3>
          <p className="mt-1 text-[10px] text-neutral-500">
            <span className="num-en" dir="ltr">
              {detail.id}
            </span>{' '}
            · وضعیت: {statusLabel(detail.status)} · ثبت: <span className="num-fa">{formatDate(detail.createdAt)}</span>
          </p>
        </div>
        <button type="button" onClick={props.onClose} className={`border border-neutral-300 px-3 py-1.5 text-[10px] ${RING}`}>
          بستن
        </button>
      </div>

      {/* ── تأمین‌کننده و اطلاعاتِ پایه ───────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Block title="تأمین‌کننده و هویت">
          <Row label="شناسهٔ تأمین‌کننده" value={<span className="num-en" dir="ltr">{detail.supplierId}</span>} />
          <Row label="شناسهٔ فروشنده" value={<span className="num-en" dir="ltr">{detail.sellerId}</span>} />
          <Row label="ثبت‌کننده" value={<span className="num-en" dir="ltr">{detail.createdBy}</span>} />
          <Row
            label="محصولِ همسانِ پیشنهادیِ سرور"
            value={detail.matchedProductId ? <span className="num-en" dir="ltr">{detail.matchedProductId}</span> : 'سرور محصولِ همسانی پیشنهاد نکرده است'}
          />
          {detail.reviewedBy ? <Row label="بررسی‌کننده" value={<span className="num-en" dir="ltr">{detail.reviewedBy}</span>} /> : null}
          {detail.adminReviewNote ? <Row label="یادداشتِ بررسی" value={detail.adminReviewNote} /> : null}
        </Block>

        <Block title="اطلاعاتِ پایهٔ محصول">
          <Row label="نام" value={detail.product.name} />
          <Row label="slug" value={<span className="num-en" dir="ltr">{detail.product.slug}</span>} />
          <Row label="دسته" value={detail.product.categoryId ? <span className="num-en" dir="ltr">{detail.product.categoryId}</span> : '—'} />
          <Row
            label="برند"
            value={
              detail.product.brandId ? (
                <span className="num-en" dir="ltr">{detail.product.brandId}</span>
              ) : detail.product.proposedBrandId ? (
                <>برندِ پیشنهادی: <span className="num-en" dir="ltr">{detail.product.proposedBrandId}</span></>
              ) : (
                '—'
              )
            }
          />
          <Row label="توضیحات" value={detail.product.description || '—'} />
        </Block>
      </div>

      {/* ── ویژگی‌ها ──────────────────────────────────────────────────────── */}
      <Block title="ویژگی‌های محصول" className="mt-4">
        {attributes.length === 0 ? (
          <p className="text-[10px] text-neutral-500">ویژگی‌ای ثبت نشده است.</p>
        ) : (
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {attributes.map(([key, value]) => (
              <div key={key} className="border border-neutral-200 p-2">
                <dt className="text-[9.5px] text-neutral-400">{humanizeAttributeKey(key)}</dt>
                <dd className="mt-1 text-[10.5px]">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Block>

      {/* ── واریانت‌ها ────────────────────────────────────────────────────── */}
      <Block title={`واریانت‌ها (${detail.variants.length.toLocaleString('fa-IR')})`} className="mt-4">
        <div className="max-h-72 overflow-auto border border-neutral-200">
          <table className="w-full min-w-[720px] text-right text-[10px]">
            <caption className="sr-only">واریانت‌های پیشنهاد با صفات، موجودی و رسانه</caption>
            <thead className="sticky top-0 bg-neutral-50 text-neutral-500">
              <tr>
                {['SKU', 'صفات', 'وضعیت', 'موجودی', 'رسانه'].map(head => (
                  <th key={head} scope="col" className="border-b p-2 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.variants.map(variant => (
                <tr key={variant.sku} className="border-b border-neutral-100">
                  <td className="p-2">
                    <span className="num-en" dir="ltr">
                      {variant.sku}
                    </span>
                  </td>
                  <td className="p-2">
                    {Object.entries(variant.attributes ?? {}).length === 0
                      ? '—'
                      : Object.entries(variant.attributes ?? {})
                          .map(([key, value]) => `${humanizeAttributeKey(key)}: ${String(value)}`)
                          .join(' · ')}
                  </td>
                  <td className="p-2">{variant.status ?? 'active'}</td>
                  <td className="p-2 num-fa">
                    {variant.inventory?.onHand == null ? 'اعلام نشده' : variant.inventory.onHand.toLocaleString('fa-IR')}
                  </td>
                  <td className="p-2 num-fa">{(variantMedia.get(variant.sku) ?? 0).toLocaleString('fa-IR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      {/* ── رسانه ─────────────────────────────────────────────────────────── */}
      <Block title="رسانه" className="mt-4">
        {detail.media.length === 0 ? (
          <p className="text-[10px] text-neutral-500">رسانه‌ای ثبت نشده است.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {detail.media.map(item => (
              <li key={`${item.url}-${item.position ?? 0}`} className="w-28">
                <img src={item.url} alt="" className="h-20 w-28 border border-neutral-200 object-cover" />
                <p className="mt-1 text-[9px] text-neutral-500">
                  {item.variantSku ? (
                    <>
                      واریانتِ <span className="num-en" dir="ltr">{item.variantSku}</span>
                    </>
                  ) : (
                    'سطحِ محصول'
                  )}{' '}
                  · جایگاه <span className="num-fa">{(item.position ?? 0).toLocaleString('fa-IR')}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {productMedia.length > 0 ? (
          <p className="mt-2 text-[9.5px] text-neutral-400">
            <span className="num-fa">{productMedia.length.toLocaleString('fa-IR')}</span> مورد رسانهٔ سطحِ محصول؛ در
            تأییدِ «محصولِ موجود» این‌ها در لایهٔ پیشنهادِ فروشنده نگه داشته می‌شوند و رسانهٔ کانونیکِ محصول عوض
            نمی‌شود.
          </p>
        ) : null}
      </Block>

      {/* ── پیشنهادِ تجاری و MOQ ──────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Block title="پیشنهادِ تجاری و MOQ">
          <Row label="SKU تجاری" value={<span className="num-en" dir="ltr">{commercial.sku || '—'}</span>} />
          <Row label="قیمتِ عمده" value={<span className="num-fa">{money(commercial.wholesalePrice)}</span>} />
          <Row label="قیمتِ خرده" value={<span className="num-fa">{money(commercial.retailPrice)}</span>} />
          <Row label="واحدِ پول" value={commercial.currency ?? 'IRR'} />
          <Row
            label="MOQ"
            value={
              <>
                <span className="num-fa">{(commercial.moq ?? 1).toLocaleString('fa-IR')}</span> {moqUnitLabel(commercial.moqUnit)}{' '}
                <span className="text-neutral-400" dir="ltr">
                  ({commercial.moqUnit ?? 'PIECE'})
                </span>
              </>
            }
          />
          <Row label="نوعِ بسته" value={packageTypeLabel(commercial.packageType)} />
        </Block>

        <Block title="پله‌های قیمت">
          {tiers.length === 0 ? (
            <p className="text-[10px] text-neutral-500">پلهٔ قیمتی ثبت نشده است.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {tiers.map((tier, index) => (
                <li key={`${tier.minQuantity}-${index}`} className="flex justify-between gap-3 py-2 text-[10.5px]">
                  <span className="num-fa">
                    {(tier.minQuantity ?? 0).toLocaleString('fa-IR')}
                    {tier.maxQuantity == null ? '+' : `–${tier.maxQuantity.toLocaleString('fa-IR')}`} {moqUnitLabel(tier.moqUnit)}
                  </span>
                  <span className="num-fa">{money(tier.unitPrice)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      {/* ── سری / بسته‌ها ─────────────────────────────────────────────────── */}
      <Block title="سری / بسته‌ها" className="mt-4">
        {detail.packageTotals.length === 0 ? (
          <p className="text-[10px] text-neutral-500">بسته‌ای ثبت نشده است.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {detail.packageTotals.map(pkg => (
              <div key={pkg.name} className="border border-neutral-200 p-3">
                <p className="text-[11px] font-medium">{pkg.name}</p>
                <p className="mt-1 text-[9.5px] text-neutral-500">
                  {packageTypeLabel(pkg.packageType)} · مجموع:{' '}
                  <span className="num-fa">{pkg.totalPieces.toLocaleString('fa-IR')}</span> قطعه
                </p>
                <ul className="mt-2 divide-y divide-neutral-100">
                  {pkg.items.map(item => (
                    <li key={item.sku} className="flex justify-between gap-3 py-1.5 text-[10px]">
                      <span className="num-en" dir="ltr">
                        {item.sku}
                      </span>
                      <span className="num-fa">
                        × {(item.quantity ?? 0).toLocaleString('fa-IR')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Block>

      {/* ── اقدام‌ها ──────────────────────────────────────────────────────── */}
      <Block title="اقدام" className="mt-4">
        {!canAct ? (
          <div className="space-y-3">
            <p className="text-[10.5px] text-neutral-500">
              این پیشنهاد پیش‌تر بررسی شده است ({statusLabel(detail.status)}). برای جلوگیری از تکرار، اقدامِ تازه‌ای
              ممکن نیست — وضعیت از سرور خوانده می‌شود.
            </p>
            {detail.status === 'approved_new_product' && detail.approvedProductId ? (
              <div className="border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[10.5px] font-medium">انتشار در کانالِ عمده‌فروشی</p>
                <p className="mt-1 text-[10.5px] text-neutral-500">
                  محصولِ ساخته‌شده اکنون «تأییدشده» است، ولی کاتالوگِ عمده فقط محصولِ «منتشرشده» را نشان می‌دهد.
                  تا انتشار، خریدارانِ VIP آن را نمی‌بینند.
                </p>
                <div dir="ltr" className="mt-1 text-[10.5px] text-neutral-500">{detail.approvedProductId}</div>
                <button
                  type="button"
                  disabled={props.publishBusy}
                  onClick={props.onPublish}
                  className={`mt-2 bg-[#011c3a] px-4 py-2 text-[10.5px] font-medium text-white transition hover:bg-[#0a2c55] disabled:opacity-50 ${RING}`}
                >
                  {props.publishBusy ? 'در حالِ انتشار…' : 'انتشارِ محصول'}
                </button>
                {props.publishNotice ? <p role="status" className="mt-2 text-[10.5px] text-emerald-700">{props.publishNotice}</p> : null}
                {props.publishError ? <p role="alert" className="mt-2 text-[10.5px] text-red-700">{props.publishError}</p> : null}
              </div>
            ) : null}
          </div>
        ) : props.confirm === null ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={props.actionBusy}
              onClick={() => props.setConfirm('new')}
              className={`bg-[#011c3a] px-4 py-2 text-[10.5px] font-medium text-white transition hover:bg-[#0a2c55] disabled:opacity-50 ${RING}`}
            >
              تأیید به‌عنوانِ محصولِ تازه
            </button>
            <button
              type="button"
              disabled={props.actionBusy}
              onClick={() => props.setConfirm('existing')}
              className={`border border-[#011c3a] px-4 py-2 text-[10.5px] font-medium text-[#011c3a] transition hover:bg-[#f2f5f8] disabled:opacity-50 ${RING}`}
            >
              اتصال به محصولِ موجود
            </button>
            <button
              type="button"
              disabled={props.actionBusy}
              onClick={() => props.setConfirm('reject')}
              className={`border border-red-300 px-4 py-2 text-[10.5px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50 ${RING}`}
            >
              ردِ پیشنهاد
            </button>
          </div>
        ) : (
          <div className="border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-[10.5px] font-medium">
              {props.confirm === 'new'
                ? 'یک محصول canonical جدید ایجاد می‌شود.'
                : props.confirm === 'existing'
                  ? 'این پیشنهاد به محصولِ انتخاب‌شده متصل می‌شود؛ محصولِ تازه‌ای ساخته نمی‌شود.'
                  : 'پیشنهاد رد می‌شود و یادداشتِ شما به‌عنوانِ بازخوردِ اصلاح برای تأمین‌کننده ثبت می‌شود.'}
            </p>

            {props.confirm === 'existing' ? (
              <div className="mt-3">
                <label className="block text-[10px] text-neutral-500">
                  جست‌وجوی محصولِ کانونیکال (نام)
                  <span className="mt-1 flex gap-2">
                    <input
                      value={props.search}
                      onChange={event => props.setSearch(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') props.runSearch()
                      }}
                      className={`h-9 w-full max-w-sm border border-neutral-300 bg-white px-2 text-[10.5px] ${RING}`}
                      placeholder="پیراهن لینن"
                    />
                    <button
                      type="button"
                      onClick={props.runSearch}
                      disabled={props.searchBusy}
                      className={`h-9 border border-neutral-300 bg-white px-3 text-[10px] disabled:opacity-50 ${RING}`}
                    >
                      {props.searchBusy ? 'در حالِ جست‌وجو…' : 'جست‌وجو'}
                    </button>
                  </span>
                </label>
                {props.searchError ? (
                  <p role="alert" className="mt-2 text-[10px] text-red-700">
                    {props.searchError}
                  </p>
                ) : null}
                {props.candidates ? (
                  props.candidates.length === 0 ? (
                    <p className="mt-2 text-[10px] text-neutral-500">محصولی با این نام پیدا نشد.</p>
                  ) : (
                    <ul className="mt-2 max-h-56 divide-y divide-neutral-100 overflow-auto border border-neutral-200 bg-white">
                      {props.candidates.map(item => (
                        <li key={item.id}>
                          <label className="flex items-center gap-2 p-2 text-[10.5px]">
                            <input
                              type="radio"
                              name="canonical-product"
                              checked={props.chosenProductId === item.id}
                              onChange={() => props.setChosenProductId(item.id)}
                              className="accent-[#011c3a]"
                            />
                            <span className="font-medium">{item.name}</span>
                            <span className="num-en text-neutral-400" dir="ltr">
                              {item.sku ?? item.id}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
                {props.chosen ? (
                  <p className="mt-2 text-[10px] text-[#011c3a]">
                    مقصد: {props.chosen.name}{' '}
                    <span className="num-en" dir="ltr">
                      ({props.chosen.id})
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}

            <label className="mt-3 block text-[10px] text-neutral-500">
              یادداشتِ بررسی
              {props.confirm === 'reject' ? ' (الزامی)' : ' (اختیاری)'}
              <textarea
                value={props.note}
                onChange={event => props.setNote(event.target.value)}
                rows={2}
                required={props.confirm === 'reject'}
                className={`mt-1 w-full border border-neutral-300 bg-white p-2 text-[10.5px] ${RING}`}
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  props.actionBusy ||
                  (props.confirm === 'existing' && !props.chosenProductId) ||
                  (props.confirm === 'reject' && props.note.trim().length === 0)
                }
                onClick={() => props.onAct(props.confirm as 'new' | 'existing' | 'reject')}
                className={`bg-[#011c3a] px-4 py-2 text-[10.5px] font-medium text-white transition hover:bg-[#0a2c55] disabled:opacity-50 ${RING}`}
              >
                {props.actionBusy ? 'در حالِ ثبت…' : 'ثبتِ قطعی'}
              </button>
              <button
                type="button"
                disabled={props.actionBusy}
                onClick={() => props.setConfirm(null)}
                className={`border border-neutral-300 bg-white px-4 py-2 text-[10.5px] disabled:opacity-50 ${RING}`}
              >
                انصراف
              </button>
            </div>
          </div>
        )}

        {props.actionError ? (
          <p role="alert" className="mt-3 border border-red-300 bg-red-50 p-2 text-[10.5px] text-red-800">
            <b>انجام نشد.</b> {props.actionError}
          </p>
        ) : null}
        {props.actionNotice ? (
          <p role="status" className="mt-3 border border-emerald-300 bg-emerald-50 p-2 text-[10.5px] text-emerald-800">
            {props.actionNotice} نتیجهٔ نهایی از سرور خوانده شد.
          </p>
        ) : null}
      </Block>
    </div>
  )
}

function Block({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-neutral-200 bg-white p-3 ${className}`}>
      <h4 className="mb-2 text-[11px] font-medium text-neutral-700">{title}</h4>
      {children}
    </section>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-neutral-100 py-1.5 text-[10.5px] last:border-0">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="min-w-0 text-left">{value}</dd>
    </div>
  )
}

export default SupplierModerationPage
