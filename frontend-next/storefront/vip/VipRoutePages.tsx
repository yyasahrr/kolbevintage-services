import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState, InlineNotice, Surface } from "../../shared/components";
import { Link } from "../router";
import type { VipMembershipIdentity } from "./VipCommerceShell";

type PageCopy = { eyebrow: string; title: string; description: string };

function RoutePage({ copy, children }: { copy: PageCopy; children: ReactNode }) {
  return <section className="vip-route-page" aria-labelledby="vip-route-title"><header className="vip-route-page__header"><p>{copy.eyebrow}</p><h1 id="vip-route-title">{copy.title}</h1><span>{copy.description}</span></header>{children}</section>;
}

function DeferredCapability({ title, description }: { title: string; description: string }) {
  return <Surface className="vip-deferred-state"><EmptyState title={title} description={description} action={<Link to="/vip/catalog" className="kolbe-button" data-variant="secondary">بازگشت به فروشگاه <ArrowLeft aria-hidden="true" /></Link>} /></Surface>;
}

export function VipOrdersPage() {
  return <RoutePage copy={{ eyebrow: "ORDER HISTORY", title: "سفارش‌ها", description: "سفارش‌های ثبت‌شده این حساب در این مسیر نمایش داده خواهند شد." }}><DeferredCapability title="نمایش سفارش‌ها در حال تکمیل است" description="در این مرحله هیچ سفارش نمونه یا رکورد مرورگری نمایش داده نمی‌شود. اتصال کامل فهرست، جزئیات و رهگیری سفارش در Checkpoint 05 انجام می‌شود." /></RoutePage>;
}

export function VipInvoicesPage() {
  return <RoutePage copy={{ eyebrow: "DOCUMENTS", title: "فاکتورها", description: "اسناد مالی واقعی حساب عمده در این بخش قرار می‌گیرند." }}><DeferredCapability title="فاکتور واقعی هنوز به این صفحه متصل نشده است" description="این صفحه عمداً شماره، مبلغ یا وضعیت پرداخت ساختگی نشان نمی‌دهد. اتصال داده و جزئیات فاکتور در Checkpoint 05 انجام می‌شود." /></RoutePage>;
}

export function VipAddressesPage() {
  return <RoutePage copy={{ eyebrow: "SHIPPING", title: "آدرس‌های ارسال", description: "مقصدهای تحویل ثبت‌شده در حساب تجاری شما." }}><DeferredCapability title="مدیریت آدرس‌ها در حال تکمیل است" description="تا اتصال قرارداد canonical آدرس، هیچ آدرس پیش‌فرض یا نمونه‌ای در مرورگر ساخته نمی‌شود." /></RoutePage>;
}

export function VipSupportPage() {
  return <RoutePage copy={{ eyebrow: "CUSTOMER CARE", title: "پشتیبانی", description: "پیگیری مسائل سفارش، پرداخت و ارسال از مسیر رسمی پشتیبانی عمده." }}><DeferredCapability title="پرونده‌های پشتیبانی در حال اتصال هستند" description="تاریخچه یا کد پیگیری ساختگی در این صفحه وجود ندارد. پرونده‌ها و پیام‌های واقعی در Checkpoint 05 متصل می‌شوند." /></RoutePage>;
}

export function VipMembershipPage({ membership }: { membership: VipMembershipIdentity }) {
  const expiry = membership.expiresAt ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(membership.expiresAt)) : "تاریخ پایان اعلام نشده";
  return <RoutePage copy={{ eyebrow: "VIP MEMBERSHIP", title: "عضویت VIP", description: "اطلاعاتی که سرور برای عضویت این حساب تأیید کرده است." }}>
    <Surface className="vip-membership-summary">
      <InlineNotice intent="success" title="عضویت فعال">دسترسی فروشگاه عمده برای این نشست فعال است.</InlineNotice>
      <dl>
        <div><dt>عضو حساب</dt><dd>{membership.memberName || "اعلام نشده"}</dd></div>
        <div><dt>نام فروشگاه</dt><dd>{membership.storeName || "اعلام نشده"}</dd></div>
        <div><dt>پلن</dt><dd>{membership.planName || "اعلام نشده"}</dd></div>
        <div><dt>اعتبار عضویت</dt><dd>{expiry}</dd></div>
      </dl>
    </Surface>
  </RoutePage>;
}

export function VipUnavailableRoute() {
  return <RoutePage copy={{ eyebrow: "WHOLESALE", title: "این مسیر در فروشگاه جدید وجود ندارد", description: "قابلیت‌های بدون پشتوانهٔ سرور از تجربهٔ VIP حذف شده‌اند." }}><DeferredCapability title="مسیر پشتیبانی‌نشده" description="برای ادامهٔ خرید به کاتالوگ عمده بروید. این صفحه هیچ قابلیت قدیمی یا دادهٔ محلی را بازسازی نمی‌کند." /></RoutePage>;
}
