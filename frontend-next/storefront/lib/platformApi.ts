import { api, loadToken } from "./api";

function adminToken() {
  const token = loadToken("admin");
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  return token;
}

export async function loadSupplier360(id: string) {
  return api<any>(`/store/kolbe/admin/suppliers/${id}/360`, { token: adminToken() });
}

export async function updateSupplierStatus(id: string, body: { status: string; reason: string; note?: string; until?: string }) {
  return api(`/store/kolbe/admin/suppliers/${id}/status`, { method: "POST", token: adminToken(), body });
}

export async function updateSupplierProfile(id: string, body: Record<string, unknown>) {
  return api(`/store/kolbe/admin/suppliers/${id}/profile`, { method: "POST", token: adminToken(), body });
}

export async function updateSupplierRestriction(id: string, body: Record<string, unknown>) {
  return api(`/store/kolbe/admin/suppliers/${id}/restrictions`, { method: "POST", token: adminToken(), body });
}

export async function addSupplierDocument(id: string, body: { title: string; status?: string; note?: string }) {
  return api(`/store/kolbe/admin/suppliers/${id}/documents`, { method: "POST", token: adminToken(), body });
}

export async function loadBuyers() {
  const data = await api<{ buyers: any[] }>("/store/kolbe/admin/buyers", { token: adminToken() });
  return data.buyers ?? [];
}

export async function loadBuyer360(id: string) {
  return api<any>(`/store/kolbe/admin/buyers/${id}/360`, { token: adminToken() });
}

export async function updateBuyer(id: string, action: "status" | "plan" | "credit" | "note", body: Record<string, unknown>) {
  return api(`/store/kolbe/admin/buyers/${id}/${action}`, { method: "POST", token: adminToken(), body });
}

export async function verifySandboxPayment(id: string) {
  return api(`/store/kolbe/admin/membership/payments/${id}/verify-sandbox`, { method: "POST", token: adminToken(), body: {} });
}

export async function loadCrmLabels() {
  return api<{ labels: any[] }>("/store/kolbe/admin/crm/labels", { token: adminToken() });
}

export async function evaluateCrm() {
  return api<{ assigned: number; buyers: number }>("/store/kolbe/admin/crm/evaluate", { method: "POST", token: adminToken(), body: {} });
}

export async function createCrmCampaign(body: { name: string; body: string; labelCode: string }) {
  return api<{ id: string; recipients: number }>("/store/kolbe/admin/crm/campaigns", { method: "POST", token: adminToken(), body });
}

export async function assignCrmLabel(body: { labelCode: string; subjectId: string; note?: string }) {
  return api("/store/kolbe/admin/crm/assignments", { method: "POST", token: adminToken(), body });
}

export async function loadIntegrations() {
  return api<{ endpoints: any[]; deliveries: any[]; events: string[] }>("/store/kolbe/admin/integrations", { token: adminToken() });
}

export async function saveIntegration(body: { name: string; url: string; secret: string; events: string[] }) {
  return api("/store/kolbe/admin/integrations", { method: "POST", token: adminToken(), body });
}

export async function loadInvoiceTemplates() {
  return api<{ templates: any[]; variables: string[] }>("/store/kolbe/admin/invoice-templates", { token: adminToken() });
}

export async function saveInvoiceTemplate(body: { code: string; name: string; kind: string; body: Record<string, unknown> }) {
  return api("/store/kolbe/admin/invoice-templates", { method: "POST", token: adminToken(), body });
}

export async function loadInvoices() {
  return api<{ invoices: any[]; statusLabels?: Record<string, string>; kindLabels?: Record<string, string> }>("/store/kolbe/admin/invoices", { token: adminToken() });
}

export async function setInvoiceStatus(id: string, status: string, reason: string) {
  return api(`/store/kolbe/admin/invoices/${id}/status`, { method: "POST", token: adminToken(), body: { status, reason } });
}

export async function issueDocument(body: Record<string, unknown>) {
  return api<{ invoice: any }>("/store/kolbe/admin/invoices/issue", { method: "POST", token: adminToken(), body });
}

export async function setCommission(id: string, rate: number, reason: string) {
  return api(`/store/kolbe/admin/suppliers/${id}/commission`, { method: "POST", token: adminToken(), body: { rate, reason } });
}

export async function setBuyerRestriction(id: string, body: Record<string, unknown>) {
  return api(`/store/kolbe/admin/buyers/${id}/restrictions`, { method: "POST", token: adminToken(), body });
}

export async function addBuyerAddress(id: string, body: { city: string; line: string; label?: string }) {
  return api(`/store/kolbe/admin/buyers/${id}/addresses`, { method: "POST", token: adminToken(), body });
}

export async function addBuyerDocument(id: string, body: { title: string; note?: string }) {
  return api(`/store/kolbe/admin/buyers/${id}/documents`, { method: "POST", token: adminToken(), body });
}

export async function loadAutomations() {
  return api<{ automations: any[] }>("/store/kolbe/admin/crm/automations", { token: adminToken() });
}

export async function saveAutomation(body: { name: string; eventName: string; action: string; labelCode?: string; body?: string; couponCode?: string }) {
  return api("/store/kolbe/admin/crm/automations", { method: "POST", token: adminToken(), body });
}

export async function refundMembership(id: string, reason: string) {
  return api(`/store/kolbe/admin/membership/payments/${id}/refund`, { method: "POST", token: adminToken(), body: { reason, suspend: true } });
}

export async function checkoutMembership(input: { planCode: string; storeName: string; phone: string; city: string; memberName?: string }) {
  const token = loadToken("customer");
  if (!token) throw new Error("ابتدا وارد حساب کاربری فروشگاه شوید.");
  return api<{ paymentId: string; status: string; amount: number; intent: string; activated: boolean }>("/store/kolbe/membership/checkout", { method: "POST", token, body: input });
}

export async function openInvoicePdf(id: string) {
  const token = adminToken();
  const result = await fetch(`/store/kolbe/admin/invoices/${id}/pdf`, { headers: { authorization: `Bearer ${token}` } });
  if (!result.ok) throw new Error("سند قابل دریافت نیست.");
  const blob = await result.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const money = (value: number) => new Intl.NumberFormat("fa-IR").format(value || 0) + " تومان";
