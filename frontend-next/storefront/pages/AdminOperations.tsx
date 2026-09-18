import { useState, type ReactNode } from "react";
import { fa } from "../utils/format";

const field = "h-10 w-full border border-neutral-300 bg-white px-3 text-[11px] outline-none transition focus-visible:ring-2 focus-visible:ring-[#011c3a]";
const button = "h-10 bg-[#011c3a] px-4 text-[11px] font-medium text-white transition hover:bg-[#0a2c55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2";

function load<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function SavedNotice({ visible }: { visible: boolean }) {
  return visible ? <p role="status" className="border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">تغییرات ذخیره شد.</p> : null;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-[9px] tracking-[0.22em] text-neutral-400">{eyebrow}</p><h1 className="mt-2 text-[22px] font-medium">{title}</h1><p className="mt-2 max-w-2xl text-[11px] leading-[1.9] text-neutral-500">{description}</p></div>{action}</header>;
}

type Warehouse = { id: string; name: string; city: string; available: number; reserved: number; threshold: number };
const initialWarehouses: Warehouse[] = [
  { id: "WH-01", name: "انبار مرکزی", city: "تهران", available: 684, reserved: 46, threshold: 12 },
  { id: "WH-02", name: "انبار تولید", city: "کرج", available: 208, reserved: 18, threshold: 8 },
  { id: "WH-03", name: "شعبه ونک", city: "تهران", available: 94, reserved: 11, threshold: 5 },
];

export function InventoryOperations() {
  const [warehouses, setWarehouses] = useState(() => load("kv_admin_warehouses", initialWarehouses));
  const [draft, setDraft] = useState({ name: "", city: "" }); const [saved, setSaved] = useState(false);
  const persist = (next: Warehouse[]) => { setWarehouses(next); localStorage.setItem("kv_admin_warehouses", JSON.stringify(next)); setSaved(true); setTimeout(()=>setSaved(false), 1800); };
  const add = () => { if (!draft.name.trim() || !draft.city.trim()) return; persist([...warehouses, { id: `WH-${String(warehouses.length+1).padStart(2,"0")}`, name: draft.name.trim(), city: draft.city.trim(), available: 0, reserved: 0, threshold: 5 }]); setDraft({name:"",city:""}); };
  return <div><PageHeader eyebrow="INVENTORY & SUPPLY" title="موجودی و تأمین" description="موجودی در سطح هر SKU و هر انبار، آستانه مستقل کمبود، رزرو زمان‌دار، انتقال رهگیری‌شده و مغایرت‌گیری بارکد." action={<button onClick={add} className={button}>افزودن انبار</button>}/><SavedNotice visible={saved}/><section className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]"><div className="overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[680px] text-right text-[10.5px]"><thead className="bg-neutral-50 text-neutral-500"><tr>{["کد","انبار","شهر","قابل فروش","رزروشده","حد هشدار","وضعیت"].map(x=><th key={x} className="border-b border-neutral-200 p-3 font-medium">{x}</th>)}</tr></thead><tbody>{warehouses.map((item,index)=><tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50"><td className="p-3 font-medium">{item.id}</td><td className="p-3">{item.name}</td><td className="p-3">{item.city}</td><td className="p-3 num-fa">{fa(item.available)}</td><td className="p-3 num-fa">{fa(item.reserved)}</td><td className="p-3"><input aria-label={`حد هشدار ${item.name}`} type="number" min="0" value={item.threshold} onChange={e=>persist(warehouses.map((x,i)=>i===index?{...x,threshold:Number(e.target.value)}:x))} className="h-8 w-16 border border-neutral-300 text-center num-fa"/></td><td className="p-3"><span className="bg-[#edf3ee] px-2 py-1 text-[#36563a]">فعال</span></td></tr>)}</tbody></table></div><aside className="space-y-4"><div className="border border-neutral-200 bg-white p-4"><h2 className="text-[12px] font-medium">انبار جدید</h2><label className="mt-4 block text-[10px] text-neutral-500">نام انبار<input value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} className={field+" mt-1.5"}/></label><label className="mt-3 block text-[10px] text-neutral-500">شهر<input value={draft.city} onChange={e=>setDraft(v=>({...v,city:e.target.value}))} className={field+" mt-1.5"}/></label></div><div className="bg-[#011c3a] p-4 text-white"><p className="text-[10px] text-white/55">گردش انبار</p><p className="mt-2 text-[12px]">انتقال‌ها نیازمند تأیید مدیر هستند.</p><div className="mt-4 grid grid-cols-2 gap-2 text-center text-[9.5px]"><span className="border border-white/20 p-2">بارکدخوان فعال</span><span className="border border-white/20 p-2">مغایرت‌گیری فعال</span></div></div></aside></section></div>;
}

type ReturnCase = { code: string; customer: string; reason: string; amount: string; status: string };
const initialReturns: ReturnCase[] = [
  { code:"RT-1405-184", customer:"سامان یوسفی", reason:"مغایرت سایز", amount:"۲٬۳۹۰٬۰۰۰", status:"در انتظار بررسی" },
  { code:"RT-1405-179", customer:"آرش رستگار", reason:"آسیب در ارسال", amount:"۴٬۸۵۰٬۰۰۰", status:"تأیید مدیر" },
  { code:"RT-1405-172", customer:"میلاد فرهمند", reason:"انصراف مشتری", amount:"۱٬۶۵۰٬۰۰۰", status:"واریز به کیف پول" },
];

export function CommerceOperations() {
  const [cases,setCases]=useState(()=>load("kv_admin_returns",initialReturns)); const [view,setView]=useState<"table"|"board">("table");
  const update=(code:string,status:string)=>{const next=cases.map(x=>x.code===code?{...x,status}:x);setCases(next);localStorage.setItem("kv_admin_returns",JSON.stringify(next));};
  const statuses=["در انتظار بررسی","تأیید مدیر","دریافت کالا","واریز به کیف پول"];
  return <div><PageHeader eyebrow="ORDER OPERATIONS" title="مرجوعی، ارسال و پرداخت" description="مرجوعی فقط برای کل سفارش ثبت می‌شود؛ پس از بررسی مدیر مبلغ به کیف پول مشتری برمی‌گردد. ارسال گروهی بر اساس شرکت حمل تفکیک می‌شود." action={<div className="flex border border-neutral-300 bg-white"><button onClick={()=>setView("table")} className={(view==="table"?"bg-[#011c3a] text-white":"")+" px-3 py-2 text-[10px]"}>جدولی</button><button onClick={()=>setView("board")} className={(view==="board"?"bg-[#011c3a] text-white":"")+" px-3 py-2 text-[10px]"}>کانبان</button></div>}/>{view==="table"?<div className="overflow-x-auto border border-neutral-200 bg-white"><table className="w-full min-w-[720px] text-right text-[10.5px]"><thead className="bg-neutral-50"><tr>{["پرونده","مشتری","علت","مبلغ","مرحله","عملیات"].map(x=><th key={x} className="border-b p-3 font-medium">{x}</th>)}</tr></thead><tbody>{cases.map(item=><tr key={item.code} className="border-b border-neutral-100"><td className="p-3 font-medium">{item.code}</td><td className="p-3">{item.customer}</td><td className="p-3">{item.reason}</td><td className="p-3 num-fa">{item.amount} تومان</td><td className="p-3"><select value={item.status} onChange={e=>update(item.code,e.target.value)} className="h-9 border border-neutral-300 bg-white px-2">{statuses.map(x=><option key={x}>{x}</option>)}</select></td><td className="p-3"><button className="underline">مشاهده پرونده</button></td></tr>)}</tbody></table></div>:<div className="grid gap-3 lg:grid-cols-4">{statuses.map(status=><section key={status} className="min-h-52 border-t-2 border-[#011c3a] bg-[#ececea] p-3"><h2 className="text-[11px] font-medium">{status} · {fa(cases.filter(x=>x.status===status).length)}</h2><div className="mt-3 space-y-2">{cases.filter(x=>x.status===status).map(item=><article key={item.code} className="bg-white p-3"><p className="text-[10.5px] font-medium">{item.code}</p><p className="mt-1 text-[9.5px] text-neutral-500">{item.customer} · {item.reason}</p></article>)}</div></section>)}</div>}<section className="mt-5 grid gap-3 sm:grid-cols-3">{[["سرویس ارسال هوشمند","انتخاب بر اساس مقصد، وزن و SLA"],["پرداخت دستی","ثبت رسید همراه تأیید مالی"],["اعلان وضعیت","قانون قابل تنظیم برای پیامک و ایمیل"]].map(([a,b])=><div key={a} className="border border-neutral-200 bg-white p-4"><p className="text-[11.5px] font-medium">{a}</p><p className="mt-2 text-[10px] leading-[1.8] text-neutral-500">{b}</p></div>)}</section></div>;
}

/**
 * اعلان «این بخش هنوز ساخته نشده» — جایگزین کنترل‌های قلابی.
 *
 * ── اصلاح D24/D38 (فاز ۱.۵) ─────────────────────────────────────────────────
 * پنل مدیریت چند کنترل داشت که فقط در `localStorage` همین مرورگر ذخیره می‌شد و
 * هیچ اثری بر دسترسی واقعی نداشت: ماتریس نقش‌ها (`kv_admin_roles`)، کلید ورود
 * دومرحله‌ای (`kv_admin_2fa`) و روشن/خاموش کردن اتصال‌ها
 * (`kv_admin_integrations`). خطر اصلی «فریب امنیتی» است: مدیر تیک ۲FA را می‌زند و
 * باور می‌کند ورود دومرحله‌ای فعال شده، در حالی که هیچ احراز دومی وجود ندارد.
 *
 * قاعدهٔ حاکم: تا وقتی سرویس واقعی وجود ندارد، هیچ کنترل قابل‌تغییری نمایش داده
 * نمی‌شود — فقط یک اعلان صریح. (حذف کد مرده پس از اثبات جایگزین، طبق روش کار.)
 *
 * گام درست بعدی: ماتریس نقش/دسترسی و ورود دومرحله‌ای با ماژول `auth` در **فاز ۲**
 * و گزارش اتصال‌ها با ماژول‌های `payments`/`notifications` در فاز ۵–۶ می‌آید.
 */
function NotAvailableYet({ module, phase, capabilities }: { module: string; phase: string; capabilities: string[] }) {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <p className="text-[9px] tracking-[0.22em] text-amber-700">NOT IMPLEMENTED YET</p>
      <h2 className="mt-2 text-[13px] font-medium text-amber-900">این بخش هنوز روی سرور وجود ندارد</h2>
      <p className="mt-2 max-w-2xl text-[10.5px] leading-[1.9] text-amber-900">
        کنترل‌های این صفحه پیش‌تر فقط در مرورگر ذخیره می‌شدند و هیچ اثری بر دسترسی، پرداخت یا اتصال‌های واقعی نداشتند؛ به
        همین دلیل تا ساخته شدن سرویس واقعی حذف شده‌اند تا باعث باور نادرست نشوند. ماژول «{module}» در {phase} ساخته می‌شود.
      </p>
      <ul className="mt-4 grid gap-1.5 text-[10px] leading-6 text-amber-900">
        {capabilities.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 bg-amber-700" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AccessSecurity() {
  return (
    <div>
      <PageHeader
        eyebrow="ACCESS & SECURITY"
        title="دسترسی و امنیت"
        description="نقش‌ها، سطح دسترسی و امنیت ورود مدیران."
      />
      <NotAvailableYet
        module="auth"
        phase="فاز ۲ (مهاجرت احراز هویت)"
        capabilities={[
          "ماتریس نقش و دسترسی در سطح عملیات/شعبه، با اعتبارسنجی سمت سرور و ثبت در audit_log",
          "ورود دومرحله‌ای واقعی (TOTP/پیامک) همراه با مدیریت نشست‌ها و دستگاه‌های فعال",
          "گزارش رخدادهای امنیتی از جدول واقعی رویدادها — نه دادهٔ نمونه",
        ]}
      />
    </div>
  );
}


export function IntegrationsAutomation() {
  return (
    <div>
      <PageHeader
        eyebrow="INTEGRATIONS & AUTOMATION"
        title="اتصال و خودکارسازی"
        description="درگاه‌های پرداخت، پیامک، API و Webhook."
      />
      <NotAvailableYet
        module="payments / notifications"
        phase="فازهای ۵ و ۶"
        capabilities={[
          "افزودن و پیکربندی درگاه پرداخت، با کلیدهای نگهداری‌شده در سرور (هرگز در مرورگر)",
          "پیکربندی و آزمون واقعی Webhook سفارش‌ها با گزارش تحویل",
          "اتصال سامانهٔ پیامک و گردش‌های خودکار، همراه با سقف مصرف و گزارش خطا",
        ]}
      />
    </div>
  );
}
type SystemSettings={commandPalette:boolean;notifications:boolean;pwa:boolean;approval:boolean;retention:string};
export function SystemCenter(){const [settings,setSettings]=useState(()=>load<SystemSettings>("kv_admin_system",{commandPalette:true,notifications:true,pwa:true,approval:true,retention:"۱۸۰ روز"}));const [saved,setSaved]=useState(false);const persist=(next:SystemSettings)=>{setSettings(next);localStorage.setItem("kv_admin_system",JSON.stringify(next));setSaved(true);setTimeout(()=>setSaved(false),1800);};return <div><PageHeader eyebrow="SYSTEM CENTER" title="مرکز سیستم" description="تنظیمات فروشگاه فارسی، مرکز اعلان، فرمان سریع، نسخه نصب‌شونده و سیاست نگهداری اطلاعات." action={<button onClick={()=>persist(settings)} className={button}>ذخیره تنظیمات</button>}/><SavedNotice visible={saved}/><section className="mt-4 grid gap-4 lg:grid-cols-2">{[["commandPalette","فرمان سریع","دسترسی به همه بخش‌ها با جست‌وجوی عملیاتی"],["notifications","مرکز اعلان","تجمیع رویدادهای سفارش، انبار و امنیت"],["pwa","نسخه نصب‌شونده","پشتیبانی دسکتاپ، تبلت و موبایل"],["approval","تأیید تغییرات حساس","فعال برای انتشار، قیمت و عملیات مالی"]].map(([key,title,desc])=><label key={key} className="flex items-start justify-between gap-4 border border-neutral-200 bg-white p-5"><span><strong className="text-[11.5px] font-medium">{title}</strong><small className="mt-1.5 block text-[9.5px] leading-[1.8] text-neutral-500">{desc}</small></span><input type="checkbox" checked={Boolean(settings[key as keyof SystemSettings])} onChange={()=>persist({...settings,[key]:!settings[key as keyof SystemSettings]})}/></label>)}</section><section className="mt-5 grid gap-4 xl:grid-cols-[1fr_360px]"><div className="border border-neutral-200 bg-white p-5"><h2 className="text-[12px] font-medium">مرکز اعلان</h2><div className="mt-3 divide-y">{[["موجودی ۳ SKU به آستانه رسیده است","انبار · همین حالا"],["مرجوعی RT-1405-184 نیازمند بررسی است","سفارش · ۱۲ دقیقه قبل"],["تحویل Webhook سفارش موفق بود","اتصال · ۲۸ دقیقه قبل"]].map(([x,y],i)=><div key={x} className="flex items-start gap-3 py-3"><span className={(i===0?"bg-[#9e4b3c]":"bg-[#011c3a]")+" mt-1 h-1.5 w-1.5 shrink-0"}/><div><p className="text-[10.5px]">{x}</p><p className="mt-1 text-[9px] text-neutral-400">{y}</p></div></div>)}</div></div><div className="border border-neutral-200 bg-white p-5"><label className="text-[10px] text-neutral-500">سیاست نگهداری سطل زباله<select value={settings.retention} onChange={e=>persist({...settings,retention:e.target.value})} className={field+" mt-1.5"}><option>۳۰ روز</option><option>۹۰ روز</option><option>۱۸۰ روز</option><option>یک سال</option></select></label><p className="mt-4 text-[9.5px] leading-[1.8] text-neutral-400">نسخه‌های تاریخی به‌صورت پیوسته نگهداری می‌شوند و امکان مقایسه و بازگردانی دارند.</p></div></section></div>}
