import { api, ApiError, clearToken, loadToken, saveToken } from "./api";

export type AdminSupplierApplication = {
  id: string;
  companyName: string;
  representativeName: string;
  phone: string;
  category: string;
  monthlyCapacity: number | null;
  status: "pending" | "reviewing" | "approved" | "rejected";
  createdAt: string;
};

export type AdminSupplier = {
  id: string;
  displayName: string;
  legalName: string;
  city: string | null;
  phone: string | null;
  status: "pending" | "reviewing" | "approved" | "rejected";
  monthlyCapacity: number | null;
  capabilities: string[];
};

export type AdminSupplierProduct = {
  id: string;
  name: string;
  sku: string;
  category: string;
  wholesalePrice: number;
  imageUrl: string | null;
  status: "draft" | "submitted" | "approved" | "changes_requested" | "rejected";
  supplierName: string;
  stock: number;
};

export type AdminWholesaleOrder = {
  id: string;
  orderCode: string;
  status: string;
  totalAmount: number;
  totalUnits: number;
  createdAt: string;
  storeName: string;
  items: Array<{ productName: string; sku: string; quantity: number }>;
  purchaseOrders: Array<{ id: string; orderCode: string; status: string; supplierName: string; trackingCode: string | null }>;
};

function adminToken(): string | null {
  return loadToken("admin");
}

export async function signInAdmin(email: string, password: string) {
  const data = await api<{ token: string; user: { role: string } }>("/store/kolbe/auth/login", {
    method: "POST",
    body: { email: email.trim(), password, role: "admin" },
  }).catch((error) => {
    if (error instanceof ApiError && (error.code === "NETWORK" || error.code === "BAD_API_KEY" || error.code.startsWith("HTTP_5"))) throw new Error("اتصال به بک‌اند برقرار نیست؛ اگر این پیام را می‌بینید احتمالاً روی پیش‌نمایش قدیمی هستید — از آخرین تب پیش‌نمایش استفاده کنید.");
    throw new Error("ایمیل یا رمز عبور درست نیست.");
  });
  if (data.user.role !== "admin") throw new Error("این حساب دسترسی مدیریت کلبه را ندارد.");
  saveToken("admin", data.token);
}

export async function signOutAdmin() {
  clearToken("admin");
}

export async function restoreAdminSession(): Promise<boolean> {
  const token = adminToken();
  if (!token) return false;
  try {
    await api("/store/kolbe/me", { token: loadToken("customer") ?? undefined } as any);
  } catch {
    /* از توکن ادمین برای me استفاده نمیشود */
  }
  // اعتبار توکن ادمین را با یک درخواست سبک ادمین میسنجیم:
  try {
    await api("/store/kolbe/admin/tickets", { token });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return false;
    clearToken("admin");
    return false;
  }
}

export async function listSupplierApplications(): Promise<AdminSupplierApplication[]> {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ applications: Array<any> }>("/store/kolbe/admin/supplier-applications", { token });
  return (data.applications ?? []).map((item) => ({
    id: item.id, companyName: item.company_name, representativeName: item.representative_name,
    phone: item.phone, category: item.category, monthlyCapacity: item.monthly_capacity,
    status: item.status, createdAt: item.created_at,
  }));
}

export async function listSuppliers(): Promise<AdminSupplier[]> {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ suppliers: Array<any> }>("/store/kolbe/admin/suppliers", { token });
  return (data.suppliers ?? []).map((item) => ({
    id: item.id, displayName: item.display_name, legalName: item.legal_name, city: item.city,
    phone: item.phone, status: item.status, monthlyCapacity: item.monthly_capacity,
    capabilities: item.capabilities ?? [],
  }));
}

export async function updateSupplierApplication(id: string, status: AdminSupplierApplication["status"]) {
  const token = adminToken();
  if (!token) return;
  await api(`/admin/kolbe/supplier-applications/${id}`, { method: "POST", token, body: { status } });
}

export async function listSupplierCatalogProducts(): Promise<AdminSupplierProduct[]> {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ products: Array<any> }>("/store/kolbe/admin/catalog", { token });
  return (data.products ?? []).map((item) => ({
    id: item.id, name: item.name, sku: item.sku, category: item.category,
    wholesalePrice: item.wholesale_price, imageUrl: item.image_url, status: item.status,
    supplierName: item.supplier_name, stock: item.stock,
  }));
}

export async function updateSupplierProductStatus(id: string, status: AdminSupplierProduct["status"]) {
  const token = adminToken();
  if (!token) return;
  await api(`/admin/kolbe/catalog/${id}/status`, { method: "POST", token, body: { status } });
}

export async function listPurchaseOrders() {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ orders: Array<any> }>("/store/kolbe/admin/purchase-orders", { token });
  return data.orders ?? [];
}

export async function updatePurchaseOrder(id: string, status: string) {
  const token = adminToken();
  if (!token) return;
  await api(`/admin/kolbe/purchase-orders/${id}/status`, { method: "POST", token, body: { status } });
}

export async function listWholesaleFulfillmentOrders(): Promise<AdminWholesaleOrder[]> {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ orders: Array<any> }>("/store/kolbe/admin/orders", { token });
  return (data.orders ?? []).map((order) => ({
    id: order.id, orderCode: order.order_code, status: order.status, totalAmount: order.total_amount,
    totalUnits: order.total_units, createdAt: order.created_at, storeName: order.store_name,
    items: (order.wholesale_order_items ?? []).map((item: any) => ({
      productName: item.product_name, sku: item.sku, quantity: item.quantity,
    })),
    purchaseOrders: (order.purchase_orders ?? []).map((po: any) => ({
      id: po.id, orderCode: po.order_code, status: po.status, supplierName: po.supplier_name, trackingCode: po.tracking_code,
    })),
  }));
}

export async function approveWholesaleOrder(id: string, dueDate?: string) {
  const token = adminToken();
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  return api<{ order_id: string; purchase_orders: number }>(`/admin/kolbe/orders/${id}/approve`, {
    method: "POST", token, body: { dueDate: dueDate || null },
  });
}

export async function cancelWholesaleOrder(id: string) {
  const token = adminToken();
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  await api(`/admin/kolbe/orders/${id}/cancel`, { method: "POST", token });
}

export type AdminWholesaleAccount = {
  id: string;
  userId: string;
  memberName: string;
  storeName: string;
  phone: string;
  city: string;
  planName: string;
  status: "pending" | "approved" | "suspended" | "financial_blocked" | "rejected";
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export async function listWholesaleAccounts(): Promise<AdminWholesaleAccount[]> {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ accounts: Array<any> }>("/store/kolbe/admin/accounts", { token });
  return (data.accounts ?? []).map((a) => ({
    id: a.id, userId: a.user_id, memberName: a.member_name, storeName: a.store_name,
    phone: a.phone, city: a.city, planName: a.plan_name,
    status: a.status === "financial_blocked" ? "financial_blocked" : a.status,
    activatedAt: a.activated_at, expiresAt: a.expires_at, createdAt: a.created_at,
  }));
}

export async function updateWholesaleAccountStatus(id: string, status: AdminWholesaleAccount["status"], expiresAt?: string) {
  const token = adminToken();
  if (!token) return;
  await api(`/store/kolbe/admin/accounts/${id}/status`, { method: "POST", token, body: { status, expiresAt } });
}

/** ویرایش گروهی قیمت عمده (درصدی/مبلغی) — نیازسنجی 9-d */
export async function bulkUpdateWholesalePrice(ids: string[], mode: "percent" | "amount", value: number) {
  const token = adminToken();
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  return api<{ updated: number }>("/store/kolbe/admin/catalog/bulk-price", { method: "POST", token, body: { ids, mode, value } });
}

export async function listSupplierTickets() {
  const token = adminToken();
  if (!token) return [];
  const data = await api<{ tickets: Array<any> }>("/store/kolbe/admin/tickets", { token });
  return data.tickets ?? [];
}

export async function answerSupplierTicket(id: string, status: string, adminReply?: string) {
  const token = adminToken();
  if (!token) return;
  await api(`/admin/kolbe/tickets/${id}`, { method: "POST", token, body: { status, adminReply } });
}

export type SystemLogLevel = "debug" | "info" | "warning" | "error" | "critical";
export type SystemLogSource = "api" | "frontend" | "auth" | "system" | "integration";
export type SystemLogStatus = "open" | "resolved" | "ignored";

export type SystemLog = {
  id: string;
  level: SystemLogLevel;
  source: SystemLogSource;
  eventType: string;
  message: string;
  errorName: string | null;
  stack: string | null;
  fingerprint: string;
  status: SystemLogStatus;
  httpMethod: string | null;
  path: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  requestId: string | null;
  actorId: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  environment: string;
  release: string | null;
  metadata: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt?: string;
};

export type SystemLogFilters = {
  level: "all" | SystemLogLevel;
  source: "all" | SystemLogSource;
  status: "all" | SystemLogStatus;
  range: "24h" | "7d" | "30d" | "all";
  query: string;
  page: number;
  limit: number;
};

export type SystemLogsResponse = {
  logs: SystemLog[];
  pagination: { page: number; limit: number; total: number; pageCount: number; capped: boolean };
  summary: {
    openErrors: number;
    criticalOpen: number;
    errors24h: number;
    frontend24h: number;
    warnings24h: number;
    slow24h: number;
  };
};

export async function loadSystemLogs(filters: SystemLogFilters, signal?: AbortSignal): Promise<SystemLogsResponse> {
  const token = adminToken();
  if (!token) throw new ApiError("UNAUTHORIZED", "ورود ادمین لازم است.");
  const params = new URLSearchParams({
    level: filters.level,
    source: filters.source,
    status: filters.status,
    range: filters.range,
    q: filters.query,
    page: String(filters.page),
    limit: String(filters.limit),
  });
  return api<SystemLogsResponse>(`/store/kolbe/admin/logs?${params.toString()}`, { token, signal });
}

export async function updateSystemLogStatus(id: string, status: SystemLogStatus, note?: string) {
  const token = adminToken();
  if (!token) throw new ApiError("UNAUTHORIZED", "ورود ادمین لازم است.");
  return api<{ log: SystemLog }>(`/store/kolbe/admin/logs/${encodeURIComponent(id)}`, {
    method: "POST",
    token,
    body: { status, note },
  });
}
