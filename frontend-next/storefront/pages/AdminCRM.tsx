import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { fa, toman } from "../utils/format";
import { loadWholesaleMembership } from "../wholesaleMembership";

type Stage = "سرنخ" | "مشتری فعال" | "وفادار" | "منفعل" | "ریزش";
type Activity = { id: string; type: "یادداشت" | "تماس" | "پیام" | "خرید"; text: string; at: string };
type TaskStatus = "todo" | "doing" | "done";
type Task = { id: string; title: string; due: string; status: TaskStatus; priority: "low" | "medium" | "high"; owner: string };
type VipProfile = { plan: "پایه" | "حرفه‌ای" | "سازمانی"; status: "active" | "expired" | "suspended"; activatedAt: string; expiresAt: string; earlyAccessHours: number };
type CRMCustomer = {
  name: string; phone: string; email: string; city: string; orders: number; total: number; lastOrder: string; stage: Stage; owner: string;
  tags: string[]; consent: boolean; activities: Activity[]; tasks: Task[]; birthday?: string; lastOrderDays?: number; favoriteStyles?: string[]; abandonedCarts?: number; vip?: VipProfile;
};
type View = "overview" | "customers" | "segments" | "pipeline" | "tasks" | "vip";
type SegmentId = "loyal" | "active" | "new" | "atRisk" | "inactive" | "vip";

const key = "kv_admin_crm_v2";
const legacyKey = "kv_admin_crm_v1";
const outboxKey = "kv_marketing_outbox_v1";
const stages: Stage[] = ["سرنخ", "مشتری فعال", "وفادار", "منفعل", "ریزش"];
const input = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const taskColumns: Array<{ id: TaskStatus; label: string; description: string }> = [
  { id: "todo", label: "برای انجام", description: "پیگیری‌های برنامه‌ریزی‌شده" },
  { id: "doing", label: "در حال انجام", description: "اقداماتی که امروز پیگیری می‌شوند" },
  { id: "done", label: "انجام‌شده", description: "سوابق تکمیل‌شده" },
];

const seed: CRMCustomer[] = [
  { name: "امیرحسین رضایی", phone: "۰۹۱۲۳۴۵۶۷۸۹", email: "amir@example.com", city: "تهران", orders: 7, total: 24_500_000, lastOrder: "۱۲ مرداد", stage: "وفادار", owner: "مریم احمدی", tags: ["ارزش بالا", "کلاسیک"], consent: true, birthday: "۱۳۷۱/۰۸/۲۴", lastOrderDays: 8, favoriteStyles: ["کلاسیک", "مینیمال"], abandonedCarts: 0, vip: { plan: "حرفه‌ای", status: "active", activatedAt: "۱۴۰۵/۰۵/۰۱", expiresAt: "۱۴۰۶/۰۵/۰۱", earlyAccessHours: 24 }, activities: [{ id: "a1", type: "خرید", text: "سفارش کت آکسفورد تحویل شد.", at: "امروز · ۱۰:۲۰" }], tasks: [{ id: "t1", title: "ارسال پیش‌نمایش کالکشن پاییز", due: "۱۴۰۵/۰۶/۱۶", status: "todo", priority: "medium", owner: "مریم احمدی" }] },
  { name: "سهیل مرادی", phone: "۰۹۱۲۹۸۷۶۵۴۳", email: "soheil@example.com", city: "کرج", orders: 4, total: 12_800_000, lastOrder: "۱۲ مرداد", stage: "مشتری فعال", owner: "علی نوری", tags: ["خرید آنلاین"], consent: true, birthday: "۱۳۶۸/۰۲/۱۱", lastOrderDays: 35, favoriteStyles: ["کژوال"], abandonedCarts: 1, activities: [{ id: "a2", type: "پیام", text: "راهنمای انتخاب سایز ارسال شد.", at: "دیروز · ۱۶:۴۰" }], tasks: [] },
  { name: "نیما صادقی", phone: "۰۹۱۳۱۱۲۲۳۳۴", email: "nima@example.com", city: "اصفهان", orders: 3, total: 8_400_000, lastOrder: "۱۱ مرداد", stage: "مشتری فعال", owner: "مریم احمدی", tags: ["پیگیری سایز"], consent: true, lastOrderDays: 62, abandonedCarts: 2, activities: [], tasks: [{ id: "t2", title: "پیگیری تعویض سایز", due: "امروز", status: "doing", priority: "high", owner: "مریم احمدی" }] },
  { name: "بابک کریمی", phone: "۰۹۱۴۵۵۶۶۷۷۸", email: "babak@example.com", city: "تبریز", orders: 1, total: 3_100_000, lastOrder: "۲۹ فروردین", stage: "منفعل", owner: "علی نوری", tags: ["نیازمند بازگشت"], consent: false, lastOrderDays: 128, abandonedCarts: 0, activities: [], tasks: [] },
];

function normalizeCustomer(raw: Partial<CRMCustomer> & { name?: string; phone?: string }): CRMCustomer {
  const oldStage = String(raw.stage ?? "سرنخ");
  const stage: Stage = oldStage === "در تماس" || oldStage === "مذاکره" ? "سرنخ" : stages.includes(oldStage as Stage) ? oldStage as Stage : "سرنخ";
  return {
    name: raw.name ?? "مشتری بدون نام", phone: raw.phone ?? "", email: raw.email ?? "", city: raw.city ?? "", orders: raw.orders ?? 0, total: raw.total ?? 0,
    lastOrder: raw.lastOrder ?? "—", stage, owner: raw.owner ?? "تخصیص‌نیافته", tags: raw.tags ?? [], consent: raw.consent ?? false,
    birthday: raw.birthday, lastOrderDays: raw.lastOrderDays ?? 0, favoriteStyles: raw.favoriteStyles ?? [], abandonedCarts: raw.abandonedCarts ?? 0, vip: raw.vip,
    activities: raw.activities ?? [], tasks: (raw.tasks ?? []).map((task) => ({ id: task.id, title: task.title, due: task.due, status: task.status ?? ((task as Task & { done?: boolean }).done ? "done" : "todo"), priority: task.priority ?? "medium", owner: task.owner ?? raw.owner ?? "تخصیص‌نیافته" })),
  };
}

function loadCustomers() {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    const customers = raw ? (JSON.parse(raw) as CRMCustomer[]).map(normalizeCustomer) : seed;
    const membership = loadWholesaleMembership();
    if (membership && !customers.some((customer) => customer.phone === membership.phone)) customers.unshift(normalizeCustomer({ name: membership.memberName, phone: membership.phone, email: "", city: membership.city, orders: 0, total: 0, lastOrder: "—", stage: "مشتری فعال", owner: "تیم عمده", tags: ["خریدار عمده"], consent: true, vip: { plan: membership.planId === "pro" ? "حرفه‌ای" : membership.planId === "vip" ? "سازمانی" : "پایه", status: "active", activatedAt: membership.activatedAt, expiresAt: membership.expiresAt, earlyAccessHours: membership.planId === "vip" ? 48 : membership.planId === "pro" ? 24 : 6 } }));
    return customers;
  } catch { return seed; }
}

const segmentMeta: Array<{ id: SegmentId; label: string; rule: string; action: string; template: string }> = [
  { id: "loyal", label: "وفادار و ارزشمند", rule: "حداقل ۶ سفارش یا خرید بیشتر از ۲۰ میلیون", action: "دعوت به پیش‌فروش کالکشن", template: "loyal_early_access" },
  { id: "atRisk", label: "در معرض ریزش", rule: "۴۵ تا ۹۰ روز بی‌خرید یا بیش از یک سبد رهاشده", action: "تسک پیگیری علت انصراف", template: "cart_recovery" },
  { id: "inactive", label: "منفعل", rule: "بیش از ۹۰ روز از آخرین خرید", action: "پیام بازگشت با کد اختصاصی", template: "winback" },
  { id: "new", label: "تازه‌وارد", rule: "بدون خرید یا فقط یک سفارش", action: "راهنمای انتخاب اولین محصول", template: "onboarding" },
  { id: "active", label: "فعال", rule: "۲ تا ۵ خرید و کمتر از ۴۵ روز از خرید آخر", action: "پیشنهاد محصول رفتاری", template: "style_recommendation" },
  { id: "vip", label: "خریدار عمده VIP", rule: "عضویت پرداخت‌شده و فعال", action: "دسترسی زودهنگام و قیمت عمده", template: "vip_drop" },
];

function segmentOf(customer: CRMCustomer): SegmentId {
  if (customer.vip?.status === "active") return "vip";
  if (customer.orders >= 6 || customer.total >= 20_000_000) return "loyal";
  if ((customer.lastOrderDays ?? 0) > 90) return "inactive";
  if ((customer.lastOrderDays ?? 0) >= 45 || (customer.abandonedCarts ?? 0) > 1) return "atRisk";
  if (customer.orders <= 1) return "new";
  return "active";
}

export default function AdminCRM({ initialView = "overview" }: { initialView?: View }) {
  const [customers, setCustomers] = useState(loadCustomers);
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("همه");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("امروز");
  const [taskFilter, setTaskFilter] = useState<"open" | "all">("open");
  const [notice, setNotice] = useState("");

  const persist = (next: CRMCustomer[], message = "تغییرات CRM ذخیره شد.") => { setCustomers(next); localStorage.setItem(key, JSON.stringify(next)); setNotice(message); window.setTimeout(() => setNotice(""), 1800); };
  const selected = customers.find((customer) => customer.phone === selectedPhone) ?? null;
  const update = (phone: string, patch: Partial<CRMCustomer>) => persist(customers.map((customer) => customer.phone === phone ? { ...customer, ...patch } : customer));
  const filtered = useMemo(() => customers.filter((customer) => (stageFilter === "همه" || customer.stage === stageFilter) && `${customer.name} ${customer.phone} ${customer.email} ${customer.city} ${customer.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [customers, query, stageFilter]);
  const allTasks = customers.flatMap((customer) => customer.tasks.map((task) => ({ ...task, customer: customer.name, phone: customer.phone })));

  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => { const target = localStorage.getItem("kv_crm_focus_customer"); if (!target) return; const customer = customers.find((item) => item.name === target || item.phone === target); if (customer) { setView("customers"); setSelectedPhone(customer.phone); } localStorage.removeItem("kv_crm_focus_customer"); }, [customers]);

  const queueSegment = (id: SegmentId) => {
    const meta = segmentMeta.find((item) => item.id === id)!;
    const audience = customers.filter((customer) => segmentOf(customer) === id && customer.consent);
    const current = (() => { try { return JSON.parse(localStorage.getItem(outboxKey) ?? "[]") as unknown[]; } catch { return []; } })();
    const messages = audience.map((customer) => ({ id: crypto.randomUUID(), customer: customer.name, phone: customer.phone, templateId: meta.template, status: "queued", createdAt: new Date().toISOString() }));
    localStorage.setItem(outboxKey, JSON.stringify([...messages, ...current]));
    persist(customers, `${messages.length.toLocaleString("fa-IR")} پیام رضایت‌دار در صف ارسال قرار گرفت.`);
  };

  const createSegmentTasks = (id: SegmentId) => {
    const meta = segmentMeta.find((item) => item.id === id)!;
    const audience = customers.filter((customer) => segmentOf(customer) === id);
    persist(customers.map((customer) => !audience.some((item) => item.phone === customer.phone) ? customer : { ...customer, tasks: [{ id: crypto.randomUUID(), title: meta.action, due: "امروز", status: "todo" as const, priority: id === "atRisk" || id === "inactive" ? "high" as const : "medium" as const, owner: customer.owner }, ...customer.tasks] }), `${audience.length.toLocaleString("fa-IR")} تسک ساخته شد.`);
  };

  const addActivity = (type: Activity["type"]) => {
    if (!selected || !note.trim()) return;
    update(selected.phone, { activities: [{ id: crypto.randomUUID(), type, text: note.trim(), at: new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date()) }, ...selected.activities] });
    setNote("");
  };
  const addTask = () => {
    if (!selected || !taskTitle.trim()) return;
    update(selected.phone, { tasks: [{ id: crypto.randomUUID(), title: taskTitle.trim(), due: taskDue, status: "todo", priority: "medium", owner: selected.owner }, ...selected.tasks] });
    setTaskTitle("");
  };

  return <div>
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[9px] tracking-[.22em] text-neutral-400">CUSTOMER OPERATIONS</p><h1 className="mt-2 text-[22px] font-medium">مرکز ارتباط با مشتری</h1><p className="mt-2 max-w-2xl text-[11px] leading-6 text-neutral-500">نمای ۳۶۰ درجه مشتری، سگمنت‌های قابل اقدام، عضویت VIP و پیگیری‌های تسک‌محور.</p></div><button type="button" onClick={() => setView("tasks")} className="h-10 bg-[#011c3a] px-4 text-[10px] text-white">{fa(allTasks.filter((task) => task.status !== "done").length)} پیگیری باز</button></header>
    {notice && <p role="status" className="mt-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10px] text-[#36563a]">{notice}</p>}
    <nav className="mt-5 flex gap-2 overflow-x-auto border-b border-neutral-200 pb-3">{([['overview','نمای عملیات'],['customers','مشتریان ۳۶۰'],['segments','سگمنت‌های قابل اقدام'],['pipeline','چرخه مشتری'],['tasks','تسک‌های پیگیری'],['vip','مشتریان VIP']] as Array<[View,string]>).map(([id,label]) => <button key={id} type="button" onClick={() => setView(id)} className={(view === id ? "bg-[#011c3a] text-white" : "border border-neutral-300 bg-white") + " shrink-0 px-4 py-2 text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]"}>{label}</button>)}</nav>

    {view === "overview" && <Overview customers={customers} tasks={allTasks} onView={setView} onCustomer={setSelectedPhone} />}
    {view === "customers" && <section className="mt-5"><div className="grid gap-3 border border-neutral-200 bg-white p-3 sm:grid-cols-[1fr_190px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی نام، موبایل، شهر یا برچسب" className={input} /><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className={input}><option>همه</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></div><CustomerTable customers={filtered} onOpen={setSelectedPhone} onStage={(phone, stage) => update(phone, { stage })} /></section>}
    {view === "segments" && <Segments customers={customers} onOpen={setSelectedPhone} onQueue={queueSegment} onCreateTasks={createSegmentTasks} />}
    {view === "pipeline" && <Pipeline customers={customers} onOpen={setSelectedPhone} />}
    {view === "tasks" && <TasksBoard customers={customers} filter={taskFilter} setFilter={setTaskFilter} onOpen={setSelectedPhone} onChange={(phone, id, patch) => { const customer = customers.find((item) => item.phone === phone); if (customer) update(phone, { tasks: customer.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) }); }} />}
    {view === "vip" && <VipCustomers customers={customers} onOpen={setSelectedPhone} onSuspend={(customer) => update(customer.phone, { vip: customer.vip ? { ...customer.vip, status: customer.vip.status === "suspended" ? "active" : "suspended" } : undefined })} />}

    {selected && <CustomerDrawer customer={selected} note={note} setNote={setNote} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDue={taskDue} setTaskDue={setTaskDue} onClose={() => setSelectedPhone(null)} onPatch={(patch) => update(selected.phone, patch)} onActivity={addActivity} onTask={addTask} onQueue={(templateId) => { if (!selected.consent) return; const current = (() => { try { return JSON.parse(localStorage.getItem(outboxKey) ?? "[]") as unknown[]; } catch { return []; } })(); localStorage.setItem(outboxKey, JSON.stringify([{ id: crypto.randomUUID(), customer: selected.name, phone: selected.phone, templateId, status: "queued", createdAt: new Date().toISOString() }, ...current])); setNotice("پیام در صف ارسال قرار گرفت."); }} />}
  </div>;
}

function Overview({ customers, tasks, onView, onCustomer }: { customers: CRMCustomer[]; tasks: Array<Task & { customer: string; phone: string }>; onView: (view: View) => void; onCustomer: (phone: string) => void }) {
  const open = tasks.filter((task) => task.status !== "done");
  const inactive = customers.filter((customer) => ["atRisk", "inactive"].includes(segmentOf(customer)));
  return <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]"><section className="border border-neutral-200 bg-white"><div className="grid divide-y border-b sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">{[["کل مشتریان",fa(customers.length)],["ارزش خرید",toman(customers.reduce((sum, customer) => sum + customer.total, 0))],["VIP فعال",fa(customers.filter((customer) => customer.vip?.status === "active").length)],["پیگیری باز",fa(open.length)]].map(([label,value]) => <div key={label} className="p-4"><p className="text-[9.5px] text-neutral-500">{label}</p><p className="mt-2 text-[18px] font-medium tabular-nums">{value}</p></div>)}</div><div className="p-5"><div className="flex items-center justify-between"><div><h2 className="text-[12px] font-medium">مشتریانی که نیاز به اقدام دارند</h2><p className="mt-1 text-[9.5px] text-neutral-500">اولویت‌بندی‌شده براساس فاصله خرید و سبد رهاشده.</p></div><button type="button" onClick={() => onView("segments")} className="text-[10px] underline">مشاهده سگمنت‌ها</button></div><div className="mt-4 divide-y">{inactive.map((customer) => <button type="button" key={customer.phone} onClick={() => onCustomer(customer.phone)} className="grid w-full gap-2 py-3 text-right transition hover:bg-neutral-50 sm:grid-cols-[1fr_120px_120px]"><span><strong className="block text-[10.5px] font-medium">{customer.name}</strong><small className="mt-1 block text-[9px] text-neutral-400">{segmentMeta.find((item) => item.id === segmentOf(customer))?.label}</small></span><span className="text-[9.5px] text-neutral-500">{fa(customer.lastOrderDays ?? 0)} روز بی‌خرید</span><span className="text-[9.5px] text-neutral-500">{fa(customer.abandonedCarts ?? 0)} سبد رهاشده</span></button>)}</div></div></section><section className="border border-neutral-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="text-[12px] font-medium">صف کار امروز</h2><button type="button" onClick={() => onView("tasks")} className="text-[10px] underline">برد تسک‌ها</button></div><div className="mt-3 divide-y">{open.slice(0, 6).map((task) => <button type="button" key={task.id} onClick={() => onCustomer(task.phone)} className="block w-full py-3 text-right"><span className="block text-[10.5px] font-medium">{task.title}</span><span className="mt-1 flex justify-between text-[9px] text-neutral-400"><span>{task.customer}</span><span>{task.due}</span></span></button>)}{!open.length && <p className="py-10 text-center text-[10px] text-neutral-400">صف پیگیری خالی است.</p>}</div></section></div>;
}

function CustomerTable({ customers, onOpen, onStage }: { customers: CRMCustomer[]; onOpen: (phone: string) => void; onStage: (phone: string, stage: Stage) => void }) {
  return <div className="mt-4 overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[820px] text-right text-[10.5px]"><thead className="bg-neutral-50 text-neutral-500"><tr>{["مشتری","چرخه","سگمنت","مسئول","آخرین خرید","سفارش","ارزش",""].map((label) => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{customers.map((customer) => <tr key={customer.phone} className="border-t border-neutral-100 transition hover:bg-neutral-50"><td className="p-3"><strong className="font-medium">{customer.name}</strong><span className="mt-1 block text-[9px] text-neutral-400">{customer.phone} · {customer.city}</span></td><td className="p-3"><select aria-label={`چرخه ${customer.name}`} value={customer.stage} onChange={(event) => onStage(customer.phone, event.target.value as Stage)} className="border border-neutral-200 bg-white px-2 py-1.5">{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></td><td className="p-3">{segmentMeta.find((item) => item.id === segmentOf(customer))?.label}</td><td className="p-3">{customer.owner}</td><td className="p-3">{customer.lastOrder}</td><td className="p-3">{fa(customer.orders)}</td><td className="p-3">{toman(customer.total)}</td><td className="p-3"><button type="button" onClick={() => onOpen(customer.phone)} className="border border-neutral-300 px-3 py-1.5 hover:border-[#011c3a]">پروفایل ۳۶۰</button></td></tr>)}</tbody></table>{!customers.length && <p className="p-10 text-center text-[10px] text-neutral-400">مشتری مطابق این فیلتر پیدا نشد.</p>}</div>;
}

function Segments({ customers, onOpen, onQueue, onCreateTasks }: { customers: CRMCustomer[]; onOpen: (phone: string) => void; onQueue: (id: SegmentId) => void; onCreateTasks: (id: SegmentId) => void }) {
  return <div className="mt-5 space-y-3">{segmentMeta.map((segment) => { const list = customers.filter((customer) => segmentOf(customer) === segment.id); const consent = list.filter((customer) => customer.consent).length; return <article key={segment.id} className="grid gap-4 border border-neutral-200 bg-white p-4 lg:grid-cols-[180px_1fr_220px_auto]"><div><div className="flex items-baseline gap-2"><h2 className="text-[12px] font-medium">{segment.label}</h2><span className="text-[10px] text-neutral-400">{fa(list.length)}</span></div><p className="mt-1 text-[9px] text-neutral-400">{fa(consent)} نفر مجاز به پیام</p></div><div><p className="text-[9px] text-neutral-400">قانون عضویت</p><p className="mt-1 text-[10px] leading-5">{segment.rule}</p></div><div><p className="text-[9px] text-neutral-400">اقدام پیشنهادی</p><p className="mt-1 text-[10px] leading-5">{segment.action}</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><button type="button" disabled={!list.length} onClick={() => onCreateTasks(segment.id)} className="h-9 border border-neutral-300 px-3 text-[9.5px] disabled:opacity-35">ساخت تسک</button><button type="button" disabled={!consent} onClick={() => onQueue(segment.id)} className="h-9 bg-[#011c3a] px-3 text-[9.5px] text-white disabled:bg-neutral-300">صف پیام</button></div>{list.length > 0 && <div className="flex gap-2 overflow-x-auto lg:col-start-2 lg:col-end-5">{list.map((customer) => <button type="button" key={customer.phone} onClick={() => onOpen(customer.phone)} className="shrink-0 border border-neutral-200 bg-neutral-50 px-3 py-2 text-right text-[9.5px]"><strong className="font-medium">{customer.name}</strong><span className="mr-2 text-neutral-400">{fa(customer.orders)} سفارش</span></button>)}</div>}</article>; })}</div>;
}

function Pipeline({ customers, onOpen }: { customers: CRMCustomer[]; onOpen: (phone: string) => void }) {
  return <section className="mt-5 border border-neutral-200 bg-white p-4"><header><h2 className="text-[13px] font-medium">چرخه عمر مشتری</h2><p className="mt-1 text-[10px] text-neutral-500">قیف فروش مبهم حذف شده؛ این نما وضعیت واقعی رابطه پس از خرید را نشان می‌دهد.</p></header><div className="mt-5 grid gap-2 lg:grid-cols-5">{stages.map((stage, index) => { const list = customers.filter((customer) => customer.stage === stage); return <article key={stage} className="border border-neutral-200 bg-[#fafaf8] p-3"><div className="flex items-start justify-between"><div><span className="text-[8px] text-neutral-400">مرحله {fa(index + 1)}</span><h3 className="mt-1 text-[11px] font-medium">{stage}</h3></div><span className="text-[10px]">{fa(list.length)}</span></div><div className="mt-3 space-y-2">{list.map((customer) => <button type="button" key={customer.phone} onClick={() => onOpen(customer.phone)} className="w-full border border-neutral-200 bg-white p-2.5 text-right transition hover:border-[#011c3a]"><strong className="block truncate text-[10px] font-medium">{customer.name}</strong><span className="mt-1 block text-[8.5px] text-neutral-400">{toman(customer.total)}</span></button>)}</div></article>; })}</div></section>;
}

function TasksBoard({ customers, filter, setFilter, onOpen, onChange }: { customers: CRMCustomer[]; filter: "open" | "all"; setFilter: (value: "open" | "all") => void; onOpen: (phone: string) => void; onChange: (phone: string, id: string, patch: Partial<Task>) => void }) {
  const tasks = customers.flatMap((customer) => customer.tasks.map((task) => ({ ...task, customer: customer.name, phone: customer.phone }))).filter((task) => filter === "all" || task.status !== "done");
  return <section className="mt-5"><header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[13px] font-medium">برد پیگیری تیم</h2><p className="mt-1 text-[10px] text-neutral-500">هر پیگیری یک مسئول، موعد، اولویت و وضعیت اجرایی دارد.</p></div><select aria-label="فیلتر تسک" value={filter} onChange={(event) => setFilter(event.target.value as "open" | "all")} className={input + " w-40"}><option value="open">فقط بازها</option><option value="all">همه تسک‌ها</option></select></header><div className="mt-4 grid gap-3 lg:grid-cols-3">{taskColumns.map((column) => <article key={column.id} className="min-h-64 border border-neutral-200 bg-[#f7f7f5] p-3"><div className="flex justify-between"><div><h3 className="text-[11px] font-medium">{column.label}</h3><p className="mt-1 text-[8.5px] text-neutral-400">{column.description}</p></div><span className="text-[10px]">{fa(tasks.filter((task) => task.status === column.id).length)}</span></div><div className="mt-3 space-y-2">{tasks.filter((task) => task.status === column.id).map((task) => <div key={task.id} className="border border-neutral-200 bg-white p-3"><div className="flex gap-2"><span aria-label={`اولویت ${task.priority}`} className={(task.priority === "high" ? "bg-red-600" : task.priority === "medium" ? "bg-amber-500" : "bg-neutral-300") + " mt-1 h-2 w-2 shrink-0"} /><div className="min-w-0 flex-1"><strong className="block text-[10.5px] font-medium">{task.title}</strong><button type="button" onClick={() => onOpen(task.phone)} className="mt-1 text-[9px] text-neutral-500 underline">{task.customer}</button></div></div><div className="mt-3 flex items-center justify-between border-t pt-2 text-[8.5px] text-neutral-400"><span>{task.due} · {task.owner}</span><select aria-label={`وضعیت ${task.title}`} value={task.status} onChange={(event) => onChange(task.phone, task.id, { status: event.target.value as TaskStatus })} className="border border-neutral-200 bg-white px-1.5 py-1 text-[8.5px] text-neutral-700">{taskColumns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div></div>)}</div></article>)}</div></section>;
}

function VipCustomers({ customers, onOpen, onSuspend }: { customers: CRMCustomer[]; onOpen: (phone: string) => void; onSuspend: (customer: CRMCustomer) => void }) {
  const vip = customers.filter((customer) => customer.vip);
  return <section className="mt-5"><header className="border border-[#c8b37c] bg-[#fbf7ec] p-4"><p className="text-[9px] tracking-[.18em] text-[#796632]">WHOLESALE VIP CUSTOMERS</p><h2 className="mt-1 text-[14px] font-medium">خریداران عمده با عضویت پرداخت‌شده</h2><p className="mt-1 text-[10px] leading-5 text-neutral-600">فعال‌سازی پس از پرداخت انجام می‌شود و نیاز به تایید درخواست ندارد. از اینجا فقط دسترسی، انقضا و سابقه مشتری را کنترل کنید.</p></header><div className="mt-4 overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[760px] text-right text-[10.5px]"><thead className="bg-neutral-50"><tr>{["مشتری","پلن","وضعیت","فعال‌سازی","انقضا","دسترسی زودهنگام","ارزش خرید",""].map((label) => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{vip.map((customer) => <tr key={customer.phone} className="border-t"><td className="p-3"><strong>{customer.name}</strong><span className="mt-1 block text-[9px] text-neutral-400">{customer.phone}</span></td><td className="p-3">{customer.vip?.plan}</td><td className="p-3"><span className={customer.vip?.status === "active" ? "text-emerald-700" : "text-red-700"}>{customer.vip?.status === "active" ? "فعال" : customer.vip?.status === "suspended" ? "تعلیق" : "منقضی"}</span></td><td className="p-3">{customer.vip?.activatedAt}</td><td className="p-3">{customer.vip?.expiresAt}</td><td className="p-3">{fa(customer.vip?.earlyAccessHours ?? 0)} ساعت</td><td className="p-3">{toman(customer.total)}</td><td className="p-3"><div className="flex gap-2"><button type="button" onClick={() => onOpen(customer.phone)} className="underline">پروفایل ۳۶۰</button><button type="button" onClick={() => onSuspend(customer)} className="text-red-700 underline">{customer.vip?.status === "suspended" ? "رفع تعلیق" : "تعلیق"}</button></div></td></tr>)}</tbody></table>{!vip.length && <p className="p-10 text-center text-[10px] text-neutral-400">پس از اولین پرداخت پلن، مشتری اینجا اضافه می‌شود.</p>}</div></section>;
}

function CustomerDrawer({ customer, note, setNote, taskTitle, setTaskTitle, taskDue, setTaskDue, onClose, onPatch, onActivity, onTask, onQueue }: { customer: CRMCustomer; note: string; setNote: (value: string) => void; taskTitle: string; setTaskTitle: (value: string) => void; taskDue: string; setTaskDue: (value: string) => void; onClose: () => void; onPatch: (patch: Partial<CRMCustomer>) => void; onActivity: (type: Activity["type"]) => void; onTask: () => void; onQueue: (template: string) => void }) {
  return <div className="fixed inset-0 z-50 bg-black/35" onClick={onClose}><aside aria-label="پروفایل ۳۶۰ مشتری" className="absolute inset-y-0 left-0 w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-7" onClick={(event) => event.stopPropagation()}><header className="flex justify-between"><div><p className="text-[9px] tracking-[.2em] text-neutral-400">CUSTOMER 360</p><h2 className="mt-2 text-[20px] font-medium">{customer.name}</h2><p className="mt-1 text-[10px] text-neutral-500">{customer.phone} · {customer.email}</p></div><button type="button" onClick={onClose} aria-label="بستن" className="h-9 w-9 border border-neutral-300"><Icon name="close" className="m-auto h-4 w-4" /></button></header><div className="mt-5 grid grid-cols-2 border border-neutral-200 sm:grid-cols-4">{[["سفارش",fa(customer.orders)],["ارزش",toman(customer.total)],["چرخه",customer.stage],["سگمنت",segmentMeta.find((item) => item.id === segmentOf(customer))?.label ?? "—"]].map(([label,value]) => <div key={label} className="border-b p-3 sm:border-l sm:border-b-0"><p className="text-[8.5px] text-neutral-400">{label}</p><p className="mt-1 text-[10px] font-medium">{value}</p></div>)}</div><section className="mt-5 border border-neutral-200 p-4"><h3 className="text-[11px] font-medium">شناسه و ترجیحات</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[9.5px] text-neutral-500">تاریخ تولد شمسی<input value={customer.birthday ?? ""} onChange={(event) => onPatch({ birthday: event.target.value })} placeholder="۱۳۷۰/۰۵/۲۱" className={input + " mt-1"} /></label><label className="text-[9.5px] text-neutral-500">روز از آخرین خرید<input type="number" min="0" value={customer.lastOrderDays ?? 0} onChange={(event) => onPatch({ lastOrderDays: Number(event.target.value) })} className={input + " mt-1"} /></label><label className="text-[9.5px] text-neutral-500">مرحله چرخه<select value={customer.stage} onChange={(event) => onPatch({ stage: event.target.value as Stage })} className={input + " mt-1"}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label className="text-[9.5px] text-neutral-500">مسئول<input value={customer.owner} onChange={(event) => onPatch({ owner: event.target.value })} className={input + " mt-1"} /></label><label className="text-[9.5px] text-neutral-500 sm:col-span-2">استایل‌های مورد علاقه<input value={(customer.favoriteStyles ?? []).join("، ")} onChange={(event) => onPatch({ favoriteStyles: event.target.value.split(/[،,]/).map((item) => item.trim()).filter(Boolean) })} className={input + " mt-1"} /></label><label className="flex items-center justify-between border-t pt-3 text-[10px] sm:col-span-2">رضایت دریافت پیام بازاریابی<input type="checkbox" checked={customer.consent} onChange={(event) => onPatch({ consent: event.target.checked })} /></label></div><div className="mt-3 flex gap-2"><button type="button" disabled={!customer.consent || !customer.birthday} onClick={() => onQueue("birthday_offer")} className="h-9 border border-neutral-300 px-3 text-[9.5px] disabled:opacity-35">صف پیام تولد</button><button type="button" disabled={!customer.consent} onClick={() => onQueue("winback")} className="h-9 border border-neutral-300 px-3 text-[9.5px] disabled:opacity-35">صف پیام بازگشت</button></div></section><section className="mt-5 border border-neutral-200 p-4"><h3 className="text-[11px] font-medium">تسک پیگیری جدید</h3><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]"><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className={input} placeholder="اقدام بعدی" /><input value={taskDue} onChange={(event) => setTaskDue(event.target.value)} className={input} placeholder="موعد" /><button type="button" onClick={onTask} className="h-10 bg-[#011c3a] px-4 text-[10px] text-white">افزودن</button></div></section><section className="mt-5"><h3 className="text-[11px] font-medium">ثبت تعامل</h3><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="خلاصه تماس، پیام یا یادداشت داخلی" className="mt-3 w-full border border-neutral-300 p-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" /><div className="mt-2 flex gap-2">{(["یادداشت","تماس","پیام"] as const).map((type) => <button type="button" key={type} onClick={() => onActivity(type)} className="h-9 border border-neutral-300 px-3 text-[9.5px]">ثبت {type}</button>)}</div></section><section className="mt-6"><h3 className="text-[11px] font-medium">تاریخچه ارتباط</h3><div className="mt-3 divide-y border-y">{customer.activities.map((activity) => <article key={activity.id} className="py-3"><div className="flex justify-between"><strong className="text-[9.5px]">{activity.type}</strong><span className="text-[8.5px] text-neutral-400">{activity.at}</span></div><p className="mt-1 text-[10.5px] leading-6 text-neutral-600">{activity.text}</p></article>)}{!customer.activities.length && <p className="py-8 text-center text-[10px] text-neutral-400">هنوز تعاملی ثبت نشده است.</p>}</div></section></aside></div>;
}
