import { useMemo, useState } from "react";
import { fa } from "../utils/format";

type RetailPolicy = {
  id: number;
  area: string;
  title: string;
  decision: string;
};

type RetailRuntimeSettings = {
  salesRange: "دلخواه";
  pricingMode: "دستی";
  inventoryMode: "جداگانه برای هر شعبه";
  lowStockLevel: "برای هر محصول";
  reviewMode: "بررسی دستی";
  fraudReview: "بررسی دستی";
  refundDestination: "کیف پول";
  employeeCreation: "فقط مدیر کل";
  authentication: "احراز هویت دومرحله‌ای";
  notificationPriority: "عادی و فوری";
  backupFrequency: "لحظه‌ای";
  shippingScope: "بر اساس شهر";
  shippingCities: string[];
  paymentReconciliation: string[];
};

const storageKey = "kv_retail_policies_v1";

const defaultSettings: RetailRuntimeSettings = {
  salesRange: "دلخواه",
  pricingMode: "دستی",
  inventoryMode: "جداگانه برای هر شعبه",
  lowStockLevel: "برای هر محصول",
  reviewMode: "بررسی دستی",
  fraudReview: "بررسی دستی",
  refundDestination: "کیف پول",
  employeeCreation: "فقط مدیر کل",
  authentication: "احراز هویت دومرحله‌ای",
  notificationPriority: "عادی و فوری",
  backupFrequency: "لحظه‌ای",
  shippingScope: "بر اساس شهر",
  shippingCities: ["تهران", "کرج", "اصفهان", "شیراز"],
  paymentReconciliation: ["بررسی دستی", "هشدار خودکار", "تطبیق بانکی خودکار", "اتصال به حسابداری"],
};

const policies: RetailPolicy[] = [
  { id: 1, area: "داشبورد", title: "اطلاعات صفحه نخست", decision: "فروش امروز، سفارش‌های جاری و موجودی بحرانی" },
  { id: 2, area: "داشبورد", title: "بازه گزارش فروش", decision: "بازه دلخواه" },
  { id: 3, area: "دسترسی", title: "محدوده شعبه", decision: "مطابق سطح دسترسی" },
  { id: 4, area: "گزارش", title: "مقایسه شعبه‌ها", decision: "فروش، سود و تعداد سفارش" },
  { id: 5, area: "محصول", title: "ثبت محصول", decision: "چند نقش با تأیید مدیر" },
  { id: 6, area: "محصول", title: "انتشار محصول", decision: "فوری، تأیید مدیر، دومرحله‌ای و زمان‌بندی‌شده" },
  { id: 7, area: "محصول", title: "ویرایش محصول", decision: "ویرایش همه اطلاعات" },
  { id: 8, area: "محصول", title: "تغییر قیمت", decision: "تکی، گروهی و فایل اکسل" },
  { id: 9, area: "محصول", title: "تاریخچه قیمت", decision: "نگهداری نامحدود" },
  { id: 10, area: "محصول", title: "مبنای قیمت", decision: "تعیین دستی" },
  { id: 11, area: "انبار", title: "حد کمبود", decision: "مستقل برای هر محصول" },
  { id: 12, area: "اعلان", title: "کانال هشدار موجودی", decision: "پنل، پیامک و ایمیل" },
  { id: 13, area: "انبار", title: "موجودی شعب", decision: "جداگانه" },
  { id: 14, area: "انبار", title: "انتقال بین شعب", decision: "تأیید مبدأ و مقصد" },
  { id: 15, area: "سفارش", title: "اختیار مدیر کل", decision: "دسترسی کامل" },
  { id: 16, area: "سفارش", title: "ویرایش سفارش", decision: "همه مراحل با مجوز مدیر" },
  { id: 17, area: "سفارش", title: "لغو توسط مدیر", decision: "بدون الزام اضافه" },
  { id: 18, area: "سفارش", title: "ثبت دستی", decision: "سفارش حضوری و تلفنی" },
  { id: 19, area: "سفارش", title: "سفارش مشکوک", decision: "بررسی دستی" },
  { id: 20, area: "مرجوعی", title: "تأیید مرجوعی", decision: "خودکار، اپراتور و مدیر بر اساس مبلغ و علت" },
  { id: 21, area: "مرجوعی", title: "مقصد بازپرداخت", decision: "کیف پول مشتری" },
  { id: 22, area: "تخفیف", title: "نوع تخفیف", decision: "درصدی، مبلغ ثابت و ارسال رایگان" },
  { id: 23, area: "تخفیف", title: "دامنه تخفیف", decision: "عمومی، مشتری منتخب و محصول منتخب" },
  { id: 24, area: "تخفیف", title: "ترکیب تخفیف", decision: "قوانین قابل تنظیم" },
  { id: 25, area: "تخفیف", title: "سقف مصرف", decision: "برای هر مشتری و کل کمپین" },
  { id: 26, area: "تخفیف", title: "کمپین", decision: "تخفیف، زمان‌بندی و مخاطب هدف" },
  { id: 27, area: "محتوا", title: "صفحه اصلی", decision: "مدیریت تمام بخش‌ها" },
  { id: 28, area: "محصول", title: "دسته‌بندی", decision: "ایجاد، ویرایش، ترتیب و ویژگی اختصاصی" },
  { id: 29, area: "مشتری", title: "مدیریت نظر", decision: "مشاهده، تأیید، رد و پاسخ با سابقه" },
  { id: 30, area: "مشتری", title: "تشخیص نظر نامناسب", decision: "بررسی دستی" },
  { id: 31, area: "مشتری", title: "اطلاعات مشتری", decision: "دسترسی کامل و کنترل‌شده" },
  { id: 32, area: "مشتری", title: "مسدودسازی", decision: "موقت و دائم با ثبت دلیل" },
  { id: 33, area: "مشتری", title: "بخش‌بندی", decision: "معیارهای ترکیبی" },
  { id: 34, area: "مشتری", title: "تغییر کیف پول", decision: "تأیید و مستندات" },
  { id: 35, area: "پشتیبانی", title: "ارجاع شکایت", decision: "خودکار بر اساس موضوع و اولویت" },
  { id: 36, area: "پشتیبانی", title: "سنجش پشتیبان", decision: "تعداد، سرعت و رضایت" },
  { id: 37, area: "دسترسی", title: "ایجاد حساب کارمند", decision: "فقط مدیر کل" },
  { id: 38, area: "دسترسی", title: "مجوز کارکنان", decision: "نقش، شعبه و مجوز عملیاتی" },
  { id: 39, area: "امنیت", title: "ورود مدیر", decision: "احراز هویت دومرحله‌ای" },
  { id: 40, area: "امنیت", title: "ثبت فعالیت", decision: "همه عملیات و مشاهده اطلاعات حساس" },
  { id: 41, area: "گزارش", title: "گزارش فروش", decision: "ناخالص، تخفیف، مرجوعی و سود خالص" },
  { id: 42, area: "گزارش", title: "فرمت خروجی", decision: "PDF، Excel و CSV" },
  { id: 43, area: "گزارش", title: "گزارش اختصاصی", decision: "گزارش‌ساز کامل" },
  { id: 44, area: "مالی", title: "مغایرت پرداخت", decision: "دستی، هشدار، تطبیق بانکی و حسابداری" },
  { id: 45, area: "مالی", title: "محاسبه مالیات", decision: "سامانه حسابداری" },
  { id: 46, area: "ارسال", title: "محاسبه هزینه ارسال", decision: "مبلغ ثابت، وزن، فاصله و روش ارسال" },
  { id: 47, area: "ارسال", title: "مناطق ارسال", decision: "بر اساس شهر" },
  { id: 48, area: "اعلان", title: "اولویت اعلان", decision: "عادی و فوری" },
  { id: 49, area: "سیستم", title: "نسخه پشتیبان", decision: "لحظه‌ای" },
  { id: 50, area: "سیستم", title: "هدف پنل", decision: "مدیریت یکپارچه فروش، موجودی و خطا" },
];

function loadSettings() {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) as Partial<RetailRuntimeSettings> } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

export default function RetailPolicyCenter() {
  const [settings, setSettings] = useState(loadSettings);
  const [area, setArea] = useState("همه حوزه‌ها");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [saved, setSaved] = useState(false);
  const areas = useMemo(() => ["همه حوزه‌ها", ...new Set(policies.map((policy) => policy.area))], []);
  const visible = useMemo(() => policies.filter((policy) => {
    const matchesArea = area === "همه حوزه‌ها" || policy.area === area;
    const normalized = query.trim();
    return matchesArea && (!normalized || `${policy.title} ${policy.decision}`.includes(normalized));
  }), [area, query]);

  const persist = (next = settings) => {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const addCity = () => {
    const value = city.trim();
    if (!value || settings.shippingCities.includes(value)) return;
    persist({ ...settings, shippingCities: [...settings.shippingCities, value] });
    setCity("");
  };

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[9px] tracking-[0.22em] text-neutral-400">RETAIL POLICY CENTER</p>
        <h1 className="mt-2 text-[22px] font-medium">تنظیمات اجرایی خرده کلبه</h1>
        <p className="mt-2 max-w-3xl text-[11px] leading-7 text-neutral-500">۵۰ تصمیم تأییدشده کارفرما به‌عنوان خط‌مشی فعال پنل مدیر کل ثبت شده‌اند. تنظیمات حساس این صفحه در مرورگر ذخیره و در بازگشت بعدی بازیابی می‌شوند.</p>
      </div>
      <button type="button" onClick={() => persist()} className="h-10 bg-[#011c3a] px-5 text-[11px] font-medium text-white transition hover:bg-[#0a2c55] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a] focus-visible:ring-offset-2">ذخیره تنظیمات خرده</button>
    </header>

    {saved ? <p role="status" className="border border-[#b9cfbc] bg-[#edf3ee] px-3 py-2.5 text-[10.5px] text-[#36563a]">تنظیمات خرده با موفقیت ذخیره شد.</p> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="خلاصه پیکربندی">
      {[
        ["تصمیم فعال", `${fa(policies.length)} از ${fa(policies.length)}`],
        ["موجودی", settings.inventoryMode],
        ["امنیت", settings.authentication],
        ["پشتیبان‌گیری", settings.backupFrequency],
      ].map(([label, value]) => <div key={label} className="border border-neutral-200 bg-white p-4"><p className="text-[9.5px] text-neutral-500">{label}</p><p className="mt-2 text-[12px] font-medium">{value}</p></div>)}
    </section>

    <section className="border border-neutral-200 bg-white p-4 sm:p-5">
      <div className="mb-5"><h2 className="text-[13px] font-medium">تنظیمات عملیاتی منتخب</h2><p className="mt-1.5 text-[10px] text-neutral-500">مقادیر زیر مستقیماً از پاسخ‌های کارفرما مقداردهی شده‌اند.</p></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          ["روش قیمت‌گذاری", settings.pricingMode],
          ["حد هشدار موجودی", settings.lowStockLevel],
          ["بررسی سفارش مشکوک", settings.fraudReview],
          ["بررسی نظرات", settings.reviewMode],
          ["بازپرداخت", settings.refundDestination],
          ["ایجاد حساب کارمند", settings.employeeCreation],
          ["اولویت اعلان", settings.notificationPriority],
          ["محدوده ارسال", settings.shippingScope],
          ["گزارش فروش", settings.salesRange],
        ].map(([label, value]) => <label key={label} className="block text-[10px] text-neutral-500">{label}<input readOnly value={value} className="mt-1.5 h-10 w-full border border-neutral-200 bg-neutral-50 px-3 text-[10.5px] text-neutral-800 outline-none" /></label>)}
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="border border-neutral-200 bg-white p-4 sm:p-5">
        <h2 className="text-[12px] font-medium">شهرهای مجاز ارسال</h2>
        <div className="mt-4 flex gap-2"><input aria-label="نام شهر جدید" value={city} onChange={(event) => setCity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCity(); } }} placeholder="نام شهر" className="h-10 min-w-0 flex-1 border border-neutral-300 px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" /><button type="button" onClick={addCity} disabled={!city.trim()} className="h-10 bg-[#011c3a] px-4 text-[10.5px] text-white disabled:cursor-not-allowed disabled:opacity-40">افزودن</button></div>
        <div className="mt-4 flex flex-wrap gap-2">{settings.shippingCities.map((item) => <span key={item} className="flex items-center gap-2 border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[10px]">{item}<button type="button" aria-label={`حذف شهر ${item}`} onClick={() => persist({ ...settings, shippingCities: settings.shippingCities.filter((value) => value !== item) })} className="text-red-700">×</button></span>)}</div>
      </div>
      <div className="border border-neutral-200 bg-white p-4 sm:p-5">
        <h2 className="text-[12px] font-medium">روش‌های فعال مغایرت پرداخت</h2>
        <div className="mt-3 divide-y divide-neutral-100">{settings.paymentReconciliation.map((method) => <label key={method} className="flex items-center justify-between gap-3 py-3 text-[10.5px]"><span>{method}</span><input type="checkbox" checked readOnly aria-label={`روش فعال ${method}`} /></label>)}</div>
      </div>
    </section>

    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-[14px] font-medium">فهرست سیاست‌های اعمال‌شده</h2><p className="mt-1 text-[10px] text-neutral-500">نمایش {fa(visible.length)} سیاست از {fa(policies.length)}</p></div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[240px_180px]"><input aria-label="جست‌وجوی سیاست" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی تصمیم یا قابلیت" className="h-10 border border-neutral-300 bg-white px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]" /><select aria-label="فیلتر حوزه سیاست" value={area} onChange={(event) => setArea(event.target.value)} className="h-10 border border-neutral-300 bg-white px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[#011c3a]">{areas.map((item) => <option key={item}>{item}</option>)}</select></div>
      </div>
      <div className="mt-4 overflow-hidden border border-neutral-200 bg-white">
        <div className="hidden grid-cols-[70px_140px_1fr_1.5fr_90px] bg-neutral-50 px-4 py-3 text-[9.5px] text-neutral-500 md:grid"><span>شماره</span><span>حوزه</span><span>قابلیت</span><span>تصمیم اعمال‌شده</span><span>وضعیت</span></div>
        <div className="divide-y divide-neutral-100">{visible.map((policy) => <article key={policy.id} className="grid gap-2 px-4 py-3 text-[10.5px] transition hover:bg-neutral-50 md:grid-cols-[70px_140px_1fr_1.5fr_90px] md:items-center"><span className="text-neutral-400 num-fa">{fa(policy.id)}</span><span>{policy.area}</span><strong className="font-medium">{policy.title}</strong><span className="leading-6 text-neutral-600">{policy.decision}</span><span className="w-fit bg-[#edf3ee] px-2 py-1 text-[9px] text-[#36563a]">فعال</span></article>)}</div>
        {!visible.length ? <div className="py-12 text-center"><p className="text-[11px] font-medium">سیاستی پیدا نشد</p><p className="mt-1 text-[10px] text-neutral-400">عبارت جست‌وجو یا فیلتر حوزه را تغییر دهید.</p></div> : null}
      </div>
    </section>
  </div>;
}
