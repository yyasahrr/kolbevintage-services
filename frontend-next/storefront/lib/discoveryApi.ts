import { api, loadToken } from "./api";

function adminToken() {
  const token = loadToken("admin");
  if (!token) throw new Error("ورود ادمین انجام نشده است.");
  return token;
}

export function loadChannels() {
  return api<any>("/store/kolbe/admin/channels", { token: adminToken() });
}

export function saveChannel(id: string, body: Record<string, unknown>) {
  return api(`/store/kolbe/admin/channels/${id}`, { method: "POST", token: adminToken(), body });
}

export function createKolbeProduct(body: Record<string, unknown>) {
  return api<any>("/store/kolbe/admin/channels", { method: "POST", token: adminToken(), body });
}

export function uploadImport(body: Record<string, unknown>) {
  return api<any>("/store/kolbe/admin/imports", { method: "POST", token: adminToken(), body });
}

export function mapImport(id: string, mapping: Record<string, string>, mode: string) {
  return api(`/store/kolbe/admin/imports/${id}/map`, { method: "POST", token: adminToken(), body: { mapping, mode } });
}

export function runImport(id: string, dry: boolean) {
  return api<any>(`/store/kolbe/admin/imports/${id}/${dry ? "dry-run" : "run"}`, { method: "POST", token: adminToken(), body: {} });
}

export function loadImports() {
  return api<any>("/store/kolbe/admin/imports", { token: adminToken() });
}

export function loadImportErrors(id: string) {
  return api<any>(`/store/kolbe/admin/imports/${id}/errors`, { token: adminToken() });
}

export function loadSeoHealth() {
  return api<any>("/store/kolbe/admin/seo/health", { token: adminToken() });
}

export function loadSeoIssues() {
  return api<any>("/store/kolbe/admin/seo/issues", { token: adminToken() });
}

export function saveSeoDocument(body: Record<string, unknown>) {
  return api<any>("/store/kolbe/admin/seo/documents", { method: "POST", token: adminToken(), body });
}

export function loadRedirects() {
  return api<any>("/store/kolbe/admin/seo/redirects", { token: adminToken() });
}

export function saveRedirect(body: Record<string, unknown>) {
  return api("/store/kolbe/admin/seo/redirects", { method: "POST", token: adminToken(), body });
}

export function loadRobots() {
  return api<any>("/store/kolbe/admin/seo/robots", { token: adminToken() });
}

export function saveRobots(body: string) {
  return api("/store/kolbe/admin/seo/robots", { method: "POST", token: adminToken(), body: { body } });
}

export function crawlSeo(schedule?: string) {
  return api<any>("/store/kolbe/admin/seo/crawl", { method: "POST", token: adminToken(), body: { schedule } });
}

export function quotePrice(id: string, payMethod: string) {
  return api<any>("/store/kolbe/pricing/quote", { method: "POST", body: { id, payMethod, price: 1, eligibility: true } });
}
