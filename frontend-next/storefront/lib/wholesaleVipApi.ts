import { api, ApiError, clearToken, loadToken, saveToken } from "./medusa";

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

export type WholesaleCustomerOrder = { id: string; code: string; status: string; totalAmount: number; totalUnits: number; createdAt: string };

type ApiAccount = { id: string; member_name: string; store_name: string; phone: string; city: string; plan_name: string; activated_at: string | null; expires_at: string | null };

function toAccount(raw: ApiAccount): WholesaleVipAccount {
  return {
    id: raw.id, memberName: raw.member_name, storeName: raw.store_name, phone: raw.phone,
    city: raw.city, planName: raw.plan_name, activatedAt: raw.activated_at, expiresAt: raw.expires_at,
  };
}

async function getActiveAccount(token: string | null): Promise<WholesaleVipAccount | null> {
  if (!token) return null;
  try {
    const data = await api<{ account: ApiAccount | null }>("/store/kolbe/wholesale/account", { token });
    return data.account ? toAccount(data.account) : null;
  } catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return null;
    return null;
  }
}

export async function signInWholesaleVip(email: string, password: string) {
  const data = await api<{ token: string }>("/store/kolbe/auth/login", {
    method: "POST",
    body: { email, password },
  }).catch((error) => {
    if (error instanceof ApiError && (error.code === "NETWORK" || error.code === "BAD_API_KEY" || error.code.startsWith("HTTP_5"))) throw new Error("اتصال به بک‌اند برقرار نیست؛ از آخرین تب پیش‌نمایش استفاده کنید.");
    throw new Error("ایمیل یا رمز عبور درست نیست.");
  });
  saveToken("vip", data.token);
  const account = await getActiveAccount(data.token);
  if (!account) {
    clearToken("vip");
    throw new Error("عضویت VIP این حساب فعال نیست یا اعتبار آن تمام شده است.");
  }
  return account;
}

export async function restoreWholesaleVip() {
  return getActiveAccount(loadToken("vip"));
}

export async function signOutWholesaleVip() {
  clearToken("vip");
}

/** درخواست عضویت عمده برای مشتری واردشده فروشگاه. */
export async function applyWholesaleVip(input: { memberName: string; storeName: string; phone: string; city: string }) {
  const token = loadToken("customer");
  if (!token) throw new Error("ابتدا وارد حساب کاربری فروشگاه شوید.");
  await api("/store/kolbe/wholesale/apply", { method: "POST", token, body: input });
}

export async function loadWholesaleVipProducts(): Promise<WholesaleVipProduct[]> {
  const token = loadToken("vip");
  if (!token) throw new Error("ورود VIP انجام نشده است.");
  const data = await api<{ products: Array<any> }>("/store/kolbe/wholesale/products", { token });
  return (data.products ?? []).map((product) => ({
    id: product.id, name: product.name, sku: product.sku, category: product.category,
    description: product.description, wholesalePrice: product.wholesale_price, imageUrl: product.image_url,
    variants: (product.product_variants ?? []).map((variant: any) => ({
      id: variant.id, sku: variant.sku, color: variant.color, colorHex: variant.color_hex ?? "#d6d3d1",
      size: variant.size, available: Math.max(0, (variant.inventory?.on_hand ?? 0) - (variant.inventory?.reserved ?? 0)),
    })),
  }));
}

export async function loadWholesaleCustomerOrders(accountId: string): Promise<WholesaleCustomerOrder[]> {
  void accountId;
  const token = loadToken("vip");
  if (!token) return [];
  const data = await api<{ orders: Array<any> }>("/store/kolbe/wholesale/orders", { token });
  return (data.orders ?? []).map((order) => ({
    id: order.id, code: order.order_code, status: order.status,
    totalAmount: order.total_amount, totalUnits: order.total_units, createdAt: order.created_at,
  }));
}

export async function submitWholesaleCustomerOrder(
  accountId: string,
  lines: Array<{ productId: string; variantId: string; productName: string; sku: string; quantity: number; unitPrice: number }>,
) {
  void accountId;
  const token = loadToken("vip");
  if (!token) throw new Error("ورود VIP انجام نشده است.");
  try {
    const data = await api<{ orderCode: string }>("/store/kolbe/wholesale/orders", {
      method: "POST",
      token,
      body: { lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })) },
    });
    return data.orderCode;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "";
    if (code === "INSUFFICIENT_STOCK") throw new Error("موجودی یکی از واریانت‌ها برای این تعداد کافی نیست.");
    if (code === "VIP_ACCOUNT_INACTIVE") throw new Error("عضویت VIP فعال نیست.");
    if (code === "BELOW_MIN_UNITS") throw new Error("حداقل تعداد هر سفارش عمده ۱۲ عدد است.");
    if (code === "NETWORK") throw new Error("اتصال به سرور برقرار نشد؛ دوباره تلاش کنید.");
    throw new Error("ثبت سفارش انجام نشد؛ دوباره تلاش کنید.");
  }
}
