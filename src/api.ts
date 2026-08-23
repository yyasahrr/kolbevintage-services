import { isSupabaseConfigured, supabase } from './supabase'

export type SupplierContext = { supplierId: string; displayName: string; legalName: string }

function requireClient() {
  if (!supabase) throw new Error('اتصال Supabase تنظیم نشده است. فایل .env.local را بر اساس .env.example بسازید.')
  return supabase
}

export async function signInSupplier(email: string, password: string): Promise<SupplierContext> {
  const client = requireClient()
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error('ایمیل یا رمز عبور درست نیست.')
  const { data: membership, error: membershipError } = await client.from('supplier_members').select('supplier_id, suppliers(display_name, legal_name, status)').eq('user_id', data.user.id).maybeSingle()
  if (membershipError || !membership) { await client.auth.signOut(); throw new Error('برای این حساب، دسترسی تأمین‌کننده فعال نشده است.') }
  const supplier = Array.isArray(membership.suppliers) ? membership.suppliers[0] : membership.suppliers
  if (!supplier || supplier.status !== 'approved') { await client.auth.signOut(); throw new Error('حساب تأمین‌کننده هنوز تأیید نشده است.') }
  return { supplierId: membership.supplier_id, displayName: supplier.display_name, legalName: supplier.legal_name }
}

export async function restoreSupplierSession(): Promise<SupplierContext | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  if (!data.session) return null
  const { data: membership } = await supabase.from('supplier_members').select('supplier_id, suppliers(display_name, legal_name, status)').eq('user_id', data.session.user.id).maybeSingle()
  const supplier = Array.isArray(membership?.suppliers) ? membership?.suppliers[0] : membership?.suppliers
  if (!membership || !supplier || supplier.status !== 'approved') return null
  return { supplierId: membership.supplier_id, displayName: supplier.display_name, legalName: supplier.legal_name }
}

export async function signOutSupplier() { if (supabase) await supabase.auth.signOut() }

export async function submitSupplierApplication(input: { companyName: string; representativeName: string; phone: string; category: string; monthlyCapacity: number | null }) {
  const client = requireClient()
  const { data, error } = await client.from('supplier_applications').insert({ company_name: input.companyName.trim(), representative_name: input.representativeName.trim(), phone: input.phone.trim(), category: input.category, monthly_capacity: input.monthlyCapacity }).select('id').single()
  if (error) throw new Error('ثبت درخواست انجام نشد. اطلاعات را بررسی و دوباره تلاش کنید.')
  return data.id as string
}

export async function loadSupplierProducts(supplierId: string) {
  const client = requireClient()
  const { data, error } = await client.from('supplier_products').select('id, name, sku, category, wholesale_price, image_url, status, updated_at, product_variants(id, inventory(on_hand, reserved))').eq('supplier_id', supplierId).order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
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
  const client = requireClient()
  const sku = input.sku.trim().toUpperCase()
  const { data: product, error: productError } = await client.from('supplier_products').insert({
    supplier_id: input.supplierId,
    name: input.name.trim(),
    sku,
    category: input.category,
    description: input.description.trim(),
    wholesale_price: input.wholesalePrice,
    image_url: input.imageUrl?.trim() || null,
    status: 'submitted',
  }).select('id, name, sku, status').single()
  if (productError) {
    if (productError.code === '23505') throw new Error('این SKU قبلاً برای حساب شما ثبت شده است.')
    throw new Error('ثبت محصول انجام نشد. دوباره تلاش کنید.')
  }

  const variantSku = `${sku}-${input.color.trim().toUpperCase() || 'DEFAULT'}-${input.size.trim().toUpperCase() || 'ONE'}`
  const { data: variant, error: variantError } = await client.from('product_variants').insert({
    product_id: product.id,
    sku: variantSku,
    color: input.color.trim() || 'بدون رنگ',
    size: input.size.trim() || 'تک‌سایز',
    cost: input.wholesalePrice,
  }).select('id').single()
  if (variantError) {
    await client.from('supplier_products').delete().eq('id', product.id)
    throw new Error(variantError.code === '23505' ? 'SKU واریانت تکراری است.' : 'ثبت واریانت محصول انجام نشد.')
  }

  const { error: inventoryError } = await client.from('inventory').insert({ variant_id: variant.id, on_hand: input.stock, reserved: 0 })
  if (inventoryError) {
    await client.from('supplier_products').delete().eq('id', product.id)
    throw new Error('ثبت موجودی محصول انجام نشد.')
  }
  return product
}

export async function loadSupplierOrders(supplierId: string) {
  const client = requireClient()
  const { data, error } = await client.from('purchase_orders').select('id, order_code, status, due_date, total_amount, tracking_code, shipped_at, delivered_at, created_at, purchase_order_items(id, product_name, sku, quantity, unit_price)').eq('supplier_id', supplierId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateSupplierPurchaseOrder(orderId: string, status: 'preparing' | 'shipped' | 'delivered', trackingCode?: string) {
  const client = requireClient()
  const { data, error } = await client.rpc('update_supplier_purchase_order', { p_order_id: orderId, p_status: status, p_tracking_code: trackingCode?.trim() || null })
  if (error) {
    if (error.message.includes('INVALID_STATUS_TRANSITION')) throw new Error('این تغییر وضعیت در مرحله فعلی مجاز نیست.')
    if (error.message.includes('TRACKING_CODE_REQUIRED')) throw new Error('برای ثبت ارسال، کد رهگیری لازم است.')
    throw new Error('به‌روزرسانی سفارش انجام نشد.')
  }
  return data
}

export async function loadSupplierRfqs(supplierId: string) {
  const client = requireClient()
  const { data, error } = await client.from('rfqs').select('id, reference_code, title, customer_name, quantity, requested_delivery_date, specifications, status, created_at').eq('supplier_id', supplierId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export { isSupabaseConfigured }
