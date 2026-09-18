import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "../router";
import { products, categories, specLabels, specOrder, type Product } from "../data/catalog";
import { styles, articles } from "../siteData";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";
import { AccessSecurity, CommerceOperations, IntegrationsAutomation, SystemCenter } from "./AdminOperations";
import AdminProductEditor from "./AdminProductEditor";
import { createAdminProduct, loadAdminProducts, loadProductTrash, saveAdminProducts, saveProductTrash, type AdminProductRecord } from "../adminProducts";
import { loadHomepageJournalPins, saveHomepageJournalPins, saveManagedArticles } from "../journalSettings";
import AdminCRM from "./AdminCRM";
import { loadSiteSettings, saveSiteSettings, type HeroTemplate } from "../siteSettings";
import RetailPolicyCenter from "./RetailPolicyCenter";
import { readCommerceEvents, type CommerceEvent } from "../lib/analytics";
import CatalogTaxonomyManager from "./CatalogTaxonomyManager";

const AdminLogs = lazy(() => import("./AdminLogs"));
const SiteDesignCenter = lazy(() => import("./SiteDesignCenter"));
const CampaignCenter = lazy(() => import("./CampaignCenter"));
const AdminSupportCenter = lazy(() => import("./AdminSupportCenter"));
const MessagingAutomationCenter = lazy(() => import("./MessagingAutomationCenter"));

const input =
  "h-9 w-full rounded-[3px] border border-neutral-300 px-3 text-[12px] outline-none transition focus:border-[#011c3a]";

const nav = [
  { id: "retail-settings", label: "تنظیمات خرده", icon: "check" },
  { id: "design-center", label: "مرکز طراحی سایت", icon: "star" },
  { id: "dashboard", label: "داشبورد", icon: "shield" },
  { id: "products", label: "محصولات", icon: "bag" },
  { id: "orders", label: "سفارش‌ها", icon: "truck" },
  { id: "commerce", label: "مرجوعی و ارسال", icon: "return" },
  { id: "customers", label: "CRM مشتریان", icon: "user" },
  { id: "vip-customers", label: "مشتریان VIP", icon: "star" },
  { id: "support", label: "پشتیبانی زنده", icon: "mail" },
  { id: "messaging", label: "پیامک و اتوماسیون", icon: "activity" },
  { id: "campaigns", label: "جشنواره و تخفیف", icon: "star" },
  { id: "content", label: "محتوا و صفحات", icon: "mail" },
  { id: "reports", label: "گزارش‌ها", icon: "clock" },
  { id: "logs", label: "لاگ‌ها و خطاها", icon: "activity" },
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
  /* طبق نیازسنجی کارفرما: داشبورد همه شاخصها را همزمان نشان دهد (1-d)
     و آمار با بازه دلخواه قابل تغییر باشد (2-d) */
  const [range, setRange] = useState<"today" | "week" | "month" | "custom">("today");
  const rangeLabel = range === "today" ? "امروز" : range === "week" ? "این هفته" : range === "month" ? "این ماه" : "بازه دلخواه";
  const salesByRange: Record<string, string> = { today: "۱۸٬۴۵۰٬۰۰۰", week: "۱۰۴٬۳۲۰٬۰۰۰", month: "۴۱۲٬۷۸۰٬۰۰۰", custom: "—" };
  const ordersByRange: Record<string, string> = { today: "۲۳", week: "۱۳۱", month: "۵۴۸", custom: "—" };
  const lowStockCount = 4; // محصولات زیر حد آستانه (از تنبیه موجودی پنل محصولات)

  const stats = [
    { label: `فروش ${rangeLabel}`, value: salesByRange[range], unit: "تومان", change: "+۱۲٪" },
    { label: "سفارش‌های جاری", value: ordersByRange[range], unit: "سفارش", change: "+۵٪" },
    { label: "موجودی بحرانی", value: fa(lowStockCount), unit: "محصول زیر آستانه", change: "نیاز به شارژ", critical: true },
    { label: "نرخ تبدیل", value: "۳٫۸", unit: "درصد", change: "+۰٫۴" },
  ];

  const bars = [42, 55, 38, 68, 74, 61, 88, 79, 95, 71, 84, 92];
  const months = ["فرو", "ارد", "خرد", "تیر", "مرد", "شهر", "مهر", "آبا", "آذر", "دی", "بهم", "اسف"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-neutral-500">بازه آمار:</span>
        {([["today", "روزانه"], ["week", "هفتگی"], ["month", "ماهانه"], ["custom", "بازه دلخواه"]] as const).map(([id, name]) => (
          <button key={id} onClick={() => setRange(id)} className={(range === id ? "bg-[#011c3a] text-white" : "border border-neutral-300 text-neutral-600 hover:border-[#011c3a]") + " rounded-[3px] px-3 py-1.5 text-[10.5px] transition"}>{name}</button>
        ))}
        {range === "custom" && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-neutral-500">
            <input type="date" aria-label="از تاریخ" className="h-8 rounded-[3px] border border-neutral-300 px-2" dir="ltr" />
            تا
            <input type="date" aria-label="تا تاریخ" className="h-8 rounded-[3px] border border-neutral-300 px-2" dir="ltr" />
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={"rounded-[3px] border bg-white p-4 " + ((s as any).critical ? "border-[#d9b98f] bg-[#fffaf2]" : "border-neutral-200")}>
            <p className="text-[11.5px] text-neutral-500">{s.label}</p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[22px] font-medium num-fa">{s.value}</span>
              <span className="text-[11px] text-neutral-400">{s.unit}</span>
            </div>
            {!(s as any).critical && (
              <p className={"mt-1 text-[11px] num-fa " + (s.change.startsWith("-") ? "text-[#9e4b3c]" : "text-[#3d5c3a]")}>
                {s.change} نسبت به بازه قبل
              </p>
            )}
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
  const [selectedIds,setSelectedIds]=useState<Set<string>>(new Set());
  const [bulkMode,setBulkMode]=useState<"percent"|"amount">("percent");
  const [bulkValue,setBulkValue]=useState("");
  const [taxonomyOpen,setTaxonomyOpen]=useState(false);
  const toggleSelect=(id:string)=>setSelectedIds(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});
  const applyBulkPrice=()=>{const value=Number(bulkValue);if(!bulkValue||Number.isNaN(value)||selectedIds.size===0)return;const factor=bulkMode==="percent"?1+value/100:value;const updated=items.map(item=>selectedIds.has(item.id)?{...item,price:bulkMode==="percent"?Math.round(item.price*factor):Math.max(0,Math.round(item.price+factor))}:item);commit(updated);setNotice(`قیمت ${fa(selectedIds.size)} محصول بهروزرسانی شد.`);setBulkValue("");setSelectedIds(new Set());};

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
        <div className="mr-auto flex flex-wrap gap-2"><button onClick={()=>setTaxonomyOpen(value=>!value)} className="border border-neutral-300 px-3 py-2 text-[10px]">تعریف دسته / فصل / استایل</button><button onClick={()=>setView(view==="active"?"trash":"active")} className="border border-neutral-300 px-3 py-2 text-[10px]">{view==="active"?`سطل زباله (${fa(trash.length)})`:"بازگشت به محصولات"}</button><button onClick={exportCsv} className="border border-neutral-300 px-3 py-2 text-[10px]">خروجی CSV</button><label className="cursor-pointer border border-neutral-300 px-3 py-2 text-[10px]">ورود CSV<input aria-label="ورود CSV محصولات" type="file" accept=".csv,text/csv" className="sr-only" onChange={e=>importCsv(e.target.files?.[0]??null)}/></label>{view==="active"&&<button onClick={createProduct} className="rounded-[3px] bg-[#011c3a] px-5 py-2 text-[12px] font-medium text-white">+ ایجاد محصول</button>}</div>
      </div>
      {notice&&<p role="status" className="mb-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10px] text-[#36563a]">{notice}</p>}
      {taxonomyOpen&&<CatalogTaxonomyManager onClose={()=>setTaxonomyOpen(false)}/>}

      {view==="active"&&(
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[3px] border border-neutral-200 bg-neutral-50 p-3">
          <span className="text-[11px] text-neutral-600 num-fa">{fa(selectedIds.size)} محصول انتخابشده</span>
          <select aria-label="روش ویرایش گروهی قیمت" value={bulkMode} onChange={e=>setBulkMode(e.target.value as "percent"|"amount")} className={input+" max-w-36"}>
            <option value="percent">درصد (٪+/−)</option>
            <option value="amount">مبلغ (تومان+/−)</option>
          </select>
          <input aria-label="مقدار" value={bulkValue} onChange={e=>setBulkValue(e.target.value)} placeholder="مثلاً 10 یا -5" className={input+" max-w-36"} dir="ltr" />
          <button onClick={applyBulkPrice} disabled={selectedIds.size===0||!bulkValue} className="h-9 rounded-[3px] bg-[#011c3a] px-4 text-[11px] font-medium text-white disabled:opacity-40">اعمال روی انتخاب‌شده‌ها</button>
          <button onClick={()=>setSelectedIds(new Set(items.map(i=>i.id)))} className="h-9 rounded-[3px] border border-neutral-300 px-3 text-[10.5px]">انتخاب همه</button>
          <button onClick={()=>setSelectedIds(new Set())} className="h-9 rounded-[3px] border border-neutral-300 px-3 text-[10.5px]">پاک‌سازی</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-[3px] border border-neutral-200 bg-white">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-right text-neutral-500">
              <th className="w-10 p-3"></th>
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
                    <input type="checkbox" aria-label={`انتخاب ${p.name}`} checked={selectedIds.has(p.id)} onChange={()=>toggleSelect(p.id)} disabled={view!=="active"} className="accent-[#011c3a]" />
                  </td>
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

function printInvoice(order:(typeof orders)[number]) {
  const popup=window.open("","_blank","width=900,height=900"); if(!popup)return;
  const safe=(value:string)=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]||char));
  popup.document.write(`<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>فاکتور ${safe(order.code)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#071c31;margin:0;font-size:12px}.head{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #071c31;padding-bottom:18px}.brand{font-size:22px;font-weight:700}.muted{color:#667085}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:22px 0}.cell{border:1px solid #ddd;padding:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #ddd;padding:11px;text-align:right}th{background:#f5f5f3}.total{margin-right:auto;width:310px;margin-top:18px;border:2px solid #071c31;padding:15px;font-size:15px}.foot{margin-top:40px;border-top:1px solid #ddd;padding-top:15px;color:#667085;font-size:10px}@media print{button{display:none}}</style></head><body><div class="head"><div><div class="brand">کلبه وینتیج</div><div class="muted">فاکتور رسمی فروش اینترنتی</div></div><div><b>${safe(order.code)}</b><div class="muted">تاریخ: ${safe(order.date)}</div></div></div><div class="meta"><div class="cell"><span class="muted">خریدار</span><br><b>${safe(order.customer)}</b></div><div class="cell"><span class="muted">وضعیت</span><br><b>${safe(order.status)}</b></div><div class="cell"><span class="muted">روش پرداخت</span><br>پرداخت آنلاین</div><div class="cell"><span class="muted">روش ارسال</span><br>پست پیشتاز ـ کد رهگیری پس از ارسال</div></div><table><thead><tr><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody><tr><td>محصولات سفارش ${safe(order.code)}</td><td>${order.items.toLocaleString("fa-IR")}</td><td>${Math.round(order.total/order.items).toLocaleString("fa-IR")} تومان</td><td>${order.total.toLocaleString("fa-IR")} تومان</td></tr><tr><td>ارسال</td><td>۱</td><td>رایگان</td><td>۰ تومان</td></tr></tbody></table><div class="total">مبلغ قابل پرداخت: <b>${order.total.toLocaleString("fa-IR")} تومان</b></div><div class="foot">این فاکتور به‌صورت سیستمی صادر شده است. کلبه وینتیج ـ پشتیبانی ۰۲۱-۹۱۰۰۲۲۳۳</div><script>window.onload=()=>window.print()<\/script></body></html>`);popup.document.close();
}

function OrdersPanel({onOpenCustomer}:{onOpenCustomer?:(name:string)=>void}) {
  const [filter, setFilter] = useState("همه");
  const [inbox,setInbox]=useState<"new"|"processing"|"all">("new");
  const [items, setItems] = useState(() => { try { const raw=localStorage.getItem("kv_admin_orders"); return raw ? JSON.parse(raw) as typeof orders : orders; } catch { return orders; } });
  const [selected, setSelected] = useState<(typeof orders)[number] | null>(null);
  const statuses = ["همه", "پرداخت شده", "در حال پردازش", "در حال ارسال", "تحویل شده", "مرجوع شده"];
  const stageList=inbox==="new"?items.filter(order=>order.status==="پرداخت شده"):inbox==="processing"?items.filter(order=>["در حال پردازش","در حال ارسال"].includes(order.status)):items;
  const list = filter === "همه" ? stageList : stageList.filter((o) => o.status === filter);
  const updateStatus = (code:string,status:string) => { const next=items.map(order=>order.code===code?{...order,status}:order); setItems(next); localStorage.setItem("kv_admin_orders",JSON.stringify(next)); };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[9px] tracking-[.22em] text-neutral-400">ORDER INBOX</p><h2 className="mt-2 text-[18px] font-medium">اینباکس سفارش‌ها</h2><p className="mt-1 text-[10px] text-neutral-500">دریافت، بررسی، آماده‌سازی، ارسال و خدمات پس از فروش در یک جریان.</p></div><div className="flex border border-neutral-300 bg-white">{([["new","جدید"],["processing","در جریان"],["all","همه"]] as const).map(([id,label])=><button key={id} onClick={()=>setInbox(id)} className={`h-10 px-4 text-[10.5px] ${inbox===id?'bg-[#011c3a] text-white':''}`}>{label}</button>)}</div></div>
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
                    <button onClick={()=>printInvoice(o)} className="underline">فاکتور PDF</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && <section className="mt-4 border border-neutral-200 bg-white p-5" aria-label="جزئیات سفارش"><div className="flex items-start justify-between"><div><p className="text-[9px] text-neutral-400">ORDER DETAIL</p><h3 className="mt-2 text-[15px] font-medium num-fa">سفارش {selected.code}</h3><button onClick={()=>onOpenCustomer?.(selected.customer)} className="mt-2 text-[10px] text-[#011c3a] underline underline-offset-4">مشاهده پروفایل ۳۶۰ {selected.customer}</button></div><div className="flex gap-2"><button onClick={()=>printInvoice(selected)} className="h-9 border border-[#011c3a] px-3 text-[10px]">فاکتور PDF</button><button onClick={()=>setSelected(null)} className="text-[10px] underline">بستن</button></div></div><dl className="mt-5 grid gap-3 text-[10.5px] sm:grid-cols-2 lg:grid-cols-4">{[["مشتری",selected.customer],["تاریخ",selected.date],["تعداد اقلام",fa(selected.items)],["مبلغ",toman(selected.total)],["وضعیت",selected.status],["روش پرداخت","درگاه آنلاین · تأیید شده"],["روش ارسال","پست پیشتاز"],["کد پیگیری",selected.status==="در حال ارسال"?"۷۸۴۵۱۲۳۹۰۱":"در انتظار تخصیص"]].map(([term,value])=><div key={term} className="bg-[#f6f6f4] p-3"><dt className="text-neutral-400">{term}</dt><dd className="mt-1 font-medium num-fa">{value}</dd></div>)}</dl><div className="mt-5 grid gap-4 lg:grid-cols-[1fr_340px]"><div><h4 className="text-[11px] font-medium">تایم‌لاین پردازش</h4><div className="mt-3 grid gap-2 sm:grid-cols-4">{["پرداخت تأیید شد","بررسی سفارش","آماده‌سازی انبار","تحویل به حمل"].map((step,index)=><div key={step} className={`border-t-2 pt-2 text-[9px] ${index<(["پرداخت شده","در حال پردازش","در حال ارسال","تحویل شده"].indexOf(selected.status)+1)?'border-[#36563a] text-[#36563a]':'border-neutral-200 text-neutral-400'}`}>{step}</div>)}</div></div><aside className="border border-neutral-200 p-3"><p className="text-[9px] text-neutral-400">نشانی و تحویل</p><p className="mt-2 text-[10px] leading-5">تهران، خیابان ولیعصر، کوچه سرو، پلاک ۲۴</p><p className="mt-2 text-[9px] text-neutral-500">بازه تحویل: ۱۴ تا ۱۸ · تماس قبل از تحویل</p></aside></div></section>}
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
  const [customers, setCustomers] = useState(() => { try { const raw=localStorage.getItem("kv_admin_customers"); return raw ? JSON.parse(raw) as Array<BlockableCustomer> : initialCustomers.map((c) => ({ ...c, block: null })); } catch { return initialCustomers.map((c) => ({ ...c, block: null })); } });
  type BlockableCustomer = (typeof initialCustomers)[number] & { block?: { type: "temp" | "permanent"; reason: string; at: string } | null };
  const persistCustomers = (next: BlockableCustomer[]) => { setCustomers(next); try { localStorage.setItem("kv_admin_customers", JSON.stringify(next)); } catch { /* ignore */ } };
  const [blocking, setBlocking] = useState<BlockableCustomer | null>(null);
  const [blockForm, setBlockForm] = useState<{ type: "temp" | "permanent"; reason: string }>({ type: "temp", reason: "" });
  const applyBlock = () => { if (!blocking) return; if (!blockForm.reason.trim()) return; persistCustomers(customers.map((c) => c.phone === blocking.phone ? { ...c, block: { ...blockForm, at: new Date().toISOString() } } : c)); setBlocking(null); setNotice("مشتری مسدود شد و دلیل آن ثبت شد."); };
  const unblock = (phone: string) => { persistCustomers(customers.map((c) => c.phone === phone ? { ...c, block: null } : c)); setNotice("مسدودسازی برداشته شد."); };
  const [notice, setNotice] = useState("");
  const [selected,setSelected]=useState<(typeof initialCustomers)[number]|null>(null);
  /*
   * ⚠️ اصلاح D24/D38: ویرایشگر «کیف پول مشتری» حذف شد.
   * پیش از این موجودی کیف پول در `localStorage` (کلید `kv_wallet_<phone>`) نوشته
   * می‌شد؛ یعنی یک ادعای مالی فقط در مرورگر همان مدیر زندگی می‌کرد، هیچ تراکنش
   * حسابداری نداشت و هیچ‌جای دیگری خوانده نمی‌شد. سامانهٔ کیف پول دامنهٔ فاز ۵ است
   * (`wallet` module + ledger append-only)؛ تا آن زمان هیچ کنترل مالی در پنل
   * نمایش داده نمی‌شود تا مدیر فکر نکند پول واقعی جابه‌جا شده است.
   */

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
              <th className="p-3 font-medium">وضعیت</th>
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
                  {c.block ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded-full bg-[#fbeaea] px-2 py-0.5 text-[9.5px] text-[#9e4b3c]">{c.block.type === "temp" ? "مسدود موقت" : "مسدود دائم"}</span>
                      <button onClick={() => unblock(c.phone)} className="text-[10px] underline">رفع</button>
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#edf3ee] px-2 py-0.5 text-[9.5px] text-[#3d5c3a]">فعال</span>
                  )}
                </td>
                <td className="p-3">
                  <button onClick={()=>setSelected(c)} className="text-[11.5px] underline">پروفایل</button>
                  <button onClick={()=>{setBlocking(c);setBlockForm({type:"temp",reason:""});}} className="mr-2 text-[11.5px] text-[#9e4b3c] underline">مسدودسازی</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notice&&<p role="status" className="mb-4 border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2 text-[10px] text-[#36563a]">{notice}</p>}
      {blocking&&(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-label="مسدودسازی مشتری">
          <div className="w-full max-w-sm rounded-[4px] bg-white p-5">
            <h3 className="text-[14px] font-medium">مسدودسازی {blocking.name}</h3>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {([["temp","موقت"],["permanent","دائم"]] as const).map(([id,name])=>(
                  <button key={id} onClick={()=>setBlockForm(f=>({...f,type:id}))} className={(blockForm.type===id?"bg-[#011c3a] text-white":"border border-neutral-300")+" h-9 rounded-[3px] text-[11px] transition"}>{name}</button>
                ))}
              </div>
              <label className="block text-[10.5px] text-neutral-500">دلیل مسدودسازی (الزامی)
                <textarea value={blockForm.reason} onChange={e=>setBlockForm(f=>({...f,reason:e.target.value}))} className="mt-1.5 min-h-20 w-full rounded-[3px] border border-neutral-300 p-2.5 text-[11.5px]" placeholder="مثلاً:不当 استفاده از کد تخفیف" />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={applyBlock} disabled={!blockForm.reason.trim()} className="h-10 flex-1 rounded-[3px] bg-[#9e4b3c] text-[11.5px] font-medium text-white disabled:opacity-40">ثبت مسدودسازی</button>
              <button onClick={()=>setBlocking(null)} className="h-10 rounded-[3px] border border-neutral-300 px-4 text-[11.5px]">انصراف</button>
            </div>
          </div>
        </div>
      )}
      {selected&&<section className="mt-4 grid gap-4 border border-neutral-200 bg-white p-5 lg:grid-cols-[1fr_300px]" aria-label="پروفایل مشتری"><div><div className="flex items-start justify-between"><div><p className="text-[9px] text-neutral-400">CUSTOMER 360</p><h3 className="mt-2 text-[16px] font-medium">{selected.name}</h3><p className="mt-1 text-[10px] text-neutral-500 num-fa">{selected.phone} · {selected.city}</p></div><button onClick={()=>setSelected(null)} className="text-[10px] underline">بستن</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["تعداد سفارش",fa(selected.orders)],["ارزش خرید",toman(selected.total)],["امتیاز وفاداری",fa(Math.round(selected.total/100000))],["برچسب","مشتری فعال"]].map(([a,b])=><div key={a} className="bg-[#f6f6f4] p-3"><p className="text-[9px] text-neutral-400">{a}</p><p className="mt-1 text-[10.5px] font-medium num-fa">{b}</p></div>)}</div></div><aside className="bg-[#011c3a] p-4 text-white"><p className="text-[10px] text-white/55">کیف پول و اعتبار</p><p className="mt-3 text-[10px] leading-6 text-white/70">کیف پول کلبه هنوز راه‌اندازی نشده است. موجودی و تراکنش‌های مالی پس از ساخته شدن ماژول «کیف پول و دفتر کل» (فاز ۵) و به‌صورت فقط‌افزودنی (append-only) نمایش داده می‌شوند؛ تا آن زمان هیچ عددی در پنل به‌عنوان موجودی مالی قابل ویرایش نیست.</p></aside></section>}
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
              <label className="mb-3 block text-[10.5px] text-neutral-500">رنگ محتوای هدر روی هیروی ویدیویی<input type="color" className="mt-1.5 h-10 w-full cursor-pointer rounded-[3px] border border-neutral-300 bg-white p-1" value={siteSettings.header.videoHeroTextColor || "#ffffff"} onChange={e=>persistSiteSettings({...siteSettings,header:{...siteSettings.header,videoHeroTextColor:e.target.value}})}/></label>
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
  const [events, setEvents] = useState<CommerceEvent[]>(readCommerceEvents);
  useEffect(() => {
    const refresh = () => setEvents(readCommerceEvents());
    window.addEventListener("kolbe:analytics", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("kolbe:analytics", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  const count = (name: CommerceEvent["name"]) => events.filter((event) => event.name === name).length;
  const pageViews = count("page_view") + count("product_view");
  const checkouts = count("begin_checkout");
  const purchases = events.filter((event) => event.name === "purchase");
  const revenue = purchases.reduce((sum, event) => sum + (event.value || 0), 0);
  const conversion = pageViews ? (purchases.length / pageViews) * 100 : 0;
  const reports = [
    { label: "درآمد ثبت‌شده", value: toman(revenue), sub: `${fa(purchases.length)} خرید تکمیل‌شده` },
    { label: "میانگین سبد خرید", value: toman(purchases.length ? Math.round(revenue / purchases.length) : 0), sub: "بر پایه سفارش‌های تکمیل‌شده" },
    { label: "نرخ تبدیل", value: `${conversion.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`, sub: `${fa(pageViews)} بازدید قابل ردیابی` },
    { label: "رهاشدگی پرداخت", value: `${(checkouts ? ((Math.max(0, checkouts - purchases.length) / checkouts) * 100) : 0).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`, sub: `${fa(checkouts)} شروع پرداخت` },
    { label: "افزودن به سبد", value: fa(count("add_to_cart")), sub: `${fa(count("remove_from_cart"))} حذف از سبد` },
    { label: "ارزش موجودی نمایشی", value: toman(products.reduce((sum, product) => sum + product.price * product.sizes.filter((size) => size.inStock).length, 0)), sub: `${fa(products.length)} محصول` },
  ];
  const lowStock = products.filter((p) => p.sizes.filter((s) => s.inStock).length <= 4);
  const productSignals = products.map((product) => {
    const views = events.filter((event) => event.name === "product_view" && event.productId === product.id).length;
    const carts = events.filter((event) => event.name === "add_to_cart" && event.productId === product.id).length;
    return { product, views, carts, rate: views ? (carts / views) * 100 : 0 };
  }).sort((a, b) => b.views - a.views);
  const sourceCounts = events.filter((event) => event.name === "page_view" || event.name === "product_view").reduce<Record<string, number>>((result, event) => {
    const source = !event.source || event.source === "direct" ? "مستقیم" : event.source.includes("instagram") ? "اینستاگرام" : event.source.includes("google") ? "گوگل" : "ارجاعی";
    result[source] = (result[source] || 0) + 1;
    return result;
  }, {});
  const sources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <header><p className="text-[9px] tracking-[.22em] text-neutral-400">COMMERCE INTELLIGENCE</p><h2 className="mt-2 text-[18px] font-medium">تحلیل رفتار و فروش</h2><p className="mt-1 text-[10px] text-neutral-500">داده‌ها از بازدید، محصول، سبد و پرداخت واقعی همین ویترین جمع‌آوری می‌شوند.</p></header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <div key={r.label} className="rounded-[3px] border border-neutral-200 bg-white p-4">
            <p className="text-[11.5px] text-neutral-500">{r.label}</p>
            <p className="mt-2 text-[18px] font-medium num-fa">{r.value}</p>
            <p className="mt-1 text-[11px] text-neutral-400 num-fa">{r.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <section className="border border-neutral-200 bg-white">
          <div className="border-b p-4"><h3 className="text-[12px] font-medium">محصولات پربازدید و کم‌خرید</h3><p className="mt-1 text-[9px] text-neutral-400">نرخ اقدام = افزودن به سبد ÷ بازدید محصول</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-right text-[10px]"><thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3 font-medium">محصول</th><th className="p-3 font-medium">بازدید</th><th className="p-3 font-medium">سبد</th><th className="p-3 font-medium">نرخ اقدام</th><th className="p-3 font-medium">تشخیص</th></tr></thead><tbody>{productSignals.slice(0, 6).map(({ product, views, carts, rate }) => <tr key={product.id} className="border-t"><td className="p-3 font-medium">{product.name}</td><td className="p-3 num-fa">{fa(views)}</td><td className="p-3 num-fa">{fa(carts)}</td><td className="p-3 num-fa">{rate.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪</td><td className="p-3"><span className={views >= 3 && !carts ? "bg-red-50 px-2 py-1 text-red-700" : views === 0 ? "bg-neutral-100 px-2 py-1 text-neutral-500" : "bg-emerald-50 px-2 py-1 text-emerald-700"}>{views >= 3 && !carts ? "اصطکاک خرید" : views === 0 ? "محصول مرده" : "در جریان"}</span></td></tr>)}</tbody></table></div>
        </section>
        <section className="border border-neutral-200 bg-white p-4"><h3 className="text-[12px] font-medium">منبع بازدید</h3>{sources.length ? <div className="mt-4 space-y-3">{sources.map(([source, value]) => <div key={source}><div className="flex justify-between text-[9.5px]"><span>{source}</span><span className="num-fa">{fa(value)}</span></div><div className="mt-1 h-1.5 bg-neutral-100"><span className="block h-full bg-[#011c3a]" style={{ width: `${Math.max(4, value / Math.max(...sources.map((item) => item[1])) * 100)}%` }} /></div></div>)}</div> : <div className="py-12 text-center text-[10px] text-neutral-400">با ورود بازدیدهای جدید، منبع ترافیک اینجا نمایش داده می‌شود.</div>}</section>
      </div>

      <section className="border border-neutral-200 bg-white p-5"><h3 className="text-[13px] font-medium">قیف و دلایل احتمالی ریزش</h3><div className="mt-4 grid gap-2 sm:grid-cols-4">{[["بازدید", pageViews], ["افزودن به سبد", count("add_to_cart")], ["شروع پرداخت", checkouts], ["خرید", purchases.length]].map(([label, value], index) => <div key={String(label)} className="border-t-2 border-[#011c3a] bg-neutral-50 p-3"><p className="text-[9px] text-neutral-400">مرحله {fa(index + 1)}</p><p className="mt-2 text-[10.5px]">{label}</p><strong className="mt-1 block text-[18px] num-fa">{fa(Number(value))}</strong></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-3">{[["محصول دیده شد اما وارد سبد نشد","قیمت، سایز یا اعتماد به اطلاعات محصول را بررسی کنید",productSignals.filter(item=>item.views>0&&!item.carts).length],["سبد حذف شد","هزینه ارسال یا مقایسه با محصول دیگر محتمل است",count("remove_from_cart")],["پرداخت شروع و کامل نشد","خطای درگاه، روش پرداخت یا فرم آدرس را بررسی کنید",Math.max(0,checkouts-purchases.length)]].map(([title,text,value])=><article key={String(title)} className="border border-neutral-200 p-3"><div className="flex items-start justify-between gap-3"><h4 className="text-[10.5px] font-medium">{title}</h4><span className="text-[15px] num-fa">{fa(Number(value))}</span></div><p className="mt-2 text-[9px] leading-5 text-neutral-500">{text}</p></article>)}</div></section>

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
          {page === "design-center" && (
            <Suspense fallback={<div className="h-64 animate-pulse rounded-[6px] bg-neutral-100" aria-label="در حال بارگذاری مرکز طراحی" />}>
              <SiteDesignCenter />
            </Suspense>
          )}
          {page === "products" && <ProductsPanel />}
          {page === "orders" && <OrdersPanel onOpenCustomer={(name) => { localStorage.setItem("kv_crm_focus_customer", name); setPage("customers"); }} />}
          {page === "commerce" && <CommerceOperations />}
          {page === "customers" && <AdminCRM />}
          {page === "vip-customers" && <AdminCRM initialView="vip" />}
          {page === "support" && <Suspense fallback={<div className="h-64 animate-pulse bg-neutral-100" aria-label="در حال بارگذاری پشتیبانی" />}><AdminSupportCenter /></Suspense>}
          {page === "messaging" && <Suspense fallback={<div className="h-64 animate-pulse bg-neutral-100" aria-label="در حال بارگذاری مرکز پیامک" />}><MessagingAutomationCenter /></Suspense>}
          {page === "campaigns" && <Suspense fallback={<div className="h-56 animate-pulse bg-neutral-100" aria-label="در حال بارگذاری جشنواره‌ها" />}><CampaignCenter /></Suspense>}
          {page === "content" && <ContentPanel />}
          {page === "reports" && <ReportsPanel />}
          {page === "logs" && (
            <Suspense fallback={<div className="h-48 animate-pulse bg-neutral-100" aria-label="در حال بارگذاری مرکز خطاها" />}>
              <AdminLogs />
            </Suspense>
          )}
          {page === "access" && <AccessSecurity />}
          {page === "integrations" && <IntegrationsAutomation />}
          {page === "system" && <SystemCenter />}
        </main>
      </div>
    </div>
  );
}
