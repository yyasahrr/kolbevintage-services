import { useEffect, useState, type FormEvent } from "react";
import { Link } from "../router";
import { useStore } from "../store";
import { products, productById, specLabels, specOrder } from "../data/catalog";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";
import ProductCard from "../components/ProductCard";
import { createCustomer, loadCustomer, saveCustomer } from "../customerIdentity";
import { loadWholesaleMembership } from "../wholesaleMembership";
import { restoreSiteCustomer, signInSiteCustomer, signOutSiteCustomer, signUpSiteCustomer } from "../lib/siteAuthApi";

const input =
  "h-10 w-full rounded-[3px] border border-neutral-300 px-3 text-[12.5px] outline-none transition focus:border-[#011c3a]";

/* -------------------------------- درباره ما -------------------------------- */

export function About() {
  const timeline = [
    { year: "۱۳۹۲", title: "شروع از یک اتاق", text: "کلبه با یک چرخ خیاطی و دو نفر در یک اتاق ۲۰ متری شروع شد." },
    { year: "۱۳۹۶", title: "اولین کارگاه", text: "به کارگاهی با ده خیاط منتقل شدیم و اولین کالکشن کامل را دوختیم." },
    { year: "۱۴۰۰", title: "فروشگاه اول", text: "اولین فروشگاه فیزیکی در خیابان ولیعصر افتتاح شد." },
    { year: "۱۴۰۵", title: "امروز", text: "بیش از ۴۰ نفر در کارگاه کلبه کار می‌کنند و به سراسر ایران ارسال داریم." },
  ];

  const values = [
    { icon: "needle", title: "دوخت دست", text: "هیچ قطعه‌ای بدون دخالت دست خیاط از کارگاه بیرون نمی‌رود." },
    { icon: "shield", title: "کیفیت پیش از سرعت", text: "ترجیح می‌دهیم دیرتر تحویل دهیم اما کیفیت را کم نکنیم." },
    { icon: "return", title: "پایداری", text: "پارچه‌های طبیعی، بسته‌بندی بدون پلاستیک و تعمیر رایگان تا یک سال." },
  ];

  return (
    <main>
      <section className="page-hero relative h-[55vh] min-h-[340px] w-full overflow-hidden">
        <img src="/images/store.jpg" alt="کارگاه کلبه وینتیج" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-black/15" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="text-[11px] tracking-[0.4em] text-white/75">OUR STORY</p>
          <h1 className="mt-4 text-[28px] font-medium lg:text-[38px]">درباره کلبه وینتیج</h1>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 py-14 lg:py-20">
        <p className="text-[14px] leading-[2.3] text-neutral-700">
          کلبه وینتیج از یک باور ساده شروع شد: لباس خوب، لباسی است که سال‌ها بماند. در دنیایی که هر فصل صدها مدل تازه
          تولید می‌شود، ما تصمیم گرفتیم کمتر بدوزیم اما بهتر.
        </p>
        <p className="mt-5 text-[13px] leading-[2.2] text-neutral-600">
          هر قطعه در کارگاه ما از انتخاب پارچه تا آخرین دکمه، زیر نظر خیاط ارشد ساخته می‌شود. پارچه‌ها را از کارگاه‌های
          قدیمی تهیه می‌کنیم و الگوها را بر اساس اندام واقعی مشتریان ایرانی اصلاح کرده‌ایم.
        </p>
      </section>

      <section className="bg-[#f6f6f4] py-14 lg:py-20">
        <div className="mx-auto w-full max-w-3xl px-4">
          <h2 className="mb-10 text-center text-[20px] font-medium">مسیر ما</h2>
          <div className="space-y-8">
            {timeline.map((t) => (
              <div key={t.year} className="flex gap-5">
                <span className="w-14 shrink-0 pt-0.5 text-[13px] font-medium num-fa">{t.year}</span>
                <div className="border-r border-neutral-300 pr-5">
                  <h3 className="text-[13.5px] font-medium">{t.title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-neutral-600">{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full px-4 py-14 lg:px-8 lg:py-20">
        <h2 className="mb-10 text-center text-[20px] font-medium">ارزش‌های ما</h2>
        <div className="grid gap-8 sm:grid-cols-3">
          {values.map((v) => (
            <div key={v.title} className="text-center">
              <Icon name={v.icon} className="mx-auto h-7 w-7" strokeWidth={1.2} />
              <h3 className="mt-3 text-[13.5px] font-medium">{v.title}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-neutral-200 py-14">
        <div className="mx-auto w-full max-w-2xl px-4 text-center">
          <h2 className="text-[19px] font-medium">تیم کلبه</h2>
          <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-600">
            ۴۲ نفر در کارگاه، ۸ نفر در پشتیبانی و ۳ استایلیست. همه ما یک هدف داریم: اینکه لباسی که می‌خرید، ده سال دیگر
            هم بپوشید.
          </p>
          <Link to="/contact" className="mt-6 inline-block rounded-[3px] bg-[#011c3a] px-8 py-3 text-[12.5px] text-white">
            با ما در تماس باشید
          </Link>
        </div>
      </section>
    </main>
  );
}

/* --------------------------------- تماس ------------------------------------ */

export function Contact() {
  const [sent, setSent] = useState(false);
  const faqs = [
    { q: "چقدر طول می‌کشد سفارشم برسد؟", a: "سفارش‌ها تا ۲۴ ساعت کاری آماده و ارسال می‌شوند. با پست پیشتاز ۲ تا ۳ روز کاری و با تیپاکس ۱ تا ۲ روز کاری به دستتان می‌رسد." },
    { q: "شرایط مرجوعی چیست؟", a: "تا ۳۰ روز پس از دریافت، اگر محصول استفاده نشده و برچسب‌ها سر جایشان باشد، بدون هیچ پرسشی مرجوع یا تعویض می‌شود." },
    { q: "اگر سایز اشتباه سفارش دادم چه کنم؟", a: "با پشتیبانی تماس بگیرید؛ تعویض سایز رایگان است و هزینه ارسال رفت و برگشت با ماست." },
    { q: "آیا امکان دوخت سفارشی وجود دارد؟", a: "بله، برای بلیزر و پالتو امکان دوخت با اندازه‌های شما وجود دارد. برای هماهنگی با شماره فروشگاه تماس بگیرید." },
    { q: "چطور از موجود شدن محصول باخبر شوم؟", a: "در صفحه محصول، سایز ناموجود را انتخاب کنید و ایمیل خود را ثبت کنید؛ به‌محض شارژ موجودی به شما اطلاع می‌دهیم." },
  ];
  const [open, setOpen] = useState<number | null>(0);

  return (
    <main className="mx-auto w-full px-4 py-12 lg:px-8 lg:py-16">
      <div className="mb-10 text-center">
        <h1 className="text-[26px] font-medium">تماس با ما</h1>
        <p className="mt-3 text-[12.5px] text-neutral-500">هر سوالی دارید، ما اینجاییم.</p>
      </div>

      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <div>
          <h2 className="text-[16px] font-medium">فرم تماس</h2>
          {sent ? (
            <div className="mt-5 rounded-[3px] border border-neutral-200 bg-[#f7f6f3] p-6 text-center">
              <Icon name="check" className="mx-auto h-6 w-6" strokeWidth={2.5} />
              <p className="mt-3 text-[13px] font-medium">پیام شما ارسال شد</p>
              <p className="mt-1.5 text-[12px] text-neutral-500">حداکثر تا یک روز کاری پاسخ می‌دهیم.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
              className="mt-5 grid gap-2.5"
            >
              <input required className={input} placeholder="نام و نام خانوادگی" />
              <input required className={input} placeholder="شماره تماس" inputMode="tel" />
              <input className={input} placeholder="ایمیل (اختیاری)" />
              <select className={input}>
                <option>موضوع پیام</option>
                <option>پیگیری سفارش</option>
                <option>سوال درباره محصول</option>
                <option>مرجوعی و تعویض</option>
                <option>همکاری و عمده‌فروشی</option>
                <option>سایر</option>
              </select>
              <textarea
                required
                rows={5}
                className="w-full rounded-[3px] border border-neutral-300 p-3 text-[12.5px] outline-none focus:border-[#011c3a]"
                placeholder="پیام شما"
              />
              <button className="mt-1 h-11 rounded-[3px] bg-[#011c3a] text-[13px] font-medium text-white">
                ارسال پیام
              </button>
            </form>
          )}
        </div>

        <div>
          <h2 className="text-[16px] font-medium">راه‌های ارتباطی</h2>
          <ul className="mt-5 space-y-4 text-[12.5px]">
            {[
              { icon: "pin", label: "نشانی", value: `تهران، خیابان ولیعصر، پلاک ${fa("۱۲۴۰")}، طبقه دوم` },
              { icon: "phone", label: "تلفن", value: fa("۰۲۱-۹۱۰۰۲۲۳۳") },
              { icon: "mail", label: "ایمیل", value: "hi@kolbevintage.ir" },
              { icon: "clock", label: "ساعات کاری", value: `شنبه تا پنجشنبه، ${fa("۱۰")} تا ${fa("۱۹")}` },
            ].map((c) => (
              <li key={c.label} className="flex gap-3">
                <Icon name={c.icon} className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <div>
                  <p className="text-[11px] text-neutral-500">{c.label}</p>
                  <p className="mt-0.5">{c.value}</p>
                </div>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-[16px] font-medium">سوالات متداول</h2>
          <div className="mt-4 border-t border-neutral-200">
            {faqs.map((f, i) => (
              <div key={i} className="border-b border-neutral-200">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between gap-3 py-3.5 text-right text-[12.5px]"
                >
                  {f.q}
                  <Icon name={open === i ? "minus" : "plus"} className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                </button>
                {open === i && <p className="pb-4 text-[12px] leading-[2] text-neutral-600">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------ علاقه‌مندی‌ها ------------------------------- */

export function Wishlist() {
  const { wishlist } = useStore();
  const items = wishlist.map(productById).filter(Boolean) as ReturnType<typeof productById>[];

  return (
    <main className="mx-auto w-full px-4 py-12 lg:px-8 lg:py-16">
      <h1 className="mb-8 text-[24px] font-medium">علاقه‌مندی‌های من</h1>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-24 text-center">
          <Icon name="heart" className="h-11 w-11 text-neutral-300" />
          <p className="text-[13px] text-neutral-500">هنوز محصولی به علاقه‌مندی‌ها اضافه نکرده‌اید.</p>
          <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[12.5px] text-white">
            مشاهده محصولات
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
          {items.map((p) => p && <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </main>
  );
}

/* --------------------------------- مقایسه ---------------------------------- */

export function Compare() {
  const { compare, toggleCompare, clearCompare } = useStore();
  const items = compare.map(productById).filter(Boolean) as ReturnType<typeof productById>[];

  if (items.length === 0) {
    return (
      <main className="mx-auto flex w-full flex-col items-center gap-5 px-4 py-24 text-center">
        <h1 className="text-[20px] font-medium">لیست مقایسه خالی است</h1>
        <p className="text-[12.5px] text-neutral-500">از صفحه محصولات، گزینه «مقایسه» را بزنید.</p>
        <Link to="/shop" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[12.5px] text-white">
          مشاهده محصولات
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full px-4 py-12 lg:px-8 lg:py-16">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-[24px] font-medium">مقایسه محصولات</h1>
        <button onClick={clearCompare} className="text-[12px] text-neutral-500 underline">
          پاک کردن همه
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead>
            <tr>
              <th className="w-32 border-b border-neutral-200 py-3 text-right font-medium text-neutral-500" />
              {items.map((p) => p && (
                <th key={p.id} className="border-b border-neutral-200 p-3 text-right align-top">
                  <div className="relative">
                    <img src={p.images[0]} alt={p.name} className="aspect-[3/4] w-full max-w-[150px] object-cover" loading="lazy" />
                    <button
                      onClick={() => toggleCompare(p.id)}
                      className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90"
                      aria-label="حذف"
                    >
                      <Icon name="close" className="h-3 w-3" />
                    </button>
                  </div>
                  <Link to={`/product/${p.id}`} className="mt-2 block text-[12.5px] font-medium hover:underline">
                    {p.name}
                  </Link>
                  <span className="mt-1 block text-[12px] font-normal num-fa">{toman(p.price)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {specOrder.map((key, i) => (
              <tr key={key} className={i % 2 ? "bg-[#f7f6f3]" : ""}>
                <td className="p-3 font-medium text-neutral-500">{specLabels[key]}</td>
                {items.map((p) => p && (
                  <td key={p.id} className="p-3 align-top leading-relaxed">
                    {p.specs[key]}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="p-3 font-medium text-neutral-500">امتیاز</td>
              {items.map((p) => p && (
                <td key={p.id} className="p-3 num-fa">
                  {fa(p.rating)} از ۵ ({fa(p.reviewCount)} نظر)
                </td>
              ))}
            </tr>
            <tr className="bg-[#f7f6f3]">
              <td className="p-3 font-medium text-neutral-500">سایزهای موجود</td>
              {items.map((p) => p && (
                <td key={p.id} className="p-3">
                  {p.sizes.filter((s) => s.inStock).map((s) => s.label).join("، ")}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}

/* ------------------------------ حساب کاربری -------------------------------- */

export function Account() {
  const [customer, setCustomer] = useState<ReturnType<typeof loadCustomer>>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [tab, setTab] = useState("orders");
  const membership = loadWholesaleMembership();
  const tabs = [
    { id: "orders", label: "سفارش‌های من" },
    { id: "addresses", label: "آدرس‌ها" },
    { id: "profile", label: "اطلاعات حساب" },
  ];

  const orders = [
    { code: "KV-482910", date: "۱۲ مرداد ۱۴۰۵", status: "تحویل شده", total: 4_850_000, items: 1 },
    { code: "KV-471203", date: "۲۸ تیر ۱۴۰۵", status: "در حال ارسال", total: 3_170_000, items: 2 },
    { code: "KV-460055", date: "۱۰ تیر ۱۴۰۵", status: "تحویل شده", total: 980_000, items: 1 },
  ];

  useEffect(() => { restoreSiteCustomer().then((identity) => { if (identity) { setCustomer(identity); setAuthForm((form) => ({ ...form, name: identity.name, phone: identity.phone, email: identity.email ?? "" })); } }).finally(() => setAuthLoading(false)); }, []);
  const submitAuth = async (event: FormEvent) => { event.preventDefault(); setAuthError(""); setAuthSubmitting(true); try { const identity = authMode === "login" ? await signInSiteCustomer(authForm.email, authForm.password) : await signUpSiteCustomer(authForm); saveCustomer(identity); setCustomer(identity); } catch (reason) { setAuthError(reason instanceof Error ? reason.message : "ورود انجام نشد."); } finally { setAuthSubmitting(false); } };

  if (authLoading) return <main className="flex min-h-[60vh] items-center justify-center text-[11px] text-neutral-500">در حال بررسی حساب کلبه…</main>;

  if (!customer) {
    return (
      <main className="account-entry mx-auto w-full max-w-[620px] px-4 py-8 sm:py-12 lg:px-8">
        <div>
          <section className="liquid-panel account-auth-panel flex flex-col justify-center p-5 sm:p-7 lg:p-8">
            <p className="text-[9px] tracking-[0.25em] text-neutral-400">ONE ACCOUNT</p>
            <h1 className="mt-2 text-[25px] font-medium">ورود یا ساخت حساب</h1>
            <p className="mt-2 max-w-md text-[11.5px] leading-[1.9] text-neutral-500">سفارش‌ها، سایزهای ذخیره‌شده، آدرس‌ها و تصویرهای Try On Me را در یک حساب نگه دارید.</p>
            <div className="mt-5 grid grid-cols-2 border border-neutral-200 p-1"><button type="button" onClick={()=>setAuthMode("login")} className={(authMode==="login"?"bg-[#011c3a] text-white":"text-neutral-500")+" h-9 text-[10.5px]"}>ورود</button><button type="button" onClick={()=>setAuthMode("register")} className={(authMode==="register"?"bg-[#011c3a] text-white":"text-neutral-500")+" h-9 text-[10.5px]"}>ساخت حساب</button></div>
            <form onSubmit={submitAuth} className="mt-4 grid gap-3">
              {authMode === "register" && <><label className="block text-[10px] text-neutral-500">نام و نام خانوادگی<input name="name" autoComplete="name" value={authForm.name} onChange={(e) => setAuthForm((form) => ({ ...form, name: e.target.value }))} className={input + " mt-1.5"} required /></label><label className="block text-[10px] text-neutral-500">شماره موبایل<input name="phone" type="tel" inputMode="tel" autoComplete="tel" value={authForm.phone} onChange={(e) => setAuthForm((form) => ({ ...form, phone: e.target.value }))} className={input + " mt-1.5"} minLength={10} required /></label></>}
              <label className="block text-[10px] text-neutral-500">ایمیل<input name="email" type="email" autoComplete="email" spellCheck={false} value={authForm.email} onChange={(e) => setAuthForm((form) => ({ ...form, email: e.target.value }))} className={input + " mt-1.5"} required /></label>
              <label className="block text-[10px] text-neutral-500">رمز عبور<input name="password" type="password" minLength={8} autoComplete={authMode==="login"?"current-password":"new-password"} value={authForm.password} onChange={(e) => setAuthForm((form) => ({ ...form, password: e.target.value }))} className={input + " mt-1.5"} required /></label>
              {authError && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-[10px] text-red-700">{authError}</p>}
              <button type="submit" disabled={authSubmitting} className="storefront-primary-action mt-1 h-11 w-full rounded-[3px] text-[12.5px] font-medium disabled:opacity-50">{authSubmitting?"در حال بررسی…":authMode==="login"?"ورود به حساب کلبه":"ساخت حساب کلبه"}</button>
            </form>
            <p className="mt-4 text-[9.5px] leading-relaxed text-neutral-400">با ادامه، قوانین خرید و سیاست حریم خصوصی کلبه را می‌پذیرید.</p>
          </section>

        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full px-4 py-12 lg:px-8 lg:py-16">
      <h1 className="mb-8 text-[24px] font-medium">حساب کاربری</h1>

      <div className="grid gap-8 lg:grid-cols-[200px_1fr] lg:gap-12">
        <aside>
          <div className="mb-5 rounded-[3px] border border-neutral-200 p-4">
            <div className="flex items-start justify-between gap-2"><p className="text-[13px] font-medium">{customer.name}</p>{membership?.customerId === customer.id && <span className="bg-[#011c3a] px-1.5 py-0.5 text-[8px] text-white">VIP</span>}</div>
            <p className="mt-1 text-[11.5px] text-neutral-500 num-fa">{fa(customer.phone)}</p>
          </div>
          <nav className="space-y-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "block w-full rounded-[3px] px-3 py-2.5 text-right text-[12.5px] transition " +
                  (tab === t.id ? "bg-[#011c3a] text-white" : "hover:bg-neutral-100")
                }
              >
                {t.label}
              </button>
            ))}
            <Link to="/wishlist" className="block rounded-[3px] px-3 py-2.5 text-[12.5px] hover:bg-neutral-100">
              علاقه‌مندی‌ها
            </Link>
            <Link to="/wholesale" className="block rounded-[3px] px-3 py-2.5 text-[12.5px] font-medium hover:bg-neutral-100">
              {membership?.customerId === customer.id ? "ورود به فروشگاه عمده" : "فعال‌سازی خرید عمده"}
            </Link>
          </nav>
        </aside>

        <div>
          {tab === "orders" && (
            <div className="space-y-3">
              {orders.map((o) => (
                <div key={o.code} className="rounded-[3px] border border-neutral-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[12.5px] font-medium num-fa">سفارش {o.code}</p>
                      <p className="mt-1 text-[11.5px] text-neutral-500">
                        {o.date} — {fa(o.items)} کالا
                      </p>
                    </div>
                    <span
                      className={
                        "rounded-[3px] px-2.5 py-1 text-[10.5px] " +
                        (o.status === "تحویل شده" ? "bg-[#f0f5f0] text-[#3d5c3a]" : "bg-[#f7f6f3] text-neutral-600")
                      }
                    >
                      {o.status}
                    </span>
                    <span className="text-[12.5px] num-fa">{toman(o.total)}</span>
                    <button className="text-[11.5px] underline">جزئیات</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "addresses" && (
            <div className="space-y-3">
              <div className="rounded-[3px] border border-neutral-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-medium">خانه</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-600">
                      تهران، سعادت‌آباد، خیابان علامه شمالی، پلاک {fa("۲۴")}، واحد {fa("۵")}
                      <br />
                      کد پستی: <span className="num-fa">{fa("۱۹۹۷۸۴۵۱۲۳")}</span>
                    </p>
                  </div>
                  <button className="shrink-0 text-[11.5px] underline">ویرایش</button>
                </div>
              </div>
              <button className="h-10 w-full rounded-[3px] border border-dashed border-neutral-300 text-[12.5px] text-neutral-500 hover:border-[#011c3a]">
                + افزودن آدرس جدید
              </button>
            </div>
          )}

          {tab === "profile" && (
            <div className="grid max-w-lg gap-2.5">
              <input className={input} value={authForm.name} onChange={(e) => setAuthForm((form) => ({ ...form, name: e.target.value }))} placeholder="نام و نام خانوادگی" />
              <input className={input} value={authForm.phone} onChange={(e) => setAuthForm((form) => ({ ...form, phone: e.target.value }))} placeholder="موبایل" />
              <input className={input} value={authForm.email} onChange={(e) => setAuthForm((form) => ({ ...form, email: e.target.value }))} placeholder="ایمیل" />
              <button onClick={() => { const updated = { ...customer, name: authForm.name, phone: authForm.phone, email: authForm.email || undefined }; saveCustomer(updated); setCustomer(updated); }} className="mt-2 h-10 rounded-[3px] bg-[#011c3a] text-[12.5px] font-medium text-white">
                ذخیره تغییرات
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------ صفحه ۴۰۴ ---------------------------------- */

export function NotFound() {
  return (
    <main className="mx-auto flex w-full flex-col items-center gap-5 px-4 py-28 text-center">
      <p className="text-[48px] font-light num-fa">۴۰۴</p>
      <h1 className="text-[19px] font-medium">این صفحه پیدا نشد</h1>
      <p className="text-[12.5px] text-neutral-500">شاید آدرس اشتباه است یا صفحه جابه‌جا شده.</p>
      <Link to="/" className="rounded-[3px] bg-[#011c3a] px-8 py-3 text-[12.5px] text-white">
        بازگشت به خانه
      </Link>
      <div className="mt-10 w-full">
        <p className="mb-5 text-[13px] font-medium">شاید این‌ها را بخواهید</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4">
          {products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </main>
  );
}
