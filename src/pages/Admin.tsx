import { useState } from "react";
import { Link } from "../router";
import { products, categories, specLabels, specOrder, type Product } from "../data/catalog";
import { styles, articles } from "../siteData";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";
import { AccessSecurity, CommerceOperations, IntegrationsAutomation, InventoryOperations, SystemCenter } from "./AdminOperations";
import AdminProductEditor from "./AdminProductEditor";
import { createAdminProduct, loadAdminProducts, loadProductTrash, saveAdminProducts, saveProductTrash, type AdminProductRecord } from "../adminProducts";
import { loadHomepageJournalPins, saveHomepageJournalPins, saveManagedArticles } from "../journalSettings";
import AdminCRM from "./AdminCRM";
import { loadSiteSettings, saveSiteSettings, type HeroTemplate } from "../siteSettings";
import RetailPolicyCenter from "./RetailPolicyCenter";

const input =
  "h-9 w-full rounded-[3px] border border-neutral-300 px-3 text-[12px] outline-none transition focus:border-[#011c3a]";

const nav = [
  { id: "retail-settings", label: "تنظیمات خرده", icon: "check" },
  { id: "dashboard", label: "داشبورد", icon: "shield" },
  { id: "products", label: "محصولات", icon: "bag" },
  { id: "inventory", label: "موجودی و تأمین", icon: "pin" },
  { id: "orders", label: "سفارش‌ها", icon: "truck" },
  { id: "commerce", label: "مرجوعی و ارسال", icon: "return" },
  { id: "customers", label: "CRM مشتریان", icon: "user" },
  { id: "content", label: "محتوا و صفحات", icon: "mail" },
  { id: "wholesale", label: "درخواست‌های عمده", icon: "pin" },
  { id: "reports", label: "گزارش‌ها", icon: "clock" },
  { id: "access", label: "دسترسی و امنیت", icon: "shield" },
  { id: "integrations", label: "اتصال و اتوماسیون", icon: "plus" },
  { id: "system", label: "مرکز سیستم", icon: "star" },
];

const orders = [
  { code: "KV-482910", customer: "امیرحسین رضایی", date: "۱۲ مرداد", status: "تحویل شده", total: 4_850_000, items: 1 },
  { code: "KV-482885", customer: "سهیل مرادی", date: "۱۲ مرداد", status: "در حال ارسال", total: 3_170_000, items: 2 },
  { code: "KV-482801", customer: "نیما صادقی", date: "۱۱ مرداد", status: "در حال پردازش", total: 2_390_000, items: 1 },
  { code: "KV-482744", customer: "بابک کریمی", date: "۱۱ مرداد", status: "پرداخت شده", total: 7_450_000, items: 1 },
  { code: "KV-482690", customer: "پویا حسینی", date: "۱۰ مرداد", status: "مرجوع شده", total: 1_650_000, items: 1 },
];

const statusColour: Record<string, string> = {
  "تحویل شده": "bg-[#eef4ee] text-[#3d5c3a]",
  "در حال ارسال": "bg-[#eef2f7] text-[#22304a]",
  "در حال پردازش": "bg-[#f7f4ea] text-[#7a6320]",
  "پرداخت شده": "bg-[#f0f4f7] text-[#2f5c8a]",
  "مرجوع شده": "bg-[#f7eeee] text-[#9e4b3c]",
};

const wholesaleRequests = [
  { name: "مهدی نوری", store: "گالری نوری", city: "اصفهان", phone: "۰۹۱۳۱۲۳۴۵۶۷", plan: "حرفه‌ای", status: "جدید" },
  { name: "سارا احمدی", store: "بوتیک سارا", city: "شیراز", phone: "۰۹۱۷۹۸۷۶۵۴۳", plan: "وی‌آی‌پی", status: "در تماس" },
  { name: "رضا طاهری", store: "پوشاک طاهری", city: "تبریز", phone: "۰۹۱۴۱۱۲۲۳۳۴", plan: "همکار", status: "تأیید شده" },
];

/* -------------------------------- داشبورد --------------------------------- */

function Dashboard() {
  const stats = [
    { label: "فروش امروز", value: "۱۸٬۴۵۰٬۰۰۰", unit: "تومان", change: "+۱۲٪" },
    { label: "سفارش‌های امروز", value: "۲۳", unit: "سفارش", change: "+۵٪" },
    { label: "نرخ تبدیل", value: "۳٫۸", unit: "درصد", change: "+۰٫۴" },
    { label: "بازدید امروز", value: "۱٬۸۴۲", unit: "نفر", change: "-۳٪" },
  ];

  const bars = [42, 55, 38, 68, 74, 61, 88, 79, 95, 71, 84, 92];
  const months = ["فرو", "ارد", "خرد", "تیر", "مرد", "شهر", "مهر", "آبا", "آذر", "دی", "بهم", "اسف"];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[3px] border border-neutral-200 bg-white p-4">
            <p className="text-[11.5px] text-neutral-500">{s.label}</p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[22px] font-medium num-fa">{s.value}</span>
              <span className="text-[11px] text-neutral-400">{s.unit}</span>
            </div>
            <p className={"mt-1 text-[11px] num-fa " + (s.change.startsWith("-") ? "text-[#9e4b3c]" : "text-[#3d5c3a]")}>
              {s.change} نسبت به دیروز
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
          <h3 className="text-[13px] font-medium">فروش ۱۲ ماه گذشته</h3>
          <div className="mt-6 flex h-44 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div className="w-full rounded-t-[2px] bg-[#011c3a] transition-all hover:bg-[#0a2c55]" style={{ height: `${h}%` }} />
                <span className="text-[9px] text-neutral-400">{months[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
          <h3 className="text-[13px] font-medium">پرفروش‌ترین محصولات</h3>
          <div className="mt-4 space-y-3">
            {[...products].sort((a, b) => b.sold - a.sold).slice(0, 5).map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="w-4 text-[11px] text-neutral-400 num-fa">{fa(i + 1)}</span>
                <img src={p.images[0]} alt="" className="h-10 w-8 object-cover" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]">{p.name}</p>
                  <p className="text-[10.5px] text-neutral-500 num-fa">{fa(p.sold)} فروش</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
        <h3 className="mb-4 text-[13px] font-medium">آخرین سفارش‌ها</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-neutral-200 text-right text-neutral-500">
                <th className="py-2 font-medium">کد</th>
                <th className="py-2 font-medium">مشتری</th>
                <th className="py-2 font-medium">تاریخ</th>
                <th className="py-2 font-medium">مبلغ</th>
                <th className="py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.code} className="border-b border-neutral-100">
                  <td className="py-2.5 num-fa">{o.code}</td>
                  <td className="py-2.5">{o.customer}</td>
                  <td className="py-2.5 text-neutral-500">{o.date}</td>
                  <td className="py-2.5 num-fa">{toman(o.total)}</td>
                  <td className="py-2.5">
                    <span className={"rounded-[3px] px-2 py-1 text-[10.5px] " + statusColour[o.status]}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- محصولات --------------------------------- */

function ProductEditor({ product, onBack, onSave }: { product: Product; onBack: () => void; onSave: (product: Product) => void }) {
  const [tab, setTab] = useState("basic");
  const [saved, setSaved] = useState(false);
  const tabs = [
    { id: "basic", label: "اطلاعات پایه" },
    { id: "variants", label: "رنگ، سایز و موجودی" },
    { id: "media", label: "تصاویر و ویدئو" },
    { id: "specs", label: "مشخصات فنی" },
    { id: "chart", label: "جدول سایز" },
    { id: "relations", label: "محصولات مرتبط" },
  ];

  return (
    <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave({ ...product, name: String(data.get("name") || product.name), latin: String(data.get("latin") || product.latin), price: Number(data.get("price")) || 0, category: String(data.get("category") || product.category), categoryLabel: categories.find(item => item.slug === String(data.get("category")))?.label ?? product.categoryLabel, style: String(data.get("style") || product.style), description: String(data.get("description") || ""), specs: { ...product.specs, code: String(data.get("code") || product.specs.code) } }); setSaved(true); setTimeout(()=>setSaved(false),1800); }}>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-[#011c3a]">
          <Icon name="chevronRight" className="h-4 w-4" />
          بازگشت
        </button>
        <h2 className="text-[16px] font-medium">{product.name}</h2>
        {saved && <span role="status" className="mr-auto text-[10.5px] text-[#36563a]">ذخیره شد</span>}
        <button type="submit" className={(saved ? "mr-2" : "mr-auto") + " rounded-[3px] bg-[#011c3a] px-5 py-2 text-[12px] font-medium text-white"}>
          {saved ? "ذخیره شد" : "ذخیره تغییرات"}
        </button>
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-neutral-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "rounded-[3px] px-3 py-1.5 text-[11.5px] transition " +
              (tab === t.id ? "bg-[#011c3a] text-white" : "border border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
        {tab === "basic" && (
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">نام محصول</span>
              <input name="name" required className={input} defaultValue={product.name} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">نام لاتین</span>
              <input name="latin" className={input} defaultValue={product.latin} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">قیمت (تومان)</span>
              <input name="price" type="number" min="0" required className={input} defaultValue={product.price} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">دسته‌بندی</span>
              <select name="category" className={input} defaultValue={product.category}>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">استایل</span>
              <select name="style" className={input} defaultValue={product.style}>
                {styles.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">کد محصول</span>
              <input name="code" required className={input} defaultValue={product.specs.code} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-neutral-600">توضیحات</span>
              <textarea name="description" rows={5} className="w-full rounded-[3px] border border-neutral-300 p-3 text-[12px] outline-none focus:border-[#011c3a]" defaultValue={product.description} />
            </label>
          </div>
        )}

        {tab === "variants" && (
          <div className="space-y-6">
            <div>
              <h4 className="mb-3 text-[12.5px] font-medium">رنگ‌ها</h4>
              <div className="space-y-2">
                {product.colours.map((c) => (
                  <div key={c.name} className="flex items-center gap-3 rounded-[3px] border border-neutral-200 p-2.5">
                    <span className="h-7 w-7 shrink-0 rounded-full border border-neutral-300" style={{ background: c.hex }} />
                    <input className={input + " max-w-[160px]"} defaultValue={c.name} />
                    <input className={input + " max-w-[100px]"} defaultValue={c.hex} />
                    <img src={c.img} alt="" className="h-9 w-7 object-cover" />
                    <button className="mr-auto text-neutral-400 hover:text-[#9e4b3c]" aria-label="حذف">
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button className="h-9 w-full rounded-[3px] border border-dashed border-neutral-300 text-[11.5px] text-neutral-500 hover:border-[#011c3a]">
                  + افزودن رنگ
                </button>
              </div>
            </div>

            <div>
              <h4 className="mb-3 text-[12.5px] font-medium">سایز و موجودی</h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[380px] text-[12px]">
                  <thead>
                    <tr className="border-b border-neutral-200 text-right text-neutral-500">
                      <th className="py-2 font-medium">سایز</th>
                      <th className="py-2 font-medium">موجودی</th>
                      <th className="py-2 font-medium">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.sizes.map((s) => (
                      <tr key={s.label} className="border-b border-neutral-100">
                        <td className="py-2 font-medium">{s.label}</td>
                        <td className="py-2">
                          <input className={input + " max-w-[90px]"} defaultValue={s.inStock ? Math.floor(Math.random() * 20) + 3 : 0} />
                        </td>
                        <td className="py-2">
                          <span className={"rounded-[3px] px-2 py-1 text-[10.5px] " + (s.inStock ? "bg-[#eef4ee] text-[#3d5c3a]" : "bg-[#f7eeee] text-[#9e4b3c]")}>
                            {s.inStock ? "موجود" : "ناموجود"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "media" && (
          <div>
            <h4 className="mb-3 text-[12.5px] font-medium">تصاویر محصول</h4>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {product.images.map((src, i) => (
                <div key={i} className="group relative">
                  <img src={src} alt="" className="aspect-[3/4] w-full object-cover" loading="lazy" />
                  <button className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 opacity-0 transition group-hover:opacity-100" aria-label="حذف">
                    <Icon name="close" className="h-2.5 w-2.5" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 right-1 rounded-[2px] bg-[#011c3a] px-1.5 py-0.5 text-[8.5px] text-white">اصلی</span>
                  )}
                </div>
              ))}
              <button className="flex aspect-[3/4] items-center justify-center rounded-[3px] border border-dashed border-neutral-300 text-[11px] text-neutral-500 hover:border-[#011c3a]">
                + افزودن
              </button>
            </div>

            <h4 className="mb-3 mt-6 text-[12.5px] font-medium">ویدئوی محصول</h4>
            <div className="grid max-w-lg gap-2.5">
              <input className={input} placeholder="آدرس ویدئو (آپارات یا یوتیوب)" defaultValue={product.video?.url ?? ""} />
              <input className={input} placeholder="عنوان ویدئو" defaultValue={product.video?.title ?? ""} />
            </div>
          </div>
        )}

        {tab === "specs" && (
          <div className="grid max-w-3xl gap-2.5 sm:grid-cols-2">
            {specOrder.map((key) => (
              <label key={key} className="block">
                <span className="mb-1 block text-[11px] text-neutral-600">{specLabels[key]}</span>
                <input className={input} defaultValue={product.specs[key]} />
              </label>
            ))}
          </div>
        )}

        {tab === "chart" && (
          <div className="overflow-x-auto">
            <p className="mb-3 text-[11.5px] text-neutral-500">جدول سایز مخصوص همین محصول — قابل ویرایش برای هر محصول.</p>
            <table className="w-full min-w-[520px] text-[12px]">
              <thead>
                <tr className="border-b border-neutral-200 text-right text-neutral-500">
                  <th className="py-2 font-medium">سایز</th>
                  <th className="py-2 font-medium">دور سینه</th>
                  <th className="py-2 font-medium">عرض شانه</th>
                  <th className="py-2 font-medium">قد</th>
                  <th className="py-2 font-medium">قد آستین</th>
                </tr>
              </thead>
              <tbody>
                {product.sizeChart.map((r) => (
                  <tr key={r.size} className="border-b border-neutral-100">
                    <td className="py-2 font-medium">{r.size}</td>
                    {[r.chest, r.shoulder, r.length, r.sleeve].map((v, i) => (
                      <td key={i} className="py-2 pl-2">
                        <input className={input + " max-w-[80px]"} defaultValue={v} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "relations" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {[
              { title: "محصولات مرتبط", ids: product.relatedIds },
              { title: "محصولات مکمل", ids: product.complementaryIds },
            ].map((g) => (
              <div key={g.title}>
                <h4 className="mb-3 text-[12.5px] font-medium">{g.title}</h4>
                <div className="space-y-2">
                  {g.ids.map((id) => {
                    const p = products.find((x) => x.id === id);
                    if (!p) return null;
                    return (
                      <div key={id} className="flex items-center gap-3 rounded-[3px] border border-neutral-200 p-2">
                        <img src={p.images[0]} alt="" className="h-10 w-8 object-cover" loading="lazy" />
                        <span className="flex-1 text-[12px]">{p.name}</span>
                        <button className="text-neutral-400 hover:text-[#9e4b3c]" aria-label="حذف">
                          <Icon name="close" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <select className={input}>
                    <option>+ افزودن محصول</option>
                    {products.filter((p) => p.id !== product.id).map((p) => (
                      <option key={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

function ProductsPanel() {
  const [editing, setEditing] = useState<AdminProductRecord | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminProductRecord[]>(loadAdminProducts);
  const [trash,setTrash]=useState<AdminProductRecord[]>(loadProductTrash);
  const [view,setView]=useState<"active"|"trash">("active");
  const [status,setStatus]=useState("all");
  const [notice,setNotice]=useState("");

  const saveProduct = (next: AdminProductRecord) => { const exists = items.some(item=>item.id===next.id); const updated = exists ? items.map(item=>item.id===next.id?next:item) : [next,...items]; try { saveAdminProducts(updated); setItems(updated); setEditing(next); return null; } catch { return "فضای ذخیره‌سازی مرورگر کافی نیست؛ تصاویر حجیم را حذف کنید."; } };
  const createProduct = () => setEditing(createAdminProduct());
  const commit=(next:AdminProductRecord[])=>{saveAdminProducts(next);setItems(next);};
  const remove=(product:AdminProductRecord)=>{const next=items.filter(x=>x.id!==product.id);const nextTrash=[product,...trash];commit(next);saveProductTrash(nextTrash);setTrash(nextTrash);setNotice("محصول به سطل زباله منتقل شد.");};
  const restore=(product:AdminProductRecord)=>{const next=[product,...items];const nextTrash=trash.filter(x=>x.id!==product.id);commit(next);saveProductTrash(nextTrash);setTrash(nextTrash);setNotice("محصول بازیابی شد.");};
  const duplicate=(product:AdminProductRecord)=>{const copy={...structuredClone(product),id:`copy-${Date.now()}`,name:`کپی ${product.name}`,specs:{...product.specs,code:`${product.specs.code}-COPY`},createdAt:Date.now(),sold:0,admin:{...structuredClone(product.admin),status:"draft" as const,versions:[]}};commit([copy,...items]);setEditing(copy);};
  const exportCsv=()=>{const rows=[["name","latin","price","code","category","status"],...items.map(x=>[x.name,x.latin,String(x.price),x.specs.code,x.category,x.admin.status])];const csv="\uFEFF"+rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(",")).join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="kolbe-products.csv";anchor.click();URL.revokeObjectURL(url);setNotice("خروجی CSV ساخته شد.");};
  const importCsv=(file:File|null)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const lines=String(reader.result).replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error();const added=lines.slice(1).map((line,index)=>{const columns=line.match(/("(?:[^"]|"")*"|[^,]+)/g)?.map(x=>x.replace(/^"|"$/g,"").replace(/""/g,'"'))??[];const product=createAdminProduct();return {...product,id:`csv-${Date.now()}-${index}`,name:columns[0]??"",latin:columns[1]??"",price:Number(columns[2])||0,category:columns[4]||product.category,categoryLabel:categories.find(c=>c.slug===(columns[4]||product.category))?.label??product.categoryLabel,specs:{...product.specs,code:columns[3]||product.specs.code},admin:{...product.admin,status:(columns[5]==="published"?"published":"draft") as "published"|"draft"}}});commit([...added,...items]);setNotice(`${fa(added.length)} محصول از CSV وارد شد.`);}catch{setNotice("ساختار فایل CSV معتبر نیست.");}};reader.readAsText(file);};

  if (editing) return <AdminProductEditor initial={editing} onBack={() => setEditing(null)} onSave={saveProduct} />;

  const source=view==="active"?items:trash;
  const list = source.filter((p) => (p.name.includes(q) || p.specs.code.includes(q)) && (status==="all"||p.admin.status===status));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-medium">محصولات</h2>
        <span className="text-[12px] text-neutral-500 num-fa">({fa(source.length)})</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجو در محصولات..."
          className={input + " max-w-[220px]"}
        />
        <select aria-label="فیلتر وضعیت محصول" value={status} onChange={e=>setStatus(e.target.value)} className={input+" max-w-40"}><option value="all">همه وضعیت‌ها</option><option value="draft">پیش‌نویس</option><option value="review">در انتظار بررسی</option><option value="published">منتشرشده</option></select>
        <div className="mr-auto flex flex-wrap gap-2"><button onClick={()=>setView(view==="active"?"trash":"active")} className="border border-neutral-300 px-3 py-2 text-[10px]">{view==="active"?`سطل زباله (${fa(trash.length)})`:"بازگشت به محصولات"}</button><button onClick={exportCsv} className="border border-neutral-300 px-3 py-2 text-[10px]">خروجی CSV</button><label className="cursor-pointer border border-neutral-300 px-3 py-2 text-[10px]">ورود CSV<input aria-label="ورود CSV محصولات" type="file" accept=".csv,text/csv" className="sr-only" onChange={e=>importCsv(e.target.files?.[0]??null)}/></label>{view==="active"&&<button onClick={createProduct} className="rounded-[3px] bg-[#011c3a] px-5 py-2 text-[12px] font-medium text-white">+ ایجاد محصول</button>}</div>
      </div>
      {notice&&<p role="status" className="mb-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10px] text-[#36563a]">{notice}</p>}

      <div className="overflow-x-auto rounded-[3px] border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-right text-neutral-500">
              <th className="p-3 font-medium">محصول</th>
              <th className="p-3 font-medium">کد</th>
              <th className="p-3 font-medium">دسته</th>
              <th className="p-3 font-medium">قیمت</th>
              <th className="p-3 font-medium">موجودی</th>
              <th className="p-3 font-medium">فروش</th>
              <th className="p-3 font-medium">وضعیت</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const inStock = p.sizes.filter((s) => s.inStock).length;
              return (
                <tr key={p.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <img src={p.images[0]??"/images/flat.jpg"} alt="" className="h-11 w-9 object-cover" loading="lazy" />
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="mt-0.5 text-[10.5px] text-neutral-500">{p.latin}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-neutral-500">{p.specs.code}</td>
                  <td className="p-3">{p.categoryLabel}</td>
                  <td className="p-3 num-fa">{toman(p.price)}</td>
                  <td className="p-3">
                    <span className={"rounded-[3px] px-2 py-1 text-[10.5px] " + (inStock > 3 ? "bg-[#eef4ee] text-[#3d5c3a]" : "bg-[#f7f4ea] text-[#7a6320]")}>
                      {fa(inStock)} سایز موجود
                    </span>
                  </td>
                  <td className="p-3 num-fa">{fa(p.sold)}</td>
                  <td className="p-3"><span className="bg-neutral-100 px-2 py-1 text-[9.5px]">{p.admin.status==="published"?"منتشرشده":p.admin.status==="review"?"در انتظار بررسی":"پیش‌نویس"}</span></td>
                  <td className="p-3">
                    <div className="flex gap-2 text-[10px]">{view==="active"?<><button onClick={() => setEditing(p)} className="underline hover:text-[#011c3a]">ویرایش</button><button onClick={()=>duplicate(p)} className="underline">کپی</button><button onClick={()=>remove(p)} className="text-red-700 underline">حذف</button></>:<><button onClick={()=>restore(p)} className="underline">بازیابی</button><button onClick={()=>{const next=trash.filter(x=>x.id!==p.id);saveProductTrash(next);setTrash(next);setNotice("محصول برای همیشه حذف شد.")}} className="text-red-700 underline">حذف دائمی</button></>}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length&&<div className="py-14 text-center text-[11px] text-neutral-400">محصولی با این فیلتر پیدا نشد.</div>}
      </div>
    </div>
  );
}

/* --------------------------------- سایر پنل‌ها ------------------------------- */

function OrdersPanel() {
  const [filter, setFilter] = useState("همه");
  const [items, setItems] = useState(() => { try { const raw=localStorage.getItem("kv_admin_orders"); return raw ? JSON.parse(raw) as typeof orders : orders; } catch { return orders; } });
  const [selected, setSelected] = useState<(typeof orders)[number] | null>(null);
  const statuses = ["همه", "پرداخت شده", "در حال پردازش", "در حال ارسال", "تحویل شده", "مرجوع شده"];
  const list = filter === "همه" ? items : items.filter((o) => o.status === filter);
  const updateStatus = (code:string,status:string) => { const next=items.map(order=>order.code===code?{...order,status}:order); setItems(next); localStorage.setItem("kv_admin_orders",JSON.stringify(next)); };

  return (
    <div>
      <h2 className="mb-5 text-[16px] font-medium">سفارش‌ها</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={
              "rounded-[3px] px-3 py-1.5 text-[11.5px] transition " +
              (filter === s ? "bg-[#011c3a] text-white" : "border border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[3px] border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-right text-neutral-500">
              <th className="p-3 font-medium">کد سفارش</th>
              <th className="p-3 font-medium">مشتری</th>
              <th className="p-3 font-medium">تاریخ</th>
              <th className="p-3 font-medium">اقلام</th>
              <th className="p-3 font-medium">مبلغ</th>
              <th className="p-3 font-medium">وضعیت</th>
              <th className="p-3 font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.code} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="p-3 num-fa">{o.code}</td>
                <td className="p-3">{o.customer}</td>
                <td className="p-3 text-neutral-500">{o.date}</td>
                <td className="p-3 num-fa">{fa(o.items)}</td>
                <td className="p-3 num-fa">{toman(o.total)}</td>
                <td className="p-3">
                  <select aria-label={`وضعیت سفارش ${o.code}`} value={o.status} onChange={event=>updateStatus(o.code,event.target.value)} className="rounded-[3px] border border-neutral-300 px-2 py-1 text-[11px] outline-none">
                    {statuses.slice(1).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex gap-2 text-[11px]">
                    <button onClick={()=>setSelected(o)} className="underline">جزئیات</button>
                    <button onClick={()=>{setSelected(o);setTimeout(()=>window.print(),50)}} className="underline">فاکتور</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <section className="mt-4 border border-neutral-200 bg-white p-5" aria-label="جزئیات سفارش"><div className="flex items-start justify-between"><div><p className="text-[9px] text-neutral-400">ORDER DETAIL</p><h3 className="mt-2 text-[15px] font-medium num-fa">سفارش {selected.code}</h3></div><button onClick={()=>setSelected(null)} className="text-[10px] underline">بستن</button></div><dl className="mt-5 grid gap-3 text-[10.5px] sm:grid-cols-2 lg:grid-cols-4">{[["مشتری",selected.customer],["تاریخ",selected.date],["تعداد اقلام",fa(selected.items)],["مبلغ",toman(selected.total)],["وضعیت",selected.status],["روش پرداخت","درگاه آنلاین"],["روش ارسال","پست پیشتاز"],["کد پیگیری","در انتظار تخصیص"]].map(([term,value])=><div key={term} className="bg-[#f6f6f4] p-3"><dt className="text-neutral-400">{term}</dt><dd className="mt-1 font-medium num-fa">{value}</dd></div>)}</dl></section>}
    </div>
  );
}

function CustomersPanel() {
  const initialCustomers = [
    { name: "امیرحسین رضایی", phone: "۰۹۱۲۳۴۵۶۷۸۹", orders: 7, total: 24_500_000, city: "تهران" },
    { name: "سهیل مرادی", phone: "۰۹۱۲۹۸۷۶۵۴۳", orders: 4, total: 12_800_000, city: "کرج" },
    { name: "نیما صادقی", phone: "۰۹۱۳۱۱۲۲۳۳۴", orders: 3, total: 8_400_000, city: "اصفهان" },
    { name: "بابک کریمی", phone: "۰۹۱۴۵۵۶۶۷۷۸", orders: 2, total: 9_100_000, city: "تبریز" },
  ];
  const [customers, setCustomers] = useState(() => { try { const raw=localStorage.getItem("kv_admin_customers"); return raw ? JSON.parse(raw) as typeof initialCustomers : initialCustomers; } catch { return initialCustomers; } });
  const [selected,setSelected]=useState<(typeof initialCustomers)[number]|null>(null);
  const [wallet,setWallet]=useState(0);
  const saveWallet=()=>{if(!selected)return;const key=`kv_wallet_${selected.phone}`;localStorage.setItem(key,String(wallet));};

  return (
    <div>
      <h2 className="mb-5 text-[16px] font-medium">مشتریان</h2>
      <div className="overflow-x-auto rounded-[3px] border border-neutral-200 bg-white">
        <table className="w-full min-w-[620px] text-[12px]">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-right text-neutral-500">
              <th className="p-3 font-medium">نام</th>
              <th className="p-3 font-medium">موبایل</th>
              <th className="p-3 font-medium">شهر</th>
              <th className="p-3 font-medium">تعداد سفارش</th>
              <th className="p-3 font-medium">مجموع خرید</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.phone} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 num-fa">{c.phone}</td>
                <td className="p-3">{c.city}</td>
                <td className="p-3 num-fa">{fa(c.orders)}</td>
                <td className="p-3 num-fa">{toman(c.total)}</td>
                <td className="p-3">
                  <button onClick={()=>{setSelected(c);setWallet(Number(localStorage.getItem(`kv_wallet_${c.phone}`)||0));}} className="text-[11.5px] underline">پروفایل</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected&&<section className="mt-4 grid gap-4 border border-neutral-200 bg-white p-5 lg:grid-cols-[1fr_300px]" aria-label="پروفایل مشتری"><div><div className="flex items-start justify-between"><div><p className="text-[9px] text-neutral-400">CUSTOMER 360</p><h3 className="mt-2 text-[16px] font-medium">{selected.name}</h3><p className="mt-1 text-[10px] text-neutral-500 num-fa">{selected.phone} · {selected.city}</p></div><button onClick={()=>setSelected(null)} className="text-[10px] underline">بستن</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["تعداد سفارش",fa(selected.orders)],["ارزش خرید",toman(selected.total)],["امتیاز وفاداری",fa(Math.round(selected.total/100000))],["برچسب","مشتری فعال"]].map(([a,b])=><div key={a} className="bg-[#f6f6f4] p-3"><p className="text-[9px] text-neutral-400">{a}</p><p className="mt-1 text-[10.5px] font-medium num-fa">{b}</p></div>)}</div></div><aside className="bg-[#011c3a] p-4 text-white"><p className="text-[10px] text-white/55">کیف پول مشتری</p><label className="mt-3 block text-[9.5px] text-white/70">موجودی (تومان)<input type="number" min="0" value={wallet} onChange={e=>setWallet(Number(e.target.value))} className="mt-1.5 h-10 w-full bg-white px-3 text-[11px] text-[#011c3a]"/></label><button onClick={saveWallet} className="mt-3 h-9 w-full border border-white/30 text-[10px] hover:border-white">ذخیره موجودی کیف پول</button></aside></section>}
    </div>
  );
}

function ContentPanel() {
  const [tab, setTab] = useState("articles");
  const [articleItems,setArticleItems]=useState(()=>{try{const raw=localStorage.getItem("kv_admin_articles");return raw?JSON.parse(raw) as typeof articles:articles;}catch{return articles;}});
  const [saved,setSaved]=useState(false);
  const [homepagePins,setHomepagePins]=useState(loadHomepageJournalPins);
  const [siteSettings,setSiteSettings]=useState(loadSiteSettings);
  const persistSiteSettings=(next:typeof siteSettings)=>{setSiteSettings(next);saveSiteSettings(next);setSaved(true);setTimeout(()=>setSaved(false),1500);};
  const persistArticles=(next:typeof articles)=>{setArticleItems(next);saveManagedArticles(next);setSaved(true);setTimeout(()=>setSaved(false),1500);};
  const toggleHomepagePin=(slug:string)=>{const next=homepagePins.includes(slug)?homepagePins.filter(item=>item!==slug):[...homepagePins,slug];setHomepagePins(next);saveHomepageJournalPins(next);setSaved(true);setTimeout(()=>setSaved(false),1500);};
  const tabs = [
    { id: "articles", label: "مقالات" },
    { id: "pages", label: "صفحات" },
    { id: "banners", label: "بنرها و صفحه اصلی" },
    { id: "menus", label: "منوها و فوتر" },
  ];

  return (
    <div>
      <h2 className="mb-5 text-[16px] font-medium">محتوا و صفحات</h2>
      {saved&&<p role="status" className="mb-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10.5px] text-[#36563a]">محتوا ذخیره شد.</p>}
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "rounded-[3px] px-3 py-1.5 text-[11.5px] transition " +
              (tab === t.id ? "bg-[#011c3a] text-white" : "border border-neutral-300 hover:border-[#011c3a]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
        {tab === "articles" && (
          <div className="space-y-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><button onClick={()=>persistArticles([{...articles[0],slug:`draft-${Date.now()}`,title:"مقاله جدید",date:new Intl.DateTimeFormat("fa-IR").format(new Date())},...articleItems])} className="rounded-[3px] bg-[#011c3a] px-4 py-2 text-[11.5px] text-white">+ مقاله جدید</button><p className="text-[10.5px] text-neutral-500 num-fa">{fa(homepagePins.length)} مقاله در صفحه اصلی پین شده</p></div>
            {articleItems.map((a,index) => (
              <div key={a.slug} className="flex items-center gap-3 border-b border-neutral-100 py-2.5">
                <img src={a.img} alt="" className="h-10 w-14 object-cover" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <input aria-label={`عنوان ${a.slug}`} value={a.title} onChange={e=>persistArticles(articleItems.map((item,i)=>i===index?{...item,title:e.target.value}:item))} className="h-8 w-full border-b border-transparent bg-transparent text-[12px] outline-none focus:border-[#011c3a]"/>
                  <p className="mt-0.5 text-[10.5px] text-neutral-500">{a.category} — {a.date}</p>
                </div>
                <button type="button" onClick={()=>toggleHomepagePin(a.slug)} aria-pressed={homepagePins.includes(a.slug)} aria-label={`${homepagePins.includes(a.slug)?"برداشتن از":"پین در"} صفحه اصلی: ${a.title}`} className={(homepagePins.includes(a.slug)?"border-[#011c3a] bg-[#011c3a] text-white":"border-neutral-300 text-neutral-500 hover:border-[#011c3a]")+" flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition"}><Icon name="pushPin" className="h-4 w-4" /></button>
                <button onClick={()=>persistArticles(articleItems.filter((_,i)=>i!==index))} className="text-[11px] text-red-700 underline">حذف</button>
              </div>
            ))}
          </div>
        )}

        {tab === "pages" && (
          <div className="space-y-2">
            {["درباره ما", "تماس با ما", "قوانین و مقررات", "حریم خصوصی", "شرایط مرجوعی", "راهنمای سایز"].map((p) => (
              <div key={p} className="flex items-center justify-between border-b border-neutral-100 py-2.5">
                <span className="text-[12px]">{p}</span>
                <button onClick={()=>{localStorage.setItem(`kv_page_${p}`,JSON.stringify({updatedAt:Date.now()}));setSaved(true);setTimeout(()=>setSaved(false),1500);}} className="text-[11px] underline">ثبت ویرایش</button>
              </div>
            ))}
          </div>
        )}

        {tab === "banners" && (
          <div className="space-y-6">
            <section className="border border-neutral-200 p-4">
              <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="text-[13px] font-medium">هیرو صفحه اصلی</h3><p className="mt-1 text-[10.5px] text-neutral-500">قالب، تصاویر، متن و دکمه‌ها را تغییر دهید.</p></div><Link to="/" className="text-[11px] underline">پیش‌نمایش سایت</Link></div>
              <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {([{id:"cover",label:"تمام تصویر"},{id:"split",label:"تصویر راست"},{id:"mosaic",label:"موزاییک"},{id:"duo",label:"دو تصویر"},{id:"minimal",label:"مینیمال"}] as {id:HeroTemplate;label:string}[]).map(template=><button key={template.id} type="button" onClick={()=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,template:template.id}})} className={(siteSettings.hero.template===template.id?"border-[#011c3a] bg-[#011c3a] text-white":"border-neutral-300 hover:border-[#011c3a]")+" min-h-16 border px-2 text-[10.5px]"}>{template.label}</button>)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[10.5px] text-neutral-500">بالانویس<input className={input+" mt-1.5"} value={siteSettings.hero.eyebrow} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,eyebrow:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500">عنوان<input className={input+" mt-1.5"} value={siteSettings.hero.title} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,title:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500 sm:col-span-2">توضیح<textarea className="mt-1.5 min-h-20 w-full border border-neutral-300 p-3 text-[12px] outline-none focus:border-[#011c3a]" value={siteSettings.hero.description} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,description:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500">متن دکمه اصلی<input className={input+" mt-1.5"} value={siteSettings.hero.primaryLabel} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,primaryLabel:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500">لینک دکمه اصلی<input dir="ltr" className={input+" mt-1.5 text-left"} value={siteSettings.hero.primaryTo} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,primaryTo:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500">متن دکمه دوم<input className={input+" mt-1.5"} value={siteSettings.hero.secondaryLabel} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,secondaryLabel:e.target.value}})}/></label>
                <label className="text-[10.5px] text-neutral-500">لینک دکمه دوم<input dir="ltr" className={input+" mt-1.5 text-left"} value={siteSettings.hero.secondaryTo} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,secondaryTo:e.target.value}})}/></label>
                {siteSettings.hero.images.map((image,index)=><label key={index} className="text-[10.5px] text-neutral-500">تصویر {fa(index+1)}<div className="mt-1.5 flex gap-2"><img src={image} alt="" className="h-9 w-12 object-cover"/><input dir="ltr" className={input+" text-left"} value={image} onChange={e=>persistSiteSettings({...siteSettings,hero:{...siteSettings.hero,images:siteSettings.hero.images.map((item,i)=>i===index?e.target.value:item)}})}/></div></label>)}
              </div>
            </section>
            <section className="border border-neutral-200 p-4">
              <h3 className="mb-4 text-[13px] font-medium">بنر کالکشن</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[10.5px] text-neutral-500">نوع رسانه<select className={input+" mt-1.5"} value={siteSettings.collectionBanner.mediaType} onChange={e=>persistSiteSettings({...siteSettings,collectionBanner:{...siteSettings.collectionBanner,mediaType:e.target.value as "image"|"video"}})}><option value="image">تصویر</option><option value="video">ویدیو</option></select></label>
                <label className="text-[10.5px] text-neutral-500">آدرس تصویر یا ویدیو<input dir="ltr" className={input+" mt-1.5 text-left"} value={siteSettings.collectionBanner.mediaUrl} onChange={e=>persistSiteSettings({...siteSettings,collectionBanner:{...siteSettings.collectionBanner,mediaUrl:e.target.value}})}/></label>
                {(["eyebrow","title","description","buttonLabel","buttonTo"] as const).map(key=><label key={key} className={(key==="description"?"sm:col-span-2 ":"")+"text-[10.5px] text-neutral-500"}>{({eyebrow:"بالانویس",title:"عنوان",description:"توضیح",buttonLabel:"متن دکمه",buttonTo:"لینک دکمه"})[key]}<input className={input+" mt-1.5"} value={siteSettings.collectionBanner[key]} onChange={e=>persistSiteSettings({...siteSettings,collectionBanner:{...siteSettings.collectionBanner,[key]:e.target.value}})}/></label>)}
              </div>
            </section>
          </div>
        )}

        {tab === "menus" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-[12px] font-medium">هدر و منوی اصلی</p>
              <label className="mb-3 block text-[10.5px] text-neutral-500">نام برند<input className={input+" mt-1.5"} value={siteSettings.header.brand} onChange={e=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,brand:e.target.value}})}/></label>
              <label className="mb-3 block text-[10.5px] text-neutral-500">عنوان دکمه برجسته فروشگاه<input className={input+" mt-1.5"} value={siteSettings.header.shopLabel} onChange={e=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,shopLabel:e.target.value}})}/></label>
              {siteSettings.header.nav.map((item,index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-neutral-100 py-2">
                  <input aria-label={`عنوان منو ${index+1}`} className={input} value={item.label} onChange={e=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,nav:siteSettings.header.nav.map((navItem,i)=>i===index?{...navItem,label:e.target.value}:navItem)}})}/>
                  <input aria-label={`لینک منو ${index+1}`} dir="ltr" className={input+" text-left"} value={item.to} onChange={e=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,nav:siteSettings.header.nav.map((navItem,i)=>i===index?{...navItem,to:e.target.value}:navItem)}})}/>
                  <button onClick={()=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,nav:siteSettings.header.nav.filter((_,i)=>i!==index)}})} className="text-neutral-400 hover:text-[#9e4b3c]" aria-label="حذف"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <button onClick={()=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,nav:[...siteSettings.header.nav,{label:"آیتم جدید",to:"/"}]}})} className="mt-2 h-9 w-full rounded-[3px] border border-dashed border-neutral-300 text-[11.5px] text-neutral-500">
                + افزودن آیتم
              </button>
            </div>
            <div>
              <p className="mb-3 text-[12px] font-medium">محتوای فوتر</p>
              {(["title","description","emailPlaceholder","address","phone","hours","email"] as const).map(key=><label key={key} className="mb-3 block text-[10.5px] text-neutral-500">{({title:"عنوان خبرنامه",description:"توضیح خبرنامه",emailPlaceholder:"متن ورودی ایمیل",address:"نشانی",phone:"تلفن",hours:"ساعت کاری",email:"ایمیل"})[key]}<input className={input+" mt-1.5"} value={siteSettings.footer[key]} onChange={e=>persistSiteSettings({...siteSettings,footer:{...siteSettings.footer,[key]:e.target.value}})}/></label>)}
              {siteSettings.footer.columns.map((column,index)=><div key={index} className="mb-3 border-t border-neutral-200 pt-3"><input aria-label={`عنوان ستون فوتر ${index+1}`} className={input} value={column.title} onChange={e=>persistSiteSettings({...siteSettings,footer:{...siteSettings.footer,columns:siteSettings.footer.columns.map((item,i)=>i===index?{...item,title:e.target.value}:item)}})}/><textarea aria-label={`لینک‌های ستون فوتر ${index+1}`} className="mt-2 min-h-20 w-full border border-neutral-300 p-3 text-[11px] outline-none" value={column.items.join("\n")} onChange={e=>persistSiteSettings({...siteSettings,footer:{...siteSettings.footer,columns:siteSettings.footer.columns.map((item,i)=>i===index?{...item,items:e.target.value.split("\n")}:item)}})}/></div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WholesalePanel() {
  const [requests,setRequests]=useState(()=>{try{const raw=localStorage.getItem("kv_admin_wholesale_requests");return raw?JSON.parse(raw) as typeof wholesaleRequests:wholesaleRequests;}catch{return wholesaleRequests;}});
  const [selected,setSelected]=useState<(typeof wholesaleRequests)[number]|null>(null);
  const update=(phone:string,status:string)=>{const next=requests.map(item=>item.phone===phone?{...item,status}:item);setRequests(next);localStorage.setItem("kv_admin_wholesale_requests",JSON.stringify(next));};
  return (
    <div>
      <h2 className="mb-5 text-[16px] font-medium">درخواست‌های عمده‌فروشی</h2>
      <div className="overflow-x-auto rounded-[3px] border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-right text-neutral-500">
              <th className="p-3 font-medium">نام</th>
              <th className="p-3 font-medium">فروشگاه</th>
              <th className="p-3 font-medium">شهر</th>
              <th className="p-3 font-medium">تماس</th>
              <th className="p-3 font-medium">پلن</th>
              <th className="p-3 font-medium">وضعیت</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.phone} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.store}</td>
                <td className="p-3">{r.city}</td>
                <td className="p-3 num-fa">{r.phone}</td>
                <td className="p-3">{r.plan}</td>
                <td className="p-3">
                  <select aria-label={`وضعیت درخواست ${r.phone}`} value={r.status} onChange={e=>update(r.phone,e.target.value)} className="rounded-[3px] border border-neutral-300 px-2 py-1 text-[11px] outline-none">
                    {["جدید", "در تماس", "تأیید شده", "رد شده"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <button onClick={()=>setSelected(r)} className="text-[11.5px] underline">جزئیات</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected&&<section className="mt-4 border border-neutral-200 bg-white p-5" aria-label="جزئیات درخواست عمده"><div className="flex justify-between"><div><p className="text-[9px] text-neutral-400">WHOLESALE LEAD</p><h3 className="mt-2 text-[15px] font-medium">{selected.store}</h3></div><button onClick={()=>setSelected(null)} className="text-[10px] underline">بستن</button></div><div className="mt-4 grid gap-3 text-[10.5px] sm:grid-cols-2 lg:grid-cols-4">{[["متقاضی",selected.name],["شهر",selected.city],["تماس",selected.phone],["پلن",selected.plan],["وضعیت",selected.status]].map(([a,b])=><div key={a} className="bg-[#f6f6f4] p-3"><p className="text-neutral-400">{a}</p><p className="mt-1 font-medium num-fa">{b}</p></div>)}</div></section>}
    </div>
  );
}

function ReportsPanel() {
  const reports = [
    { label: "فروش این ماه", value: "۳۴۲٬۸۰۰٬۰۰۰ تومان", sub: "+۱۸٪ نسبت به ماه قبل" },
    { label: "میانگین سبد خرید", value: "۲٬۹۴۰٬۰۰۰ تومان", sub: "+۷٪" },
    { label: "نرخ تبدیل", value: "۳٫۸٪", sub: "هدف: ۴٫۵٪" },
    { label: "نرخ مرجوعی", value: "۴٫۲٪", sub: "-۰٫۸٪" },
    { label: "بازدید ماهانه", value: "۵۴٬۲۱۰ نفر", sub: "+۲۲٪" },
    { label: "ارزش موجودی انبار", value: "۱٬۲۴۰٬۰۰۰٬۰۰۰ تومان", sub: "۸۹۲ قطعه" },
  ];

  const lowStock = products.filter((p) => p.sizes.filter((s) => s.inStock).length <= 4);

  return (
    <div className="space-y-6">
      <h2 className="text-[16px] font-medium">گزارش‌ها</h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <div key={r.label} className="rounded-[3px] border border-neutral-200 bg-white p-4">
            <p className="text-[11.5px] text-neutral-500">{r.label}</p>
            <p className="mt-2 text-[18px] font-medium num-fa">{r.value}</p>
            <p className="mt-1 text-[11px] text-neutral-400 num-fa">{r.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[3px] border border-neutral-200 bg-white p-5">
        <h3 className="mb-4 text-[13px] font-medium">هشدار موجودی انبار</h3>
        <div className="space-y-2">
          {lowStock.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-neutral-100 py-2 last:border-0">
              <img src={p.images[0]} alt="" className="h-10 w-8 object-cover" loading="lazy" />
              <span className="flex-1 text-[12px]">{p.name}</span>
              <span className="rounded-[3px] bg-[#f7f4ea] px-2 py-1 text-[10.5px] text-[#7a6320] num-fa">
                فقط {fa(p.sizes.filter((s) => s.inStock).length)} سایز موجود
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- پنل اصلی -------------------------------- */

export default function Admin({ embedded = false }: { embedded?: boolean }) {
  const [page, setPage] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={embedded ? "min-h-[calc(100vh-73px)] bg-[#f6f6f4]" : "min-h-screen bg-[#f6f6f4]"}>
      {!embedded && <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-4">
            <button className="lg:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="منو">
              <Icon name={menuOpen ? "close" : "menu"} className="h-5 w-5" />
            </button>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-[0.12em]">کلبه وینتیج</span>
              <span className="mt-1 text-[8px] tracking-[0.35em] text-neutral-400">ADMIN PANEL</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-[11.5px] text-neutral-500 hover:underline">مشاهده سایت</Link>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#011c3a] text-[11px] text-white">م</span>
          </div>
        </div>
      </header>}

      {embedded && <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2.5 lg:hidden"><button type="button" onClick={() => setMenuOpen(!menuOpen)} aria-label="منوی مدیریت" className="flex h-10 items-center gap-2 text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]"><Icon name={menuOpen ? "close" : "menu"} className="h-5 w-5" />منوی مدیریت</button><Link to="/" className="text-[10.5px] text-neutral-500 underline underline-offset-4">مشاهده سایت</Link></div>}
      <div className="flex">
        <aside className={(embedded ? "fixed bottom-0 right-0 top-[73px] lg:sticky lg:top-[73px] lg:h-[calc(100vh-73px)] " : "fixed inset-y-0 right-0 pt-20 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:pt-0 ") + "z-30 w-64 overflow-y-auto border-l border-neutral-200 bg-white lg:block lg:w-60 " + (menuOpen ? "block" : "hidden")}>
          <div className="border-b border-neutral-100 px-5 py-4"><p className="text-[9px] text-neutral-400">فضای مدیریت</p><p className="mt-1 text-[11.5px] font-medium">فروشگاه کلبه وینتیج</p></div>
          <nav className="space-y-1 p-3 pb-8">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setPage(n.id);
                  setMenuOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2.5 rounded-[3px] px-3 py-2.5 text-right text-[12.5px] transition " +
                  (page === n.id ? "bg-[#011c3a] text-white" : "hover:bg-neutral-100")
                }
              >
                <Icon name={n.icon} className="h-4 w-4 shrink-0" />
                {n.label}
              </button>
            ))}
          </nav>
        </aside>

        {menuOpen && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          {page === "retail-settings" && <RetailPolicyCenter />}
          {page === "dashboard" && <Dashboard />}
          {page === "products" && <ProductsPanel />}
          {page === "inventory" && <InventoryOperations />}
          {page === "orders" && <OrdersPanel />}
          {page === "commerce" && <CommerceOperations />}
          {page === "customers" && <AdminCRM />}
          {page === "content" && <ContentPanel />}
          {page === "wholesale" && <WholesalePanel />}
          {page === "reports" && <ReportsPanel />}
          {page === "access" && <AccessSecurity />}
          {page === "integrations" && <IntegrationsAutomation />}
          {page === "system" && <SystemCenter />}
        </main>
      </div>
    </div>
  );
}
