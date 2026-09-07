import { useState } from "react";
import { Link } from "../router";
import { fa } from "../utils/format";
import Icon from "../components/Icon";
import { loadWholesaleMembership } from "../wholesaleMembership";

type DraftLine = { key: string; productName: string; productCode: string; colour: string; colourHex: string; size: string; qty: number };
type WholesaleOrder = { code: string; date: string; status: "در انتظار تأیید" | "تأیید شده" | "در حال آماده‌سازی"; lines: DraftLine[]; totalQty: number };

const draftKey = "kv_wholesale_draft";
const ordersKey = "kv_wholesale_orders";
const readStorage = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const tabs = [
  { id: "overview", label: "نمای کلی", icon: "user" },
  { id: "draft", label: "پیش‌سفارش کالکشن", icon: "bag" },
  { id: "orders", label: "سفارش‌های عمده", icon: "truck" },
  { id: "membership", label: "عضویت و پشتیبانی", icon: "shield" },
] as const;

export default function WholesaleDashboard() {
  const [membership] = useState(loadWholesaleMembership);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("overview");
  const [draft, setDraft] = useState<DraftLine[]>(() => readStorage(draftKey, []));
  const [orders, setOrders] = useState<WholesaleOrder[]>(() => readStorage(ordersKey, []));
  const [submittedCode, setSubmittedCode] = useState("");
  const draftTotal = draft.reduce((sum, line) => sum + line.qty, 0);
  const orderedTotal = orders.reduce((sum, order) => sum + order.totalQty, 0);

  const persistDraft = (next: DraftLine[]) => { setDraft(next); localStorage.setItem(draftKey, JSON.stringify(next)); };
  const updateQty = (key: string, qty: number) => persistDraft(draft.map((line) => line.key === key ? { ...line, qty: Math.max(1, Math.min(999, qty)) } : line));
  const submitOrder = () => {
    if (!draft.length) return;
    const order: WholesaleOrder = { code: `KVW-${String(Date.now()).slice(-6)}`, date: new Date().toLocaleDateString("fa-IR"), status: "در انتظار تأیید", lines: draft, totalQty: draftTotal };
    const nextOrders = [order, ...orders];
    setOrders(nextOrders); localStorage.setItem(ordersKey, JSON.stringify(nextOrders)); persistDraft([]); setSubmittedCode(order.code); setActiveTab("orders");
  };

  if (!membership) return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f6f4] px-4 text-center">
      <Icon name="user" className="h-9 w-9" strokeWidth={1.2} /><h1 className="mt-5 text-[21px] font-medium">حساب همکاری فعال نیست</h1>
      <p className="mt-2 max-w-md text-[12.5px] leading-[2] text-neutral-500">برای ورود به داشبورد عمده، ابتدا یکی از اشتراک‌های VIP را فعال کنید.</p>
      <Link to="/wholesale?section=plans" className="mt-6 bg-[#011c3a] px-7 py-3 text-[12.5px] text-white">مشاهده اشتراک‌ها</Link>
    </main>
  );

  return (
    <div className="min-h-screen bg-[#f2f2ef]">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#011c3a] text-white">
        <div className="mx-auto flex w-full items-center justify-between px-4 py-4 lg:px-8">
          <div className="flex items-center gap-4"><div className="flex h-9 w-9 items-center justify-center border border-white/30 text-[11px] font-semibold">KV</div><div><p className="text-[14px] font-medium">پنل شرکای تجاری</p><p className="mt-0.5 text-[8px] tracking-[0.3em] text-white/45">KOLBE VINTAGE WHOLESALE</p></div></div>
          <div className="flex items-center gap-3 sm:gap-5"><Link to="/wholesale?section=catalog" className="hidden text-[11.5px] text-white/70 hover:text-white sm:block">کاتالوگ عمده</Link><div className="border-r border-white/20 pr-3 text-left sm:pr-5"><p className="text-[10.5px] font-medium">{membership.storeName}</p><p className="mt-0.5 text-[8.5px] text-white/45">VIP · {membership.planName}</p></div></div>
        </div>
      </header>

      <div className="mx-auto grid w-full lg:grid-cols-[230px_1fr]">
        <aside className="border-b border-neutral-200 bg-white p-3 lg:min-h-[calc(100vh-73px)] lg:border-b-0 lg:border-l lg:p-5">
          <div className="hidden border-b border-neutral-200 pb-5 lg:block"><span className="inline-block bg-[#011c3a] px-2 py-1 text-[8.5px] text-white">VIP ACTIVE</span><p className="mt-3 text-[13px] font-medium">{membership.memberName}</p><p className="mt-1 text-[10.5px] text-neutral-400 num-fa">{membership.phone}</p></div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:mt-5 lg:block lg:space-y-1">
            {tabs.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={"flex shrink-0 items-center gap-2.5 px-3 py-2.5 text-[11.5px] transition lg:w-full " + (activeTab === tab.id ? "bg-[#011c3a] text-white" : "text-neutral-600 hover:bg-neutral-100")}><Icon name={tab.icon} className="h-3.5 w-3.5" />{tab.label}{tab.id === "draft" && draft.length > 0 && <span className="mr-auto bg-white/15 px-1.5 text-[9px] num-fa">{fa(draft.length)}</span>}</button>)}
          </nav>
          <div className="mt-8 hidden border-t border-neutral-200 pt-5 lg:block"><p className="text-[9.5px] text-neutral-400">کارشناس اختصاصی شما</p><p className="mt-2 text-[11.5px] font-medium">نگار کاویانی</p><a href="tel:02191002233" className="mt-1 block text-[10.5px] text-neutral-500 num-fa">۰۲۱-۹۱۰۰۲۲۳۳ داخلی ۲</a></div>
        </aside>

        <main className="min-w-0 p-4 lg:p-8">
          {activeTab === "overview" && <Overview membership={membership} draftTotal={draftTotal} draftCount={draft.length} orders={orders} orderedTotal={orderedTotal} onTab={setActiveTab} />}
          {activeTab === "draft" && <DraftPanel draft={draft} total={draftTotal} onQty={updateQty} onRemove={(key) => persistDraft(draft.filter((line) => line.key !== key))} onSubmit={submitOrder} />}
          {activeTab === "orders" && <OrdersPanel orders={orders} submittedCode={submittedCode} onDraft={() => setActiveTab("draft")} />}
          {activeTab === "membership" && <MembershipPanel membership={membership} />}
        </main>
      </div>
    </div>
  );
}

function Overview({ membership, draftTotal, draftCount, orders, orderedTotal, onTab }: { membership: NonNullable<ReturnType<typeof loadWholesaleMembership>>; draftTotal: number; draftCount: number; orders: WholesaleOrder[]; orderedTotal: number; onTab: (tab: "draft" | "orders" | "membership") => void }) {
  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] tracking-[0.2em] text-neutral-400">OVERVIEW</p><h1 className="mt-2 text-[24px] font-medium">سلام، {membership.memberName}</h1><p className="mt-1.5 text-[11.5px] text-neutral-500">خلاصه وضعیت همکاری و سفارش‌های {membership.storeName}</p></div><Link to="/wholesale?section=catalog" className="flex h-10 items-center gap-2 bg-[#011c3a] px-5 text-[11.5px] font-medium text-white">سفارش جدید <Icon name="arrowLeft" className="h-3.5 w-3.5" /></Link></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[fa(draftTotal), "کالا در پیش‌سفارش", "آماده ویرایش"], [fa(orders.length), "سفارش ثبت‌شده", `${fa(orderedTotal)} قلم`], [membership.planName, "سطح همکاری", "VIP فعال"], [membership.expiresAt, "اعتبار اشتراک", "تمدید سالانه"]].map(([value, label, note]) => <div key={label} className="bg-white p-5"><p className="text-[10px] text-neutral-400">{label}</p><p className="mt-3 text-[20px] font-medium num-fa">{value}</p><p className="mt-2 text-[9.5px] text-neutral-400">{note}</p></div>)}</section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="bg-white p-5 lg:p-6"><div className="flex items-center justify-between"><div><p className="text-[10px] text-neutral-400">ORDER PIPELINE</p><h2 className="mt-1 text-[15px] font-medium">پیگیری سفارش‌ها</h2></div><button onClick={() => onTab("orders")} className="text-[10.5px] underline underline-offset-2">مشاهده همه</button></div><div className="mt-6 grid grid-cols-3 gap-2">{["در انتظار تأیید", "تأیید شده", "در حال آماده‌سازی"].map((status) => <div key={status} className="border-t-2 border-[#011c3a] bg-[#f6f6f4] p-4"><p className="text-[19px] font-medium num-fa">{fa(orders.filter((order) => order.status === status).length)}</p><p className="mt-2 text-[9.5px] text-neutral-500">{status}</p></div>)}</div>{draftCount > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[#011c3a] p-4"><div><p className="text-[11.5px] font-medium">پیش‌سفارش شما آماده ثبت است</p><p className="mt-1 text-[10px] text-neutral-500 num-fa">{fa(draftCount)} ردیف · {fa(draftTotal)} عدد</p></div><button onClick={() => onTab("draft")} className="bg-[#011c3a] px-4 py-2.5 text-[10.5px] text-white">بررسی و ثبت</button></div>}</div>
      <div className="bg-[#011c3a] p-5 text-white lg:p-6"><p className="text-[9px] tracking-[0.2em] text-white/45">YOUR MEMBERSHIP</p><h2 className="mt-3 text-[19px] font-medium">{membership.planName}</h2><p className="mt-2 text-[11px] text-white/60">عضویت VIP فعال از {membership.activatedAt}</p><ul className="mt-6 space-y-3 text-[10.5px] text-white/75">{["قیمت‌گذاری اختصاصی عمده", "اولویت در کالکشن‌های محدود", "پشتیبانی کارشناس اختصاصی", "ارسال رایگان سفارش‌های عمده"].map((item) => <li key={item} className="flex gap-2"><Icon name="check" className="mt-0.5 h-3 w-3" strokeWidth={2.4} />{item}</li>)}</ul><button onClick={() => onTab("membership")} className="mt-7 border border-white/30 px-4 py-2.5 text-[10.5px] hover:border-white">مدیریت عضویت</button></div>
    </section>
  </div>;
}

function DraftPanel({ draft, total, onQty, onRemove, onSubmit }: { draft: DraftLine[]; total: number; onQty: (key: string, qty: number) => void; onRemove: (key: string) => void; onSubmit: () => void }) {
  return <div><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[10px] tracking-[0.2em] text-neutral-400">DRAFT ORDER</p><h1 className="mt-2 text-[24px] font-medium">پیش‌سفارش کالکشن</h1><p className="mt-1.5 text-[11.5px] text-neutral-500">تعداد هر ردیف را ویرایش و سپس سفارش را برای تأیید نهایی ارسال کنید.</p></div><Link to="/wholesale?section=catalog" className="border border-[#011c3a] px-5 py-2.5 text-[11px]">+ افزودن محصول</Link></div><div className="bg-white p-4 lg:p-6">{draft.length ? <><div className="divide-y divide-neutral-200 border-y border-neutral-200">{draft.map((line) => <div key={line.key} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-[12px] font-medium">{line.productName}</p><p className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500"><span className="h-3 w-3 rounded-full border" style={{ background: line.colourHex }} />{line.colour} · سایز {line.size} · کد {line.productCode}</p></div><label className="flex items-center gap-2 text-[10px] text-neutral-500">تعداد<input type="number" min={1} max={999} value={line.qty} onChange={(e) => onQty(line.key, Number(e.target.value) || 1)} className="h-9 w-20 border border-neutral-300 px-2 text-center text-[11.5px] outline-none focus:border-[#011c3a] num-fa" /></label><button onClick={() => onRemove(line.key)} className="text-right text-[10.5px] text-red-700 underline sm:text-center">حذف</button></div>)}</div><div className="mt-5 flex flex-wrap items-center justify-between gap-4 bg-[#f6f6f4] p-5"><div><p className="text-[10px] text-neutral-500">جمع کل پیش‌سفارش</p><p className="mt-1 text-[20px] font-medium num-fa">{fa(total)} عدد</p></div><button onClick={onSubmit} className="h-11 bg-[#011c3a] px-7 text-[11.5px] font-medium text-white">ثبت نهایی سفارش</button></div></> : <div className="py-16 text-center"><Icon name="bag" className="mx-auto h-8 w-8 text-neutral-300" /><p className="mt-4 text-[13px] font-medium">پیش‌سفارش شما خالی است</p><p className="mt-1 text-[10.5px] text-neutral-400">از کاتالوگ، ترکیب محصول، رنگ، سایز و تعداد را اضافه کنید.</p><Link to="/wholesale?section=catalog" className="mt-5 inline-block bg-[#011c3a] px-5 py-2.5 text-[11px] text-white">رفتن به کاتالوگ</Link></div>}</div></div>;
}

function OrdersPanel({ orders, submittedCode, onDraft }: { orders: WholesaleOrder[]; submittedCode: string; onDraft: () => void }) {
  return <div><div className="mb-7"><p className="text-[10px] tracking-[0.2em] text-neutral-400">ORDERS</p><h1 className="mt-2 text-[24px] font-medium">سفارش‌های عمده</h1><p className="mt-1.5 text-[11.5px] text-neutral-500">وضعیت بررسی، تأیید و آماده‌سازی سفارش‌ها را دنبال کنید.</p></div>{submittedCode && <div className="mb-4 flex items-center gap-3 border border-[#3d5c3a] bg-[#f0f5f0] p-4 text-[11.5px] text-[#3d5c3a]"><Icon name="check" className="h-4 w-4" strokeWidth={2.4} />سفارش {submittedCode} ثبت شد و در انتظار تأیید کارشناس است.</div>}<div className="space-y-3">{orders.map((order) => <article key={order.code} className="bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[12.5px] font-medium num-fa">{order.code}</p><p className="mt-1 text-[10px] text-neutral-400">{order.date} · {fa(order.lines.length)} ردیف</p></div><span className="bg-[#f6f6f4] px-2.5 py-1 text-[10px]">{order.status}</span><p className="text-[12px] font-medium num-fa">{fa(order.totalQty)} عدد</p></div><details className="mt-4 border-t border-neutral-200 pt-3"><summary className="cursor-pointer text-[10.5px] text-neutral-500">مشاهده اقلام سفارش</summary><div className="mt-3 divide-y divide-neutral-100">{order.lines.map((line) => <div key={line.key} className="flex justify-between gap-3 py-2 text-[10.5px]"><span>{line.productName} · {line.colour} · {line.size}</span><span className="shrink-0 num-fa">{fa(line.qty)} عدد</span></div>)}</div></details></article>)}{!orders.length && <div className="bg-white py-16 text-center"><p className="text-[13px] font-medium">هنوز سفارشی ثبت نشده است</p><button onClick={onDraft} className="mt-3 text-[11px] underline underline-offset-2">مشاهده پیش‌سفارش</button></div>}</div></div>;
}

function MembershipPanel({ membership }: { membership: NonNullable<ReturnType<typeof loadWholesaleMembership>> }) {
  return <div><div className="mb-7"><p className="text-[10px] tracking-[0.2em] text-neutral-400">MEMBERSHIP</p><h1 className="mt-2 text-[24px] font-medium">عضویت و پشتیبانی</h1><p className="mt-1.5 text-[11.5px] text-neutral-500">اطلاعات حساب VIP، اعتبار اشتراک و کانال‌های پشتیبانی.</p></div><div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"><section className="bg-white p-5 lg:p-6"><div className="flex items-start justify-between"><div><span className="bg-[#011c3a] px-2 py-1 text-[8.5px] text-white">VIP ACTIVE</span><h2 className="mt-4 text-[19px] font-medium">{membership.planName}</h2></div><span className="text-[10.5px] text-neutral-400">اعتبار تا {membership.expiresAt}</span></div><div className="mt-6 grid gap-3 border-t border-neutral-200 pt-5 sm:grid-cols-2">{[["نام عضو", membership.memberName], ["فروشگاه", membership.storeName], ["شماره تماس", membership.phone], ["شهر", membership.city], ["تاریخ فعال‌سازی", membership.activatedAt], ["وضعیت", "فعال"]].map(([label, value]) => <div key={label} className="bg-[#f6f6f4] p-3"><p className="text-[9.5px] text-neutral-400">{label}</p><p className="mt-1 text-[11.5px] font-medium num-fa">{value}</p></div>)}</div><Link to="/wholesale?section=plans" className="mt-5 inline-block border border-[#011c3a] px-5 py-2.5 text-[11px]">تمدید یا ارتقای اشتراک</Link></section><section className="bg-[#011c3a] p-5 text-white lg:p-6"><p className="text-[9px] tracking-[0.2em] text-white/45">DEDICATED SUPPORT</p><h2 className="mt-3 text-[17px] font-medium">نگار کاویانی</h2><p className="mt-1 text-[10.5px] text-white/55">کارشناس اختصاصی فروش عمده</p><div className="mt-6 space-y-2"><a href="tel:02191002233" className="flex items-center justify-between border border-white/20 px-4 py-3 text-[11px] hover:border-white"><span>تماس مستقیم</span><span className="num-fa">۰۲۱-۹۱۰۰۲۲۳۳</span></a><a href="mailto:wholesale@kolbevintage.ir" className="flex items-center justify-between border border-white/20 px-4 py-3 text-[11px] hover:border-white"><span>ارسال ایمیل</span><span>wholesale@kolbevintage.ir</span></a></div><p className="mt-5 text-[9.5px] leading-[1.8] text-white/45">پاسخ‌گویی شنبه تا چهارشنبه، ساعت ۹ تا ۱۷</p></section></div></div>;
}
