import { useState } from "react";
import { Link } from "../router";
import { products, categories, specLabels, specOrder, type Product } from "../data/catalog";
import { styles, articles } from "../siteData";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";

const input =
  "h-9 w-full rounded-[3px] border border-neutral-300 px-3 text-[12px] outline-none transition focus:border-[#011c3a]";

const nav = [
  { id: "dashboard", label: "داشبورد", icon: "shield" },
  { id: "products", label: "محصولات", icon: "bag" },
  { id: "orders", label: "سفارش‌ها", icon: "truck" },
  { id: "customers", label: "مشتریان", icon: "user" },
  { id: "content", label: "محتوا و صفحات", icon: "mail" },
  { id: "wholesale", label: "درخواست‌های عمده", icon: "pin" },
  { id: "reports", label: "گزارش‌ها", icon: "clock" },
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

function ProductEditor({ product, onBack }: { product: Product; onBack: () => void }) {
  const [tab, setTab] = useState("basic");
  const tabs = [
    { id: "basic", label: "اطلاعات پایه" },
    { id: "variants", label: "رنگ، سایز و موجودی" },
    { id: "media", label: "تصاویر و ویدئو" },
    { id: "specs", label: "مشخصات فنی" },
    { id: "chart", label: "جدول سایز" },
    { id: "relations", label: "محصولات مرتبط" },
  ];

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-[#011c3a]">
          <Icon name="chevronRight" className="h-4 w-4" />
          بازگشت
        </button>
        <h2 className="text-[16px] font-medium">{product.name}</h2>
        <button className="mr-auto rounded-[3px] bg-[#011c3a] px-5 py-2 text-[12px] font-medium text-white">
          ذخیره تغییرات
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
              <input className={input} defaultValue={product.name} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">نام لاتین</span>
              <input className={input} defaultValue={product.latin} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">قیمت (تومان)</span>
              <input className={input} defaultValue={product.price} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">دسته‌بندی</span>
              <select className={input} defaultValue={product.category}>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">استایل</span>
              <select className={input} defaultValue={product.style}>
                {styles.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-600">کد محصول</span>
              <input className={input} defaultValue={product.specs.code} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-neutral-600">توضیحات</span>
              <textarea rows={5} className="w-full rounded-[3px] border border-neutral-300 p-3 text-[12px] outline-none focus:border-[#011c3a]" defaultValue={product.description} />
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
    </div>
  );
}

function ProductsPanel() {
  const [editing, setEditing] = useState<Product | null>(null);
  const [q, setQ] = useState("");

  if (editing) return <ProductEditor product={editing} onBack={() => setEditing(null)} />;

  const list = products.filter((p) => p.name.includes(q) || p.specs.code.includes(q));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-medium">محصولات</h2>
        <span className="text-[12px] text-neutral-500 num-fa">({fa(products.length)})</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجو در محصولات..."
          className={input + " max-w-[220px]"}
        />
        <button className="mr-auto rounded-[3px] bg-[#011c3a] px-5 py-2 text-[12px] font-medium text-white">
          + ایجاد محصول
        </button>
      </div>

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
                      <img src={p.images[0]} alt="" className="h-11 w-9 object-cover" loading="lazy" />
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
                  <td className="p-3">
                    <button onClick={() => setEditing(p)} className="text-[11.5px] underline hover:text-[#011c3a]">
                      ویرایش
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------- سایر پنل‌ها ------------------------------- */

function OrdersPanel() {
  const [filter, setFilter] = useState("همه");
  const statuses = ["همه", "پرداخت شده", "در حال پردازش", "در حال ارسال", "تحویل شده", "مرجوع شده"];
  const list = filter === "همه" ? orders : orders.filter((o) => o.status === filter);

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
                  <select defaultValue={o.status} className="rounded-[3px] border border-neutral-300 px-2 py-1 text-[11px] outline-none">
                    {statuses.slice(1).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex gap-2 text-[11px]">
                    <button className="underline">جزئیات</button>
                    <button className="underline">فاکتور</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersPanel() {
  const customers = [
    { name: "امیرحسین رضایی", phone: "۰۹۱۲۳۴۵۶۷۸۹", orders: 7, total: 24_500_000, city: "تهران" },
    { name: "سهیل مرادی", phone: "۰۹۱۲۹۸۷۶۵۴۳", orders: 4, total: 12_800_000, city: "کرج" },
    { name: "نیما صادقی", phone: "۰۹۱۳۱۱۲۲۳۳۴", orders: 3, total: 8_400_000, city: "اصفهان" },
    { name: "بابک کریمی", phone: "۰۹۱۴۵۵۶۶۷۷۸", orders: 2, total: 9_100_000, city: "تبریز" },
  ];

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
                  <button className="text-[11.5px] underline">پروفایل</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContentPanel() {
  const [tab, setTab] = useState("articles");
  const tabs = [
    { id: "articles", label: "مقالات" },
    { id: "pages", label: "صفحات" },
    { id: "banners", label: "بنرها و صفحه اصلی" },
    { id: "menus", label: "منوها و فوتر" },
  ];

  return (
    <div>
      <h2 className="mb-5 text-[16px] font-medium">محتوا و صفحات</h2>
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
            <button className="mb-3 rounded-[3px] bg-[#011c3a] px-4 py-2 text-[11.5px] text-white">+ مقاله جدید</button>
            {articles.map((a) => (
              <div key={a.slug} className="flex items-center gap-3 border-b border-neutral-100 py-2.5">
                <img src={a.img} alt="" className="h-10 w-14 object-cover" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]">{a.title}</p>
                  <p className="mt-0.5 text-[10.5px] text-neutral-500">{a.category} — {a.date}</p>
                </div>
                <button className="text-[11px] underline">ویرایش</button>
              </div>
            ))}
          </div>
        )}

        {tab === "pages" && (
          <div className="space-y-2">
            {["درباره ما", "تماس با ما", "قوانین و مقررات", "حریم خصوصی", "شرایط مرجوعی", "راهنمای سایز"].map((p) => (
              <div key={p} className="flex items-center justify-between border-b border-neutral-100 py-2.5">
                <span className="text-[12px]">{p}</span>
                <button className="text-[11px] underline">ویرایش</button>
              </div>
            ))}
          </div>
        )}

        {tab === "banners" && (
          <div className="space-y-4">
            {[
              { name: "بنر هیرو صفحه اصلی", img: "/images/model-front.jpg" },
              { name: "بنر معرفی کالکشن", img: "/images/banner.jpg" },
              { name: "پوستر ویدئوی برند", img: "/images/model-full.jpg" },
            ].map((b) => (
              <div key={b.name} className="flex items-center gap-4 rounded-[3px] border border-neutral-200 p-3">
                <img src={b.img} alt="" className="h-16 w-28 object-cover" loading="lazy" />
                <div className="flex-1">
                  <p className="text-[12px] font-medium">{b.name}</p>
                  <input className={input + " mt-2 max-w-sm"} placeholder="متن روی بنر" />
                </div>
                <button className="text-[11px] underline">تعویض تصویر</button>
              </div>
            ))}
            <div className="rounded-[3px] border border-neutral-200 p-4">
              <p className="mb-3 text-[12px] font-medium">ترتیب بخش‌های صفحه اصلی</p>
              {["هیرو", "جدیدترین کالکشن", "بنر کالکشن", "خرید بر اساس استایل", "پرفروش‌ترین‌ها", "ویدئو", "ست‌های پیشنهادی", "مقالات", "اینستاگرام"].map((s, i) => (
                <div key={s} className="flex items-center gap-3 border-b border-neutral-100 py-2 text-[12px] last:border-0">
                  <span className="w-5 text-neutral-400 num-fa">{fa(i + 1)}</span>
                  <span className="flex-1">{s}</span>
                  <button className="text-neutral-400">↑</button>
                  <button className="text-neutral-400">↓</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "menus" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-[12px] font-medium">منوی اصلی</p>
              {["جدیدترین‌ها", "کالکشن پاییز", "کت و بلیزر", "پیراهن", "بافت و پلیور", "شلوار", "اکسسوری", "استایل‌ها", "مجله"].map((m) => (
                <div key={m} className="flex items-center gap-2 border-b border-neutral-100 py-2">
                  <input className={input + " flex-1"} defaultValue={m} />
                  <button className="text-neutral-400 hover:text-[#9e4b3c]" aria-label="حذف">
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button className="mt-2 h-9 w-full rounded-[3px] border border-dashed border-neutral-300 text-[11.5px] text-neutral-500">
                + افزودن آیتم
              </button>
            </div>
            <div>
              <p className="mb-3 text-[12px] font-medium">ستون‌های فوتر</p>
              {["خرید", "استایل‌ها", "خدمات مشتریان", "کلبه وینتیج", "تماس با ما"].map((m) => (
                <div key={m} className="flex items-center justify-between border-b border-neutral-100 py-2.5 text-[12px]">
                  <span>{m}</span>
                  <button className="text-[11px] underline">ویرایش</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WholesalePanel() {
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
            {wholesaleRequests.map((r) => (
              <tr key={r.phone} className="border-b border-neutral-100 hover:bg-neutral-50">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.store}</td>
                <td className="p-3">{r.city}</td>
                <td className="p-3 num-fa">{r.phone}</td>
                <td className="p-3">{r.plan}</td>
                <td className="p-3">
                  <select defaultValue={r.status} className="rounded-[3px] border border-neutral-300 px-2 py-1 text-[11px] outline-none">
                    {["جدید", "در تماس", "تأیید شده", "رد شده"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <button className="text-[11.5px] underline">جزئیات</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

export default function Admin() {
  const [page, setPage] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f6f4]">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
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
      </header>

      <div className="flex">
        <aside className={"fixed inset-y-0 right-0 z-30 w-56 border-l border-neutral-200 bg-white pt-20 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:pt-0 lg:block " + (menuOpen ? "block" : "hidden")}>
          <nav className="space-y-1 p-3">
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
          {page === "dashboard" && <Dashboard />}
          {page === "products" && <ProductsPanel />}
          {page === "orders" && <OrdersPanel />}
          {page === "customers" && <CustomersPanel />}
          {page === "content" && <ContentPanel />}
          {page === "wholesale" && <WholesalePanel />}
          {page === "reports" && <ReportsPanel />}
        </main>
      </div>
    </div>
  );
}
