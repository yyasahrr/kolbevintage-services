import { api, ApiError } from "./api";

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

export async function signInAdmin(email: string, password: string) {
  const data = await api<{ user: { role: string } }>("/store/kolbe/auth/login", {
    method: "POST",
    body: { email: email.trim(), password, role: "admin" },
  }).catch((error) => {
    if (error instanceof ApiError && (error.code === "NETWORK" || error.code === "BAD_API_KEY" || error.code.startsWith("HTTP_5"))) throw new Error("اتصال به بک‌اند برقرار نیست؛ اگر این پیام را می‌بینید احتمالاً روی پیش‌نمایش قدیمی هستید — از آخرین تب پیش‌نمایش استفاده کنید.");
    throw new Error("ایمیل یا رمز عبور درست نیست.");
  });
  if (data.user.role !== "admin") throw new Error("این حساب دسترسی مدیریت کلبه را ندارد.");
}

export async function signOutAdmin() {
  try {
    await api("/store/kolbe/auth/logout", { method: "POST" });
  } catch { /* ignore */ }
}

export async function restoreAdminSession(): Promise<boolean> {
  try {
    await api("/store/kolbe/admin/tickets");
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === "NETWORK") return false;
    return false;
  }
}

export async function listSupplierApplications(): Promise<AdminSupplierApplication[]> {
  try {
    const data = await api<{ applications: Array<any> }>("/store/kolbe/admin/supplier-applications");
    return (data.applications ?? []).map((item) => ({
      id: item.id, companyName: item.company_name, representativeName: item.representative_name,
      phone: item.phone, category: item.category, monthlyCapacity: item.monthly_capacity,
      status: item.status, createdAt: item.created_at,
    }));
  } catch { return []; }
}

export async function listSuppliers(): Promise<AdminSupplier[]> {
  try {
    const data = await api<{ suppliers: Array<any> }>("/store/kolbe/admin/suppliers");
    return (data.suppliers ?? []).map((item) => ({
      id: item.id, displayName: item.display_name, legalName: item.legal_name, city: item.city,
      phone: item.phone, status: item.status, monthlyCapacity: item.monthly_capacity,
      capabilities: item.capabilities ?? [],
    }));
  } catch { return []; }
}

export async function updateSupplierApplication(id: string, status: AdminSupplierApplication["status"]) {
  await api(`/admin/kolbe/supplier-applications/${id}`, { method: "POST", body: { status } });
}

export async function listSupplierCatalogProducts(): Promise<AdminSupplierProduct[]> {
  try {
    const data = await api<{ products: Array<any> }>("/store/kolbe/admin/catalog");
    return (data.products ?? []).map((item) => ({
      id: item.id, name: item.name, sku: item.sku, category: item.category,
      wholesalePrice: item.wholesale_price, imageUrl: item.image_url, status: item.status,
      supplierName: item.supplier_name, stock: item.stock,
    }));
  } catch { return []; }
}

export async function updateSupplierProductStatus(id: string, status: AdminSupplierProduct["status"]) {
  await api(`/admin/kolbe/catalog/${id}/status`, { method: "POST", body: { status } });
}

export async function listPurchaseOrders() {
  try {
    const data = await api<{ orders: Array<any> }>("/store/kolbe/admin/purchase-orders");
    return data.orders ?? [];
  } catch { return []; }
}

export async function updatePurchaseOrder(id: string, status: string) {
  await api(`/admin/kolbe/purchase-orders/${id}/status`, { method: "POST", body: { status } });
}

export async function listWholesaleFulfillmentOrders(): Promise<AdminWholesaleOrder[]> {
  try {
    const data = await api<{ orders: Array<any> }>("/store/kolbe/admin/orders");
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
  } catch { return []; }
}

export async function approveWholesaleOrder(id: string, dueDate?: string) {
  return api<{ order_id: string; purchase_orders: number }>(`/admin/kolbe/orders/${id}/approve`, {
    method: "POST", body: { dueDate: dueDate || null },
  });
}

export async function cancelWholesaleOrder(id: string) {
  await api(`/admin/kolbe/orders/${id}/cancel`, { method: "POST" });
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
  try {
    const data = await api<{ accounts: Array<any> }>("/store/kolbe/admin/accounts");
    return (data.accounts ?? []).map((a) => ({
      id: a.id, userId: a.user_id, memberName: a.member_name, storeName: a.store_name,
      phone: a.phone, city: a.city, planName: a.plan_name,
      status: a.status === "financial_blocked" ? "financial_blocked" : a.status,
      activatedAt: a.activated_at, expiresAt: a.expires_at, createdAt: a.created_at,
    }));
  } catch { return []; }
}

export async function updateWholesaleAccountStatus(id: string, status: AdminWholesaleAccount["status"], expiresAt?: string) {
  await api(`/store/kolbe/admin/accounts/${id}/status`, { method: "POST", body: { status, expiresAt } });
}

export async function bulkUpdateWholesalePrice(ids: string[], mode: "percent" | "amount", value: number) {
  return api<{ updated: number }>("/store/kolbe/admin/catalog/bulk-price", { method: "POST", body: { ids, mode, value } });
}

export async function listSupplierTickets() {
  try {
    const data = await api<{ tickets: Array<any> }>("/store/kolbe/admin/tickets");
    return data.tickets ?? [];
  } catch { return []; }
}

export async function answerSupplierTicket(id: string, status: string, adminReply?: string) {
  await api(`/admin/kolbe/tickets/${id}`, { method: "POST", body: { status, adminReply } });
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
  const params = new URLSearchParams({
    level: filters.level,
    source: filters.source,
    status: filters.status,
    range: filters.range,
    q: filters.query,
    page: String(filters.page),
    limit: String(filters.limit),
  });
  return api<SystemLogsResponse>(`/store/kolbe/admin/logs?${params.toString()}`, { signal });
}

export async function updateSystemLogStatus(id: string, status: SystemLogStatus, note?: string) {
  return api<{ log: SystemLog }>(`/store/kolbe/admin/logs/${encodeURIComponent(id)}`, {
    method: "POST",
    body: { status, note },
  });
}
