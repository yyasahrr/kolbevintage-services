import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "../router";
import { products, type Product } from "../data/catalog";
import { fa, toman } from "../utils/format";
import Icon from "../components/Icon";
import { restoreSiteCustomer, signInSiteCustomer } from "../lib/siteAuthApi";
import { restoreWholesaleVip, applyWholesaleVip, signInWholesaleVip } from "../lib/wholesaleVipApi";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import CartDrawer from "../components/CartDrawer";
import CompareBar from "../components/CompareBar";
import Toasts from "../components/Toasts";

/* ================================================================
   بازار عمده کلبه — کاتالوگ عمومی با قیمت ویژه VIP
   همه محصولات قابل مشاهده؛ قیمت فقط برای اعضای VIP فعال
   ================================================================ */

const SERIES_INFO = [
  { id: "full", label: "سری کامل", pieces: 8, desc: "S×۱ M×۲ L×۲ XL×۲ 2XL×۱" },
  { id: "half", label: "نیم‌سری", pieces: 5, desc: "M×۱ L×۱ XL×۱ 2XL×۱ M/L×۱" },
  { id: "bestseller", label: "سری پرفروش", pieces: 5, desc: "M×۲ L×۲ XL×۱" },
  { id: "single", label: "تک‌سایز", pieces: 6, desc: "همه یک سایز" },
];

const VIP_PLANS = [
  {
    id: "basic", name: "همکار", price: "۶٬۰۰۰٬۰۰۰", period: "سالانه",
    features: ["دسترسی به قیمت‌های عمده", "حداقل سفارش ۲۰ عدد", "تخفیف پایه ۲۵٪", "پشتیبانی ایمیلی"],
  },
  {
    id: "pro", name: "همکار حرفه‌ای", price: "۱۲٬۰۰۰٬۰۰۰", period: "سالانه",
    features: ["همه مزایای همکار", "تخفیف ۳۵٪ کل کاتالوگ", "کارشناس اختصاصی", "ارسال رایگان نامحدود", "اولویت کالکشن محدود"],
    highlight: true,
  },
  {
    id: "vip", name: "ویژه VIP", price: "۲۴٬۰۰۰٬۰۰۰", period: "سالانه",
    features: ["همه مزایای حرفه‌ای", "تخفیف ۴۵٪", "دوخت اختصاصی برند شما", "بسته‌بندی سفارشی", "تسویه چکی"],
  },
];

export default function Wholesale() {
  const { query } = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("همه");
  const [sort, setSort] = useState("new");
  const [shown, setShown] = useState(12);
  const [gridCols, setGridCols] = useState(4);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  /* وضعیت کاربر */
  const [siteCustomer, setSiteCustomer] = useState<{ name: string; email?: string } | null>(null);
  const [vipAccount, setVipAccount] = useState<{ storeName: string; planName: string } | null>(null);
  const [showVipPlans, setShowVipPlans] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");

  /* بازیابی نشستها */
  useEffect(() => {
    restoreSiteCustomer().then(customer => {
      if (customer) setSiteCustomer({ name: customer.name, email: customer.email });
    });
    restoreWholesaleVip().then(account => {
      if (account) setVipAccount({ storeName: account.storeName, planName: account.planName });
    });
  }, []);

  const hasVip = Boolean(vipAccount);
  const isLoggedIn = Boolean(siteCustomer);

  /* فیلترها */
  const categories = useMemo(() => ["همه", ...new Set(products.map(p => p.categoryLabel).filter(Boolean))], []);
  const filtered = useMemo(() => {
    let list = [...products];
    if (category !== "همه") list = list.filter(p => p.categoryLabel === category);
    if (search.trim()) list = list.filter(p => (p.name + p.latin + p.subtitle).toLowerCase().includes(search.trim().toLowerCase()));
    if (sort === "cheap") list.sort((a, b) => a.price - b.price);
    if (sort === "expensive") list.sort((a, b) => b.price - a.price);
    if (sort === "popular") list.sort((a, b) => b.reviewCount - a.reviewCount);
    return list;
  }, [category, search, sort]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const customer = await signInSiteCustomer(loginForm.email, loginForm.password);
      setSiteCustomer({ name: customer.name, email: customer.email });
      setShowLoginModal(false);
      /* بعد از ورود، اگر VIP هم هست قیمتها نمایش داده میشود */
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "ورود انجام نشد.");
    }
  };

  const handleApplyVip = async () => {
    /* در نسخه دمو: فعالسازی VIP */
    setVipAccount({ storeName: siteCustomer?.name ?? "فروشگاه شما", planName: "همکار حرفه‌ای" });
    setShowVipPlans(false);
  };

  return (
    <div className="storefront-shell flex min-h-screen flex-col bg-[#f7f5f0]">
      <SiteHeader />
      <div className="flex-1">

        {/* هدر صفحه */}
        <section className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-[1400px] px-4 py-4 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-[22px] font-medium text-[#011c3a]">خرید عمده</h1>
                <p className="mt-1 text-[11.5px] text-neutral-500">
                  {hasVip
                    ? `قیمت‌های عمده فعال — ${vipAccount?.storeName} (${vipAccount?.planName})`
                    : "محصولات برای همه قابل مشاهده — قیمت‌ها ویژه اعضای VIP"}
                </p>
              </div>
              {/* وضعیت کاربر */}
              <div className="flex items-center gap-2">
                {hasVip && (
                  <span className="flex items-center gap-2 rounded-full border border-[#b9cfbc] bg-[#edf3ee] px-4 py-2 text-[11px] text-[#36563a]">
                    <Icon name="shield" className="h-3.5 w-3.5" /> VIP فعال
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* بدنه: فیلتر عمودی (راست) + گرید (چپ) */}
        <div className="mx-auto flex w-full max-w-[1400px] gap-5 px-4 py-5 lg:px-8">

        {/* سایدبار فیلتر */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-[90px] space-y-5">
            <div className="flex h-10 items-center gap-2 rounded-full border border-neutral-300 bg-white px-4">
              <Icon name="search" className="h-4 w-4 text-neutral-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو…" className="h-full flex-1 bg-transparent text-[12px] outline-none placeholder:text-neutral-400" />
            </div>
            <div>
              <p className="mb-2 text-[10.5px] font-medium text-neutral-500">مرتب‌سازی</p>
              <select value={sort} onChange={e => setSort(e.target.value)} className="h-9 w-full rounded border border-neutral-300 bg-white px-3 text-[11px] outline-none">
                <option value="new">جدیدترین</option>
                <option value="popular">محبوب‌ترین</option>
                <option value="cheap">ارزان‌ترین</option>
                <option value="expensive">گران‌ترین</option>
              </select>
            </div>
            <div>
              <p className="mb-2 text-[10.5px] font-medium text-neutral-500">دسته‌بندی</p>
              <div className="flex flex-col gap-1">
                {categories.map(cat => (
                  <button key={cat} onClick={() => { setCategory(cat); setShown(12); }} className={`rounded px-3 py-2 text-right text-[11px] transition ${category === cat ? "bg-[#011c3a] text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10.5px] font-medium text-neutral-500">چینش</p>
              <div className="flex gap-1.5">
                {([3, 4, 5] as const).map(n => (
                  <button key={n} onClick={() => setGridCols(n)} className={`flex h-8 w-8 items-center justify-center rounded border text-[10px] transition ${gridCols === n ? "border-[#011c3a] bg-[#011c3a] text-white" : "border-neutral-200 text-neutral-400 hover:border-neutral-400"}`} aria-label={`${n} ستونه`}>
                    {fa(n)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* محتوا */}
        <main className="min-w-0 flex-1">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11.5px] text-neutral-500">{fa(filtered.length)} محصول</p>
          </div>
          <div className={`grid gap-3 grid-cols-2 ${gridCols === 3 ? "lg:grid-cols-3" : gridCols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
            {filtered.slice(0, shown).map(product => (
              <WholesaleCard key={product.id} product={product} hasVip={hasVip} onOpen={() => setSelectedProduct(product)} />
            ))}
          </div>
          {shown < filtered.length && (
            <div className="mt-6 text-center">
              <button onClick={() => setShown(sh => sh + 8)} className="rounded-full border border-neutral-300 px-8 py-3 text-[12px] transition hover:border-[#011c3a]">
                مشاهده بیشتر ({fa(filtered.length - shown)} محصول دیگر)
              </button>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-[14px] font-medium text-neutral-500">محصولی یافت نشد</p>
            </div>
          )}
        </main>
        </div>
      </div>

      {/* مودال جزئیات محصول */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          hasVip={hasVip}
          isLoggedIn={isLoggedIn}
          onClose={() => setSelectedProduct(null)}
          onLogin={() => { setSelectedProduct(null); setShowLoginModal(true); }}
          onVipPlans={() => { setSelectedProduct(null); setShowVipPlans(true); }}
        />
      )}

      {/* مودال ورود */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4" onClick={() => setShowLoginModal(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-center text-[17px] font-medium text-[#011c3a]">ورود به کلبه وینتیج</h3>
            <p className="mt-1 text-center text-[11px] text-neutral-500">برای مشاهده قیمت‌های عمده وارد شوید</p>
            {loginError && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{loginError}</p>}
            <form onSubmit={handleLogin} className="mt-4 space-y-3">
              <input type="email" required value={loginForm.email} onChange={e => setLoginForm(f => ({ ...f, email: e.target.value }))} placeholder="ایمیل" className="h-11 w-full rounded border border-neutral-300 px-3 text-[12px] outline-none focus:border-[#011c3a]" />
              <input type="password" required value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} placeholder="رمز عبور" className="h-11 w-full rounded border border-neutral-300 px-3 text-[12px] outline-none focus:border-[#011c3a]" />
              <button type="submit" className="h-11 w-full rounded bg-[#011c3a] text-[12.5px] font-medium text-white transition hover:bg-[#0a2c55]">ورود</button>
            </form>
            <p className="mt-4 text-center text-[10.5px] text-neutral-400">حساب ندارید؟ <Link to="/account" className="text-[#011c3a] underline">ثبت‌نام</Link></p>
          </div>
        </div>
      )}

      {/* مودال انتخاب پلن VIP */}
      {showVipPlans && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-4 py-8 overflow-y-auto" onClick={() => setShowVipPlans(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-5 text-center">
              <h3 className="text-[18px] font-medium text-[#011c3a]">اشتراک VIP بازار عمده</h3>
              <p className="mt-1 text-[11.5px] text-neutral-500">پلن مناسب کسب‌وکار خود را انتخاب کنید</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {VIP_PLANS.map(plan => (
                <div key={plan.id} className={`rounded-lg border p-5 ${plan.highlight ? "border-[#011c3a] shadow-md" : "border-neutral-200"}`}>
                  {plan.highlight && <span className="mb-2 inline-block rounded-full bg-[#011c3a] px-3 py-1 text-[9px] text-white">پیشنهاد ما</span>}
                  <h4 className="text-[15px] font-medium">{plan.name}</h4>
                  <p className="mt-2 text-[20px] font-medium text-[#011c3a] num-fa">{plan.price}</p>
                  <p className="text-[9.5px] text-neutral-400">تومان / {plan.period}</p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-[10.5px] text-neutral-600">
                        <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3d5c3a]" strokeWidth={2.5} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={handleApplyVip} className={`mt-5 h-10 w-full rounded text-[11.5px] font-medium transition ${plan.highlight ? "bg-[#011c3a] text-white hover:bg-[#0a2c55]" : "border border-[#011c3a] text-[#011c3a] hover:bg-[#011c3a] hover:text-white"}`}>
                    انتخاب {plan.name}
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowVipPlans(false)} className="mt-4 block mx-auto text-[11px] text-neutral-400 underline">بستن</button>
          </div>
        </div>
      )}

      <SiteFooter />
      <CartDrawer />
      <CompareBar />
      <Toasts />
    </div>
  );
}

/* ================================================================
   کارت محصول عمده
   ================================================================ */

function WholesaleCard({ product, hasVip, onOpen }: { product: Product; hasVip: boolean; onOpen: () => void }) {
  return (
    <article className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-lg bg-white transition-shadow hover:shadow-lg" onClick={onOpen}>
      <div className="relative overflow-hidden bg-neutral-100">
        <img src={product.images[0]} alt={product.name} loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        {product.images[1] && (
          <img src={product.images[1]} alt="" loading="lazy" aria-hidden className="absolute inset-0 aspect-[4/5] w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        )}
        {product.badges.length > 0 && (
          <span className="absolute right-2 top-2 rounded-full bg-[#011c3a] px-2 py-0.5 text-[9px] font-medium text-white">{product.badges[0]}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="text-[9.5px] text-neutral-400">{product.categoryLabel}</p>
        <h3 className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-[#011c3a]">{product.name}</h3>
        <p className="mt-1 text-[10.5px] text-neutral-400">{product.latin}</p>
        {/* رنگها */}
        <div className="mt-2 flex gap-1">
          {product.colours.slice(0, 5).map(c => (
            <span key={c.name} className="h-3 w-3 rounded-full border border-neutral-200" style={{ background: c.hex }} title={c.name} />
          ))}
        </div>
        {/* قیمت */}
        <div className="mt-auto pt-3">
          {hasVip ? (
            <div>
              <p className="text-[14px] font-medium text-[#011c3a] num-fa">{toman(Math.round(product.price * 0.65))}</p>
              <p className="mt-0.5 text-[9px] text-neutral-400">قیمت عمده هر تیکه</p>
            </div>
          ) : (
            <div className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-[#f7f5f0] text-[10.5px] text-neutral-500">
              <Icon name="shield" className="h-3 w-3" /> قیمت ویژه VIP
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/* ================================================================
   مودال جزئیات محصول — رنگها، سریها، مشخصات (قیمت فقط VIP)
   ================================================================ */

function ProductDetailModal({ product, hasVip, isLoggedIn, onClose, onLogin, onVipPlans }: {
  product: Product; hasVip: boolean; isLoggedIn: boolean; onClose: () => void; onLogin: () => void; onVipPlans: () => void;
}) {
  const [activeImage, setActiveImage] = useState(0);
  const [activeColour, setActiveColour] = useState(0);
  const [selectedSeries, setSelectedSeries] = useState("full");

  const series = SERIES_INFO.find(s => s.id === selectedSeries) ?? SERIES_INFO[0];
  const wholesaleUnit = Math.round(product.price * 0.65);
  const seriesPrice = wholesaleUnit * series.pieces;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4 py-6" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* بستن */}
        <button onClick={onClose} aria-label="بستن" className="absolute left-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:bg-white">
          <Icon name="close" className="h-4 w-4" />
        </button>

        <div className="grid gap-0 md:grid-cols-2">
          {/* تصاویر */}
          <div className="p-5">
            <div className="overflow-hidden rounded-lg bg-neutral-100">
              <img src={product.images[activeImage]} alt={product.name} className="aspect-[4/5] w-full object-cover" />
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2">
                {product.images.map((img, i) => (
                  <button key={i} onClick={() => setActiveImage(i)} className={`h-16 w-12 overflow-hidden rounded border-2 transition ${activeImage === i ? "border-[#011c3a]" : "border-transparent opacity-60"}`}>
                    <img src={img} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* اطلاعات */}
          <div className="p-5 md:p-6">
            <p className="text-[10px] tracking-[0.25em] text-neutral-400">{product.latin.toUpperCase()}</p>
            <h2 className="mt-2 text-[22px] font-medium text-[#011c3a]">{product.name}</h2>
            <p className="mt-1 text-[12px] text-neutral-500">{product.subtitle}</p>

            {/* رنگها */}
            <div className="mt-5">
              <p className="text-[11.5px] font-medium">رنگ‌های موجود</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.colours.map((colour, i) => (
                  <button key={colour.name} onClick={() => setActiveColour(i)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10.5px] transition ${activeColour === i ? "border-[#011c3a] bg-[#f7f5f0]" : "border-neutral-200 hover:border-neutral-400"}`}>
                    <span className="h-4 w-4 rounded-full border border-neutral-200" style={{ background: colour.hex }} />
                    {colour.name}
                  </button>
                ))}
              </div>
            </div>

            {/* سریها */}
            <div className="mt-5">
              <p className="text-[11.5px] font-medium">نوع سری عرضه</p>
              <div className="mt-2 grid gap-2">
                {SERIES_INFO.map(s => (
                  <button key={s.id} onClick={() => setSelectedSeries(s.id)} className={`flex items-center justify-between rounded border p-3 text-right transition ${selectedSeries === s.id ? "border-[#011c3a] bg-[#f7f5f0]" : "border-neutral-200 hover:border-neutral-400"}`}>
                    <div>
                      <span className="text-[11px] font-medium">{s.label}</span>
                      <span className="mt-0.5 block text-[9px] text-neutral-400">{s.desc}</span>
                    </div>
                    <span className="text-[11px] font-medium text-[#011c3a] num-fa">{fa(s.pieces)} تیکه</span>
                  </button>
                ))}
              </div>
            </div>

            {/* سایزها */}
            <div className="mt-5">
              <p className="text-[11.5px] font-medium">سایزهای موجود</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {product.sizes.map(size => (
                  <span key={size.label} className={`rounded border px-2.5 py-1 text-[10px] ${size.inStock ? "border-neutral-300 text-neutral-700" : "border-neutral-200 text-neutral-300 line-through"}`}>
                    {size.label}
                  </span>
                ))}
              </div>
            </div>

            {/* توضیحات */}
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <p className="text-[10.5px] leading-[1.9] text-neutral-600">{product.description}</p>
            </div>

            {/* قیمت */}
            <div className="mt-5 rounded-lg p-4" style={{ background: hasVip ? "#edf3ee" : "#f7f5f0" }}>
              {hasVip ? (
                <div>
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-[9.5px] text-neutral-500">قیمت هر تیکه</p>
                      <p className="mt-1 text-[16px] font-medium text-[#011c3a] num-fa">{toman(wholesaleUnit)}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-[9.5px] text-neutral-500">قیمت {series.label}</p>
                      <p className="mt-1 text-[18px] font-medium text-[#011c3a] num-fa">{toman(seriesPrice)}</p>
                    </div>
                  </div>
                  <button className="mt-3 h-11 w-full rounded-full bg-[#011c3a] text-[12px] font-medium text-white transition hover:bg-[#0a2c55] active:translate-y-px">
                    افزودن {series.label} به سفارش
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-[11px] text-neutral-500">
                    <Icon name="shield" className="h-4 w-4" /> قیمت ویژه اعضای VIP
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {!isLoggedIn ? (
                      <button onClick={onLogin} className="h-10 w-full rounded-full bg-[#011c3a] text-[11.5px] font-medium text-white transition hover:bg-[#0a2c55]">
                        ورود / ثبت‌نام
                      </button>
                    ) : (
                      <button onClick={onVipPlans} className="h-10 w-full rounded-full bg-[#011c3a] text-[11.5px] font-medium text-white transition hover:bg-[#0a2c55]">
                        تهیه اشتراک VIP
                      </button>
                    )}
                    <p className="text-[9.5px] text-neutral-400">
                      {isLoggedIn ? "برای دیدن قیمت‌ها اشتراک VIP تهیه کنید" : "ابتدا وارد شوید، سپس اشتراک تهیه کنید"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
