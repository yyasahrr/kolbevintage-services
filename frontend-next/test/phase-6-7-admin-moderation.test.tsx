// @vitest-environment jsdom
/**
 * آزمونِ رفتارِ صفحهٔ بازبینیِ محصولِ تأمین‌کننده (ادمین) — فاز ۶.۷.
 *
 * نکتهٔ اصلی: این صفحه هیچ وضعیتِ محلیِ ساختگی ندارد. همه‌چیز از
 * `reviews.list()`/`reviews.get()` می‌آید و پس از هر action نتیجه از **سرور**
 * دوباره خوانده می‌شود.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiClient } from '../shared/http/client'
import { createSupplierApi } from '../shared/supplier/client'
import type { FetchLike } from '../shared/http/types'
import SupplierModerationPage from '../storefront/pages/SupplierModeration'

const REVIEW = {
  id: 'sps_1',
  status: 'pending_review',
  supplierId: 'sup_1',
  sellerId: 'sel_1',
  createdBy: 'usr_1',
  reviewedBy: null,
  reviewedAt: null,
  adminReviewNote: null,
  matchedProductId: null,
  approvedProductId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  product: {
    name: 'پیراهن لینن تست E2E',
    slug: 'linen-e2e',
    description: 'پیراهن لینن سبک',
    brandId: 'brn_1',
    proposedBrandId: null,
    categoryId: 'cat_1',
    attributes: { material: 'لینن', origin: 'ایران' },
  },
  variants: [
    { sku: 'LINEN-BLACK-S', attributes: { color: 'مشکی', size: 'S' }, status: 'active', inventory: { onHand: 40 } },
    { sku: 'LINEN-BLACK-M', attributes: { color: 'مشکی', size: 'M' }, status: 'active', inventory: { onHand: 60 } },
    { sku: 'LINEN-BLACK-L', attributes: { color: 'مشکی', size: 'L' }, status: 'active', inventory: { onHand: 20 } },
  ],
  media: [
    { url: 'https://cdn.kolbe.test/main.jpg', type: 'image', position: 0, variantSku: null },
    { url: 'https://cdn.kolbe.test/black-s.jpg', type: 'image', position: 0, variantSku: 'LINEN-BLACK-S' },
  ],
  commercial: {
    sku: 'LINEN-SHIRT',
    wholesalePrice: '1250000',
    retailPrice: '1890000',
    currency: 'IRR',
    moq: 2,
    moqUnit: 'SERIES',
    packageType: 'SIZE_RUN',
    variantSku: 'LINEN-BLACK-S',
    packages: [],
    pricingTiers: [
      { minQuantity: 2, maxQuantity: 9, unitPrice: '1250000', moqUnit: 'SERIES' },
      { minQuantity: 10, maxQuantity: 49, unitPrice: '1180000', moqUnit: 'SERIES' },
      { minQuantity: 50, maxQuantity: null, unitPrice: '1090000', moqUnit: 'SERIES' },
    ],
  },
  packageTotals: [
    {
      name: 'سری سایزبندی S-L',
      packageType: 'SIZE_RUN',
      totalPieces: 6,
      items: [
        { sku: 'LINEN-BLACK-S', quantity: 2 },
        { sku: 'LINEN-BLACK-M', quantity: 2 },
        { sku: 'LINEN-BLACK-L', quantity: 2 },
      ],
    },
  ],
}

type Recorded = { method: string; path: string; body: unknown }

function boundary(options: {
  list?: { status?: number; body?: unknown }
  detail?: { status?: number; body?: unknown }
  action?: { status?: number; body?: unknown }
  search?: { status?: number; body?: unknown }
} = {}) {
  const recorded: Recorded[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = String(input).replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    recorded.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })

    const respond = (configured: { status?: number; body?: unknown } | undefined, fallback: unknown) =>
      new Response(JSON.stringify(configured?.body ?? fallback), {
        status: configured?.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })

    if (method === 'GET' && path === '/api/v1/catalog/supplier-submissions') return respond(options.list, [REVIEW])
    if (method === 'GET' && path === '/api/v1/catalog/supplier-submissions/sps_1') return respond(options.detail, REVIEW)
    if (method === 'GET' && path === '/api/v1/catalog/products') {
      return respond(options.search, [{ id: 'prod_existing', name: 'پیراهن لینن موجود', sku: 'PSKU-1' }])
    }
    if (method === 'POST' && path.includes('/approve-new')) return respond(options.action, { ...REVIEW, status: 'approved_new_product' })
    if (method === 'POST' && path.includes('/approve-existing')) return respond(options.action, { ...REVIEW, status: 'approved_existing_product' })
    if (method === 'POST' && path.includes('/reject')) return respond(options.action, { ...REVIEW, status: 'rejected' })

    return new Response(JSON.stringify({ error: 'NOT_FOUND', message: `${method} ${path}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchImpl })
  return { api: createSupplierApi(client), recorded }
}

function renderPage(options: Parameters<typeof boundary>[0] = {}) {
  const harness = boundary(options)
  const view = render(React.createElement(SupplierModerationPage, { api: harness.api }))
  return { ...view, recorded: harness.recorded }
}

async function openDetail() {
  await screen.findByText('پیراهن لینن تست E2E')
  fireEvent.click(screen.getByRole('button', { name: 'بازبینی' }))
  await waitFor(() => expect(screen.getByText('ویژگی‌های محصول')).toBeDefined())
}

afterEach(() => cleanup())

describe('بازبینیِ ادمین — فهرست', () => {
  it('فهرست را از سرور می‌خواند', async () => {
    const { recorded } = renderPage()
    await screen.findByText('پیراهن لینن تست E2E')
    expect(recorded.some(call => call.path === '/api/v1/catalog/supplier-submissions')).toBe(true)
    // خلاصهٔ MOQ با واحدِ واقعی، نه پیش‌فرض.
    expect(screen.getByText('سری')).toBeDefined()
  })

  it('پاسخِ خالی، حالتِ خالی نشان می‌دهد نه خطا', async () => {
    renderPage({ list: { body: [] } })
    await waitFor(() => expect(screen.getByText('پیشنهادی با این وضعیت ثبت نشده است.')).toBeDefined())
  })

  it('شکستِ سرور، خطا نشان می‌دهد نه فهرستِ خالی', async () => {
    renderPage({ list: { status: 403, body: { error: 'FORBIDDEN', message: 'دسترسی ندارید' } } })
    await waitFor(() => expect(screen.getByText('خواندنِ فهرست ناموفق بود.')).toBeDefined())
    expect(screen.getByText(/دسترسی ندارید/)).toBeDefined()
    expect(screen.queryByText('پیشنهادی با این وضعیت ثبت نشده است.')).toBeNull()
  })
})

describe('بازبینیِ ادمین — جزئیاتِ کاملِ گراف', () => {
  it('واریانت، موجودی، رسانه، سری و پله‌های قیمت را نشان می‌دهد', async () => {
    renderPage()
    await openDetail()

    // واریانت‌ها با SKU در لایهٔ LTR.
    // SKU هم در جدولِ واریانت، هم در برچسبِ رسانه و هم در قلمِ بسته هست.
    expect(screen.getAllByText('LINEN-BLACK-S').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('۴۰')).toBeDefined()

    // سری: ترکیب و مجموعِ قطعات، نه فقط نامِ enum.
    expect(screen.getByText('سری سایزبندی S-L')).toBeDefined()
    expect(screen.getByText('سری سایزبندی')).toBeDefined()
    expect(screen.getAllByText('× ۲')).toHaveLength(3) // سه قلمِ سری، هرکدام ×۲
    // «۶» به‌تنهایی با تاریخِ فارسی هم می‌خواند؛ پس دقیقاً همان جملهٔ مجموع.
    const totalNodes = screen.getAllByText((_content, element) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').includes('مجموع: ۶ قطعه'),
    )
    expect(totalNodes.length).toBeGreaterThan(0)

    // پله‌های قیمتِ دقیق، با پلهٔ بازِ ۵۰+.
    expect(screen.getByText(/۵۰\+/)).toBeDefined()
    // پول رشتهٔ ده‌دهی می‌ماند و فقط جداکنندهٔ هزارگان می‌گیرد؛ رقمِ فارسی
    // ساخته نمی‌شود تا مقدارِ قابلِ کپی/مقایسه حفظ شود.
    expect(screen.getAllByText('1٬250٬000 تومان').length).toBeGreaterThan(0)

    // MOQ=2 سری با مقدارِ کانونیکِ لاتین هم نشان داده می‌شود.
    expect(screen.getByText('(SERIES)')).toBeDefined()

    // رسانهٔ سطحِ محصول و رسانهٔ واریانت از هم جدا هستند.
    // برچسب‌ها داخلِ یک <p> ترکیبی هستند؛ پس با زیررشته می‌سنجیم.
    const mediaLabels = screen.getAllByText((_content, element) => {
      const text = (element?.textContent ?? '').replace(/\s+/g, ' ')
      return element?.tagName === 'P' && (text.includes('سطحِ محصول') || text.includes('واریانتِ LINEN-BLACK-S'))
    })
    expect(mediaLabels.length).toBeGreaterThanOrEqual(2)

    // ویژگی‌ها.
    expect(screen.getByText('لینن')).toBeDefined()
  })

  it('پیشنهادِ بررسی‌شده هیچ actionی نشان نمی‌دهد', async () => {
    renderPage({ list: { body: [{ ...REVIEW, status: 'approved_new_product' }] }, detail: { body: { ...REVIEW, status: 'approved_new_product' } } })
    await openDetail()
    expect(screen.getByText(/پیش‌تر بررسی شده است/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'تأیید به‌عنوانِ محصولِ تازه' })).toBeNull()
  })
})

describe('بازبینیِ ادمین — اقدام‌ها', () => {
  it('تأیید به‌عنوانِ محصولِ تازه با پیامِ صریح و تازه‌سازی از سرور', async () => {
    const { recorded } = renderPage()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'تأیید به‌عنوانِ محصولِ تازه' }))
    expect(screen.getByText('یک محصول canonical جدید ایجاد می‌شود.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'ثبتِ قطعی' }))

    await waitFor(() =>
      expect(recorded.some(call => call.method === 'POST' && call.path === '/api/v1/catalog/supplier-submissions/sps_1/approve-new')).toBe(true),
    )
    // پس از action، هم فهرست و هم جزئیات از سرور دوباره خوانده می‌شوند.
    await waitFor(() => expect(recorded.filter(call => call.method === 'GET' && call.path.endsWith('/sps_1')).length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(/محصولِ کانونیکالِ تازه ساخته شد/)).toBeDefined()
  })

  it('اتصال به محصولِ موجود نیازمندِ انتخابِ صریحِ محصول است', async () => {
    const { recorded } = renderPage()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'اتصال به محصولِ موجود' }))

    const submit = screen.getByRole('button', { name: 'ثبتِ قطعی' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('پیراهن لینن'), { target: { value: 'پیراهن لینن' } })
    fireEvent.click(screen.getByRole('button', { name: 'جست‌وجو' }))
    await screen.findByText('پیراهن لینن موجود')
    fireEvent.click(screen.getByRole('radio', { name: /پیراهن لینن موجود/ }))

    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() =>
      expect(
        recorded.some(
          call =>
            call.method === 'POST' &&
            call.path === '/api/v1/catalog/supplier-submissions/sps_1/approve-existing' &&
            (call.body as { productId?: string }).productId === 'prod_existing',
        ),
      ).toBe(true),
    )
  })

  it('ردِ پیشنهاد بدونِ یادداشت ممکن نیست', async () => {
    const { recorded } = renderPage()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'ردِ پیشنهاد' }))
    const submit = screen.getByRole('button', { name: 'ثبتِ قطعی' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/یادداشتِ بررسی/), { target: { value: 'عکسِ اصلی واضح نیست' } })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() =>
      expect(
        recorded.some(
          call =>
            call.method === 'POST' &&
            call.path === '/api/v1/catalog/supplier-submissions/sps_1/reject' &&
            (call.body as { note?: string }).note === 'عکسِ اصلی واضح نیست',
        ),
      ).toBe(true),
    )
  })

  it('تأییدِ دوباره فقط یک بار به سرور می‌رود (دکمه حینِ کار غیرفعال است)', async () => {
    const { recorded } = renderPage()
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'تأیید به‌عنوانِ محصولِ تازه' }))
    const submit = screen.getByRole('button', { name: /ثبتِ قطعی|در حالِ ثبت/ })
    fireEvent.click(submit)
    // کلیکِ دوم در همان لحظه.
    fireEvent.click(screen.getByRole('button', { name: /ثبتِ قطعی|در حالِ ثبت/ }))
    await waitFor(() => expect(screen.getByText(/محصولِ کانونیکالِ تازه ساخته شد/)).toBeDefined())
    const approvals = recorded.filter(call => call.method === 'POST' && call.path.endsWith('/approve-new'))
    expect(approvals).toHaveLength(1)
  })

  it('خطای CONFLICT سرور را با پیامِ خودش نشان می‌دهد', async () => {
    renderPage({ action: { status: 409, body: { error: 'SUBMISSION_NOT_PENDING', message: 'درخواست در انتظار بررسی نیست' } } })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'تأیید به‌عنوانِ محصولِ تازه' }))
    fireEvent.click(screen.getByRole('button', { name: 'ثبتِ قطعی' }))
    await waitFor(() => expect(screen.getByText('انجام نشد.')).toBeDefined())
    expect(screen.getByText(/درخواست در انتظار بررسی نیست/)).toBeDefined()
    // وضعیتِ محلیِ «موفق» ساخته نمی‌شود.
    expect(screen.queryByText(/محصولِ کانونیکالِ تازه ساخته شد/)).toBeNull()
  })

  it('خطای دسترسی (۴۰۳) را صادقانه نشان می‌دهد', async () => {
    renderPage({ action: { status: 403, body: { error: 'FORBIDDEN', message: 'اجازهٔ مدیریتِ کاتالوگ ندارید' } } })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'ردِ پیشنهاد' }))
    fireEvent.change(screen.getByLabelText(/یادداشتِ بررسی/), { target: { value: 'رد' } })
    fireEvent.click(screen.getByRole('button', { name: 'ثبتِ قطعی' }))
    await waitFor(() => expect(screen.getByText(/اجازهٔ مدیریتِ کاتالوگ ندارید/)).toBeDefined())
  })
})
