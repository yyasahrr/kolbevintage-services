import { useEffect, useState } from "react";
import { Link, useRouter } from "../router";
import { products } from "../data/catalog";
import { fa } from "../utils/format";
import Icon from "../components/Icon";
import { loadWholesaleMembership, saveWholesaleMembership } from "../wholesaleMembership";
import { createCustomer, loadCustomer, saveCustomer } from "../customerIdentity";

const benefits = [
  { icon: "needle", title: "دوخت اختصاصی", text: "امکان سفارش با برچسب و بسته‌بندی برند شما." },
  { icon: "truck", title: "ارسال سراسری", text: "ارسال رایگان سفارش‌های عمده به سراسر کشور." },
  { icon: "shield", title: "تسویه منعطف", text: "امکان تسویه چکی برای همکاران دائمی." },
  { icon: "return", title: "مرجوعی فصلی", text: "تعویض اقلام فروش‌نرفته در پایان هر فصل." },
];

const plans = [
  {
    id: "basic",
    name: "همکار",
    price: "۶٬۰۰۰٬۰۰۰",
    period: "سالانه",
    features: ["دسترسی به کاتالوگ عمده", "حداقل سفارش ۲۰ عدد", "تخفیف پایه ۲۵٪", "پشتیبانی ایمیلی"],
    highlight: false,
  },
  {
    id: "pro",
    name: "همکار حرفه‌ای",
    price: "۱۲٬۰۰۰٬۰۰۰",
    period: "سالانه",
    features: [
      "همه مزایای پلن همکار",
      "تخفیف ۳۵٪ روی کل کاتالوگ",
      "اولویت در کالکشن‌های محدود",
      "کارشناس فروش اختصاصی",
      "ارسال رایگان نامحدود",
    ],
    highlight: true,
  },
  {
    id: "vip",
    name: "وی‌آی‌پی",
    price: "۳۵٬۰۰۰٬۰۰۰",
    period: "سالانه",
    features: [
      "همه مزایای پلن حرفه‌ای",
      "تخفیف ۴۵٪ و قیمت‌گذاری اختصاصی",
      "دوخت با برچسب برند شما",
      "پیش‌نمایش کالکشن پیش از عرضه",
      "تسویه چکی تا ۹۰ روز",
      "بازدید حضوری از کارگاه",
    ],
    highlight: false,
  },
];

const input =
  "h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px] outline-none transition focus:border-[#011c3a]";

const steps = [
  { number: "۰۱", title: "انتخاب اشتراک", text: "سطح تخفیف و خدمات مورد نیاز فروشگاه خود را انتخاب کنید." },
  { number: "۰۲", title: "تکمیل اطلاعات", text: "اطلاعات تماس و مشخصات فروشگاه را در ویزارد عضویت وارد کنید." },
  { number: "۰۳", title: "خرید و فعال‌سازی", text: "پس از خرید اشتراک، حساب VIP و داشبورد شما همان لحظه فعال می‌شود." },
  { number: "۰۴", title: "ثبت سفارش کالکشن", text: "محصول، رنگ، سایز و تعداد را انتخاب و سفارش عمده را ثبت کنید." },
];

export default function Wholesale() {
  const { query, navigate } = useRouter();
  const [customer, setCustomer] = useState(loadCustomer);
  const [existingMembership] = useState(loadWholesaleMembership);
  const [plan, setPlan] = useState("pro");
  const [wizardStep, setWizardStep] = useState(1);
  const [catalogCategory, setCatalogCategory] = useState("همه");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [form, setForm] = useState(() => ({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", city: "", store: "", business: "", volume: "", instagram: "", note: "" }));
  const hasVipAccess = Boolean(customer && existingMembership?.status === "active" && (!existingMembership.customerId || existingMembership.customerId === customer.id));

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const categories = ["همه", ...Array.from(new Set(products.map((p) => p.categoryLabel)))];
  const catalogItems = products.filter((p) => {
    const matchesCategory = catalogCategory === "همه" || p.categoryLabel === catalogCategory;
    const q = catalogQuery.trim().toLowerCase();
    const matchesQuery = !q || `${p.name} ${p.latin} ${p.specs.code}`.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  useEffect(() => {
    if (hasVipAccess) {
      navigate("/vip/store");
      return;
    }
    const section = query.get("section");
    if (!section) return;
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [hasVipAccess, navigate, query]);

  if (hasVipAccess) return <main className="flex min-h-screen items-center justify-center bg-[#f6f6f4] text-[12px] text-neutral-500" aria-live="polite">در حال ورود به فروشگاه عمده…</main>;

  return (
    <div className="wholesale-page min-h-screen bg-white">
      {/* هدر اختصاصی عمده‌فروشی */}
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex w-full items-center justify-between px-4 py-4 lg:px-8">
          <Link to="/" className="flex flex-col leading-none">
            <span className="text-[17px] font-semibold tracking-[0.14em]">کلبه وینتیج</span>
            <span className="mt-1 text-[8px] tracking-[0.4em] text-neutral-400">WHOLESALE</span>
          </Link>
          <nav className="flex items-center gap-5 text-[12px]">
            <Link to="/wholesale?section=plans" className="hidden hover:underline sm:block">پلن‌ها</Link>
            <Link to="/wholesale?section=catalog" className="hidden hover:underline sm:block">کاتالوگ</Link>
            <Link to="/wholesale?section=form" className="rounded-[3px] bg-[#011c3a] px-4 py-2 text-white">
              خرید اشتراک
            </Link>
            <Link to="/" className="text-neutral-500 hover:underline">فروشگاه</Link>
          </nav>
        </div>
      </header>

      {/* هیرو */}
      <section className="relative h-[62vh] min-h-[380px] w-full overflow-hidden">
        <img src="/images/store.jpg" alt="فروش عمده کلبه وینتیج" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/75">B2B</p>
          <h1 className="mt-4 text-[28px] font-medium lg:text-[40px]">فروش عمده کلبه وینتیج</h1>
          <p className="mx-auto mt-4 max-w-xl text-[13px] leading-[2] text-white/85">
            اگر فروشگاه پوشاک دارید یا قصد راه‌اندازی دارید، با شرایط ویژه همکاری کنید. قیمت‌ها پس از تأیید درخواست
            و در کاتالوگ اختصاصی در اختیار شما قرار می‌گیرد.
          </p>
          <Link to="/wholesale?section=form" className="mt-7 rounded-[3px] bg-white px-8 py-3 text-[13px] font-medium text-[#011c3a]">
            فعال‌سازی عضویت VIP
          </Link>
        </div>
      </section>

      <section className="grid border-b border-neutral-200 bg-[#011c3a] text-white lg:grid-cols-[1.15fr_0.85fr]">
        <a href="https://www.aparat.com/" target="_blank" rel="noreferrer" className="group relative min-h-[320px] overflow-hidden" aria-label="پخش ویدیوی معرفی سرویس VIP">
          <img src="/images/model-full.jpg" alt="پشت صحنه آماده‌سازی کالکشن‌های عمده" className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-700 group-hover:scale-[1.02]" />
          <span className="absolute inset-0 bg-black/25" />
          <span className="absolute inset-0 grid place-items-center"><span className="grid h-16 w-16 place-items-center border border-white/70 bg-black/20 text-[11px] backdrop-blur-sm">پخش ▶</span></span>
        </a>
        <div className="flex flex-col justify-center p-7 lg:p-12">
          <p className="text-[9px] tracking-[0.3em] text-white/45">VIP SERVICE PRESENTATION</p>
          <h2 className="mt-4 text-[24px] font-medium leading-[1.7]">قبل از عضویت، مسیر همکاری را ببینید</h2>
          <p className="mt-4 max-w-md text-[11.5px] leading-[2] text-white/65">در معرفی ویدیویی، روند انتخاب کالکشن، کنترل کیفیت، تولید با لیبل یا لوگوی اختصاصی، بسته‌بندی و پشتیبانی پس از تحویل را مرور می‌کنیم.</p>
          <div className="mt-7 flex flex-wrap gap-4 text-[10px] text-white/65"><span>۰۱ · انتخاب کالکشن</span><span>۰۲ · شخصی‌سازی</span><span>۰۳ · تولید و تحویل</span></div>
        </div>
      </section>

      <section className="border-b border-neutral-200 bg-[#f7f6f3]">
        <div className="mx-auto grid w-full grid-cols-2 px-4 py-6 lg:grid-cols-4 lg:px-8">
          {[
            ["۱۲+", "گروه محصول"],
            ["۴۸ ساعت", "آماده‌سازی سفارش موجود"],
            ["۲۰ عدد", "حداقل سفارش اولیه"],
            ["۳۰ روز", "فرصت تعویض فصلی"],
          ].map(([value, label], i) => (
            <div key={label} className={"px-3 py-3 text-center " + (i % 2 ? "border-r border-neutral-200 lg:border-r" : i > 0 ? "lg:border-r lg:border-neutral-200" : "")}>
              <p className="text-[20px] font-medium num-fa">{value}</p>
              <p className="mt-1 text-[10.5px] text-neutral-500">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* مزایا */}
      <section className="mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <h2 className="mb-10 text-center text-[22px] font-medium">چرا کلبه وینتیج؟</h2>
        <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {benefits.map((b) => (
            <div key={b.title} className="text-center">
              <Icon name={b.icon} className="mx-auto h-7 w-7" strokeWidth={1.2} />
              <h3 className="mt-3 text-[13px] font-medium">{b.title}</h3>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">{b.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* مسیر شروع همکاری */}
      <section className="border-y border-neutral-200 py-14 lg:py-20">
        <div className="mx-auto w-full px-4 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
            <div>
              <p className="text-[10px] tracking-[0.28em] text-neutral-400">HOW IT WORKS</p>
              <h2 className="mt-2 text-[22px] font-medium">از درخواست تا اولین سفارش</h2>
              <p className="mt-4 max-w-sm text-[12.5px] leading-[2] text-neutral-500">
                شرایط همکاری شفاف است و قبل از پرداخت، موجودی، زمان تحویل و ترکیب سایزها با شما نهایی می‌شود.
              </p>
            </div>
            <ol className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {steps.map((step) => (
                <li key={step.number} className="border-t border-neutral-300 pt-4">
                  <span className="text-[11px] text-neutral-400 num-fa">{step.number}</span>
                  <h3 className="mt-2 text-[14px] font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-[11.5px] leading-[1.9] text-neutral-500">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* پلن‌ها */}
      <section id="plans" className="bg-[#f6f6f4] py-14 lg:py-20">
        <div className="mx-auto w-full px-4 lg:px-8">
          <div className="mb-10 text-center">
            <h2 className="text-[22px] font-medium">پلن‌های عضویت</h2>
            <p className="mx-auto mt-3 max-w-md text-[12.5px] leading-relaxed text-neutral-500">
              سطح همکاری خود را انتخاب کنید. هر پلن، تخفیف و خدمات متفاوتی دارد.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlan(p.id)}
                className={
                  "flex flex-col rounded-[3px] border bg-white p-6 text-right transition " +
                  (plan === p.id ? "border-[#011c3a] shadow-sm" : "border-neutral-200 hover:border-neutral-400")
                }
              >
                {p.highlight && (
                  <span className="mb-3 self-start rounded-[3px] bg-[#011c3a] px-2.5 py-1 text-[9.5px] text-white">
                    پیشنهاد ما
                  </span>
                )}
                <h3 className="text-[16px] font-medium">{p.name}</h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-[22px] font-medium num-fa">{p.price}</span>
                  {p.period && <span className="text-[11.5px] text-neutral-500">تومان / {p.period}</span>}
                </div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2 text-[12px] leading-relaxed text-neutral-600">
                      <Icon name="check" className="mt-[3px] h-3 w-3 shrink-0 text-[#011c3a]" strokeWidth={2.6} />
                      {f}
                    </li>
                  ))}
                </ul>
                <span
                  className={
                    "mt-6 flex h-10 items-center justify-center rounded-[3px] text-[12.5px] font-medium transition " +
                    (plan === p.id ? "bg-[#011c3a] text-white" : "border border-neutral-300")
                  }
                >
                  {plan === p.id ? "انتخاب شده" : "انتخاب این پلن"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* کاتالوگ بدون قیمت */}
      <section id="catalog" className="wholesale-catalog mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-medium">کاتالوگ محصولات</h2>
            <p className="mt-2 text-[12.5px] text-neutral-500">
              قیمت عمده پس از خرید اشتراک و فعال‌شدن حساب VIP نمایش داده می‌شود.
            </p>
          </div>
          <button onClick={() => window.print()} className="print-hidden rounded-[3px] border border-[#011c3a] px-6 py-2.5 text-[12px] font-medium transition hover:bg-[#011c3a] hover:text-white active:scale-[0.98]">
            چاپ یا ذخیره PDF
          </button>
        </div>

        <div className="print-hidden mb-8 border-y border-neutral-200 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setCatalogCategory(category)}
                  className={"shrink-0 rounded-[3px] px-3.5 py-2 text-[11.5px] transition " + (catalogCategory === category ? "bg-[#011c3a] text-white" : "bg-[#f6f6f4] hover:bg-neutral-200")}
                >
                  {category}
                </button>
              ))}
            </div>
            <label className="relative block w-full lg:w-72">
              <Icon name="search" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                placeholder="جست‌وجوی نام یا کد محصول"
                className="h-10 w-full rounded-[3px] border border-neutral-300 pr-9 pl-3 text-[12px] outline-none focus:border-[#011c3a]"
              />
            </label>
          </div>
          <p className="mt-3 text-[10.5px] text-neutral-400 num-fa">{fa(catalogItems.length)} محصول نمایش داده می‌شود</p>
        </div>

        {catalogItems.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-10 lg:grid-cols-4">
          {catalogItems.map((p) => (
            <article key={p.id} className="group">
              <Link to={`/product/${p.id}?wholesale=1`} className="block overflow-hidden bg-neutral-100">
                <img src={p.images[0]} alt={p.name} loading="lazy" className="aspect-[3/4] w-full object-cover transition duration-500 group-hover:scale-[1.025]" />
              </Link>
              <div className="mt-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link to={`/product/${p.id}?wholesale=1`} className="text-[12.5px] font-medium hover:underline">{p.name}</Link>
                    <p className="mt-0.5 text-[10.5px] text-neutral-500">{p.categoryLabel} · کد {p.specs.code}</p>
                  </div>
                  <span className="shrink-0 bg-[#f6f6f4] px-2 py-1 text-[9.5px]">{p.season}</span>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-neutral-100 pt-2.5">
                  <div className="flex gap-1">
                    {p.colours.slice(0, 5).map((c) => (
                      <span key={c.name} title={c.name} className="h-3 w-3 rounded-full border border-neutral-300" style={{ background: c.hex }} />
                    ))}
                  </div>
                  <span className="text-[10px] text-neutral-400 num-fa">{fa(p.sizes.filter((s) => s.inStock).length)} سایز موجود</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10.5px]">
                  <span className="font-medium">قیمت همکاری پس از تأیید</span>
                  <Link to={`/product/${p.id}?wholesale=1`} className="text-neutral-500 underline underline-offset-2">جزئیات عمده</Link>
                </div>
              </div>
            </article>
          ))}
          </div>
        ) : (
          <div className="border border-dashed border-neutral-300 px-5 py-16 text-center">
            <p className="text-[13px] font-medium">محصولی با این مشخصات پیدا نشد</p>
            <button onClick={() => { setCatalogCategory("همه"); setCatalogQuery(""); }} className="mt-3 text-[11.5px] underline underline-offset-4">پاک کردن فیلترها</button>
          </div>
        )}
      </section>

      {/* فرم */}
      <section id="form" className="bg-[#011c3a] py-14 text-white lg:py-20">
        <div className="mx-auto w-full max-w-2xl px-4 lg:px-8">
          <div className="mb-8 text-center">
            <h2 className="text-[22px] font-medium">فعال‌سازی عضویت VIP</h2>
            <p className="mt-3 text-[12.5px] leading-relaxed text-white/70">
              سه مرحله کوتاه تا دسترسی فوری به داشبورد و کاتالوگ همکاری.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const selectedPlan = plans.find((item) => item.id === plan)!;
              const expires = new Date();
              expires.setFullYear(expires.getFullYear() + 1);
              saveWholesaleMembership({
                customerId: customer?.id ?? createCustomer(form.name, form.phone, form.email).id,
                planId: selectedPlan.id,
                planName: selectedPlan.name,
                memberName: form.name,
                storeName: form.store,
                phone: form.phone,
                city: form.city,
                activatedAt: new Date().toLocaleDateString("fa-IR"),
                expiresAt: expires.toLocaleDateString("fa-IR"),
                status: "active",
                vip: true,
              });
              navigate("/vip");
            }}
            className="bg-white p-5 text-[#011c3a] sm:p-7"
          >
            <div className="mb-7 grid grid-cols-3 gap-2">
              {[customer ? "تأیید حساب" : "ورود / ثبت‌نام", "مشخصات فروشگاه", "تأیید و خرید"].map((label, index) => {
                const number = index + 1;
                return (
                  <div key={label} className={"border-t-2 pt-2 " + (wizardStep >= number ? "border-[#011c3a]" : "border-neutral-200")}>
                    <span className="text-[9.5px] text-neutral-400 num-fa">مرحله {fa(number)}</span>
                    <p className={"mt-1 text-[10.5px] " + (wizardStep === number ? "font-medium" : "text-neutral-400")}>{label}</p>
                  </div>
                );
              })}
            </div>

            {wizardStep === 1 && (
              <div>
                <h3 className="text-[16px] font-medium">{customer ? "حساب مشتری شما" : "ورود یا ساخت حساب مشتری"}</h3>
                <p className="mt-1 text-[11px] text-neutral-500">{customer ? "همان حسابی که در فروشگاه تک‌فروشی استفاده می‌کنید به VIP ارتقا پیدا می‌کند." : "این حساب در فروشگاه تک‌فروشی و عمده مشترک خواهد بود."}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="text-[10px] text-neutral-500">نام و نام خانوادگی<input name="customer-name" autoComplete="name" className={input + " mt-1.5"} placeholder="مثلاً آرمان نیک‌پی…" value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
                  <label className="text-[10px] text-neutral-500">شماره موبایل<input name="customer-phone" autoComplete="tel" type="tel" className={input + " mt-1.5"} placeholder="مثلاً ۰۹۱۲۱۲۳۴۵۶۷…" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
                  <label className="text-[10px] text-neutral-500 sm:col-span-2">ایمیل (اختیاری)<input name="customer-email" autoComplete="email" type="email" spellCheck={false} className={input + " mt-1.5"} placeholder="name@example.com…" value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
                </div>
                <button type="button" disabled={!form.name.trim() || form.phone.trim().length < 10} onClick={() => { const identity = customer ?? createCustomer(form.name, form.phone, form.email); const updated = { ...identity, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || undefined }; saveCustomer(updated); setCustomer(updated); setWizardStep(2); }} className="mt-6 h-11 w-full bg-[#011c3a] text-[12.5px] font-medium text-white disabled:bg-neutral-300">{customer ? "تأیید حساب و ادامه" : "ورود و ادامه"}</button>
              </div>
            )}

            {wizardStep === 2 && (
              <div>
                <h3 className="text-[16px] font-medium">مشخصات کسب‌وکار</h3>
                <p className="mt-1 text-[11px] text-neutral-500">کاتالوگ و خدمات براساس نوع فروشگاه تنظیم می‌شوند.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <input className={input} placeholder="نام فروشگاه *" value={form.store} onChange={(e) => set("store", e.target.value)} />
                  <input className={input} placeholder="شهر *" value={form.city} onChange={(e) => set("city", e.target.value)} />
                  <select className={input} value={form.business} onChange={(e) => set("business", e.target.value)}><option value="">نوع فعالیت *</option><option>فروشگاه حضوری</option><option>فروشگاه آنلاین</option><option>مزون و بوتیک</option><option>پخش پوشاک</option></select>
                  <select className={input} value={form.volume} onChange={(e) => set("volume", e.target.value)}><option value="">حجم تقریبی سفارش اول *</option><option>۲۰ تا ۵۰ عدد</option><option>۵۱ تا ۱۰۰ عدد</option><option>۱۰۱ تا ۲۵۰ عدد</option><option>بیش از ۲۵۰ عدد</option></select>
                  <input className={input + " sm:col-span-2"} placeholder="آدرس پیج اینستاگرام (اختیاری)" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} />
                </div>
                <div className="mt-6 flex gap-2"><button type="button" onClick={() => setWizardStep(1)} className="h-11 w-28 border border-neutral-300 text-[12px]">بازگشت</button><button type="button" disabled={!form.store.trim() || !form.city.trim() || !form.business || !form.volume} onClick={() => setWizardStep(3)} className="h-11 flex-1 bg-[#011c3a] text-[12.5px] font-medium text-white disabled:bg-neutral-300">ادامه به تأیید و خرید</button></div>
              </div>
            )}

            {wizardStep === 3 && (
              <div>
                <h3 className="text-[16px] font-medium">تأیید عضویت VIP</h3>
                <div className="mt-5 divide-y divide-neutral-200 border-y border-neutral-200 text-[12px]">
                  <div className="flex justify-between py-3"><span className="text-neutral-500">صاحب حساب</span><span>{form.name}</span></div>
                  <div className="flex justify-between py-3"><span className="text-neutral-500">فروشگاه</span><span>{form.store} · {form.city}</span></div>
                  <div className="flex justify-between py-3"><span className="text-neutral-500">پلن انتخابی</span><span>{plans.find((p) => p.id === plan)!.name}</span></div>
                  <div className="flex justify-between py-3"><span className="text-neutral-500">مبلغ اشتراک سالانه</span><strong className="font-medium num-fa">{plans.find((p) => p.id === plan)!.price} تومان</strong></div>
                </div>
                <div className="mt-4 bg-[#f6f6f4] p-4 text-[11px] leading-[1.9] text-neutral-600">با خرید اشتراک، حساب VIP و داشبورد اختصاصی شما بلافاصله فعال می‌شود.</div>
                <div className="mt-6 flex gap-2"><button type="button" onClick={() => setWizardStep(2)} className="h-11 w-28 border border-neutral-300 text-[12px]">بازگشت</button><button type="submit" className="h-11 flex-1 bg-[#011c3a] text-[12.5px] font-medium text-white active:scale-[0.99]">پرداخت و فعال‌سازی فوری VIP</button></div>
                <p className="mt-2 text-[10px] text-neutral-400">در نسخه فعلی، پرداخت به‌صورت آزمایشی شبیه‌سازی می‌شود.</p>
              </div>
            )}
          </form>
        </div>
      </section>

      <footer className="border-t border-neutral-200 py-6 text-center">
        <p className="text-[11px] text-neutral-500">
          © کلبه وینتیج {fa("۱۴۰۵")} — واحد فروش عمده
        </p>
      </footer>
    </div>
  );
}
