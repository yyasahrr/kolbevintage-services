/**
 * لایه API پنل ساپلایر روی API یکپارچه Next.js.
 */
const TOKEN_KEY = 'kv_supplier'

export type SupplierContext = { supplierId: string; displayName: string; legalName: string }

export const isBackendConfigured = true

export class ApiError extends Error {
  code: string
  constructor(code: string, message?: string) { super(message ?? code); this.code = code }
}

async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; token?: string | null }): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch { throw new ApiError('NETWORK', 'اتصال به سرور برقرار نشد.') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = String((data as any)?.message ?? '')
    if (message.includes('Publishable API key') || (data as any)?.type === 'not_allowed') throw new ApiError('BAD_API_KEY', 'نسخه صفحه قدیمی است؛ صفحه را با Ctrl+Shift+R رفرش کنید.')
    throw new ApiError(String((data as any)?.error ?? `HTTP_${response.status}`))
  }
  return data as T
}

function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function saveToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* ignore */ }
}

export function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

export async function signInSupplier(email: string, password: string): Promise<SupplierContext> {
  const data = await api<{ token: string; supplier: SupplierContext }>('/store/kolbe/supplier/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
  }).catch((error) => {
    if (error instanceof ApiError) {
      if (error.code === 'NETWORK' || error.code === 'BAD_API_KEY' || error.code.startsWith('HTTP_5')) throw new Error('اتصال به بک‌اند برقرار نیست؛ از آخرین تب پیش‌نمایش استفاده کنید.')
      if (error.code === 'SUPPLIER_ACCESS_INACTIVE') throw new Error('برای این حساب، دسترسی تأمین‌کننده فعال نشده است.')
    }
    throw new Error('ایمیل یا رمز عبور درست نیست.')
  })
  saveToken(data.token)
  return data.supplier
}

export async function restoreSupplierSession(): Promise<SupplierContext | null> {
  const token = loadToken()
  if (!token) return null
  try {
    const data = await api<{ supplier: SupplierContext }>('/store/kolbe/supplier/session', { token })
    return data.supplier
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK') return null
    clearSession()
    return null
  }
}

export async function signOutSupplier() { clearSession() }

export async function submitSupplierApplication(input: { companyName: string; representativeName: string; phone: string; category: string; monthlyCapacity: number | null }) {
  const data = await api<{ id: string }>('/store/kolbe/supplier/apply', {
    method: 'POST',
    body: input,
  }).catch((error) => {
    if (error instanceof ApiError && error.code === 'NETWORK') throw new Error('اتصال به سرور برقرار نشد؛ بعداً تلاش کنید.')
    throw new Error('ثبت درخواست انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.')
  })
  return data.id
}

export async function loadSupplierProducts(supplierId: string) {
  void supplierId
  const token = loadToken()
  if (!token) return []
  const data = await api<{ products: Array<any> }>('/store/kolbe/supplier/products', { token })
  return data.products ?? []
}

export type CreateSupplierProductInput = {
  supplierId: string
  name: string
  sku: string
  category: string
  description: string
  wholesalePrice: number
  imageUrl?: string
  color: string
  size: string
  stock: number
}

export async function createSupplierProduct(input: CreateSupplierProductInput) {
  const token = loadToken()
  if (!token) throw new Error('نشست منقضی شده است؛ دوباره وارد شوید.')
  try {
    const data = await api<{ product: { id: string; name: string; sku: string; status: string } }>('/store/kolbe/supplier/products', {
      method: 'POST',
      token,
      body: {
        name: input.name, sku: input.sku, category: input.category, description: input.description,
        wholesalePrice: input.wholesalePrice, imageUrl: input.imageUrl, color: input.color,
        size: input.size, stock: input.stock,
      },
    })
    return data.product
  } catch (error) {
    if (error instanceof ApiError && error.code === 'DUPLICATE_SKU') throw new Error('این SKU قبلاً ثبت شده است.')
    throw new Error('ثبت محصول انجام نشد. دوباره تلاش کنید.')
  }
}

export async function loadSupplierOrders(supplierId: string) {
  void supplierId
  const token = loadToken()
  if (!token) return []
  const data = await api<{ orders: Array<any> }>('/store/kolbe/supplier/orders', { token })
  return data.orders ?? []
}

export async function updateSupplierPurchaseOrder(orderId: string, status: 'preparing' | 'shipped' | 'delivered', trackingCode?: string) {
  const token = loadToken()
  if (!token) throw new Error('نشست منقضی شده است؛ دوباره وارد شوید.')
  try {
    return await api(`/store/kolbe/supplier/orders/${orderId}/status`, {
      method: 'POST',
      token,
      body: { status, trackingCode: trackingCode?.trim() || null },
    })
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'INVALID_STATUS_TRANSITION') throw new Error('این تغییر وضعیت در مرحله فعلی مجاز نیست.')
      if (error.code === 'TRACKING_CODE_REQUIRED') throw new Error('برای ثبت ارسال، کد رهگیری لازم است.')
    }
    throw new Error('به‌روزرسانی سفارش انجام نشد.')
  }
}

export async function loadSupplierRfqs(supplierId: string) {
  void supplierId
  const token = loadToken()
  if (!token) return []
  const data = await api<{ rfqs: Array<any> }>('/store/kolbe/supplier/rfqs', { token })
  return data.rfqs ?? []
}

/** ارسال پیشنهاد قیمت برای یک RFQ. */
export async function submitSupplierQuote(rfqId: string, quote: { unitPrice: number; leadTimeDays: number; notes?: string }) {
  const token = loadToken()
  if (!token) throw new Error('نشست منقضی شده است؛ دوباره وارد شوید.')
  await api(`/store/kolbe/supplier/rfqs/${rfqId}/quote`, { method: 'POST', token, body: quote })
}

/** آیا سرور در دسترس است؟ (برای نمایش مسیر دمو وقتی بک‌اند بالا نیست) */
export async function backendHealth(): Promise<boolean> {
  try {
    await api('/store/kolbe/health')
    return true
  } catch {
    return false
  }
}
