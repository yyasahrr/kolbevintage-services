import { supabase } from "./supabase";

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

export async function signInAdmin(email: string, password: string) {
  if (!supabase) throw new Error("اتصال Supabase تنظیم نشده است.");
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("ایمیل یا رمز عبور درست نیست.");
  const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
  if (profileError || profile?.role !== "admin") { await supabase.auth.signOut(); throw new Error("این حساب دسترسی مدیریت کلبه را ندارد."); }
}

export async function signOutAdmin() { if (supabase) await supabase.auth.signOut(); }

export async function restoreAdminSession() {
  if (!supabase) return false;
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.user) return false;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  return !profileError && profile?.role === "admin";
}

export async function listSupplierApplications(): Promise<AdminSupplierApplication[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("supplier_applications").select("id, company_name, representative_name, phone, category, monthly_capacity, status, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => ({ id: item.id, companyName: item.company_name, representativeName: item.representative_name, phone: item.phone, category: item.category, monthlyCapacity: item.monthly_capacity, status: item.status, createdAt: item.created_at }));
}

export async function listSuppliers(): Promise<AdminSupplier[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, display_name, legal_name, city, phone, status, monthly_capacity, capabilities")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => ({
    id: item.id,
    displayName: item.display_name,
    legalName: item.legal_name,
    city: item.city,
    phone: item.phone,
    status: item.status,
    monthlyCapacity: item.monthly_capacity,
    capabilities: item.capabilities ?? [],
  }));
}

export async function updateSupplierApplication(id: string, status: AdminSupplierApplication["status"]) {
  if (!supabase) return;
  const { error } = await supabase.from("supplier_applications").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function listSupplierCatalogProducts(): Promise<AdminSupplierProduct[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("supplier_products").select("id, name, sku, category, wholesale_price, image_url, status, suppliers(display_name), product_variants(inventory(on_hand))").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((item) => {
    const supplier = Array.isArray(item.suppliers) ? item.suppliers[0] : item.suppliers;
    const stock = (item.product_variants ?? []).reduce((sum: number, variant: { inventory: Array<{ on_hand: number }> | { on_hand: number } | null }) => {
      const inventory = Array.isArray(variant.inventory) ? variant.inventory[0] : variant.inventory;
      return sum + (inventory?.on_hand ?? 0);
    }, 0);
    return { id: item.id, name: item.name, sku: item.sku, category: item.category, wholesalePrice: item.wholesale_price, imageUrl: item.image_url, status: item.status, supplierName: supplier?.display_name ?? "—", stock };
  });
}

export async function updateSupplierProductStatus(id: string, status: AdminSupplierProduct["status"]) {
  if (!supabase) return;
  const { error } = await supabase.from("supplier_products").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function listPurchaseOrders() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("purchase_orders").select("id, order_code, status, due_date, total_amount, created_at, purchase_order_items(id, product_name, sku, quantity, unit_price)").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function updatePurchaseOrder(id: string, status: string) {
  if (!supabase) return;
  const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", id);
  if (error) throw error;
}

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

export async function listWholesaleFulfillmentOrders(): Promise<AdminWholesaleOrder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("wholesale_orders").select("id, order_code, status, total_amount, total_units, created_at, wholesale_accounts(store_name), wholesale_order_items(product_name, sku, quantity), purchase_orders(id, order_code, status, tracking_code, suppliers(display_name))").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((order) => {
    const account = Array.isArray(order.wholesale_accounts) ? order.wholesale_accounts[0] : order.wholesale_accounts;
    return {
      id: order.id, orderCode: order.order_code, status: order.status, totalAmount: order.total_amount,
      totalUnits: order.total_units, createdAt: order.created_at, storeName: account?.store_name ?? "—",
      items: order.wholesale_order_items ?? [],
      purchaseOrders: (order.purchase_orders ?? []).map((po: { id: string; order_code: string; status: string; tracking_code: string | null; suppliers: { display_name: string } | Array<{ display_name: string }> | null }) => {
        const supplier = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
        return { id: po.id, orderCode: po.order_code, status: po.status, supplierName: supplier?.display_name ?? "—", trackingCode: po.tracking_code };
      }),
    };
  });
}

export async function approveWholesaleOrder(id: string, dueDate?: string) {
  if (!supabase) throw new Error("اتصال Supabase تنظیم نشده است.");
  const { data, error } = await supabase.rpc("approve_wholesale_order", { p_order_id: id, p_due_date: dueDate || null });
  if (error) throw error;
  return data as { order_id: string; purchase_orders: number };
}

export async function cancelWholesaleOrder(id: string) {
  if (!supabase) throw new Error("اتصال Supabase تنظیم نشده است.");
  const { error } = await supabase.rpc("cancel_wholesale_order", { p_order_id: id });
  if (error) throw error;
}

export async function listSupplierTickets() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("support_tickets").select("id, subject, category, message, priority, status, admin_reply, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function answerSupplierTicket(id: string, status: string, adminReply?: string) {
  if (!supabase) return;
  const { error } = await supabase.from("support_tickets").update({ status, ...(adminReply ? { admin_reply: adminReply } : {}) }).eq("id", id);
  if (error) throw error;
}
