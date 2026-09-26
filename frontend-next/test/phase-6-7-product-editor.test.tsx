// @vitest-environment jsdom
/**
 * آزمونِ رفتارِ ویرایشگرِ محصولِ تأمین‌کننده (L4).
 *
 * هدف: اثباتِ **رفتار و خروجیِ گراف**، نه جزئیاتِ پیاده‌سازی. مهم‌ترین ادعا:
 * آنچه کاربر در بازبینی می‌بیند دقیقاً همان بدنه‌ای است که به سرور می‌رود.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../shared/http/client'
import { createCapabilitySet } from '../shared/permissions/capabilities'
import { anonymousSession } from '../shared/session'
import { createSupplierApi } from '../shared/supplier/client'
import { toSupplierSession, type SupplierSession } from '../shared/supplier/session'
import type { FetchLike } from '../shared/http/types'
import { SupplierPortalProvider, useSupplierPortal } from '../supplier-src/context'
import { ProductEditorPage } from '../supplier-src/pages/product-editor'

type Recorded = { method: string; path: string; body: unknown; isFormData: boolean }

const CATEGORIES = [
  {
    id: 'cat_linen',
    name: 'پیراهن لینن',
    slug: 'linen-shirts',
    attributesSchema: { material: 'string', fit: { type: 'select', options: ['regular', 'slim'] } },
    children: [],
  },
]
const BRANDS = [{ id: 'brn_1', name: 'Kolbe Linen', slug: 'kolbe-linen', logoUrl: null }]

function boundary(options: { submitStatus?: number; submitBody?: unknown } = {}) {
  const recorded: Recorded[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
    recorded.push({ method, path, body: isFormData ? '[FormData]' : init?.body ? JSON.parse(String(init.body)) : undefined, isFormData })

    if (method === 'GET' && path === '/api/v1/catalog/categories') {
      return new Response(JSON.stringify(CATEGORIES), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'GET' && path === '/api/v1/catalog/brands') {
      return new Response(JSON.stringify(BRANDS), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && path === '/api/v1/catalog/supplier-submissions') {
      return new Response(JSON.stringify(options.submitBody ?? { id: 'sps_1', status: 'pending_review' }), {
        status: options.submitStatus ?? 201,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ error: 'NOT_FOUND', message: `${method} ${path}` }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchImpl })
  return { client, api: createSupplierApi(client), session: null as never, recorded }
}

function supplierSession(): SupplierSession {
  const base = toSupplierSession(anonymousSession())
  return {
    ...base,
    status: 'authenticated',
    user: { id: 'usr_1', email: 'ops@nilgoon.test', role: 'supplier', name: 'نرگس آذر', phone: null, totpEnabled: false },
    supplier: { supplierId: 'sup_1', displayName: 'نساجی نیلگون', legalName: 'نساجی و پوشاک نیلگون', status: 'approved' },
    capabilities: createCapabilitySet({ roles: ['supplier'], supplierId: 'sup_1', supplierCapabilities: [] }),
    fetchedAt: new Date().toISOString(),
    source: 'server',
    productionCapabilities: [],
    capabilitiesLoaded: true,
    capabilitiesError: null,
  }
}

function InitialSession({ session, children }: { session: SupplierSession; children: React.ReactNode }) {
  const portal = useSupplierPortal()
  React.useEffect(() => {
    portal.setSessionState(session)
  }, [portal, session])
  return React.createElement(React.Fragment, null, children)
}

function renderEditor(options: { submitStatus?: number; submitBody?: unknown } = {}) {
  const harness = boundary(options)
  const view = render(
    React.createElement(
      SupplierPortalProvider,
      { boundary: harness as never },
      React.createElement(InitialSession, { session: supplierSession() }, React.createElement(ProductEditorPage, { onDone: () => {} })),
    ),
  )
  return { ...view, recorded: harness.recorded }
}

async function gotoStep(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }))
  await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeDefined())
}

const setByLabel = (label: string | RegExp, value: string) => {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
}

afterEach(() => {
  cleanup()
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})

describe('ویرایشگرِ محصول — اطلاعاتِ پایه', () => {
  it('دسته‌ها را از سرور می‌گیرد، نه از فهرستِ سخت‌کدشده', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByRole('option', { name: 'پیراهن لینن' })).toBeDefined())
    // فهرستِ قدیمیِ سخت‌کدشده نباید وجود داشته باشد.
    expect(screen.queryByRole('option', { name: 'پوشاک مردانه' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'کفش و اکسسوری' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Kolbe Linen' })).toBeDefined()
  })

  it('ورودیِ ویژگی‌ها را از attributes_schema همان دسته می‌سازد', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByRole('option', { name: 'پیراهن لینن' })).toBeDefined())
    fireEvent.change(screen.getByLabelText(/دستهٔ کانونیک/), { target: { value: 'cat_linen' } })
    // `material` رشته‌ای و `fit` از نوع select با گزینه‌های واقعی.
    await waitFor(() => expect(screen.getByLabelText(/material/i)).toBeDefined())
    expect(screen.getByLabelText(/fit/i).tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'regular' })).toBeDefined()
  })

  it('بدونِ انتخابِ دسته، ویژگی‌های دلخواه همچنان قابلِ افزودن‌اند', async () => {
    renderEditor()
    await waitFor(() => expect(screen.getByRole('option', { name: 'پیراهن لینن' })).toBeDefined())
    setByLabel(/کلیدِ ویژگیِ دلخواه/, 'origin')
    setByLabel(/^مقدار$/, 'ایران')
    fireEvent.click(screen.getByRole('button', { name: /افزودن/ }))
    await waitFor(() => expect(screen.getByText('origin')).toBeDefined())
  })
})

describe('ویرایشگرِ محصول — واریانت‌ها و ماتریس', () => {
  it('افزودن و حذفِ واریانت کار می‌کند', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    await waitFor(() => expect(screen.getAllByLabelText(/^SKU/)).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'حذفِ واریانت' }))
    await waitFor(() => expect(screen.queryAllByLabelText(/^SKU/)).toHaveLength(0))
  })

  it('SKU تکراری را هم کنارِ ردیف و هم در خلاصه نشان می‌دهد', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    const skus = await screen.findAllByLabelText(/^SKU/)
    fireEvent.change(skus[0]!, { target: { value: 'linen-black-s' } })
    fireEvent.change(skus[1]!, { target: { value: 'LINEN-BLACK-S' } })
    // SKU نرمال‌سازی می‌شود، پس تکرار تشخیص داده می‌شود.
    // هم کنارِ ردیف و هم در خلاصهٔ بخش.
    await waitFor(() => expect(screen.getByText('SKU تکراری')).toBeDefined())
    expect(screen.getAllByText('این SKU تکراری است').length).toBeGreaterThanOrEqual(1)
    expect(skus[0]!.getAttribute('aria-invalid')).toBe('true')
  })

  it('ماتریس فقط خانه‌های صریحاً انتخاب‌شده را می‌سازد', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.change(screen.getByLabelText(/مقادیرِ ردیف/), { target: { value: 'Black, Cream' } })
    fireEvent.change(screen.getByLabelText(/مقادیرِ ستون/), { target: { value: 'S, M, L' } })
    fireEvent.change(screen.getByLabelText(/پیشوندِ SKU/), { target: { value: 'LINEN' } })

    const addButtons = await screen.findAllByRole('button', { name: /^\+ (S|M|L)$/ })
    expect(addButtons).toHaveLength(6)
    // فقط دو خانه انتخاب می‌کنیم؛ چهار ترکیبِ دیگر ساخته نمی‌شوند.
    fireEvent.click(addButtons[0]!)
    // پس از افزودن، گره‌های ماتریس بازسازی می‌شوند؛ باید دوباره پرس‌وجو کنیم.
    fireEvent.click((await screen.findAllByRole('button', { name: /^\+ (S|M|L)$/ }))[4]!)

    const skus = await screen.findAllByLabelText(/^SKU/)
    expect(skus).toHaveLength(2)
    expect(skus.map(input => (input as HTMLInputElement).value).sort()).toEqual(['LINEN-BLACK-S', 'LINEN-CREAM-M'])
  })
})

describe('ویرایشگرِ محصول — وابستگیِ SKU', () => {
  it('تغییرِ SKU، ارجاعِ رسانه و بسته را هم‌زمان به‌روز می‌کند', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    const [sku] = await screen.findAllByLabelText(/^SKU/)
    fireEvent.change(sku!, { target: { value: 'OLD-SKU' } })

    // یک بسته با همان SKU می‌سازیم.
    await gotoStep('سری / بسته‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ بسته/ }))
    await gotoStep('واریانت‌ها')
    await gotoStep('سری / بسته‌ها')
    const selects = await screen.findAllByLabelText(/افزودنِ واریانت به بسته/)
    fireEvent.change(selects[0]!, { target: { value: 'OLD-SKU' } })
    await waitFor(() => expect(screen.getByRole('rowheader', { name: 'OLD-SKU' })).toBeDefined())

    // حالا SKU را عوض می‌کنیم؛ قلمِ بسته باید خودش به‌روز شود.
    await gotoStep('واریانت‌ها')
    const [skuInput] = await screen.findAllByLabelText(/^SKU/)
    fireEvent.change(skuInput!, { target: { value: 'NEW-SKU' } })
    await gotoStep('سری / بسته‌ها')
    await waitFor(() => expect(screen.getByRole('rowheader', { name: 'NEW-SKU' })).toBeDefined())
    expect(screen.queryByRole('rowheader', { name: 'OLD-SKU' })).toBeNull()
  })
})

describe('ویرایشگرِ محصول — موجودی و MOQ', () => {
  it('«اعلام نشده» را از «صفرِ صریح» جدا نگه می‌دارد', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    const [sku] = await screen.findAllByLabelText(/^SKU/)
    fireEvent.change(sku!, { target: { value: 'INV-1' } })

    await gotoStep('موجودی')
    const field = await screen.findByLabelText('موجودیِ INV-1')
    expect((field as HTMLInputElement).value).toBe('')
    expect(field.getAttribute('placeholder')).toBe('اعلام نشده')

    fireEvent.change(field, { target: { value: '0' } })
    expect((field as HTMLInputElement).value).toBe('0')
  })

  it('واحدِ MOQ با برچسبِ فارسی و مقدارِ کانونیک نمایش داده می‌شود', async () => {
    renderEditor()
    await gotoStep('پیشنهادِ تجاری')
    const select = await screen.findByLabelText(/واحدِ MOQ/)
    expect(within(select).getByRole('option', { name: /سری \(SERIES\)/ })).toBeDefined()
    fireEvent.change(select, { target: { value: 'SERIES' } })
    expect((select as HTMLSelectElement).value).toBe('SERIES')
    // وقتی واحد «سری» است و بسته‌ای نیست، هشدار داده می‌شود.
    await waitFor(() => expect(screen.getByText(/واحدِ MOQ «سری» است/)).toBeDefined())
  })
})

describe('ویرایشگرِ محصول — بسته و پلهٔ قیمت', () => {
  it('مجموعِ قطعاتِ بسته را فقط برای پیش‌نمایش محاسبه می‌کند', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    for (const sku of ['S-1', 'S-2']) {
      fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
      const inputs = await screen.findAllByLabelText(/^SKU/)
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: sku } })
    }
    await gotoStep('سری / بسته‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ بسته/ }))
    const selects = await screen.findAllByLabelText(/افزودنِ واریانت به بسته/)
    fireEvent.change(selects[0]!, { target: { value: 'S-1' } })
    fireEvent.change((await screen.findAllByLabelText(/افزودنِ واریانت به بسته/))[0]!, { target: { value: 'S-2' } })

    const quantities = await screen.findAllByLabelText(/^تعدادِ S-\d در بسته/)
    fireEvent.change(quantities[0]!, { target: { value: '2' } })
    fireEvent.change(quantities[1]!, { target: { value: '3' } })
    await waitFor(() => expect(screen.getByText(/مجموع: ۵ قطعه/)).toBeDefined())
  })

  it('SIZE_RUN با یک سایز، پیش از ارسال خطا می‌دهد', async () => {
    renderEditor()
    await gotoStep('واریانت‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
    const [sku] = await screen.findAllByLabelText(/^SKU/)
    fireEvent.change(sku!, { target: { value: 'ONLY-ONE' } })
    await gotoStep('سری / بسته‌ها')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ بسته/ }))
    const [select] = await screen.findAllByLabelText(/افزودنِ واریانت به بسته/)
    fireEvent.change(select!, { target: { value: 'ONLY-ONE' } })
    await waitFor(() => expect(screen.getByText(/بستهٔ سایز-ران باید حداقل ۲ سایز داشته باشد/)).toBeDefined())
  })

  it('هم‌پوشانیِ پله‌های قیمت را تشخیص می‌دهد', async () => {
    renderEditor()
    await gotoStep('پله‌های قیمت')
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ پله/ }))
    fireEvent.click(screen.getByRole('button', { name: /افزودنِ پله/ }))
    const prices = await screen.findAllByLabelText('قیمتِ واحد')
    fireEvent.change(prices[0]!, { target: { value: '1000' } })
    fireEvent.change(prices[1]!, { target: { value: '900' } })
    const mins = await screen.findAllByLabelText('حداقلِ تعداد')
    fireEvent.change(mins[1]!, { target: { value: '1' } })
    await waitFor(() => expect(screen.getByText(/بازهٔ قیمت‌گذاری هم‌پوشان است/)).toBeDefined())
  })
})

describe('ویرایشگرِ محصول — بازبینی و ارسال', () => {
  async function buildRichProduct() {
    // ویرایشگر تا بارگذاریِ دسته‌ها حالتِ loading دارد.
    await screen.findByLabelText(/نام محصول/)
    setByLabel(/نام محصول/, 'پیراهن لینن تست E2E')
    setByLabel(/شناسهٔ یکتا/, 'linen-e2e')

    await gotoStep('واریانت‌ها')
    for (const sku of ['LINEN-BLACK-S', 'LINEN-BLACK-M']) {
      fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
      const inputs = await screen.findAllByLabelText(/^SKU/)
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: sku } })
    }

    await gotoStep('پیشنهادِ تجاری')
    setByLabel(/^SKU تجاری/, 'LINEN-SHIRT')
    setByLabel(/^قیمت عمده/, '1250000')
    fireEvent.change(await screen.findByLabelText(/^حداقل تعداد سفارش/), { target: { value: '2' } })
    fireEvent.change(await screen.findByLabelText(/واحدِ MOQ/), { target: { value: 'SERIES' } })
  }

  it('بدنهٔ ارسالی دقیقاً همان گرافِ بازبینی است (بدونِ تبدیلِ پنهان)', async () => {
    const { recorded } = renderEditor()
    await screen.findByLabelText(/نام محصول/)
    setByLabel(/نام محصول/, 'پیراهن لینن تست E2E')
    setByLabel(/شناسهٔ یکتا/, 'linen-e2e')

    await gotoStep('واریانت‌ها')
    for (const sku of ['LINEN-BLACK-S', 'LINEN-BLACK-M']) {
      fireEvent.click(screen.getByRole('button', { name: /افزودنِ واریانت/ }))
      const inputs = await screen.findAllByLabelText(/^SKU/)
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: sku } })
    }

    await gotoStep('پیشنهادِ تجاری')
    setByLabel(/^SKU تجاری/, 'LINEN-SHIRT')
    setByLabel(/^قیمت عمده/, '1250000')
    fireEvent.change(await screen.findByLabelText(/^حداقل تعداد سفارش/), { target: { value: '2' } })
    fireEvent.change(await screen.findByLabelText(/واحدِ MOQ/), { target: { value: 'SERIES' } })

    await gotoStep('بازبینی')
    // نام هم در بازبینی و هم در ریلِ خلاصه هست؛ هر دو باید همان مقدار باشند.
    await waitFor(() => expect(screen.getAllByText('پیراهن لینن تست E2E').length).toBeGreaterThanOrEqual(2))

    const submitButton = screen.getByRole('button', { name: /ارسال برای بررسی/ })
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submitButton)

    await waitFor(() => expect(recorded.some(call => call.path === '/api/v1/catalog/supplier-submissions' && call.method === 'POST')).toBe(true))
    const post = recorded.find(call => call.path === '/api/v1/catalog/supplier-submissions' && call.method === 'POST')!
    const body = post.body as Record<string, unknown>
    expect(post.isFormData).toBe(false)
    expect(body.name).toBe('پیراهن لینن تست E2E')
    expect(body.slug).toBe('linen-e2e')
    expect(body.variants).toEqual([
      { sku: 'LINEN-BLACK-S', attributes: {}, status: 'active' },
      { sku: 'LINEN-BLACK-M', attributes: {}, status: 'active' },
    ])
    // پول رشته می‌ماند؛ هرگز عدد نمی‌شود.
    expect((body.commercial as Record<string, unknown>).wholesalePrice).toBe('1250000')
    expect((body.commercial as Record<string, unknown>).moqUnit).toBe('SERIES')
  })

  it('پس از ارسالِ موفق، وضعیتِ واقعیِ سرور را نشان می‌دهد', async () => {
    renderEditor({ submitBody: { id: 'sps_42', status: 'pending_review' } })
    await buildRichProduct()
    await gotoStep('بازبینی')
    const submitButton = screen.getByRole('button', { name: /ارسال برای بررسی/ })
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submitButton)
    await waitFor(() => expect(screen.getByText(/برای بررسی ارسال شد/)).toBeDefined())
    expect(screen.getByText('sps_42')).toBeDefined()
    // «ارسال‌شده» هرگز «تأییدشده» جا نمی‌زند.
    expect(screen.queryByText('تأیید شد (محصولِ تازه)')).toBeNull()
  })

  it('خطای اعتبارسنجیِ سرور را با پیامِ خودش نشان می‌دهد', async () => {
    renderEditor({
      submitStatus: 422,
      submitBody: { error: 'OVERLAPPING_PRICING_TIER', message: 'بازهٔ قیمت‌گذاری هم‌پوشان است' },
    })
    await buildRichProduct()
    await gotoStep('بازبینی')
    const submitButton = screen.getByRole('button', { name: /ارسال برای بررسی/ })
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submitButton)
    await waitFor(() => expect(screen.getByText('ارسال ناموفق')).toBeDefined())
    // پیامِ سرور نگه داشته می‌شود، نه یک پیامِ عمومی.
    expect(screen.getByText(/بازهٔ قیمت‌گذاری هم‌پوشان است/)).toBeDefined()
  })

  it('تا رفعِ خطاهای محلی، دکمهٔ ارسال غیرفعال می‌ماند', async () => {
    renderEditor()
    await screen.findByLabelText(/نام محصول/)
    setByLabel(/نام محصول/, 'بدونِ واریانت')
    await gotoStep('بازبینی')
    const submitButton = screen.getByRole('button', { name: /ارسال برای بررسی/ })
    expect((submitButton as HTMLButtonElement).disabled).toBe(true)
  })
})
