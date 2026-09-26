import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { Link } from "../router";
import { products } from "../data/catalog";
import { fa, toman } from "../utils/format";
import { loadTickets, saveTickets, type SupportTicket } from "../wholesaleSupport";
import { loadWholesaleMembership } from "../wholesaleMembership";
import { isBackendConfigured } from "../lib/api";
import { answerSupplierTicket, approveWholesaleOrder, bulkUpdateWholesalePrice, cancelWholesaleOrder, listSupplierApplications, listSupplierCatalogProducts, listSupplierTickets, listSuppliers, listWholesaleAccounts, listWholesaleFulfillmentOrders, updateSupplierApplication, updateSupplierProductStatus, updateWholesaleAccountStatus, type AdminSupplier, type AdminSupplierProduct, type AdminWholesaleAccount } from "../lib/wholesaleApi";
import WholesaleCatalogManager from "./WholesaleCatalogManager";
import SupplierModerationPage from "./SupplierModeration";

type WholesaleTab = "overview" | "direct" | "marketplace" | "fulfillment" | "plans" | "members" | "accounts" | "orders" | "support" | "catalog";
type WholesaleOrder = { id?: string; code: string; totalQty: number; totalAmount?: number; status: string; date: string; storeName?: string; lines?: Array<{ productName: string; productCode: string; colour: string; size: string; qty: number }>; purchaseOrders?: Array<{ id: string; orderCode: string; status: string; supplierName: string; trackingCode: string | null }> };
type WholesaleLead = { id?: string; name: string; store: string; city: string; phone: string; plan: string; status: "جدید" | "در تماس" | "تأیید شده" | "رد شده" };

const leadKey = "kv_admin_wholesale_requests";
const orderKey = "kv_wholesale_orders";
const seedLeads: WholesaleLead[] = [
  { name: "مهدی نوری", store: "گالری نوری", city: "اصفهان", phone: "۰۹۱۳۱۲۳۴۵۶۷", plan: "حرفه‌ای", status: "جدید" },
  { name: "سارا احمدی", store: "بوتیک سارا", city: "شیراز", phone: "۰۹۱۷۹۸۷۶۵۴۳", plan: "وی‌آی‌پی", status: "در تماس" },
  { name: "رضا طاهری", store: "پوشاک طاهری", city: "تبریز", phone: "۰۹۱۴۱۱۲۲۳۳۴", plan: "همکار", status: "تأیید شده" },
];

function readStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

const tabs: Array<{ id: WholesaleTab; label: string; icon: string }> = [
  { id: "overview", label: "نمای عملیات", icon: "star" },
  { id: "direct", label: "محصولات عمده کلبه", icon: "bag" },
  { id: "marketplace", label: "کاتالوگ ساپلایرها", icon: "pin" },
  { id: "fulfillment", label: "تامین و تجمیع", icon: "truck" },
  { id: "plans", label: "پلن‌های VIP", icon: "shield" },
  { id: "members", label: "ساپلایرها", icon: "user" },
  { id: "accounts", label: "خریداران VIP", icon: "shield" },
  { id: "orders", label: "سفارش‌های عمده", icon: "truck" },
  { id: "support", label: "پشتیبانی", icon: "mail" },
  /**
   * این تب پیش‌تر در `tabs` وجود نداشت، با این‌که شاخهٔ رندرِ `catalog`
   * نوشته شده بود؛ یعنی صفحهٔ بازبینی هرگز از UI قابلِ رسیدن نبود.
   */
  { id: "catalog", label: "بازبینی محصولات ساپلایر", icon: "shield" },
];

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

export default function WholesaleAdmin() {
  const [tab, setTab] = useState<WholesaleTab>("overview");
  const [leads, setLeads] = useState<WholesaleLead[]>(() => readStorage(leadKey, seedLeads));
  const [orders, setOrders] = useState<WholesaleOrder[]>(() => readStorage(orderKey, []));
  const [tickets, setTickets] = useState(loadTickets);
  const [suppliers, setSuppliers] = useState<AdminSupplier[]>([]);
  const [accounts, setAccounts] = useState<AdminWholesaleAccount[]>([]);
  const [supplierProducts, setSupplierProducts] = useState<AdminSupplierProduct[]>([]);
  const membership = loadWholesaleMembership();
  const [notice, setNotice] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const [loading, setLoading] = useState(isBackendConfigured);

  useEffect(() => {
    if (!isBackendConfigured) return;
    Promise.all([listSupplierApplications(), listSuppliers(), listSupplierCatalogProducts(), listWholesaleFulfillmentOrders(), listSupplierTickets(), listWholesaleAccounts()]).then(([applications, remoteSuppliers, remoteProducts, remoteOrders, remoteTickets, remoteAccounts]) => {
      setAccounts(remoteAccounts);
      setSuppliers(remoteSuppliers);
      setSupplierProducts(remoteProducts);
      setLeads(applications.map((item) => ({ id: item.id, name: item.representativeName, store: item.companyName, city: "—", phone: item.phone, plan: item.category, status: item.status === "pending" ? "جدید" : item.status === "reviewing" ? "در تماس" : item.status === "approved" ? "تأیید شده" : "رد شده" })));
      setOrders(remoteOrders.map((order) => ({ id: order.id, code: order.orderCode, totalQty: order.totalUnits, totalAmount: order.totalAmount, storeName: order.storeName, status: order.status === "pending" ? "در انتظار تأیید" : order.status === "confirmed" ? "تأیید شده" : order.status === "preparing" ? "در حال آماده‌سازی" : order.status === "shipped" ? "ارسال شده" : order.status === "delivered" ? "تحویل شده" : "لغو شده", date: new Intl.DateTimeFormat("fa-IR").format(new Date(order.createdAt)), lines: order.items.map((item) => ({ productName: item.productName, productCode: item.sku, colour: "—", size: "—", qty: item.quantity })), purchaseOrders: order.purchaseOrders })));
      setTickets(remoteTickets.map((ticket) => ({ id: ticket.id, customerId: "supplier", subject: ticket.subject, category: ticket.category, message: ticket.message, status: ticket.status === "open" ? "باز" : ticket.status === "answered" ? "پاسخ داده شده" : "بسته", priority: ticket.priority === "urgent" ? "فوری" : "عادی", createdAt: new Intl.DateTimeFormat("fa-IR").format(new Date(ticket.created_at)) })));
    }).catch(() => setRemoteError("خواندن داده‌های مشترک انجام نشد؛ دسترسی حساب ادمین یا RLS را بررسی کنید.")).finally(() => setLoading(false));
  }, []);

  const persistLeads = (next: WholesaleLead[]) => { const changed = next.find((item, index) => item.status !== leads[index]?.status); setLeads(next); localStorage.setItem(leadKey, JSON.stringify(next)); setNotice("وضعیت درخواست همکاری ذخیره شد."); if (changed?.id && isBackendConfigured) updateSupplierApplication(changed.id, changed.status === "جدید" ? "pending" : changed.status === "در تماس" ? "reviewing" : changed.status === "تأیید شده" ? "approved" : "rejected").catch(() => setRemoteError("ثبت وضعیت درخواست در بک‌اند انجام نشد.")); };
  const persistOrders = async (next: WholesaleOrder[]) => { const changed = next.find((item, index) => item.status !== orders[index]?.status); if (!changed?.id) return; setRemoteError(""); try { if (changed.status === "تأیید شده") await approveWholesaleOrder(changed.id); else if (changed.status === "لغو شده") await cancelWholesaleOrder(changed.id); else throw new Error("وضعیت‌های اجرا و ارسال فقط توسط ساپلایر تغییر می‌کنند."); setOrders(next); setNotice(changed.status === "تأیید شده" ? "سفارش تأیید و برای ساپلایرها تفکیک شد." : "سفارش لغو و موجودی رزروشده آزاد شد."); } catch (reason) { setRemoteError(reason instanceof Error ? reason.message : "تغییر وضعیت سفارش انجام نشد."); } };
  const persistTickets = (next: SupportTicket[]) => { const changed = next.find((item, index) => item.status !== tickets[index]?.status); setTickets(next); saveTickets(next); setNotice("وضعیت تیکت ذخیره شد."); if (changed && isBackendConfigured) answerSupplierTicket(changed.id, changed.status === "باز" ? "open" : changed.status === "پاسخ داده شده" ? "answered" : "closed").catch(() => setRemoteError("ثبت وضعیت تیکت در بک‌اند انجام نشد.")); };
  const pendingUnits = orders.filter((order) => !["تحویل شده", "لغو شده"].includes(order.status)).reduce((sum, order) => sum + order.totalQty, 0);
  const openTickets = tickets.filter((ticket) => ticket.status === "باز").length;

  return (
    <main className="min-h-[calc(100vh-73px)] bg-[#f6f6f4]">
      <section className="border-b border-neutral-200 bg-white px-4 py-5 lg:px-7">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4">
          <div><p className="text-[9px] tracking-[0.24em] text-neutral-400">WHOLESALE OPERATIONS</p><h1 className="mt-2 text-[22px] font-medium tracking-tight">مرکز مدیریت عمده‌فروشی</h1><p className="mt-1.5 max-w-2xl text-[11px] leading-6 text-neutral-500">عملیات دو بازیگر اصلی—ساپلایر و خریدار VIP—از کاتالوگ تا تامین چندفروشنده‌ای و ارسال تجمیعی.</p></div>
          <div className="flex gap-2"><Link to="/wholesale" className={`flex h-10 items-center border border-neutral-300 bg-white px-4 text-[10.5px] transition hover:border-[#011c3a] ${focusRing}`}>مشاهده فروشگاه عمده</Link><button type="button" onClick={() => setTab("direct")} className={`h-10 bg-[#011c3a] px-4 text-[10.5px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px ${focusRing}`}>+ محصول عمده کلبه</button></div>
        </div>
      </section>

      <div className="sticky top-[73px] z-30 overflow-x-auto border-b border-neutral-200 bg-white/95 px-4 backdrop-blur lg:px-7">
        <nav className="mx-auto flex max-w-[1500px] min-w-max" aria-label="بخش‌های مدیریت عمده‌فروشی">
          {tabs.map((item) => <button key={item.id} type="button" onClick={() => { setTab(item.id); setNotice(""); }} aria-current={tab === item.id ? "page" : undefined} className={`flex h-12 items-center gap-2 border-b-2 px-4 text-[11px] transition ${focusRing} ${tab === item.id ? "border-[#011c3a] font-medium text-[#011c3a]" : "border-transparent text-neutral-500 hover:text-neutral-900"}`}><Icon name={item.icon} className="h-3.5 w-3.5" />{item.label}</button>)}
        </nav>
      </div>

      <div className="mx-auto max-w-[1500px] p-4 lg:p-7">
        {loading && <div className="mb-4 border border-neutral-200 bg-white px-4 py-3 text-[10.5px] text-neutral-500">در حال همگام‌سازی داده‌های عمده‌فروشی…</div>}
        {remoteError && <div role="alert" className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-[10.5px] text-red-700">{remoteError}</div>}
        {notice && <div role="status" className="mb-4 flex items-center justify-between border border-[#b9cfbc] bg-[#edf3ee] px-4 py-2.5 text-[10.5px] text-[#36563a]"><span>{notice}</span><button type="button" onClick={() => setNotice("")} className={`underline ${focusRing}`}>بستن</button></div>}
        {tab === "overview" && <Overview membership={membership} suppliers={suppliers} leads={leads} orders={orders} tickets={tickets} pendingUnits={pendingUnits} openTickets={openTickets} onTab={setTab} accounts={accounts} />}
        {tab === "direct" && <WholesaleCatalogManager />}
        {tab === "marketplace" && <><PageTitle eyebrow="SUPPLIER CATALOG" title="کاتالوگ فروشندگان دیگر" text="محصولات تاییدشده ساپلایرها، قیمت همکاری و موجودی قابل تخصیص." /><CatalogPanel supplierProducts={supplierProducts} onChange={setSupplierProducts} onNotice={setNotice} onError={setRemoteError} /></>}
        {tab === "fulfillment" && <><PageTitle eyebrow="MULTI SELLER FULFILLMENT" title="تامین، کنترل و ارسال تجمیعی" text="یک سفارش مشتری به سفارش‌های تامین تفکیک می‌شود؛ اقلام در هاب کلبه کنترل و در یک مرسوله ارسال می‌شوند." /><MultiSellerFlow orders={orders} suppliers={suppliers}/></>}
        {tab === "plans" && <VipPlanManager />}
        {tab === "members" && <><SuppliersPanel suppliers={suppliers} /><MembersPanel membership={membership} leads={leads} onChange={persistLeads} /></>}
        {tab === "accounts" && <AccountsPanel accounts={accounts} onChange={setAccounts} onNotice={setNotice} onError={setRemoteError} />}
        {tab === "orders" && <OrdersPanel orders={orders} onChange={persistOrders} />}
        {tab === "support" && <SupportPanel tickets={tickets} onChange={persistTickets} />}
        {/*
          پیش‌تر این تب همان `CatalogPanel` بود که وضعیت‌های
          draft/submitted/approved/rejected را در مرورگر می‌ساخت و هیچ مقصدِ
          سروری نداشت. اکنون بازبینیِ واقعیِ `supplier_product_submission` است.
        */}
        {tab === "catalog" && <SupplierModerationPage />}
      </div>
    </main>
  );
}

function Overview({ membership, suppliers, leads, orders, tickets, pendingUnits, openTickets, onTab, accounts }: { membership: ReturnType<typeof loadWholesaleMembership>; suppliers: AdminSupplier[]; leads: WholesaleLead[]; orders: WholesaleOrder[]; tickets: SupportTicket[]; pendingUnits: number; openTickets: number; onTab: (tab: WholesaleTab) => void; accounts: AdminWholesaleAccount[] }) {
  /* نیازسنجی: 1-a فروش عمده شاخص برجسته + 2-d بازه دلخواه */
  const [range, setRange] = useState<"today" | "week" | "month" | "custom">("month");
  const rangeLabel = range === "today" ? "امروز" : range === "week" ? "این هفته" : range === "month" ? "این ماه" : "کل دوره";
  const totalSales = orders.filter((order) => order.status !== "لغو شده").reduce((sum, order) => sum + (order.totalAmount ?? 0), 0);
  const suspendedCount = accounts.filter((a) => a.status === "suspended" || a.status === "financial_blocked").length;
  const urgent = tickets.filter((ticket) => ticket.priority === "فوری" && ticket.status !== "بسته");
  const actionCount = leads.filter((lead) => lead.status === "جدید").length + openTickets + orders.filter((order) => order.status === "در انتظار تأیید").length;
  return <div className="space-y-5">
  <section className="grid gap-3 xl:grid-cols-[1.35fr_1fr_1fr]">
    <article className="border border-[#011c3a] bg-[#011c3a] p-5 text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9.5px] tracking-[0.2em] text-white/50">WHOLESALE REVENUE</p>
          <p className="mt-2 text-[28px] font-medium num-fa">{toman(totalSales)}</p>
          <p className="mt-1 text-[9.5px] text-white/55">فروش عمده — {rangeLabel} ({fa(orders.length)} سفارش)</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {([["today","روزانه"],["week","هفتگی"],["month","ماهانه"],["custom","بازه دلخواه"]] as const).map(([id,name])=>(
          <button key={id} onClick={()=>setRange(id)} className={(range===id?"bg-white text-[#011c3a]":"border border-white/30 text-white/75 hover:border-white")+" rounded-[3px] px-3 py-1.5 text-[9.5px] transition"}>{name}</button>
        ))}
        {range==="custom"&&<span className="flex items-center gap-1 text-[9px] text-white/60"><input type="date" aria-label="از تاریخ" className="h-7 rounded-[3px] border border-white/30 bg-transparent px-2 text-white" dir="ltr"/><span>تا</span><input type="date" aria-label="تا تاریخ" className="h-7 rounded-[3px] border border-white/30 bg-transparent px-2 text-white" dir="ltr"/></span>}
      </div>
    </article>
    <article className="border border-neutral-200 bg-white p-5">
      <p className="text-[9.5px] text-neutral-400">حساب‌های فعال عمده</p>
      <p className="mt-2 text-[24px] font-medium num-fa">{fa(accounts.filter((a) => a.status === "approved").length)}</p>
      <p className="mt-1 text-[9.5px] text-neutral-500 num-fa">{suspendedCount ? `${fa(suspendedCount)} حساب تعلیق/مسدود` : "بدون حساب تعلیق‌شده"}</p>
    </article>
    <article className="border border-neutral-200 bg-white p-5">
      <p className="text-[9.5px] text-neutral-400">درآمد سرخط هر سفارش</p>
      <p className="mt-2 text-[24px] font-medium num-fa">{toman(orders.length ? Math.round(totalSales / orders.length) : 0)}</p>
      <p className="mt-1 text-[9.5px] text-neutral-500">میانگین ارزش سفارش عمده</p>
    </article>
  </section>
  <section className="grid border border-neutral-200 bg-white sm:grid-cols-2 xl:grid-cols-4">{[[fa(actionCount), "نیازمند اقدام", "درخواست، سفارش و تیکت"], [fa(pendingUnits), "واحد در جریان", "سفارش‌های تحویل‌نشده"], [fa(suppliers.filter((supplier) => supplier.status === "approved").length + (membership ? 1 : 0)), "همکار تأییدشده", "حساب‌های فعال"], [fa(openTickets), "تیکت باز", urgent.length ? `${fa(urgent.length)} مورد فوری` : "بدون مورد فوری"]].map(([value, label, hint], index) => <article key={label} className={`p-4 lg:p-5 ${index ? "border-t border-neutral-200 sm:border-r sm:border-t-0" : ""}`}><p className="text-[9.5px] text-neutral-400">{label}</p><p className="mt-2 text-[24px] font-medium num-fa">{value}</p><p className="mt-1 text-[9.5px] text-neutral-500">{hint}</p></article>)}</section><section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="border border-neutral-200 bg-white"><header className="flex items-center justify-between border-b border-neutral-200 p-4"><div><h2 className="text-[13px] font-medium">صف اقدام‌های امروز</h2><p className="mt-1 text-[9.5px] text-neutral-400">مواردی که توقف عملیات را ایجاد می‌کنند.</p></div><span className="text-[10px] text-neutral-400 num-fa">{fa(actionCount)} مورد</span></header><div className="divide-y divide-neutral-100">{leads.filter((lead) => lead.status === "جدید").slice(0, 3).map((lead) => <ActionRow key={lead.phone} title={`بررسی همکاری ${lead.store}`} meta={`${lead.city} · پلن ${lead.plan}`} action="بررسی" onClick={() => onTab("members")} />)}{orders.filter((order) => order.status === "در انتظار تأیید").slice(0, 3).map((order) => <ActionRow key={order.code} title={`تأیید سفارش ${order.code}`} meta={`${fa(order.totalQty)} عدد · ${order.date}`} action="مشاهده" onClick={() => onTab("orders")} />)}{urgent.slice(0, 2).map((ticket) => <ActionRow key={ticket.id} title={ticket.subject} meta={`${ticket.id} · تیکت فوری`} action="پاسخ" onClick={() => onTab("support")} />)}{!actionCount && <Empty title="صف عملیات خالی است" text="درخواست، سفارش یا تیکت معوقی وجود ندارد." />}</div></div><aside className="border border-neutral-200 bg-[#011c3a] p-5 text-white"><p className="text-[9px] tracking-[0.2em] text-white/45">SERVICE HEALTH</p><h2 className="mt-3 text-[17px] font-medium">وضعیت سرویس عمده</h2><dl className="mt-6 divide-y divide-white/10 text-[10.5px]">{[["کاتالوگ قابل عرضه", `${fa(products.length)} محصول`], ["پاسخ‌گویی", openTickets ? `${fa(openTickets)} تیکت باز` : "به‌روز"], ["عضویت VIP", membership ? "فعال" : "بدون عضو فعال"], ["آخرین همگام‌سازی", "همین مرورگر"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-white/55">{label}</dt><dd className="num-fa">{value}</dd></div>)}</dl><p className="mt-5 border-t border-white/10 pt-4 text-[9.5px] leading-5 text-white/45">داده‌های عمده‌فروشی از پایگاه‌داده مشترک دریافت می‌شوند و تغییرات پس از ذخیره در پنل ساپلایر نیز قابل مشاهده‌اند.</p></aside></section></div>;
}

function SuppliersPanel({ suppliers }: { suppliers: AdminSupplier[] }) {
  return <section className="mb-7">
    <PageTitle eyebrow="ACTIVE SUPPLIERS" title="تأمین‌کنندگان فعال" text="حساب‌های تأییدشده‌ای که به پنل ساپلایر دسترسی دارند." />
    <div className="overflow-x-auto border border-neutral-200 bg-white">
      <table className="w-full min-w-[720px] text-right text-[10.5px]">
        <thead className="bg-neutral-50 text-neutral-500"><tr>{["نام تجاری", "نام حقوقی", "شهر", "تماس", "ظرفیت ماهانه", "وضعیت"].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr></thead>
        <tbody>{suppliers.map((supplier) => <tr key={supplier.id} className="border-b border-neutral-100 hover:bg-neutral-50">
          <td className="p-3 font-medium">{supplier.displayName}</td>
          <td className="p-3 text-neutral-500">{supplier.legalName}</td>
          <td className="p-3">{supplier.city || "—"}</td>
          <td className="p-3 num-fa">{supplier.phone || "—"}</td>
          <td className="p-3 num-fa">{supplier.monthlyCapacity ? `${fa(supplier.monthlyCapacity)} عدد` : "—"}</td>
          <td className="p-3"><Status value={supplier.status === "approved" ? "تأیید شده" : supplier.status === "reviewing" ? "در تماس" : supplier.status === "rejected" ? "رد شده" : "جدید"} /></td>
        </tr>)}</tbody>
      </table>
      {!suppliers.length && <Empty title="تأمین‌کننده فعالی ثبت نشده" text="پس از تأیید و ساخت حساب ساپلایر، اطلاعات آن اینجا نمایش داده می‌شود." />}
    </div>
  </section>;
}

function MembersPanel({ membership, leads, onChange }: { membership: ReturnType<typeof loadWholesaleMembership>; leads: WholesaleLead[]; onChange: (items: WholesaleLead[]) => void }) {
  const [filter, setFilter] = useState("همه");
  const visible = filter === "همه" ? leads : leads.filter((lead) => lead.status === filter);
  const update = (phone: string, status: WholesaleLead["status"]) => onChange(leads.map((lead) => lead.phone === phone ? { ...lead, status } : lead));
  return <section><PageTitle eyebrow="PARTNER ONBOARDING" title="درخواست‌های همکاری" text="صلاحیت فروشگاه‌ها را بررسی و وضعیت شروع همکاری را ثبت کنید." /><div className="mb-4 flex gap-2 overflow-x-auto">{["همه", "جدید", "در تماس", "تأیید شده", "رد شده"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`h-9 shrink-0 border px-3 text-[10.5px] ${focusRing} ${filter === item ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 bg-white hover:border-[#011c3a]"}`}>{item}</button>)}</div>{membership && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-[#b9cfbc] bg-[#edf3ee] p-4"><div><p className="text-[11.5px] font-medium text-[#36563a]">عضویت فعال: {membership.storeName}</p><p className="mt-1 text-[9.5px] text-[#527055]">{membership.memberName} · {membership.city} · {membership.planName} · اعتبار تا {membership.expiresAt}</p></div><span className="border border-[#8caf91] px-2 py-1 text-[9px] text-[#36563a]">VIP ACTIVE</span></div>}<div className="hidden overflow-x-auto border border-neutral-200 bg-white md:block"><table className="w-full min-w-[760px] text-right text-[10.5px]"><thead className="bg-neutral-50 text-neutral-500"><tr>{["فروشگاه", "متقاضی", "شهر", "پلن", "تماس", "وضعیت"].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr></thead><tbody>{visible.map((lead) => <tr key={lead.phone} className="border-b border-neutral-100 hover:bg-neutral-50"><td className="p-3 font-medium">{lead.store}</td><td className="p-3">{lead.name}</td><td className="p-3">{lead.city}</td><td className="p-3">{lead.plan}</td><td className="p-3 num-fa">{lead.phone}</td><td className="p-3"><select aria-label={`وضعیت درخواست ${lead.store}`} value={lead.status} onChange={(event) => update(lead.phone, event.target.value as WholesaleLead["status"])} className={`h-9 border border-neutral-300 bg-white px-2 ${focusRing}`}><option>جدید</option><option>در تماس</option><option>تأیید شده</option><option>رد شده</option></select></td></tr>)}</tbody></table></div><div className="space-y-3 md:hidden">{visible.map((lead) => <article key={lead.phone} className="border border-neutral-200 bg-white p-4"><div className="flex justify-between gap-3"><div><h3 className="text-[12px] font-medium">{lead.store}</h3><p className="mt-1 text-[10px] text-neutral-500">{lead.name} · {lead.city}</p></div><span className="text-[9.5px] text-neutral-500">{lead.plan}</span></div><select aria-label={`وضعیت درخواست ${lead.store}`} value={lead.status} onChange={(event) => update(lead.phone, event.target.value as WholesaleLead["status"])} className={`mt-4 h-10 w-full border border-neutral-300 bg-white px-3 text-[10.5px] ${focusRing}`}><option>جدید</option><option>در تماس</option><option>تأیید شده</option><option>رد شده</option></select></article>)}</div>{!visible.length && <Empty title="درخواستی در این وضعیت نیست" text="با تغییر فیلتر، سایر درخواست‌های همکاری را مشاهده کنید." />}</section>;
}

function OrdersPanel({ orders, onChange }: { orders: WholesaleOrder[]; onChange: (items: WholesaleOrder[]) => void }) {
  const [selected, setSelected] = useState<WholesaleOrder | null>(null);
  const update = (code: string, status: string) => { const next = orders.map((order) => order.code === code ? { ...order, status } : order); onChange(next); setSelected((current) => current?.code === code ? { ...current, status } : current); };
  return <section><PageTitle eyebrow="BULK ORDERS" title="سفارش‌های عمده" text="تأیید، آماده‌سازی و تحویل سفارش‌های کالکشنی را پیگیری کنید." /><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><div className="border border-neutral-200 bg-white"><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[680px] text-right text-[10.5px]"><thead className="bg-neutral-50 text-neutral-500"><tr>{["کد", "تاریخ", "تعداد", "وضعیت", ""].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr></thead><tbody>{orders.map((order) => <tr key={order.code} className="border-b border-neutral-100 hover:bg-neutral-50"><td className="p-3 font-medium num-fa">{order.code}</td><td className="p-3 text-neutral-500">{order.date}</td><td className="p-3 num-fa">{fa(order.totalQty)} عدد</td><td className="p-3"><Status value={order.status} /></td><td className="p-3 text-left"><button onClick={() => setSelected(order)} className={`underline underline-offset-4 ${focusRing}`}>جزئیات</button></td></tr>)}</tbody></table></div><div className="divide-y md:hidden">{orders.map((order) => <button key={order.code} onClick={() => setSelected(order)} className={`flex w-full items-center justify-between gap-3 p-4 text-right ${focusRing}`}><span><strong className="block text-[11px] font-medium num-fa">{order.code}</strong><small className="mt-1 block text-[9.5px] text-neutral-400">{order.date} · {fa(order.totalQty)} عدد</small></span><Status value={order.status} /></button>)}</div>{!orders.length && <Empty title="هنوز سفارش عمده‌ای ثبت نشده" text="سفارش‌های ثبت‌شده توسط اعضای عمده در این بخش قرار می‌گیرند." />}</div><aside className="border border-neutral-200 bg-white p-5 xl:sticky xl:top-36 xl:self-start">{selected ? <><div className="flex items-start justify-between"><div><p className="text-[9px] text-neutral-400">ORDER DETAIL</p><h2 className="mt-2 text-[15px] font-medium num-fa">{selected.code}</h2></div><button onClick={() => setSelected(null)} aria-label="بستن جزئیات" className={`h-9 w-9 border border-neutral-200 ${focusRing}`}><Icon name="close" className="mx-auto h-4 w-4" /></button></div><dl className="mt-5 divide-y text-[10.5px]">{[["تاریخ", selected.date], ["تعداد کل", `${fa(selected.totalQty)} عدد`], ["تعداد ردیف", fa(selected.lines?.length ?? 0)]].map(([label, value]) => <div key={label} className="flex justify-between py-3"><dt className="text-neutral-400">{label}</dt><dd>{value}</dd></div>)}</dl>{selected.lines?.length ? <div className="mt-4 max-h-52 overflow-y-auto border-y divide-y">{selected.lines.map((line, index) => <div key={`${line.productCode}-${index}`} className="py-3 text-[9.5px]"><p className="font-medium">{line.productName}</p><p className="mt-1 text-neutral-400">{line.productCode} · {line.colour} · {line.size} · {fa(line.qty)} عدد</p></div>)}</div> : <p className="mt-4 bg-neutral-50 p-3 text-[9.5px] text-neutral-500">جزئیات ردیف‌های این سفارش ذخیره نشده است.</p>}<label className="mt-5 block text-[9.5px] text-neutral-500">تغییر وضعیت<select value={selected.status} onChange={(event) => update(selected.code, event.target.value)} className={`mt-1.5 h-10 w-full border border-neutral-300 bg-white px-3 text-[10.5px] ${focusRing}`}><option>در انتظار تأیید</option><option>تأیید شده</option><option>در حال آماده‌سازی</option><option>ارسال شده</option><option>تحویل شده</option><option>لغو شده</option></select></label></> : <Empty title="یک سفارش را انتخاب کنید" text="جزئیات اقلام و کنترل وضعیت اینجا نمایش داده می‌شود." />}</aside></div></section>;
}

function SupportPanel({ tickets, onChange }: { tickets: SupportTicket[]; onChange: (items: SupportTicket[]) => void }) {
  const [filter, setFilter] = useState("همه");
  const visible = filter === "همه" ? tickets : tickets.filter((ticket) => ticket.status === filter);
  const update = (id: string, status: SupportTicket["status"]) => onChange(tickets.map((ticket) => ticket.id === id ? { ...ticket, status } : ticket));
  return <section><PageTitle eyebrow="PARTNER SUPPORT" title="صندوق پشتیبانی عمده" text="پیام‌های همکاران را بر اساس فوریت و وضعیت پاسخ مدیریت کنید." /><div className="mb-4 flex gap-2">{["همه", "باز", "پاسخ داده شده", "بسته"].map((item) => <button key={item} onClick={() => setFilter(item)} className={`h-9 border px-3 text-[10.5px] ${focusRing} ${filter === item ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-300 bg-white"}`}>{item}</button>)}</div><div className="divide-y border border-neutral-200 bg-white">{visible.map((ticket) => <article key={ticket.id} className="p-4 lg:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-[12px] font-medium">{ticket.subject}</h2>{ticket.priority === "فوری" && <span className="border border-red-200 bg-red-50 px-2 py-0.5 text-[8.5px] text-red-700">فوری</span>}</div><p className="mt-1 text-[9.5px] text-neutral-400">{ticket.id} · {ticket.category} · {ticket.createdAt}</p></div><Status value={ticket.status} /></div><p className="mt-3 max-w-3xl text-[10.5px] leading-6 text-neutral-600">{ticket.message}</p><div className="mt-4 flex flex-wrap gap-2"><button disabled={ticket.status === "پاسخ داده شده"} onClick={() => update(ticket.id, "پاسخ داده شده")} className={`h-9 border border-[#011c3a] px-3 text-[9.5px] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}>ثبت پاسخ</button><button disabled={ticket.status === "بسته"} onClick={() => update(ticket.id, "بسته")} className={`h-9 px-3 text-[9.5px] text-neutral-500 underline disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}>بستن تیکت</button></div></article>)}{!visible.length && <Empty title="تیکتی در این وضعیت نیست" text="پیام‌های جدید اعضای عمده در این صندوق نمایش داده می‌شوند." />}</div></section>;
}


/* ---------------- حسابهای عمده: وضعیت فعال/تعلیق موقت/مسدود مالی (6-d) ---------------- */

function AccountsPanel({ accounts, onChange, onNotice, onError }: { accounts: AdminWholesaleAccount[]; onChange: (items: AdminWholesaleAccount[]) => void; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const statusLabel: Record<AdminWholesaleAccount["status"], string> = {
    pending: "پرداخت تکمیل‌نشده",
    approved: "فعال",
    suspended: "تعلیق موقت",
    financial_blocked: "مسدود مالی",
    rejected: "رد شده",
  };
  const statusTone: Record<AdminWholesaleAccount["status"], string> = {
    pending: "bg-[#f7f4ea] text-[#7a6320]",
    approved: "bg-[#edf3ee] text-[#36563a]",
    suspended: "bg-[#fdf3e7] text-[#8a5a20]",
    financial_blocked: "bg-red-50 text-red-700",
    rejected: "bg-neutral-100 text-neutral-500",
  };
  const changeStatus = async (account: AdminWholesaleAccount, status: AdminWholesaleAccount["status"]) => {
    setBusyId(account.id);
    const previous = accounts;
    onChange(accounts.map((item) => (item.id === account.id ? { ...item, status } : item)));
    try {
      await updateWholesaleAccountStatus(account.id, status);
      onNotice(status === "approved" ? `حساب ${account.storeName} فعال شد.` : status === "suspended" ? `حساب ${account.storeName} تعلیق شد؛ ثبت سفارش برای او بسته است.` : status === "financial_blocked" ? `حساب ${account.storeName} مسدود مالی شد.` : `وضعیت حساب ${account.storeName} ثبت شد.`);
    } catch {
      onChange(previous);
      onError("تغییر وضعیت حساب در بک‌اند ذخیره نشد.");
    } finally {
      setBusyId(null);
    }
  };
  return <section>
    <PageTitle eyebrow="WHOLESALE BUYERS" title="خریداران عمده VIP" text="عضویت پس از پرداخت خودکار فعال می‌شود؛ اینجا فقط انقضا، تعلیق امنیتی و مسدودی مالی را کنترل کنید." />
    <div className="overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[860px] text-right text-[10.5px]">
      <thead className="bg-neutral-50 text-neutral-500"><tr>{["فروشگاه", "عضو", "شهر", "پلن", "وضعیت", "تغییر وضعیت"].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr></thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id} className="border-b border-neutral-100 hover:bg-neutral-50">
            <td className="p-3 font-medium">{account.storeName}</td>
            <td className="p-3">{account.memberName}<span className="mt-1 block text-neutral-400 num-fa">{account.phone}</span></td>
            <td className="p-3">{account.city}</td>
            <td className="p-3">{account.planName}</td>
            <td className="p-3"><span className={`inline-flex px-2 py-1 text-[9px] ${statusTone[account.status]}`}>{statusLabel[account.status]}</span></td>
            <td className="p-3">
              <div className="flex flex-wrap gap-1.5">
                <button disabled={busyId === account.id || account.status === "approved" || account.status === "pending"} onClick={() => changeStatus(account, "approved")} className={`h-8 border border-[#3d5c3a] px-2.5 text-[9px] text-[#36563a] transition hover:bg-[#edf3ee] disabled:opacity-35 ${focusRing}`}>رفع تعلیق</button>
                <button disabled={busyId === account.id || account.status === "suspended"} onClick={() => changeStatus(account, "suspended")} className={`h-8 border border-[#d9b98f] px-2.5 text-[9px] text-[#8a5a20] transition hover:bg-[#fdf3e7] disabled:opacity-35 ${focusRing}`}>تعلیق موقت</button>
                <button disabled={busyId === account.id || account.status === "financial_blocked"} onClick={() => changeStatus(account, "financial_blocked")} className={`h-8 border border-red-200 px-2.5 text-[9px] text-red-700 transition hover:bg-red-50 disabled:opacity-35 ${focusRing}`}>مسدود مالی</button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>{!accounts.length && <Empty title="خریدار VIP ثبت نشده" text="پس از اولین پرداخت موفق پلن، حساب به‌صورت خودکار اینجا ظاهر می‌شود." />}</div>
  </section>;
}

function CatalogPanel({ supplierProducts, onChange, onNotice, onError }: { supplierProducts: AdminSupplierProduct[]; onChange: (products: AdminSupplierProduct[]) => void; onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [query, setQuery] = useState("");
  /* نیازسنجی 9-d: تغییر گروهی قیمت عمده (انتخاب + درصدی/مبلغی) — 10-a: بدون تأیید */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelect = (id: string) => setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const applyBulk = async () => {
    const value = Number(bulkValue);
    if (!bulkValue || Number.isNaN(value) || selectedIds.size === 0) return;
    setBulkBusy(true);
    const previous = supplierProducts;
    onChange(supplierProducts.map((product) => selectedIds.has(product.id) ? { ...product, wholesalePrice: bulkMode === "percent" ? Math.max(0, Math.round(product.wholesalePrice * (1 + value / 100))) : Math.max(0, Math.round(product.wholesalePrice + value)) } : product));
    try {
      const result = await bulkUpdateWholesalePrice([...selectedIds], bulkMode, value);
      onNotice(`قیمت عمده ${fa(result.updated)} محصول به‌روزرسانی شد (بدون نیاز به تأیید).`);
      setBulkValue(""); setSelectedIds(new Set());
    } catch (reason) {
      onChange(previous);
      onError(reason instanceof Error ? reason.message : "به‌روزرسانی گروهی قیمت انجام نشد.");
    } finally { setBulkBusy(false); }
  };
  const filtered = useMemo(() => supplierProducts.filter((product) => `${product.name} ${product.sku} ${product.supplierName}`.toLowerCase().includes(query.trim().toLowerCase())), [query, supplierProducts]);
  const setStatus = async (id: string, status: AdminSupplierProduct["status"]) => {
    const previous = supplierProducts;
    onChange(previous.map((product) => product.id === id ? { ...product, status } : product));
    try { await updateSupplierProductStatus(id, status); onNotice("وضعیت محصول کاتالوگ ذخیره شد."); }
    catch { onChange(previous); onError("تغییر وضعیت محصول ذخیره نشد."); }
  };
  return <section><PageTitle eyebrow="WHOLESALE CATALOG" title="کاتالوگ تأمین‌کنندگان" text="محصولات ارسالی ساپلایرها را بررسی، تأیید یا برای اصلاح برگردانید." />
    <label className="mb-4 block max-w-sm"><span className="sr-only">جستجوی محصول</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="نام، SKU یا تأمین‌کننده…" className={`h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] ${focusRing}`} /></label>
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[3px] border border-neutral-200 bg-neutral-50 p-3">
      <span className="text-[10.5px] text-neutral-600 num-fa">{fa(selectedIds.size)} محصول انتخاب‌شده</span>
      <select aria-label="روش تغییر گروهی قیمت عمده" value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "amount")} className={`h-9 max-w-36 border border-neutral-300 bg-white px-2 text-[10.5px] ${focusRing}`}>
        <option value="percent">درصد (٪+/−)</option>
        <option value="amount">مبلغ (تومان+/−)</option>
      </select>
      <input aria-label="مقدار تغییر قیمت" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="مثلاً 10 یا -50000" className={`h-9 max-w-40 border border-neutral-300 bg-white px-2 text-[10.5px] ${focusRing}`} dir="ltr" />
      <button onClick={applyBulk} disabled={bulkBusy || selectedIds.size === 0 || !bulkValue} className="h-9 rounded-[3px] bg-[#011c3a] px-4 text-[10.5px] font-medium text-white disabled:opacity-40">{bulkBusy ? "…" : "اعمال روی انتخاب‌شده‌ها"}</button>
      <button onClick={() => setSelectedIds(new Set(filtered.map((product) => product.id)))} className="h-9 rounded-[3px] border border-neutral-300 bg-white px-3 text-[10px]">انتخاب نتایج</button>
      <button onClick={() => setSelectedIds(new Set())} className="h-9 rounded-[3px] border border-neutral-300 bg-white px-3 text-[10px]">پاک‌سازی</button>
    </div>
    <div className="overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[920px] text-right text-[10.5px]"><thead className="bg-neutral-50 text-neutral-500"><tr><th className="w-10 border-b p-3"></th>{["محصول", "تأمین‌کننده", "دسته", "موجودی", "قیمت عمده", "وضعیت"].map((head) => <th key={head} className="border-b p-3 font-medium">{head}</th>)}</tr></thead><tbody>{filtered.map((product) => <tr key={product.id} className="border-b border-neutral-100 hover:bg-neutral-50"><td className="p-3"><input type="checkbox" aria-label={`انتخاب ${product.name}`} checked={selectedIds.has(product.id)} onChange={() => toggleSelect(product.id)} className="accent-[#011c3a]" /></td><td className="p-3"><div className="flex items-center gap-3">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-12 w-10 object-cover" /> : <div className="flex h-12 w-10 items-center justify-center bg-neutral-100 text-[9px] text-neutral-400">بدون عکس</div>}<div><b className="block font-medium">{product.name}</b><span className="mt-1 block text-neutral-400 num-fa">{product.sku}</span></div></div></td><td className="p-3">{product.supplierName}</td><td className="p-3">{product.category}</td><td className="p-3 num-fa">{fa(product.stock)} عدد</td><td className="p-3 num-fa">{toman(product.wholesalePrice)}</td><td className="p-3"><select aria-label={`وضعیت محصول ${product.name}`} value={product.status} onChange={(event) => setStatus(product.id, event.target.value as AdminSupplierProduct["status"])} className={`h-9 border border-neutral-300 bg-white px-2 ${focusRing}`}><option value="draft">پیش‌نویس</option><option value="submitted">در انتظار بررسی</option><option value="approved">تأیید و انتشار</option><option value="changes_requested">نیازمند اصلاح</option><option value="rejected">رد شده</option></select></td></tr>)}</tbody></table>{!filtered.length && <Empty title="محصولی در صف کاتالوگ نیست" text="محصول ثبت‌شده توسط ساپلایر در این بخش ظاهر می‌شود." />}</div>
  </section>;
}

function MultiSellerFlow({orders,suppliers}:{orders:WholesaleOrder[];suppliers:AdminSupplier[]}){
  const sample=orders.find(order=>order.purchaseOrders?.length)??orders[0];
  return <section className="border border-neutral-200 bg-white p-4"><div className="grid gap-2 md:grid-cols-4">{[["۱","سفارش واحد مشتری","سبد شامل چند فروشنده"],["۲","تفکیک تأمین","ساخت PO برای هر فروشنده"],["۳","تجمیع در هاب کلبه","کنترل کیفیت و بسته‌بندی"],["۴","ارسال یکپارچه","یک فاکتور و یک رهگیری"]].map(([step,title,text])=><article key={step} className="border border-neutral-200 p-3"><span className="text-[9px] text-neutral-400">مرحله {step}</span><h3 className="mt-2 text-[11px] font-medium">{title}</h3><p className="mt-1 text-[9px] leading-5 text-neutral-500">{text}</p></article>)}</div><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]"><div><p className="text-[10px] font-medium">نمونه تخصیص سفارش {sample?.code??"—"}</p><div className="mt-2 divide-y border-y">{(sample?.purchaseOrders?.length?sample.purchaseOrders:suppliers.slice(0,2).map((supplier,index)=>({id:supplier.id,orderCode:`PO-${index+1}`,status:index?"pending":"preparing",supplierName:supplier.displayName,trackingCode:null}))).map(po=><div key={po.id} className="grid gap-2 py-3 text-[9.5px] sm:grid-cols-[1fr_120px_120px]"><strong>{po.supplierName}</strong><span>{po.orderCode}</span><span className="text-neutral-500">{po.status}</span></div>)}</div></div><aside className="bg-[#011c3a] p-4 text-white"><p className="text-[9px] text-white/50">قانون ارسال</p><p className="mt-2 text-[11px] leading-6">تا رسیدن همه اقلام به هاب، سفارش مشتری «در حال تأمین» می‌ماند؛ سپس یک مرسوله و یک فاکتور نهایی صادر می‌شود.</p></aside></div></section>;
}

type VipPlan={id:string;name:string;price:number;discount:number;earlyAccessHours:number;credit:boolean;dedicatedSupport:boolean;minOrder:number;enabled:boolean};
const defaultVipPlans:VipPlan[]=[{id:"basic",name:"VIP پایه",price:6_000_000,discount:25,earlyAccessHours:0,credit:false,dedicatedSupport:false,minOrder:20,enabled:true},{id:"pro",name:"VIP حرفه‌ای",price:12_000_000,discount:35,earlyAccessHours:12,credit:false,dedicatedSupport:true,minOrder:12,enabled:true},{id:"elite",name:"VIP ویژه",price:24_000_000,discount:45,earlyAccessHours:24,credit:true,dedicatedSupport:true,minOrder:6,enabled:true}];
function VipPlanManager(){const [plans,setPlans]=useState(()=>readStorage<VipPlan[]>("kv_vip_plans_v1",defaultVipPlans));const persist=(next:VipPlan[])=>{setPlans(next);localStorage.setItem("kv_vip_plans_v1",JSON.stringify(next))};return <section><PageTitle eyebrow="VIP ACCESS CONTROL" title="پلن‌های VIP و دسترسی‌ها" text="قیمت، تخفیف، دسترسی زودهنگام جشنواره، خرید اعتباری و حداقل سفارش هر پلن را مستقل کنترل کنید."/><div className="grid gap-4 lg:grid-cols-3">{plans.map((plan,index)=><article key={plan.id} className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between"><input aria-label="نام پلن" value={plan.name} onChange={e=>persist(plans.map((item,i)=>i===index?{...item,name:e.target.value}:item))} className="h-9 min-w-0 border-b border-neutral-300 text-[12px] font-medium outline-none"/><input type="checkbox" aria-label={`فعال‌سازی ${plan.name}`} checked={plan.enabled} onChange={()=>persist(plans.map((item,i)=>i===index?{...item,enabled:!item.enabled}:item))}/></div><div className="mt-4 grid grid-cols-2 gap-2"><label className="text-[9px] text-neutral-500">هزینه سالانه<input type="number" value={plan.price} onChange={e=>persist(plans.map((item,i)=>i===index?{...item,price:Number(e.target.value)}:item))} className="mt-1 h-9 w-full border px-2"/></label><label className="text-[9px] text-neutral-500">تخفیف ٪<input type="number" value={plan.discount} onChange={e=>persist(plans.map((item,i)=>i===index?{...item,discount:Number(e.target.value)}:item))} className="mt-1 h-9 w-full border px-2"/></label><label className="text-[9px] text-neutral-500">دسترسی زودتر (ساعت)<input type="number" value={plan.earlyAccessHours} onChange={e=>persist(plans.map((item,i)=>i===index?{...item,earlyAccessHours:Number(e.target.value)}:item))} className="mt-1 h-9 w-full border px-2"/></label><label className="text-[9px] text-neutral-500">حداقل سفارش<input type="number" value={plan.minOrder} onChange={e=>persist(plans.map((item,i)=>i===index?{...item,minOrder:Number(e.target.value)}:item))} className="mt-1 h-9 w-full border px-2"/></label></div><div className="mt-4 space-y-2 border-t pt-3"><label className="flex items-center justify-between text-[9.5px]">خرید اعتباری<input type="checkbox" checked={plan.credit} onChange={()=>persist(plans.map((item,i)=>i===index?{...item,credit:!item.credit}:item))}/></label><label className="flex items-center justify-between text-[9.5px]">پشتیبان اختصاصی<input type="checkbox" checked={plan.dedicatedSupport} onChange={()=>persist(plans.map((item,i)=>i===index?{...item,dedicatedSupport:!item.dedicatedSupport}:item))}/></label></div></article>)}</div></section>}

function PageTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <header className="mb-5"><p className="text-[9px] tracking-[0.22em] text-neutral-400">{eyebrow}</p><h1 className="mt-2 text-[20px] font-medium tracking-tight">{title}</h1><p className="mt-1.5 text-[10.5px] leading-6 text-neutral-500">{text}</p></header>; }
function ActionRow({ title, meta, action, onClick }: { title: string; meta: string; action: string; onClick: () => void }) { return <div className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="truncate text-[11px] font-medium">{title}</p><p className="mt-1 text-[9.5px] text-neutral-400">{meta}</p></div><button onClick={onClick} className={`shrink-0 text-[10px] underline underline-offset-4 ${focusRing}`}>{action}</button></div>; }
function Status({ value }: { value: string }) { const tone = value.includes("بسته") || value.includes("لغو") || value.includes("رد") ? "bg-red-50 text-red-700" : value.includes("تأیید") || value.includes("تحویل") || value.includes("پاسخ") ? "bg-[#edf3ee] text-[#36563a]" : "bg-[#f7f4ea] text-[#7a6320]"; return <span className={`${tone} inline-flex px-2 py-1 text-[8.5px]`}>{value}</span>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="px-5 py-12 text-center"><p className="text-[11.5px] font-medium">{title}</p><p className="mx-auto mt-1.5 max-w-sm text-[9.5px] leading-5 text-neutral-400">{text}</p></div>; }
