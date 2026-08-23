import { supabase } from "./supabase";

export type WholesaleVipAccount = {
  id: string;
  memberName: string;
  storeName: string;
  phone: string;
  city: string;
  planName: string;
  activatedAt: string | null;
  expiresAt: string | null;
};

export type WholesaleVipProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  wholesalePrice: number;
  imageUrl: string | null;
  variants: Array<{ id: string; sku: string; color: string; colorHex: string; size: string; available: number }>;
};

function requireClient() {
  if (!supabase) throw new Error("اتصال سرویس عضویت تنظیم نشده است.");
  return supabase;
}

async function getActiveAccount(userId: string): Promise<WholesaleVipAccount | null> {
  const client = requireClient();
  const { data, error } = await client.from("wholesale_accounts").select("id, member_name, store_name, phone, city, plan_name, status, activated_at, expires_at").eq("user_id", userId).maybeSingle();
  if (error || !data || data.status !== "approved" || (data.expires_at && new Date(data.expires_at) <= new Date())) return null;
  return { id: data.id, memberName: data.member_name, storeName: data.store_name, phone: data.phone, city: data.city, planName: data.plan_name, activatedAt: data.activated_at, expiresAt: data.expires_at };
}

export async function signInWholesaleVip(email: string, password: string) {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("ایمیل یا رمز عبور درست نیست.");
  const account = await getActiveAccount(data.user.id);
  if (!account) { await client.auth.signOut(); throw new Error("عضویت VIP این حساب فعال نیست یا اعتبار آن تمام شده است."); }
  return account;
}

export async function restoreWholesaleVip() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? getActiveAccount(data.session.user.id) : null;
}

export async function signOutWholesaleVip() { if (supabase) await supabase.auth.signOut(); }

export async function loadWholesaleVipProducts(): Promise<WholesaleVipProduct[]> {
  const client = requireClient();
  const { data, error } = await client.from("supplier_products").select("id, name, sku, category, description, wholesale_price, image_url, product_variants(id, sku, color, color_hex, size, inventory(on_hand, reserved))").eq("status", "approved").order("updated_at", { ascending: false });
  if (error) throw new Error("دریافت کاتالوگ عمده انجام نشد.");
  return (data ?? []).map((product) => ({
    id: product.id, name: product.name, sku: product.sku, category: product.category, description: product.description,
    wholesalePrice: product.wholesale_price, imageUrl: product.image_url,
    variants: (product.product_variants ?? []).map((variant: { id: string; sku: string; color: string; color_hex: string | null; size: string; inventory: Array<{ on_hand: number; reserved: number }> | { on_hand: number; reserved: number } | null }) => {
      const inventory = Array.isArray(variant.inventory) ? variant.inventory[0] : variant.inventory;
      return { id: variant.id, sku: variant.sku, color: variant.color, colorHex: variant.color_hex ?? "#d6d3d1", size: variant.size, available: Math.max(0, (inventory?.on_hand ?? 0) - (inventory?.reserved ?? 0)) };
    }),
  }));
}

export type WholesaleCustomerOrder = { id: string; code: string; status: string; totalAmount: number; totalUnits: number; createdAt: string };

export async function loadWholesaleCustomerOrders(accountId: string): Promise<WholesaleCustomerOrder[]> {
  const client = requireClient();
  const { data, error } = await client.from("wholesale_orders").select("id, order_code, status, total_amount, total_units, created_at").eq("account_id", accountId).order("created_at", { ascending: false });
  if (error) throw new Error("دریافت سفارش‌های حساب انجام نشد.");
  return (data ?? []).map((order) => ({ id: order.id, code: order.order_code, status: order.status, totalAmount: order.total_amount, totalUnits: order.total_units, createdAt: order.created_at }));
}

export async function submitWholesaleCustomerOrder(accountId: string, lines: Array<{ productId: string; variantId: string; productName: string; sku: string; quantity: number; unitPrice: number }>) {
  const client = requireClient();
  void accountId;
  const { data, error } = await client.rpc("submit_wholesale_order", {
    p_lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
  });
  if (error) {
    if (error.message.includes("INSUFFICIENT_STOCK")) throw new Error("موجودی یکی از واریانت‌ها برای این تعداد کافی نیست.");
    if (error.message.includes("VIP_ACCOUNT_INACTIVE")) throw new Error("عضویت VIP فعال نیست.");
    throw new Error("ثبت اتمیک سفارش انجام نشد؛ دوباره تلاش کنید.");
  }
  return String((data as { order_code: string }).order_code);
}
