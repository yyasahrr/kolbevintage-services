import { useState } from "react";

type SmsTemplate = { id: string; name: string; trigger: string; body: string; enabled: boolean };
type SmsProvider = { name: string; sender: string; apiKey: string; webhook: string };
type OutboxItem = { id: string; customer?: string; phone?: string; templateId?: string; kind?: string; status: string; createdAt: string };

const TEMPLATE_KEY = "kv_sms_templates_v1";
const PROVIDER_KEY = "kv_sms_provider_v1";
const OUTBOX_KEY = "kv_marketing_outbox_v1";
const field = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const defaults: SmsTemplate[] = [
  { id: "birthday_offer", name: "تبریک تولد", trigger: "روز تولد شمسی", body: "{{name}} عزیز، تولدت مبارک. کد {{discount_code}} تا {{expires_at}} برایت فعال است.", enabled: true },
  { id: "winback", name: "بازگشت مشتری", trigger: "۹۰ روز بدون خرید", body: "{{name}} عزیز، پیشنهادهای تازه متناسب با استایل تو آماده است: {{link}}", enabled: true },
  { id: "cart_recovery", name: "سبد رهاشده", trigger: "۲ ساعت پس از رهاشدن سبد", body: "{{name}}، محصول {{product_name}} هنوز در سبد توست: {{link}}", enabled: true },
  { id: "vip_drop", name: "پیش‌فروش VIP", trigger: "شروع کالکشن عمده", body: "{{name}} عزیز، خرید زودهنگام {{collection_name}} برای حساب VIP فعال شد: {{link}}", enabled: true },
];

function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}

export default function MessagingAutomationCenter() {
  const [tab, setTab] = useState<"templates" | "automation" | "outbox" | "provider">("templates");
  const [templates, setTemplates] = useState(() => load(TEMPLATE_KEY, defaults));
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? "");
  const [provider, setProvider] = useState(() => load<SmsProvider>(PROVIDER_KEY, { name: "کاوه‌نگار", sender: "", apiKey: "", webhook: "" }));
  const [outbox, setOutbox] = useState(() => load<OutboxItem[]>(OUTBOX_KEY, []));
  const [notice, setNotice] = useState("");
  const selected = templates.find((item) => item.id === selectedId) ?? templates[0];
  const saveTemplates = (next: SmsTemplate[]) => { setTemplates(next); localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)); };
  const patchSelected = (patch: Partial<SmsTemplate>) => selected && saveTemplates(templates.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 1600); };

  return <div>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[9px] tracking-[.22em] text-neutral-400">MESSAGING AUTOMATION</p><h1 className="mt-2 text-[21px] font-medium">پیامک و اتوماسیون ارتباطی</h1><p className="mt-2 text-[10.5px] leading-6 text-neutral-500">متن پیام، محرک، صف ارسال و درگاه پیامک در یک مرکز قابل کنترل است.</p></div>
      <span className="border border-neutral-200 bg-white px-3 py-2 text-[9.5px]"><i className={(provider.apiKey && provider.sender ? "bg-emerald-600" : "bg-amber-500") + " ml-2 inline-block h-2 w-2 rounded-full"} />{provider.apiKey && provider.sender ? "درگاه آماده ارسال" : "درگاه کامل نشده"}</span>
    </header>
    {notice && <p role="status" className="mt-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10px] text-[#36563a]">{notice}</p>}
    <nav className="mt-5 flex gap-2 overflow-x-auto border-b pb-3">
      {([['templates','متن پیامک‌ها'],['automation','اتوماسیون‌ها'],['outbox','صف ارسال'],['provider','اتصال درگاه']] as const).map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={(tab === id ? "bg-[#011c3a] text-white" : "border border-neutral-300 bg-white") + " shrink-0 px-4 py-2 text-[10.5px]"}>{label}</button>)}
    </nav>

    {tab === "templates" && <div className="mt-5 grid gap-4 lg:grid-cols-[270px_1fr]">
      <aside className="border bg-white">
        <div className="flex justify-between border-b p-3"><strong className="text-[11px]">کتابخانه پیام‌ها</strong><button onClick={() => { const item = { id: `sms-${Date.now()}`, name: "پیام جدید", trigger: "دستی", body: "{{name}} عزیز، ", enabled: false }; saveTemplates([item, ...templates]); setSelectedId(item.id); }} className="text-[10px] underline">+ جدید</button></div>
        {templates.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={(selectedId === item.id ? "bg-[#f1f4f7]" : "hover:bg-neutral-50") + " block w-full border-b p-3 text-right"}><span className="flex justify-between"><b className="text-[10.5px] font-medium">{item.name}</b><small className={item.enabled ? "text-emerald-700" : "text-neutral-400"}>{item.enabled ? "فعال" : "خاموش"}</small></span><small className="mt-1 block text-[8.5px] text-neutral-400">{item.trigger}</small></button>)}
      </aside>
      {selected && <section className="border bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-[9.5px] text-neutral-500">نام قالب<input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} className={field + " mt-1"} /></label><label className="text-[9.5px] text-neutral-500">محرک<input value={selected.trigger} onChange={(event) => patchSelected({ trigger: event.target.value })} className={field + " mt-1"} /></label></div>
        <label className="mt-4 block text-[9.5px] text-neutral-500">متن پیامک<textarea rows={6} value={selected.body} onChange={(event) => patchSelected({ body: event.target.value })} className="mt-1 w-full border p-3 text-[11px] leading-7 outline-none focus-visible:ring-2" /></label>
        <div className="mt-2 flex flex-wrap gap-1.5">{["{{name}}","{{discount_code}}","{{expires_at}}","{{product_name}}","{{link}}"].map((variable) => <button key={variable} dir="ltr" onClick={() => patchSelected({ body: `${selected.body} ${variable}` })} className="border bg-neutral-50 px-2 py-1 text-[8.5px]">{variable}</button>)}</div>
        <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2"><div><label className="flex gap-2 text-[10px]"><input type="checkbox" checked={selected.enabled} onChange={(event) => patchSelected({ enabled: event.target.checked })} />فعال برای اتوماسیون</label><button onClick={() => flash("قالب پیامک ذخیره شد.")} className="mt-4 h-9 bg-[#011c3a] px-4 text-[10px] text-white">ذخیره</button></div><div className="bg-[#f2f2f7] p-3"><small className="text-neutral-400">پیش‌نمایش</small><p className="mt-3 mr-auto max-w-[230px] rounded-[16px] rounded-bl-[5px] bg-[#0a84ff] px-3 py-2 text-[9.5px] leading-6 text-white">{preview(selected.body)}</p></div></div>
      </section>}
    </div>}

    {tab === "automation" && <section className="mt-5 divide-y border bg-white">{templates.map((item) => <article key={item.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"><div><small className="text-neutral-400">اتوماسیون</small><h2 className="mt-1 text-[11px] font-medium">{item.name}</h2></div><div><small className="text-neutral-400">شرط اجرا</small><p className="mt-1 text-[10px]">{item.trigger}</p></div><label className="flex items-center gap-2 text-[10px]">فعال<input type="checkbox" checked={item.enabled} onChange={(event) => saveTemplates(templates.map((entry) => entry.id === item.id ? { ...entry, enabled: event.target.checked } : entry))} /></label></article>)}</section>}

    {tab === "outbox" && <section className="mt-5 overflow-x-auto border bg-white"><table className="w-full min-w-[650px] text-right text-[10px]"><thead className="bg-neutral-50"><tr>{["گیرنده","شماره","قالب","وضعیت","زمان",""].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{outbox.map((item) => <tr key={item.id} className="border-t"><td className="p-3">{item.customer ?? "—"}</td><td className="p-3">{item.phone ?? "—"}</td><td className="p-3">{templates.find((template) => template.id === (item.templateId ?? item.kind))?.name ?? item.templateId ?? item.kind ?? "—"}</td><td className="p-3">{item.status === "sent" ? "ارسال‌شده" : "در صف"}</td><td className="p-3" dir="ltr">{new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</td><td className="p-3"><button disabled={!provider.apiKey || !provider.sender || item.status === "sent"} onClick={() => { const next = outbox.map((entry) => entry.id === item.id ? { ...entry, status: "sent" } : entry); setOutbox(next); localStorage.setItem(OUTBOX_KEY, JSON.stringify(next)); }} className="underline disabled:text-neutral-300">ثبت ارسال</button></td></tr>)}</tbody></table>{!outbox.length && <p className="p-10 text-center text-[10px] text-neutral-400">صف ارسال خالی است.</p>}</section>}

    {tab === "provider" && <section className="mt-5 max-w-3xl border bg-white p-5"><h2 className="text-[13px] font-medium">اتصال سرویس‌دهنده</h2><p className="mt-1 text-[9.5px] leading-5 text-neutral-500">برای انتشار نهایی، کلید API باید به متغیر امن سرور منتقل شود.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[9.5px]">سرویس<select value={provider.name} onChange={(event) => setProvider({ ...provider, name: event.target.value })} className={field + " mt-1"}><option>کاوه‌نگار</option><option>ملی پیامک</option><option>SMS.ir</option><option>سرویس اختصاصی</option></select></label><label className="text-[9.5px]">خط ارسال<input value={provider.sender} onChange={(event) => setProvider({ ...provider, sender: event.target.value })} className={field + " mt-1"} dir="ltr" /></label><label className="text-[9.5px] sm:col-span-2">کلید API<input type="password" value={provider.apiKey} onChange={(event) => setProvider({ ...provider, apiKey: event.target.value })} className={field + " mt-1"} dir="ltr" /></label><label className="text-[9.5px] sm:col-span-2">Webhook تحویل<input value={provider.webhook} onChange={(event) => setProvider({ ...provider, webhook: event.target.value })} className={field + " mt-1"} dir="ltr" /></label></div><button onClick={() => { localStorage.setItem(PROVIDER_KEY, JSON.stringify(provider)); flash("تنظیمات درگاه ذخیره شد."); }} className="mt-4 h-10 bg-[#011c3a] px-4 text-[10px] text-white">ذخیره تنظیمات</button></section>}
  </div>;
}

function preview(body: string) {
  return body.replaceAll("{{name}}", "امیرحسین").replaceAll("{{discount_code}}", "KOLBE20").replaceAll("{{expires_at}}", "۳۱ شهریور").replaceAll("{{product_name}}", "بلیزر آکسفورد").replaceAll("{{collection_name}}", "پاییز ۱۴۰۵").replaceAll("{{link}}", "kolbe.ir/s/24");
}
