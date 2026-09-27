import { useState, type FormEvent, type ReactNode } from "react";

import { AuthBackLink, AuthError, AuthFooter, AuthForm, AuthHeader, AuthPanel, AuthShell, AuthStatus, AuthStory, presentAuthError, requiresTotp, type AuthErrorPresentation } from "../../shared/auth";
import { Button, InlineNotice, PasswordField, TextField } from "../../shared/components";
import { canonicalClient } from "../../shared/http/clients";
import { Link, useRouter } from "../router";
import { useStorefrontSession, useVipCapabilities, useVipGate } from "../session/SessionProvider";
import { VipCommerceShell, type VipMembershipIdentity } from "../vip/VipCommerceShell";
import { VipAddressesPage, VipCapabilityDeniedPage, VipInvoicesPage, VipMembershipPage, VipOrdersPage, VipRequestsPage, VipSupportPage, VipUnavailableRoute } from "../vip/VipRoutePages";
import { WholesaleCatalogList, WholesaleProductDetailPage } from "./WholesaleCatalog";

export function canonicalVipPath(path: string): string {
  if (path === "/wholesale-dashboard" || path === "/vip/store") return "/vip";
  if (path === "/vip/reorder") return "/vip/orders";
  return path;
}

function VipCatalogRoute({ path, navigate, canRequest }: { path: string; navigate: (to: string) => void; canRequest: boolean }) {
  if (path.startsWith("/vip/catalog/")) return <WholesaleProductDetailPage client={canonicalClient()} productId={decodeURIComponent(path.slice("/vip/catalog/".length))} onBack={() => navigate("/vip/catalog")} canRequest={canRequest} onRequestCreated={() => navigate("/vip/requests")} />;
  if (path.startsWith("/product/")) return <WholesaleProductDetailPage client={canonicalClient()} productId={decodeURIComponent(path.split("/")[2] ?? "")} onBack={() => navigate("/vip/catalog")} canRequest={canRequest} onRequestCreated={() => navigate("/vip/requests")} />;
  return <WholesaleCatalogList client={canonicalClient()} onOpen={(id) => navigate(`/vip/catalog/${id}`)} />;
}

export default function VIPPortal() {
  const { path: rawPath, navigate } = useRouter();
  const path = canonicalVipPath(rawPath);
  const { gate, resolving, error } = useVipGate();
  const capabilities = useVipCapabilities();
  const { logout, refresh } = useStorefrontSession();

  if (resolving) return <AuthStatus label="در حال بررسی عضویت VIP" />;
  if (error) return <VipSessionError onRetry={() => { void refresh(); }} />;
  if (gate.state === "anonymous") return <WholesaleVipLogin />;
  if (gate.state === "pending") return <VipPending />;
  if (gate.state !== "active") return <VipIneligible />;
  if (!capabilities.catalog) return <VipEntitlementDenied />;

  const membership: VipMembershipIdentity = { memberName: gate.memberName ?? "", storeName: gate.storeName ?? "", planName: gate.planName ?? "", expiresAt: gate.expiresAt };
  const handleLogout = () => { void logout().then(() => navigate("/wholesale")); };
  let page: ReactNode;
  if (path === "/vip" || path === "/vip/catalog" || path.startsWith("/vip/catalog/") || path.startsWith("/product/")) page = <VipCatalogRoute path={path} navigate={navigate} canRequest={capabilities.rfq} />;
  else if (path === "/vip/orders") page = capabilities.orders ? <VipOrdersPage /> : <VipCapabilityDeniedPage capability="orders" />;
  else if (path === "/vip/requests") page = capabilities.rfq ? <VipRequestsPage /> : <VipCapabilityDeniedPage capability="rfq" />;
  else if (path === "/vip/invoices") page = capabilities.orders ? <VipInvoicesPage /> : <VipCapabilityDeniedPage capability="orders" />;
  else if (path === "/vip/membership") page = <VipMembershipPage membership={membership} />;
  else if (path === "/vip/addresses") page = <VipAddressesPage />;
  else if (path === "/vip/support") page = <VipSupportPage />;
  else page = <VipUnavailableRoute />;
  return <VipCommerceShell path={path} membership={membership} onLogout={handleLogout}>{page}</VipCommerceShell>;
}

function WholesaleVipLogin() {
  const { login } = useStorefrontSession();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false); const [error, setError] = useState<AuthErrorPresentation | null>(null); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); setSubmitting(true); try { await login({ email, password, ...(totpCode ? { totpCode } : {}) }); } catch (reason) { if (requiresTotp(reason)) setTotpRequired(true); setError(presentAuthError(reason)); } finally { setSubmitting(false); } };
  return <AuthShell story={<AuthStory eyebrow="KOLBE WHOLESALE" title="فضای خرید اختصاصی همکاران کلبه" description="قیمت عمده، موجودی قابل فروش و شرایط تجاری پس از تأیید عضویت سروری نمایش داده می‌شوند." />}><AuthPanel labelledBy="vip-auth-title"><AuthBackLink href="/wholesale">بازگشت به معرفی عمده‌فروشی</AuthBackLink><AuthHeader id="vip-auth-title" eyebrow="دسترسی خریدار عمده" title="ورود اعضای VIP" description="با حسابی وارد شوید که درخواست یا عضویت عمده‌فروشی روی آن ثبت شده است." /><AuthForm onSubmit={submit}><TextField type="email" label="ایمیل" autoComplete="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={submitting} /><PasswordField label="رمز عبور" autoComplete="current-password" value={password} onChange={setPassword} required disabled={submitting} />{totpRequired ? <TextField label="کد یک‌بارمصرف" autoComplete="one-time-code" inputMode="numeric" dir="ltr" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required disabled={submitting} /> : null}<AuthError error={error} /><Button type="submit" disabled={submitting}>{submitting ? "در حال بررسی عضویت" : "ورود به فروشگاه عمده"}</Button></AuthForm><AuthFooter>ورود موفق به‌تنهایی عضویت VIP ایجاد نمی‌کند؛ وضعیت و مجوز کاتالوگ از نشست سرور خوانده می‌شود.</AuthFooter></AuthPanel></AuthShell>;
}

function VipGateShell({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return <AuthShell story={<AuthStory eyebrow="KOLBE WHOLESALE" title="همکاری عمده، با دسترسی روشن" description="وضعیت حساب و قابلیت‌های خرید همیشه از قرارداد سرور تعیین می‌شوند." />}><AuthPanel><AuthHeader eyebrow="وضعیت عضویت" title={title} description={body} />{children}<AuthFooter>برای تغییر وضعیت عضویت، از مسیر رسمی درخواست عمده‌فروشی استفاده کنید.</AuthFooter></AuthPanel></AuthShell>;
}

function VipEntitlementDenied() { const { logout } = useStorefrontSession(); return <VipGateShell title="دسترسی کاتالوگ برای این حساب فعال نیست" body="عضویت شما فعال است، اما مجوز مشاهده کاتالوگ در نشست سرور صادر نشده است."><InlineNotice intent="warning">فعال بودن عضویت به‌تنهایی همه قابلیت‌های عمده‌فروشی را فعال نمی‌کند.</InlineNotice><Button variant="secondary" onClick={() => { void logout(); }}>خروج از حساب</Button></VipGateShell>; }
function VipSessionError({ onRetry }: { onRetry: () => void }) { return <VipGateShell title="بررسی عضویت ممکن نشد" body="اتصال به سرور برای احراز عضویت VIP برقرار نشد. این خطا به معنی عدم عضویت نیست."><Button onClick={onRetry}>تلاش مجدد</Button><Link to="/wholesale">بازگشت به معرفی عمده‌فروشی</Link></VipGateShell>; }
function VipIneligible() { const { logout } = useStorefrontSession(); return <VipGateShell title="عضویت VIP فعال نیست" body="حساب شما وارد شده است، اما عضویت عمده‌فروشی روی آن فعال نیست."><Link to="/wholesale/join" className="kolbe-button">ثبت درخواست عضویت</Link><Button variant="quiet" onClick={() => { void logout(); }}>خروج از حساب</Button></VipGateShell>; }
function VipPending() { const { logout } = useStorefrontSession(); return <VipGateShell title="درخواست عضویت در انتظار تأیید است" body="درخواست عضویت عمده‌فروشی شما ثبت شده و در انتظار بررسی کلبه است."><Link to="/wholesale" className="kolbe-button" data-variant="secondary">بازگشت</Link><Button variant="quiet" onClick={() => { void logout(); }}>خروج از حساب</Button></VipGateShell>; }
