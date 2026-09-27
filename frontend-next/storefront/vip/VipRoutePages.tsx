import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, EmptyState, ForbiddenState, InlineNotice, MembershipCard, Surface } from "../../shared/components";
import { canonicalClient } from "../../shared/http/clients";
import { buyerApi } from "../../shared/vip/buyer";
import { Link } from "../router";
import type { VipMembershipIdentity } from "./VipCommerceShell";
import { RemoteBoundary, useRemote, VipRoutePage } from "./VipPageParts";

export { VipOrdersPage } from "./VipOrdersPage";
export { VipInvoicesPage } from "./VipInvoicesPage";
export { VipAddressesPage } from "./VipAddressesPage";
export { VipSupportPage } from "./VipSupportPage";
export { VipRequestsPage } from "./VipRequestsPage";

export function VipMembershipPage({ membership }: { membership: VipMembershipIdentity }) {
  const api = useMemo(() => buyerApi(canonicalClient()), []); const plans = useRemote(() => api.plans(), [api]); const [pending, setPending] = useState<string | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const expiry = membership.expiresAt ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(membership.expiresAt)) : "تاریخ پایان اعلام نشده";
  const subscribe = async (planId: string) => { setBusy(planId); setError(""); try { const result = await api.subscribe(planId); setPending(result.status); } catch (reason) { setError(reason instanceof Error ? reason.message : "ثبت درخواست پلن ممکن نشد"); } finally { setBusy(""); } };
  return <VipRoutePage eyebrow="VIP MEMBERSHIP" title="عضویت VIP" description="عضویت فعال این نشست و پلن‌های منتشرشدهٔ سرور."><Surface className="vip-membership-summary"><InlineNotice intent="success" title="عضویت فعال">دسترسی فروشگاه عمده برای این نشست فعال است.</InlineNotice><dl><div><dt>عضو حساب</dt><dd>{membership.memberName || "اعلام نشده"}</dd></div><div><dt>نام فروشگاه</dt><dd>{membership.storeName || "اعلام نشده"}</dd></div><div><dt>پلن</dt><dd>{membership.planName || "اعلام نشده"}</dd></div><div><dt>اعتبار عضویت</dt><dd>{expiry}</dd></div></dl></Surface>{pending ? <InlineNotice intent="info" title="درخواست پلن ثبت شد">وضعیت فعلی درخواست: {pending}. فعال‌سازی هنوز انجام نشده و در سمت سرور بررسی می‌شود.</InlineNotice> : null}{error ? <InlineNotice intent="danger">{error}</InlineNotice> : null}<section><h2>پلن‌های قابل درخواست</h2><RemoteBoundary state={plans}>{(items) => items.filter((plan) => plan.status === "active").length ? <div className="vip-card-grid">{items.filter((plan) => plan.status === "active").map((plan) => <MembershipCard key={plan.id} title={plan.name} plan={`${plan.durationDays} روز`} status={{ label: plan.status }} actions={<Button variant="secondary" disabled={busy === plan.id} onClick={() => void subscribe(plan.id)}>{busy === plan.id ? "در حال ثبت" : "درخواست این پلن"}</Button>} />)}</div> : <EmptyState title="پلن فعالی منتشر نشده است" />}</RemoteBoundary></section></VipRoutePage>;
}

export function VipUnavailableRoute() {
  return <VipRoutePage eyebrow="WHOLESALE" title="این مسیر در فروشگاه جدید وجود ندارد" description="قابلیت‌های بدون پشتوانهٔ سرور از تجربهٔ VIP حذف شده‌اند."><Surface className="vip-deferred-state"><EmptyState title="مسیر پشتیبانی‌نشده" description="برای ادامهٔ خرید به کاتالوگ عمده بروید." action={<Link to="/vip/catalog" className="kolbe-button" data-variant="secondary">بازگشت به فروشگاه <ArrowLeft aria-hidden="true" /></Link>} /></Surface></VipRoutePage>;
}

export function VipCapabilityDeniedPage({ capability }: { capability: "rfq" | "orders" }) {
  const label = capability === "rfq" ? "ثبت و مشاهدهٔ درخواست عمده" : "سفارش‌ها و فاکتورها";
  return <VipRoutePage eyebrow="ACCESS CONTROL" title="دسترسی این بخش فعال نیست" description="مجوز هر قابلیت مستقلاً از نشست سرور خوانده می‌شود."><ForbiddenState title={`مجوز ${label} صادر نشده است`} description="فعال بودن عضویت به‌تنهایی این قابلیت را فعال نمی‌کند. برای بررسی دسترسی با پشتیبانی تماس بگیرید." action={<Link to="/vip/membership" className="kolbe-button" data-variant="secondary">مشاهده عضویت</Link>} /></VipRoutePage>;
}
