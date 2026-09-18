/**
 * لایه API پنل ساپلایر روی API یکپارچه Next.js — فاز ۲: فقط HttpOnly Cookie.
 */

export type SupplierContext = { supplierId: string; displayName: string; legalName: string }

export const isBackendConfigured = true

export class ApiError extends Error {
  code: string
  constructor(code: string, message?: string) { super(message ?? code); this.code = code }
}

async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
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

export function clearSession() {
  // در فاز ۲ نشست فقط با کوکی HttpOnly است؛ پاک‌سازی محلی لازم نیست
  // این تابع برای سازگاری باقی مانده و در صورت نیاز خروج از سرور را صدا می‌زند
  void api('/store/kolbe/auth/logout', { method: 'POST' }).catch(() => {})
}

export async function signInSupplier(email: string, password: string): Promise<SupplierContext> {
  const data = await api<{ supplier: SupplierContext }>('/store/kolbe/supplier/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
  }).catch((error) => {
    if (error instanceof ApiError) {
      if (error.code === 'NETWORK' || error.code === 'BAD_API_KEY' || error.code.startsWith('HTTP_5')) throw new Error('اتصال به بک‌اند برقرار نیست؛ از آخرین تب پیش‌نمایش استفاده کنید.')
      if (error.code === 'SUPPLIER_ACCESS_INACTIVE') throw new Error('برای این حساب، دسترسی تأمین‌کننده فعال نشده است.')
    }
    throw new Error('ایمیل یا رمز عبور درست نیست.')
  })
  return data.supplier
}

export async function restoreSupplierSession(): Promise<SupplierContext | null> {
  try {
    const data = await api<{ supplier: SupplierContext }>('/store/kolbe/supplier/session')
    return data.supplier
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK') return null
    return null
  }
}

export async function signOutSupplier() {
  try { await api('/store/kolbe/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
}

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
  try {
    const data = await api<{ products: Array<any> }>('/store/kolbe/supplier/products')
    return data.products ?? []
  } catch { return [] }
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
  try {
    const data = await api<{ product: { id: string; name: string; sku: string; status: string } }>('/store/kolbe/supplier/products', {
      method: 'POST',
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
  try {
    const data = await api<{ orders: Array<any> }>('/store/kolbe/supplier/orders')
    return data.orders ?? []
  } catch { return [] }
}

export async function updateSupplierPurchaseOrder(orderId: string, status: 'preparing' | 'shipped' | 'delivered', trackingCode?: string) {
  try {
    return await api(`/store/kolbe/supplier/orders/${orderId}/status`, {
      method: 'POST',
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
  try {
    const data = await api<{ rfqs: Array<any> }>('/store/kolbe/supplier/rfqs')
    return data.rfqs ?? []
  } catch { return [] }
}

export async function submitSupplierQuote(rfqId: string, quote: { unitPrice: number; leadTimeDays: number; notes?: string }) {
  await api(`/store/kolbe/supplier/rfqs/${rfqId}/quote`, { method: 'POST', body: quote })
}

export async function backendHealth(): Promise<boolean> {
  try {
    await api('/store/kolbe/health')
    return true
  } catch {
    return false
  }
}
